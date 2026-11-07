// Pure helpers for Premium screens. No prices live in the app: amounts come from the server (Stripe).

const digitsFor = (currency, locale) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits;

/** `amount` is in the currency's smallest unit (cents, paise); yen and the like have none. */
export function formatPrice(amount, currency, locale) {
  const divisor = 10 ** digitsFor(currency, locale);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / divisor);
}

/** A yearly price shown per month; a monthly price is returned as is. */
export function monthlyEquivalent(price, locale) {
  const amount = price.interval === "year" ? Math.round(price.amount / 12) : price.amount;
  return formatPrice(amount, price.currency, locale);
}

/** Whole percent saved by paying yearly instead of monthly, or null when there is no real saving. */
export function annualSaving(month, year) {
  if (!month || !year || month.currency !== year.currency) return null;
  const full = month.amount * 12;
  if (year.amount >= full) return null;
  const pct = Math.round((1 - year.amount / full) * 100);
  return pct > 0 ? pct : null;
}

/** Only an explicit `premium: false` means Free, so a server that predates billing keeps everything unlocked. */
export const isPremiumUser = (user) => user?.premium !== false;

const longDate = (value, locale) => new Date(`${value.replace(" ", "T")}Z`)
  .toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Title and one line of detail for the billing card. */
export function planSummary(plan, locale) {
  if (plan.source === "billing_off") return { title: "Everything unlocked", detail: "" };
  if (plan.source === "comp") return { title: "Premium (gift)", detail: "" };
  if (plan.source !== "subscription") return { title: "Free", detail: "" };
  const date = plan.current_period_end ? longDate(plan.current_period_end, locale) : null;
  if (plan.status === "past_due") return { title: "Premium", detail: "Payment failed. Update your card to keep Premium." };
  if (plan.cancel_at_period_end) return { title: "Premium", detail: date ? `Ends on ${date}` : "Ending soon" };
  return { title: "Premium", detail: date ? `Renews on ${date}` : "" };
}
