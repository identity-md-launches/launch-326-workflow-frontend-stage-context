import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
const root = new URL('../../', import.meta.url);
const d = JSON.parse(await readFile(new URL('dist/imd-deployment.json', root)));
const results = [];
for (const url of d.network.rpcUrls) {
  const entry = { url };
  try {
    const c = createPublicClient({ transport: http(url, { timeout: 8000, retryCount: 0 }) });
    entry.chainId = await c.getChainId();
    if (entry.chainId !== d.chainId) throw Error('Wrong RPC chain');
    const block = await c.getBlock();
    entry.block = String(block.number);
    entry.contracts = [];
    for (const contract of d.contracts) {
      const code = await c.getCode({ address: contract.address, blockNumber: block.number });
      if (!code || code === '0x') throw Error(`Missing code: ${contract.name}`);
      entry.contracts.push({ name: contract.name, address: contract.address, runtimeBytes: (code.length - 2) / 2 });
    }
    const app = d.contracts.find(x => x.name === 'HarbergerBillboard');
    const token = d.contracts.find(x => x.name === 'LaunchToken');
    const abi = JSON.parse(await readFile(new URL(`dist/${app.abiPath}`, root)));
    entry.token = await c.readContract({ address: app.address, abi, functionName: 'token', blockNumber: block.number });
    if (entry.token.toLowerCase() !== token.address.toLowerCase()) throw Error('Token mismatch');
    entry.state = await c.readContract({ address: app.address, abi, functionName: 'state', blockNumber: block.number });
    entry.taxDue = await c.readContract({ address: app.address, abi, functionName: 'taxDue', blockNumber: block.number });
    entry.runwaySeconds = await c.readContract({ address: app.address, abi, functionName: 'runwaySeconds', blockNumber: block.number });
  } catch (e) { entry.error = e.shortMessage ?? e.message; }
  results.push(entry);
}
const output = { checkedAt: new Date().toISOString(), kind: 'Read-only RPC check; no transactions broadcast', results };
await writeFile(new URL('docs/evidence/live-read.json', root), JSON.stringify(output, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n');
console.log(JSON.stringify(output, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
if (results.every(x => x.error)) process.exitCode = 1;
