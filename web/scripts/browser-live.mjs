import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    if (!req.url.startsWith('/preview/') || req.url.includes('..')) return res.writeHead(404).end();
    const name = req.url.slice(9) || 'index.html';
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html');
    res.end(await readFile(new URL(`dist/${name}`, root)));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.BILLBOARD_CHROMIUM || '/opt/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
const report = { checkedAt: new Date().toISOString(), errors: [], failedRequests: [], viewports: [], kind: 'Live public RPC browser read; no wallet, mocks, or transactions' };
try {
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), failure: r.failure() }));
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await expect(page.getByText('Read at block', { exact: false })).toBeVisible({ timeout: 45000 });
  report.state = await page.locator('.live-bar').innerText();
  report.display = await page.locator('.market-stats').innerText();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    report.viewports.push({ width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
    await page.screenshot({ path: new URL(`docs/evidence/live-${width}.png`, root).pathname, fullPage: true });
  }
} catch (e) { report.error = e.message; process.exitCode = 1; }
finally {
  await writeFile(new URL('docs/evidence/browser-live.json', root), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
