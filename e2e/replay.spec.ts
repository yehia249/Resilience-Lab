import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('public replay is labelled, uses real files, plays each fault and never contacts a backend', async ({
  page,
}) => {
  test.skip(process.env.RUN_REPLAY_E2E !== 'true', 'Requires the built replay frontend');
  const backendCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') || r.url().includes('/v1/') || r.method() === 'POST')
      backendCalls.push(r.url());
  });
  await page.goto('./');
  await expect(page.locator('.replay-banner')).toContainText(
    'Replay of a real recording from the live system, captured on',
  );
  await expect(page.locator('.connection')).toContainText('REPLAYING A REAL CAPTURE');
  await expect(page.locator('.replay-banner')).toContainText('make dev');
  await expect(page.locator('.stat strong').first()).not.toContainText('—');
  await expect(page.getByRole('button', { name: /Live locally|Live system/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Try the shop' })).toHaveCount(0);
  await expect(page.getByText('It does not measure your internet connection.')).toBeVisible();
  for (const viewport of [
    { width: 1920, height: 950 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const graph = await page.locator('.chart-card').boundingBox();
    expect(graph).not.toBeNull();
    expect(graph!.y).toBeGreaterThanOrEqual(0);
    expect(graph!.y + graph!.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const points = await page
    .locator('.chart polyline')
    .evaluateAll((lines) => lines.map((line) => line.getAttribute('points')));
  await expect
    .poll(() =>
      page
        .locator('.chart polyline')
        .evaluateAll((lines) => lines.map((line) => line.getAttribute('points'))),
    )
    .not.toEqual(points);
  await page.getByRole('button', { name: /How does recovery work/ }).click();
  await expect(page.getByRole('heading', { name: 'How the system recovers' })).toBeVisible();
  await expect(page.locator('#recovery-explanation')).toContainText(
    'ten consecutive healthy samples',
  );
  await page.getByRole('button', { name: /How does recovery work/ }).click();
  await expect(page.locator('#recovery-explanation')).toBeHidden();
  for (const [button, type] of [
    ['Kill payment service', 'KILL PAYMENT'],
    ['Add latency', 'ADD CATALOG LATENCY'],
    ['Spike traffic', 'SPIKE TRAFFIC'],
    ['Slow database', 'SLOW DATABASE'],
  ]) {
    await page.getByRole('button', { name: new RegExp(button) }).click();
    await expect(page.locator('.replay-banner')).toContainText(type);
    await expect(page.locator('.connection')).toContainText('REPLAYING A REAL CAPTURE');
  }
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start replay', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause replay', exact: true })).toBeVisible();
  expect(backendCalls).toEqual([]);
  await page.getByRole('link', { name: 'Engineering' }).click();
  await expect(page.getByRole('heading', { name: 'Under the hood' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Under the hood' })).toBeVisible();
  await page.getByRole('link', { name: 'The lab', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // Let the 180 ms theme transitions settle before measuring static text contrast.
    await page.waitForTimeout(250);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `test-results/replay-${colorScheme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/replay-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
