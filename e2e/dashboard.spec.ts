import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function localKubectl(...args: string[]) {
  return execute(
    process.platform === 'win32' ? 'wsl' : 'kubectl',
    process.platform === 'win32' ? ['-d', 'ResilienceLab', '--exec', 'kubectl', ...args] : args,
    { timeout: 30000 },
  );
}
for (const colorScheme of ['light', 'dark'] as const) {
  test(`dashboard, engineering and accessibility (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Break something. Watch it recover.' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'System overview' })).toBeVisible();
    await page.getByRole('link', { name: 'Engineering' }).click();
    await expect(page.getByRole('heading', { name: 'Under the hood' })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole('link', { name: 'The lab', exact: true }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    await page.screenshot({ path: `test-results/desktop-${colorScheme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `test-results/mobile-${colorScheme}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
test('real shop checkout returns an honest outcome', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('SYSTEM CONNECTED', { timeout: 60000 });
  await page.getByRole('button', { name: /Mechanical Keyboard/ }).click();
  await page.getByRole('button', { name: 'Checkout (1)' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Confirmed in|queued safely|Payment failed/ }),
  ).toBeVisible({ timeout: 15000 });
});
test('real payment kill opens breaker, queues checkout and recovers', async ({ page, request }) => {
  test.skip(process.env.RUN_CHAOS_E2E !== 'true', 'Requires a dedicated fault-test target');
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('SYSTEM CONNECTED', { timeout: 60000 });
  await expect(page.getByRole('button', { name: /Kill payment service/ })).toBeEnabled({
    timeout: 180000,
  });
  const products = (await (await request.get('/api/products')).json()) as { id: string }[];
  const cartIds = Array.from({ length: 100 }, () => crypto.randomUUID());
  await Promise.all(
    cartIds.map(async (id) => {
      const headers = { 'x-cart-id': id, 'idempotency-key': id };
      await request.put('/api/cart', {
        headers,
        data: { items: [{ productId: products[0].id, quantity: 1 }] },
      });
    }),
  );
  await page.getByRole('button', { name: /Mechanical Keyboard/ }).click();
  const faultResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/chaos') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Kill payment service/ }).click();
  const faultReply = await faultResponse;
  expect(faultReply.status()).toBe(200);
  const injected = (await faultReply.json()) as { active: { startedAt: number } };
  // A real request burst exercises independent breaker windows before fast pod replacement.
  const burst = Promise.all(
    cartIds.map((id) =>
      request.post('/api/checkout', {
        headers: { 'x-cart-id': id, 'idempotency-key': id },
        data: { cartId: id },
      }),
    ),
  );
  await expect(page.getByText('breaker: open', { exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Checkout (1)' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Order queued safely/ })).toBeVisible({
    timeout: 15000,
  });
  await burst;
  await expect
    .poll(
      async () => {
        const s = await (await request.get('/v1/snapshot')).json();
        return s.recoveries.some(
          (r: { created_at: string }) => Date.parse(r.created_at) >= injected.active.startedAt,
        );
      },
      { timeout: 120000 },
    )
    .toBe(true);
  await expect(page.getByRole('status').filter({ hasText: /Recovered in/ })).toBeVisible({
    timeout: 120000,
  });
});
test('traffic spike produces real Kubernetes scale-up', async ({ page, request }) => {
  test.skip(
    process.env.RUN_HPA_E2E !== 'true',
    'Requires Kubernetes metrics-server; Compose has no autoscaler',
  );
  test.setTimeout(600000);
  const context = await localKubectl('config', 'current-context');
  expect(context.stdout.trim()).toBe('k3d-resilience-lab');
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('SYSTEM CONNECTED', { timeout: 60000 });
  await expect(page.getByRole('button', { name: /Spike traffic/ })).toBeEnabled({
    timeout: 180000,
  });
  // The preceding checkout burst can leave every HPA at its ceiling for the
  // downscale stabilization window. Let real CPU-based downscaling establish
  // headroom; never force application replica counts or alter HPA thresholds.
  const targets = new Set(['gateway', 'catalog', 'cart']);
  const desired = (snapshot: { services: { name: string; desired: number }[] }) =>
    snapshot.services.filter((s) => targets.has(s.name)).reduce((total, s) => total + s.desired, 0);
  let count = 0;
  await localKubectl('scale', 'deployment/traffic-generator', '-n', 'lab', '--replicas=0');
  try {
    await expect
      .poll(async () => desired(await (await request.get('/v1/snapshot')).json()), {
        timeout: 360000,
        intervals: [5000],
        message: 'CPU-based HPAs must return to their minimum before the spike',
      })
      .toBe(5);
    count = desired(await (await request.get('/v1/snapshot')).json());
    expect(count).toBe(5);
  } finally {
    await localKubectl('scale', 'deployment/traffic-generator', '-n', 'lab', '--replicas=1');
  }
  const accepted = page.waitForResponse(
    (r) => r.url().endsWith('/api/chaos') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Spike traffic/ }).click();
  expect((await accepted).status()).toBe(200);
  await expect
    .poll(
      async () => {
        const current = await (await request.get('/v1/snapshot')).json();
        return desired(current);
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(count);
});
