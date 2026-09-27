import assert from 'node:assert/strict';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { abiHash } from './canonical.mjs';

const root = new URL('../../', import.meta.url);
const dist = new URL('dist/', root);
const read = async path => JSON.parse(await readFile(new URL(path, root)));
const h = await read('web/deployment/handoff.json');
const n = await read('web/deployment/network.json');
const m = await read('dist/imd-deployment.json');
assert.equal(m.version, 1);
for (const key of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.deepEqual(m[key], h[key]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(m.contracts.map(({ abiPath, ...c }) => c), h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
for (const c of m.contracts) {
  assert.match(c.abiPath, /^abi\/[A-Za-z0-9]+\.json$/);
  assert.equal(abiHash(await read(`dist/${c.abiPath}`)), c.abiHash);
  assert.deepEqual(await readFile(new URL(c.abiPath, dist)), await readFile(new URL(`docs/abi/${c.name}.json`, root)));
}
const files = (await readdir(dist, { recursive: true })).filter(p => p !== 'imd-deployment.json');
const actual = [];
let totalBytes = (await lstat(new URL('imd-deployment.json', dist))).size;
for (const path of files) {
  const stat = await lstat(new URL(path, dist));
  assert(!stat.isSymbolicLink());
  if (!stat.isFile()) continue;
  actual.push(path);
  assert(stat.size <= 8388608);
  totalBytes += stat.size;
  const declared = m.assets.find(a => a.path === path);
  assert(declared, `Unlisted file ${path}`);
  assert.equal(declared.sha256, createHash('sha256').update(await readFile(new URL(path, dist))).digest('hex'));
}
assert.deepEqual(actual.sort(), m.assets.map(a => a.path).sort());
assert(actual.includes('index.html') && actual.length <= 128 && totalBytes < 32 * 1024 * 1024);
assert(!m.assets.some(a => a.path.includes('..') || a.path.startsWith('/') || a.path.includes('://')));
const result = { checkedAt: new Date().toISOString(), assets: actual.length, totalBytes, checks: ['Exact handoff identifiers and contract set', 'Unchanged network and walletAddChain', 'Pinned ABI bytes and canonical Keccak', 'Complete SHA-256 inventory', 'Relative paths, no symlinks, asset count and size limits'] };
await writeFile(new URL('docs/evidence/export-integrity.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
