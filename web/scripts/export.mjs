import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { abiHash } from './canonical.mjs';

const root = new URL('../../', import.meta.url);
const handoff = JSON.parse(await readFile(new URL('web/deployment/handoff.json', root)));
const network = JSON.parse(await readFile(new URL('web/deployment/network.json', root)));
if (handoff.chainId !== network.network.chainId || Number(network.walletAddChain.chainId) !== handoff.chainId) throw Error('Chain mismatch');
const dist = new URL('dist/', root);
await mkdir(new URL('abi/', dist), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(c.name)) throw Error('Unsafe contract name');
  const path = `docs/abi/${c.name}.json`;
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${path}`], { cwd: root });
  const current = await readFile(new URL(path, root));
  if (!pinned.equals(current)) throw Error(`ABI differs from pinned source: ${c.name}`);
  if (!Array.isArray(JSON.parse(pinned)) || abiHash(JSON.parse(pinned)) !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name}`);
  const abiPath = `abi/${c.name}.json`;
  await writeFile(new URL(abiPath, dist), pinned);
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath });
}
async function inventory(dir, prefix = '') {
  const assets = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${prefix}${e.name}`;
    if (e.isSymbolicLink()) throw Error('Symlinks are not export assets');
    if (e.isDirectory()) assets.push(...await inventory(new URL(`${e.name}/`, dir), `${path}/`));
    else if (path !== 'imd-deployment.json') {
      const bytes = await readFile(new URL(e.name, dir));
      if (bytes.length > 8388608) throw Error(`Asset too large: ${path}`);
      assets.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return assets.sort((a, b) => a.path.localeCompare(b.path));
}
const assets = await inventory(dist);
if (assets.length > 128) throw Error('Too many assets');
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
await writeFile(new URL('imd-deployment.json', dist), JSON.stringify({
  version: 1, launchId, chainId, sourceCommit, attestationHash, contracts, assets,
  network: network.network, walletAddChain: network.walletAddChain,
}, null, 2) + '\n');
console.log(`Verified pinned ABIs; exported deployment manifest with ${assets.length} assets.`);
