/* eslint-disable no-underscore-dangle */
/**
 * Adobe-branded demo control + Web SDK inspector, gated behind ?demo.
 *
 * Ported from the Edmund Optics replica and re-pointed at Safety-Kleen's two
 * axes. EO switches persona to swap knowledge articles; this storefront has no
 * article library, so here the persona drives catalog emphasis and the
 * concierge's suggested prompts, while IDENTITY drives what the commerce
 * backend actually returns — contract pricing, and whether the 16 DOT-hazmat
 * SKUs are visible at all.
 *
 * - Lets you fake the personalization state (audience persona + "logged-in"
 *   contract account) without a real Target/AEP setup.
 * - Installs a logging shim over window.alloy that CAPTURES every sendEvent and
 *   pretty-prints the XDM that the Web SDK would post to the Adobe Edge /
 *   Datastream — so the inspector works even with no datastream configured
 *   (events are captured, not sent). If a real alloy exists, it forwards too.
 *
 * State lives in sessionStorage so it survives navigation during a demo, and is
 * read by personalization.js (audience override) and the commerce store (buyer).
 */

import { OVERRIDE_KEY, BUYER_KEY } from './p13n.js';

const ADOBE_RED = '#fa0f00';
const DEMO_FLAG = 'sk_demo';

const AUDIENCES = [
  { key: '', label: 'Anonymous' },
  { key: 'fleet_maintenance', label: 'Fleet Maintenance' },
  { key: 'collision_repair', label: 'Collision / Auto Body' },
  { key: 'industrial_ehs', label: 'Industrial EHS' },
  { key: 'pfas_remediation', label: 'PFAS Remediation' },
];

/**
 * The identity keys are buyer EMAILS: resolveBuyer() in the commerce edge
 * function matches commerce_buyers.email exactly, scoped by site_key. Seeded by
 * reference/commerce/20260824_sk_demo_buyers.sql.
 */
const BUYERS = [
  {
    key: 'fleet@midstate-transit.example',
    label: 'Midstate Transit',
    note: 'contract pricing',
  },
  {
    key: 'ehs@northline-industrial.example',
    label: 'Northline Industrial',
    note: 'contract pricing + hazmat clearance',
  },
];

const captured = [];
let els = {};

export function demoEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('demo')) {
    const v = params.get('demo');
    if (v === '0' || v === 'off' || v === 'false') {
      sessionStorage.removeItem(DEMO_FLAG);
      return false;
    }
    sessionStorage.setItem(DEMO_FLAG, '1');
  }
  return sessionStorage.getItem(DEMO_FLAG) === '1';
}

const ss = {
  audience: () => sessionStorage.getItem(OVERRIDE_KEY) || '',
  buyer: () => sessionStorage.getItem(BUYER_KEY) || '',
};

// ── Web SDK capture ───────────────────────────────────────────────────────
function renderEvents() {
  if (!els.log) return;
  els.log.innerHTML = captured.length
    ? captured.map((e) => {
      const time = new Date(e.t).toLocaleTimeString();
      const type = e.payload?.xdm?.eventType || e.command;
      return '<div class="sk-demo-evt"><div class="sk-demo-evt-head">'
        + `<span class="sk-demo-chip">${type}</span><span class="sk-demo-time">${time}</span></div>`
        + `<pre>${JSON.stringify(e.payload, null, 2)}</pre></div>`;
    }).join('')
    : '<p class="sk-demo-empty">No events yet — interact with the page (add to quote, ask Jack) and the Web SDK payloads appear here.</p>';
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
  els.ident.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.buyer === buyer);
  });

  // Identity and audience are independent, so name only the axes that are
  // actually set — "Northline Industrial — Anonymous" reads as a contradiction
  // when it just means a known account with no persona yet.
  const account = BUYERS.find((b) => b.key === buyer);
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
  if (key) sessionStorage.setItem(OVERRIDE_KEY, key);
  else sessionStorage.removeItem(OVERRIDE_KEY);
  window.skAudience = key || undefined;
  // Show the decision request the site would make for this persona.
  window.alloy('sendEvent', {
    xdm: {
      eventType: 'decisioning.propositionFetch',
      _demo: { decisionScope: 'storefront-catalog', persona: key || 'default' },
    },
  });
  announce();
  render();
}

function setBuyer(key) {
  // Clicking the active account logs it out.
  const next = ss.buyer() === key ? '' : key;
  if (next) sessionStorage.setItem(BUYER_KEY, next);
  else sessionStorage.removeItem(BUYER_KEY);

  // This is what actually changes prices and hazmat visibility: the store
  // re-resolves the open cart and every later catalog call carries ?buyer=.
  window.brandCommerce?.useBuyer?.(next || null);

  const account = BUYERS.find((b) => b.key === next);
  window.alloy('sendEvent', {
    xdm: {
      eventType: next ? 'identity.authenticatedState' : 'identity.loggedOut',
      identityMap: next
        ? { CRMID: [{ id: next, primary: true, authenticatedState: 'authenticated' }] }
        : {},
      _demo: {
        account: next || null,
        contract: !!next,
        hazmatClearance: account?.key === 'ehs@northline-industrial.example',
      },
    },
  });
  announce();
  render();
}

function reset() {
  sessionStorage.removeItem(OVERRIDE_KEY);
  sessionStorage.removeItem(BUYER_KEY);
  window.skAudience = undefined;
  window.brandCommerce?.useBuyer?.(null);
  announce();
  render();
}

// Turn the demo off entirely: clear state + the sticky flag and remove the UI.
function exitDemo() {
  reset();
  sessionStorage.removeItem(DEMO_FLAG);
  els.tab?.remove();
  els.panel?.remove();
}

const STYLES = `
.sk-demo-tab{position:fixed;right:0;top:38%;z-index:2147483000;display:flex;align-items:center;gap:8px;
  padding:10px 12px;background:#1d1d1d;color:#fff;border:0;border-right:4px solid ${ADOBE_RED};
  border-radius:8px 0 0 8px;cursor:pointer;font:600 12px/1 -apple-system,system-ui,sans-serif;
  letter-spacing:.04em;box-shadow:0 2px 12px rgb(0 0 0 / 30%)}
.sk-demo-tab .dot{width:12px;height:12px;border-radius:2px;background:${ADOBE_RED}}
.sk-demo-panel{position:fixed;top:0;right:0;height:100vh;width:390px;max-width:92vw;z-index:2147483001;
  background:#fff;box-shadow:-8px 0 30px rgb(0 0 0 / 25%);transform:translateX(100%);
  transition:transform .22s ease;display:flex;flex-direction:column;font:14px/1.4 -apple-system,system-ui,sans-serif;color:#222}
.sk-demo-panel.open{transform:none}
.sk-demo-hd{background:#1d1d1d;color:#fff;padding:16px 18px;border-bottom:4px solid ${ADOBE_RED};display:flex;align-items:center;gap:10px}
.sk-demo-hd .dot{width:16px;height:16px;border-radius:3px;background:${ADOBE_RED}}
.sk-demo-hd b{font-size:14px;display:block}
.sk-demo-hd small{color:#b9b9b9;font-size:11px;letter-spacing:.04em}
.sk-demo-hd .x{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
.sk-demo-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:16px}
.sk-demo-sec>h4{margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#767676}
.sk-demo-aud{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sk-demo-ident{display:grid;gap:8px}
.sk-demo-aud button,.sk-demo-ident button{padding:9px 10px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;
  cursor:pointer;font:inherit;font-weight:600;color:#333;text-align:center}
.sk-demo-aud button.is-on{background:${ADOBE_RED};border-color:${ADOBE_RED};color:#fff}
.sk-demo-ident button small{display:block;font-weight:400;font-size:11px;color:#767676;margin-top:2px}
.sk-demo-ident button.is-on{background:#1a7f37;border-color:#1a7f37;color:#fff}
.sk-demo-ident button.is-on small{color:#d6f0dd}
.sk-demo-reset{width:100%;padding:8px;border:0;background:none;color:${ADOBE_RED};cursor:pointer;font:inherit;font-weight:600}
.sk-demo-exit{width:100%;padding:9px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;color:#555;cursor:pointer;font:inherit;font-weight:600}
.sk-demo-state{padding:10px 12px;border-radius:6px;background:#f4f4f4;font-size:13px}
.sk-demo-state b{color:#111}
.sk-demo-inspector{flex:1;border-top:1px solid #eee;padding:14px 18px;overflow:auto;background:#fafafa}
.sk-demo-inspector>h4{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#767676}
.sk-demo-inspector .note{margin:0 0 10px;font-size:11px;color:#999}
.sk-demo-evt{margin:0 0 10px;border:1px solid #eaeaea;border-radius:6px;background:#fff;overflow:hidden}
.sk-demo-evt-head{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f3f3f3}
.sk-demo-chip{font:600 11px/1.4 ui-monospace,monospace;color:${ADOBE_RED}}
.sk-demo-time{font-size:10px;color:#999}
.sk-demo-evt pre{margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;word-break:break-word;color:#333;max-height:200px;overflow:auto}
.sk-demo-empty{font-size:12px;color:#999}
`;

function build() {
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);

  const tab = document.createElement('button');
  tab.className = 'sk-demo-tab';
  tab.type = 'button';
  tab.innerHTML = '<span class="dot"></span>Adobe · Web SDK';

  const panel = document.createElement('aside');
  panel.className = 'sk-demo-panel';
  panel.innerHTML = `
    <div class="sk-demo-hd">
      <span class="dot"></span>
      <span><b>Adobe Experience Platform</b><small>WEB SDK · PERSONALIZATION DEMO</small></span>
      <button class="x" type="button" aria-label="Close">×</button>
    </div>
    <div class="sk-demo-body">
      <div class="sk-demo-sec">
        <h4>Audience (implicit persona)</h4>
        <div class="sk-demo-aud"></div>
      </div>
      <div class="sk-demo-sec">
        <h4>Identity (contract account)</h4>
        <div class="sk-demo-ident"></div>
      </div>
      <div class="sk-demo-state">Current: <b class="sk-demo-statev">Anonymous</b></div>
      <button class="sk-demo-reset" type="button">Reset to anonymous</button>
      <button class="sk-demo-exit" type="button">Exit demo</button>
    </div>
    <div class="sk-demo-inspector">
      <h4>Datastream events</h4>
      <p class="note">What the Web SDK would post to the Adobe Edge for this session.</p>
      <div class="sk-demo-log"></div>
    </div>`;

  document.body.append(tab, panel);

  els = {
    tab,
    panel,
    aud: panel.querySelector('.sk-demo-aud'),
    ident: panel.querySelector('.sk-demo-ident'),
    reset: panel.querySelector('.sk-demo-reset'),
    exit: panel.querySelector('.sk-demo-exit'),
    state: panel.querySelector('.sk-demo-statev'),
    log: panel.querySelector('.sk-demo-log'),
  };

  AUDIENCES.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.aud = a.key;
    b.textContent = a.label;
    b.addEventListener('click', () => setAudience(a.key));
    els.aud.append(b);
  });

  BUYERS.forEach((buyer) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.buyer = buyer.key;
    b.innerHTML = `${buyer.label}<small>${buyer.note}</small>`;
    b.addEventListener('click', () => setBuyer(buyer.key));
    els.ident.append(b);
  });

  els.reset.addEventListener('click', reset);
  els.exit.addEventListener('click', exitDemo);
  tab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('.x').addEventListener('click', () => panel.classList.remove('open'));
}

export default function initDemoPanel() {
  installAlloyLogger();
  build();
  // Re-apply any state that survived navigation, so the store and the panel
  // agree on a fresh page load rather than only after the next click.
  const buyer = ss.buyer();
  if (buyer) window.brandCommerce?.useBuyer?.(buyer);
  if (ss.audience()) window.skAudience = ss.audience();
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
