import { chromium } from '@playwright/test';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const base = process.env.DEMO_URL ?? 'https://yehia249.github.io/Resilience-Lab/';
await mkdir('.local/demo-capture', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
  recordVideo: { dir: '.local/demo-capture', size: { width: 1280, height: 900 } },
});
const page = await context.newPage();
const startedAt = new Date().toISOString();
await page.goto(base);
await page.locator('.replay-banner').waitFor();
await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
await page.waitForTimeout(6000);
await page.getByLabel('Speed').selectOption('4');
await page.getByRole('button', { name: /Kill payment service/ }).click();
await page.waitForTimeout(32000);
await page.getByRole('button', { name: 'View a recorded checkout' }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /Spike traffic/ }).click();
await page.waitForTimeout(23000);
await page.getByRole('button', { name: /Add latency/ }).click();
await page.waitForTimeout(15000);
await page.getByRole('link', { name: 'Engineering' }).click();
await page.waitForTimeout(10000);
const video = page.video();
await context.close();
await copyFile(await video.path(), 'apps/web/public/demo.webm');
await writeFile(
  'docs/benchmarks/demo-video.json',
  JSON.stringify(
    {
      source: base,
      startedAt,
      completedAt: new Date().toISOString(),
      mode: 'Replay of real local experiments, captured browser walkthrough; no live backend and no audio.',
    },
    null,
    2,
  ) + '\n',
);
await browser.close();
console.log('Saved actual browser walkthrough to apps/web/public/demo.webm');
