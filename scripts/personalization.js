import store from './commerce.js';

/**
 * Turn behavior into an audience signal.
 *
 * The Edmund Optics replica derives this from Knowledge Center page views plus
 * concierge chat turns. Safety-Kleen is a storefront with no article library,
 * so the content source is replaced by a stronger one for a B2B buyer:
 *
 *   - Concierge chat turns (the widget's `brand-concierge:message` event)
 *   - Quote activity — what actually gets added to the quote
 *
 * Adding a drum of antifreeze to a quote is a far better statement of intent
 * than reading an article, so on this site the commerce signal is the primary
 * one and the chat signal supports it.
 *
 * Each signal (a) updates a per-session tally and sets window.skAudience to the
 * leading audience — so on-page consumers personalize immediately, even before
 * Adobe is live — and (b) pushes a DERIVED event to Adobe via the Web SDK for
 * unified-profile enrichment (GATED on window.alloy, so it's inert until the
 * SDK is configured; see websdk.js). Raw prompt text is never sent — only the
 * derived audience.
 */

export const AUDIENCES = [
  'fleet_maintenance',
  'collision_repair',
  'industrial_ehs',
  'pfas_remediation',
];

const STORE_KEY = 'sk_audience_signal';

// Keyword → audience. Ordered most-specific first: PFAS vocabulary is
// unambiguous, whereas "drum" and "solvent" show up across the whole catalog,
// so the broader rules must not get first refusal.
const RULES = [
  ['pfas_remediation', /pfas|pfoa|pfos|forever chemical|remediat|groundwater|leachate|water sampl|test kit/i],
  ['collision_repair', /parts washer|brake clean|degreas|body shop|collision|aerosol|paint gun|solvent tank/i],
  ['fleet_maintenance', /motor oil|lubricant|antifreeze|gear oil|hydraulic|driveline|grease|windshield|transmission|bulk oil|fleet/i],
  ['industrial_ehs', /absorb|spill|\bsock\b|\bboom\b|pillow|containment|pallet|\bppe\b|safety cabinet|berm|wiper|recycling kit/i],
];

function classify(text) {
  const hit = RULES.find(([, re]) => re.test(text || ''));
  return hit ? hit[0] : 'default';
}

/**
 * Does this text read as belonging to `audience`? Shared with the blocks so a
 * curated product grid can be re-ordered by persona relevance using exactly
 * the same vocabulary the signal classifier uses.
 */
export function matchesAudience(text, audience) {
  const rule = RULES.find(([key]) => key === audience);
  return rule ? rule[1].test(text || '') : false;
}

function readTally() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function leadingAudience(tally) {
  let best = null;
  let bestN = 0;
  AUDIENCES.forEach((a) => {
    if ((tally[a] || 0) > bestN) {
      best = a;
      bestN = tally[a];
    }
  });
  return best;
}

/**
 * Record one signal: bump the session tally (skipping the neutral 'default'),
 * promote the leading audience, and enrich the Adobe profile if the SDK is live.
 * An explicit demo-panel override outranks the derived signal, so while one is
 * set we still tally but do not promote.
 */
function recordSignal(audience, source, extra = {}) {
  if (audience && audience !== 'default') {
    const tally = readTally();
    tally[audience] = (tally[audience] || 0) + 1;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(tally));
    } catch (e) { /* private mode — the signal is best-effort */ }

    let overridden = false;
    try {
      overridden = !!sessionStorage.getItem('sk_audience_override');
    } catch (e) { /* private mode */ }
    if (!overridden) {
      const lead = leadingAudience(tally) || window.skAudience;
      if (lead !== window.skAudience) {
        window.skAudience = lead;
        document.dispatchEvent(new CustomEvent('p13n:change', {
          detail: { audience: lead, source },
        }));
      }
    }
  }

  if (typeof window.alloy === 'function') {
    const eventType = source === 'commerce'
      ? 'commerce.productListAdds'
      : 'experience.chat.interaction';
    window.alloy('sendEvent', {
      xdm: {
        eventType,
        // Placeholder tenant field group — map to the real AEP schema path.
        _safetykleen: { signal: { source, audience: audience || 'default', ...extra } },
      },
    });
  }
}

// Restore the audience BEFORE blocks decorate on a fresh page: an explicit
// demo-panel override wins, else the leading in-session signal.
function applyStoredAudience() {
  let override = null;
  try {
    override = sessionStorage.getItem('sk_audience_override');
  } catch (e) { /* private mode */ }
  if (override) {
    window.skAudience = override;
    return;
  }
  const lead = leadingAudience(readTally());
  if (lead) window.skAudience = lead;
}

function wireChat() {
  document.addEventListener('brand-concierge:message', (e) => {
    const detail = e.detail || {};
    if (detail.role !== 'assistant') return;
    const hay = [
      detail.prompt || '',
      ...(detail.recommendations || []).map((r) => `${r.title || ''} ${r.reason || ''}`),
    ].join(' ');
    recordSignal(classify(hay), 'concierge', {
      recommendedCount: (detail.recommendations || []).length,
    });
  });
}

/**
 * Quote activity. The store emits the whole cart on every change, so track the
 * SKUs already counted and only classify genuinely new lines — otherwise a
 * quantity bump would re-tally the same product and drown out the rest.
 */
function wireCommerce() {
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
}

let wired = false;

export default function initPersonalization() {
  if (wired) return;
  wired = true;
  applyStoredAudience();
  wireChat();
  wireCommerce();
}
