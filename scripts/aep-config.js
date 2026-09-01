import store from './commerce.js';

/**
 * Site-specific configuration for the Adobe Web SDK / AEP integration
 * (websdk.js, personalization.js, demo-panel.js). Centralizing these values
 * here is what makes those three modules portable across sites — copy them
 * verbatim and only this file needs to change.
 *
 * Safety-Kleen is a storefront with no article library, so unlike the Edmund
 * Optics replica (content-view signal), the primary signal here is commerce
 * intent — what actually gets added to a quote — wired via
 * `wireExtraSignals` below. Chat (Ask Jack) supports it as a secondary
 * signal.
 */
export default {
  // XDM tenant namespace the personalization signal is written under. Must
  // match the tenant id of whatever AEP schema the datastream points at.
  tenantId: '_safetykleen',

  // Ask Jack's chat widget dispatches this with { role, prompt, recommendations }.
  chatEventName: 'brand-concierge:message',

  // AJO/Target decision scope label used by the demo panel's persona-switch event.
  decisionScope: 'storefront-catalog',

  // Audience segments, ordered most-specific first: PFAS vocabulary is
  // unambiguous, whereas "drum" and "solvent" show up across the whole
  // catalog, so the broader rules must not get first refusal.
  audiences: [
    {
      key: 'pfas_remediation',
      label: 'PFAS Remediation',
      match: /pfas|pfoa|pfos|forever chemical|remediat|groundwater|leachate|water sampl|test kit/i,
    },
    {
      key: 'collision_repair',
      label: 'Collision / Auto Body',
      match: /parts washer|brake clean|degreas|body shop|collision|aerosol|paint gun|solvent tank/i,
    },
    {
      key: 'fleet_maintenance',
      label: 'Fleet Maintenance',
      match: /motor oil|lubricant|antifreeze|gear oil|hydraulic|driveline|grease|windshield|transmission|bulk oil|fleet/i,
    },
    {
      key: 'industrial_ehs',
      label: 'Industrial EHS',
      match: /absorb|spill|\bsock\b|\bboom\b|pillow|containment|pallet|\bppe\b|safety cabinet|berm|wiper|recycling kit/i,
    },
  ],

  // Demo contract accounts. `id` is the buyer EMAIL: resolveBuyer() in the
  // commerce edge function matches commerce_buyers.email exactly, scoped by
  // site_key. Seeded by reference/commerce/20260824_sk_demo_buyers.sql.
  // Northline's `extra.hazmatClearance` rides along on the identity event so
  // the inspector shows what actually changes catalog visibility.
  demoPersonas: [
    { id: 'fleet@midstate-transit.example', label: 'Midstate Transit', note: 'contract pricing' },
    {
      id: 'ehs@northline-industrial.example',
      label: 'Northline Industrial',
      note: 'contract pricing + hazmat clearance',
      extra: { hazmatClearance: true },
    },
  ],

  // scripts/p13n.js is the pre-existing single source of truth for these
  // names (shared with Ask Jack's suggestion chips) — keep personalization.js
  // and demo-panel.js writing to the same global/keys rather than
  // introducing new ones p13n.js wouldn't see.
  audienceGlobal: 'skAudience',
  storageKeys: {
    override: 'sk_audience_override',
    buyer: 'sk_demo_buyer',
    tally: 'sk_audience_signal',
    demoFlag: 'sk_demo',
  },

  // Quote adds get their own XDM eventType; everything else falls back to
  // the generic content/chat split.
  eventTypeForSource(source) {
    if (source === 'commerce') return 'commerce.productListAdds';
    return source === 'content' ? 'web.webpagedetails.pageViews' : 'experience.chat.interaction';
  },

  // Adding a drum of antifreeze to a quote is a far better statement of
  // intent than reading an article, so on this site the commerce signal is
  // the primary one. The store emits the whole cart on every change, so
  // track SKUs already counted and only classify genuinely new lines —
  // otherwise a quantity bump would re-tally the same product and drown out
  // the rest.
  wireExtraSignals({ classify, recordSignal }) {
    const counted = new Set();
    let primed = false;
    store.subscribe((quote) => {
      const lines = quote?.lines || [];
      // The first emission is the restored cart, not a fresh intent signal.
      if (!primed) {
        primed = true;
        lines.forEach((l) => counted.add(String(l.sku)));
        return;
      }
      lines.forEach((line) => {
        const sku = String(line.sku);
        if (counted.has(sku)) return;
        counted.add(sku);
        recordSignal(classify(line.name), 'commerce', { sku });
      });
    });
  },
};
