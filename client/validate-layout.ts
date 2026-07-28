import type { BpmnServices, Rect } from './element-shared';
import { rectsOverlap, segmentIntersectsRect } from './element-shared';
import { dispatchRendererTool, moveElement, setFlowWaypoints, resizeElement } from './bpmn-tools';

/* ------------------------------------------------------------------ */
/*  validate_layout — layout advisory and auto-fix                    */
/* ------------------------------------------------------------------ */

interface LayoutIssue {
  severity: 'error' | 'warning' | 'suggestion';
  type: string;
  elementIds: string[];
  message: string;
  fix?: { tool: string; params: Record<string, unknown> } | null;
}

function elRect(el: any): Rect {
  return { x: el.x, y: el.y, width: el.width || 0, height: el.height || 0 };
}

function elCenter(el: any): { x: number; y: number } {
  return { x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) / 2 };
}

function isInsideRect(child: Rect, parent: Rect, pad = 0): boolean {
  return child.x >= parent.x + pad
      && child.y >= parent.y + pad
      && child.x + child.width <= parent.x + parent.width - pad
      && child.y + child.height <= parent.y + parent.height - pad;
}

function segmentIsOrthogonal(p1: { x: number; y: number }, p2: { x: number; y: number }, tolerance = 3): boolean {
  return Math.abs(p1.x - p2.x) <= tolerance || Math.abs(p1.y - p2.y) <= tolerance;
}

function elName(el: any): string {
  return el.businessObject?.name || el.id;
}

export async function validateLayout(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { elementRegistry, modeling, canvas } = services;
  const scopeId = params.elementId as string | undefined;
  const autoFix = (params.autoFix as boolean) || false;
  const minSeverity = (params.severity as string) || 'warning';

  // Wait for the rendering engine to finish positioning all elements.
  // Boundary events in particular get default coordinates (e.g. 96, 58) on
  // creation and are only moved to the host's perimeter during the next
  // render cycle. Without this wait, we'd read stale default positions.
  await new Promise<void>(r => setTimeout(r, 50));

  /**
   * Resolve an element to its rendered diagram shape with correct absolute
   * coordinates. For boundary events, compute absolute position from the
   * host element since the shape's own x/y may still hold stale defaults
   * from creation (before the renderer repositioned it on the host perimeter).
   */
  const resolve = (el: any): any => {
    if (!el?.id) return el;
    const fresh = elementRegistry.get(el.id);
    if (!fresh) return el;
    // Boundary events: if position looks like defaults (small x/y far from host),
    // compute from the host element's actual position instead.
    if (fresh.type === 'bpmn:BoundaryEvent') {
      // Always compute boundary event position from host element.
      // The shape's own x/y may hold stale defaults from creation time.
      const hostRef = fresh.host
        || (fresh.businessObject?.attachedToRef && elementRegistry.get(fresh.businessObject.attachedToRef.id))
        || fresh.parent;
      const host = hostRef?.id ? (elementRegistry.get(hostRef.id) || hostRef) : hostRef;
      if (host && host.width && host.height) {
        const corrected = { ...fresh };
        corrected.x = host.x + host.width / 2 - (fresh.width || 36) / 2;
        corrected.y = host.y + host.height - (fresh.height || 36) / 2;
        return corrected;
      }
    }
    return fresh;
  };

  const severityOrder: Record<string, number> = { error: 0, warning: 1, suggestion: 2 };
  const minLevel = severityOrder[minSeverity] ?? 1;

  // Gather shapes and connections within scope.
  // Resolve every element through elementRegistry.get() to get the latest
  // rendered coordinates (especially important for boundary events).
  const allElements: any[] = elementRegistry.getAll();
  const shapes = allElements
    .filter((el: any) => {
      if (!el.type || el.type.startsWith('bpmndi:') || el.type === 'label') return false;
      if (el.waypoints) return false;
      if (scopeId && el.parent?.id !== scopeId && el.id !== scopeId) return false;
      return true;
    })
    .map((el: any) => resolve(el));
  const connections = allElements
    .filter((el: any) => {
      if (!el.waypoints) return false;
      if (scopeId) {
        const src = resolve(el.source), tgt = resolve(el.target);
        const srcInScope = src?.parent?.id === scopeId || src?.id === scopeId;
        const tgtInScope = tgt?.parent?.id === scopeId || tgt?.id === scopeId;
        if (!srcInScope && !tgtInScope) return false;
      }
      return true;
    })
    .map((el: any) => resolve(el));

  const issues: LayoutIssue[] = [];

  // ── ERRORS ─────────────────────────────────────────────────────────

  // 1. outside_parent — element outside its parent subprocess/pool bounds
  //    Skip root process / collaboration — they have no meaningful visual bounds
  for (const el of shapes) {
    const parent = resolve(el.parent);
    if (!parent || !parent.width) continue;
    // Root process and collaboration elements aren't visual containers
    const parentType = parent.type || parent.businessObject?.$type;
    if (parentType === 'bpmn:Process' || parentType === 'bpmn:Collaboration') continue;
    if (el.type === 'bpmn:BoundaryEvent') continue;
    const cr = elRect(el);
    const pr = elRect(parent);
    if (!isInsideRect(cr, pr)) {
      const cc = elCenter(el);
      const fixX = Math.max(pr.x + 40, Math.min(cc.x, pr.x + pr.width - 40));
      const fixY = Math.max(pr.y + 40, Math.min(cc.y, pr.y + pr.height - 40));
      issues.push({
        severity: 'error', type: 'outside_parent',
        elementIds: [el.id],
        message: `'${elName(el)}' is outside parent '${elName(parent)}'`,
        fix: { tool: 'move_element', params: { elementId: el.id, x: Math.round(fixX), y: Math.round(fixY) } },
      });
    }
  }

  // 2. overlap — two shapes occupy the same space
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (!a.width || !b.width) continue;
      // Skip parent-child pairs (children are inside parent by design)
      if (a.parent === b || b.parent === a) continue;
      if (a.type === 'bpmn:BoundaryEvent' || b.type === 'bpmn:BoundaryEvent') continue;
      const ar = elRect(a), br = elRect(b);
      if (rectsOverlap(ar, br)) {
        const bc = elCenter(b);
        issues.push({
          severity: 'error', type: 'overlap',
          elementIds: [a.id, b.id],
          message: `'${elName(a)}' overlaps with '${elName(b)}'`,
          fix: { tool: 'move_element', params: { elementId: b.id, x: bc.x + 150, y: bc.y } },
        });
      }
    }
  }

  // 3. disconnected_flow — waypoints don't connect to source/target edges
  //    Always resolve source/target via elementRegistry to get absolute canvas
  //    coordinates (conn.source can hold stale/relative coords for boundary events).
  for (const conn of connections) {
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    if (!src || !tgt) continue;
    const srcRect = elRect(src);
    const tgtRect = elRect(tgt);
    const firstWp = wps[0];
    const lastWp = wps[wps.length - 1];
    const srcDist = distToRect(firstWp, srcRect);
    const tgtDist = distToRect(lastWp, tgtRect);
    if (srcDist > 20 || tgtDist > 20) {
      const srcC = elCenter(src);
      const tgtC = elCenter(tgt);
      issues.push({
        severity: 'error', type: 'disconnected_flow',
        elementIds: [conn.id],
        message: `Flow '${elName(conn)}' waypoints don't connect to source/target edges`,
        fix: { tool: 'set_flow_waypoints', params: {
          flowId: conn.id,
          waypoints: [{ x: Math.round(srcC.x + (srcRect.width || 0) / 2), y: Math.round(srcC.y) }, { x: Math.round(tgtC.x - (tgtRect.width || 0) / 2), y: Math.round(tgtC.y) }]
        }},
      });
    }
  }

  // ── WARNINGS ───────────────────────────────────────────────────────

  // 4. diagonal_flow — non-orthogonal segments
  for (const conn of connections) {
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    let hasDiagonal = false;
    for (let k = 0; k < wps.length - 1; k++) {
      if (!segmentIsOrthogonal(wps[k], wps[k + 1])) { hasDiagonal = true; break; }
    }
    if (hasDiagonal) {
      // Generate orthogonal routing — resolve via registry for correct coords
      const src = resolve(conn.source);
      const tgt = resolve(conn.target);
      if (!src || !tgt) continue;
      const srcC = elCenter(src), tgtC = elCenter(tgt);
      const srcRight = src.x + (src.width || 0);
      const tgtLeft = tgt.x;
      const midX = (srcRight + tgtLeft) / 2;
      issues.push({
        severity: 'warning', type: 'diagonal_flow',
        elementIds: [conn.id],
        message: `Flow from '${elName(src)}' to '${elName(tgt)}' has diagonal routing`,
        fix: { tool: 'set_flow_waypoints', params: {
          flowId: conn.id,
          waypoints: srcC.y === tgtC.y
            ? [{ x: srcRight, y: srcC.y }, { x: tgtLeft, y: tgtC.y }]
            : [{ x: srcRight, y: srcC.y }, { x: midX, y: srcC.y }, { x: midX, y: tgtC.y }, { x: tgtLeft, y: tgtC.y }],
        }},
      });
    }
  }

  // 5. subprocess_too_small — expanded subprocess doesn't contain children
  for (const el of shapes) {
    const bo = el.businessObject;
    if (bo?.$type !== 'bpmn:SubProcess') continue;
    const isExpanded = el.isExpanded ?? el.di?.isExpanded ?? false;
    if (!isExpanded) continue;
    const children = (el.children || []).map((c: any) => resolve(c)).filter((c: any) => c.type !== 'label' && !c.waypoints);
    if (children.length === 0) continue;
    const pr = elRect(el);
    let allInside = true;
    for (const child of children) {
      if (!isInsideRect(elRect(child), pr)) { allInside = false; break; }
    }
    if (!allInside) {
      // Calculate required bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of children) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
        maxX = Math.max(maxX, child.x + (child.width || 36));
        maxY = Math.max(maxY, child.y + (child.height || 36));
      }
      const padding = 50;
      const newW = Math.max(pr.width, (maxX - minX) + padding * 2);
      const newH = Math.max(pr.height, (maxY - minY) + padding * 2);
      issues.push({
        severity: 'warning', type: 'subprocess_too_small',
        elementIds: [el.id],
        message: `Subprocess '${elName(el)}' does not fully contain its children`,
        fix: { tool: 'resize_element', params: { elementId: el.id, width: Math.ceil(newW), height: Math.ceil(newH) } },
      });
    }
  }

  // 5b. stale_boundary_flow — boundary event flows with stale waypoints
  //     After build_process, boundary events are positioned correctly but
  //     their outgoing flows retain the default creation-time waypoints.
  //     Detect and fix these before the general flow_crosses_element check.
  const staleBoundaryFlowIds = new Set<string>();
  for (const conn of connections) {
    const src = conn.source ? elementRegistry.get(conn.source.id) : null;
    if (!src || src.type !== 'bpmn:BoundaryEvent') continue;
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    // Check if first waypoint is far from the boundary event's actual position
    const firstWp = wps[0];
    const srcRect = elRect(resolve(conn.source));
    if (distToRect(firstWp, srcRect) > 50) {
      // Stale waypoints — generate fix from host-computed position
      const resolvedSrc = resolve(conn.source);
      const resolvedTgt = resolve(conn.target);
      if (resolvedSrc && resolvedTgt) {
        const beCenterX = resolvedSrc.x + (resolvedSrc.width || 36) / 2;
        const beBottom = resolvedSrc.y + (resolvedSrc.height || 36);
        const tgtCenterY = resolvedTgt.y + (resolvedTgt.height || 80) / 2;
        const tgtLeft = resolvedTgt.x;
        staleBoundaryFlowIds.add(conn.id);
        issues.push({
          severity: 'error', type: 'stale_boundary_flow',
          elementIds: [conn.id],
          message: `Flow from boundary event '${elName(resolvedSrc)}' has stale waypoints`,
          fix: { tool: 'set_flow_waypoints', params: {
            flowId: conn.id,
            waypoints: [
              { x: Math.round(beCenterX), y: Math.round(beBottom) },
              { x: Math.round(beCenterX), y: Math.round(tgtCenterY) },
              { x: Math.round(tgtLeft), y: Math.round(tgtCenterY) },
            ],
          }},
        });
      }
    }
  }

  // 6. flow_crosses_element — a flow routes through an unrelated element
  for (const conn of connections) {
    if (staleBoundaryFlowIds.has(conn.id)) continue; // Already handled above
    const wps = conn.waypoints;
    if (!wps || wps.length < 2) continue;
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    const srcId = src?.id, tgtId = tgt?.id;
    for (const shape of shapes) {
      if (!shape.width || shape.id === srcId || shape.id === tgtId) continue;
      if (shape.parent === src || shape.parent === tgt) continue;
      if (shape.businessObject?.$type === 'bpmn:SubProcess' || shape.type === 'bpmn:Participant') continue;
      const rect = elRect(shape);
      let crosses = false;
      for (let k = 0; k < wps.length - 1; k++) {
        if (segmentIntersectsRect(wps[k], wps[k + 1], rect)) { crosses = true; break; }
      }
      if (crosses && src && tgt) {
        // Compute orthogonal waypoints that route around the obstruction
        const srcC = elCenter(src);
        const tgtC = elCenter(tgt);
        const srcRight = src.x + (src.width || 36);
        const tgtLeft = tgt.x;
        const pad = 20;
        const obstTop = rect.y - pad;
        const obstBottom = rect.y + rect.height + pad;

        // Decide: route above or below based on which side has more space
        const spaceAbove = Math.abs(srcC.y - obstTop);
        const spaceBelow = Math.abs(obstBottom - srcC.y);
        const routeY = spaceAbove <= spaceBelow ? obstTop : obstBottom;
        const midX = (srcRight + tgtLeft) / 2;

        const fixWaypoints = [
          { x: srcRight, y: srcC.y },
          { x: midX, y: srcC.y },
          { x: midX, y: routeY },
          { x: midX + (tgtLeft - srcRight) / 4, y: routeY },
          { x: midX + (tgtLeft - srcRight) / 4, y: tgtC.y },
          { x: tgtLeft, y: tgtC.y },
        ];

        issues.push({
          severity: 'warning', type: 'flow_crosses_element',
          elementIds: [conn.id, shape.id],
          message: `Flow '${elName(conn)}' routes through '${elName(shape)}'`,
          fix: { tool: 'set_flow_waypoints', params: { flowId: conn.id, waypoints: fixWaypoints.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) } },
        });
        break;
      }
    }
  }

  // 7. label_overlap — flow label overlaps with a shape
  for (const conn of connections) {
    const label = conn.label;
    if (!label || !label.width) continue;
    const lr = elRect(label);
    for (const shape of shapes) {
      if (!shape.width) continue;
      if (rectsOverlap(lr, elRect(shape))) {
        issues.push({
          severity: 'warning', type: 'label_overlap',
          elementIds: [conn.id, shape.id],
          message: `Label on flow '${elName(conn)}' overlaps with '${elName(shape)}'`,
          fix: null,
        });
        break;
      }
    }
  }

  // ── SUGGESTIONS ────────────────────────────────────────────────────

  // 8. misaligned — connected elements with nearly-matching y (or x) coordinates
  const ALIGN_TOLERANCE = 8;
  for (const conn of connections) {
    const src = resolve(conn.source);
    const tgt = resolve(conn.target);
    if (!src || !tgt || !src.width || !tgt.width) continue;
    const srcC = elCenter(src), tgtC = elCenter(tgt);
    const dy = Math.abs(srcC.y - tgtC.y);
    if (dy > 0 && dy <= ALIGN_TOLERANCE) {
      const alignY = Math.round((srcC.y + tgtC.y) / 2);
      issues.push({
        severity: 'suggestion', type: 'misaligned',
        elementIds: [src.id, tgt.id],
        message: `'${elName(src)}' (y=${Math.round(srcC.y)}) and '${elName(tgt)}' (y=${Math.round(tgtC.y)}) should align at y=${alignY}`,
        fix: { tool: 'batch_operations', params: { diagramId: '', operations: [
          { tool: 'move_element', params: { elementId: src.id, x: srcC.x, y: alignY } },
          { tool: 'move_element', params: { elementId: tgt.id, x: tgtC.x, y: alignY } },
        ]}},
      });
    }
  }

  // 9. cramped — elements less than 30px apart
  const CRAMPED_THRESHOLD = 30;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (!a.width || !b.width) continue;
      if (a.parent === b || b.parent === a) continue;
      if (a.parent !== b.parent) continue; // only compare siblings
      const gap = gapBetween(elRect(a), elRect(b));
      if (gap >= 0 && gap < CRAMPED_THRESHOLD) {
        const bc = elCenter(b);
        const shift = CRAMPED_THRESHOLD - gap + 10;
        const moveX = bc.x + (b.x >= a.x + (a.width || 0) ? shift : 0);
        const moveY = bc.y + (b.y >= a.y + (a.height || 0) ? shift : 0);
        issues.push({
          severity: 'suggestion', type: 'cramped',
          elementIds: [a.id, b.id],
          message: `'${elName(a)}' and '${elName(b)}' are only ${Math.round(gap)}px apart`,
          fix: { tool: 'move_element', params: { elementId: b.id, x: Math.round(moveX), y: Math.round(moveY) } },
        });
      }
    }
  }

  // 10. uneven_spacing — sequential elements with inconsistent gaps
  const SPACING_TOLERANCE = 15;
  for (const el of shapes) {
    const outgoing = (el.outgoing || [])
      .map((c: any) => resolve(c.target))
      .filter((t: any) => t && t.width);
    if (outgoing.length < 2) continue;
    // Sort targets by x position
    outgoing.sort((a: any, b: any) => a.x - b.x);
    // Check vertical spacing between branches
    for (let k = 0; k < outgoing.length - 1; k++) {
      const t1 = outgoing[k], t2 = outgoing[k + 1];
      const gap1 = t2.y - (t1.y + (t1.height || 0));
      // Just report if branches exist but don't have consistent spacing
      if (outgoing.length >= 2 && k === 0) {
        const gaps: number[] = [];
        for (let m = 0; m < outgoing.length - 1; m++) {
          gaps.push(Math.abs(elCenter(outgoing[m + 1]).y - elCenter(outgoing[m]).y));
        }
        const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const uneven = gaps.some(g => Math.abs(g - avgGap) > SPACING_TOLERANCE);
        if (uneven && gaps.length >= 2) {
          issues.push({
            severity: 'suggestion', type: 'uneven_spacing',
            elementIds: outgoing.map((t: any) => t.id),
            message: `Targets of '${elName(el)}' have uneven vertical spacing`,
            fix: null,
          });
        }
        break; // Only check once per source element
      }
    }
  }

  // 11. branch_not_fanned — gateway branches all at same y
  //     Skip loop-back flows (target x <= gateway x)
  for (const el of shapes) {
    if (!el.type?.includes('Gateway')) continue;
    const gwC = elCenter(el);
    const targets = (el.outgoing || [])
      .map((c: any) => resolve(c.target))
      .filter((t: any) => t && t.width)
      .filter((t: any) => elCenter(t).x > gwC.x); // exclude loop-backs
    if (targets.length < 2) continue;
    const ys = targets.map((t: any) => elCenter(t).y);
    const allSameY = ys.every((y: number) => Math.abs(y - ys[0]) < 5);
    if (allSameY) {
      const fanSpacing = 120;
      const startY = gwC.y - ((targets.length - 1) * fanSpacing) / 2;
      const ops = targets.map((t: any, idx: number) => ({
        tool: 'move_element',
        params: { elementId: t.id, x: elCenter(t).x, y: Math.round(startY + idx * fanSpacing) },
      }));
      issues.push({
        severity: 'suggestion', type: 'branch_not_fanned',
        elementIds: [el.id, ...targets.map((t: any) => t.id)],
        message: `Gateway '${elName(el)}' branches all at y=${Math.round(ys[0])} — should fan out vertically`,
        fix: { tool: 'batch_operations', params: { diagramId: '', operations: ops } },
      });
    }
  }

  // 12. orphaned_annotation — annotation far from its associated element
  for (const conn of connections) {
    if (conn.type !== 'bpmn:Association') continue;
    const rSrc = resolve(conn.source), rTgt = resolve(conn.target);
    const annotation = rSrc?.type === 'bpmn:TextAnnotation' ? rSrc : rTgt;
    const assocEl = rSrc?.type === 'bpmn:TextAnnotation' ? rTgt : rSrc;
    if (!annotation || !assocEl || !annotation.width || !assocEl.width) continue;
    const dist = Math.hypot(
      elCenter(annotation).x - elCenter(assocEl).x,
      elCenter(annotation).y - elCenter(assocEl).y,
    );
    if (dist > 300) {
      const ac = elCenter(assocEl);
      issues.push({
        severity: 'suggestion', type: 'orphaned_annotation',
        elementIds: [annotation.id, assocEl.id],
        message: `Annotation '${elName(annotation)}' is ${Math.round(dist)}px from '${elName(assocEl)}'`,
        fix: { tool: 'move_element', params: { elementId: annotation.id, x: Math.round(ac.x), y: Math.round(ac.y - 80) } },
      });
    }
  }

  // ── FILTER BY SEVERITY ─────────────────────────────────────────────

  const filtered = issues.filter(i => severityOrder[i.severity] <= minLevel);

  // ── AUTO-FIX ───────────────────────────────────────────────────────

  let fixesApplied = 0;
  if (autoFix) {
    for (const issue of filtered) {
      if (!issue.fix) continue;
      try {
        const { tool, params: fixParams } = issue.fix;
        // Validate fix params — skip if any coordinate is null/undefined/NaN
        if (tool === 'move_element') {
          if (fixParams.x == null || fixParams.y == null || isNaN(fixParams.x as number) || isNaN(fixParams.y as number)) continue;
        }
        if (tool === 'resize_element') {
          if (fixParams.width == null || fixParams.height == null) continue;
        }
        if (tool === 'set_flow_waypoints') {
          const wps = fixParams.waypoints as any[];
          if (!wps || wps.some((wp: any) => wp.x == null || wp.y == null)) continue;
        }
        if (tool === 'move_element') {
          moveElement(fixParams, services);
          fixesApplied++;
        } else if (tool === 'set_flow_waypoints') {
          setFlowWaypoints(fixParams, services);
          fixesApplied++;
        } else if (tool === 'resize_element') {
          resizeElement(fixParams, services);
          fixesApplied++;
        } else if (tool === 'batch_operations') {
          const ops = (fixParams.operations as any[]) || [];
          for (const op of ops) {
            await dispatchRendererTool(op.tool, op.params, services);
          }
          fixesApplied++;
        }
      } catch {
        // Best-effort: skip individual fix failures
      }
    }
  }

  const result: any = {
    issueCount: filtered.length,
    issues: filtered,
  };
  if (autoFix) {
    result.fixesApplied = fixesApplied;
  }
  return result;
}

/** Minimum distance from a point to the perimeter of a rectangle */
function distToRect(p: { x: number; y: number }, rect: Rect): number {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.height));
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Minimum gap between two non-overlapping rects (0 if touching, negative if overlapping) */
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  if (dx === 0 && dy === 0) return -1; // overlapping
  return Math.hypot(dx, dy);
}
