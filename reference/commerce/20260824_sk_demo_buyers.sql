-- Safety-Kleen demo buyers for the AEP personalization demo.
--
-- ADDITIVE AND TENANT-SCOPED. Every statement is confined to
-- site_key = 'store-safety-clean'. commerce_buyers is unique (site_key, email)
-- and resolveBuyer() in _shared/commerce.ts filters on site_key, so nothing
-- here is reachable from the Edmund Optics tenants (eo-concept-1a /
-- eo-concept-3b) or any other brand. No schema changes, no shared-function
-- changes — the EO demo is untouched by design.
--
-- Two identities back the demo panel's IDENTITY switch, chosen so the two axes
-- of the commerce model are visible separately:
--
--   Midstate Transit   contract pricing, NO hazmat entitlement
--                      -> prices drop, the 16 restricted SKUs stay hidden
--   Northline Industrial  contract pricing + 'export-controlled'
--                      -> prices drop AND the restricted SKUs appear
--
-- NOTE on the entitlement string: visibleTo() in _shared/commerce.ts hardcodes
-- the literal "export-controlled" for every tenant. It reads as a misnomer for
-- Safety-Kleen's DOT-hazmat gating, but renaming it would mean editing shared
-- code that EO also runs, so we reuse the existing literal and label it
-- appropriately in the UI instead.
--
-- Prices below are real contract discounts off the seeded list prices:
--   32073 $780 (restricted drum) · 7200 $128 · 32060 $84 · 7206 $57
--   821 $56 · 7646 $18

-- 1. Fleet account — contract pricing only, no hazmat clearance ------------
insert into public.commerce_buyers (site_key, email, company, price_book, entitlements)
values (
  'store-safety-clean',
  'fleet@midstate-transit.example',
  'Midstate Transit',
  -- ~12% off list across the lubricant/absorbent lines this account buys.
  '{"821": 49.28, "32060": 73.92, "7206": 50.16, "7200": 112.64, "7646": 15.84}'::jsonb,
  array[]::text[]
)
on conflict (site_key, email) do update set
  company      = excluded.company,
  price_book   = excluded.price_book,
  entitlements = excluded.entitlements;

-- 2. Industrial EHS account — contract pricing + hazmat clearance ----------
insert into public.commerce_buyers (site_key, email, company, price_book, entitlements)
values (
  'store-safety-clean',
  'ehs@northline-industrial.example',
  'Northline Industrial',
  -- ~18% off, and a negotiated price on the restricted 55-gal drum that only
  -- this account can see at all.
  '{"32073": 639.60, "821": 45.92, "32060": 68.88, "7206": 46.74, "7200": 104.96, "7646": 14.76}'::jsonb,
  array['export-controlled']
)
on conflict (site_key, email) do update set
  company      = excluded.company,
  price_book   = excluded.price_book,
  entitlements = excluded.entitlements;

-- 3. Backfill the original demo buyer's empty price book ------------------
-- It was seeded with '{}', so "Contract pricing applied" showed in the quote
-- drawer while every price stayed at list. Only touches this one SK row.
update public.commerce_buyers
set price_book = '{"32073": 663.00, "821": 47.60, "32060": 71.40, "7206": 48.45, "7200": 108.80, "7646": 15.30}'::jsonb
where site_key = 'store-safety-clean'
  and email = 'demo@safety-kleen.example'
  and price_book = '{}'::jsonb;

-- Verify: three buyers, only for this tenant.
-- select email, company, entitlements, jsonb_object_keys(price_book) from
--   public.commerce_buyers where site_key = 'store-safety-clean';
