import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, createRoutingHandler, type RoutingResponse } from '@alouna/core';
import {
  area,
  feature,
  location,
  rectangle,
} from '../../../../packages/core/src/routing/test-maps';
import type { LocalData } from '../data/types';
import { debugGeoJson, pointDestinations, routingMap } from './routeState';
import { useRouteTester } from './useRouteTester';
import type { PlannerRequest } from './planner.worker';
import { RouteTester } from './RouteTester';
import { Simulator } from './Simulator';
import { SimulatedSensors } from '../sensors/simulated';

const map = [
  area(),
  feature(
    'start',
    'landmark',
    { type: 'Point', coordinates: [500003, 6100003] },
    { name: 'House', is_destination: true, enabled: true },
  ),
  feature(
    'end',
    'landmark',
    { type: 'Point', coordinates: [500026, 6100026] },
    { name: 'Sauna', is_destination: true, enabled: true },
  ),
];
const fixture = (): LocalData => ({
  snapshot: { version: '1', fetchedAt: 0, features: map, rules: [...DEFAULT_RULES] },
  profile: { id: 'admin', active: true, role: 'admin', display_name: 'Admin' },
  queue: [],
  error: null,
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  request!: PlannerRequest;
  onmessage: ((event: { data: RoutingResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(type: string, handler: unknown) {
    if (type === 'message') this.onmessage = handler as typeof this.onmessage;
    if (type === 'error') this.onerror = handler as typeof this.onerror;
  }
  removeEventListener(type: string) {
    if (type === 'message') this.onmessage = null;
    if (type === 'error') this.onerror = null;
  }
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: PlannerRequest) {
    this.request = request;
  }
  reply() {
    this.onmessage?.({ data: createRoutingHandler()(this.request) });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
});

describe('test map authority', () => {
  it('keeps pending edits out of approved tests and allows an explicit admin preview', () => {
    const data = fixture();
    data.queue.push({
      operationId: 'one',
      entityId: 'area',
      expectedRevision: 1,
      kind: 'delete-feature',
      payload: null,
      status: 'pending',
    });
    expect(routingMap(data, 'approved')?.features).toHaveLength(3);
    expect(routingMap(data, 'preview')?.features.map((f) => f.id)).not.toContain('area');
    data.profile!.role = 'walker';
    expect(routingMap(data, 'preview')).toBeNull();
    for (const error of ['denied', 'invalid-data'] as const)
      expect(routingMap({ ...data, error }, 'approved')).toBeNull();
    expect(
      routingMap({ ...data, profile: { ...data.profile!, active: false } }, 'approved'),
    ).toBeNull();
    expect(
      pointDestinations([
        ...map,
        feature('lake', 'water', rectangle(1, 1, 2, 2), { is_destination: true }),
      ]),
    ).toHaveLength(2);
  });
  it('exports blocked grid cells as valid GeoJSON without non-finite numeric properties', () => {
    const json = debugGeoJson({
      status: 'ok',
      origin: [500000, 6100000],
      cellSizeM: 1,
      columns: 2,
      rows: 1,
      costs: [Infinity, 1.2],
      baseCosts: [Infinity, 1],
    });
    expect(json.features[0]?.properties).toEqual({ blocked: true, cost: null, baseCost: null });
    expect(json.features[1]?.properties?.cost).toBe(1.2);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe('routing worker lifecycle', () => {
  it('rejects stale responses, cancels work, and invalidates routes when the map changes', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { result, rerender, unmount } = renderHook(
      ({ data }) => useRouteTester(data, 'test:admin'),
      { initialProps: { data: fixture() } },
    );
    act(() => {
      result.current.setStart(location(3, 3));
      result.current.setEnd(location(26, 26));
    });
    act(() => result.current.run());
    const first = FakeWorker.instances[0]!;
    expect(result.current.busy).toBe(true);
    act(() => result.current.setEnd(location(20, 20)));
    expect(first.terminate).toHaveBeenCalled();
    act(() => first.reply());
    expect(result.current.result).toBeNull();
    act(() => result.current.run());
    act(() => FakeWorker.instances[1]!.reply());
    expect(result.current.result?.result.status).toBe('ok');
    act(() => result.current.run());
    expect(FakeWorker.instances).toHaveLength(2);
    act(() => FakeWorker.instances[1]!.reply());
    expect(result.current.result?.result.status).toBe('ok');
    const data = fixture();
    data.snapshot!.features = [area(40, 40), ...map.slice(1)];
    rerender({ data });
    expect(result.current.result).toBeNull();
    act(() => result.current.run());
    const third = FakeWorker.instances[2]!;
    act(() => result.current.cancel());
    act(() => third.reply());
    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(false);
    unmount();
    expect(third.terminate).toHaveBeenCalled();
  });

  it('selects destinations, calculates through the worker and reports blocked endpoints', () => {
    vi.stubGlobal('Worker', FakeWorker);
    function Harness() {
      const test = useRouteTester(fixture(), 'test:admin');
      return <RouteTester test={test} isAdmin onPick={test.setPicking} onWalker={() => {}} />;
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('A · Start · Choose a point destination'), {
      target: { value: 'start' },
    });
    fireEvent.change(screen.getByLabelText('B · End · Choose a point destination'), {
      target: { value: 'end' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate route' }));
    act(() => FakeWorker.instances.at(-1)!.reply());
    expect(screen.getByText(/weighted cost/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Walk simulator' })).toBeInTheDocument();
  });
});

describe('simulated sensors and controls', () => {
  it('publishes through sensor interfaces and unsubscribes listeners', () => {
    const sensors = new SimulatedSensors(),
      onLocation = vi.fn(),
      onHeading = vi.fn();
    const off = sensors.location.subscribe(onLocation);
    sensors.heading.subscribe(onHeading);
    const fix = { position: location(0, 0), accuracyM: 0, timestamp: 1, speedMps: 1 };
    sensors.emit(fix, { degrees: 90, timestamp: 1 });
    off();
    sensors.emit(fix, { degrees: 0, timestamp: 2 });
    expect(onLocation).toHaveBeenCalledTimes(1);
    expect(onHeading).toHaveBeenCalledTimes(2);
  });
  it('plays, pauses, resets and permits keyboard movement away from the route', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const onWalker = vi.fn();
    const { unmount } = render(
      <Simulator waypoints={[location(3, 3), location(3, 23)]} onWalker={onWalker} />,
    );
    fireEvent.change(screen.getByLabelText('Walking speed (m/s)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play walk' }));
    act(() => {
      for (let i = 1; i <= 10; i++) {
        clock.mockReturnValue(i * 100);
        vi.advanceTimersByTime(100);
      }
    });
    expect(screen.getByText('1.0 of 20.0 m')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause walk' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('1.0 of 20.0 m')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Simulation mode'), { target: { value: 'manual' } });
    const pad = screen.getByRole('group', { name: 'Manual walker controls' });
    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    fireEvent.keyDown(pad, { key: 'ArrowUp' });
    expect(screen.getByText('Heading 15°')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset walker' }));
    expect(screen.getByText('Heading 0°')).toBeInTheDocument();
    unmount();
    expect(onWalker).toHaveBeenLastCalledWith(null);
  });
});
