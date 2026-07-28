import { describe, it, expect } from 'vitest';
import { computeGrowthEnvelope, collectDescendantShapes } from '../bpmn-tools';

/**
 * #14 regression suite — pure geometry helpers behind the pool-overlap fix.
 * No live services involved, same shape as this file's other pure-helper
 * coverage (composition.test.ts, subtree-layout.test.ts).
 */

describe('computeGrowthEnvelope', () => {
  const pool = { x: 100, y: 260, width: 600, height: 300 }; // spans x:100-700, y:260-560

  it('is fully unconstrained with no siblings', () => {
    const env = computeGrowthEnvelope(pool, []);
    expect(env).toEqual({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });
  });

  it('constrains upward growth only when a sibling sits above with overlapping X range', () => {
    const siblingAbove = { x: 100, y: 80, width: 600, height: 150 }; // spans y:80-230
    const env = computeGrowthEnvelope(pool, [siblingAbove], 30);
    expect(env.minY).toBe(230 + 30);
    expect(env.maxY).toBe(Infinity);
    expect(env.minX).toBe(-Infinity);
    expect(env.maxX).toBe(Infinity);
  });

  it('constrains downward growth only when a sibling sits below with overlapping X range', () => {
    const siblingBelow = { x: 100, y: 600, width: 600, height: 150 };
    const env = computeGrowthEnvelope(pool, [siblingBelow], 30);
    expect(env.maxY).toBe(600 - 30);
    expect(env.minY).toBe(-Infinity);
  });

  it('constrains leftward/rightward growth for siblings positioned horizontally', () => {
    const siblingLeft = { x: -400, y: 260, width: 400, height: 300 }; // spans x:-400-0
    const siblingRight = { x: 800, y: 260, width: 400, height: 300 }; // spans x:800-1200
    const env = computeGrowthEnvelope(pool, [siblingLeft, siblingRight], 30);
    expect(env.minX).toBe(0 + 30);
    expect(env.maxX).toBe(800 - 30);
  });

  it('does not constrain when the sibling range does not overlap the cross-axis', () => {
    // Sibling is "above" in Y terms but has zero X overlap with pool — should not constrain minY.
    const farOffSibling = { x: 2000, y: 80, width: 100, height: 150 };
    const env = computeGrowthEnvelope(pool, [farOffSibling], 30);
    expect(env.minY).toBe(-Infinity);
    expect(env.maxY).toBe(Infinity);
    expect(env.minX).toBe(-Infinity);
    expect(env.maxX).toBe(Infinity);
  });

  it('combines constraints from multiple siblings on different sides', () => {
    const above = { x: 100, y: 80, width: 600, height: 150 };
    const below = { x: 100, y: 600, width: 600, height: 150 };
    const env = computeGrowthEnvelope(pool, [above, below], 30);
    expect(env.minY).toBe(230 + 30);
    expect(env.maxY).toBe(600 - 30);
  });

  it('picks the tightest constraint among several siblings on the same side', () => {
    const closeAbove = { x: 100, y: 150, width: 600, height: 80 }; // bottom at 230
    const fartherAbove = { x: 100, y: 0, width: 600, height: 100 }; // bottom at 100
    const env = computeGrowthEnvelope(pool, [closeAbove, fartherAbove], 30);
    expect(env.minY).toBe(230 + 30); // the closer sibling is the binding constraint
  });
});

describe('collectDescendantShapes', () => {
  it('recursively collects nested shapes and connections, excluding labels', () => {
    const leaf = { id: 'leaf', x: 10, y: 10, width: 5, height: 5, type: 'bpmn:Task', children: [] };
    const connection = { id: 'conn', x: 0, y: 0, width: 20, height: 20, type: 'bpmn:SequenceFlow' };
    const label = { id: 'leaf_label', x: 1, y: 1, width: 1, height: 1, type: 'label' };
    const nestedContainer = { id: 'sub', x: 0, y: 0, width: 50, height: 50, type: 'bpmn:SubProcess', children: [leaf, label] };
    const root = { id: 'pool', x: 0, y: 0, width: 100, height: 100, type: 'bpmn:Participant', children: [nestedContainer, connection] };

    const result = collectDescendantShapes(root);
    const ids = result.map((s) => s.id).sort();
    expect(ids).toEqual(['conn', 'leaf', 'sub']);
  });

  it('returns an empty array for a container with no children', () => {
    expect(collectDescendantShapes({ children: [] })).toEqual([]);
    expect(collectDescendantShapes({})).toEqual([]);
  });
});
