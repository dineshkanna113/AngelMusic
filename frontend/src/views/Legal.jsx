import { PageHeader } from "../components/Grid";
import { href } from "../lib/router";

// DRAFT text. It describes what the software does, not a legal agreement. A lawyer must review and
// complete it (seller details, governing law, refund terms) before launch.
const PAGES = {
  terms: {
    title: "Terms of service",
    sections: [
      ["Using Yaapu", "Yaapu lets you listen to music, make playlists and share what you play. You must follow the law and not misuse the service, other people’s accounts or the music."],
      ["Plans", "Free listeners can stream everything. Premium adds saving music for offline listening and removes promos. Prices are shown in the app before you pay."],
      ["Subscriptions", "Premium renews until you cancel. You can cancel at any time from your billing page; Premium then lasts until the end of the period you paid for."],
      ["Music and rights", "Music on Yaapu is provided by licensors and by independent artists. Saved offline copies are for your own listening and stop working if you leave Premium."],
      ["Contact", "[Seller name, address and support email to be added.]"],
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      ["What we keep", "Your account (username, password hash), profile, playlists, favorites, listening history and who you follow. Chat in Rooms is not stored."],
      ["Who can see it", "Your profile and activity are visible according to your privacy settings. Artists see totals about their listeners; they see your name only if you share your activity and your profile is public."],
      ["Payments", "Payments are handled by Stripe. We never see or store your card number. We keep Stripe’s customer and subscription IDs, the plan status and the renewal date."],
      ["Your choices", "You can change your privacy settings, and you can delete your account in Settings. Deleting removes your data and cancels any subscription."],
      ["Contact", "[Controller name and privacy contact to be added.]"],
    ],
  },
  refunds: {
    title: "Refunds and cancellation",
    sections: [
      ["Cancelling", "Cancel from your billing page at any time. You keep Premium until the end of the paid period and are not charged again."],
      ["Refunds", "[Refund policy to be decided and written here before launch.]"],
      ["Failed payments", "If a payment fails we keep your Premium for a few days while the payment is retried. If it still fails, your plan returns to Free."],
    ],
  },
};

export default function Legal({ page }) {
  const doc = PAGES[page];
  if (!doc) return <p className="text-sm text-muted">There is no such page.</p>;
  return (
    <div className="relative z-10 max-w-2xl">
      <PageHeader title={doc.title} />
      <p role="note" className="mb-6 rounded-md bg-peach p-3 text-sm font-semibold text-ink">
        Draft. Not legal advice. A lawyer must review this before launch.
      </p>
      {doc.sections.map(([heading, text]) => (
        <section key={heading} className="mb-6">
          <h2 className="mb-1 text-xl">{heading}</h2>
          <p className="text-fg-2">{text}</p>
        </section>
      ))}
      <nav aria-label="Legal pages" className="flex flex-wrap gap-4 text-sm font-semibold">
        {Object.entries(PAGES).map(([key, p]) => <a key={key} className="underline" href={href("legal", key)}>{p.title}</a>)}
      </nav>
    </div>
  );
}
