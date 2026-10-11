# FactorioPyRecepyBrowser

# Pyanodons Planner

Local recipe/factory planner for Factorio 2.0 + the Pyanodon mod pack. Data and icons are pulled straight from your own install (`factorio --dump-data --dump-icon-sprites`).

Run: `./run.sh --open` → http://localhost:8642 (set `PORT=...` to change).

* Left sidebar: every machine (grouped like in-game, searchable). Drag one onto the grid, or double-click it. The *Recipes* tab searches recipes/products and drops a node with a default machine.
* Click the recipe button on a node to pick a recipe (filtered to that machine's crafting categories). Click the machine name to switch tier (MK01..MK04, etc).
* Drag from an output port (right, ○) to a matching input port (left). Double-click a link (or select it and press Del) to remove it.
* `+` next to an unconnected port: add a producer (inputs) or consumer (outputs) node, already connected.
* Node modes (dropdown on each node, badge in the header):
  * `◀ demand` (default) – sized by what its linked consumers pull. Only nodes with a target drive the solve; everything else follows automatically.
  * `▶ supply` – runs on whatever reaches its linked inputs (eats a byproduct) and pushes its output on top of demand.
  * `# machines` / `rate` – explicit target.
  * `▶ SUPPLY (auto)` – a node with no target whose outputs only feed secondary links behaves like supply.
* Link priorities: **P**rimary links carry demand; a target is met entirely through primary links. **S**econdary / **T**ertiary links never reduce the primary and never pull: they push what their producer has left (or what a supply node makes) on top – first into any shortfall, the rest is shown as over-production (purple `+x` on the input, summary "Over-production"). Click the P/S/T dot on a link badge to cycle, right-click a link for a menu. A new link into an already-fed input starts as secondary. Secondary = dashed, tertiary = dotted.
* The solve is deterministic and independent of node position / creation order. With live on, everything is recalculated on each change (Auto-calc button forces it).
* Fuel: burner and fluid-burning machines (furnaces, burner drills, boilers, glassworks/smelters on coal gas, …) get a 🔥 fuel input; pick the fuel on the node. Rate = energy use (incl. module consumption) / (fuel value × effectivity); burnt results (e.g. ash) show up as an output. Fuel ports link and sum like any other input.
* Special nodes (top of the sidebar, or the buttons in the `+` picker): ∞ Infinite source (supplies whatever is linked to it) and ⤓ Infinite sink (eats everything linked into it). The summary lists how much was drawn/dumped.
* Modules: click the module area on a node. Py farms are auto-filled with tier-1 animals/plants; set extra speed % for beacons.
* Balance chips on ports: red `−x` on an input = short (linked suppliers too small, e.g. pinned by a machine-count target); purple `+x` on an output = excess not consumed; purple `+x` on an input = over-supplied by secondary links.
* Save/Load stores layouts in `layouts/*.json`; Export/Import for files. The current canvas is also kept in browser storage.
* Ctrl+D duplicates a selected node, Del deletes, mouse wheel zooms, drag empty space to pan.

After mod updates: `tools/refresh-data.sh` (re-dumps from Factorio, rebuilds `data/` and `static/icons/`).

API: `GET /api/data`, `POST /api/solve`, `GET/PUT/DELETE /api/layouts/<name>`.

### Potential (over-supply) layer

Toggle **potential** in the toolbar (remembered). When on, a second, additive solve shows in purple what the
over-supply arriving via secondary/tertiary links could additionally run: extra machines in the node header
(`× 0.333 +0.0241`), `+x` next to port rates and link badges, and a *Potential extra output* section in the summary.
Base numbers stay exactly the demand-driven ones; toggle off = no change at all.

- Extra on a node is capped by its linked inputs: only over-supply, or extra coming from an upstream node that
  itself runs on over-supply, counts. Unlinked inputs are imports and assumed unlimited.
- Plain upstream nodes that only depend on imports may scale up as helpers to feed a driven node's other inputs
  (shown purple too). If that would make a loop unbounded, helpers are ignored (noted in the summary).
- A capped input is marked ⛔ (bottleneck); over-supply that still can't be used is shown as "(x idle)".
- Chance outputs: link the base yield as primary and the chance-based producer as secondary; the expected extra
  shows up as potential.

### Supply nodes, sinks with a rate, setup hints (update)

- Supply-mode nodes no longer cut a chain: in the demand pass they run on what reaches them over primary
  links and can be pulled through (e.g. a supply-mode screener fed by an infinite source now delivers what the
  furnace downstream needs). Linked byproducts going into supply nodes are used before anything is wasted, and
  the solver prefers fewer raw resources (infinite-source draw + imports) over fewer machines, so a linked
  recycle reduces upstream demand.
- Infinite sink: "take everything" (default) or "want rate" – the sink then pulls that rate like a target.
- Yellow hints on nodes explain common setup problems, with a one-click fix: supply node with nothing linked
  into it, several targets in one chain, an input short because it is only fed by secondary links.
- The current canvas is also autosaved server-side to `layouts/_autosave.json` (2 s after a change and on load).
