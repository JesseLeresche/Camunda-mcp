import { describe, it, expect } from 'vitest';
import { OccupancyMap, LayoutEngine, Rect } from '../layout-engine';

describe('Layout Engine Logic', () => {

    describe('OccupancyMap', () => {
        it('should detect overlap when a space is taken', () => {
            const map = new OccupancyMap([{ x: 100, y: 100, width: 100, height: 100 }]);

            // Overlapping rect
            expect(map.isAvailable({ x: 150, y: 150, width: 50, height: 50 })).toBe(false);

            // Free rect
            expect(map.isAvailable({ x: 300, y: 300, width: 50, height: 50 })).toBe(true);
        });

        it('should find a free spot nearby when preferred spot is taken', () => {
            const map = new OccupancyMap([{ x: 100, y: 100, width: 100, height: 100 }]);
            const preferred = { x: 100, y: 100 };

            const result = map.findNearestFree(preferred, 100, 100);

            expect(result.x).not.toBe(100);
            expect(map.isAvailable({ ...result, width: 100, height: 100 })).toBe(true);
        });
    });

    describe('LayoutEngine', () => {
        it('should resolve overlaps for a list of elements', () => {
            const overlappingElements: Rect[] = [
                { id: 'task1', x: 100, y: 100, width: 100, height: 100 },
                { id: 'task2', x: 110, y: 110, width: 100, height: 100 } // Overlaps task1
            ];

            const engine = new LayoutEngine([]);
            const moves = engine.resolveOverlaps(overlappingElements);

            expect(moves).toHaveLength(1);
            expect(moves[0].id).toBe('task2');
            expect(moves[0].delta.x).not.toBe(0);
        });
    });
});