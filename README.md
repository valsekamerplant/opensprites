# OpenSpell Item Studio

Create equipment using the game's artwork and actual layering rules. The library ships with the app: **no carbon uploads are needed to start**.

```sh
npm install
npm run dev
```

Choose an equipment type and upload your own PNG, or browse the bundled library. Clicking a library item previews it without changing your draft. **Clone item** creates a copy with a new item ID; **Edit original** keeps the existing item and sprite IDs for replacement. **New item** starts a blank draft. Templates include their paired sheets and optional trims.

The inspector has three tabs: **Artwork**, **Colours**, and **Item settings**. In Colours, pick a source colour from the image or palette, choose its replacement, and adjust tolerance and shading preservation. Each replacement can be toggled or removed. Whole-layer tint is also available. Colour changes preserve the original source image.

For a single sprite, click its grip point, set its size, and **Generate poses**. Weapons use an adjustable hand preset. Shields follow native template placement and visibility. Rigid generation is a prototype for armour; use directional art or templates to supply rear surfaces and moving limbs.

Drag in the character preview to position artwork. Scroll to rotate, Ctrl/Command-scroll to resize, or Shift-scroll to skew. The visible pivot guide can be toggled and never appears in exports. In Artwork, click the source preview to set its pivot; finished strips rotate around that point too.

Uploaded weapon PNGs automatically get hand and rear-body cutouts, including finished strips. **Automatic cutouts** offers hands only or off when needed. The masks follow the native mannequin and longsword overlap; inspect unusual weapons with the intended outfit. Cutouts are baked into exported artwork, while drafts retain the original image and editable masks. The small bundled mask files work without importing carbon files.

Save an editable draft at any time. Export offers two explicit choices:

- **Sprite pack:** PNG layers, mapping manifest, proposed item definition and editable project. No game bundle needed.
- **OpenSpell patch:** complete updated appearance bundle and changed item definition, allocated against the current library. Connect your project folder first when it has custom artwork, or re-import the previous patch before adding more items.

The optional **Project library** panel accepts an OpenSpell checkout or individual asset files. Base/custom precedence matches the game. It reads files without modifying your checkout.

Native patch installation:

1. Copy `carbon/appearance.carbon` into `apps/shared-assets/custom/static/carbon/appearance.carbon`.
2. Merge the full records in `itemdefs.carbon` by `_id` into `apps/shared-assets/custom/static/itemdefs.carbon`, preserving other custom records.
3. Rebuild/restart the game's assets as appropriate for your setup. Custom asset-path environment variables may change these locations.

The appearance file replaces the whole bundle. Exporting separate patches against the same old library does not combine their new items; connect the updated assets before the next addition. Inventory icons and deployment are separate tasks.

See the [renderer audit and 3D follow-up proposal](docs/renderer-audit.md) for exact draw order, shield/cape behaviour, hardcoded equipment exceptions and automation limits. No 3D model importer is included yet.

## Development

```sh
npm test          # raw pixel comparisons with the actual upstream drawing worker
npm run test:ui   # Chrome upload/generate/edit/save/export/re-import checks
npm run build    # TypeScript and production bundle
```

UI tests default to Chrome's standard Windows installation path. Set `CHROME_PATH` to a local Chrome/Chromium executable on other systems.

`npm run sync:game` deliberately refreshes the bundled game files and independent test worker from the revision pinned in `scripts/sync-openspell.mjs`, then rebuilds the weapon masks. `npm run masks:build` rebuilds just those masks. Audit and update that revision together with the compositor when upgrading OpenSpell. Provenance and SHA-256 hashes are in `public/game/provenance.json`; upstream's MIT license is in `public/game/LICENSE`.
