'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Reservation = { id: string; quantity: number; amountMinor: number; state: string; checkoutExpiresAt?: number; providerStatus?: string };
type PublicBatch = {
  id: string; title: string; revision: number; status: string; opensAt: number; closesAt: number;
  policy: { unitPriceCents: number; minimumUnits: number; capacityUnits: number; variant: string; shipBy: string };
  authorizedUnits: number; capturedCents: number; reservations: Reservation[];
};
type ActionResponse = { error?: string; message?: string; state?: string; approvalUrl?: string };
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const readable: Record<string, string> = {
  CHECKOUT_CREATED: 'Awaiting PayPal approval', AUTHORIZING: 'Checking authorization', AUTHORIZED: 'Payment authorized — not charged',
  CAPTURE_PENDING: 'Charge in progress', CAPTURED: 'Sandbox payment captured', VOID_PENDING: 'Releasing authorization', VOIDED: 'Authorization cancelled',
  REFUND_PENDING: 'Refund in progress', REFUNDED: 'Sandbox payment refunded', FAILED: 'Payment did not complete', UNCERTAIN: 'Provider result needs another check',
};

export default function Buyer({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<PublicBatch | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const callbackHandled = useRef(false);
  const nonceRef = useRef('');
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, { cache: 'no-store' });
    const data = await response.json() as PublicBatch & { error?: string };
    if (!response.ok) throw new Error(data.error || 'The batch could not be loaded.');
    setBatch(data); return data as PublicBatch;
  }, [batchId]);
  const authorize = useCallback(async (pledgeId: string, revision: number) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pledgeId, revision }) });
      const data = await response.json() as ActionResponse;
      if (!response.ok) throw new Error(data.error || 'The authorization could not be confirmed.');
      setNotice(data.error || data.message || readable[data.state ?? ''] || 'Reservation checked.'); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please refresh and check this reservation.'); }
    finally { setBusy(false); }
  }, [batchId, refresh]);
  useEffect(() => {
    void refresh().then(data => {
      if (callbackHandled.current) return;
      callbackHandled.current = true;
      const query = new URLSearchParams(window.location.search);
      const pledgeId = query.get('pledge');
      if (query.get('approval') === '1' && pledgeId) {
        history.replaceState({}, '', `/batch/${encodeURIComponent(batchId)}`);
        void authorize(pledgeId, data.revision);
      } else if (query.get('cancelled') === '1') { setNotice('PayPal approval was cancelled. No authorization has been confirmed.'); history.replaceState({}, '', `/batch/${encodeURIComponent(batchId)}`); }
    }).catch(caught => setError(caught instanceof Error ? caught.message : 'The batch could not be loaded.'));
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [refresh, authorize, batchId]);
  async function checkout() {
    if (!batch || !consent) return;
    setBusy(true); setError('');
    try {
      const key = `batchloom-checkout-${batchId}`;
      if (!nonceRef.current) nonceRef.current = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, nonceRef.current);
      const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity, revision: batch.revision, consent: true, nonce: nonceRef.current }) });
      const data = await response.json() as ActionResponse;
      if (!response.ok) throw new Error(data.error || 'Checkout could not be started.');
      if (data.approvalUrl) { window.location.assign(data.approvalUrl); return; }
      setNotice(data.error || readable[data.state ?? ''] || 'Reservation saved. Refresh to check its status.'); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Checkout could not be started.'); }
    finally { setBusy(false); }
  }
  function newReservation() {
    nonceRef.current = crypto.randomUUID(); sessionStorage.setItem(`batchloom-checkout-${batchId}`, nonceRef.current); setConsent(false); setNotice('New reservation prepared. Review the quantity and terms before continuing.');
  }
  const open = batch?.status === 'OPEN' && clock < batch.closesAt;
  return <div className="buyer-shell">
    <header className="buyer-header">
      <a className="buyer-wordmark" href="/" aria-label="Batchloom studio"><img src="/images/action-stamp.png" alt="" width="32" height="32" />Batchloom</a>
      <nav className="buyer-header-links" aria-label="Collection navigation"><span className="buyer-test-label"><span aria-hidden="true" />Sandbox · no real money</span><a className="action paper buyer-studio-link" href="/">Back to studio <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main className="buyer-main">
      {!batch ? <section className="buyer-opening" aria-live="polite"><img src="/images/action-stamp.png" alt="" width="54" height="54" /><p className="buyer-eyebrow">THE RESERVATION DESK</p><h1>{error ? 'This collection needs attention.' : 'Opening the studio…'}</h1><p>{error || 'Fetching the current collection terms and reservation records.'}</p><a className="action paper" href="/">Back to the studio <span aria-hidden="true">↗</span></a></section> : <>
        <section className="buyer-intro" aria-labelledby="buyer-title"><div><p className="buyer-eyebrow">THE RESERVATION DESK <span aria-hidden="true">/</span> VERSION {String(batch.revision).padStart(2, '0')}</p><h1 id="buyer-title">{batch.title}</h1></div><p className="buyer-fiction"><span className="buyer-small-stamp" aria-hidden="true">✳</span>A fictional collection, for a working demonstration. No real money is moved, and nothing is manufactured or shipped.</p></section>
        <div className="buyer-grid">
          <section className="buyer-editorial" aria-label="Illustrated notebook collection">
            <figure className="buyer-product-figure"><div className="buyer-product-image"><img src={batch.policy.variant === 'cobalt' ? '/images/notebook-cobalt.png' : '/images/notebook-vermilion.png'} alt={`Generated product study of an ivory notebook with a ${batch.policy.variant} botanical risograph cover`} width="1122" height="1402" fetchPriority="high" /><span className="buyer-photo-label">BOTANICAL PRINT STUDY</span></div><figcaption><span><i className="buyer-colorway" data-colorway={batch.policy.variant} />{batch.policy.variant} colorway</span><span>AI-generated illustration · fictional product</span></figcaption></figure>
            <div className="buyer-editorial-note"><img src="/images/action-stamp.png" alt="" width="36" height="36" /><div><h2>A small run. A considered beginning.</h2><p>A shared collection starts with clear terms. Review this edition, authorize a sandbox reservation, and follow the payment record here.</p></div></div>
            <ol className="buyer-steps" aria-label="How this reservation works"><li><span>01</span><h3>Review the terms</h3><p>One colorway, a fixed unit price and a visible reservation window.</p></li><li><span>02</span><h3>Authorize a hold</h3><p>PayPal sandbox approval reserves the amount. It does not charge it.</p></li><li><span>03</span><h3>Follow settlement</h3><p>The maker starts collection or release manually. Refunds can take time.</p></li></ol>
          </section>
          <section className="buyer-reserve" aria-labelledby="buyer-reserve-title">
            <div className="buyer-reserve-kicker"><p className="buyer-eyebrow">YOUR PLACE IN THE RUN</p><span className="buyer-batch-status" data-status={batch.status}>{batch.status === 'OPEN' ? open ? 'Reservations open' : 'Window ended' : batch.status.replaceAll('_', ' ').toLowerCase()}</span></div>
            <h2 id="buyer-reserve-title">Reserve your place.</h2><p className="buyer-unit-price"><strong>{usd(batch.policy.unitPriceCents)}</strong><span>USD / notebook</span></p>
            <div className="buyer-demand"><div><p className="buyer-eyebrow">CONFIRMED RESERVATIONS</p><strong>{batch.authorizedUnits}<span> / {batch.policy.minimumUnits} units</span></strong></div><progress aria-label="Confirmed units toward the batch minimum" max={batch.policy.minimumUnits} value={Math.min(batch.policy.minimumUnits, batch.authorizedUnits)} /><p>Units with an authorization or capture record. The minimum is a condition for collection.</p></div>
            <dl className="buyer-terms"><div><dt>Colorway</dt><dd><i className="buyer-colorway" data-colorway={batch.policy.variant} />{batch.policy.variant}</dd></div><div><dt>Window closes</dt><dd>{new Date(batch.closesAt).toLocaleString()}</dd></div><div><dt>Planned dispatch</dt><dd>{batch.policy.shipBy}<small>Illustrative date, not a delivery guarantee</small></dd></div><div><dt>Edition capacity</dt><dd>{batch.policy.capacityUnits} notebooks</dd></div></dl>
            <div className="buyer-quantity-row"><label htmlFor="quantity">Your quantity<span>Notebooks in this reservation</span></label><input id="quantity" type="number" min={1} max={batch.policy.capacityUnits} value={quantity} disabled={!open || busy} onChange={event => { setQuantity(Math.max(1, Math.min(batch.policy.capacityUnits, Number(event.target.value) || 1))); setConsent(false); }} /></div>
            <div className="buyer-total"><div><span>Total to authorize</span><small>{quantity} × {usd(batch.policy.unitPriceCents)} USD</small></div><strong>{usd(quantity * batch.policy.unitPriceCents)}</strong></div>
            <div className="buyer-hold-note"><span aria-hidden="true">↗</span><p><strong>Authorized does not mean charged.</strong> This amount is a PayPal sandbox hold until the maker starts settlement.</p></div>
            <label className="buyer-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!open || busy} /><span>I agree to authorize this fixed sandbox amount. The maker charges it if the batch qualifies; otherwise the hold is cancelled. A partial settlement failure may require a refund, which is not always immediate.</span></label>
            <button className="action cobalt buyer-checkout" onClick={() => void checkout()} disabled={!open || !consent || busy}>{busy ? 'Checking with PayPal…' : open ? 'Continue to PayPal sandbox' : 'Reservation window closed'}{!busy && open && <span aria-hidden="true">↗</span>}</button>
            <button className="action paper buyer-separate" onClick={newReservation} disabled={busy || !open}>Start a separate reservation <span aria-hidden="true">+</span></button>
            <p className="buyer-payment-footnote">Use a PayPal sandbox buyer account. Your password stays on PayPal. The maker closes and settles this prototype manually.</p>
          </section>
        </div>
        {(notice || error) && <div className={`buyer-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><span aria-hidden="true">{error ? '!' : '↗'}</span><p>{error || notice}</p></div>}
        <section className="buyer-ledger" aria-labelledby="buyer-ledger-title"><div className="buyer-ledger-heading"><div><p className="buyer-eyebrow">YOUR RESERVATION RECORDS</p><h2 id="buyer-ledger-title">The paper trail.</h2></div><button className="action paper" onClick={() => { setNotice(''); setError(''); void refresh().catch(() => setError('Could not refresh. Try again.')); }} disabled={busy}>Refresh status <span aria-hidden="true">↻</span></button></div><div className="buyer-ledger-context"><p>Only reservations from this browser appear below. A private browser cookie keeps them connected; clearing it removes access to these controls.</p><div><span>Captured across this batch</span><strong>{usd(batch.capturedCents)}<small> USD · completed sandbox charges</small></strong></div></div>
          {!batch.reservations.length ? <div className="buyer-empty-receipts"><img src="/images/action-stamp.png" alt="" width="35" height="35" /><div><h3>Your first record will appear here.</h3><p>Start a reservation above. A checkout record is not proof of payment; its confirmed state appears here.</p></div></div> : <div className="buyer-receipt-list">{batch.reservations.map((reservation, index) => <article className="buyer-receipt" key={reservation.id} data-state={reservation.state}><div className="buyer-receipt-top"><span className="buyer-receipt-number">RESERVATION {String(index + 1).padStart(2, '0')}</span><span className="buyer-receipt-status"><i aria-hidden="true" />{readable[reservation.state] || reservation.state}</span></div><div className="buyer-receipt-detail"><div><h3>{reservation.quantity} {reservation.quantity === 1 ? 'notebook' : 'notebooks'}<span>{batch.policy.variant} colorway</span></h3><p className="buyer-receipt-id">{reservation.id}</p></div><strong>{usd(reservation.amountMinor)}<small>USD · reservation amount</small></strong></div><div className="buyer-receipt-bottom"><p>{reservation.providerStatus ? <>Last provider status: <span>{reservation.providerStatus.toLowerCase().replaceAll('_', ' ')}</span></> : 'No provider result confirmed yet.'}</p>{['CHECKOUT_CREATED', 'AUTHORIZING', 'UNCERTAIN'].includes(reservation.state) && <button className="action paper" disabled={busy} onClick={() => void authorize(reservation.id, batch.revision)}>Check PayPal approval <span aria-hidden="true">↗</span></button>}</div></article>)}</div>}
        </section>
      </>}
      <footer className="buyer-footer"><span>Batchloom <img src="/images/action-stamp.png" alt="" width="18" height="18" /> Clear terms. Shared beginnings.</span><span>HACKATHON PROTOTYPE / PAYPAL SANDBOX</span></footer>
    </main>
  </div>;
}
