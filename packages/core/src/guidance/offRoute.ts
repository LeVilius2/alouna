export interface OffRouteEvaluation {
  isOffRouteNow: boolean;
  thresholdM: number;
  offRouteSinceMs: number | null;
  shouldReplan: boolean;
}

/**
 * Evaluates whether the walker has been more than `max(minOffRouteM, accuracyM)`
 * from the route for at least `sustainMs` (default 3000 ms).
 */
export function evaluateOffRoute(
  crossTrackErrorM: number,
  accuracyM: number,
  nowMs: number,
  previousOffRouteSinceMs: number | null,
  options: { minOffRouteM?: number; sustainMs?: number } = {},
): OffRouteEvaluation {
  const minOffRouteM = options.minOffRouteM ?? 4;
  const sustainMs = options.sustainMs ?? 3000;
  const safeAccuracy = Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 0;
  const thresholdM = Math.max(minOffRouteM, safeAccuracy);
  const isOffRouteNow = crossTrackErrorM > thresholdM;
  if (!isOffRouteNow) {
    return {
      isOffRouteNow: false,
      thresholdM,
      offRouteSinceMs: null,
      shouldReplan: false,
    };
  }
  const offRouteSinceMs = previousOffRouteSinceMs ?? nowMs;
  const elapsedMs = Math.max(0, nowMs - offRouteSinceMs);
  return {
    isOffRouteNow: true,
    thresholdM,
    offRouteSinceMs,
    shouldReplan: elapsedMs >= sustainMs,
  };
}
