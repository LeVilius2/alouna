import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bounds, LonLat, RoutingResponse } from '@alouna/core';
import type { LocalData } from '../data/types';
import type { PlannerRequest } from './planner.worker';
import { routingMap, type Endpoint, type RouteSource } from './routeState';

export function useRouteTester(data: LocalData, scope: string) {
  const [source, setSource] = useState<RouteSource>('approved');
  const [start, setStart] = useState<LonLat | null>(null),
    [end, setEnd] = useState<LonLat | null>(null);
  const [picking, setPicking] = useState<Endpoint | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [reply, setReply] = useState<{ key: string; response: RoutingResponse } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const map = useMemo(() => routingMap(data, source), [data, source]);
  const mapKey = useMemo(
    () => (map ? JSON.stringify([scope, source, map.features, map.rules]) : ''),
    [map, scope, source],
  );
  const requestKey = JSON.stringify([mapKey, start, end]);
  const worker = useRef<Worker | null>(null),
    activeRequest = useRef<string | null>(null);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
      activeRequest.current = null;
    },
    [scope, mapKey, start, end],
  );

  const stopRequest = () => {
    activeRequest.current = null;
    worker.current?.terminate();
    worker.current = null;
    setBusyKey(null);
  };
  const run = () => {
    if (!map || !start || !end) return;
    if (activeRequest.current) stopRequest();
    setReply(null);
    setFailedKey(null);
    const id = crypto.randomUUID();
    try {
      const instance =
        worker.current ??
        new Worker(new URL('./planner.worker.ts', import.meta.url), {
          type: 'module',
        });
      worker.current = instance;
      activeRequest.current = id;
      setBusyKey(requestKey);
      const onMessage = (event: MessageEvent<RoutingResponse>) => {
        if (activeRequest.current !== id || event.data.id !== id) return;
        instance.removeEventListener('message', onMessage);
        instance.removeEventListener('error', onError);
        activeRequest.current = null;
        setReply({ key: requestKey, response: event.data });
        setBusyKey(null);
      };
      const onError = () => {
        if (activeRequest.current !== id) return;
        instance.removeEventListener('message', onMessage);
        instance.removeEventListener('error', onError);
        activeRequest.current = null;
        instance.terminate();
        worker.current = null;
        setFailedKey(requestKey);
        setBusyKey(null);
      };
      instance.addEventListener('message', onMessage);
      instance.addEventListener('error', onError);
      const request: PlannerRequest = {
        id,
        scope,
        mapKey,
        features: map.features,
        rules: map.rules,
        start,
        end,
        debugBounds: showCosts && bounds ? bounds : undefined,
      };
      instance.postMessage(request);
    } catch {
      worker.current?.terminate();
      worker.current = null;
      activeRequest.current = null;
      setFailedKey(requestKey);
      setBusyKey(null);
    }
  };
  const response = reply?.key === requestKey ? reply.response : null;
  const result = response && 'result' in response ? response : null;
  return {
    source,
    setSource: (value: RouteSource) => {
      stopRequest();
      setSource(value);
    },
    start,
    end,
    setStart: (value: LonLat) => {
      stopRequest();
      setStart(value);
    },
    setEnd: (value: LonLat) => {
      stopRequest();
      setEnd(value);
    },
    picking,
    setPicking,
    showCosts,
    setShowCosts,
    bounds,
    setBounds,
    map,
    mapKey,
    requestKey,
    result,
    busy: busyKey === requestKey,
    failed: failedKey === requestKey || !!(response && 'error' in response),
    run,
    cancel: stopRequest,
    clear: () => {
      stopRequest();
      setReply(null);
      setStart(null);
      setEnd(null);
      setPicking(null);
    },
    pick: (point: LonLat) => {
      stopRequest();
      if (picking === 'start') {
        setStart(point);
        setPicking('end');
      } else if (picking === 'end') {
        setEnd(point);
        setPicking(null);
      }
    },
  };
}

export type RouteTesterState = ReturnType<typeof useRouteTester>;
