import { formatUnits, zeroAddress } from 'viem';
import { BuyForm, HolderControls, Stat } from './forms';
import { bill, decodeMessage, isEmpty, runwayText, shortAddress } from './model';
import { useBillboard } from './useBillboard';

export function App() {
  const app = useBillboard();
  const { deployment: d, snapshot: s, account, chainId, canSend, tick } = app;
  const empty = s && isEmpty(s);
  const holder = !!s && !empty && s.holder.toLowerCase() === account?.toLowerCase();
  const elapsed = s ? BigInt(Math.max(0, Math.floor((tick - s.loadedAt) / 1000))) : 0n;
  const seconds = s && s.runway > elapsed ? s.runway - elapsed : 0n;
  const fmt = (n?: bigint) => n === undefined ? '—' : bill(n, s?.decimals);
  const explorer = d?.network.explorer;
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header wrap">
      <a className="brand" href="#main" aria-label="Billboard home"><span className="brand-icon" aria-hidden="true"><i /><i /><i /><i /></span>Billboard<span className="brand-tag">A shared public space</span></a>
      <div className="wallet-controls"><span className="network-pill"><span aria-hidden="true" className="dot" />{d ? `${d.network.name} testnet` : 'Loading network…'}</span>
        {account ? <a className="wallet-address" href={`${explorer}/address/${account}`} title={account}>{shortAddress(account)} ↗</a> : <button className="connect" onClick={() => void app.connect()} disabled={app.busy}>Connect wallet <span aria-hidden="true">↗</span></button>}
      </div>
    </header>

    <main id="main" className="wrap">
      <div className="intro"><div><p className="eyebrow">An onchain experiment · No. 001</p><h1>A public space.<br /><span>At your price.</span></h1></div><p>One billboard. Anyone can buy it.<br />Set your message, name your price,<br className="desktop-break" /> and pay a little tax to keep it here.</p></div>

      {app.configError && <div className="alert" role="alert"><strong>Deployment unavailable</strong><p>{app.configError}</p><button onClick={() => void app.init()}>Reload deployment</button></div>}
      {account && d && chainId !== d.chainId && <div className="notice network-notice"><div><strong>Wrong network</strong><p>Your wallet is on chain {chainId ?? 'unknown'}. Actions need {d.network.name}.</p></div><button onClick={() => void app.switchChain()} disabled={app.busy}>Switch to {d.network.name}</button></div>}

      <section className="billboard" aria-labelledby="billboard-heading">
        <div className="board-top"><h2 id="billboard-heading">The billboard</h2><span className="board-badge">{!s ? 'Awaiting live state' : s.holder === zeroAddress ? 'Open for a message' : empty ? 'Ready for foreclosure' : 'On display'}</span></div>
        <div className="board-message" dir="auto">{!s ? 'A space worth sharing.' : empty ? <>Your words<br />could live here.</> : decodeMessage(s.message) || '(An intentionally blank message)'}</div>
        <div className="board-bottom"><span>{!s ? 'Connect or refresh to check availability.' : empty ? 'Buy the space. Start a conversation.' : 'This message belongs to the current holder.'}</span><span aria-hidden="true">BILLBOARD / 001</span></div>
      </section>
      <div className="board-foot"><span>Held by {s && s.holder !== zeroAddress ? <a href={`${explorer}/address/${s.holder}`} title={s.holder}>{shortAddress(s.holder)} ↗{holder ? ' (you)' : ''}</a> : s ? 'no one — be the first' : '—'}</span><span>Public by design. Available at a price.</span></div>

      <dl className="market-stats">
        <Stat label="Purchase price" note={empty ? 'Only your deposit is paid' : 'Paid to the previous holder'}>{fmt(s ? empty ? 0n : s.price : undefined)} <span>BILL</span></Stat>
        <Stat label="Tax deposit" note={s ? `${fmt(s.tax)} BILL accrued tax` : 'Before accrued tax'}>{fmt(s?.deposit)} <span>BILL</span></Stat>
        <Stat label="Annual tax" note="Of the asking price · burned">{s ? `${Number(s.taxRate) / Number(s.bps) * 100}%` : '—'}</Stat>
        <Stat label="Time remaining" note="Estimated until foreclosure"><span className="runway">{s ? runwayText(seconds) : '—'}</span></Stat>
      </dl>

      <div className="live-bar"><p>{app.loading ? 'Reading live contract state…' : s ? `Read at block ${s.block.toLocaleString()} · refreshes every 20 seconds` : 'Live state unavailable. Actions are disabled.'}</p><button className="text-button" onClick={() => void app.refresh()} disabled={app.loading || !d}>Refresh state <span aria-hidden="true">↻</span></button></div>
      {app.readError && <div className="alert" role="alert"><strong>Could not verify live state</strong><p>{app.readError}</p><p>Check your connection and refresh. No transaction can be started while state is unavailable.</p></div>}

      <div className="interaction-status" aria-live="polite" role="status">{app.status}{app.txHash && <a href={`${explorer}/tx/${app.txHash}`}>View transaction ↗</a>}</div>
      {app.error && <div className="alert" role="alert">{app.error}</div>}

      <div className="workspace">
        <section className="buy-panel panel" aria-label="Purchase the billboard"><BuyForm s={s} enabled={canSend} holder={holder} run={app.transact} />{app.gate && <p className="gate">{app.gate}</p>}</section>
        <aside className="sidebar" aria-label="Wallet and billboard management">
          <section className="wallet-panel panel"><div className="section-heading"><span className="eyebrow">Your account</span><h2>A little BILL goes a long way.</h2></div>
            <dl className="wallet-stats">
              <Stat label="BILL balance">{account ? fmt(s?.balance) : '—'} <span>BILL</span></Stat>
              <Stat label="Billboard allowance">{account ? fmt(s?.allowance) : '—'} <span>BILL</span></Stat>
              <Stat label="Withdrawable balance">{account ? fmt(s?.withdrawable) : '—'} <span>BILL</span></Stat>
            </dl>
            <p className="help">Sale proceeds and returned deposits are credited here. Withdraw them to your connected wallet.</p>
            <button className="full-width" disabled={!canSend || !s?.withdrawable} onClick={() => void app.transact(fresh => {
              if (!fresh.withdrawable) throw Error('There is no credited BILL to withdraw. Refresh your balance.');
              return { label: 'Withdraw BILL', functionName: 'withdraw' };
            })}>Withdraw BILL <span aria-hidden="true">↗</span></button>
            <p className="help">{!account ? 'Connect to see your live BILL balances.' : s?.withdrawable === 0n ? 'No BILL is currently available to withdraw.' : 'Withdrawal settles any accrued billboard tax first.'}</p>
          </section>
          <div className="get-bill"><span className="eyebrow">New here?</span><h3>Start with BILL.</h3><p>BILL comes from swapping Sepolia ETH in this launch’s Uniswap v4 pool. Swap outside this page, then return to buy the space.</p><p className="help">This is a testnet experiment. You’ll also need Sepolia ETH for transaction fees.</p>{d && <a href={d.network.faucets[0]}>Get Sepolia ETH from the faucet ↗</a>}</div>
          <HolderControls s={s} enabled={canSend && holder} run={app.transact} />
        </aside>
      </div>

      <section className="how-it-works" aria-labelledby="how-heading"><h2 id="how-heading">A space you hold.<br />A price you stand behind.</h2><ol><li><span>01</span><div><h3>Buy & make your mark</h3><p>Pay the current price plus your tax deposit. Your message can use up to 32 bytes.</p></div></li><li><span>02</span><div><h3>Name a fair price</h3><p>Anyone can buy at your asking price. A higher price means a higher tax.</p></div></li><li><span>03</span><div><h3>Keep the deposit funded</h3><p>Tax accrues each second at 10% per 365 days. When the deposit runs out, the space can be foreclosed.</p></div></li></ol></section>

      <details className="protocol-details"><summary>Live state & contract details<span aria-hidden="true">＋</span></summary><div className="protocol-grid"><section><h3>Settle the tax</h3><p>Anyone can burn the accrued tax. If it exhausts the deposit, settlement clears the holder, price and message. All other actions settle automatically.</p><button disabled={!canSend || !s || s.holder === zeroAddress} onClick={() => void app.transact(() => ({ label: 'Settle tax', functionName: 'settle' }))}>Settle tax</button></section><section><h3>Verified deployment</h3>{d?.contracts.map(c => <p key={c.name}><a href={`${explorer}/address/${c.address}`}>{c.name} ↗</a><code>{c.address}</code></p>)}<a href="./imd-deployment.json">View deployment manifest ↗</a></section><section><h3>Exact BILL values</h3><p>Summaries use up to four decimal places. These are the full values from the last read.</p><dl className="exact-values">{s && Object.entries({ 'Asking price': s.price, 'Tax deposit': s.deposit, 'Accrued tax': s.tax, 'Remaining deposit': s.deposit - s.tax, ...(account ? { 'Wallet balance': s.balance, 'Allowance': s.allowance, 'Withdrawable': s.withdrawable } : {}) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatUnits(value, s.decimals)} BILL</dd></div>)}</dl>{s && <p className="help">Last settled: {s.lastSettled === 0n ? 'Not yet held' : new Date(Number(s.lastSettled) * 1000).toLocaleString()}.</p>}</section></div></details>
    </main>
    <footer className="wrap"><span className="brand">Billboard<span className="footer-dot" aria-hidden="true">■</span></span><p>One space. No owner. All onchain.</p><span>{d?.network.name ?? 'Loading'} experiment</span></footer>
  </>;
}
