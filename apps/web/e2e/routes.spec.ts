import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { DEFAULT_RULES } from '@alouna/core';
import { area, feature, rectangle } from '../../../packages/core/src/routing/test-maps';

// A synthetic offline account only. No real service or credentials are used.
const backend = 'http://127.0.0.1:5174/supabase';
const features = [
  area(40, 30),
  feature('road', 'road', rectangle(17, 0, 21, 30)),
  feature('crossing', 'crossing', rectangle(14, 19, 24, 25)),
  feature(
    'house',
    'landmark',
    { type: 'Point', coordinates: [500005, 6100005] },
    { name: 'House', is_destination: true },
  ),
  feature(
    'sauna',
    'landmark',
    { type: 'Point', coordinates: [500035, 6100005] },
    { name: 'Sauna', is_destination: true },
  ),
  feature(
    'blocked',
    'landmark',
    { type: 'Point', coordinates: [500019, 6100005] },
    { name: 'In the road', is_destination: true },
  ),
].map((f) => ({ ...f, properties: { ...f.properties, enabled: true, reviewed: true } }));

test.beforeEach(async ({ page }) => {
  await page.route('**/supabase/**', (route) => route.abort());
  // Keep the smoke test independent of external basemap servers.
  await page.route(
    /https:\/\/(www\.geoportal\.lt|services\.arcgisonline\.com|tile\.openstreetmap\.org)\//,
    (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ0ND4DwACbAF4RS6SMAAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
  );
  await page.addInitScript(
    ({ backend, features, rules }) => {
      Object.defineProperty(navigator, 'onLine', { get: () => false });
      const put = (database: string, store: string, key: string, value: unknown) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(database, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(store);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        });
      // Auth restoration awaits this database read after application module loading.
      void Promise.all([
        put('alouna-auth-cache-v1', 'last-account', backend, 'test-admin'),
        put('alouna-data-v1', 'accounts', `${backend}:test-admin`, {
          snapshot: { version: '1', features, rules, fetchedAt: Date.now() },
          profile: {
            id: 'test-admin',
            display_name: 'Test administrator',
            role: 'admin',
            active: true,
          },
          queue: [],
          error: null,
        }),
      ]);
    },
    { backend, features, rules: [...DEFAULT_RULES] },
  );
});

test('map clicks, the real worker, exact cost grid and virtual walking work offline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await page.getByRole('tab', { name: 'Test route' }).click();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Property map' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await page.getByRole('button', { name: 'Pick A on map' }).click();
  const canvas = page.locator('canvas.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  // Both clicks are map inputs; then use exact named endpoints for the crossing assertion.
  await canvas.click({ position: { x: box.width * 0.25, y: box.height * 0.5 } });
  await expect(page.getByText('Click the map to place B.')).toBeVisible();
  await canvas.click({ position: { x: box.width * 0.75, y: box.height * 0.5 } });
  await expect(page.getByRole('tab', { name: 'Test route' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('A · Start · Choose a point destination').selectOption('house');
  await page.getByLabel('B · End · Choose a point destination').selectOption('sauna');
  await page.getByLabel('Show cost grid').check();
  const extent = page.getByText(/^Visible extent:/);
  const previousExtent = await extent.textContent();
  await canvas.dblclick({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(extent).not.toHaveText(previousExtent!);
  await page.getByRole('button', { name: 'Calculate route' }).click();
  await expect(page.getByText(/weighted cost/)).toBeVisible();
  await expect(page.getByText(/Road crossing. Stop and listen./)).toBeVisible();
  await expect(page.getByText(/Exact cost grid:/)).toBeVisible();
  // Inspect the persisted worker grid, rather than allowing a main-thread router fallback.
  const cache = await page.evaluate(
    async (backend) =>
      new Promise<{ tiles: number; snapshot: string }>((resolve, reject) => {
        const request = indexedDB.open('alouna-tiles-v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('tiles');
          const item = tx.objectStore('tiles').get(`${backend}:test-admin`);
          item.onsuccess = () => {
            resolve({
              tiles: item.result?.tiles.length ?? 0,
              snapshot: item.result?.snapshot ?? '',
            });
            db.close();
          };
        };
      }),
    backend,
  );
  expect(cache.tiles).toBeGreaterThan(0);
  expect(cache.snapshot).toContain('crossing');
  await page.getByRole('button', { name: 'Play walk' }).click();
  await expect(page.getByRole('button', { name: 'Pause walk' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Pause walk' }).click();
  await page.getByLabel('Simulation mode').selectOption('manual');
  await page.getByRole('group', { name: 'Manual walker controls' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: 'test-results/route-tester.png' });
  expect(errors).toEqual([]);
});

test('navigator works offline with real routing worker, simulated walker, weak GPS gate, and Where am I', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/navigate');
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  await page.getByLabel('Use simulated walker (indoor test mode)').check();
  await page.getByRole('button', { name: 'Start walking to Sauna' }).click();
  await expect(page.getByRole('heading', { name: 'Navigating to Sauna' })).toBeVisible();
  await expect(page.getByText(/m remaining/)).toBeVisible();

  await page.getByRole('button', { name: 'Simulate weak GPS (±25 m)' }).click();
  await expect(page.getByText('GPS weak, stop and wait.')).toBeVisible();

  await page.getByRole('button', { name: 'Restore good GPS (±2 m)' }).click();
  await expect(page.getByText(/m remaining/)).toBeVisible();

  await page.getByRole('button', { name: /Stop navigation/ }).click();
  await expect(page.getByRole('button', { name: 'Repeat last: Sauna' })).toBeVisible();

  // M7 Field capture: Add here (averaged GPS point + compass offset) and Record walk offline
  await page.getByRole('button', { name: 'Add here / Record walk' }).click();
  await expect(page.getByRole('heading', { name: 'Field capture (Add here)' })).toBeVisible();
  await page.getByLabel('Object is in front of me (compass + distance offset)').check();
  await page.getByRole('button', { name: 'Start averaging GPS' }).click();
  await page.getByRole('button', { name: 'Emit GPS fix here (±2 m)' }).click();
  await page.getByRole('button', { name: 'Finish averaging now' }).click();
  await expect(page.getByText(/Captured point: GPS ±/)).toBeVisible();
  await page.getByLabel('Name (use keyboard microphone to dictate)').fill('Field apple tree');
  await page.getByRole('button', { name: 'Save to map (works offline)' }).click();
  await expect(page.getByText(/Saved "Field apple tree" to map/)).toBeVisible();

  // Verify the field-captured feature appears in the Map editor offline queue (via SPA navigation)
  await page.getByRole('button', { name: 'Back to navigator' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('link', { name: /Map editor/ }).click();
  await expect(page.getByRole('button', { name: /Field apple tree/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a blocked endpoint fails visibly and clear removes its result', async ({ page }) => {
  await page.goto('/editor');
  await page.getByRole('tab', { name: 'Test route' }).click();
  await page.getByLabel('A · Start · Choose a point destination').selectOption('house');
  await page.getByLabel('B · End · Choose a point destination').selectOption('blocked');
  await page.getByRole('button', { name: 'Calculate route' }).click();
  await expect(page.getByText('Why no route?')).toBeVisible();
  await expect(page.getByText(/B is blocked/)).toBeVisible();
  await expect(page.getByText(/B · End: blocked by Road/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play walk' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear test' }).click();
  await expect(page.getByText('Why no route?')).toHaveCount(0);
});
