import { createPublicClient, createWalletClient, custom, defineChain, fallback, http, isAddress, keccak256, toHex, type Abi, type Address, type EIP1193Provider } from 'viem';

export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
export type Contract = { name: string; address: Address; abiPath: string; abiHash: string; abi: Abi };
export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: Contract[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: { chainId: `0x${string}`; chainName: string; rpcUrls: string[]; nativeCurrency: Deployment['network']['nativeCurrency']; blockExplorerUrls: string[] };
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) throw Error(`Unable to load ${path}. Reload or check the static export.`);
  return response.json();
}
export async function loadDeployment(): Promise<Deployment> {
  const d: Deployment = await json('imd-deployment.json');
  if (d.version !== 1 || d.chainId !== d.network.chainId || d.chainId !== Number(d.walletAddChain.chainId)) throw Error('Deployment network does not match. Transactions are disabled.');
  if (d.contracts.length !== 2 || new Set(d.contracts.map(c => c.name)).size !== 2 || !['LaunchToken', 'HarbergerBillboard'].every(n => d.contracts.some(c => c.name === n))) throw Error('The deployment contract set is incomplete.');
  d.contracts = await Promise.all(d.contracts.map(async c => {
    if (!isAddress(c.address) || !/^abi\/[A-Za-z0-9]+\.json$/.test(c.abiPath)) throw Error('Invalid deployment contract or ABI path.');
    const abi = await json(c.abiPath);
    if (!Array.isArray(abi) || keccak256(toHex(canonical(abi))).slice(2) !== c.abiHash) throw Error(`ABI verification failed for ${c.name}. Transactions are disabled.`);
    return { ...c, abi };
  }));
  return d;
}
export const contract = (d: Deployment, name: string) => d.contracts.find(c => c.name === name)!;
export function chainFor(d: Deployment) {
  return defineChain({ id: d.chainId, name: d.network.name, nativeCurrency: d.network.nativeCurrency, rpcUrls: { default: { http: d.network.rpcUrls } }, testnet: d.network.testnet });
}
export function reader(d: Deployment, provider?: Provider) {
  return createPublicClient({ chain: chainFor(d), transport: fallback([
    ...d.network.rpcUrls.map(url => http(url, { timeout: 4500, retryCount: 0 })),
    ...(provider ? [custom(provider, { retryCount: 0 })] : []),
  ], { retryCount: 0 }), batch: { multicall: false } });
}
export const signer = (d: Deployment, p: Provider) => createWalletClient({ chain: chainFor(d), transport: custom(p) });
export async function switchNetwork(d: Deployment, provider: Provider) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: d.walletAddChain.chainId }] });
  } catch (error) {
    const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message ?? '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [d.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: d.walletAddChain.chainId }] });
  }
}
