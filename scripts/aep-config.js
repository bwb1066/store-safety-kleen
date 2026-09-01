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
  // The XDM tenant namespace every custom field goes under. An AEP tenant id
  // is assigned ONCE PER IMS ORG, not per site — this org's real tenant is
  // `_demosystem4` (confirmed against the BWBReplicaSiteDemo schema).
  // edmund-optics shares this same org/datastream and must use the same
  // value here.
  tenantId: '_demosystem4',

  // This replica's identifier, included on every tracked event so the
  // datastream/schema shared with other replicas can still be filtered per
  // site.
  site: 'store-safety-kleen',

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

  // Adding a drum of antifreeze to a quote is a far better statement of
  // intent than reading an article, so on this site the commerce signal is
  // the primary one. The store only emits on actual mutations (subscribe()
  // does NOT fire synchronously with current state), so seed `counted` from
  // store.getQuote() up front — otherwise the very first real "Add to quote"
  // click on a fresh page load would be mistaken for a restored cart and
  // silently skipped. Track SKUs already counted so a quantity bump doesn't
  // re-tally the same product. Each new line gets two events: a
  // standards-based commerce.productListAdds (real productListItems, so it
  // shows up in out-of-box commerce reporting) plus the generic
  // audience-tally signal.
  wireExtraSignals({ classify, recordSignal, track }) {
    const counted = new Set((store.getQuote()?.lines || []).map((l) => String(l.sku)));
    store.subscribe((quote) => {
      const lines = quote?.lines || [];
      lines.forEach((line) => {
        const sku = String(line.sku);
        if (counted.has(sku)) return;
        counted.add(sku);
        track('commerce.productListAdds', {
          standard: {
            commerce: { productListAdds: { value: 1 } },
            productListItems: [{
              SKU: sku,
              name: line.name,
              quantity: line.qty,
              priceTotal: { value: line.qty * line.unit_price },
            }],
          },
        });
        recordSignal(classify(line.name), 'commerce', { sku });
      });
    });
  },
};
