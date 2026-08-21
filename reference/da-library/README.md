# DA Library Setup — Blocks (bwb1066/store-safety-clean)

Generated here: AK-native block docs + aem-* block docs (`da-native/`), the
merged blocks sheet (`da-native/blocks.json`), the aem-* paste-ready docs +
`blocks-sheet.csv` (manual path), and the project-config `library` sheet as a
pastable TSV (`da-native/config-library.tsv`).

Four steps get blocks into the editor picker. Do NOT skip step 3 — an
unpreviewed block doc shows in the picker with **no name** and inserts an
**empty block**.

## 1. Author the block docs — MCP path (preferred)

Write the `da-native/` files VERBATIM (already DA stored div form):

- Each `da-native/<name>.html` → `da_create_source(bwb1066, store-safety-clean,
  "docs/library/blocks/<name>.html", <file contents>, "text/html")`.
- `da_create_source(bwb1066, store-safety-clean, "docs/library/blocks.json",
  <da-native/blocks.json contents>, "application/json")`. If a blocks sheet
  already exists, merge these `data` rows in instead of overwriting.

(aem-* also have paste-ready `aem-*.html` for manual da.live entry — paste
below the marker; DA converts the table. AK-native are native-only; type them
by hand if not using MCP.)

## 2. Register the library in the project config

The editor's Library palette only shows blocks if the project config has a
sheet named exactly **`library`**. Edit at
`https://da.live/config#/bwb1066/store-safety-clean/` → **Add sheet** → name it `library`
→ paste `da-native/config-library.tsv` (title/path rows for Blocks, Templates,
Icons, Generate Variations). This config lives in DA's config service, NOT a
content source — it can't be written with `da_create_source`. Save.

## 3. PREVIEW the block docs  ← required, easy to miss

The library renders each block's name + preview (and the markup it inserts)
from the doc's PREVIEW, not its source. After authoring, preview the whole
`docs/library/blocks/` tree **and** `docs/library/blocks.json`:

- da.live: open the `docs/library/blocks` folder, select all, **Preview**; also preview `blocks.json`.
- or admin API (needs auth): `POST https://admin.hlx.page/preview/bwb1066/store-safety-clean/main/docs/library/blocks/<name>` for each.

## 4. Reload the DA editor

Open **Library → Blocks** in the sidekick — all blocks appear WITH names, and
insert with their sample content.

## Caveats

- **aem-form** needs a form-definition JSON; **aem-search** a published query
  index; **aem-modal** is link-triggered (`/modals/...`).
- **header / footer** (and `aem-header`/`aem-footer`) are page chrome, not
  picker blocks.
- No AK-native **quote** block (only `aem-quote`); **schedule** is a
  backend/event block, not a picker item — both intentionally omitted.
- Sample images use the Author Kit demo image on the preview host — swap for
  real assets.
