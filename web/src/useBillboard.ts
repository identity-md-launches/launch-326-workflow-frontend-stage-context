import { useCallback, useEffect, useRef, useState } from 'react';
import { type Address, type Hex } from 'viem';
import { contract, loadDeployment, reader, signer, switchNetwork, type Deployment, type Provider } from './config';
import { errorText, isEmpty, readState, type Snapshot } from './model';

export type Action = { label: string; functionName: string; args?: readonly unknown[]; approve?: bigint; debit?: bigint; holderOnly?: boolean; buy?: boolean };
export function useBillboard() {
  const [deployment, setDeployment] = useState<Deployment>();
  const [configError, setConfigError] = useState('');
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const generation = useRef(0);
  const pending = useRef(false);
  const provider = useRef<Provider | undefined>(window.ethereum);
  const session = useRef({ account, chainId });
  session.current = { account, chainId };

  const init = useCallback(async () => {
    setConfigError('');
    try { setDeployment(await loadDeployment()); }
    catch (e) { setConfigError(errorText(e)); setLoading(false); }
  }, []);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const syncWallet = useCallback(async (request = false) => {
    const p = window.ethereum;
    provider.current = p;
    if (!p) throw Error('No browser wallet found. Install an Ethereum wallet or open this page in its browser, then connect again.');
    const accounts = await p.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' });
    const chain = await p.request({ method: 'eth_chainId' });
    if (session.current.account !== accounts[0] || session.current.chainId !== Number(chain)) {
      generation.current++;
      setSnapshot(undefined);
    }
    setAccount(accounts[0]);
    setChainId(Number(chain));
    session.current = { account: accounts[0], chainId: Number(chain) };
  }, []);

  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const change = () => { generation.current++; setSnapshot(undefined); void syncWallet().catch(e => setError(errorText(e))); };
    const disconnect = () => { generation.current++; setAccount(undefined); setChainId(undefined); setSnapshot(undefined); session.current = { account: undefined, chainId: undefined }; };
    p.on?.('accountsChanged', change); p.on?.('chainChanged', change); p.on?.('disconnect', disconnect);
    void syncWallet().catch(() => {});
    return () => { p.removeListener?.('accountsChanged', change); p.removeListener?.('chainChanged', change); p.removeListener?.('disconnect', disconnect); };
  }, [syncWallet]);

  const refresh = useCallback(async () => {
    if (!deployment) return;
    const id = ++generation.current;
    setLoading(true);
    try {
      const data = await readState(deployment, account, chainId === deployment.chainId ? provider.current : undefined);
      if (id === generation.current) { setSnapshot(data); setReadError(''); }
    } catch (e) {
      if (id === generation.current) { setReadError(errorText(e)); setSnapshot(undefined); }
    } finally { if (id === generation.current) setLoading(false); }
  }, [deployment, account, chainId]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 20000);
    return () => { generation.current++; clearInterval(interval); };
  }, [refresh]);

  async function connect() {
    setError('');
    try { await syncWallet(true); setStatus('Wallet connected. Check the network and balances before continuing.'); }
    catch (e) { setError(errorText(e)); }
  }
  async function switchChain() {
    if (!deployment || !provider.current) return;
    setError(''); setBusy(true);
    try { await switchNetwork(deployment, provider.current); await syncWallet(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const fresh = !!snapshot && tick - snapshot.loadedAt < 45000 && snapshot.account === account;
  const canSend = !!account && chainId === deployment?.chainId && fresh && !busy;

  async function transact(makeAction: (fresh: Snapshot) => Action) {
    if (pending.current || !canSend || !deployment || !account || !provider.current) return;
    pending.current = true; setBusy(true); setError(''); setTxHash(undefined);
    const d = deployment, a = account, p = provider.current;
    const id = generation.current;
    const assertSession = async () => {
      const accounts = await p.request({ method: 'eth_accounts' });
      const chain = Number(await p.request({ method: 'eth_chainId' }));
      if (accounts[0]?.toLowerCase() !== a.toLowerCase() || chain !== d.chainId || session.current.account?.toLowerCase() !== a.toLowerCase() || session.current.chainId !== d.chainId) throw Error('Wallet account or network changed. Refresh and review the action again.');
    };
    let sent = false;
    let signing = false;
    let replaced = false;
    try {
      setStatus('Checking current state and simulating the transaction…');
      await assertSession();
      const current = await readState(d, a, p);
      const action = makeAction(current);
      const holder = current.holder.toLowerCase() === a.toLowerCase() && !isEmpty(current);
      if (action.holderOnly && !holder) throw Error('Only the active holder can do this. Refresh the billboard state.');
      if (action.buy && holder) throw Error('You already hold the billboard. Use the holder controls.');
      if (action.debit && current.balance < action.debit) throw Error('Your BILL balance is below the payment limit. Reduce the amount or obtain more BILL.');
      if (action.debit && current.allowance < action.debit) throw Error('Approve the BILL payment limit first, then submit this action.');
      const target = action.approve !== undefined
        ? { ...contract(d, 'LaunchToken'), address: current.tokenAddress }
        : contract(d, 'HarbergerBillboard');
      const client = reader(d, p);
      const args = action.approve !== undefined ? [contract(d, 'HarbergerBillboard').address, action.approve] : action.args;
      const { request } = await client.simulateContract({ ...target, functionName: action.functionName, args, account: a });
      await assertSession();
      setStatus(`${action.label}: review and confirm in your wallet.`);
      signing = true;
      const hash = await signer(d, p).writeContract(request);
      sent = true; setTxHash(hash); setStatus(`${action.label}: submitted. Waiting for confirmation…`);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1500, onReplaced: replacement => {
        setTxHash(replacement.transaction.hash);
        if (replacement.reason !== 'repriced') replaced = true;
      } });
      if (receipt.status !== 'success') throw Error('The transaction reverted onchain. No action was applied; gas may have been spent. Refresh and review the state.');
      setStatus(replaced ? 'The transaction was cancelled or replaced in your wallet. Check the explorer and refreshed state before retrying.' : `${action.label}: confirmed. Balances and billboard state are refreshing.`);
      if (id === generation.current || (session.current.account === a && session.current.chainId === d.chainId)) await refresh();
    } catch (e) {
      setStatus(sent ? 'Transaction submitted. Check its explorer status before trying again.' : signing ? 'Check your wallet activity before retrying this request.' : 'No transaction was submitted.');
      setError(errorText(e));
    } finally { pending.current = false; setBusy(false); }
  }
  const gate = !account ? 'Connect your wallet to use the billboard.'
    : chainId !== deployment?.chainId ? `Switch to ${deployment?.network.name ?? 'the deployment network'} to enable actions.`
    : !fresh ? 'Waiting for verified live state. Refresh if this takes too long.'
    : busy ? 'Finish the current wallet request before starting another action.' : '';
  return { deployment, configError, init, account, chainId, snapshot, readError, error, status, txHash, busy, loading, tick, refresh, connect, switchChain, canSend, gate, transact };
}
