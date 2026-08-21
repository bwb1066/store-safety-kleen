# store-safety-clean — go-live setup

Everything code- and content-side is done. Three manual steps remain (all
require your da.live / GitHub login — they can't be done over the DA MCP API).

Repo: `bwb1066/store-safety-clean` (public) · Org/Site in DA: `bwb1066` / `store-safety-clean`

---

## 1. Install AEM Code Sync on the repo

Open <https://github.com/apps/aem-code-sync/installations/new> and grant it access
to **bwb1066/store-safety-clean**. This is what publishes the repo to
`main--store-safety-clean--bwb1066.aem.page` / `.aem.live`.

## 2. Create the site config (content source → DA)

In da.live, create/confirm the site config so the preview/live hosts read the DA
content bus. The config values:

```json
{
  "previewHost": "main--store-safety-clean--bwb1066.aem.page",
  "liveHost": "main--store-safety-clean--bwb1066.aem.live",
  "contentSourceUrl": "https://content.da.live/bwb1066/store-safety-clean/",
  "contentSourceType": "markup"
}
```

(If you provisioned the site through da.live's "Create site" action, this is set
for you — just confirm it points at `content.da.live/bwb1066/store-safety-clean/`.)

## 3. Register the block library (so blocks show in the DA picker)

The Library palette only appears if the project config has a sheet named exactly
**`library`**. Open <https://da.live/config#/bwb1066/store-safety-clean/> →
**Add sheet** → name it `library` → paste these rows (cols `title`, `path`):

| title | path |
| --- | --- |
| Blocks | https://content.da.live/bwb1066/store-safety-clean/docs/library/blocks.json |
| Templates | https://content.da.live/bwb1066/store-safety-clean/docs/library/templates.json |
| Icons | https://content.da.live/bwb1066/store-safety-clean/docs/library/icons.json |
| Generate Variations | https://experience.adobe.com/aem/generate-variations |

Save. (Also at `reference/da-library/da-native/config-library.tsv`.)

## 4. Preview the content (required)

The library docs + pages render from their **preview**, not their source. In
da.live, bulk-**Preview** these, then reload the editor:

- `docs/library/blocks/` (whole folder) + `docs/library/blocks.json`
- `fragments/nav/header`, `fragments/nav/footer`
- `index`

---

## What's already done

- **Repo** spawned from the AK baseline (`origin` + `base` remotes).
- **22 blocks** authored into DA at `docs/library/blocks/` (+ `blocks.json`).
- **Nav authored into DA**: `fragments/nav/header` (utility + primary/mega-menu),
  `fragments/nav/footer`. Source reference lists in `reference/*-nav.html`.
- **Homepage** authored at `index` (hero + promo + Shop by Category).
- **Theme** applied in code (`styles/styles.css`, `blocks/header|footer|hero`):
  single yellow `rgb(255 212 0)`, `#030404` utility bar, `#7c7979` mega-menu,
  white primary nav w/ 4px yellow underline, Roboto Condensed headings + Arial
  body, no border radii. Self-hosted Roboto Condensed in `styles/fonts/`.

## Preview locally now (before code sync is live)

```
cd store-safety-clean
npx @adobe/aem-cli up --no-open
```

Serves local `blocks/styles/scripts` from disk and proxies DA content from the
preview host — so you can see the themed chrome + hero immediately and iterate.
