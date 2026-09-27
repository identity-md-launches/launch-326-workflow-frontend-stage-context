import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { decodeFunctionData, encodeFunctionResult, encodeErrorResult, parseEther, toHex, zeroAddress, stringToHex } from 'viem';

const root = new URL('../../', import.meta.url);
const d = JSON.parse(await readFile(new URL('dist/imd-deployment.json', root)));
const abis = Object.fromEntries(await Promise.all(d.contracts.map(async c => [c.address.toLowerCase(), JSON.parse(await readFile(new URL(`dist/${c.abiPath}`, root)))])));
const token = d.contracts.find(c => c.name === 'LaunchToken').address;
const app = d.contracts.find(c => c.name === 'HarbergerBillboard').address;
const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const hash = `0x${'ab'.repeat(32)}`;

function fixture(options = {}) {
  const f = {
    account: alice, chain: d.chainId, connected: false, holder: zeroAddress, message: stringToHex('', { size: 32 }),
    price: 0n, deposit: 0n, tax: 0n, runway: 0n, balance: parseEther('1000'), allowance: 0n,
    credit: 0n, sent: [], calls: [], walletCalls: [], unknownChain: false, reject: false, fail: false,
    code: '0x60006000', revert: false, receiptFail: false, ...options,
  };
  f.rpc = async ({ method, params = [] }, wallet = false) => {
    (wallet ? f.walletCalls : f.calls).push({ method, params });
    if (f.fail && !wallet) throw Object.assign(Error('RPC unavailable'), { code: -32000 });
    if (method === 'eth_chainId') return toHex(wallet ? f.chain : d.chainId);
    if (method === 'eth_accounts') return f.connected ? [f.account] : [];
    if (method === 'eth_requestAccounts') {
      if (f.reject) throw Object.assign(Error('User rejected the request'), { code: 4001 });
      f.connected = true; return [f.account];
    }
    if (method === 'wallet_switchEthereumChain') {
      if (f.unknownChain) throw Object.assign(Error('Unknown chain'), { code: 4902 });
      f.chain = Number(params[0].chainId); return null;
    }
    if (method === 'wallet_addEthereumChain') { assert.deepEqual(params[0], d.walletAddChain); f.unknownChain = false; return null; }
    if (method === 'eth_blockNumber') return '0xb3e000';
    if (method === 'eth_getBlockByNumber') return { number: '0xb3e000', hash, parentHash: hash, timestamp: '0x69000000', gasLimit: '0x1c9c380', gasUsed: '0x0', baseFeePerGas: '0x1', difficulty: '0x0', totalDifficulty: '0x0', size: '0x0', extraData: '0x', transactions: [], uncles: [], miner: zeroAddress, nonce: '0x0000000000000000', logsBloom: `0x${'00'.repeat(256)}`, receiptsRoot: hash, stateRoot: hash, transactionsRoot: hash, sha3Uncles: hash, mixHash: hash };
    if (method === 'eth_getCode') return f.code;
    if (method === 'eth_getTransactionReceipt') return { transactionHash: hash, transactionIndex: '0x0', blockHash: hash, blockNumber: '0xb3e000', from: alice, to: app, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: f.receiptFail ? '0x0' : '0x1', type: '0x2' };
    if (method === 'eth_call' || method === 'eth_sendTransaction') {
      const tx = params[0];
      const abi = abis[tx.to.toLowerCase()];
      const { functionName: fn, args = [] } = decodeFunctionData({ abi, data: tx.data });
      const views = { token, state: [f.holder, f.message, f.price, f.deposit, 1761607680n], taxDue: f.tax, runwaySeconds: f.runway, MIN_PRICE: parseEther('1'), MAX_PRICE: parseEther('1000000000'), TAX_RATE_BPS: 1000n, TAX_PERIOD: 31536000n, BPS: 10000n, decimals: 18, balanceOf: f.balance, allowance: f.allowance, withdrawable: f.credit };
      if (Object.hasOwn(views, fn)) return encodeFunctionResult({ abi, functionName: fn, result: views[fn] });
      if (method === 'eth_call') {
        if (f.revert || (fn === 'buy' && f.price > args[1])) throw Object.assign(Error('execution reverted'), { code: 3, data: encodeErrorResult({ abi: abis[app], errorName: 'PriceAboveMax', args: [f.price, args[1] ?? 0n] }) });
        return fn === 'approve' ? encodeFunctionResult({ abi, functionName: fn, result: true }) : '0x';
      }
      if (f.reject) throw Object.assign(Error('User rejected the request'), { code: 4001 });
      f.sent.push({ fn, args, to: tx.to, from: tx.from });
      if (!f.receiptFail) {
        if (fn === 'approve') { assert.equal(args[0].toLowerCase(), app); f.allowance = args[1]; }
        if (fn === 'buy') { f.balance -= f.price + args[3]; f.allowance -= f.price + args[3]; f.holder = f.account; f.price = args[0]; f.deposit = args[3]; f.message = args[2]; f.tax = 0n; f.runway = 31536000n; }
        if (fn === 'setPrice') f.price = args[0];
        if (fn === 'setMessage') f.message = args[0];
        if (fn === 'addDeposit') { f.deposit += args[0]; f.balance -= args[0]; f.allowance -= args[0]; }
        if (fn === 'withdrawDeposit') { f.deposit -= args[0]; f.balance += args[0]; }
        if (fn === 'withdraw') { f.balance += f.credit; f.credit = 0n; }
        if (fn === 'settle') { f.deposit -= f.tax; f.tax = 0n; if (f.runway === 0n) { f.holder = zeroAddress; f.message = stringToHex('', { size: 32 }); f.price = 0n; f.deposit = 0n; } }
      }
      return hash;
    }
    throw Error(`Unhandled RPC ${method}`);
  };
  return f;
}

test('Production export: browser interactions, responsive layout, accessibility and transaction guards', { timeout: 240000 }, async t => {
  const report = { checkedAt: new Date().toISOString(), browser: '', scenarios: [], errors: [], viewports: [], axe: [], contrast: [] };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (!path.startsWith('/preview/') || path.includes('..')) { res.writeHead(404).end(); return; }
      const file = new URL(`dist/${path.slice(9) || 'index.html'}`, root);
      res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : file.pathname.endsWith('.css') ? 'text/css' : file.pathname.endsWith('.json') ? 'application/json' : 'text/html');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.BILLBOARD_CHROMIUM || '/opt/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
  report.browser = await browser.version();
  const url = `http://127.0.0.1:${server.address().port}/preview/`;
  const pages = [];
  async function open(f, wallet = true, ready = true) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    page.on('response', response => { if (response.url().startsWith(url) && response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    if (f.badAbi) await page.route('**/abi/LaunchToken.json', route => route.fulfill({ json: [] }));
    await page.route(/https:\/\//, async route => {
      const req = route.request();
      if (!d.network.rpcUrls.some(u => req.url().startsWith(u))) return route.abort();
      const input = req.postDataJSON();
      const execute = async rpc => {
        try { return { jsonrpc: '2.0', id: rpc.id, result: await f.rpc(rpc) }; }
        catch (e) { return { jsonrpc: '2.0', id: rpc.id, error: { code: e.code ?? -32000, message: e.message, data: e.data } }; }
      };
      await route.fulfill({ json: Array.isArray(input) ? await Promise.all(input.map(execute)) : await execute(input) });
    });
    if (wallet) {
      await page.exposeFunction('__walletRequest', async request => {
        try { return { result: await f.rpc(request, true) }; }
        catch (e) { return { error: { code: e.code, message: e.message } }; }
      });
      await page.addInitScript(() => {
        const listeners = {};
        window.__emit = (event, value) => (listeners[event] ?? []).forEach(fn => fn(value));
        window.ethereum = {
          request: async input => { const out = await window.__walletRequest(input); if (out.error) throw out.error; return out.result; },
          on: (event, fn) => (listeners[event] ??= []).push(fn),
          removeListener: (event, fn) => { listeners[event] = (listeners[event] ?? []).filter(x => x !== fn); },
        };
      });
    }
    await page.goto(url);
    if (ready) await expect(page.getByText('Read at block', { exact: false })).toBeVisible();
    return page;
  }
  async function keyboardTo(page, locator) {
    for (let i = 0; i < 90; i++) {
      if (await locator.evaluate(el => el === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    throw Error(`Unable to reach ${await locator.textContent()} by keyboard`);
  }
  async function connect(page) { await page.getByRole('button', { name: 'Connect wallet' }).click(); await expect(page.locator('.wallet-address')).toBeVisible(); }
  async function confirmed(page, label) { await expect(page.getByRole('status')).toContainText(`${label}: confirmed`, { timeout: 12000 }); }
  try {
    await t.test('No wallet, disconnected state, keyboard focus, responsive layout, contrast and axe', async () => {
      const f = fixture();
      const page = await open(f, false);
      await expect(page.getByRole('button', { name: 'Buy billboard' })).toBeDisabled();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
      await page.screenshot({ path: new URL('docs/evidence/keyboard-focus.png', root).pathname });
      await page.keyboard.press('Tab');
      await page.getByRole('button', { name: 'Connect wallet' }).click();
      await expect(page.getByRole('alert')).toContainText('No browser wallet found');
      for (const width of [1440, 820, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
        report.viewports.push({ width, height: 1000, horizontalOverflow: false });
        if ([1440, 390, 320].includes(width)) await page.screenshot({ path: new URL(`docs/evidence/disconnected-${width}.png`, root).pathname, fullPage: true });
      }
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe.push({ state: 'disconnected, 320px', violations: axe.violations });
      assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations));
      report.contrast = await page.evaluate(() => {
        const lum = rgb => { const c = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
        return ['.intro > p', '.board-message', '.board-badge', '.board-bottom', '.field label', '.help', '.connect'].map(selector => {
          const el = document.querySelector(selector), style = getComputedStyle(el);
          let ancestor = el;
          while (getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)' && ancestor.parentElement) ancestor = ancestor.parentElement;
          const background = getComputedStyle(ancestor).backgroundColor, color = style.color;
          const [a, b] = [lum(color), lum(background)].sort((x, y) => y - x);
          return { selector, color, background, ratio: Number(((a + .05) / (b + .05)).toFixed(2)) };
        });
      });
      assert(report.contrast.every(pair => pair.ratio >= 4.5));
      await page.setViewportSize({ width: 820, height: 1000 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dir = 'rtl'; });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.getByRole('button', { name: 'Connect wallet' }).evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      report.scenarios.push('Disconnected + missing wallet; keyboard skip-link focus; five responsive widths; 200% text resize; RTL layout stress; reduced motion; computed contrast; axe');
      await page.close();
    });
    await t.test('Unknown chain fallback, allowance then buy, every holder action, withdrawal and events', async () => {
      const f = fixture({ chain: 1, unknownChain: true, credit: parseEther('7') });
      const page = await open(f);
      await connect(page);
      await expect(page.getByText('Wrong network', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Approve BILL', exact: false }).first()).toBeDisabled();
      await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
      await expect(page.getByRole('button', { name: 'Approve BILL', exact: false }).first()).toBeEnabled();
      assert.deepEqual(f.walletCalls.filter(c => c.method.startsWith('wallet_')).map(c => c.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
      await keyboardTo(page, page.getByLabel('Your message', { exact: true }));
      await page.keyboard.type('Make space for good ideas.');
      await keyboardTo(page, page.getByRole('button', { name: 'Approve BILL', exact: false }).first());
      await page.screenshot({ path: new URL('docs/evidence/approval-focus.png', root).pathname });
      await page.keyboard.press('Enter');
      await confirmed(page, 'Approve BILL');
      assert.equal(f.sent[0].fn, 'approve'); assert.equal(f.sent[0].args[1], parseEther('10')); assert.equal(f.sent[0].to.toLowerCase(), token);
      await keyboardTo(page, page.getByRole('button', { name: 'Buy billboard' }));
      await page.keyboard.press('Enter');
      await confirmed(page, 'Buy billboard');
      await expect(page.locator('.board-message')).toHaveText('Make space for good ideas.');
      assert.deepEqual(f.sent[1].args, [parseEther('100'), 0n, stringToHex('Make space for good ideas.', { size: 32 }), parseEther('10')]);
      await expect(page.getByRole('button', { name: 'Buy billboard' })).toBeDisabled();
      await page.getByText('Manage your billboard', { exact: false }).click();
      await page.getByLabel('Set message', { exact: true }).fill('Hello, public space.');
      await page.getByRole('button', { name: 'Set message', exact: true }).click(); await confirmed(page, 'Set message');
      await page.getByLabel('Set asking price', { exact: true }).fill('200');
      await page.getByRole('button', { name: 'Set asking price', exact: true }).click(); await confirmed(page, 'Set asking price');
      await page.getByLabel('Add deposit', { exact: true }).fill('5');
      await page.getByRole('button', { name: 'Approve BILL', exact: false }).last().click(); await confirmed(page, 'Approve BILL');
      await page.getByRole('button', { name: 'Add deposit', exact: false }).click(); await confirmed(page, 'Add deposit');
      await page.getByLabel('Withdraw deposit', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Withdraw deposit', exact: true }).click(); await confirmed(page, 'Withdraw deposit');
      await page.getByRole('button', { name: 'Withdraw BILL' }).click(); await confirmed(page, 'Withdraw BILL');
      await expect(page.getByRole('button', { name: 'Withdraw BILL' })).toBeDisabled();
      await page.getByText('Live state & contract details', { exact: false }).click();
      await page.getByRole('button', { name: 'Settle tax' }).click(); await confirmed(page, 'Settle tax');
      assert.deepEqual(f.sent.map(c => c.fn), ['approve', 'buy', 'setMessage', 'setPrice', 'approve', 'addDeposit', 'withdrawDeposit', 'withdraw', 'settle']);
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe.push({ state: 'connected holder, all disclosures open', violations: axe.violations });
      assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations));
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
      await page.screenshot({ path: new URL('docs/evidence/holder-desktop.png', root).pathname, fullPage: true });
      f.account = bob; await page.evaluate(b => window.__emit('accountsChanged', [b]), bob);
      await expect(page.getByRole('button', { name: 'Set message', exact: true })).toBeDisabled();
      f.chain = 1; await page.evaluate(() => window.__emit('chainChanged', '0x1'));
      await expect(page.getByRole('button', { name: 'Switch to Sepolia' })).toBeVisible();
      await page.evaluate(() => window.__emit('disconnect'));
      await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
      report.scenarios.push('4902 → exact wallet_addEthereumChain → switch; exact approval spender/amount; keyboard message, approval and buy; all seven app mutations; receipt refresh; holder gating; account/chain/disconnect events; connected axe');
      await page.close();
    });
    await t.test('Validation, rejects, insufficient funds, stale price, simulation revert, RPC failure and missing code', async () => {
      const f = fixture({ holder: bob, price: parseEther('25'), deposit: parseEther('10'), runway: 1000n });
      const page = await open(f);
      f.reject = true; await page.getByRole('button', { name: 'Connect wallet' }).click();
      await expect(page.getByRole('alert')).toContainText('Request rejected');
      f.reject = false; await connect(page);
      await page.getByRole('button', { name: 'Use current purchase price' }).click();
      await page.getByLabel('Your asking price', { exact: true }).fill('0');
      await page.getByRole('button', { name: 'Approve BILL', exact: false }).first().click();
      await expect(page.getByLabel('Your asking price', { exact: true })).toBeFocused();
      await expect(page.getByRole('alert')).toContainText('amount greater than zero');
      await page.getByLabel('Your asking price', { exact: true }).fill('100');
      await page.getByLabel('Your message', { exact: true }).fill('🌱'.repeat(9));
      await page.getByRole('button', { name: 'Approve BILL', exact: false }).first().click();
      await expect(page.getByRole('alert')).toContainText('32 UTF-8 bytes');
      await page.getByLabel('Your message', { exact: true }).fill('Plain text <script> & safe');
      f.reject = true;
      await page.getByRole('button', { name: 'Approve BILL', exact: false }).first().click();
      await expect(page.getByRole('alert')).toContainText('Request rejected');
      assert.equal(f.sent.length, 0);
      f.reject = false;
      await page.getByRole('button', { name: 'Approve BILL', exact: false }).first().click(); await confirmed(page, 'Approve BILL');
      assert.equal(f.allowance, parseEther('35'));
      f.price = parseEther('26');
      await page.getByRole('button', { name: 'Buy billboard' }).click();
      await expect(page.getByRole('alert')).toContainText('current price is above your limit');
      assert.equal(f.sent.length, 1);
      f.price = parseEther('25'); f.revert = true;
      await page.getByRole('button', { name: 'Refresh state' }).click();
      await expect(page.locator('.market-stats .stat').first()).toContainText('25');
      await page.getByRole('button', { name: 'Buy billboard' }).click();
      await expect(page.getByRole('alert')).toContainText('current price is above your maximum');
      assert.equal(f.sent.length, 1);
      f.revert = false; f.balance = 1n;
      await page.getByRole('button', { name: 'Refresh state' }).click();
      await expect(page.getByRole('button', { name: 'Buy billboard' })).toBeDisabled();
      await expect(page.getByText('Your BILL balance is below this limit.', { exact: false }).first()).toBeVisible();
      f.code = '0x';
      await page.getByRole('button', { name: 'Refresh state' }).click();
      await expect(page.getByText('Deployed code could not be verified.', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Buy billboard' })).toBeDisabled();
      f.code = '0x6000'; f.fail = true;
      // Wallet fallback also unavailable for this scenario.
      const original = f.rpc; f.rpc = async (input, wallet) => { if (wallet && !['eth_chainId','eth_accounts'].includes(input.method)) throw Error('Wallet RPC unavailable'); return original(input, wallet); };
      await page.getByRole('button', { name: 'Refresh state' }).click();
      await expect(page.getByText('Live state unavailable. Actions are disabled.')).toBeVisible({ timeout: 20000 });
      report.scenarios.push('Connect/sign rejection; zero amount; UTF-8 byte limit; max-price rise before payment; decoded simulation revert without signing; insufficient balance; missing code; all RPCs failing');
      await page.close();
    });
    await t.test('Tampered ABI prevents runtime initialization and reverted receipt never reports success', async () => {
      const invalid = await open(fixture({ badAbi: true }), false, false);
      await expect(invalid.getByRole('alert')).toContainText('ABI verification failed for LaunchToken');
      await expect(invalid.getByRole('button', { name: 'Buy billboard' })).toBeDisabled();
      await invalid.close();
      const f = fixture({ connected: true, credit: parseEther('7'), receiptFail: true });
      const page = await open(f);
      await page.getByRole('button', { name: 'Withdraw BILL' }).click();
      await expect(page.getByRole('alert')).toContainText('transaction reverted onchain');
      await expect(page.getByRole('status')).not.toContainText('confirmed');
      await expect(page.getByRole('link', { name: 'View transaction' })).toBeVisible();
      report.scenarios.push('ABI tamper blocks initialization; reverted receipt retains explorer link and never reports confirmation');
      await page.close();
    });
    await t.test('Foreclosed purchase costs only deposit and withdrawn-deposit bounds', async () => {
      const f = fixture({ holder: alice, price: parseEther('50'), deposit: parseEther('2'), tax: parseEther('2'), runway: 0n });
      const page = await open(f); await connect(page);
      await expect(page.getByText('Ready for foreclosure', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Use current purchase price' }).click();
      await expect(page.getByLabel('Maximum purchase price')).toHaveValue('0');
      f.runway = 1000n; f.tax = parseEther('1');
      await page.getByRole('button', { name: 'Refresh state' }).click();
      await expect(page.getByText('On display', { exact: true })).toBeVisible();
      await page.getByText('Manage your billboard', { exact: false }).click();
      await page.getByLabel('Withdraw deposit', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Withdraw deposit', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('deposit remaining after accrued tax');
      assert.equal(f.sent.length, 0);
      report.scenarios.push('Exhausted deposit projects zero purchase price; existing holder loses edit eligibility; withdrawDeposit respects post-tax bounds');
      await page.close();
    });
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  } finally {
    await mkdir(new URL('docs/evidence/', root), { recursive: true });
    await writeFile(new URL('docs/evidence/browser-results.json', root), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
