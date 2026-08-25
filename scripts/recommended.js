import store from './commerce.js';
import { getAudience } from './p13n.js';
import { buildCard } from '../blocks/product-cards/product-cards.js';

/**
 * "Recommended for <persona>" — the visible payoff of the audience signal.
 *
 * The Edmund Optics replica personalizes by swapping knowledge articles. This
 * storefront has no article library, so the persona surfaces as products: a
 * labelled strip that appears above the featured grid when an audience is
 * known and removes itself when it isn't.
 *
 * Additive on purpose. The first attempt reordered the curated homepage grid
 * instead, which was unreadable as personalization — six pinned SKUs barely
 * move, and two of the four personas match none of them, so switching persona
 * changed nothing at all.
 *
 * QUERIES ARE SHORT BY NECESSITY. The catalog search matches phrases, not a
 * bag of words: "motor oil" returns 12 products and "spill kit" 14, but a
 * four-word blend like "motor oil antifreeze lubricant bulk" returns zero.
 * Each persona therefore runs a few short queries whose results are merged.
 */

const PERSONA = {
  fleet_maintenance: {
    label: 'Fleet Maintenance',
    queries: ['motor oil', 'antifreeze', 'hydraulic fluid'],
  },
  collision_repair: {
    label: 'Collision / Auto Body',
    queries: ['brake cleaner', 'parts washer', 'degreaser'],
  },
  industrial_ehs: {
    label: 'Industrial EHS',
    queries: ['spill kit', 'absorbent sock', 'containment'],
  },
  pfas_remediation: {
    label: 'PFAS Remediation',
    queries: ['pfas', 'test kit'],
  },
};

const LIMIT = 4;
const CLASS = 'recommended-strip';
/**
 * styles.css hides every direct child of <main> with `main > div {display:none}`
 * and reveals content by class — `.section {display:block}` out-specifies it.
 * A bare div here is built correctly and then silently invisible, so the strip
 * must carry the section class to render at all.
 */
const CLASSES = `section ${CLASS}`;

/**
 * Merge a few short searches, de-duped by SKU. Fired in parallel and merged in
 * declaration order, so the earliest query still fills the strip first without
 * three round trips stacking up — sequentially this took long enough that a
 * persona switch looked like it had done nothing.
 */
async function productsFor(persona) {
  const results = await Promise.all(
    persona.queries.map((query) => store.search({ query, limit: LIMIT })
      .catch(() => [])),
  );
  const byId = new Map();
  results.forEach((hits) => hits.forEach((p) => {
    if (!byId.has(p.sku)) byId.set(p.sku, p);
  }));
  return [...byId.values()].slice(0, LIMIT);
}

/** Sits directly above the first authored product grid. */
function anchor() {
  const grid = document.querySelector('.product-cards');
  return grid?.closest('.section') || grid;
}

let seq = 0;

/**
 * Bring the strip into view when someone picks a persona in the demo panel and
 * it would otherwise change ~1800px below the fold — which reads as nothing
 * having happened at all. Only for an explicit pick: a signal-derived audience
 * carries `source`, and yanking the page around under a reader mid-scroll
 * would be hostile.
 */
function revealIfOffscreen(el, explicit) {
  if (!explicit) return;
  const { top, bottom } = el.getBoundingClientRect();
  const onScreen = top < window.innerHeight * 0.8 && bottom > 0;
  // Deliberately not `behavior: 'smooth'` — it is a silent no-op in some
  // browsers/automation contexts, and a scroll that sometimes does nothing is
  // the exact failure this whole affordance exists to prevent.
  if (!onScreen) el.scrollIntoView({ block: 'center' });
}

async function render(e) {
  const host = anchor();
  if (!host) return;

  const persona = PERSONA[getAudience()];
  const existing = document.querySelector(`.${CLASS}`);

  if (!persona) {
    // Bump the token as well as removing: a persona render already awaiting
    // its search would otherwise finish and re-insert the strip after a reset.
    seq += 1;
    existing?.remove();
    return;
  }

  const mine = seq + 1;
  seq = mine;
  const products = await productsFor(persona);
  // A newer persona was picked while this was in flight.
  if (mine !== seq) return;
  if (!products.length) {
    existing?.remove();
    return;
  }

  const section = existing || document.createElement('div');
  section.className = CLASSES;
  // The inner `product-cards` class is load-bearing, not decorative: every rule
  // in product-cards.css is scoped `.product-cards .x`, so the cards render
  // completely unstyled without it. Adding the class after decoration is safe —
  // block discovery has already run and will not pick this up as a new block.
  section.innerHTML = `
    <div class="product-cards">
      <div class="product-cards-inner">
        <h2 class="product-cards-heading">Recommended for ${persona.label}</h2>
        <div class="product-cards-grid"></div>
      </div>
    </div>`;
  section.querySelector('.product-cards-grid').append(...products.map(buildCard));
  if (!existing) host.parentElement.insertBefore(section, host);

  // `source` is set by a derived signal; the demo panel omits it.
  revealIfOffscreen(section, !!e && !e.detail?.source);
}

export default function initRecommended() {
  render();
  document.addEventListener('p13n:change', render);
}
