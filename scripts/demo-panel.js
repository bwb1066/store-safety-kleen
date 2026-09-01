/* eslint-disable no-underscore-dangle */
/**
 * Adobe-branded demo control + Web SDK inspector, gated behind ?demo.
 *
 * - Lets you fake the personalization state (audience persona + optional
 *   "logged-in" identity, one of `config.demoPersonas`) without a real
 *   Target/AEP setup.
 * - Installs a logging shim over window.alloy that CAPTURES every sendEvent and
 *   pretty-prints the XDM that the Web SDK would post to the Adobe Edge /
 *   Datastream — so the inspector works even with no datastream configured
 *   (events are captured, not sent). Calls initWebSDK() itself first, so the
 *   real Alloy queue is always installed before this shim wraps it — order of
 *   imports elsewhere doesn't matter.
 *
 * State lives in sessionStorage so it survives navigation during a demo, and
 * is read by personalization.js (audience override) and, if the site has a
 * commerce store, whatever `config.wireExtraSignals` wired up.
 *
 * Audience list, optional demo personas, and storage key names come from
 * aep-config.js — that's the only file a new site needs to edit to reuse
 * this module.
 */

import initWebSDK from './websdk.js';
import config from './aep-config.js';

const ADOBE_RED = '#fa0f00';
const KEYS = {
  override: 'aep_audience_override',
  buyer: 'aep_demo_buyer',
  demoFlag: 'aep_demo',
  ...config.storageKeys,
};
const AUD_GLOBAL = config.audienceGlobal || 'aepAudience';
const PERSONAS = config.demoPersonas || [];

const AUDIENCES = [
  { key: '', label: 'Anonymous' },
  ...config.audiences.map(({ key, label }) => ({ key, label })),
];

const captured = [];
let els = {};

export function demoEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('demo')) {
    const v = params.get('demo');
    if (v === '0' || v === 'off' || v === 'false') {
      sessionStorage.removeItem(KEYS.demoFlag);
      return false;
    }
    sessionStorage.setItem(KEYS.demoFlag, '1');
  }
  return sessionStorage.getItem(KEYS.demoFlag) === '1';
}

const ss = {
  audience: () => sessionStorage.getItem(KEYS.override) || '',
  buyer: () => sessionStorage.getItem(KEYS.buyer) || '',
};

// ── Web SDK capture ───────────────────────────────────────────────────────
function renderEvents() {
  if (!els.log) return;
  els.log.innerHTML = captured.length
    ? captured.map((e) => {
      const time = new Date(e.t).toLocaleTimeString();
      const type = e.payload?.xdm?.eventType || e.command;
      return '<div class="aep-demo-evt"><div class="aep-demo-evt-head">'
        + `<span class="aep-demo-chip">${type}</span><span class="aep-demo-time">${time}</span></div>`
        + `<pre>${JSON.stringify(e.payload, null, 2)}</pre></div>`;
    }).join('')
    : '<p class="aep-demo-empty">No events yet — interact with the page and the Web SDK payloads appear here.</p>';
}

function installAlloyLogger() {
  const real = typeof window.alloy === 'function' ? window.alloy : null;
  const logger = (...args) => {
    const [command, payload] = args;
    captured.unshift({ t: Date.now(), command, payload });
    if (captured.length > 50) captured.pop();
    renderEvents();
    return real ? real(...args) : Promise.resolve({ demo: true });
  };
  logger.q = (real && real.q) || [];
  window.alloy = logger;
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  if (!els.aud) return;
  const aud = ss.audience();
  const buyer = ss.buyer();

  els.aud.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-on', (b.dataset.aud || '') === aud);
  });
  els.ident?.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.persona === buyer);
  });

  // Identity and audience are independent, so name only the axes that are
  // actually set — pairing a known account with no persona yet shouldn't read
  // as a contradiction.
  const account = PERSONAS.find((p) => p.id === buyer);
  const persona = AUDIENCES.find((a) => a.key === aud && a.key)?.label;
  els.state.textContent = [account?.label, persona].filter(Boolean).join(' · ') || 'Anonymous';
}

// ── State changes ─────────────────────────────────────────────────────────
function announce() {
  document.dispatchEvent(new CustomEvent('p13n:change', {
    detail: { audience: ss.audience(), buyer: ss.buyer() },
  }));
}

function setAudience(key) {
  if (key) sessionStorage.setItem(KEYS.override, key);
  else sessionStorage.removeItem(KEYS.override);
  window[AUD_GLOBAL] = key || undefined;
  // Show the decision request the site would make for this persona.
  window.alloy('sendEvent', {
    xdm: {
      eventType: 'decisioning.propositionFetch',
      _demo: { decisionScope: config.decisionScope, persona: key || 'default' },
    },
  });
  announce();
  render();
}

function setBuyer(id) {
  // Clicking the active persona logs it out.
  const next = ss.buyer() === id ? '' : id;
  if (next) sessionStorage.setItem(KEYS.buyer, next);
  else sessionStorage.removeItem(KEYS.buyer);

  window.brandCommerce?.useBuyer?.(next || null);

  const persona = PERSONAS.find((p) => p.id === next);
  window.alloy('sendEvent', {
    xdm: {
      eventType: next ? 'identity.authenticatedState' : 'identity.loggedOut',
      identityMap: next
        ? { CRMID: [{ id: next, primary: true, authenticatedState: 'authenticated' }] }
        : {},
      _demo: { account: persona?.label || null, contract: !!next, ...(persona?.extra || {}) },
    },
  });
  announce();
  render();
}

function reset() {
  sessionStorage.removeItem(KEYS.override);
  sessionStorage.removeItem(KEYS.buyer);
  window[AUD_GLOBAL] = undefined;
  window.brandCommerce?.useBuyer?.(null);
  announce();
  render();
}

// Turn the demo off entirely: clear state + the sticky flag and remove the UI.
function exitDemo() {
  reset();
  sessionStorage.removeItem(KEYS.demoFlag);
  els.tab?.remove();
  els.panel?.remove();
}

const STYLES = `
.aep-demo-tab{position:fixed;right:0;top:38%;z-index:2147483000;display:flex;align-items:center;gap:8px;
  padding:10px 12px;background:#1d1d1d;color:#fff;border:0;border-right:4px solid ${ADOBE_RED};
  border-radius:8px 0 0 8px;cursor:pointer;font:600 12px/1 -apple-system,system-ui,sans-serif;
  letter-spacing:.04em;box-shadow:0 2px 12px rgb(0 0 0 / 30%)}
.aep-demo-tab .dot{width:12px;height:12px;border-radius:2px;background:${ADOBE_RED}}
.aep-demo-panel{position:fixed;top:0;right:0;height:100vh;width:390px;max-width:92vw;z-index:2147483001;
  background:#fff;box-shadow:-8px 0 30px rgb(0 0 0 / 25%);transform:translateX(100%);
  transition:transform .22s ease;display:flex;flex-direction:column;font:14px/1.4 -apple-system,system-ui,sans-serif;color:#222}
.aep-demo-panel.open{transform:none}
.aep-demo-hd{background:#1d1d1d;color:#fff;padding:16px 18px;border-bottom:4px solid ${ADOBE_RED};display:flex;align-items:center;gap:10px}
.aep-demo-hd .dot{width:16px;height:16px;border-radius:3px;background:${ADOBE_RED}}
.aep-demo-hd b{font-size:14px;display:block}
.aep-demo-hd small{color:#b9b9b9;font-size:11px;letter-spacing:.04em}
.aep-demo-hd .x{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
.aep-demo-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:16px}
.aep-demo-sec>h4{margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#767676}
.aep-demo-aud{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.aep-demo-ident{display:grid;gap:8px}
.aep-demo-aud button,.aep-demo-ident button{padding:9px 10px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;
  cursor:pointer;font:inherit;font-weight:600;color:#333;text-align:center}
.aep-demo-aud button.is-on{background:${ADOBE_RED};border-color:${ADOBE_RED};color:#fff}
.aep-demo-ident button small{display:block;font-weight:400;font-size:11px;color:#767676;margin-top:2px}
.aep-demo-ident button.is-on{background:#1a7f37;border-color:#1a7f37;color:#fff}
.aep-demo-ident button.is-on small{color:#d6f0dd}
.aep-demo-reset{width:100%;padding:8px;border:0;background:none;color:${ADOBE_RED};cursor:pointer;font:inherit;font-weight:600}
.aep-demo-exit{width:100%;padding:9px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;color:#555;cursor:pointer;font:inherit;font-weight:600}
.aep-demo-state{padding:10px 12px;border-radius:6px;background:#f4f4f4;font-size:13px}
.aep-demo-state b{color:#111}
.aep-demo-inspector{flex:1;border-top:1px solid #eee;padding:14px 18px;overflow:auto;background:#fafafa}
.aep-demo-inspector>h4{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#767676}
.aep-demo-inspector .note{margin:0 0 10px;font-size:11px;color:#999}
.aep-demo-evt{margin:0 0 10px;border:1px solid #eaeaea;border-radius:6px;background:#fff;overflow:hidden}
.aep-demo-evt-head{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f3f3f3}
.aep-demo-chip{font:600 11px/1.4 ui-monospace,monospace;color:${ADOBE_RED}}
.aep-demo-time{font-size:10px;color:#999}
.aep-demo-evt pre{margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;word-break:break-word;color:#333;max-height:200px;overflow:auto}
.aep-demo-empty{font-size:12px;color:#999}
`;

function build() {
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);

  const tab = document.createElement('button');
  tab.className = 'aep-demo-tab';
  tab.type = 'button';
  tab.innerHTML = '<span class="dot"></span>Adobe · Web SDK';

  const panel = document.createElement('aside');
  panel.className = 'aep-demo-panel';
  panel.innerHTML = `
    <div class="aep-demo-hd">
      <span class="dot"></span>
      <span><b>Adobe Experience Platform</b><small>WEB SDK · PERSONALIZATION DEMO</small></span>
      <button class="x" type="button" aria-label="Close">×</button>
    </div>
    <div class="aep-demo-body">
      <div class="aep-demo-sec">
        <h4>Audience (implicit persona)</h4>
        <div class="aep-demo-aud"></div>
      </div>
      ${PERSONAS.length ? `
      <div class="aep-demo-sec">
        <h4>Identity</h4>
        <div class="aep-demo-ident"></div>
      </div>` : ''}
      <div class="aep-demo-state">Current: <b class="aep-demo-statev">Anonymous</b></div>
      <button class="aep-demo-reset" type="button">Reset to anonymous</button>
      <button class="aep-demo-exit" type="button">Exit demo</button>
    </div>
    <div class="aep-demo-inspector">
      <h4>Datastream events</h4>
      <p class="note">What the Web SDK would post to the Adobe Edge for this session.</p>
      <div class="aep-demo-log"></div>
    </div>`;

  document.body.append(tab, panel);

  els = {
    tab,
    panel,
    aud: panel.querySelector('.aep-demo-aud'),
    ident: panel.querySelector('.aep-demo-ident'),
    reset: panel.querySelector('.aep-demo-reset'),
    exit: panel.querySelector('.aep-demo-exit'),
    state: panel.querySelector('.aep-demo-statev'),
    log: panel.querySelector('.aep-demo-log'),
  };

  AUDIENCES.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.aud = a.key;
    b.textContent = a.label;
    b.addEventListener('click', () => setAudience(a.key));
    els.aud.append(b);
  });

  PERSONAS.forEach((persona) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.persona = persona.id;
    b.innerHTML = persona.note ? `${persona.label}<small>${persona.note}</small>` : persona.label;
    b.addEventListener('click', () => setBuyer(persona.id));
    els.ident.append(b);
  });

  els.reset.addEventListener('click', reset);
  els.exit.addEventListener('click', exitDemo);
  tab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('.x').addEventListener('click', () => panel.classList.remove('open'));
}

export default function initDemoPanel() {
  // Install the real Alloy queue FIRST, so the logger below wraps a live
  // window.alloy instead of pre-empting it (see the file-header note).
  initWebSDK();
  installAlloyLogger();
  build();
  // Re-apply any state that survived navigation, so the store and the panel
  // agree on a fresh page load rather than only after the next click.
  const buyer = ss.buyer();
  if (buyer) window.brandCommerce?.useBuyer?.(buyer);
  if (ss.audience()) window[AUD_GLOBAL] = ss.audience();
  render();
  renderEvents();
  // Emit the page view the Web SDK sends on load, so the inspector is populated.
  window.alloy('sendEvent', {
    xdm: {
      eventType: 'web.webpagedetails.pageViews',
      web: {
        webPageDetails: {
          name: document.title,
          URL: window.location.href,
          pageViews: { value: 1 },
        },
      },
    },
  });
}
