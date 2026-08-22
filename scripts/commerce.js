/**
 * Shared commerce store — the single client-side spine behind every commerce
 * block (product-cards, product-detail, quote-cart) and Hugo's add-to-quote.
 *
 * Two interchangeable adapters behind one API (blocks never change):
 *  - LOCAL  (default): static catalog JSON + a localStorage quote. Fully
 *    demoable with no backend; cross-tab `storage` sync previews the
 *    cross-surface cart.
 *  - REMOTE (when `commerce-url` metadata is set): the Supabase `commerce` edge
 *    function + Supabase Realtime, so a quote is shared across surfaces — the
 *    site, Hugo, and a Claude/MCP session all write one cart and the badge
 *    updates live.
 *
 * Config (page-metadata-driven, same convention as the concierge-* keys):
 *   commerce-site     tenant key (default eo-concept-3b)
 *   commerce-catalog  local catalog JSON URL (LOCAL mode)
 *   commerce-url      Supabase URL (presence selects REMOTE mode)
 *   commerce-key      Supabase anon key (REMOTE mode)
 *
 * Tenant-generic: domain specifics live in each product's `specs` map, so the
 * same code serves EO, Safety-Kleen, or Analog Devices by swapping the catalog.
 */

import { getMetadata } from './ak.js';

const SITE_KEY = getMetadata('commerce-site') || 'store-safety-clean';
const CATALOG_URL = getMetadata('commerce-catalog') || '/drafts/data/sk-catalog.json';
const COMMERCE_URL = getMetadata('commerce-url') || 'https://cyjquwhkmzyedkwuaffc.supabase.co';
// eslint-disable-next-line max-len
const COMMERCE_KEY = getMetadata('commerce-key') || getMetadata('concierge-key')
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5anF1d2hrbXp5ZWRrd3VhZmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjY4MjcsImV4cCI6MjA5MDY0MjgyN30.GkMBLXBZr9u34m4uI6ZR-2ZniLZD3RkjropjQw058k4';
const REMOTE = !!COMMERCE_URL;
const API = `${COMMERCE_URL}/functions/v1/commerce`;
const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';
const CART_KEY = `commerce_quote_${SITE_KEY}`;
const CARTID_KEY = `commerce_cartid_${SITE_KEY}`;
// Label the concierge/agent surfaces show on their add-to-quote control. B2C
// tenants can set `commerce-cta-label: Add to cart` in page metadata.
const CTA_LABEL = getMetadata('commerce-cta-label') || 'Add to quote';
// PDP template path — product cards link here with ?sku=<sku> so any catalog
// product resolves on one dynamic product page.
const PDP_URL = getMetadata('commerce-pdp') || '';

const listeners = new Set();
let currentBuyer = null; // LOCAL: full object; REMOTE: { key }

// ── Pure helpers (shared) ────────────────────────────────────────────────

function formatPrice(n, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n || 0);
}

function resolvePrice(product, qty = 1, buyer = currentBuyer) {
  const contract = buyer?.price_book?.[product.sku];
  if (contract != null) return contract;
  const breaks = (product.price_breaks || [])
    .filter((b) => qty >= b.min_qty)
    .sort((a, b) => b.min_qty - a.min_qty);
  if (breaks.length) return breaks[0].unit_price;
  return product.list_price;
}

function visibleTo(product, buyer = currentBuyer) {
  if (!product.restricted) return true;
  return !!buyer?.entitlements?.includes('export-controlled');
}

function priceTable(product) {
  const rows = [{ min_qty: product.min_order_qty || 1, unit_price: product.list_price }];
  (product.price_breaks || []).forEach((b) => rows.push({ ...b }));
  return rows.sort((a, b) => a.min_qty - b.min_qty);
}

function emit(quote) {
  listeners.forEach((fn) => {
    try {
      fn(quote);
    } catch (e) { /* a bad listener must not break the others */ }
  });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function quoteCount(quote) {
  return (quote?.lines || []).reduce((n, l) => n + l.qty, 0);
}

function quoteTotal(quote) {
  return (quote?.lines || []).reduce((sum, l) => sum + l.qty * l.unit_price, 0);
}

// ── LOCAL adapter ────────────────────────────────────────────────────────

let catalogPromise = null;

function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .catch(() => ({ products: [] }));
  }
  return catalogPromise;
}

function matchesQuery(product, query) {
  if (!query) return true;
  const hay = [product.name, product.sku, product.description, product.category,
    ...Object.values(product.specs || {})].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function matchesFilters(product, filters) {
  if (!filters) return true;
  return Object.entries(filters).every(([key, val]) => {
    const specVal = String(product.specs?.[key] ?? '').toLowerCase();
    return specVal.includes(String(val).toLowerCase());
  });
}

async function localSearch({ query = '', filters = null, limit = 24 } = {}) {
  const { products = [] } = await loadCatalog();
  return products
    .filter((p) => visibleTo(p))
    .filter((p) => matchesQuery(p, query))
    .filter((p) => matchesFilters(p, filters))
    .slice(0, limit);
}

async function localGetProduct(sku) {
  const { products = [] } = await loadCatalog();
  const product = products.find((p) => p.sku === String(sku));
  if (!product || !visibleTo(product)) return null;
  return product;
}

async function localAvailability(sku, qty = 1) {
  const product = await localGetProduct(sku);
  if (!product) return null;
  return {
    sku: product.sku,
    in_stock: product.stock_qty > 0,
    stock_qty: product.stock_qty,
    lead_time_days: product.lead_time_days || 0,
    min_order_qty: product.min_order_qty || 1,
    unit_price: resolvePrice(product, qty),
    qty_break_table: priceTable(product),
  };
}

function readLocalQuote() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt/unavailable storage */ }
  return {
    id: `q_${Date.now().toString(36)}`, site_key: SITE_KEY, status: 'open', note: '', lines: [],
  };
}

function writeLocalQuote(quote) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(quote));
  } catch (e) { /* ignore storage failures */ }
  emit(quote);
  return quote;
}

async function localAdd(sku, qty = 1, via = 'web') {
  const product = await localGetProduct(sku);
  if (!product) return null;
  const quote = readLocalQuote();
  const existing = quote.lines.find((l) => l.sku === product.sku);
  const nextQty = (existing?.qty || 0) + qty;
  const unitPrice = resolvePrice(product, nextQty);
  if (existing) {
    existing.qty = nextQty;
    existing.unit_price = unitPrice;
  } else {
    quote.lines.push({
      sku: product.sku,
      name: product.name,
      image_url: product.image_url,
      qty: nextQty,
      unit_price: unitPrice,
      lead_time_days: product.lead_time_days || 0,
      added_via: via,
    });
  }
  return writeLocalQuote(quote);
}

async function localSetQty(sku, qty) {
  const quote = readLocalQuote();
  const line = quote.lines.find((l) => l.sku === String(sku));
  if (!line) return quote;
  if (qty <= 0) {
    quote.lines = quote.lines.filter((l) => l.sku !== String(sku));
  } else {
    const product = await localGetProduct(sku);
    line.qty = qty;
    if (product) line.unit_price = resolvePrice(product, qty);
  }
  return writeLocalQuote(quote);
}

function localRemove(sku) {
  const quote = readLocalQuote();
  quote.lines = quote.lines.filter((l) => l.sku !== String(sku));
  return writeLocalQuote(quote);
}

function localSubmit(note = '') {
  const quote = readLocalQuote();
  const submitted = {
    ...quote, note, status: 'submitted', quote_number: `Q-${Date.now().toString(36).toUpperCase()}`,
  };
  try {
    localStorage.removeItem(CART_KEY);
  } catch (e) { /* ignore */ }
  emit(readLocalQuote());
  return submitted;
}

async function localUseBuyer(buyerKey) {
  if (!buyerKey) {
    currentBuyer = null;
  } else {
    const { buyers = {} } = await loadCatalog();
    currentBuyer = buyers[buyerKey] ? { key: buyerKey, ...buyers[buyerKey] } : null;
  }
  emit(readLocalQuote());
  return currentBuyer;
}

// ── REMOTE adapter (Supabase edge fn + Realtime) ─────────────────────────

let cachedCart = { site_key: SITE_KEY, status: 'open', lines: [] };
let cartId = null;
let rtClient = null;
let rtChannel = null;

function api(path, { method = 'GET', body = null } = {}) {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: COMMERCE_KEY,
      Authorization: `Bearer ${COMMERCE_KEY}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  }).then((r) => r.json()).catch(() => ({}));
}

function buyerParam() {
  return currentBuyer?.key || '';
}

function setCache(cart) {
  cachedCart = cart || { site_key: SITE_KEY, status: 'open', lines: [] };
  if (cachedCart.id) cartId = cachedCart.id;
  emit(cachedCart);
}

async function refetchCart() {
  if (!cartId) return;
  const { cart } = await api(`/cart?cart_id=${encodeURIComponent(cartId)}`);
  if (cart) setCache(cart);
}

async function subscribeRealtime(id) {
  if (!id || (rtChannel && cartId === id)) return;
  try {
    if (!rtClient) {
      const mod = await import(/* webpackIgnore: true */ SUPABASE_ESM);
      rtClient = mod.createClient(COMMERCE_URL, COMMERCE_KEY);
    }
    if (rtChannel) rtClient.removeChannel(rtChannel);
    rtChannel = rtClient
      .channel(`cart_${id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'commerce_cart_items', filter: `cart_id=eq.${id}`,
      }, refetchCart)
      .subscribe();
  } catch (e) { /* Realtime is a live-update nicety; fetches still work without it */ }
}

async function ensureCart() {
  if (cartId) return cartId;
  if (buyerParam()) {
    const { cart } = await api(`/cart?site_key=${SITE_KEY}&buyer=${encodeURIComponent(buyerParam())}`);
    if (cart) setCache(cart);
  } else {
    try {
      const saved = localStorage.getItem(CARTID_KEY);
      if (saved) cartId = saved;
    } catch (e) { /* ignore */ }
    if (!cartId) {
      const { cart } = await api('/cart', { method: 'POST', body: { site_key: SITE_KEY } });
      if (cart) {
        setCache(cart);
        try {
          localStorage.setItem(CARTID_KEY, cart.id);
        } catch (e) { /* ignore */ }
      }
    }
  }
  if (cartId) subscribeRealtime(cartId);
  return cartId;
}

async function remoteSearch({ query = '', limit = 24 } = {}) {
  const qs = new URLSearchParams({ site_key: SITE_KEY, q: query, limit: String(limit) });
  if (buyerParam()) qs.set('buyer', buyerParam());
  const { products = [] } = await api(`/products?${qs}`);
  return products;
}

async function remoteGetProduct(sku) {
  const qs = new URLSearchParams({ site_key: SITE_KEY, sku: String(sku) });
  if (buyerParam()) qs.set('buyer', buyerParam());
  const { product = null } = await api(`/product?${qs}`);
  return product;
}

async function remoteAvailability(sku, qty = 1) {
  const qs = new URLSearchParams({ site_key: SITE_KEY, sku: String(sku), qty: String(qty) });
  if (buyerParam()) qs.set('buyer', buyerParam());
  const { availability = null } = await api(`/availability?${qs}`);
  return availability;
}

async function remoteAdd(sku, qty = 1, via = 'web') {
  await ensureCart();
  const { cart } = await api('/cart/items', {
    method: 'POST',
    body: {
      site_key: SITE_KEY, buyer: buyerParam(), cart_id: cartId, sku, qty, via,
    },
  });
  if (cart) setCache(cart);
  return cachedCart;
}

async function remoteSetQty(sku, qty) {
  await ensureCart();
  const { cart } = await api('/cart/line', {
    method: 'POST',
    body: {
      site_key: SITE_KEY, buyer: buyerParam(), cart_id: cartId, sku, qty,
    },
  });
  if (cart) setCache(cart);
  return cachedCart;
}

async function remoteRemove(sku) {
  const { cart } = await api('/cart/remove', { method: 'POST', body: { cart_id: cartId, sku } });
  if (cart) setCache(cart);
  return cachedCart;
}

async function remoteSubmit(note = '') {
  const { quote } = await api('/cart/submit', { method: 'POST', body: { cart_id: cartId, note } });
  cartId = null;
  try {
    localStorage.removeItem(CARTID_KEY);
  } catch (e) { /* ignore */ }
  setCache({ site_key: SITE_KEY, status: 'open', lines: [] });
  return quote || {};
}

async function remoteUseBuyer(buyerKey) {
  currentBuyer = buyerKey ? { key: buyerKey } : null;
  cartId = null;
  if (buyerKey) await ensureCart();
  else setCache({ site_key: SITE_KEY, status: 'open', lines: [] });
  return currentBuyer;
}

// ── Cross-surface bridge helper ──────────────────────────────────────────

/**
 * Add the best catalog match for a free-text product name/description to the
 * quote. This is what the Hugo concierge (and any agent surface) calls, since
 * it works from a product title rather than a known SKU. Returns the matched
 * SKU or an error when nothing in the catalog matches.
 */
async function addByQuery(text, via = 'concierge') {
  const query = (text || '').trim();
  if (!query) return { error: 'empty_query' };
  const opts = { query, limit: 1 };
  const results = await (REMOTE ? remoteSearch(opts) : localSearch(opts));
  if (!results.length) return { error: 'not_in_catalog', query };
  const product = results[0];
  await (REMOTE ? remoteAdd(product.sku, 1, via) : localAdd(product.sku, 1, via));
  return { added: true, sku: product.sku, name: product.name };
}

// ── Public API (dispatches to the active adapter) ────────────────────────

const store = {
  siteKey: SITE_KEY,
  remote: REMOTE,
  enabled: true,
  ctaLabel: CTA_LABEL,
  pdpUrl: PDP_URL,
  formatPrice,
  resolvePrice,
  priceTable,
  quoteCount,
  quoteTotal,
  subscribe,
  addByQuery,
  getBuyer: () => currentBuyer,
  getQuote: () => (REMOTE ? cachedCart : readLocalQuote()),
  search: (opts) => (REMOTE ? remoteSearch(opts) : localSearch(opts)),
  getProduct: (sku) => (REMOTE ? remoteGetProduct(sku) : localGetProduct(sku)),
  checkAvailability: (sku, qty) => (
    REMOTE ? remoteAvailability(sku, qty) : localAvailability(sku, qty)),
  addToQuote: (sku, qty, via) => (REMOTE ? remoteAdd(sku, qty, via) : localAdd(sku, qty, via)),
  setLineQty: (sku, qty) => (REMOTE ? remoteSetQty(sku, qty) : localSetQty(sku, qty)),
  removeLine: (sku) => (REMOTE ? remoteRemove(sku) : localRemove(sku)),
  submitQuote: (note) => (REMOTE ? remoteSubmit(note) : localSubmit(note)),
  useBuyer: (key) => (REMOTE ? remoteUseBuyer(key) : localUseBuyer(key)),
};

if (typeof window !== 'undefined') {
  // Expose the store under a GENERIC global so any surface — the Hugo concierge
  // widget, an agent bridge — can add to the same quote on any replica site.
  // The widget keys off `window.brandCommerce`; nothing brand-specific leaks in.
  window.brandCommerce = store;
  // Cross-tab sync for the LOCAL adapter (REMOTE uses Supabase Realtime).
  if (!REMOTE) {
    window.addEventListener('storage', (e) => {
      if (e.key === CART_KEY) emit(readLocalQuote());
    });
  }
  // ?buyer=<key> activates contract pricing (and, REMOTE, resolves the cart).
  const buyerFromUrl = new URLSearchParams(window.location.search).get('buyer');
  if (buyerFromUrl) store.useBuyer(buyerFromUrl);
  else if (REMOTE) ensureCart();
}

export default store;
