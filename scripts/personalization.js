import { getMetadata } from './ak.js';
import config from './aep-config.js';

/**
 * Two things live here:
 *
 * 1. `track()` — a generic, low-level XDM event sender. This is the
 *    future-proofing mechanism: any block, current or not-yet-written, tracks
 *    a brand-new kind of event by calling `track('some.eventType', {...})`
 *    directly — no changes to this file required, ever. `config.site` is
 *    injected automatically under `config.tenantId` on every event, so a
 *    datastream/schema SHARED across multiple sites can still be filtered per
 *    site. Inert until window.alloy exists (see websdk.js).
 *
 * 2. Audience-signal tracking built on top of `track()`: turn behavior
 *    (chat prompts + responses, any audience-tagged page view, and whatever
 *    `config.wireExtraSignals` wires up — e.g. a commerce store's cart/quote
 *    changes) into a per-session leading-audience tally, exposed as a window
 *    global (name from `config.audienceGlobal`, default `aepAudience`) so
 *    on-page block JS can personalize immediately, even before Adobe is live.
 *
 * Everything site-specific — audience segments + classification rules, the
 * shared XDM tenant id, this site's `site` identifier, chat event name, extra
 * signal sources, storage key names — comes from aep-config.js. That's the
 * only file a new site needs to edit to reuse this module.
 */

const KEYS = {
  override: 'aep_audience_override',
  tally: 'aep_audience_signal',
  ...config.storageKeys,
};
const AUD_GLOBAL = config.audienceGlobal || 'aepAudience';

const AUDIENCES = config.audiences.map((a) => a.key);

/**
 * Send one XDM event. `standard` holds official XDM paths (e.g.
 * `{ web: { webPageDetails: {...} } }`); `tenant` holds fields nested under
 * this org's shared tenant id — `site` is merged in automatically.
 */
export function track(eventType, { standard = {}, tenant = {} } = {}) {
  if (typeof window.alloy !== 'function') return;
  window.alloy('sendEvent', {
    xdm: {
      eventType,
      ...standard,
      [config.tenantId]: { site: config.site, ...tenant },
    },
  });
}

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

// Bump the session tally (skipping the neutral 'default') and promote the
// leading audience unless a demo-panel override is active. Returns the
// previous leading audience so callers can detect a real change.
function bumpTally(audience) {
  const before = window[AUD_GLOBAL];
  if (!audience || audience === 'default') return before;

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
  return before;
}

// Record one signal: bump the tally, then send the derived event via
// track() — folding in an `audienceChanged` marker on the same event
// instead of firing a separate network call when the leading audience flips.
export function recordSignal(audience, source, extra = {}) {
  const before = bumpTally(audience);
  const after = window[AUD_GLOBAL];
  const eventType = (config.eventTypeForSource || defaultEventType)(source);
  track(eventType, {
    tenant: {
      signal: {
        source,
        audience: audience || 'default',
        ...(after !== before ? { audienceChanged: { from: before, to: after } } : {}),
        ...extra,
      },
    },
  });
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
    if (detail.role !== 'assistant' && detail.role !== 'user') return;
    const hay = detail.role === 'user' ? (detail.prompt || '') : [
      detail.prompt || '',
      ...(detail.recommendations || []).map((r) => `${r.title || ''} ${r.reason || ''}`),
    ].join(' ');
    recordSignal(classify(hay), 'chat', {
      turn: detail.role === 'user' ? 'prompt' : 'response',
      recommendedCount: (detail.recommendations || []).length,
    });
  });
}

// One real page view per load, regardless of whether this page carries
// audience/content metadata. If it does, the derived content signal rides
// along on the SAME event instead of a second network call.
function trackPageView() {
  const audience = getMetadata('audience');
  const contentType = getMetadata('content-type');
  const before = bumpTally(audience);
  const after = window[AUD_GLOBAL];
  track('web.webpagedetails.pageViews', {
    standard: {
      web: {
        webPageDetails: {
          name: document.title, URL: window.location.href, pageViews: { value: 1 },
        },
      },
    },
    tenant: (audience || contentType) ? {
      signal: {
        source: 'content',
        audience: audience || 'default',
        contentType: contentType || undefined,
        topic: getMetadata('topic') || undefined,
        ...(after !== before ? { audienceChanged: { from: before, to: after } } : {}),
      },
    } : {},
  });
}

let wired = false;

export default function initPersonalization() {
  if (wired) return;
  wired = true;
  applyStoredAudience();
  trackPageView();
  wireChat();
  config.wireExtraSignals?.({ classify, recordSignal, track });
}
