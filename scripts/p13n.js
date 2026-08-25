/**
 * Personalization state — the single read API shared by the product blocks,
 * the concierge prompt and the demo panel. State is faked client-side today
 * (the demo panel and the derived in-session signal set it); when Adobe is
 * live, only the middle step changes (a real Target decision) and consumers
 * stay as they are.
 *
 * Ported from the Edmund Optics replica. Keys are `sk_`-prefixed so the two
 * demos can share a browser session without treading on each other.
 */

const OVERRIDE_KEY = 'sk_audience_override';
const BUYER_KEY = 'sk_demo_buyer';

/** Current audience: explicit override → implicit signal (window.skAudience) → default. */
export function getAudience() {
  try {
    return sessionStorage.getItem(OVERRIDE_KEY) || window.skAudience || 'default';
  } catch (e) {
    return window.skAudience || 'default';
  }
}

/**
 * The "logged-in" account, or '' when anonymous. This is the buyer EMAIL:
 * resolveBuyer() in the commerce function matches commerce_buyers.email
 * exactly, scoped by site_key.
 */
export function getBuyer() {
  try {
    return sessionStorage.getItem(BUYER_KEY) || '';
  } catch (e) {
    return '';
  }
}

/** Subscribe to state changes (fired by the demo panel). */
export function onChange(fn) {
  document.addEventListener('p13n:change', (e) => fn(e.detail || {}));
}

export { OVERRIDE_KEY, BUYER_KEY };
