# Editor route testing (M4)

Open `/editor`, sign in, and choose **Test route**. The default **Approved map** is
the last validated routing snapshot saved on this device, including when offline.
The map in this tab shows the same features and rules used by the test. An
administrator can choose **Editor preview** to test unsynced changes and submissions
awaiting review. Preview results never change the approved snapshot or publish edits.
Resolve conflicts before testing an editor preview.

1. Choose **Pick A on map**, then click a start and an end. Alternatively, select
   enabled point destinations from the two lists. Area and line destinations need
   an explicit map point; an inferred centroid could be inside a hole or obstacle.
2. Choose **Calculate route**. The blue line is the core router's route, with its
   distance, weighted search cost and annotated turns, entrances and hazards.
3. Blocked endpoints have red cell outlines and blocker labels. A disconnected
   search and a search-limit failure have distinct explanations. A snapped endpoint
   has an explicit distance notice and a dotted, unchecked connection to the route.
   The simulator uses only the calculated route, starting at its snapped position.
4. Enable **Show cost grid** and calculate to inspect the visible area. Red cells
   are blocked, including safety buffers; passable cells show routing cost, including
   clearance penalties. The display uses exact routing cells (normally 0.5 m), capped
   at 12,000 cells per view. Zoom in when requested. Pan/zoom and recalculate to
   refresh the overlay. It never samples away thin obstacles to fit a large view.
5. **Play walk** follows the route at the selected speed. Pause/reset are available.
   In **Manual movement**, focus the control pad: up/down move one metre;
   left/right rotate 15 degrees. A heading slider and equivalent buttons also work.
   Manual mode can cross blocked cells; it is a virtual testing tool.

Calculations run in a module Web Worker. Changing endpoints, routing data or the
account invalidates displayed results and terminates obsolete work. Cancellation
terminates an in-progress search; failures never fall back to routing on the UI
thread. Exact-version tiles are reused in memory and saved/restored through M2's
account/backend-scoped IndexedDB cache. Storage failure simply regenerates tiles.

Simulation geometry is pure TypeScript in `packages/core/src/simulation/`, in
LKS94 metres. `SimulatedSensors` exposes `LocationProvider` and `HeadingProvider`
interfaces for connecting the real M5 guidance engine. Audio, speech, real GPS,
compass permissions, navigation accuracy gates and wake lock remain M5 work.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- Once per machine: `pnpm --filter @alouna/web exec playwright install chromium`
- `pnpm test:e2e` starts its own loopback server on port 5174 with a synthetic
  offline account and map. No production account or service is used. It verifies
  map clicks, the actual routing worker, road/crossing events, exact cost overlay,
  tile persistence, simulator controls and blocked-endpoint failure.

Playwright and Node type declarations are development dependencies for the planned
browser smoke tests and their strict TypeScript checks. MapLibre 6 uses its
documented Vite `?worker&url` setup so its renderer worker is bundled and precached
alongside the routing worker. See the [MapLibre installation guide](https://maplibre.org/maplibre-gl-js/docs/).
