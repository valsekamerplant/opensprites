# OpenSpell Item Studio

Create equipment using the game's artwork and actual layering rules. The library ships with the app: **no carbon uploads are needed to start**.

```sh
npm install
npm run dev
```

Choose an equipment type, then use the start panel: **start from a game item**, **upload a PNG**, or **open a saved draft**. You can also drop a PNG or draft anywhere on the page. Clicking a library item previews it in a banner without changing your draft: **Clone as new** creates a copy with a new item ID, **Edit original** keeps the existing item and sprite IDs for replacement, and **Back to my draft** (or Esc) returns. **New item** starts a blank draft. Templates include their paired sheets and optional trims.

The inspector follows the workflow in four numbered tabs: **1 Artwork**, **2 Colours & tiers**, **3 Details** and **4 Icon**. Each tab shows ✓ when it is done and ! when something needs attention. The Export button counts the problems that would block an export, and the export dialog lists them in plain words.

In Colours, the palette is grouped into shades of the same material (the great rod's 62 colours become wood, line and bobber). Select a group to recolour all its shades at once: the group's average shade becomes the new colour and its shading is kept. **Group shades** controls how readily shades merge; open a group, or use Pick colour on the source, to replace one colour with its own tolerance and shading options. Each replacement can be toggled or removed. Whole-layer tint recolours as a shading ramp: the layer's average tone becomes the chosen colour while outlines, shading and highlights are kept. Colour changes preserve the original source image.

### Material tiers

**Material tier** (top of Colours & tiers) makes tier variants such as bronze, iron, steel, palladium, coronium, celadon and legendary, plus gold, silver and your own custom tiers.

1. **Mark the material.** Press ◆ beside each colour group that is the item's metal (or cloth…). Clones of the game's tier items, and art painted with a tier's own shades, are marked automatically. Hilts, outlines and gems stay untouched.
2. **Pick a tier.** Each card previews the current frame in that tier; click one to recolour the item and its icon. The name's tier word follows along ("bronze spear" becomes "iron spear"). Undo goes back.
3. **Make variants.** **Duplicate as tier** starts a new draft in another tier with the next free item ID. **Download every tier** zips the layer PNGs, icon and an editable draft for every tier.

How the colours are chosen:
- **Clone of a game tier item** (e.g. bronze longsword): the game's own sibling item (iron longsword…) supplies an exact colour map, so the variant matches the game's art. Shared silhouettes are checked first.
- **New art** (e.g. a new spear) snaps onto the tier's **canonical ramp**: the tier's native material shades, dark to light. Every new item in a tier therefore uses the same shades. The game itself tints each item family slightly differently, so the canonical ramp is the consistent answer for new items.
- **Custom tiers** take a name, a base colour and a reshade strength, and are shaded like group recolours (cooler, richer shadows and warmer, paler highlights). They are saved in this browser, carried inside drafts that use them, and can be exported and imported as JSON.

For a single sprite, click its grip point, set its size, and **Generate poses**. Draw weapons upright as seen from the side, and click where the hand holds them. **Grip style** picks poses measured from the game's own weapons: sword, axe, pickaxe, bow and staff. **Spear** and **Halberd / polearm** are derived because the game has no native ones: both use the staff's placement. A halberd's flat head foreshortens like an axe head, and a spear leans its point slightly forward in the ¾ and side views. Choosing either suggests a name and weapon speed (5 and 6, like the longsword and battleaxe) for a new weapon. Drafts saved with the old polearm style open as Halberd. Shields follow native template placement and visibility. Rigid generation is a prototype for armour; use directional art or templates to supply rear surfaces and moving limbs.

Drag in the character preview to position artwork. Scroll to rotate, Ctrl/Command-scroll to resize, or Shift-scroll to skew. Arrow keys nudge the frame (Shift for 5 px), `[` and `]` rotate, Space plays the walk cycle, and Ctrl/Command+Z / Shift+Z undo and redo. Grip-point numbers, input mode, rotation quality, cutouts and generation adjustments are under **Advanced** in Artwork. The visible pivot guide can be toggled and never appears in exports. Rotated and skewed frames use RotSprite (Scale2x ×8, then nearest sampling) so thin lines and outlines stay intact without new colours; **Rotation quality** in Artwork switches a layer back to plain nearest-pixel. In Artwork, click the source preview to set its pivot; finished strips rotate around that point too.

Uploaded weapon PNGs automatically get hand and rear-body cutouts, including finished strips. **Automatic cutouts** offers hands only or off when needed. The masks follow the native mannequin and longsword overlap; inspect unusual weapons with the intended outfit. Cutouts are baked into exported artwork, while drafts retain the original image and editable masks. The small bundled mask files work without importing carbon files.

**Icon** makes the 48 × 48 inventory icon, also used in shops and on the ground. It can be generated from the artwork (weapons lie diagonally like native icons), uploaded, or, for clones, start from the game's icon with the item's colour changes applied. The selected-state outline is generated to match the game.

The client finds an icon at `items.png` cell *item ID − 1* and sizes that sheet from the number of item definitions, so new items take the lowest free ID (624 against the bundled library). IDs beyond the sheet cannot show an icon, and native export refuses them.

Save an editable draft at any time. Export offers two explicit choices:

- **Sprite pack:** PNG layers, icon and outline, mapping manifest, proposed item definition and editable project. No game bundle needed.
- **OpenSpell patch:** complete updated appearance and icon bundles and changed item definition, allocated against the current library. Connect your project folder first when it has custom artwork, or re-import the previous patch before adding more items.

The **Project library** panel connects your OpenSpell checkout, so exports know your custom items and allocate IDs and sprites after them. Pick the checkout itself, `apps`, or `apps/shared-assets`; copies inside `node_modules`, `build`, `dist` and hidden folders are ignored. You can also load individual asset files. Base/custom precedence matches the game, and the studio never modifies your checkout.

The panel and the header's **Library** chip show what is connected, with game and custom item counts. When a connected library already uses your new item's ID, the item moves to the next free one. In Chrome and Edge the folder is remembered: on your next visit, **Reconnect \<folder\>** reloads it with one click. The export dialog warns when a patch would be built against the bundled game library instead of yours.

Native patch installation:

1. Copy `carbon/appearance.carbon` into `apps/shared-assets/custom/static/carbon/appearance.carbon`.
2. Copy `carbon/items.carbon` into `apps/shared-assets/custom/static/carbon/items.carbon` (also a complete bundle).
3. Merge the full records in `itemdefs.carbon` by `_id` into `apps/shared-assets/custom/static/itemdefs.carbon`, preserving other custom records.
4. Rebuild/restart the game's assets as appropriate for your setup. Custom asset-path environment variables may change these locations.

The appearance and icon files replace their whole bundles. Exporting separate patches against the same old library does not combine their new items; connect the updated assets before the next addition. Deployment is a separate task.

See the [renderer audit and 3D follow-up proposal](docs/renderer-audit.md) for exact draw order, shield/cape behaviour, hardcoded equipment exceptions and automation limits. No 3D model importer is included yet.

## Hosting

`npm run build` writes a static site to `dist/` with relative URLs, so it works from any folder, for example `https://example.com/opensprites/`. Upload the whole `dist/` folder, including `game/` and `reference/`.

## Development

```sh
npm test          # raw pixel comparisons with the actual upstream drawing worker
npm run test:ui   # Chrome upload/generate/edit/save/export/re-import checks
npm run build    # TypeScript and production bundle
```

The UI lives in `src/ui/`: `state.ts` holds the draft and a small event bus, `render.ts` the rendering pipeline, `actions.ts` the shared operations, `materials.ts` the tier logic, and one module per area (`header`, `library-panel`, `stage`, `inspector`, `export-dialog`, `panels/*`). The domain modules in `src/` (`artwork`, `compositor`, `palette`, `tiers`, `export`, `icon`, `library`) have no UI code and are unit-tested directly.

UI tests default to Chrome's standard Windows installation path. Set `CHROME_PATH` to a local Chrome/Chromium executable on other systems (for example `CHROME_PATH=/opt/pw-browsers/chromium npm run test:ui` in Claude Code cloud sessions).

`npm run sync:game` deliberately refreshes the bundled game files and independent test worker from the revision pinned in `scripts/sync-openspell.mjs`, then rebuilds the weapon masks, grip styles and tier palettes. `npm run masks:build` rebuilds just those masks; `npm run poses:build` re-measures the weapon grip styles; `npm run palettes:build` re-derives each tier's material shades and canonical ramp from the paired native items and icons (`src/tier-palettes.ts`). Audit and update that revision together with the compositor when upgrading OpenSpell. Provenance and SHA-256 hashes are in `public/game/provenance.json`; upstream's MIT license is in `public/game/LICENSE`.
