import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
  ).toBeVisible();
});
test('real payment kill opens breaker, queues checkout and recovers', async ({ page, request }) => {
  test.skip(process.env.RUN_CHAOS_E2E !== 'true', 'Requires a dedicated fault-test target');
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('SYSTEM CONNECTED', { timeout: 60000 });
  await expect(page.getByRole('button', { name: /Kill payment service/ })).toBeEnabled({
    timeout: 180000,
  });
  await page.getByRole('button', { name: /Kill payment service/ }).click();
  const products = (await (await request.get('/api/products')).json()) as { id: string }[];
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      const id = crypto.randomUUID();
      const headers = { 'x-cart-id': id, 'idempotency-key': id };
      await request.put('/api/cart', {
        headers,
        data: { items: [{ productId: products[0].id, quantity: 1 }] },
      });
      await request.post('/api/checkout', { headers, data: { cartId: id } });
    }),
  );
  await expect(page.getByText('breaker: open', { exact: true })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: /Mechanical Keyboard/ }).click();
  await page.getByRole('button', { name: 'Checkout (1)' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Order queued safely/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Recovered in/ })).toBeVisible({
    timeout: 120000,
  });
});
test('traffic spike produces real Kubernetes scale-up', async ({ page, request }) => {
  test.skip(
    process.env.RUN_HPA_E2E !== 'true',
    'Requires Kubernetes metrics-server; Compose has no autoscaler',
  );
  await page.goto('/');
  await expect(page.locator('.connection')).toContainText('SYSTEM CONNECTED', { timeout: 60000 });
  await expect(page.getByRole('button', { name: /Spike traffic/ })).toBeEnabled({
    timeout: 180000,
  });
  const before = await (await request.get('/v1/snapshot')).json();
  const count = before.services.reduce(
    (a: number, s: { desired: number }) => a + (s.desired ?? 0),
    0,
  );
  await page.getByRole('button', { name: /Spike traffic/ }).click();
  await expect
    .poll(
      async () => {
        const current = await (await request.get('/v1/snapshot')).json();
        return current.services.reduce(
          (a: number, s: { desired: number }) => a + (s.desired ?? 0),
          0,
        );
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(count);
});
