# OpenSpell equipment: renderer audit and authoring workflow

Audited revision: `50ab3edf91c1c12468ec2b3ee6d5c380a168f091`.

## Evidence

- [Client bundle](https://github.com/Metsutan/openspell/blob/50ab3edf91c1c12468ec2b3ee6d5c380a168f091/apps/shared-assets/base/js/client/client.61.js): `iU`, the human sprite worker, defines composition. Its equipment lookup also defines the supported sheet indices. `tests/fixtures/client-worker.js` contains the unmodified worker for independent comparisons.
- [Appearance bundle](https://raw.githubusercontent.com/Metsutan/openspell/50ab3edf91c1c12468ec2b3ee6d5c380a168f091/apps/shared-assets/base/static/carbon/appearance.carbon): PNG atlases stored as `{filename,data}` entries.
- [Item definitions](https://raw.githubusercontent.com/Metsutan/openspell/50ab3edf91c1c12468ec2b3ee6d5c380a168f091/apps/shared-assets/base/static/itemdefs.carbon): logical equipment sheets, sprite IDs, independent trim IDs, hiding flags and gameplay metadata.
- [Asset overlay](https://github.com/Metsutan/openspell/blob/50ab3edf91c1c12468ec2b3ee6d5c380a168f091/apps/web/src/lib/assetOverlay.ts): appearance replaces the entire base file; item definitions merge by `_id`, replacing each matching record in full.

The client composites existing raster frames. It does not rotate a single equipment image to generate the other directions at runtime. The studio's sprite transformations are an authoring aid, not a reconstruction of a hidden game rig.

## Frames and sheets

Every cell is **64 × 128**. An item occupies **5 or 15 consecutive cells**, with row wrapping at the actual atlas width. Five-frame parts repeat each cell for three animation frames. The 15 preview frames are five direction groups with three walk samples in each.

| Slot | Frames | Logical sheet | Native artwork | Authoring approach |
| --- | ---: | --- | --- | --- |
| Helmet | 5 | `helmet1` | `helmet1.png`, optional `helmettrim1.png` | Five views / template |
| Neck | 5 | `neck1` | `neck1.png` | Five views / template |
| Cape | 15 | `back1` | `cape_front1.png`, `cape_back1.png` | Paired template or authored layers |
| Shield | 15 | `shield1` | `shield_front1.png`, `shield_back1.png`, optional paired trims | Paired template; rigid prototype can follow native silhouettes |
| Legs | 15 | `legs1` | `legs1.png`, optional `legstrim1.png` | Walking template / authored frames |
| Chest | 15 | `chest1` | `chest1.png`, optional `chesttrim1.png` | Walking template / authored frames |
| Gloves | 15 | `gloves1` | `gloves1.png` | Follow hand animation via template |
| Boots | 15 | `boots1` | `boots1.png` | Follow feet via template |
| Weapon/tool | 15 | `weapon1` | `weapon1.png` | Adjustable rigid hand preset or template |
| Projectile | 0 | none | none when equipped | Metadata only |

`pants.png` is character clothing; it is not the leg-armour atlas. Sheet suffixes select already loaded bitmap arrays; assigning an invented `shield2` or `weapon2` does not install another atlas in the current client.

## Exact composition order

The order is fixed. Most directional visibility is already encoded in transparent pixels / blank cells, including the shield's front and rear sheets.

1. Pumpkin-mask rear: only item **617**, `helmet_back1.png` sprite **0**.
2. `cape_front1.png`, behind the character.
3. Shield rear, then its trim.
4. Base pants.
5. Boots and leg armour, with the exception below; trim immediately follows leg armour.
6. Body.
7. Base shirt unless the chest item's `hidesSpritesUnderneath` is true.
8. Chest and gloves, with the exceptions below; trim immediately follows chest.
9. Supplemental glove sprite **12** for equipped item IDs **611–616**.
10. Neck item.
11. `cape_back1.png`, over the body.
12. Beard then hair, unless the helmet item's `hidesSpritesUnderneath` is true.
13. Helmet then trim.
14. Shield front then its trim.
15. Weapon/tool.

Thus **yes, capes have artwork depicting both front and rear views**. Those names do not directly mean foreground/background drawing order. The main cape body seen from the rear must be painted *over* the character's back.

The worker receives `doLegsHideSpritesUnderneath` but does not use it. Pants remain visible below leg armour. The studio stores that flag and tells the user that it has no effect on legs in this client.

There is no arbitrary weapon “behind body” switch. That old studio checkbox produced an appearance the exported client could not reproduce; native composition now controls the preview.

### Overlap exceptions

- When both boots and legs exist, boots draw on top unless leg sprite ID is **9–14** on sheet index **0**. Otherwise boots draw before legs.
- When both chest and gloves exist, gloves draw over chest except for chest sprite IDs **9–15** on sheet **0**, or the combination of chest sprite IDs **0–4, 6–8** and glove sprite IDs **13–16, 19–20**, both on sheet **0**.
- Items **611–616** draw an additional archer-glove sprite after chest/gloves. New copies bake this detail into the source. Existing-item replacement keeps the original separate native exception. Baking cannot retain the extra layer's separate order against every possible chest; inspect the exported-ID preview with the intended outfit.
- Only item **617** gets the pumpkin rear layer. A new helmet copy omits it. Choosing **Edit original** for 617 loads that source, and no other helmet is offered the unsupported rear layer.

These rules are based on actual IDs, not equipment names or material tags. Appending a copy of an exceptional chest or leg sprite gives it a new ID and can change its overlap. The main preview uses the *allocated output ID*, so it shows this resulting behaviour; library thumbnails show existing game items.

## Workflow implemented in this rework

1. **Browse a game item** in the searchable bundled library, or **upload a PNG** immediately. Browsing preserves the current draft. **Clone item** creates a new definition; **Edit original** retains the existing definition and sprite IDs. **New item** starts a blank draft. No carbon import gate. All actual paired layers and referenced trims load together; missing trims remain absent.
2. Use the **Artwork**, **Colours**, and **Item settings** tabs to edit a copy, replace any source layer, or adjust individual frames. Colour replacements support a source eyedropper, palette, tolerance, shading preservation and individual toggles, while preserving source pixels. Five direction groups, walking playback and optional other equipment make overlap visible.
3. For a **single rigid sprite**, choose its grip point and size, then generate poses. Weapons use an editable hand preset. Shields derive position, side compression and blank-cell timing from native shield silhouettes; a missing mate is generated using the same input image. The rear surface is still a prototype until its artwork is supplied. Armour templates remain the reliable path for bent limbs and missing rear details.
4. Finished 320 × 128 / 960 × 128 strips retain their source artwork; weapon uploads receive the optional cutouts described below. Whole PNG atlases have an item-index extractor. Five directional images can be repeated into a static 15-frame cycle; this does not invent walking animation. Source clicks set the pivot, preview dragging translates artwork, scroll rotates, Ctrl/Command-scroll resizes, and Shift-scroll skews. The pivot overlay is separate from exported pixels.
5. Save a self-contained v3 draft with source images, per-layer poses, pivot, colour replacements, cutout masks and generation settings. Older projects migrate; old 15-frame helmet/neck art requires explicitly choosing five directions. Old drafts without embedded images need their original PNG reattached.
6. Choose **Sprite pack** or **OpenSpell patch** explicitly. Loading project assets never silently changes what an export button means.

Project connection reads the standard base and custom asset folders, using the same wholesale appearance and definition-record overlay rules as the game. Separate asset-file imports also work. Reads do not modify the checkout. Bundled assets are pinned and shipped locally, so the app does not fetch GitHub during ordinary authoring.

### Automatic weapon cutouts

The client draws weapons last. Native artwork supplies transparent holes where the hand or body should remain visible. The studio applies equivalent masks to uploaded weapons, including finished strips, after their per-frame transforms. Those holes are present in exported PNGs and native patches; they are not just a preview overlay.

The masks are calibrated from body 0, gloves 0, pants 0 and the native bronze longsword. Hand cutouts use the overlap of body and gloves; rear-body cutouts use body and pants in frames 10–15. Visible longsword pixels are protected to retain the native guard and pommel. Small prebuilt mask PNGs ship separately from the appearance bundle, and drafts embed them for restoration without the library.

These are fixed mannequin masks, not depth reconstruction or masks recalculated for every equipped armour combination. **Automatic cutouts** can use hands only or be switched off for unusual artwork. Native templates keep their original cutouts and do not receive new masks by default. Colour mappings, transforms and cutouts are reversible; source images remain intact.

### Export contract

- A sprite pack has PNG layers, a manifest mapping them to native sheets, the proposed item definition, the editable project, and instructions. Its sprite IDs are provisional until merged into the target game assets.
- A native patch adds the **complete** `carbon/appearance.carbon`. New sprite IDs follow both physical atlas occupancy and referenced IDs. Paired main sheets share an ID; trim sheets share their own separately allocated ID. Atlas widths stay fixed and heights grow as needed. Old pixels and unrelated entries are retained.
- Native replacement is explicit. Transparent pixels clear the replaced slot, preventing remnants of the old sprite from surviving.
- `itemdefs.carbon` is at the ZIP root. Merge these full changed records into `apps/shared-assets/custom/static/itemdefs.carbon`; copy appearance to `apps/shared-assets/custom/static/carbon/appearance.carbon`. Do not overwrite other custom definitions with a one-item array. A target using custom asset-path environment variables needs those corresponding paths instead.
- Exporting does not install assets or accumulate multiple separate exports automatically. Reconnect the current game assets before appending further items, or re-import the previous native patch first, to retain those additions and advance ID allocation.
- Inventory icon creation, balancing/effect editing, character-customization authoring, game-client changes and deployment are outside this change. Existing item metadata is retained when cloning.

## Verification

`npm test` runs the studio compositor and the **unmodified upstream worker** on the same decoded atlases and compares raw RGBA output:

- 343 equipped item definitions, all 15 frames each, plus a bare mannequin.
- 1,629 mixed outfits: all chest/glove pairs, all leg/boot pairs, and 90 complete outfits.
- 159 distinct helmet, leg-armour, cape and shield layers extracted and repacked with identical decoded artwork.
- Atlas row wrapping, transparent replacement, separately allocated trim IDs, paired sheets, unrelated entries and item metadata, narrow rigid sprites and clipping, project migration and invalid imports.
- Native longsword preservation, automatic cutouts on generated and uploaded strips, draft/native-export consistency, and colour replacement matching, shading and alpha preservation.

`npm run test:ui` exercises the real UI in Chrome: source upload → generation → visible sprite in every frame; per-frame edit and undo; pivot and wheel gestures; draft save/reload; both export choices; native-bundle re-import; all slot templates; browsing without losing a draft; new/clone/original identity; reversible colour replacements; automatic cutouts and offline restoration; legacy selection and responsive layout. It saves screenshots under `artifacts/` for inspection. These checks exercise normal equipped appearance, not client ghost/death filters, lighting, combat animations or a live game server.

## Where 3D helps next

The audited repository tree did not contain `.blend`, `.glb`, `.gltf`, `.fbx` or `.obj` authoring sources. A compatible original character rig is therefore not available from those files. There is no implemented 3D importer or baker in this change.

A useful next increment is a **calibrated rigid-object baker**, beginning with shields and helmets:

1. Fit an orthographic camera, five headings, scale and attachment coordinates to a known exported item. Treat equal angular spacing as an initial hypothesis, then compare against the actual silhouettes. Match the raster character before adding arbitrary model import.
2. Render the front, edge and rear surfaces of a simple shield model to 64 × 128 RGBA cells. Reuse the native three-frame attachment motion for rigid objects. Render an untextured validation model first so lighting cannot conceal alignment errors.
3. Produce the paired native layers and visibility masks; compare the complete equipped result in the existing compositor, including edge pixels. A single RGB render of the whole character would destroy editability and native layer semantics.
4. Add model/material controls only after that calibration passes. Keep the generated PNG strips and project format as the interchange boundary, so 2D edits and exports continue working.
5. Body armour needs a matching skeleton, weights and three walking samples per direction. A rigid 3D chest mesh or rotating flat image cannot reproduce the original bending limbs. Build that as a separate rigging task after the rigid bake proves useful.

This is an implementation proposal inferred from the raster contract above, not a claim that OpenSpell currently ships a compatible 3D pipeline.
