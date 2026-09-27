import { useState, type FormEvent, type ReactNode } from 'react';
import { formatUnits, maxUint256 } from 'viem';
import { amount, bill, byteLength, encodeMessage, isEmpty, price, type Snapshot } from './model';
import type { Action } from './useBillboard';

type Run = (make: (s: Snapshot) => Action) => Promise<void>;
class FieldError extends Error { constructor(public field: string, message: string) { super(message); } }
function check<T>(id: string, fn: () => T): T { try { return fn(); } catch (e) { throw new FieldError(id, (e as Error).message); } }
function useForm() {
  const [error, setError] = useState<{ field: string; text: string }>();
  const submit = (fn: (intent: string) => void) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(undefined);
    try { fn((e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'pay'); }
    catch (e) {
      const err = e as FieldError;
      setError({ field: err.field, text: err.message });
      document.getElementById(err.field)?.focus();
    }
  };
  return { error, submit };
}
function Field({ id, label, value, set, hint, error, message = false }: {
  id: string; label: string; value: string; set: (s: string) => void; hint?: string;
  error?: { field: string; text: string }; message?: boolean;
}) {
  const invalid = error?.field === id;
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="input-wrap"><input id={id} name={id} type="text" inputMode={message ? 'text' : 'decimal'} autoComplete="off" value={value} onChange={e => set(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`} />{!message && <span aria-hidden="true">BILL</span>}</div>
    <small id={`${id}-hint`}>{message ? `${byteLength(value)} / 32 UTF-8 bytes. Public and stored onchain.` : hint}</small>
    {invalid && <small className="field-error" id={`${id}-error`} role="alert">{error.text}</small>}
  </div>;
}
function Payment({ total, s, enabled, label }: { total?: bigint; s?: Snapshot; enabled: boolean; label: string }) {
  const approved = total !== undefined && total > 0n && !!s && s.allowance >= total;
  const enough = !s?.account || total === undefined || s.balance >= total;
  return <>
    <div className="payment-summary"><span>Maximum payment</span><strong>{total === undefined ? '—' : bill(total, s?.decimals)} BILL</strong></div>
    <p className="help">Approve this limit for the billboard, then pay in a separate transaction. Each step uses ETH for gas.</p>
    <div className="steps">
      <button type="submit" value="approve" disabled={!enabled || approved || !enough}><span className="step">1</span>{approved ? 'BILL approved' : 'Approve BILL'}</button>
      <button className="primary" type="submit" value="pay" disabled={!enabled || !approved || !enough}><span className="step">2</span>{label}<span aria-hidden="true">↗</span></button>
    </div>
    {!enough && <p className="field-error">Your BILL balance is below this limit. Reduce the amount or obtain more BILL.</p>}
  </>;
}
export function BuyForm({ s, enabled, holder, run }: { s?: Snapshot; enabled: boolean; holder: boolean; run: Run }) {
  const [newPrice, setPrice] = useState('100');
  const [max, setMax] = useState('0');
  const [deposit, setDeposit] = useState('10');
  const [message, setMessage] = useState('');
  const { error, submit } = useForm();
  let total: bigint | undefined;
  try { total = amount(max, s?.decimals ?? 18, true) + amount(deposit, s?.decimals ?? 18); if (total > maxUint256) total = undefined; } catch { /* The submit handler gives field-level errors. */ }
  function values(state: Snapshot) {
    const p = check('buy-price', () => price(newPrice, state));
    const m = check('buy-max', () => amount(max, state.decimals, true));
    const dep = check('buy-deposit', () => amount(deposit, state.decimals));
    const msg = check('buy-message', () => encodeMessage(message));
    if (m + dep > maxUint256) throw new FieldError('buy-deposit', 'The total payment exceeds the token amount limit.');
    if (!isEmpty(state) && state.price > m) throw new FieldError('buy-max', 'The current price is above your limit. Refresh and raise the maximum if you agree to it.');
    return { p, m, dep, msg };
  }
  return <form onSubmit={submit(intent => {
    if (!s) return;
    values(s);
    void run(fresh => {
      const { p, m, dep, msg } = values(fresh);
      return intent === 'approve'
        ? { label: 'Approve BILL', functionName: 'approve', approve: m + dep }
        : { label: 'Buy billboard', functionName: 'buy', args: [p, m, msg, dep], debit: m + dep, buy: true };
    });
  })}>
    <div className="section-heading"><span className="eyebrow">Make it yours</span><h2>Buy the billboard</h2><p>Buy at the current price. Choose what the next person pays you.</p></div>
    {holder && <p className="notice">You hold this space. Use the holder controls to update it.</p>}
    <Field id="buy-message" label="Your message" value={message} set={setMessage} message error={error} />
    <div className="field-row">
      <Field id="buy-price" label="Your asking price" value={newPrice} set={setPrice} hint="1–1,000,000,000 BILL. Sets your tax." error={error} />
      <Field id="buy-deposit" label="Tax deposit" value={deposit} set={setDeposit} hint="Funds the tax that keeps your message up." error={error} />
    </div>
    <Field id="buy-max" label="Maximum purchase price" value={max} set={setMax} hint="The purchase reverts if the price exceeds this limit. Your deposit is added separately." error={error} />
    <button className="text-button" type="button" disabled={!s} onClick={() => s && setMax(formatUnits(isEmpty(s) ? 0n : s.price, s.decimals))}>Use current purchase price</button>
    <Payment total={total} s={s} enabled={enabled && !holder} label="Buy billboard" />
    <p className="help">Anyone can buy it from you at your asking price. Tax is burned. If your deposit runs out, the next buyer pays only their deposit.</p>
  </form>;
}
function SimpleForm({ kind, s, enabled, run }: { kind: 'setPrice' | 'setMessage' | 'addDeposit' | 'withdrawDeposit'; s?: Snapshot; enabled: boolean; run: Run }) {
  const [value, setValue] = useState(kind === 'setPrice' ? '100' : kind === 'setMessage' ? '' : '1');
  const { error, submit } = useForm();
  const labels = { setPrice: 'Set asking price', setMessage: 'Set message', addDeposit: 'Add deposit', withdrawDeposit: 'Withdraw deposit' };
  const hints = { setPrice: '1–1,000,000,000 BILL. A higher price increases tax.', setMessage: '', addDeposit: 'Add BILL to extend your remaining time.', withdrawDeposit: 'Paid directly to your wallet. Withdrawing all leaves the billboard open to foreclosure at the next settlement.' };
  const parse = (state: Snapshot) => check(kind, () => {
    if (kind === 'setMessage') return encodeMessage(value);
    if (kind === 'setPrice') return price(value, state);
    const n = amount(value, state.decimals);
    if (kind === 'withdrawDeposit' && n > state.deposit - state.tax) throw Error('Enter less than the deposit remaining after accrued tax. Leave room for tax before confirmation.');
    return n;
  });
  let total: bigint | undefined;
  try { total = amount(value, s?.decimals ?? 18); } catch { /* Validate on submission. */ }
  return <form className="holder-form" onSubmit={submit(intent => {
    if (!s) return;
    parse(s);
    void run(fresh => {
      const arg = parse(fresh);
      if (kind === 'addDeposit' && intent === 'approve') return { label: 'Approve BILL', functionName: 'approve', approve: arg as bigint, holderOnly: true };
      return { label: labels[kind], functionName: kind, args: [arg], holderOnly: true, debit: kind === 'addDeposit' ? arg as bigint : undefined };
    });
  })}>
    <Field id={kind} label={labels[kind]} value={value} set={setValue} hint={hints[kind]} message={kind === 'setMessage'} error={error} />
    {kind === 'addDeposit' ? <Payment total={total} s={s} enabled={enabled} label="Add deposit" /> : <button type="submit" disabled={!enabled}>{labels[kind]}</button>}
  </form>;
}
export function HolderControls({ s, enabled, run }: { s?: Snapshot; enabled: boolean; run: Run }) {
  return <details className="holder-controls"><summary>Manage your billboard<span aria-hidden="true">＋</span></summary>
    <p className="help">Only the active holder can make these changes. Every action settles accrued tax first.</p>
    {(['setMessage', 'setPrice', 'addDeposit', 'withdrawDeposit'] as const).map(kind => <SimpleForm key={kind} kind={kind} s={s} enabled={enabled} run={run} />)}
  </details>;
}
export function Stat({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return <div className="stat"><dt>{label}</dt><dd>{children}{note && <div className="stat-note">{note}</div>}</dd></div>;
}
