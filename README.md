# FactorioPyRecepyBrowser

# Pyanodons Planner

Local recipe/factory planner for Factorio 2.0 + the Pyanodon mod pack. Data and icons are pulled straight from your own install (`factorio --dump-data --dump-icon-sprites`).

Run: `./run.sh --open` → http://localhost:8642 (set `PORT=...` to change).

* Left sidebar: every machine (grouped like in-game, searchable). Drag one onto the grid, or double-click it. The *Recipes* tab searches recipes/products and drops a node with a default machine.
* Click the recipe button on a node to pick a recipe (filtered to that machine's crafting categories). Click the machine name to switch tier (MK01..MK04, etc).
* Drag from an output port (right, ○) to a matching input port (left). Double-click a link (or select it and press Del) to remove it.
* `+` next to an unconnected port: add a producer (inputs) or consumer (outputs) node, already connected.
* Targets: `# machines`, `rate` (of one output), or `use all linked input` (eats a byproduct after everything else is solved). With live on, everything is recalculated on each change (Auto-calc button forces it).
* Fuel: burner and fluid-burning machines (furnaces, burner drills, boilers, glassworks/smelters on coal gas, …) get a 🔥 fuel input; pick the fuel on the node. Rate = energy use (incl. module consumption) / (fuel value × effectivity); burnt results (e.g. ash) show up as an output. Fuel ports link and sum like any other input.
* Special nodes (top of the sidebar, or the buttons in the `+` picker): ∞ Infinite source (supplies whatever is linked to it) and ⤓ Infinite sink (eats everything linked into it). The summary lists how much was drawn/dumped.
* Modules: click the module area on a node. Py farms are auto-filled with tier-1 animals/plants; set extra speed % for beacons.
* Red rate on an input = deficit (linked supplier is too small, e.g. it's pinned by a machine-count target); purple on an output = surplus that isn't consumed.
* Save/Load stores layouts in `layouts/*.json`; Export/Import for files. The current canvas is also kept in browser storage.
* Ctrl+D duplicates a selected node, Del deletes, mouse wheel zooms, drag empty space to pan.

After mod updates: `tools/refresh-data.sh` (re-dumps from Factorio, rebuilds `data/` and `static/icons/`).

API: `GET /api/data`, `POST /api/solve`, `GET/PUT/DELETE /api/layouts/<name>`.
