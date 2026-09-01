import { getMetadata } from './ak.js';
import config from './aep-config.js';

/**
 * Turn behavior into an audience signal, from any number of sources:
 *   - Chat turns (the widget's `config.chatEventName` event, if configured)
 *   - Any audience-tagged page view (via `audience`/`content-type` page metadata)
 *   - Whatever else `config.wireExtraSignals` wires up (e.g. a commerce store's
 *     cart/quote changes) — see aep-config.example.js
 *
 * Each signal (a) updates a per-session tally and sets a window global (name
 * from `config.audienceGlobal`, default `aepAudience`) to the leading
 * audience — so on-page block JS can personalize immediately, even before
 * Adobe is live — and (b) pushes a DERIVED event to Adobe via the Web SDK for
 * unified-profile enrichment (GATED on window.alloy, so it's inert until the
 * SDK is configured; see websdk.js). Raw prompt/content text is never sent —
 * only the derived audience.
 *
 * Everything site-specific — audience segments + classification rules, the
 * XDM tenant namespace, chat event name, extra signal sources, storage key
 * names — comes from aep-config.js. That's the only file a new site needs to
 * edit to reuse this module.
 */

const KEYS = {
  override: 'aep_audience_override',
  tally: 'aep_audience_signal',
  ...config.storageKeys,
};
const AUD_GLOBAL = config.audienceGlobal || 'aepAudience';

const AUDIENCES = config.audiences.map((a) => a.key);

/** Classify free text into a configured audience key, or 'default'. */
export function classify(text) {
  const hit = config.audiences.find(({ match }) => match.test(text || ''));
  return hit ? hit.key : 'default';
}

/**
 * Does this text read as belonging to `audience`? Exposed so block code can
 * reorder/filter content by persona relevance using the same vocabulary the
 * signal classifier uses.
 */
export function matchesAudience(text, audience) {
  const rule = config.audiences.find((a) => a.key === audience);
  return rule ? rule.match.test(text || '') : false;
}

function readTally() {
  try {
    return JSON.parse(sessionStorage.getItem(KEYS.tally)) || {};
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

function defaultEventType(source) {
  return source === 'content' ? 'web.webpagedetails.pageViews' : 'experience.chat.interaction';
}

// Record one signal: bump the session tally (skipping the neutral 'default'),
// promote the leading audience, and enrich the Adobe profile if the SDK is live.
// An explicit demo-panel override outranks the derived signal, so while one is
// set we still tally but do not promote.
export function recordSignal(audience, source, extra = {}) {
  if (audience && audience !== 'default') {
    const tally = readTally();
    tally[audience] = (tally[audience] || 0) + 1;
    try {
      sessionStorage.setItem(KEYS.tally, JSON.stringify(tally));
    } catch (e) { /* private mode — the signal is best-effort */ }

    let overridden = false;
    try {
      overridden = !!sessionStorage.getItem(KEYS.override);
    } catch (e) { /* private mode */ }
    if (!overridden) {
      window[AUD_GLOBAL] = leadingAudience(tally) || window[AUD_GLOBAL];
    }
  }

  if (typeof window.alloy === 'function') {
    const eventType = (config.eventTypeForSource || defaultEventType)(source);
    window.alloy('sendEvent', {
      xdm: {
        eventType,
        [config.tenantId]: { signal: { source, audience: audience || 'default', ...extra } },
      },
    });
  }
}

// Restore the audience BEFORE blocks decorate on a fresh page: an explicit
// demo-panel override wins, else the leading in-session signal.
function applyStoredAudience() {
  let override = null;
  try {
    override = sessionStorage.getItem(KEYS.override);
  } catch (e) { /* private mode */ }
  if (override) {
    window[AUD_GLOBAL] = override;
    return;
  }
  const lead = leadingAudience(readTally());
  if (lead) window[AUD_GLOBAL] = lead;
}

function wireChat() {
  if (!config.chatEventName) return;
  document.addEventListener(config.chatEventName, (e) => {
    const detail = e.detail || {};
    if (detail.role !== 'assistant') return;
    const hay = [
      detail.prompt || '',
      ...(detail.recommendations || []).map((r) => `${r.title || ''} ${r.reason || ''}`),
    ].join(' ');
    recordSignal(classify(hay), 'chat', {
      recommendedCount: (detail.recommendations || []).length,
    });
  });
}

// Any audience-tagged page view is an implicit signal.
function recordContentView() {
  const audience = getMetadata('audience');
  const contentType = getMetadata('content-type');
  if (!audience && !contentType) return;
  recordSignal(audience, 'content', {
    contentType: contentType || undefined,
    topic: getMetadata('topic') || undefined,
  });
}

let wired = false;

export default function initPersonalization() {
  if (wired) return;
  wired = true;
  applyStoredAudience();
  wireChat();
  recordContentView();
  config.wireExtraSignals?.({ classify, recordSignal });
}
