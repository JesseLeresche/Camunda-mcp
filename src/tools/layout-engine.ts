export interface Point {
    x: number;
    y: number;
}

export interface Rect extends Point {
    width: number;
    height: number;
    id?: string;
}

export class OccupancyMap {
    private occupied: Rect[] = [];

    constructor(existingElements: Rect[] = []) {
        this.occupied = [...existingElements];
    }

    add(rect: Rect) {
        this.occupied.push(rect);
    }

    isAvailable(rect: Rect, padding = 10): boolean {
        const paddedRect = {
            x: rect.x - padding,
            y: rect.y - padding,
            width: rect.width + 2 * padding,
            height: rect.height + 2 * padding,
        };

        return !this.occupied.some(other => {
            return paddedRect.x < other.x + other.width &&
                paddedRect.y < other.y + other.height &&
                paddedRect.x + paddedRect.width > other.x &&
                paddedRect.y + paddedRect.height > other.y;
        });
    }

    findNearestFree(preferred: Point, width: number, height: number, step = 20): Point {
        let angle = 0;
        let radius = 0;
        let maxIterations = 500;

        for (let i = 0; i < maxIterations; i++) {
            const x = Math.round(preferred.x + radius * Math.cos(angle));
            const y = Math.round(preferred.y + radius * Math.sin(angle));

            if (this.isAvailable({ x, y, width, height })) {
                return { x, y };
            }

            angle += 0.5;
            radius += step * 0.1;
        }

        return preferred;
    }
}

export class LayoutEngine {
    private map: OccupancyMap;

    constructor(existingElements: Rect[] = []) {
        this.map = new OccupancyMap(existingElements);
    }

    placeElement(preferred: Point, width: number, height: number): Point {
        const spot = this.map.findNearestFree(preferred, width, height);
        this.map.add({...spot, width, height});
        return spot;
    }

    resolveOverlaps(elements: Rect[]): {id: string, delta: Point}[] {
        const moves: {id: string, delta: Point}[] = [];
        const localMap = new OccupancyMap();

        for (const el of elements) {
            if (!localMap.isAvailable(el, 0)) {
                const newPos = localMap.findNearestFree(el, el.width, el.height);
                moves.push({id: el.id!, delta: {x: newPos.x - el.x, y: newPos.y - el.y}});
                localMap.add({...newPos, width: el.width, height: el.height});
            } else {
                localMap.add(el);
            }
        }
        return moves;
    }
}
