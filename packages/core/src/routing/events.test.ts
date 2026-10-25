import { describe, expect, it } from 'vitest';
import { projectFeature } from '../geo/projection';
import { DEFAULT_RULES } from '../rules/defaults';
import { routeEvents } from './events';
import { feature, metric, rectangle } from './test-maps';

describe('semantic route events', () => {
  it('orders crossing, hazard, steps and directional turn events by travelled metres', () => {
    const features = [
      feature('crossing', 'crossing', rectangle(6, 3, 10, 7)),
      feature('steps', 'steps', { type: 'Point', coordinates: metric(15, 12) }, { radius_m: 1 }),
      feature('lake', 'water', rectangle(2, -5, 10, 0)),
    ].map(projectFeature);
    const events = routeEvents(
      [metric(2, 5), metric(15, 5), metric(15, 18)],
      features,
      DEFAULT_RULES,
      0.25,
    );
    expect(events.some((e) => e.kind === 'enter' && e.category === 'crossing')).toBe(true);
    expect(events.some((e) => e.kind === 'enter' && e.category === 'steps')).toBe(true);
    expect(events.filter((e) => e.kind === 'hazard' && e.featureId === 'lake')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'turn')).toMatchObject({
      direction: 'left',
      angleDegrees: 90,
      distanceM: 13,
      waypointIndex: 1,
    });
    expect(events.map((e) => e.distanceM)).toEqual(
      events.map((e) => e.distanceM).sort((a, b) => a - b),
    );
    for (const event of events) {
      expect(event.position[0]).toBeGreaterThan(20);
      expect(event.position[0]).toBeLessThan(30);
      expect(event.position[1]).toBeGreaterThan(50);
      expect(event.position[1]).toBeLessThan(60);
    }
  });
});
