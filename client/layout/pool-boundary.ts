import { type Rect, type BpmnServices, bboxOfShapes, POOL_PADDING } from '../element-shared';

/**
 * How far `originalPool` could grow in each direction before colliding with
 * any of `originalSiblings`, plus `minGap` — #14. Takes each pool's
 * *original* (pre-growth) rect rather than its current one: once a pool has
 * already grown into an overlap, "is this sibling entirely above me" can go
 * ambiguous against the current (already-overlapping) bounds, but is always
 * well-defined against where things stood before anything grew. General 2D
 * collision, not a hardcoded "pools always stack vertically" assumption — a
 * sibling only constrains a direction when its range overlaps the pool's
 * range on the *other* axis (e.g. a sibling purely above only limits upward
 * growth if their X ranges overlap too).
 */
export function computeGrowthEnvelope(
  originalPool: Rect,
  originalSiblings: Rect[],
  minGap: number = POOL_PADDING,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity;
  const pTop = originalPool.y, pBottom = originalPool.y + originalPool.height;
  const pLeft = originalPool.x, pRight = originalPool.x + originalPool.width;
  for (const s of originalSiblings) {
    const sTop = s.y, sBottom = s.y + s.height, sLeft = s.x, sRight = s.x + s.width;
    const xOverlap = pLeft < sRight && pRight > sLeft;
    const yOverlap = pTop < sBottom && pBottom > sTop;
    if (xOverlap) {
      if (sBottom <= pTop) minY = Math.max(minY, sBottom + minGap);
      if (sTop >= pBottom) maxY = Math.min(maxY, sTop - minGap);
    }
    if (yOverlap) {
      if (sRight <= pLeft) minX = Math.max(minX, sRight + minGap);
      if (sLeft >= pRight) maxX = Math.min(maxX, sLeft - minGap);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Recursively collects every real shape/connection inside `container` via
 * diagram-js's `.children` tree (the same containment relationship already
 * relied on via `.parent` walks elsewhere in this file, just inverted) —
 * used to check whether a pool's actual content still fits inside a
 * candidate clamped boundary (#14). Works against plain fake objects
 * (`{x,y,width,height,type,children}`) too, no live elementRegistry needed,
 * so it's unit-testable the same way as this file's other pure helpers.
 */
export function collectDescendantShapes(container: any): any[] {
  const result: any[] = [];
  for (const child of container.children || []) {
    if (child.x !== undefined && child.type !== 'label') result.push(child);
    if (child.children?.length) result.push(...collectDescendantShapes(child));
  }
  return result;
}

/**
 * Walks up from `elementId` to its nearest `bpmn:Participant` (pool)
 * ancestor and, if that pool's current bounds now extend past the safe
 * envelope relative to sibling pools' *original* positions, clamps it back
 * — but only when the pool's own actual content still fits inside the
 * clamped bounds. Never touches a sibling pool, only ever shrinks the
 * growing one, so a single pass can't introduce a new overlap while fixing
 * one — #14.
 */
export function enforcePoolBoundary(
  elementId: string,
  originalPositions: Map<string, Rect>,
  services: BpmnServices,
): { corrected: boolean; warning?: string } {
  const { elementRegistry, modeling } = services;
  let node: any = elementRegistry.get(elementId);
  while (node && node.type !== 'bpmn:Participant') node = node.parent;
  if (!node) return { corrected: false };
  const pool = node;

  const originalPool = originalPositions.get(pool.id);
  if (!originalPool) return { corrected: false }; // pool itself is new this call — nothing to protect

  const siblings = elementRegistry.getAll().filter((el: any) => el.type === 'bpmn:Participant' && el.id !== pool.id);
  const originalSiblingRects = siblings
    .map((s: any) => originalPositions.get(s.id))
    .filter(Boolean) as Rect[];
  if (originalSiblingRects.length === 0) return { corrected: false }; // no other pools to collide with

  const envelope = computeGrowthEnvelope(originalPool, originalSiblingRects, POOL_PADDING);
  const current: Rect = { x: pool.x, y: pool.y, width: pool.width, height: pool.height };
  const withinEnvelope =
    current.x >= envelope.minX && current.y >= envelope.minY &&
    current.x + current.width <= envelope.maxX && current.y + current.height <= envelope.maxY;
  if (withinEnvelope) return { corrected: false };

  const poolName = pool.businessObject?.name || pool.id;
  const clampedMinX = Math.max(current.x, envelope.minX);
  const clampedMinY = Math.max(current.y, envelope.minY);
  const clampedMaxX = Math.min(current.x + current.width, envelope.maxX);
  const clampedMaxY = Math.min(current.y + current.height, envelope.maxY);
  if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool, and there wasn't room to avoid it — worth a visual check.` };
  }
  const clampedRect: Rect = { x: clampedMinX, y: clampedMinY, width: clampedMaxX - clampedMinX, height: clampedMaxY - clampedMinY };

  const contentShapes = collectDescendantShapes(pool);
  const contentBbox = contentShapes.length > 0
    ? bboxOfShapes(contentShapes.map((s: any) => ({ bounds: { x: s.x, y: s.y, width: s.width, height: s.height } })))
    : null;
  const contentFits = !contentBbox || (
    contentBbox.x >= clampedRect.x + POOL_PADDING &&
    contentBbox.y >= clampedRect.y + POOL_PADDING &&
    contentBbox.x + contentBbox.width <= clampedRect.x + clampedRect.width - POOL_PADDING &&
    contentBbox.y + contentBbox.height <= clampedRect.y + clampedRect.height - POOL_PADDING
  );
  if (!contentFits) {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool, and there wasn't room to avoid it without cutting off its own content — worth a visual check.` };
  }

  try {
    modeling.resizeShape(pool, clampedRect);
    return { corrected: true };
  } catch {
    return { corrected: false, warning: `Pool "${poolName}" grew enough to overlap a neighboring pool and the automatic correction failed — worth a visual check.` };
  }
}
