import { getMetadata } from '../../scripts/ak.js';
import { getAudience } from '../../scripts/p13n.js';

/**
 * Persona → opening prompts. The chips are the cheapest place a persona shows
 * up on this site: no new content is needed, and the shift is legible the
 * instant the audience changes.
 *
 * The authored `suggestions` row is the ANONYMOUS baseline — a known persona
 * overrides it, the same way a Target activity overrides default content. The
 * author still owns what an unidentified visitor sees.
 */
const PERSONA_SUGGESTIONS = {
  fleet_maintenance: [
    'Schedule a used oil pickup',
    'Bulk antifreeze for a 40-truck fleet',
    'Compare hydraulic fluids',
  ],
  collision_repair: [
    'Find the right parts washer',
    'Solvent options for a 3-bay shop',
    'Brake cleaner by the case',
  ],
  industrial_ehs: [
    'Build a spill kit for a loading dock',
    'Absorbents for a 55-gallon spill',
    'Containment pallets and berms',
  ],
  pfas_remediation: [
    'How do PFAS test kits work?',
    'Sampling for PFAS in groundwater',
    'Dispose of PFAS-contaminated media',
  ],
};

// Brand Concierge (Jack) config is author-controlled via page metadata
// (concierge-url / concierge-key / concierge-site). This block is the
// prominent inline entry point; it supplies its own trigger, so the widget's
// corner bubble stays suppressed (showTrigger: false).
const WIDGET_BASE = 'https://bwb1066.github.io/brand-concierge/widget/';
// Version query busts the browser/CDN module cache when the widget updates
// (the GH Pages URL is otherwise cached for 10 min with no revalidation).
const WIDGET_URL = `${WIDGET_BASE}brand-concierge.js?v=commerce2`;
// eslint-disable-next-line max-len
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5anF1d2hrbXp5ZWRrd3VhZmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY4MjcsImV4cCI6MjA5MDY0MjgyN30.GkMBLXBZr9u34m4uI6ZR-2ZniLZD3RkjropjQw058k4';
const SUPABASE_URL = getMetadata('concierge-url') || 'https://cyjquwhkmzyedkwuaffc.supabase.co';
const SUPABASE_KEY = getMetadata('concierge-key') || DEFAULT_KEY;
const SITE_KEY = getMetadata('concierge-site') || 'store-safety-clean';

const DEFAULTS = {
  eyebrow: 'Ask Jack, your Safety-Kleen AI Concierge',
  heading: 'What do you need for your facility today?',
  placeholder: 'e.g. a parts washer for a 3-bay shop',
  suggestions: [
    'Schedule a used oil pickup',
    'Find the right parts washer',
    'Dispose of household hazardous waste',
  ],
};

/**
 * Read the block's labeled authoring rows into a config object. Each row is
 * `| key | value |`; recognized keys: eyebrow, heading, placeholder,
 * suggestions (comma-separated). Missing keys fall back to DEFAULTS.
 */
function readConfig(el) {
  const cfg = { ...DEFAULTS };
  for (const row of el.children) {
    const [keyCell, valCell] = row.children;
    const key = keyCell?.textContent.trim().toLowerCase();
    if (valCell && key === 'suggestions') {
      const items = valCell.textContent.split(',').map((s) => s.trim()).filter(Boolean);
      if (items.length) cfg.suggestions = items;
    } else if (valCell && ['eyebrow', 'heading', 'placeholder'].includes(key)) {
      const v = valCell.textContent.trim();
      if (v) cfg[key] = v;
    }
  }
  return cfg;
}

/**
 * ask-jack — prominent inline concierge prompt. On submit, opens the themed
 * brand-concierge modal prefilled with the query (native chat takes over).
 *
 * Authoring contract (one row per setting, all optional):
 *   | ask-jack    |                                        |
 *   | eyebrow     | Ask Jack, your Safety-Kleen AI Concierge |
 *   | heading     | What do you need for your facility today? |
 *   | placeholder | e.g. a parts washer for a 3-bay shop     |
 *   | suggestions | Schedule a pickup, Find a parts washer   |
 *
 * @param {Element} el The block element
 */
export default function init(el) {
  const cfg = readConfig(el);

  // The widget module is only fetched once the user actually engages, so it
  // stays off the critical path (see prefetch on focus/hover below).
  let chat = null;
  let loading = null;
  const loadChat = () => {
    if (!loading) {
      loading = import(/* webpackIgnore: true */ WIDGET_URL).then((mod) => {
        mod.init({
          supabaseUrl: SUPABASE_URL,
          anonKey: SUPABASE_KEY,
          siteKey: SITE_KEY,
          showTrigger: false,
          widgetBase: WIDGET_BASE,
        });
        chat = mod;
        return mod;
      });
    }
    return loading;
  };

  const openJack = async (query) => {
    const q = (query || '').trim();
    if (!q) return;
    if (!chat) await loadChat();
    chat.default(q);
  };

  const inner = document.createElement('div');
  inner.className = 'ask-jack-inner';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'ask-jack-eyebrow';
  eyebrow.innerHTML = '<span class="ask-jack-avatar" aria-hidden="true">J</span>';
  const eyebrowText = document.createElement('span');
  eyebrowText.textContent = cfg.eyebrow;
  eyebrow.append(eyebrowText);

  const heading = document.createElement('h2');
  heading.className = 'ask-jack-heading';
  heading.textContent = cfg.heading;

  const form = document.createElement('form');
  form.className = 'ask-jack-form';
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.className = 'ask-jack-input';
  input.type = 'text';
  input.placeholder = cfg.placeholder;
  input.setAttribute('aria-label', cfg.heading);
  // Warm the module as soon as intent is shown, so submit feels instant.
  input.addEventListener('focus', loadChat, { once: true });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'ask-jack-submit';
  submit.setAttribute('aria-label', 'Ask Jack');
  submit.innerHTML = '&rarr;';

  form.append(input, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    openJack(input.value);
  });
  form.addEventListener('pointerenter', loadChat, { once: true });

  const chips = document.createElement('div');
  chips.className = 'ask-jack-chips';

  const renderChips = () => {
    const items = PERSONA_SUGGESTIONS[getAudience()] || cfg.suggestions;
    chips.replaceChildren(...items.map((s) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ask-jack-chip';
      chip.textContent = s;
      chip.addEventListener('click', () => {
        input.value = s;
        openJack(s);
      });
      return chip;
    }));
  };
  renderChips();
  document.addEventListener('p13n:change', renderChips);

  inner.append(eyebrow, heading, form, chips);
  el.replaceChildren(inner);
}
