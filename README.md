# Wedding Floor Plan Simulator

A local-first browser app for planning a wedding reception layout. You arrange tables and decor on a to-scale overhead plan, seat your guests, and then walk through the same room in first person. It works on a Mac (Safari or Chrome) and on an iPad (touch), and it runs entirely in the browser. There are no accounts, no servers and no tracking.

> **The room you see first is a demo.** Its L-shaped 84′ × 52′ outline is invented placeholder
> geometry. It is **not** the Vintage Villas reception hall. Real measurements can be entered on the
> **Room** tab without changing any code (see [Supplying the real venue](#supplying-the-real-venue)).

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from an iPad on the same Wi-Fi)
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build at http://localhost:4173
```

Requires Node 20+ (tested with Node 22). Use the dev server or preview server rather than opening `index.html` directly: browsers block module loading from `file://`.

**On an iPad during development:** run `npm run dev` and open the "Network" URL that Vite prints (e.g. `http://192.168.1.20:5173`). The offline/install features need HTTPS, so test those on a deployed copy.

---

## Using the app

### Building the layout

| Action | Mac / PC | iPad |
|---|---|---|
| Add furniture | Click an item in **Add**, or drag it onto the plan | Tap an item (added in a free spot near the middle), or drag it sideways onto the plan |
| Select | Click | Tap |
| Move | Drag. Snaps to a 6″ grid; hold **Option/Alt** to place freely | One-finger drag |
| Rotate | Floating toolbar buttons, drag the pink handle, or **R** / **Shift+R** (15°) | Floating toolbar buttons or drag the pink handle |
| Duplicate / delete | Floating toolbar, **⌘D**, **Delete** | Floating toolbar |
| Exact sizes and positions | Details panel: type `60"`, `5' 6"`, `66 in`, `1.5 m` … | Same, with −/+ steppers |
| Pan | Drag empty space, scroll, or right-drag | Two-finger drag |
| Zoom | Pinch on trackpad, ⌘/Ctrl+scroll, mouse wheel, + / − | Pinch, or the zoom buttons |
| Undo / redo | **⌘Z / ⇧⌘Z** (Ctrl+Z / Ctrl+Y) or the toolbar | Toolbar arrows |
| Fit room in view | **F** or the Fit button | Fit button |
| 3D overview | **3D** toggle (drag to orbit, items can still be dragged) | Same; one finger orbits, two fingers pan/zoom |

Each drag is recorded as a single undo step. Warnings are drawn as an orange outline plus a ⚠ badge, so they don't rely on colour alone. They are also listed in the Details panel and in the status bar. The app warns about overlaps, items on the dance floor, chairs hitting walls or columns, blocked doors and bar service areas, narrow passages (36″ by default), and tight seating (under 22″ of table edge per guest by default). These are planning aids only. They are not safety, accessibility or egress certifications, so review the final layout with the venue.

### Guests and seating

* **Guests** tab: add names one at a time, **Paste a list…** (one name per line), or **Import CSV**. For CSV, the app uses a `Name` / `Guest` column, `First Name` + `Last Name` columns, or else the first column.
* Each guest has their own ID, so two people with the same name stay separate.
* Seat a guest by choosing a table in the guest list (they take the first open seat), or by picking names seat-by-seat in a table's Details panel.
* Removing chairs or deleting a table never deletes guests. They go back to the unassigned list, and the app asks first.
* The 👁 button next to a seat or a seated guest opens the walkthrough from that chair.
* **Seating CSV** exports a table-by-table list.

### Walkthrough

Press **Walk through**. You start at the pink arrow (the entrance point), which you can set on the Room tab.

* **Mac/PC:** click the view to capture the mouse, then use **W A S D** or the arrow keys to walk and **Shift** to walk faster. **Space** sits down at the nearest chair or stands up. **Esc** releases the mouse, and pressing **Esc** again goes back to the editor. If the mouse can't be captured, drag to look instead.
* **iPad:** put your left thumb anywhere on the left side to get a floating joystick, and drag on the right side to look around. Both work at the same time. **Sit**, **Level view** and **Back to editor** stay on screen.
* Walls, tables, chairs, columns and decor block you. The dance floor and doorways do not. If an edit covers the entrance point, the walkthrough starts at the nearest open spot.
* Seated eye height is 1.2 m and standing eye height is 1.65 m. Both can be changed in **Settings**.

---

## Saving, backups and moving between devices

* Everything is autosaved to this browser's `localStorage` about ¾ s after each change. The status bar shows the save state.
* **Each browser and device has its own independent copy.** Sharing the app link does not share your plan, and there is no automatic sync.
* To move a plan between Mac and iPad, use **Export → Project backup (JSON)**. Then send the file by AirDrop, Messages, email or Files, and on the other device use **Import → Add as new layouts** (or **Replace my project**, which asks first and offers a backup). Imports are never merged automatically.
* **Layout only — no guest names** removes every guest record and seat assignment. It is safe to send to the venue or planner.
* Clearing website data, or iPad Safari's automatic storage clean-up, erases autosaved plans. **Export a backup now and then.**
* If saved data is ever damaged, the app does not overwrite it. It keeps a copy and offers to download it, import a backup, or start fresh.
* Other exports: **Overhead image (PNG)** with labels, wall lengths, scale bar and seat counts; **Print / Save as PDF** with the plan plus seating lists; and **Seating list (CSV)**.

### Layouts (variants)

Use the layout menu (top-left, e.g. "Demo layout") to create, duplicate, rename, switch and delete layouts. Each layout keeps its own room, furniture, guest list and seating, so comparing ideas never cross-contaminates them.

---

## Supplying the real venue

### Vintage Villas Event Center — estimate from photos

`venue/vintage-villas-event-center-estimate.json` is a project file containing an **estimated** model of the Event Center plus a starter table layout. Import it with **Import → Add as new layouts**. The `venue/` folder is git-ignored, so the file isn't in the public repository. Send it to people directly when they need it. It is kept out of the bundled app on purpose: the deployed site is public, so venue data is imported locally, the same way as guest lists.

How the estimate was built:

* **Overall size** comes from the venue's published ~4,800 sq ft. It is modelled as a 96′ × 50′ rectangle.
* **Vaulted great room:** exposed cedar trusses, a plank ceiling rising from about 14′ to 23′, iron ring chandeliers and spiral ducts.
* **Flat-ceiling wing:** about 16′ deep and 11′ high, along the patio side, with crystal drum chandeliers. A row of five white pillars separates it from the great room.
* **Entrance end:** the main dark-framed glass double doors with an EXIT sign at the wing corner. Next to them, stone pilasters frame tall windows in the vaulted part.
* **French-door side:** three pairs of French doors, windows, wall sconces and a service door.
* **Lake end:** four tall curtained windows.
* **Patio side:** large picture windows onto the oak-shaded patio with string lights and the lake.

The geometry comes from `src/model/venues.ts`, and the source notes there explain each assumption. **All of it is an estimate.** Replace it with tape measurements or the venue's floor plan, and change the status to *Measured* once confirmed. The numbers that matter most are:

* overall length and width
* the wing depth (from the pillar line to the patio wall)
* the pillar spacing
* each door and window position

### Entering your own measurements

Everything below is done in the app's **Room** tab. No code changes are needed.

The Room tab's sections fold: click a heading to open or close it, and the app remembers your choice in this browser. The long lists (doors & windows, pilasters, columns, ceilings, chandeliers, wall lights) start folded. Each item in them is a one-line summary, such as *Door 2 · Wall 1 · 39′ from start · 6′ wide*, that you click to expand. Tapping an item on the plan, or adding a new one, opens its section and expands its row. Both **Edit on the plan** switches stay near the top so folding never hides them.

1. **Outline.** Use **Paste coordinates…** to enter the corners as `x, z` lines, walking around the room in order. Plain numbers are feet; `12' 6"` or `3.8 m` also work. Alternatively, use **Make a rectangle…** or edit corner values directly. Concave rooms are supported. Self-crossing outlines are rejected with a message.
   **Edit on the plan → Walls, doors & windows** (near the top of the Room tab) adds handles you can drag:
   * **Numbered circles** move a corner.
   * The **⇅ tab** just inside each wall slides the whole wall in or out. Its neighbours stretch to follow. Doors, windows and stone pilasters keep their place in the room, and sconces and the ceiling edge on that wall move with it.
   * A **door bar (brown), window bar (blue) or stone-pilaster bar (striped tan)** slides along its wall. Drag it near another wall to move it there. Tap it to jump to its details.
   * The **round grips** at each end of a door, window or pilaster resize it.
   * The **square handles** move pillars.
   * The **glowing dots** just inside the walls are wall lights (sconces). Drag one along its wall, or near another wall to move it there. The readout warns if it would sit over a door or window. Wall lights also show in the ceilings & chandeliers editing mode.

   Moves snap to the grid step; hold **Option/Alt** to place freely. A readout shows the distances while you drag, and each drag is one undo step.
2. **Doors and windows.** Each one belongs to a wall (walls are numbered from corner *n* to corner *n+1*; the numbers are shown on the plan while the Room tab is open) and is positioned by its distance from the wall's first corner. Doors become walkable gaps.
3. **Stone pilasters, columns, wall height and wall thickness.** **+ Stone pilaster** adds a 3′ wide stone pier on the longest wall, in a spot that doesn't cover a door or window. Drag it into place on the plan, or set its wall, position, width, how far it sticks out, and stone or painted-plaster finish in its row.
4. **Walkthrough entrance.** Tap the plan to place it and choose which way it faces.
5. **Ceilings.** By default the whole room has a flat ceiling at the wall height. To change the height in part of the room, add a ceiling area:
   * **+ Flat ceiling** adds a lower, flat area (for example the 11′ wing).
   * **+ Truss ceiling** adds a vaulted area with exposed wood trusses. It slopes from its *height at the sides* up to its *height at the peak* along a ridge. You can turn the ridge left–right or top–bottom and set the truss spacing.

   Turn on **Edit on the plan → Ceilings & chandeliers** to see each area outlined. Drag an area's label to move it, or its edge tabs to resize it. Edges snap to nearby walls and to other areas' edges, so neighbouring areas meet exactly. You can also type sizes and heights in each area's row, or switch it between flat and truss. Where two areas of different heights meet, the walkthrough shows the short wall between them. If areas overlap, the panel warns you.
6. **Chandeliers.** **+ Iron ring** and **+ Crystal drum** add a chandelier in the middle of the view, sized and hung to suit the ceiling there. Drag it on the plan (in the same edit mode) to move it. Set its diameter and how high its bottom hangs in its row, and use the bin icon to remove it. A chandelier never hangs through the ceiling: if the ceiling above it is lowered, it goes only as high as that ceiling allows.
7. **Wall lights.** **+ Wall light** adds a sconce on the wall nearest the middle of your view, at a spot that isn't over a door or window and is at least 3′ from other lights. Each light's row lets you change its wall, its distance from the wall start and its height, or remove it with the bin icon. **Remove all** clears them. On the plan, drag the glowing dots to move them, or tap one to jump to its row.
8. **Finishes & details:** floor finish, wall colour, what's visible outside, and removing imported ducts. Each door can be double glass, French or single solid, with a frame colour and an optional EXIT sign. Windows can have panes, a transom bar and curtains.
9. **Mark the status** as *Estimated* or *Measured*. The banner on the plan and on exports changes from "Demo room" accordingly.
10. **Optional: trace a floor-plan image.** Use **Add floor-plan image**, then **Calibrate scale** (tap both ends of a known dimension and type its real length), then **Line up a point**. The image is a visual reference only: walls and collisions always come from the outline. It is stored in this browser (IndexedDB) and is only included in project backups if you tick that option.

Replace the furniture demo sizes with your rental company's measurements in each item's Details panel. Chair size and spacing for all tables are set in the Details panel when nothing is selected.

**Privacy:** don't commit real guest lists, floor plans, venue photos or backups to the repository (`.gitignore` excludes common backup names and a `private/` folder). The deployed site is publicly reachable, so the bundled data is always the synthetic demo.

---

## Static hosting

`npm run build` produces a fully self-contained `dist/` folder, with no server, secrets or external requests. Vite's `base` is `./` (relative), so the same build works at a domain root or under a sub-path. The app has no history-based routes, so refreshes and direct loads work on both.

### Option A — Cloudflare Pages

1. Push the repository to GitHub.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
3. Set the build command to `npm run build`, the output directory to `dist`, and the root directory to the repository root.
4. Your site will be at `https://<project>.pages.dev/`.

### Option B — GitHub Pages

1. Push to GitHub, then go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. The included workflow `.github/workflows/deploy-pages.yml` runs the tests, builds, and publishes `dist/` on every push to `main` (or when run manually from the Actions tab).
3. Your site will be at `https://<user>.github.io/<repo>/`.

Nothing is deployed automatically until you set up one of these yourself.

### Install on iPad / Mac (optional)

* **iPad Safari:** **Share → Add to Home Screen** (wording varies by iOS version).
* **Mac:** Safari **File → Add to Dock**, or Chrome's install icon in the address bar.

The normal browser tab works the same without installing.

A service worker (generated at build time with a versioned list of the app's own files) caches the app after the first successful online visit. The status bar then shows **Available offline**. When a new version is deployed, a toast offers **Reload**; your saved plan is kept. Offline support is best-effort, not a backup: an installed home-screen app and Safari may keep **separate** storage, and iOS can evict website data. The service worker never caches your exports or any external request, and it is not used during `npm run dev`.

---

## Data format

Project files are JSON:

```jsonc
{
  "app": "wedding-floor-plan-simulator",
  "kind": "project",            // or "layout-only" (no guests)
  "exportedAt": "2026-11-25T22:00:00.000Z",
  "project": {
    "schemaVersion": 1,
    "activeLayoutId": "layout_…",
    "settings": { "snapInches": 6, "eyeHeight": 1.65, "quality": "medium", … },
    "layouts": [{
      "id": "layout_…", "name": "Main plan",
      "room": {
        "name": "…", "dimensionStatus": "demo | estimated | measured",
        "vertices": [{ "x": -12.8, "z": -7.9 }, …],      // metres; X right, Z down the plan
        "wallHeight": 4.27, "wallThickness": 0.2,
        "openings": [{ "id": "…", "wallIndex": 4, "offset": 7.9, "width": 1.83,
                       "height": 2.44, "sillHeight": 0, "kind": "door" }],
        "columns": [{ "id": "…", "position": { "x": 0, "z": 0 }, "width": 0.46, "depth": 0.46 }],
        "spawn": { "x": -2.1, "z": 6.7 }, "spawnYaw": 0,
        "overlay": { "assetId": "img_…", "width": 28, "aspect": 0.67, "center": {…}, "rotation": 0, "opacity": 0.55, "visible": true }
      },
      "furniture": [{
        "id": "f_…", "type": "roundTable", "label": "Table 1", "number": 1,
        "position": { "x": -10.4, "z": -3.7 }, "rotation": 0,   // radians (= Three.js rotation.y)
        "width": 1.524, "depth": 1.524, "height": 0.762,        // a 60″ round is 1.524 m
        "seats": [{ "id": "seat_…", "guestId": "g_…" }, …],
        "sideCounts": [3, 0, 3, 0],                             // rectangular tables: far, right, near, left
        "variant": "round", "appearance": { "linenColor": "#f8f6f2", "centerpiece": "low-floral" }
      }],
      "guests": [{ "id": "g_…", "name": "Avery Example" }],
      "seating": { "chairWidth": 0.419, "chairDepth": 0.432, "chairHeight": 0.914, "chairOffset": 0.279, "chairFinish": "gold" }
    }]
  },
  "assets": { "img_…": "data:image/jpeg;base64,…" }   // only when reference images are included
}
```

All lengths are metres internally, and the UI shows feet and inches. Seat positions, meshes, clearances and colliders are always derived from this data; no renderer objects are saved. Imports are fully validated before anything changes: JSON syntax, schema version (newer files are refused), duplicate IDs, dangling guest references, double-booked guests, numeric bounds, polygon validity and opening fit. A rejected file leaves your current work untouched. `migrate()` in `src/model/validation.ts` is where future schema upgrades go.

### Deviations from the spec's illustrative contract

* `Furniture` adds optional `number`, `variant` (cake shape, decoration type) and `notes` fields.
* `Layout` adds `seating` (chair dimensions, chair offset from the table edge, chair finish).
* `Room` adds `name`, `wallThickness`, `spawnYaw`, `notes`, an optional reference-image `overlay`, and optional `features`. `features` holds ceiling zones (flat or vaulted with trusses), light fixtures (iron or crystal chandeliers, sconces, ducts), stone pilasters, and finishes (floor, wall colour, exterior view). These are decorative only: walls and collisions still come from the outline, openings, columns and pilasters.
* `Opening` adds an optional `style` (frame colour, door leaves, EXIT sign, window panes, transom, curtains).
* `Project` adds `settings` (snapping, display, walkthrough and quality preferences).
* Guests are always assigned to **seats**. "Assign to a table" puts the guest in the first open seat, so there is a single source of truth.
* The default tight-seating advisory is **22″** of table edge per guest. The spec suggested 24″ as a starting heuristic, but a standard 60″ round with 8 chairs gives about 23.6″ and would be flagged everywhere. You can change this in Settings.

---

## Project structure

```text
src/
  main.ts                 app shell, startup, recovery dialogs
  pwa.ts                  service-worker registration / update prompt
  model/                  types, units, geometry, seats, catalog, commands, store (undo),
                          validation, serialization, warnings, room editing, demo data
  room/roomMesh.ts        floor, walls with door/window openings, columns, ceiling, plan view
  scene/                  renderer + cameras + render-on-demand, materials, furniture meshes
  editor/editor.ts        selection, dragging, snapping, pan/zoom, keyboard
  walkthrough/            first-person controls (desktop + touch), collisions, seated view
  persistence/            autosave, IndexedDB images, exports (JSON/PNG/print/CSV/share)
  ui/                     toolbar panels, inspector, palette, guests, room editor, dialogs, labels
  styles/main.css
tests/                    unit tests
vite.config.ts            build + generated service worker
```

Both modes render from one canonical `Store.layout`, and there are no separate copies of furniture positions. The scene is diffed per item, so only changed objects are rebuilt. Chairs and place settings are instanced, which keeps them to a few draw calls even with 250+ chairs. In the editor the view only re-renders when something changes, and rendering pauses while the tab is hidden. **Settings → Graphics** caps the pixel ratio and makes shadows optional.

---

## Testing status

**Automated:** `npm test` runs 47 unit tests covering:

* unit conversion and parsing
* seat geometry (60″ = 1.524 m; chairs face the table and move with it)
* stable seat IDs and displaced guests
* collisions (walls block, doors and dance floors don't, frame-rate independence, spawn recovery)
* room and project validation
* export → import round-trip
* privacy export
* CSV
* undo/redo grouping
* variant isolation
* room-outline edits
* the venue estimate (valid, ~4,800 sq ft, no hard warnings, free entrance, lossless export round-trip)

`npm run build` includes TypeScript type-checking.

**Run in headless Chrome (SwiftShader WebGL):**

* desktop click, select, drag, undo
* palette tap and drag-to-plan
* 3D view
* walkthrough with WASD, wall blocking and seated view
* PNG and JSON export
* reload persistence
* iPad Pro 11″ emulation: one-finger drag, two-finger pinch, simultaneous joystick + look with no stuck movement after release, portrait drawers
* production build served from a GitHub-Pages-style sub-path (`/wedding-plan/`) with no 404s or external requests
* service-worker offline reload
* invalid-file import (rejected, nothing changed)
* layout-only import as a new variant (original guests intact)
* reference image add, calibrate and persist across reload
* corner dragging
* damaged-storage recovery (data kept, autosave paused)

**Not yet tested:**

* real iPad hardware with Safari (desktop emulation is not a substitute)
* desktop Safari
* real pointer lock in a headed browser
* the Web Share sheet
* printing to paper or PDF
* "Add to Home Screen" installs
* a live Cloudflare Pages or GitHub Pages deployment

Please try these on your own devices.

## Known limitations

* Furniture is simple procedural geometry (no glTF models yet), and venue detailing awaits the reference photos.
* No multi-select or alignment guides yet; items are moved one at a time.
* Doors are open gaps with frames (no door leaves); windows are not walkable.
* Reference images are a guide only: outlines must still be entered as corners.
