-- Safety-Kleen concierge theme — fix the contrast failures.
--
-- ADDITIVE AND TENANT-SCOPED: a jsonb merge on the single brand_configs row for
-- site_key = 'store-safety-clean'. `theme || '{...}'` overwrites only the keys
-- named here and leaves font/dialogRadius/cta/ctaInk/primary/userInk as they
-- are. No other brand is touched, and no shared code changes.
--
-- The problem: the theme used the Safety-Kleen yellow #FFD400 as the LINK
-- colour and paired white text with a yellow PRIMARY background. Measured
-- against white, both land at 1.43:1 — WCAG AA wants 4.5:1 for body text — so
-- the "View in new window" links, the recommendation CTAs and the suggestion
-- chips were effectively unreadable.
--
-- Yellow is not dropped: it stays as the CTA fill, where #131313 ink on
-- #FFD400 measures 12.98:1 and matches the storefront's Add-to-quote button.
-- What changes is only where yellow was being used as TEXT.
--
--   link         #FFD400 -> #0b78c4   1.43:1 -> 4.67:1 on white. The banner
--                                     blue already in the palette, chosen when
--                                     the storefront hit the same problem.
--   onPrimary    #ffffff -> #131313   1.43:1 -> 12.98:1 on the yellow primary
--                                     (.bc-contact, .bc-book-now, recording mic)
--   primaryHover (unset) -> #E6BF00   was falling through to the widget's navy
--                                     default, so a yellow button turned blue
--                                     on hover
--   ctaAdded     #109BFB -> #0b78c4   white on #109BFB is 2.96:1; the same
--                                     blue fixes the "Added" state at 4.67:1
--   ctaAddedInk  (unset) -> #ffffff   state the ink explicitly rather than
--                                     inheriting it
--   userBg       #7c7979 -> #767373   white on the old grey was 4.31:1, just
--                                     under AA; two shades darker clears it at
--                                     4.70:1 and is visually near-identical

update public.brand_configs
set theme = coalesce(theme, '{}'::jsonb) || jsonb_build_object(
  'link',        '#0b78c4',
  'onPrimary',   '#131313',
  'primaryHover', '#E6BF00',
  'ctaAdded',    '#0b78c4',
  'ctaAddedInk', '#ffffff',
  'userBg',      '#767373'
)
where site_key = 'store-safety-clean';

-- Verify:
-- select site_key, theme from public.brand_configs
--   where site_key = 'store-safety-clean';
