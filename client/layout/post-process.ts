/**
 * Phase 2 — post-processing pass (dedup, crossing router, labels)
 *
 * bpmn-auto-layout's raw output has two known rough edges: (1) it can place
 * several edges' segments exactly on top of each other for part of their
 * route (e.g. two flows leaving the same gateway anchor and running
 * parallel before diverging — confirmed live on the 29-element fixture:
 * f3/f4 both ran the full length (225,95)->(225,280) collinear), and (2) it
 * emits zero <bpmndi:BPMNLabel> elements at all, so bpmn-js falls back to
 * its own default label placement at render time — which is what produced
 * the confirmed mid-word wraps and label/line overlaps seen in live
 * testing. These three passes run in this fixed order on the parsed DI,
 * before import: dedup first (the router's segment math needs non-degenerate
 * segments), router before labels (label collision-avoidance needs the
 * final waypoints, not the pre-router ones).
 */

import { type Rect, rectsOverlap, segmentIntersectsRect } from '../element-shared';

const WAYPOINT_DEDUP_EPSILON = 0.5;
const CROSSING_LANE_SPACING = 20;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 14;
const LABEL_MAX_WIDTH = 100;
// New convention (BPMN-BEST-PRACTICES.md doesn't yet document a label/line
// clearance value — this establishes one rather than inventing an ad-hoc
// number silently).
const LABEL_CLEARANCE = 6;

/** Drops near-duplicate consecutive waypoints (within ~0.5px) — a duplicate point renders as a corner-rounding glitch/spike, and is degenerate input to the router below. */
export function dedupEdgeWaypoints(edges: any[]): void {
  for (const edge of edges) {
    const pts: any[] = edge.waypoint;
    if (!pts || pts.length <= 2) continue;
    const deduped = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = deduped[deduped.length - 1];
      if (Math.abs(pts[i].x - prev.x) < WAYPOINT_DEDUP_EPSILON && Math.abs(pts[i].y - prev.y) < WAYPOINT_DEDUP_EPSILON) {
        continue;
      }
      deduped.push(pts[i]);
    }
    if (deduped.length >= 2) edge.waypoint = deduped;
  }
}

interface SegRef { edge: any; index: number; }
interface ConflictGroup { axis: 'x' | 'y'; segs: SegRef[]; }

function range1d(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function anyPairOverlaps(segs: SegRef[], rangeAxis: 'x' | 'y'): boolean {
  const ranges = segs.map((s) => {
    const pts = s.edge.waypoint;
    return range1d(pts[s.index][rangeAxis], pts[s.index + 1][rangeAxis]);
  });
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (Math.max(ranges[i][0], ranges[j][0]) < Math.min(ranges[i][1], ranges[j][1])) return true;
    }
  }
  return false;
}

/** Finds groups of same-axis, same-coordinate, range-overlapping segments belonging to 2+ different edges. */
export function findConflictGroups(edges: any[]): ConflictGroup[] {
  const vGroups = new Map<number, SegRef[]>();
  const hGroups = new Map<number, SegRef[]>();

  for (const edge of edges) {
    const pts: any[] = edge.waypoint;
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < WAYPOINT_DEDUP_EPSILON && dy >= WAYPOINT_DEDUP_EPSILON) {
        const key = Math.round(a.x);
        if (!vGroups.has(key)) vGroups.set(key, []);
        vGroups.get(key)!.push({ edge, index: i });
      } else if (dy < WAYPOINT_DEDUP_EPSILON && dx >= WAYPOINT_DEDUP_EPSILON) {
        const key = Math.round(a.y);
        if (!hGroups.has(key)) hGroups.set(key, []);
        hGroups.get(key)!.push({ edge, index: i });
      }
    }
  }

  const result: ConflictGroup[] = [];
  for (const segs of vGroups.values()) {
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    if (!anyPairOverlaps(segs, 'y')) continue;
    result.push({ axis: 'x', segs });
  }
  for (const segs of hGroups.values()) {
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    if (!anyPairOverlaps(segs, 'x')) continue;
    result.push({ axis: 'y', segs });
  }
  return result;
}

/**
 * Shifts one conflicting segment by `offset` on its perpendicular axis
 * (`perp`). If the segment touches the edge's real source/target dock point
 * (waypoint[0] or the last waypoint — the actual connection to the shape),
 * that point is never moved; instead a short jog is inserted next to it so
 * the path detours into its new lane and back, keeping every segment
 * orthogonal and every dock connection exactly where it was.
 */
/**
 * Shifts one conflicting segment by `offset` on its perpendicular axis
 * (`perp`) — but only when BOTH endpoints are interior elbow points. A
 * segment touching the edge's real source/target dock point is left
 * untouched: resolving that case requires inserting a jog right next to the
 * dock, which live user testing confirmed reads as a rendering glitch (an
 * odd little hook right at the shape) rather than intentional routing, even
 * after widening the jog distance — worse than the overlap it was meant to
 * fix. Two flows briefly overlapping right at a shared gateway exit before
 * diverging is normal, broadly-accepted BPMN notation; left alone here by
 * deliberate choice, not an oversight.
 */
function shiftSegment(edge: any, i: number, perp: 'x' | 'y', offset: number): void {
  if (Math.abs(offset) < 0.01) return;
  const pts: any[] = edge.waypoint;
  const j = i + 1;
  if (i === 0 || j === pts.length - 1) return;
  pts[i][perp] += offset;
  pts[j][perp] += offset;
}

function applyGroupOffsets(group: ConflictGroup): void {
  const uniqueEdges = Array.from(new Set(group.segs.map((s) => s.edge)))
    .sort((a, b) => String(a.bpmnElement.id).localeCompare(String(b.bpmnElement.id)));
  const n = uniqueEdges.length;
  const offsetByEdge = new Map<any, number>();
  uniqueEdges.forEach((edge, k) => offsetByEdge.set(edge, (k - (n - 1) / 2) * CROSSING_LANE_SPACING));

  for (const seg of group.segs) {
    const offset = offsetByEdge.get(seg.edge)!;
    shiftSegment(seg.edge, seg.index, group.axis, offset);
  }
}

/**
 * Best-effort resolution of same-axis overlapping/coincident INTERIOR
 * segments (both endpoints are elbow points, neither is a real dock
 * connection) belonging to different edges — a clean, artifact-free parallel
 * offset, no new corners needed.
 *
 * Deliberately does NOT touch dock-anchored conflicts (a segment touching an
 * edge's actual source/target connection point) — live user testing
 * confirmed that inserting a jog next to a shared dock point reads as a
 * rendering glitch (an odd little hook right at the shape), even after
 * widening it, worse than the overlap it was meant to fix. Two flows briefly
 * overlapping right at a shared gateway exit before diverging is normal,
 * broadly-accepted BPMN notation — left alone by deliberate choice.
 *
 * Also does not attempt to resolve true perpendicular crossings — a much
 * harder routing problem, and not what was actually observed.
 */
export function routeAwayOverlaps(edges: any[]): void {
  const groups = findConflictGroups(edges);
  const mutated = new Set<any>();
  for (const group of groups) {
    const segs = group.segs.filter((s) => !mutated.has(s.edge));
    if (new Set(segs.map((s) => s.edge)).size < 2) continue;
    applyGroupOffsets({ axis: group.axis, segs });
    for (const s of segs) mutated.add(s.edge);
  }
}

/** Real Canvas text measurement in the renderer; a deterministic per-character estimate when no `document` exists (vitest's default Node environment) — same font-size assumption either way, just not pixel-exact in tests. */
function measureTextWidth(text: string, fontSize: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.55;
  const w = measureTextWidth as any;
  if (!w._canvas) w._canvas = document.createElement('canvas');
  const ctx = w._canvas.getContext('2d');
  ctx.font = `${fontSize}px Arial, sans-serif`;
  return ctx.measureText(text).width;
}

/** Wraps text to maxWidth using real measured widths, breaking only at word boundaries — the previous character-count heuristic was the confirmed root cause of mid-word wraps. */
export function wrapLabelText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function labelRectFor(lines: string[], centerX: number, top: number): Rect {
  const width = Math.min(LABEL_MAX_WIDTH, Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) + 4);
  const height = lines.length * LABEL_LINE_HEIGHT;
  return { x: centerX - width / 2, y: top, width, height };
}

/** Picks the first candidate rect that doesn't intersect any edge segment; falls back to the first (default) candidate if none are clear — best-effort, not exhaustive search. */
function pickClearRect(candidates: Rect[], edges: any[], extraObstacles: Rect[] = []): Rect {
  for (const rect of candidates) {
    let hits = extraObstacles.some((o) => rectsOverlap(rect, o));
    for (const edge of edges) {
      if (hits) break;
      const pts: any[] = edge.waypoint;
      for (let i = 0; i < pts.length - 1 && !hits; i++) {
        if (segmentIntersectsRect(pts[i], pts[i + 1], rect, 0)) hits = true;
      }
    }
    if (!hits) return rect;
  }
  return candidates[0];
}

const EXTERNAL_LABEL_TYPES = /Event$|Gateway$/;

type Side = 'top' | 'bottom' | 'left' | 'right';
const SIDE_PREFERENCE: Side[] = ['bottom', 'top', 'right', 'left'];

function sideFromDelta(dx: number, dy: number): Side {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Which cardinal sides of a shape already have a connected edge touching them. */
function getTakenSides(shapeId: string, edges: any[]): Set<Side> {
  const taken = new Set<Side>();
  for (const edge of edges) {
    const bo = edge.bpmnElement;
    const pts: any[] = edge.waypoint;
    if (!pts || pts.length < 2) continue;
    if (bo.sourceRef?.id === shapeId) {
      taken.add(sideFromDelta(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
    }
    if (bo.targetRef?.id === shapeId) {
      const n = pts.length;
      taken.add(sideFromDelta(pts[n - 2].x - pts[n - 1].x, pts[n - 2].y - pts[n - 1].y));
    }
  }
  return taken;
}

/** For a boundary event, the side facing its host shape — that side isn't "taken" by a connector, but placing a label there lands it inside/overlapping the host box, which is just as wrong. */
function hostFacingSide(shape: any, shapes: any[]): Side | undefined {
  const hostRef = shape.bpmnElement.attachedToRef;
  if (!hostRef) return undefined;
  const host = shapes.find((s: any) => s.bpmnElement.id === hostRef.id);
  if (!host) return undefined;
  const b = shape.bounds, h = host.bounds;
  const shapeMidX = b.x + b.width / 2, shapeMidY = b.y + b.height / 2;
  const hostMidX = h.x + h.width / 2, hostMidY = h.y + h.height / 2;
  return sideFromDelta(hostMidX - shapeMidX, hostMidY - shapeMidY);
}

/** First side (in preference order) with no connected edge and no host shape in the way; falls back to the preferred default if every side is unusable — best-effort, not silently broken. */
function pickLabelSide(shapeId: string, edges: any[], excludeSide?: Side): Side {
  const taken = getTakenSides(shapeId, edges);
  if (excludeSide) taken.add(excludeSide);
  for (const side of SIDE_PREFERENCE) {
    if (!taken.has(side)) return side;
  }
  return SIDE_PREFERENCE[0];
}

function labelRectForSide(side: Side, b: Rect, lines: string[]): Rect {
  const width = Math.min(LABEL_MAX_WIDTH, Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) + 4);
  const height = lines.length * LABEL_LINE_HEIGHT;
  switch (side) {
    case 'bottom': return { x: b.x + b.width / 2 - width / 2, y: b.y + b.height + LABEL_CLEARANCE, width, height };
    case 'top': return { x: b.x + b.width / 2 - width / 2, y: b.y - LABEL_CLEARANCE - height, width, height };
    case 'right': return { x: b.x + b.width + LABEL_CLEARANCE, y: b.y + b.height / 2 - height / 2, width, height };
    case 'left': return { x: b.x - LABEL_CLEARANCE - width, y: b.y + b.height / 2 - height / 2, width, height };
  }
}

/** Secondary nudge candidates along the chosen side, for a final micro-adjustment if the primary position still collides with something. */
function nudgeCandidates(base: Rect, side: Side): Rect[] {
  if (side === 'bottom' || side === 'top') {
    return [base, { ...base, x: base.x - base.width - LABEL_CLEARANCE }, { ...base, x: base.x + base.width + LABEL_CLEARANCE }];
  }
  return [base, { ...base, y: base.y - base.height - LABEL_CLEARANCE }, { ...base, y: base.y + base.height + LABEL_CLEARANCE }];
}

/** Index of the longest segment in an edge's waypoints — used as the representative segment for label placement so a tiny stub/jog segment is never picked over a genuinely long, visually central one. */
function longestSegmentIndex(pts: any[]): number {
  let bestIdx = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i].x - pts[i + 1].x) + Math.abs(pts[i].y - pts[i + 1].y);
    if (len > bestLen) { bestLen = len; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Authors `bpmndi:BPMNLabel` elements from scratch — bpmn-auto-layout emits
 * none at all, so without this bpmn-js falls back to its own default
 * placement, which produced the confirmed mid-word wraps and label/line
 * overlaps. Task-family shapes render their name inline within the shape
 * bounds by default and are deliberately left alone here.
 */
export function authorLabels(shapes: any[], edges: any[], moddle: any): void {
  for (const shape of shapes) {
    const bo = shape.bpmnElement;
    if (!bo?.name || !EXTERNAL_LABEL_TYPES.test(bo.$type)) continue;
    const b = shape.bounds;
    const lines = wrapLabelText(bo.name, LABEL_MAX_WIDTH, LABEL_FONT_SIZE);
    const host = bo.attachedToRef ? shapes.find((s: any) => s.bpmnElement.id === bo.attachedToRef.id) : undefined;
    const side = pickLabelSide(bo.id, edges, hostFacingSide(shape, shapes));
    const base = labelRectForSide(side, b, lines);
    const rect = pickClearRect(nudgeCandidates(base, side), edges, host ? [{ x: host.bounds.x, y: host.bounds.y, width: host.bounds.width, height: host.bounds.height }] : []);

    const bounds = moddle.create('dc:Bounds', rect);
    const label = moddle.create('bpmndi:BPMNLabel', { bounds });
    bounds.$parent = label;
    label.$parent = shape;
    shape.label = label;
  }

  for (const edge of edges) {
    const bo = edge.bpmnElement;
    if (!bo?.name) continue;
    const pts: any[] = edge.waypoint;
    const mid = longestSegmentIndex(pts);
    const a = pts[mid], b = pts[mid + 1];
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const horizontal = Math.abs(a.y - b.y) < WAYPOINT_DEDUP_EPSILON;

    const lines = wrapLabelText(bo.name, LABEL_MAX_WIDTH, LABEL_FONT_SIZE);
    let base: Rect;
    let candidates: Rect[];
    if (horizontal) {
      base = labelRectFor(lines, midX, midY - LABEL_CLEARANCE - lines.length * LABEL_LINE_HEIGHT);
      candidates = [base, { ...base, y: midY + LABEL_CLEARANCE }];
    } else {
      base = labelRectFor(lines, midX + LABEL_CLEARANCE + Math.max(...lines.map((l) => measureTextWidth(l, LABEL_FONT_SIZE))) / 2, midY - (lines.length * LABEL_LINE_HEIGHT) / 2);
      candidates = [base, { ...base, x: base.x - 2 * (base.x - midX) - base.width }];
    }
    const rect = pickClearRect(candidates, edges);

    const bounds = moddle.create('dc:Bounds', rect);
    const label = moddle.create('bpmndi:BPMNLabel', { bounds });
    bounds.$parent = label;
    label.$parent = edge;
    edge.label = label;
  }
}

/** Runs the full Phase 2 pass on parsed (post-layoutProcess) DI, in the required order. */
export function postProcessLayout(shapes: any[], edges: any[], moddle: any): void {
  dedupEdgeWaypoints(edges);
  routeAwayOverlaps(edges);
  authorLabels(shapes, edges, moddle);
}

/** Parses layoutProcess's raw XML, runs the Phase 2 pass, and re-serializes — shared by both call sites. */
export async function applyPostProcessing(rawLaidOutXml: string, moddle: any): Promise<string> {
  const { rootElement: laidOutDefs } = await moddle.fromXML(rawLaidOutXml);
  const planeElements: any[] = laidOutDefs.diagrams?.[0]?.plane?.planeElement || [];
  const shapes = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNShape');
  const edges = planeElements.filter((pe: any) => pe.$type === 'bpmndi:BPMNEdge');
  postProcessLayout(shapes, edges, moddle);
  const { xml } = await moddle.toXML(laidOutDefs, { format: false });
  return xml;
}
