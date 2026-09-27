import { BaseError, ContractFunctionRevertedError, formatUnits, maxUint256, parseUnits, stringToHex, zeroAddress, type Address, type Hex } from 'viem';
import { contract, reader, type Deployment, type Provider } from './config';

export type Snapshot = {
  holder: Address; message: Hex; price: bigint; deposit: bigint; lastSettled: bigint;
  tax: bigint; runway: bigint; balance: bigint; allowance: bigint; withdrawable: bigint;
  minPrice: bigint; maxPrice: bigint; taxRate: bigint; taxPeriod: bigint; bps: bigint;
  decimals: number; block: bigint; timestamp: bigint; loadedAt: number; account?: Address; tokenAddress: Address;
};
export async function readState(d: Deployment, account?: Address, provider?: Provider): Promise<Snapshot> {
  const client = reader(d, provider);
  if (await client.getChainId() !== d.chainId) throw Error('RPC returned the wrong network. Try refreshing.');
  const block = await client.getBlock();
  const app = contract(d, 'HarbergerBillboard');
  const token = contract(d, 'LaunchToken');
  const [appCode, tokenCode, tokenAddress] = await Promise.all([
    client.getCode({ address: app.address, blockNumber: block.number }),
    client.getCode({ address: token.address, blockNumber: block.number }),
    client.readContract({ ...app, functionName: 'token', blockNumber: block.number }),
  ]);
  if (!appCode || appCode === '0x' || !tokenCode || tokenCode === '0x') throw Error('Deployed code could not be verified. Transactions are disabled.');
  if (String(tokenAddress).toLowerCase() !== token.address.toLowerCase()) throw Error('The billboard token does not match the attested BILL deployment.');
  // Use the token() result for all BILL reads and signing, after binding it to the handoff.
  const tokenAt = { ...token, address: tokenAddress as Address };
  const appRead = (functionName: string, args?: unknown[]) => client.readContract({ ...app, functionName, args, blockNumber: block.number });
  const tokenRead = (functionName: string, args?: unknown[]) => client.readContract({ ...tokenAt, functionName, args, blockNumber: block.number });
  const [state, tax, runway, minPrice, maxPrice, taxRate, taxPeriod, bps, decimals, balance, allowance, withdrawable] = await Promise.all([
    appRead('state'), appRead('taxDue'), appRead('runwaySeconds'), appRead('MIN_PRICE'), appRead('MAX_PRICE'), appRead('TAX_RATE_BPS'), appRead('TAX_PERIOD'), appRead('BPS'), tokenRead('decimals'),
    account ? tokenRead('balanceOf', [account]) : 0n,
    account ? tokenRead('allowance', [account, app.address]) : 0n,
    account ? appRead('withdrawable', [account]) : 0n,
  ]) as [[Address, Hex, bigint, bigint, bigint], bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint];
  return { holder: state[0], message: state[1], price: state[2], deposit: state[3], lastSettled: state[4], tax, runway, minPrice, maxPrice, taxRate, taxPeriod, bps, decimals, balance, allowance, withdrawable, block: block.number, timestamp: block.timestamp, loadedAt: Date.now(), account, tokenAddress: tokenAddress as Address };
}
export function amount(value: string, decimals: number, allowZero = false): bigint {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) throw Error(`Enter a BILL amount with up to ${decimals} decimal places.`);
  const n = parseUnits(value, decimals);
  if (n > maxUint256 || n < (allowZero ? 0n : 1n)) throw Error(allowZero ? 'Enter zero or a positive BILL amount.' : 'Enter a BILL amount greater than zero.');
  return n;
}
export function price(value: string, s: Snapshot) {
  const n = amount(value, s.decimals);
  if (n < s.minPrice || n > s.maxPrice) throw Error(`Set a price from ${formatUnits(s.minPrice, s.decimals)} to ${formatUnits(s.maxPrice, s.decimals)} BILL.`);
  return n;
}
export const byteLength = (s: string) => new TextEncoder().encode(s).length;
export function encodeMessage(s: string) {
  if (byteLength(s) > 32 || s.includes('\0')) throw Error('Use at most 32 UTF-8 bytes and no null characters. Emoji use multiple bytes.');
  return stringToHex(s, { size: 32 });
}
export function decodeMessage(h: Hex) {
  const bytes = new Uint8Array(h.slice(2).match(/../g)!.map(s => parseInt(s, 16)));
  const end = bytes.findIndex(b => b === 0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.slice(0, end));
}
export function bill(n: bigint, decimals = 18) {
  const s = formatUnits(n, decimals);
  const [whole, fraction] = s.split('.');
  if (n > 0n && n < 10n ** BigInt(Math.max(0, decimals - 4))) return '<0.0001';
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction.slice(0, 4).replace(/0+$/, '')}`.replace(/\.$/, '') : '');
}
export function runwayText(seconds: bigint) {
  if (seconds <= 0n) return '0s';
  const days = seconds / 86400n;
  return `${days ? `${days.toLocaleString()}d ` : ''}${seconds / 3600n % 24n}h ${seconds / 60n % 60n}m ${seconds % 60n}s`;
}
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const isEmpty = (s: Snapshot) => s.holder === zeroAddress || s.runway === 0n;
export function errorText(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const reasons: Record<string, string> = {
        PriceAboveMax: 'The current price is above your maximum. Refresh and review the purchase limit.',
        NotHolder: 'You are no longer the active holder. Refresh the billboard state.',
        AlreadyHolder: 'You already hold the billboard. Use the holder controls.',
        PriceOutOfBounds: 'The asking price must be from 1 to 1,000,000,000 BILL.',
        InsufficientDeposit: 'The deposit remaining after tax is too small. Refresh and reduce the withdrawal.',
        NothingToWithdraw: 'No credited BILL is available. Refresh your balance.',
        ZeroAmount: 'Enter a BILL amount greater than zero.',
        ERC20InsufficientBalance: 'Your BILL balance is too low. Reduce the payment or obtain more BILL.',
        ERC20InsufficientAllowance: 'Approve the BILL payment limit first, then retry.',
      };
      const name = revert.data?.errorName;
      return name && reasons[name] ? reasons[name] : `${revert.reason ?? name ?? 'Contract simulation reverted'}. Refresh and review the action before retrying.`;
    }
  }
  const e = error as { code?: number; shortMessage?: string; message?: string; cause?: unknown };
  if (e.code === 4001 || /user rejected|user denied/i.test(e.shortMessage ?? e.message ?? '')) return 'Request rejected in your wallet. Nothing was signed; you can try again.';
  const text = e.shortMessage ?? e.message ?? 'Unable to complete the request. Check your connection and retry.';
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}
