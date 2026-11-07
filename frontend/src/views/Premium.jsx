import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/Grid";
import { Artifact, StickerLabel } from "../components/Stickers";
import { billingApi, refreshUser, useBilling } from "../lib/billing";
import { annualSaving, formatPrice, monthlyEquivalent, planSummary } from "../lib/billingMath";
import { useRoute } from "../lib/router";
import { toast, toastError } from "../lib/toast";

const ROWS = [
  ["Lossless and hi-res streaming", true, true],
  ["Playlists, Rooms, Blend and Rewind", true, true],
  ["Save music for offline listening", false, true],
  ["No promos", false, true],
];

function Mark({ on }) {
  return on
    ? <span className="font-bold text-ink" aria-label="Included">Yes</span>
    : <span className="text-muted" aria-label="Not included">No</span>;
}

/** After Stripe sends the person back, wait for the webhook to confirm. Never unlock from the URL alone. */
function useConfirmPayment(active, reload) {
  const [state, setState] = useState("idle"); // idle | waiting | done | slow
  const started = useRef(false);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    setState("waiting");
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const data = await reload();
      if (data?.plan.premium) {
        clearInterval(timer);
        await refreshUser();
        setState("done");
      } else if (tries >= 10) {
        clearInterval(timer);
        setState("slow");
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [active, reload]);
  return state;
}

export default function Premium() {
  const { query } = useRoute();
  const { loading, data, error, reload } = useBilling();
  const [interval, setInterval_] = useState("year");
  const [busy, setBusy] = useState(false);
  const returning = query.get("checkout") === "success";
  const confirm = useConfirmPayment(returning, reload);
  const locale = navigator.language;

  const prices = data?.prices ?? [];
  const month = prices.find((p) => p.interval === "month");
  const year = prices.find((p) => p.interval === "year");
  const saving = useMemo(() => annualSaving(month, year), [month, year]);
  const chosen = interval === "year" && year ? year : month ?? year;

  useEffect(() => { if (!year && month) setInterval_("month"); }, [year, month]);

  const go = async () => {
    setBusy(true);
    try {
      const { url } = await billingApi.checkout(chosen.interval);
      window.location.assign(url);
    } catch (err) {
      if (err.status === 409) { toast(err.message); manage(); } else toastError(err);
      setBusy(false);
    }
  };
  const manage = async () => {
    setBusy(true);
    try {
      const { url } = await billingApi.portal();
      window.location.assign(url);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data.enabled) {
    return (
      <div className="py-10 text-center">
        <Artifact kind="sparkle" size={80} tilt={-8} className="mx-auto" />
        <p className="mt-4 font-display text-xl font-bold">Everything is unlocked</p>
        <p className="mt-1 text-sm text-muted">This server doesn’t charge for anything.</p>
      </div>
    );
  }

  const { plan } = data;
  const summary = planSummary(plan, locale);

  return (
    <div className="relative z-10 mx-auto max-w-3xl">
      <PageHeader title="Premium" subtitle="Take your music offline. Lossless is free for everyone." />

      {returning && confirm === "waiting" && <p role="status" className="mb-6 rounded-md bg-surface-1 p-4 text-sm font-semibold shadow-card">Checking your payment…</p>}
      {returning && confirm === "done" && <p role="status" className="mb-6 rounded-md bg-accent p-4 text-sm font-semibold text-ink shadow-card">You’re Premium. Thank you!</p>}
      {returning && confirm === "slow" && (
        <p role="status" className="mb-6 rounded-md bg-surface-1 p-4 text-sm shadow-card">
          Your payment can take a minute to confirm. Premium unlocks as soon as it does; you can leave this page.
        </p>
      )}

      {plan.premium ? (
        <section className="rounded-lg border-[5px] border-white bg-accent p-6 shadow-card">
          <StickerLabel tone="ink" tilt={-4}>your plan</StickerLabel>
          <h2 className="mt-3 font-display text-3xl font-bold text-ink">{summary.title}</h2>
          {summary.detail && <p className="mt-1 text-ink/80">{summary.detail}</p>}
          {plan.source === "subscription" && <button type="button" className="btn-secondary mt-5" disabled={busy} onClick={manage}>Manage billing</button>}
        </section>
      ) : (
        <>
          <div className="mb-6 overflow-x-auto rounded-lg border border-line bg-surface-1/80 shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left"><th className="p-3"><span className="sr-only">Feature</span></th><th className="p-3">Free</th><th className="bg-accent p-3 text-ink">Premium</th></tr>
              </thead>
              <tbody>
                {ROWS.map(([label, free, premium]) => (
                  <tr key={label} className="border-t border-line">
                    <td className="p-3 font-medium">{label}</td>
                    <td className="p-3"><Mark on={free} /></td>
                    <td className="bg-accent/30 p-3"><Mark on={premium} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {prices.length === 0 ? (
            <p className="text-sm text-muted">Prices can’t be shown right now. Try again in a moment.</p>
          ) : (
            <section className="grid gap-4 rounded-lg border-[5px] border-white bg-social p-6 shadow-card">
              {month && year && (
                <div role="radiogroup" aria-label="Billing period" className="flex flex-wrap gap-2">
                  {[["month", "Monthly"], ["year", "Yearly"]].map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={interval === value} onClick={() => setInterval_(value)}
                      className={`rounded-pill border-[3px] border-white px-4 py-2 text-sm font-bold shadow-sticker ${interval === value ? "bg-ink text-accent" : "bg-surface-1 text-ink"}`}>
                      {label}{value === "year" && saving ? ` · save ${saving}%` : ""}
                    </button>
                  ))}
                </div>
              )}
              <p className="font-display text-4xl font-bold text-ink">
                {formatPrice(chosen.amount, chosen.currency, locale)}
                <span className="ml-2 text-base font-semibold text-ink/70">/ {chosen.interval}</span>
              </p>
              {chosen.interval === "year" && <p className="text-sm text-ink/80">That is {monthlyEquivalent(chosen, locale)} a month.</p>}
              <div><button type="button" className="btn-secondary" disabled={busy} onClick={go}>{busy ? "Opening checkout…" : "Go Premium"}</button></div>
              <p className="text-xs text-ink/80">You pay on Stripe’s secure page. Cancel any time from your billing page.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
