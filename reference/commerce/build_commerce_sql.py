"""Generate the Safety-Kleen commerce backfill migration.

Follows the AvKARE / eo-concept-3b pattern: brand_products is the single source
of truth, a row is only buyable when sku AND list_price are non-null, and every
synthesized value is deterministic (hashed off the product URL) so re-running
this produces byte-identical SQL.

Real, scraped:      sku, name, description, image, url, category, list_price
Synthesized:        uom, specs, price_breaks, stock_qty, lead_time_days,
                    min_order_qty, restricted, restriction
"""
import hashlib
import json
import re

SITE_KEY = 'store-safety-clean'

# --- hazmat gating ---------------------------------------------------------
# Categories whose contents are DOT-regulated. Mirrors AvKARE's controlled-
# substance gating so the entitlement path gets exercised in the demo.
HAZMAT_CATS = (
    'solvent-chemistries', 'industrial-lab-chemistries',
    'brake-cleaner', 'household-hazardous-waste',
)
HAZMAT_WORDS = (
    'solvent', 'brake clean', 'brake parts clean', 'acetone', 'toluene',
    'xylene', 'mineral spirits', 'naphtha', 'flammable', 'paint thinner',
    'lacquer', 'aerosol',
)
RESTRICTION = ('DOT-regulated hazardous material - ground ship only; '
               'requires a certified-handler account')
# Equipment shelved alongside chemicals (sprayers, can recyclers) is not itself
# regulated -- keep it out of the gate even when its category or name matches.
NOT_HAZMAT_WORDS = (
    'sprayer', 'recycler', 'machine', 'cabinet', 'pump', 'dispenser',
    'lifter', 'funnel', 'trolley', 'cart', 'adsorbent', 'absorbent',
)

UOM_RULES = [
    (r'\btote\b', 'tote'), (r'\bdrum\b', 'drum'), (r'\bpail\b', 'pail'),
    (r'\bbale\b', 'bale'), (r'\bbucket\b', 'bucket'), (r'\bkit\b', 'kit'),
    (r'\bbox of\b|\bbox\b', 'box'), (r'\bcase\b', 'case'),
    (r'\broll\b', 'roll'), (r'\bbag\b', 'bag'),
    (r'\bgallons?\b', 'gallon'), (r'\bcarton\b', 'carton'),
]


def h(s, salt=''):
    return int(hashlib.md5((s + salt).encode()).hexdigest()[:8], 16)


def q(s):
    """Single-quote a SQL string literal, or NULL."""
    if s is None or s == '':
        return 'null'
    return "'" + str(s).replace("'", "''") + "'"


def uom_of(name):
    low = name.lower()
    for pat, u in UOM_RULES:
        if re.search(pat, low):
            return u
    return 'each'


def specs_of(p):
    name, spec = p['productName'], {}
    cat = p.get('gaCategory2') or p.get('gaCategory') or ''
    if cat:
        spec['category'] = cat
    m = re.search(r'\b(\d+W-\d+)\b', name, re.I)
    if m:
        spec['viscosity'] = m.group(1).upper()
    m = re.search(r'\b(\d+(?:\.\d+)?)\s*(gallon|gal|oz|ounce|quart|qt|liter)s?\b', name, re.I)
    if m:
        spec['volume'] = f'{m.group(1)} {m.group(2).lower()}'
    m = re.search(r'\bof\s+(\d+)\b', name, re.I) or re.search(r'\b(\d+)\s*(?:ct|count|pk|pack)\b', name, re.I)
    if m:
        spec['pack size'] = f'{m.group(1)} per {uom_of(name)}'
    m = re.search(r'(\d+(?:\.\d+)?)"\s*[xX]\s*(\d+(?:\.\d+)?)"', name)
    if m:
        spec['dimensions'] = f'{m.group(1)}" x {m.group(2)}"'
    spec['container'] = uom_of(name)
    return spec


def is_hazmat(p):
    cat = (p.get('category') or '').lower()
    name = p['productName'].lower()
    if any(w in name for w in NOT_HAZMAT_WORDS):
        return False
    if any(c in cat for c in HAZMAT_CATS):
        return True
    return any(w in name for w in HAZMAT_WORDS)


def main():
    products = json.load(open('products_priced.json'))
    rows, skipped, hazmat = [], [], 0

    for p in products:
        url = p['productPageUrl']
        sku = (p.get('sku') or p.get('itemId') or '').strip()
        price = p.get('listPrice')
        if not sku or not price:
            skipped.append(p['productName'])
            continue

        seed = h(url)
        # ~1 in 7 out of stock, mirroring the AvKARE lead-time demo
        oos = h(url, 'stk') % 7 == 0
        stock = 0 if oos else 25 + (seed % 900)
        lead = (3 + h(url, 'lead') % 12) if oos else 0
        uom = uom_of(p['productName'])
        moq = 1
        if uom in ('drum', 'tote'):
            moq = 1
        elif price < 25:
            moq = 2 + (seed % 3)

        # Two volume breaks: ~8-14% at the first tier, ~16-24% at the second.
        t1 = 4 + (h(url, 't1') % 5)
        t2 = t1 * (3 + h(url, 't2') % 3)
        d1 = 0.08 + (h(url, 'd1') % 7) / 100.0
        d2 = d1 + 0.08 + (h(url, 'd2') % 7) / 100.0
        breaks = [
            {'min_qty': t1, 'unit_price': round(price * (1 - d1), 2)},
            {'min_qty': t2, 'unit_price': round(price * (1 - d2), 2)},
        ]

        haz = is_hazmat(p)
        if haz:
            hazmat += 1

        rows.append((
            url, sku, round(float(price), 2), uom,
            json.dumps(specs_of(p), ensure_ascii=False),
            json.dumps(breaks), stock, lead, moq, haz,
            RESTRICTION if haz else None,
        ))

    body = ',\n'.join(
        f"    ({q(u)}, {q(s)}, {pr}, {q(uo)}, {q(sp)}::jsonb, {q(pb)}::jsonb, "
        f"{st}, {ld}, {mo}, {'true' if rs else 'false'}, {q(rt)})"
        for (u, s, pr, uo, sp, pb, st, ld, mo, rs, rt) in rows
    )

    sql = f"""-- Safety-Kleen commerce: enable the tenant + make its concierge products
-- BUYABLE. brand_products is the single source of truth (commerce_catalog is
-- deprecated), and _shared/commerce.ts searchProducts filters on
-- `.not sku is null .not list_price is null` -- so chat-only uploads return
-- nothing from the commerce path until these columns are backfilled.
--
-- Run AFTER uploading product-catalog.json via the config UI (that pass creates
-- the rows + embeddings; this one attaches commerce attributes to them).
--
-- Provenance: sku, name, description, image, product_url and list_price are
-- REAL, scraped from store.safety-kleen.com (prices come from the GA4 dataLayer
-- on each PDP). uom, specs, price_breaks, stock_qty, lead_time_days,
-- min_order_qty and the hazmat flags are SYNTHESIZED for demo purposes --
-- deterministic from the product URL, so re-running is stable.
--
-- Additive + gated to site_key '{SITE_KEY}'; no other brand is touched.

-- 1. tenant config ---------------------------------------------------------
insert into public.brand_configs (site_key, brand_name, commerce_enabled, currency, facet_hints)
values (
  '{SITE_KEY}', 'Safety-Kleen', true, 'USD',
  '["category","container","volume","viscosity","pack size"]'::jsonb
)
on conflict (site_key) do update set
  commerce_enabled = excluded.commerce_enabled,
  currency = excluded.currency,
  facet_hints = excluded.facet_hints;

-- 2. commerce attributes onto the existing catalog rows --------------------
with seed (product_page_url, sku, list_price, uom, specs, price_breaks,
           stock_qty, lead_time_days, min_order_qty, restricted, restriction) as (
  values
{body}
)
update public.brand_products b set
  sku             = s.sku,
  list_price      = s.list_price,
  currency        = 'USD',
  uom             = s.uom,
  specs           = s.specs,
  price_breaks    = s.price_breaks,
  stock_qty       = s.stock_qty,
  lead_time_days  = s.lead_time_days,
  min_order_qty   = s.min_order_qty,
  restricted      = s.restricted,
  restriction     = s.restriction,
  active          = true
from seed s
where b.site_key = '{SITE_KEY}'
  and b.product_page_url = s.product_page_url;

-- 3. demo buyer ------------------------------------------------------------
-- visibleTo() in _shared/commerce.ts hardcodes the entitlement string
-- "export-controlled", so that is the literal a hazmat buyer needs in order to
-- see the {hazmat} restricted SKUs. Contract pricing left empty.
insert into public.commerce_buyers (site_key, email, company, price_book, entitlements)
values (
  '{SITE_KEY}', 'demo@safety-kleen.example', 'Safety-Kleen Demo Fleet',
  '{{}}'::jsonb, array['export-controlled']
)
on conflict (site_key, email) do update set
  entitlements = excluded.entitlements;
"""

    with open('20260821_store_safety_clean_commerce.sql', 'w') as f:
        f.write(sql)

    print(f'rows written:      {len(rows)}')
    print(f'skipped (no sku/price): {len(skipped)}')
    print(f'hazmat restricted: {hazmat}')
    prices = sorted(r[2] for r in rows)
    print(f'price range:       ${prices[0]:,.2f} - ${prices[-1]:,.2f}  median ${prices[len(prices)//2]:,.2f}')
    oos = sum(1 for r in rows if r[6] == 0)
    print(f'out of stock:      {oos}')
    for s in skipped[:10]:
        print('   skip:', s[:70])


if __name__ == '__main__':
    main()
