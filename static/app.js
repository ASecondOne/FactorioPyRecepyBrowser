'use strict';
// ---------------- globals ----------------
let D = null;                 // dataset
const GRID = 20;
const S = { nodes: [], links: [], view: { x: 300, y: 80, z: 1 }, name: '' };
let R = null;                 // last solve result (by id)
let selNode = null, selLink = null;
let nextId = 1;
const $ = (q, el = document) => el.querySelector(q);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const unit = () => +$('#unit').value;
const unitLabel = () => (unit() === 60 ? '/min' : '/s');
function fmt(v, digits = 3) {
  if (v === undefined || v === null || isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return +v.toFixed(2) + '';
  return +v.toPrecision(digits) + '';
}
function fmtW(w) {
  const u = [['GW', 1e9], ['MW', 1e6], ['kW', 1e3]];
  for (const [n, f] of u) if (w >= f) return (w / f).toFixed(2) + ' ' + n;
  return w.toFixed(0) + ' W';
}
const icon = (path, cls = 'ico') => el('img', { src: path ? 'icons/' + path + '.png' : '', class: cls, loading: 'lazy', draggable: 'false' });
const itemIcon = (n) => icon(D.items[n]?.icon || null);
const itemName = (n) => D.items[n]?.n || n;
const itemType = (n) => D.items[n]?.t || 'item';
const isVariant = (n, m) => /-legacy$|-turd\d*$/.test(n);
const genId = () => 'n' + (nextId++).toString(36) + Math.random().toString(36).slice(2, 5);

function status(msg, err = false) { const s = $('#status'); s.textContent = msg || ''; s.title = msg || ''; s.className = err ? 'err' : ''; }

// tooltips
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.classList.add('hidden'); return; }
  tip.textContent = t.dataset.tip; tip.classList.remove('hidden');
});
document.addEventListener('mousemove', (e) => { if (!tip.classList.contains('hidden')) { tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; } });

// ---------------- dataset helpers ----------------
let machineList = [], recipesByProduct = {}, recipesByIngredient = {}, machinesByCat = {};
function prep() {
  const gord = (g) => D.groups[g]?.o || 'zzz';
  machineList = Object.entries(D.machines).map(([n, m]) => ({ name: n, ...m })).sort((a, b) => (gord(a.g) + a.o).localeCompare(gord(b.g) + b.o));
  for (const m of machineList) for (const c of m.cats) (machinesByCat[c] ||= []).push(m.name);
  for (const [n, r] of Object.entries(D.recipes)) {
    for (const o of r.o) (recipesByProduct[o.n] ||= []).push(n);
    for (const i of r.i) (recipesByIngredient[i.n] ||= []).push(n);
  }
}
function machinesFor(recipe, includeVariants = false) {
  const r = D.recipes[recipe]; if (!r) return [];
  return (machinesByCat[r.c] || []).filter((m) => includeVariants || !isVariant(m) || false);
}
function defaultMachine(recipe) {
  const ms = machinesFor(recipe);
  const nonHidden = ms.filter((m) => !D.machines[m].h);
  return (nonHidden[0] || ms[0] || machinesFor(recipe, true)[0]);
}
function recipesForMachine(mn) {
  const m = D.machines[mn]; if (!m) return [];
  if (m.fixed) return [m.fixed];
  const out = [];
  for (const c of m.cats) for (const r of (D.cat_recipes[c] || [])) out.push(r);
  return out;
}
const STD_MOD = new Set(['speed', 'productivity', 'efficiency', 'quality']);
function allowedModules(mn) {
  const m = D.machines[mn]; if (!m || !m.ms) return [];
  return Object.entries(D.modules).filter(([n, mo]) => {
    if (m.mc && !m.mc.includes(mo.c)) return false;
    if (!m.mc && !STD_MOD.has(mo.c)) return false;
    if (n.startsWith('ee-')) return false;
    // effect allowed?
    for (const [k, v] of Object.entries(mo.e)) if (v > 0 && !m.ae.includes(k) && k !== 'pollution' && k !== 'consumption') return false;
    return true;
  }).sort((a, b) => (a[1].c + a[1].t).localeCompare(b[1].c + b[1].t)).map(([n]) => n);
}
function defaultModules(mn) {
  // Py farms: machine only accepts its own creature/plant modules -> fill slots with tier 1
  const m = D.machines[mn];
  if (!m || !m.ms || !m.mc || m.mc.some((c) => STD_MOD.has(c))) return [];
  const mods = allowedModules(mn);
  return mods.length ? [{ name: mods[0], count: m.ms }] : [];
}

// ---------------- fuel ----------------
function fuelOptions(mn) {
  const fs = D.machines[mn]?.fuel; if (!fs) return [];
  let list;
  if (fs.k === 'burner') list = Object.entries(D.items).filter(([n, it]) => it.t === 'item' && it.fuel > 0 && fs.cats.includes(it.fc) && !it.h && !n.startsWith('ee-'));
  else if (fs.k === 'fluid') list = Object.entries(D.items).filter(([n, it]) => it.t === 'fluid' && it.fuel > 0 && (!fs.filter || fs.filter === n));
  else list = fs.filter ? [[fs.filter, D.items[fs.filter] || {}]] : [];
  return list.sort((a, b) => (a[1].o || '').localeCompare(b[1].o || '')).map(([n]) => n);
}
function defaultFuel(mn) {
  const opts = fuelOptions(mn); if (!opts.length) return null;
  for (const pref of ['coal', 'coal-gas', 'natural-gas']) if (opts.includes(pref)) return pref;
  return opts[0];
}
// ports of a node: [{item, fuel?, burnt?}]
function nodePorts(n) {
  const ins = [], outs = [];
  const push = (arr, item, extra = {}) => { const e = arr.find((x) => x.item === item); if (e) Object.assign(e, extra); else arr.push({ item, ...extra }); };
  if (n.kind === 'source') { if (n.item) outs.push({ item: n.item }); return { ins, outs }; }
  if (n.kind === 'sink') { if (n.item) ins.push({ item: n.item }); return { ins, outs }; }
  const r = D.recipes[n.recipe];
  if (r) { for (const i of r.i) push(ins, i.n); for (const o of r.o) push(outs, o.n); }
  const fs = D.machines[n.machine]?.fuel;
  if (fs && r) {
    const f = n.fuel || (fs.k === 'heat' ? fs.filter : null);
    if (f) {
      push(ins, f, { fuel: true });
      const br = D.items[f]?.br;
      if (fs.k === 'burner' && br) push(outs, br, { burnt: true });
    }
  }
  return { ins, outs };
}
function pruneLinks() {
  const ok = (nodeId, item, dir) => { const n = nodeById(nodeId); if (!n) return false; const p = nodePorts(n); return (dir === 'in' ? p.ins : p.outs).some((x) => x.item === item); };
  S.links = S.links.filter((l) => ok(l.from.node, l.from.item, 'out') && ok(l.to.node, l.to.item, 'in'));
}
function openItemPicker(title, onPick) {
  const wrap = el('div');
  const search = el('input', { type: 'search', placeholder: 'Search item or fluid…' });
  const list = el('div');
  wrap.append(el('div', { class: 'toolbar2' }, search), list);
  const all = Object.entries(D.items).filter(([, it]) => !it.h).sort((a, b) => ((D.groups[a[1].g]?.o || 'z') + a[1].o).localeCompare((D.groups[b[1].g]?.o || 'z') + b[1].o));
  const render = () => {
    list.innerHTML = ''; const q = search.value.trim().toLowerCase(); let k = 0;
    for (const [n, it] of all) {
      if (q && !(it.n.toLowerCase().includes(q) || n.includes(q))) continue;
      if (++k > 400) break;
      list.append(el('div', { class: 'mrow', onclick: () => { closeModal(); onPick(n); } }, icon(it.icon), el('span', { class: 'nm' }, it.n), el('span', { class: 'tm' }, it.t)));
    }
  };
  search.oninput = render; render();
  openModal(title, wrap);
}
function makeSpecial(kind, item, x, y) {
  const n = { id: genId(), kind, item, x: snap(x), y: snap(y), machine: null, recipe: null, modules: [], extra_speed: 0, extra_prod: 0, target: null };
  S.nodes.push(n); return n;
}

// ---------------- sidebar ----------------
let tab = 'machines';
const collapsed = new Set(JSON.parse(localStorage.getItem('pp.collapsed') || '[]'));
function renderSidebar() {
  const q = $('#search').value.trim().toLowerCase();
  const showVar = $('#showVariants').checked;
  const list = $('#list'); list.innerHTML = '';
  if (tab === 'machines') {
    const groups = new Map();
    const specials = [['source', '∞ Infinite source', 'Supplies unlimited amounts of one item/fluid to whatever it is linked to, or a fixed rate (your mine output) that everything downstream sizes from'], ['sink', '⤓ Infinite sink', 'Swallows everything linked into it (dump byproducts), or set a desired rate it pulls like a target']]
      .filter(([, n]) => !q || n.toLowerCase().includes(q) || 'infinite source sink'.includes(q));
    if (specials.length) {
      const b = el('div', { class: 'grp-b' });
      for (const [k, n, t] of specials) {
        const e = el('div', { class: 'entry special', draggable: 'true', 'data-tip': t }, el('span', { class: 'spicon' }, k === 'source' ? '∞' : '⤓'), el('span', {}, n.slice(2)));
        e.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-special', k); ev.dataTransfer.effectAllowed = 'copy'; });
        e.addEventListener('dblclick', () => openItemPicker(n.slice(2) + ': choose item', (it) => { const vp = $('#viewport').getBoundingClientRect(); const w = toWorld(vp.left + vp.width / 2 - 110, vp.top + vp.height / 2 - 40); makeSpecial(k, it, w.x, w.y); changed(); }));
        b.append(e);
      }
      list.append(el('div', { class: 'grp' }, el('div', { class: 'grp-h' }, 'Special'), b));
    }
    for (const m of machineList) {
      if (!showVar && isVariant(m.name)) continue;
      if (q && !(m.n.toLowerCase().includes(q) || m.name.includes(q) || m.cats.some((c) => c.includes(q)))) continue;
      if (!groups.has(m.g)) groups.set(m.g, []);
      groups.get(m.g).push(m);
    }
    for (const [g, ms] of groups) {
      const G = D.groups[g] || { n: g };
      const box = el('div', { class: 'grp' + (collapsed.has(g) && !q ? ' collapsed' : '') });
      const h = el('div', { class: 'grp-h', onclick: () => { box.classList.toggle('collapsed'); box.classList.contains('collapsed') ? collapsed.add(g) : collapsed.delete(g); localStorage.setItem('pp.collapsed', JSON.stringify([...collapsed])); } },
        G.icon ? icon(G.icon) : '', G.n, el('span', { class: 'sub' }, ' ' + ms.length));
      const b = el('div', { class: 'grp-b' });
      for (const m of ms) {
        const e = el('div', { class: 'entry', draggable: 'true', 'data-tip': `${m.n}\nspeed ${m.sp} · ${fmtW(m.pw)} ${m.es} · ${m.ms} module slots\ncategories: ${m.cats.join(', ')}` },
          icon(m.icon), el('span', {}, m.n));
        e.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-machine', m.name); ev.dataTransfer.effectAllowed = 'copy'; });
        e.addEventListener('dblclick', () => addNodeAtCenter(m.name, null));
        b.append(e);
      }
      box.append(h, b); list.append(box);
    }
  } else {
    if (q.length < 2) { list.append(el('div', { class: 'entry' }, 'Type at least 2 characters to search recipes / products…')); return; }
    let n = 0;
    for (const [rn, r] of Object.entries(D.recipes)) {
      if (r.h && !showVar) continue;
      const hay = (r.n + ' ' + rn + ' ' + r.o.map((o) => itemName(o.n)).join(' ')).toLowerCase();
      if (!hay.includes(q)) continue;
      if (++n > 300) break;
      const m = defaultMachine(rn);
      const e = el('div', { class: 'entry', draggable: 'true', 'data-tip': recipeTip(rn) }, icon(r.icon), el('span', {}, r.n), el('span', { class: 'sub' }, m ? D.machines[m].n.replace(/ MK ?0?1$/i, '') : '—'));
      e.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-recipe', rn); ev.dataTransfer.effectAllowed = 'copy'; });
      e.addEventListener('dblclick', () => m && addNodeAtCenter(m, rn));
      list.append(e);
    }
    if (!n) list.append(el('div', { class: 'entry' }, 'No recipes found'));
  }
}
function recipeTip(rn) {
  const r = D.recipes[rn];
  const f = (x) => `${fmt(x.a)}× ${itemName(x.n)}${x.p ? ` (${Math.round(x.p * 100)}%)` : ''}`;
  return `${r.n}  [${rn}]\n${r.e}s · ${r.c}\nIn: ${r.i.map(f).join(', ') || '—'}\nOut: ${r.o.map(f).join(', ')}`;
}

// ---------------- nodes ----------------
function makeNode(machine, recipe, x, y) {
  const recs = recipesForMachine(machine);
  if (!recipe && recs.length === 1) recipe = recs[0];
  const n = { id: genId(), x: snap(x), y: snap(y), machine, recipe: recipe || null, modules: defaultModules(machine), fuel: defaultFuel(machine), extra_speed: 0, extra_prod: 0, target: null };
  S.nodes.push(n);
  return n;
}
const snap = (v) => Math.round(v / GRID) * GRID;
function addNodeAtCenter(machine, recipe) {
  const vp = $('#viewport').getBoundingClientRect();
  const w = toWorld(vp.left + vp.width / 2 - 150, vp.top + vp.height / 2 - 80);
  const n = makeNode(machine, recipe, w.x, w.y);
  if (!S.nodes.some((o) => o.target)) n.target = defaultTarget(n);
  changed(); if (!n.recipe) openRecipePicker(n);
}
function defaultTarget(n) {
  const r = D.recipes[n.recipe]; if (!r) return null;
  return { kind: 'machines', item: null, value: 1 };
}
function nodeById(id) { return S.nodes.find((n) => n.id === id); }
function deleteNode(n) {
  S.nodes = S.nodes.filter((o) => o !== n);
  S.links = S.links.filter((l) => l.from.node !== n.id && l.to.node !== n.id);
  if (selNode === n) selNode = null;
  changed();
}

function renderNodes() {
  const host = $('#nodes'); host.innerHTML = '';
  $('#hint').style.display = S.nodes.length ? 'none' : '';
  for (const n of S.nodes) host.append(renderNode(n));
  renderLinks();
}
function nodeResult(n) { return R?.nodes?.[n.id]; }
function renderSpecial(n) {
  const res = nodeResult(n);
  const src = n.kind === 'source';
  const box = el('div', { class: 'node special ' + n.kind + (selNode === n ? ' sel' : ''), 'data-id': n.id });
  box.style.left = n.x + 'px'; box.style.top = n.y + 'px';
  const head = el('div', { class: 'node-h' }, el('span', { class: 'spicon big' }, src ? '∞' : '⤓'),
    el('div', { class: 'title' }, el('div', { class: 'mname', 'data-tip': 'Click to change item', onclick: (e) => { e.stopPropagation(); openItemPicker('Choose item', (it) => { n.item = it; if (n.target) n.target.item = it; changed(); }); } }, (src ? 'Infinite source' : 'Infinite sink')),
      el('div', { class: 'count' }, res ? fmt(res.machines * unit()) + unitLabel() : '')),
    el('button', { class: 'x', 'data-tip': 'Delete node', onclick: (e) => { e.stopPropagation(); deleteNode(n); } }, '✕'));
  head.addEventListener('mousedown', (e) => startNodeDrag(e, n));
  box.addEventListener('mousedown', () => { if (selNode !== n) { selNode = n; selLink = null; document.querySelectorAll('.node.sel').forEach((x) => x.classList.remove('sel')); box.classList.add('sel'); renderLinks(); } });
  box.append(head);
  if (n.item) {
    const ports = el('div', { class: 'ports' });
    const col = el('div', { class: 'pcol ' + (src ? 'out' : 'in') });
    col.append(renderPort(n, n.item, src ? 'out' : 'in', res, {}));
    ports.append(src ? el('div', { class: 'pcol in' }) : col, src ? col : el('div', { class: 'pcol out' }));
    box.append(ports);
  }
  {
    // infinite sink: "take everything" (default) or a desired incoming rate that drives the chain like a target
    // infinite source: "unlimited" (default) or a fixed rate (e.g. a mine's output) that is pushed downstream
    const want = n.target?.kind === 'rate' && (src ? n.target.value >= 0 : n.target.value > 0);
    const f = el('div', { class: 'node-f' });
    const sel = src
      ? el('select', { class: 'modesel', 'data-tip': 'unlimited – supplies whatever is demanded\nfixed rate – delivers exactly this rate (e.g. your mine output) and pushes it through primary links; demand nodes downstream size themselves from it' },
        el('option', { value: '' }, 'unlimited'), el('option', { value: 'rate' }, 'fixed rate'))
      : el('select', { class: 'modesel', 'data-tip': 'take everything – swallows whatever arrives\nwant rate – this sink wants a fixed rate and pulls it through primary links (like a target)' },
        el('option', { value: '' }, 'take everything'), el('option', { value: 'rate' }, 'want rate'));
    sel.value = want ? 'rate' : '';
    sel.onchange = () => { n.target = sel.value ? { kind: 'rate', item: n.item, value: n.target?.value > 0 ? n.target.value : (src && res?.machines > 1e-9 ? +res.machines.toPrecision(4) : 1 / unit()) } : null; changed(); };
    sel.addEventListener('mousedown', (e) => e.stopPropagation());
    f.append(sel);
    if (want) {
      const inp = el('input', { type: 'number', min: '0', step: 'any', class: 'tval', value: +(n.target.value * unit()).toPrecision(6) });
      inp.addEventListener('mousedown', (e) => e.stopPropagation());
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { n.target = { kind: 'rate', item: n.item, value: v / unit() }; changed(); } };
      f.append(inp, el('span', {}, unitLabel()));
    }
    box.append(f);
    if (want) {
      const op = res?.outputs?.[0];
      box.append(el('div', { class: 'spbal' }, modeBadge(n, res),
        src && op?.slack > 1e-7 ? el('span', { class: 'bal over', 'data-tip': 'Not taken by anything downstream' }, `${fmt(op.slack * unit())}${unitLabel()} unused`) : ''));
    }
  }
  for (const h of nodeHints(n, res)) box.append(hintEl(h));
  return box;
}
function renderNode(n) {
  if (n.kind === 'source' || n.kind === 'sink') return renderSpecial(n);
  const m = D.machines[n.machine] || { n: n.machine + ' (missing)', icon: null, ms: 0 };
  const r = D.recipes[n.recipe];
  const res = nodeResult(n);
  const box = el('div', { class: 'node' + (selNode === n ? ' sel' : '') + (res?.error ? ' err' : ''), 'data-id': n.id });
  box.style.left = n.x + 'px'; box.style.top = n.y + 'px';
  const cnt = res ? res.machines : null;
  const head = el('div', { class: 'node-h' },
    icon(m.icon),
    el('div', { class: 'title' },
      el('div', { class: 'mname', 'data-tip': 'Click to switch machine (tier)', onclick: (e) => { e.stopPropagation(); openMachineSwitch(n); } }, m.n),
      el('div', { class: 'count' }, cnt === null ? '' : '× ' + fmt(cnt), potHead(n), cnt ? el('small', {}, `  (${Math.ceil(cnt - 1e-6)} buildings)`) : '', modeBadge(n, res))),
    el('button', { class: 'x', 'data-tip': 'Delete node', onclick: (e) => { e.stopPropagation(); deleteNode(n); } }, '✕'));
  head.addEventListener('mousedown', (e) => startNodeDrag(e, n));
  box.append(head);
  box.addEventListener('mousedown', () => { if (selNode !== n) { selNode = n; selLink = null; document.querySelectorAll('.node.sel').forEach((x) => x.classList.remove('sel')); box.classList.add('sel'); renderLinks(); } });
  box.append(el('button', { class: 'recipe-btn', 'data-tip': r ? recipeTip(n.recipe) : '', onclick: () => openRecipePicker(n) },
    r ? icon(r.icon) : '', r ? r.n : 'Choose recipe…'));
  if (res?.error) box.append(el('div', { class: 'errmsg' }, res.error));
  if (r) {
    const ports = el('div', { class: 'ports' });
    const ins = el('div', { class: 'pcol in' }), outs = el('div', { class: 'pcol out' });
    const P = nodePorts(n);
    for (const pi of P.ins) ins.append(renderPort(n, pi.item, 'in', res, pi));
    for (const po of P.outs) outs.append(renderPort(n, po.item, 'out', res, po));
    ports.append(ins, outs); box.append(ports);
  }
  if (m.fuel) {
    const opts = fuelOptions(n.machine);
    const fr = el('div', { class: 'node-f fuelrow' }, el('span', { 'data-tip': `${m.fuel.k === 'burner' ? 'Burner' : m.fuel.k === 'fluid' ? 'Burns fluid' : 'Heat fluid'} · ${m.fuel.k === 'burner' ? m.fuel.cats.join(', ') : (m.fuel.filter || 'any fuel fluid')} · effectivity ${m.fuel.eff}` }, '🔥 fuel'));
    if (m.fuel.k === 'heat') fr.append(n.fuel || m.fuel.filter || '—');
    else {
      const fb = el('button', { class: 'fuelbtn', 'data-tip': `${opts.length} valid fuels – click to choose, or just link any fuel output onto the 🔥 port`, onclick: (e) => { e.stopPropagation(); openFuelPicker(n); } },
        n.fuel ? itemIcon(n.fuel) : '', n.fuel ? `${itemName(n.fuel)} (${fmtJ(D.items[n.fuel]?.fuel || 0)})` : '— choose fuel —', ' ▾');
      fr.append(fb);
    }
    if (res?.fuel_per_machine) fr.append(el('span', { class: 'grow' }), `${fmt(res.fuel_per_machine * unit())}${unitLabel()} per machine`);
    box.append(fr);
  }
  if (res?.warning) box.append(el('div', { class: 'errmsg warn' }, res.warning));
  for (const h of nodeHints(n, res)) box.append(hintEl(h));
  // footer: target + modules
  const f = el('div', { class: 'node-f' });
  const tsel = el('select', { class: 'modesel', 'data-tip': 'Mode:\n◀ demand – sized by what linked consumers pull (default)\n▶ supply – runs on whatever reaches its linked inputs\n# machines / rate – fixed target that drives the rest' },
    el('option', { value: '' }, '◀ demand'), el('option', { value: 'supply' }, '▶ supply'), el('option', { value: 'machines' }, '# machines'), el('option', { value: 'rate' }, 'rate'));
  tsel.value = !n.target ? '' : (n.target.kind === 'consume' ? 'supply' : n.target.kind);
  tsel.onchange = () => {
    if (!tsel.value) n.target = null;
    else if (tsel.value === 'supply') n.target = { kind: 'supply', item: null, value: 0 };
    else if (tsel.value === 'machines') n.target = { kind: 'machines', item: null, value: res?.machines ? +res.machines.toFixed(3) || 1 : 1 };
    else { const it = r?.m || r?.o[0]?.n; const p = res?.outputs?.find((o) => o.item === it); n.target = { kind: 'rate', item: it, value: p?.rate ? +p.rate.toPrecision(4) : 1 }; }
    changed();
  };
  f.append(tsel);
  if (n.target && n.target.kind !== 'consume' && n.target.kind !== 'supply') {
    const scale = n.target.kind === 'rate' ? unit() : 1;
    const inp = el('input', { type: 'number', min: '0', step: 'any', value: +(n.target.value * scale).toPrecision(6) });
    inp.onchange = () => { const v = parseFloat(inp.value); if (!isNaN(v) && v >= 0) { n.target.value = v / scale; changed(); } };
    f.append(inp);
    if (n.target.kind === 'rate' && r) {
      const isel = el('select', {}, ...r.o.map((o) => el('option', { value: o.n }, itemName(o.n))));
      isel.value = n.target.item || r.o[0]?.n; isel.onchange = () => { n.target.item = isel.value; changed(); };
      f.append(el('span', {}, unitLabel()), isel);
    }
  }
  f.append(el('span', { class: 'grow' }));
  if (m.ms) {
    const mods = el('span', { class: 'mods', 'data-tip': 'Modules / beacon bonus (click)', onclick: () => openModules(n) });
    const total = n.modules.reduce((a, b) => a + b.count, 0);
    for (const mo of n.modules) { mods.append(icon(D.items[mo.name]?.icon), '×' + mo.count + ' '); }
    if (!total) mods.append('modules 0/' + m.ms); else mods.append(` ${total}/${m.ms}`);
    if (n.extra_speed) mods.append(` +${Math.round(n.extra_speed * 100)}%`);
    f.append(mods);
  } else if (n.extra_speed) f.append(`+${Math.round(n.extra_speed * 100)}% speed`);
  box.append(f);
  if (res) {
    const parts = [`speed ${fmt(res.speed)}`];
    if (res.productivity) parts.push(`prod +${Math.round(res.productivity * 100)}%`);
    if (res.power_w) parts.push(fmtW(res.power_w) + (res.energy_source && res.energy_source !== 'electric' ? ' ' + res.energy_source : ''));
    box.append(el('div', { class: 'node-f' }, parts.join(' · ')));
  }
  return box;
}
// ---- setup hints: explain in plain words why a chain comes out at 0 / short / over-constrained ----
function isExplicitTarget(n) { return !!n.target && (n.target.kind === 'machines' || (n.target.kind === 'rate' && (n.kind !== 'sink' || n.target.value > 0))); }
function nodeLabel(n) {
  if (n.kind === 'source' || n.kind === 'sink') return (n.kind === 'source' ? 'Infinite source' : 'Infinite sink') + (n.item ? ` (${itemName(n.item)})` : '');
  const r = D.recipes[n.recipe];
  return (D.machines[n.machine]?.n || n.machine) + (r ? ` (${r.n})` : '');
}
function chainTargets(n) { return chainNodes(n).filter(isExplicitTarget); }
function chainNodes(n) {
  // all nodes in the same linked group (links taken as undirected)
  const seen = new Set([n.id]), st = [n.id];
  while (st.length) {
    const id = st.pop();
    for (const l of S.links) {
      const o = l.from.node === id ? l.to.node : l.to.node === id ? l.from.node : null;
      if (o && !seen.has(o)) { seen.add(o); st.push(o); }
    }
  }
  return S.nodes.filter((x) => seen.has(x.id));
}
function nodeHints(n, res) {
  const out = [];
  const isSupply = n.target?.kind === 'supply' || n.target?.kind === 'consume';
  const linkedIn = S.links.filter((l) => l.to.node === n.id);
  if (isSupply && !linkedIn.length) out.push({ text: 'Supply mode, but nothing is linked into this node, so it runs at 0. Link its input or switch it to demand.', fix: ['switch to demand', () => { n.target = null; changed(); }] });
  if (n.kind === 'source' && n.target?.kind === 'rate' && R) {
    // short somewhere downstream although the source is fixed -> the source is too small for a target there
    const comp = chainNodes(n);
    let short = 0;
    for (const x of comp) for (const p of nodeResult(x)?.inputs || []) if (p.slack > 1e-7 && S.links.some((l) => l.to.node === x.id && l.to.item === p.item)) short += p.slack;
    if (short > 1e-7) out.push({ text: `Something downstream is short (${fmt(short * unit())}${unitLabel()} in total): a target there needs more than ${fmt(n.target.value * unit())}${unitLabel()} can feed. Raise the rate, or remove that target and let everything size from this source.` });
  }
  if (isExplicitTarget(n)) {
    const ts = chainTargets(n);
    if (ts.length > 1) out.push({ text: `${ts.length} targets in this chain (${ts.filter((x) => x !== n).map(nodeLabel).join(', ')} too). They can fight each other: whatever one target makes beyond what the other needs shows up as surplus, or as short. Usually keep one target and set the others to demand.`, fix: [n.kind === 'source' ? 'make unlimited' : n.kind === 'sink' ? 'take everything' : 'make this one demand', () => { n.target = null; changed(); }] });
  }
  for (const p of res?.inputs || []) {
    if (!(p.slack > 1e-7)) continue;
    const ls = linkedIn.filter((l) => l.to.item === p.item);
    if (ls.length && ls.every((l) => (l.priority || 1) > 1)) {
      out.push({ text: `${itemName(p.item)} is short: it is only fed by secondary links, and secondary links never count toward demand. Make one of them primary (P).`, fix: ['make primary', () => { ls[0].priority = 1; changed(); }] });
    } else if (ls.length) {
      out.push({ text: `${itemName(p.item)} is short by ${fmt(p.slack * unit())}${unitLabel()}: the linked suppliers can't deliver more (fixed target / machine count, or a supply-mode node with too little input upstream).` });
    }
  }
  return out;
}
function hintEl(h) {
  const d = el('div', { class: 'errmsg warn hint' }, '⚠ ' + h.text);
  if (h.fix) d.append(' ', el('button', { class: 'fixbtn', onmousedown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); h.fix[1](); } }, h.fix[0]));
  return d;
}
function modeBadge(n, res) {
  const mode = res?.mode || (n.target ? (n.target.kind === 'consume' || n.target.kind === 'supply' ? 'supply' : 'target') : 'demand');
  const info = {
    target: ['TARGET', 'Fixed target – drives everything linked to it'],
    demand: ['◀ DEMAND', 'Sized by what its linked consumers pull (primary links)'],
    supply: ['▶ SUPPLY', 'Uses everything that reaches its linked inputs (primary links); it is still pulled through when it sits between a demand and its supplier'],
    'sink-target': ['TARGET', 'Desired rate into this sink – drives everything linked to it'],
    'source-fixed': ['▶ FIXED', 'Fixed supply – pushed downstream through primary links; demand nodes there size themselves from it'],
    'supply-auto': ['▶ SUPPLY (auto)', 'Only feeds secondary links, so nothing pulls it: it runs on what its inputs provide and adds on top'],
  }[mode] || [mode.toUpperCase(), ''];
  return el('span', { class: 'mode ' + mode, 'data-tip': info[1] }, info[0]);
}
function fmtJ(j) { return j >= 1e6 ? +(j / 1e6).toFixed(2) + ' MJ' : +(j / 1e3).toFixed(1) + ' kJ'; }
// ---- potential layer (purple): what over-supply from secondary links could additionally run ----
function potOf(n) { return R?.potential?.nodes?.[n.id] || null; }
function potHead(n) {
  const P = potOf(n);
  if (!P || !(P.extra_machines > 1e-9)) return '';
  const tip = P.helper ? 'Potential: extra machines needed upstream to feed a node running on over-supply' : 'Potential: extra machines the over-supply from secondary links could run'
    + (P.limit?.length ? `\nlimited by: ${P.limit.map(itemName).join(', ')}` : '');
  return el('span', { class: 'pot', 'data-tip': tip }, ' +' + fmt(P.extra_machines));
}
function potPort(n, item, dir) {
  const P = potOf(n);
  if (!P) return [];
  const out = [];
  const v = (dir === 'in' ? P.inputs : P.outputs)?.[item];
  if (v > 1e-9) out.push(el('span', { class: 'pot', 'data-tip': `Potential extra ${dir === 'in' ? 'consumption' : 'output'}: ${fmt(v * unit())}${unitLabel()}` }, '+' + fmt(v * unit())));
  if (dir === 'in' && P.limit?.includes(item)) out.push(el('span', { class: 'pot lim', 'data-tip': 'Bottleneck: this input caps the potential extra' }, '⛔'));
  const u = dir === 'in' ? P.unused_supply?.[item] : 0;
  if (u > 1e-7) out.push(el('span', { class: 'pot dim', 'data-tip': `${fmt(u * unit())}${unitLabel()} over-supply still unusable (other inputs are the bottleneck)` }, `(${fmt(u * unit())} idle)`));
  return out;
}
function renderPort(n, item, dir, res, meta = {}) {
  const pr = res && (dir === 'in' ? res.inputs : res.outputs).find((p) => p.item === item);
  const linked = S.links.some((l) => (dir === 'in' ? l.to.node === n.id && l.to.item === item : l.from.node === n.id && l.from.item === item));
  const isTarget = n.target?.kind === 'rate' && n.target.item === item && dir === 'out';
  const t = itemType(item);
  const p = el('div', { class: 'port' + (isTarget ? ' target' : ''), 'data-tip': `${itemName(item)}${pr ? `\nper machine: ${fmt(pr.per_machine * unit())}${unitLabel()}` : ''}${pr?.slack ? (dir === 'in' ? `\nSHORT ${fmt(pr.slack * unit())}${unitLabel()} (linked suppliers too small)` : `\nexcess ${fmt(pr.slack * unit())}${unitLabel()} not consumed`) : ''}${pr?.excess ? `\nOVER-SUPPLIED by ${fmt(pr.excess * unit())}${unitLabel()} (secondary links on top of demand)` : ''}` });
  const h = el('span', { class: `handle ${t}${linked ? ' linked' : ''}${meta.fuel ? ' fuelport' : ''}`, 'data-node': n.id, 'data-item': item, 'data-dir': dir, 'data-fuel': meta.fuel ? '1' : null });
  h.addEventListener('mousedown', (e) => startLinkDrag(e, n, item, dir));
  let rcls = 'rate';
  if (pr?.slack > 1e-9) rcls += dir === 'in' ? ' slack' : ' surplus';
  else if (!linked) rcls += ' free';
  const rate = el('span', { class: rcls }, pr ? fmt(pr.rate * unit()) + unitLabel() : '');
  p.append(h, itemIcon(item), rate);
  if (pr?.slack > 1e-7) p.append(el('span', { class: 'bal ' + (dir === 'in' ? 'short' : 'over') }, (dir === 'in' ? '−' : '+') + fmt(pr.slack * unit())));
  if (pr?.excess > 1e-7) p.append(el('span', { class: 'bal over' }, '+' + fmt(pr.excess * unit())));
  p.append(...potPort(n, item, dir));
  if (meta.fuel) p.append(el('span', { class: 'tag', 'data-tip': 'fuel' }, '🔥'));
  if (meta.burnt) p.append(el('span', { class: 'tag', 'data-tip': 'burnt result of fuel' }, 'burnt'));
  if (!linked && !n.kind) {
    const b = el('button', { class: 'add', 'data-tip': dir === 'in' ? 'Add a producer for this input' : 'Add a consumer for this output', onclick: (e) => { e.stopPropagation(); openLinkPicker(n, item, dir); } }, '+');
    p.append(b);
  }
  return p;
}

// ---------------- links ----------------
function portPos(nodeId, item, dir) {
  const h = document.querySelector(`.handle[data-node="${nodeId}"][data-dir="${dir}"][data-item="${CSS.escape(item)}"]`);
  if (!h) return null;
  const b = h.getBoundingClientRect();
  return toWorld(b.left + b.width / 2, b.top + b.height / 2);
}
function bez(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}
// per-item colour (stable hash), fluids lean blue/cyan, items lean warm
const colorCache = {};
function itemColor(item) {
  if (colorCache[item]) return colorCache[item];
  let h = 2166136261;
  for (let i = 0; i < item.length; i++) { h ^= item.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const fluid = itemType(item) === 'fluid';
  const hue = fluid ? 170 + (h % 80) : (h % 360 + 360) % 360 < 160 ? 15 + (h % 110) : 280 + (h % 70); // fluids 170-250, items warm/magenta
  const c = `hsl(${hue % 360}, ${62 + (h >> 8) % 20}%, ${58 + (h >> 16) % 10}%)`;
  return (colorCache[item] = c);
}
function nodeRects() {
  return S.nodes.map((o) => { const e = document.querySelector(`.node[data-id="${o.id}"]`); return { id: o.id, x: o.x, y: o.y, w: e ? e.offsetWidth : 300, h: e ? e.offsetHeight : 200 }; });
}
function roundedPath(pts, r = 12) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    if (rr < 0.5) { d += ` L${p1.x},${p1.y}`; continue; }
    const a = { x: p1.x + (p0.x - p1.x) * rr / d1, y: p1.y + (p0.y - p1.y) * rr / d1 };
    const b = { x: p1.x + (p2.x - p1.x) * rr / d2, y: p1.y + (p2.y - p1.y) * rr / d2 };
    d += ` L${a.x},${a.y} Q${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x},${last.y}`;
}
// route: forward links = smooth bezier; backward links and self-loops = rounded orthogonal path around the nodes
function routeLink(a, b, srcRect, dstRect, lane) {
  if (b.x > a.x + 50) return bez(a, b);
  const off = 22 + lane * 9;
  const sx = Math.max(a.x, srcRect ? srcRect.x + srcRect.w : a.x) + off;
  const ex = Math.min(b.x, dstRect ? dstRect.x : b.x) - off;
  const rs = [srcRect, dstRect].filter(Boolean);
  const below = Math.max(...rs.map((r) => r.y + r.h)) + 18 + lane * 9;
  const above = Math.min(...rs.map((r) => r.y)) - 18 - lane * 9;
  const cost = (y) => Math.abs(a.y - y) + Math.abs(b.y - y);
  const ly = cost(below) <= cost(above) ? below : above;
  return roundedPath([a, { x: sx, y: a.y }, { x: sx, y: ly }, { x: ex, y: ly }, { x: ex, y: b.y }, b], 14);
}
const LABEL_MIN_ZOOM = 0.5;
function renderLinks() {
  const svg = $('#links'); svg.innerHTML = '';
  const labels = $('#linkLabels'); labels.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const rects = nodeRects(); const rectOf = Object.fromEntries(rects.map((r) => [r.id, r]));
  const placed = [];
  const showLabels = $('#showLabels').checked && S.view.z >= LABEL_MIN_ZOOM;
  let backLane = 0;
  const hits = (r, list, pad) => list.some((o) => r.x < o.x + o.w + pad && r.x + r.w + pad > o.x && r.y < o.y + o.h + pad && r.y + r.h + pad > o.y);
  for (const l of S.links) {
    const a = portPos(l.from.node, l.from.item, 'out'), b = portPos(l.to.node, l.to.item, 'in');
    if (!a || !b) continue;
    const back = !(b.x > a.x + 50);
    const d = routeLink(a, b, rectOf[l.from.node], rectOf[l.to.node], back ? (backLane++ % 5) : 0);
    const col = itemColor(l.from.item);
    const g = document.createElementNS(NS, 'g');
    const pr = l.priority || 1;
    g.setAttribute('class', 'lnk p' + pr + (selLink === l ? ' sel' : '') + (itemType(l.from.item) === 'fluid' ? ' fluid' : ''));
    g.dataset.id = l.id;
    const hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'hit');
    const casing = document.createElementNS(NS, 'path'); casing.setAttribute('d', d); casing.setAttribute('class', 'casing');
    const vis = document.createElementNS(NS, 'path'); vis.setAttribute('d', d); vis.setAttribute('class', 'wire'); vis.style.stroke = col;
    g.append(casing, vis, hit);
    const sel = (e) => { e.stopPropagation(); selLink = l; selNode = null; document.querySelectorAll('.node.sel').forEach((x) => x.classList.remove('sel')); renderLinks(); };
    const del = (e) => { e.stopPropagation(); S.links = S.links.filter((x) => x !== l); selLink = null; changed(); };
    hit.addEventListener('mousedown', sel); hit.addEventListener('dblclick', del);
    hit.addEventListener('contextmenu', (e) => { e.preventDefault(); openLinkMenu(l, e.clientX, e.clientY); });
    svg.append(g);
    const rate = R?.links?.[l.id];
    let lab = null;
    if (rate !== undefined && showLabels) {
      const mk = el('span', { class: 'prio p' + pr, 'data-tip': `${PRIO[pr][1]}\nclick to cycle P → S → T · right-click for menu`, onmousedown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); setPriority(l, pr % 3 + 1); } }, PRIO[pr][0]);
      lab = el('div', { class: 'lnk-label p' + pr + (selLink === l ? ' sel' : ''), 'data-link': l.id, 'data-tip': `${itemName(l.from.item)}: ${fmt(rate * unit())}${unitLabel()} (${PRIO[pr][1].split(' –')[0]})` }, mk, itemIcon(l.from.item), fmt(rate * unit()) + unitLabel(),
        R?.potential?.links?.[l.id] > 1e-9 ? el('span', { class: 'pot', 'data-tip': 'Potential extra flow from over-supply' }, '+' + fmt(R.potential.links[l.id] * unit())) : '');
      lab.addEventListener('contextmenu', (e) => { e.preventDefault(); openLinkMenu(l, e.clientX, e.clientY); });
      lab.style.borderColor = col;
      lab.addEventListener('mousedown', sel); lab.addEventListener('dblclick', del);
      labels.append(lab);
      const w = lab.offsetWidth, h = lab.offsetHeight;
      const len = vis.getTotalLength();
      let best = null;
      for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
        const pt = vis.getPointAtLength(len * t);
        const r = { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
        if (!hits(r, rects, 6) && !hits(r, placed, 3)) { best = r; break; }
      }
      if (!best) { // nudge around the midpoint, labels only
        const pt = vis.getPointAtLength(len * 0.5);
        best = { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
        for (let k = 1; k < 10 && hits(best, placed, 3); k++) best.y = pt.y - h / 2 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (h + 3);
      }
      placed.push(best);
      lab.style.left = best.x + 'px'; lab.style.top = best.y + 'px';
    }
    const on = () => { g.classList.add('hover'); lab?.classList.add('hover'); };
    const offf = () => { g.classList.remove('hover'); lab?.classList.remove('hover'); };
    hit.addEventListener('mouseenter', on); hit.addEventListener('mouseleave', offf);
    lab?.addEventListener('mouseenter', on); lab?.addEventListener('mouseleave', offf);
  }
}
let linkDrag = null;
function startLinkDrag(e, n, item, dir) {
  e.stopPropagation(); e.preventDefault();
  const start = portPos(n.id, item, dir);
  const NS = 'http://www.w3.org/2000/svg';
  const temp = document.createElementNS(NS, 'path'); temp.setAttribute('class', 'temp'); $('#links').append(temp); temp.style.stroke = itemColor(item);
  linkDrag = { n, item, dir, start, temp };
  const want = dir === 'out' ? 'in' : 'out';
  const startIsFuel = dir === 'in' && !!e.target.dataset.fuel;
  document.querySelectorAll(`.handle[data-dir="${want}"]`).forEach((h) => {
    if (h.dataset.item === item) h.classList.add('ok');
    else if (dir === 'out' && h.dataset.fuel && fuelOptions(nodeById(h.dataset.node)?.machine).includes(item)) h.classList.add('ok', 'fuelok');
    else if (startIsFuel && fuelOptions(n.machine).includes(h.dataset.item)) h.classList.add('ok', 'fuelok');
  });
  const move = (ev) => {
    const p = toWorld(ev.clientX, ev.clientY);
    temp.setAttribute('d', dir === 'out' ? bez(start, p) : bez(p, start));
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    temp.remove(); document.querySelectorAll('.handle.ok').forEach((h) => h.classList.remove('ok', 'fuelok'));
    const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.handle');
    linkDrag = null;
    // fuel switching: output X dropped on a fuel port (or fuel port dragged onto output X)
    if (t && t.dataset.dir === want && t.dataset.item !== item) {
      if (dir === 'out' && t.dataset.fuel) {
        const tn = nodeById(t.dataset.node);
        if (tn && fuelOptions(tn.machine).includes(item)) { switchFuel(tn, item); addLink({ node: n.id, item }, { node: tn.id, item }); status(`fuel of ${D.machines[tn.machine].n} → ${itemName(item)}`); return; }
      }
      if (startIsFuel && fuelOptions(n.machine).includes(t.dataset.item)) {
        const it = t.dataset.item; switchFuel(n, it); addLink({ node: t.dataset.node, item: it }, { node: n.id, item: it }); status(`fuel of ${D.machines[n.machine].n} → ${itemName(it)}`); return;
      }
    }
    if (!t || t.dataset.dir !== want || t.dataset.item !== item) {
      if (t && t.dataset.item !== item) status(`Can't connect ${itemName(item)} to ${itemName(t.dataset.item)}`, true);
      return;
    }
    const from = dir === 'out' ? { node: n.id, item } : { node: t.dataset.node, item };
    const to = dir === 'out' ? { node: t.dataset.node, item } : { node: n.id, item };
    addLink(from, to);
  };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}
function switchFuel(n, fuel) {
  const old = n.fuel;
  if (old && old !== fuel) {
    const r = D.recipes[n.recipe];
    const oldIsIngredient = r && r.i.some((i) => i.n === old);
    if (!oldIsIngredient) S.links = S.links.filter((l) => !(l.to.node === n.id && l.to.item === old));
  }
  n.fuel = fuel;
}
function openFuelPicker(n) {
  const m = D.machines[n.machine]; const fs = m.fuel;
  let cons = 0;
  for (const mo of n.modules || []) if (m.ae.includes('consumption')) cons += (D.modules[mo.name]?.e.consumption || 0) * mo.count;
  const usage = m.pw * Math.max(0.2, 1 + cons);
  const opts = fuelOptions(n.machine).sort((a, b) => D.items[b].fuel - D.items[a].fuel);
  const wrap = el('div');
  const search = el('input', { type: 'search', placeholder: 'Search fuel…' });
  const list = el('div');
  wrap.append(el('div', { class: 'toolbar2' }, search, el('span', { class: 'tm' }, `${fmtW(usage)} · effectivity ${fs.eff}`)), list);
  const render = () => {
    list.innerHTML = ''; const q = search.value.trim().toLowerCase();
    for (const o of opts) {
      const it = D.items[o];
      if (q && !(it.n.toLowerCase().includes(q) || o.includes(q))) continue;
      const rate = usage / (it.fuel * (fs.eff || 1));
      list.append(el('div', { class: 'mrow' + (o === n.fuel ? ' cur' : ''), onclick: () => { switchFuel(n, o); closeModal(); changed(); } },
        icon(it.icon), el('span', { class: 'nm' }, it.n), el('span', { class: 'tm' }, `${fmtJ(it.fuel)} · ${fmt(rate * unit())}${unitLabel()} per machine${it.br ? ' · burnt → ' + itemName(it.br) : ''}`)));
    }
    if (!list.children.length) list.append(el('div', { class: 'sg-title' }, 'no matching fuel'));
  };
  search.oninput = render; render();
  openModal(`Fuel for ${m.n} (${opts.length})`, wrap);
}
const PRIO = { 1: ['P', 'primary – carries demand'], 2: ['S', 'secondary – adds on top of demand'], 3: ['T', 'tertiary – adds on top, after secondary'] };
function defaultPriority(to) { return S.links.some((l) => l.to.node === to.node && l.to.item === to.item) ? 2 : 1; }
function setPriority(l, p) { l.priority = p; changed(); }
function openLinkMenu(l, x, y) {
  closeLinkMenu();
  const menu = el('div', { id: 'linkMenu', class: 'ctxmenu' });
  for (const p of [1, 2, 3]) menu.append(el('div', { class: 'ctxitem' + ((l.priority || 1) === p ? ' cur' : ''), onclick: () => { closeLinkMenu(); setPriority(l, p); } }, el('b', {}, PRIO[p][0]), ' ' + PRIO[p][1]));
  menu.append(el('div', { class: 'ctxitem danger', onclick: () => { closeLinkMenu(); S.links = S.links.filter((x) => x !== l); selLink = null; changed(); } }, '✕ delete link'));
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  document.body.append(menu);
  setTimeout(() => document.addEventListener('mousedown', closeLinkMenuOutside), 0);
}
function closeLinkMenuOutside(e) { if (!e.target.closest('#linkMenu')) closeLinkMenu(); }
function closeLinkMenu() { document.getElementById('linkMenu')?.remove(); document.removeEventListener('mousedown', closeLinkMenuOutside); }
function addLink(from, to) {
  if (S.links.some((l) => l.from.node === from.node && l.to.node === to.node && l.from.item === from.item)) return;
  S.links.push({ id: 'l' + genId(), from, to, priority: defaultPriority(to) });
  changed();
}

// ---------------- pan / zoom / drag ----------------
const vpEl = $('#viewport'), world = $('#world');
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px,${y}px) scale(${z})`;
  const lv = $('#showLabels')?.checked && z >= LABEL_MIN_ZOOM;
  if (applyView.lv !== undefined && applyView.lv !== lv) requestAnimationFrame(renderLinks);
  applyView.lv = lv;
  const g = GRID * z;
  vpEl.style.backgroundImage = `linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px), linear-gradient(#2a2f39 1px, transparent 1px), linear-gradient(90deg, #2a2f39 1px, transparent 1px)`;
  vpEl.style.backgroundSize = `${g}px ${g}px, ${g}px ${g}px, ${g * 5}px ${g * 5}px, ${g * 5}px ${g * 5}px`;
  vpEl.style.backgroundPosition = `${x}px ${y}px`;
}
function toWorld(cx, cy) {
  const r = vpEl.getBoundingClientRect();
  return { x: (cx - r.left - S.view.x) / S.view.z, y: (cy - r.top - S.view.y) / S.view.z };
}
vpEl.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node') || e.button === 2) return;
  if (selNode || selLink) { selNode = null; selLink = null; document.querySelectorAll('.node.sel').forEach((x) => x.classList.remove('sel')); renderLinks(); }
  const sx = e.clientX, sy = e.clientY, ox = S.view.x, oy = S.view.y;
  vpEl.classList.add('panning');
  const move = (ev) => { S.view.x = ox + ev.clientX - sx; S.view.y = oy + ev.clientY - sy; applyView(); };
  const up = () => { vpEl.classList.remove('panning'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); persist(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
});
vpEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = vpEl.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const z0 = S.view.z, z1 = Math.min(2.5, Math.max(0.15, z0 * Math.exp(-e.deltaY * 0.0015)));
  S.view.x = mx - (mx - S.view.x) * (z1 / z0); S.view.y = my - (my - S.view.y) * (z1 / z0); S.view.z = z1;
  applyView(); persistSoon();
}, { passive: false });
vpEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
vpEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const p = toWorld(e.clientX, e.clientY);
  const m = e.dataTransfer.getData('text/x-machine');
  const rn = e.dataTransfer.getData('text/x-recipe');
  const sp = e.dataTransfer.getData('text/x-special');
  if (sp) { openItemPicker((sp === 'source' ? 'Infinite source' : 'Infinite sink') + ': choose item', (it) => { const nn = makeSpecial(sp, it, p.x - 110, p.y - 20); selNode = nn; changed(); }); return; }
  let n = null;
  if (m) n = makeNode(m, null, p.x - 150, p.y - 20);
  else if (rn) { const dm = defaultMachine(rn); if (!dm) return status('No machine can craft ' + rn, true); n = makeNode(dm, rn, p.x - 150, p.y - 20); }
  if (!n) return;
  if (!S.nodes.some((o) => o.target) && n.recipe) n.target = defaultTarget(n);
  selNode = n; changed();
  if (!n.recipe) openRecipePicker(n);
});
function startNodeDrag(e, n) {
  if (e.button !== 0 || e.target.closest('button,select,input,.mname')) return;
  e.preventDefault();
  const s = toWorld(e.clientX, e.clientY); const ox = n.x, oy = n.y;
  const box = document.querySelector(`.node[data-id="${n.id}"]`);
  const move = (ev) => {
    const p = toWorld(ev.clientX, ev.clientY);
    n.x = snap(ox + p.x - s.x); n.y = snap(oy + p.y - s.y);
    box.style.left = n.x + 'px'; box.style.top = n.y + 'px'; renderLinks();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); persist(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.target.closest('input,select,textarea')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selLink) { S.links = S.links.filter((l) => l !== selLink); selLink = null; changed(); }
    else if (selNode) deleteNode(selNode);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveLayout(); }
  if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selNode) { e.preventDefault(); const c = structuredClone(selNode); c.id = genId(); c.x += 40; c.y += 40; c.target = null; S.nodes.push(c); selNode = c; changed(); }
});
function fitView() {
  if (!S.nodes.length) { S.view = { x: 300, y: 80, z: 1 }; applyView(); return; }
  const xs = S.nodes.map((n) => n.x), ys = S.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40, maxX = Math.max(...xs) + 340, maxY = Math.max(...ys) + 300;
  const r = vpEl.getBoundingClientRect();
  const z = Math.min(1.2, Math.max(0.15, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
  S.view = { z, x: -minX * z + (r.width - (maxX - minX) * z) / 2, y: -minY * z + (r.height - (maxY - minY) * z) / 2 };
  applyView(); renderLinks(); persist();
}

// ---------------- modals ----------------
function openModal(title, body) { $('#modalTitle').textContent = title; const b = $('#modalBody'); b.innerHTML = ''; b.append(body); $('#modal').classList.remove('hidden'); const s = b.querySelector('input[type=search]'); if (s) setTimeout(() => s.focus(), 0); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
function flowIcons(r) {
  const f = (x) => el('span', { class: 'amt', 'data-tip': `${fmt(x.a)}× ${itemName(x.n)}${x.p ? ` (${Math.round(x.p * 100)}%)` : ''}` }, itemIcon(x.n), el('span', {}, fmt(x.a, 2)));
  return el('span', { class: 'flow' }, ...r.i.map(f), el('span', { class: 'arrow' }, '→'), ...r.o.map(f));
}
function recipeListUI(names, onPick, opts = {}) {
  const wrap = el('div');
  const search = el('input', { type: 'search', placeholder: 'Search recipe, ingredient or product…' });
  const showHidden = el('input', { type: 'checkbox' });
  const bar = el('div', { class: 'toolbar2' }, search, el('label', { class: 'chk' }, showHidden, 'show hidden / void / barrel'));
  const list = el('div');
  wrap.append(bar, list);
  const render = () => {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    let shown = 0, lastSg = null;
    const sorted = names.map((n) => [n, D.recipes[n]]).filter(([, r]) => r).sort((a, b) => ((D.groups[a[1].g]?.o || 'z') + a[1].ord).localeCompare((D.groups[b[1].g]?.o || 'z') + b[1].ord));
    for (const [n, r] of sorted) {
      const hid = r.h || /barreling$/.test(r.c) || r.c === 'py-venting';
      if (hid && !showHidden.checked) continue;
      if (q && !(r.n + ' ' + n + ' ' + r.i.concat(r.o).map((x) => itemName(x.n) + ' ' + x.n).join(' ')).toLowerCase().includes(q)) continue;
      if (++shown > 600) break;
      if (r.sg !== lastSg) { list.append(el('div', { class: 'sg-title' }, r.sg || '')); lastSg = r.sg; }
      const row = el('div', { class: 'mrow' + (hid ? ' hid' : ''), onclick: () => onPick(n), 'data-tip': recipeTip(n) },
        icon(r.icon), el('span', { class: 'nm' }, r.n), flowIcons(r), el('span', { class: 'tm' }, r.e + 's'));
      if (opts.extra) row.append(opts.extra(n));
      list.append(row);
    }
    if (!shown) list.append(el('div', { class: 'sg-title' }, 'nothing matches (try "show hidden")'));
  };
  search.oninput = render; showHidden.onchange = render; render();
  return wrap;
}
function openRecipePicker(n) {
  const names = recipesForMachine(n.machine);
  openModal(`Recipe for ${D.machines[n.machine]?.n} (${names.length})`, recipeListUI(names, (rn) => {
    n.recipe = rn;
    if (n.target?.kind === 'rate' && !D.recipes[rn].o.some((o) => o.n === n.target.item)) n.target.item = D.recipes[rn].m || D.recipes[rn].o[0]?.n;
    if (!S.nodes.some((o) => o.target)) n.target = defaultTarget(n);
    closeModal(); changed();
  }));
}
function openMachineSwitch(n) {
  const r = D.recipes[n.recipe];
  const cands = r ? machinesFor(n.recipe, true) : machineList.filter((m) => m.cats.some((c) => D.machines[n.machine]?.cats.includes(c))).map((m) => m.name);
  const body = el('div');
  for (const mn of cands) {
    const m = D.machines[mn];
    body.append(el('div', { class: 'mrow', onclick: () => {
      n.machine = mn;
      const mods = allowedModules(mn);
      n.modules = n.modules.filter((x) => mods.includes(x.name));
      const tot = n.modules.reduce((a, b) => a + b.count, 0);
      if (tot > m.ms) n.modules = []; 
      if (!n.modules.length) n.modules = defaultModules(mn);
      if (!fuelOptions(mn).includes(n.fuel)) n.fuel = defaultFuel(mn);
      closeModal(); changed();
    } }, icon(m.icon), el('span', { class: 'nm' }, m.n), el('span', { class: 'tm' }, `speed ${m.sp}${m.bp ? ` · +${Math.round(m.bp * 100)}% prod` : ''} · ${m.ms} slots · ${fmtW(m.pw)} ${m.es}`)));
  }
  openModal('Switch machine', body);
}
function openLinkPicker(n, item, dir) {
  // dir 'in' => find producers of item; 'out' => consumers
  const names = (dir === 'in' ? recipesByProduct[item] : recipesByIngredient[item]) || [];
  const machineSel = {};
  const ui = recipeListUI(names, (rn) => {
    const mn = machineSel[rn] || defaultMachine(rn);
    if (!mn) { status('No machine for ' + rn, true); return; }
    const off = dir === 'in' ? -380 : 380;
    // stack next to existing neighbours
    const nn = makeNode(mn, rn, n.x + off, freeY(n.x + off, n.y, 300, 220));
    if (dir === 'in') addLinkSilent({ node: nn.id, item }, { node: n.id, item });
    else addLinkSilent({ node: n.id, item }, { node: nn.id, item });
    closeModal(); changed();
  }, {
    extra: (rn) => {
      const ms = machinesFor(rn);
      if (ms.length <= 1) return el('span');
      const s = el('select', { onclick: (e) => e.stopPropagation() }, ...ms.map((m) => el('option', { value: m }, D.machines[m].n)));
      s.value = defaultMachine(rn); s.onchange = () => { machineSel[rn] = s.value; };
      return s;
    }
  });
  const off = dir === 'in' ? -260 : 340;
  const btn = el('button', { class: 'primary', onclick: () => {
    const nn = makeSpecial(dir === 'in' ? 'source' : 'sink', item, n.x + off, freeY(n.x + off, n.y, 220, 90));
    if (dir === 'in') addLinkSilent({ node: nn.id, item }, { node: n.id, item }); else addLinkSilent({ node: n.id, item }, { node: nn.id, item });
    closeModal(); changed();
  } }, dir === 'in' ? `∞ Use an infinite source of ${itemName(item)}` : `⤓ Dump ${itemName(item)} into an infinite sink`);
  ui.prepend(el('div', { style: 'margin-bottom:6px' }, btn));
  openModal(`${dir === 'in' ? 'Producers of' : 'Consumers of'} ${itemName(item)} (${names.length})`, ui);
}
function freeY(x, y, w = 300, h = 160) {
  const boxes = S.nodes.map((o) => { const e = document.querySelector(`.node[data-id="${o.id}"]`); return { x: o.x, y: o.y, w: e ? e.offsetWidth : 300, h: e ? e.offsetHeight : 200 }; });
  for (let i = 0; i < 200; i++) {
    if (!boxes.some((b) => x < b.x + b.w + 20 && x + w + 20 > b.x && y < b.y + b.h + 20 && y + h + 20 > b.y)) return y;
    y += GRID * 2;
  }
  return y;
}
function addLinkSilent(from, to) { S.links.push({ id: 'l' + genId(), from, to, priority: defaultPriority(to) }); }
function openModules(n) {
  const m = D.machines[n.machine];
  const mods = allowedModules(n.machine);
  const body = el('div', { class: 'modlist' });
  const counts = Object.fromEntries(n.modules.map((x) => [x.name, x.count]));
  const totalEl = el('span');
  const upd = () => { const t = Object.values(counts).reduce((a, b) => a + (b || 0), 0); totalEl.textContent = `${t} / ${m.ms} slots used`; totalEl.style.color = t > m.ms ? 'var(--bad)' : ''; };
  body.append(el('div', { class: 'toolbar2' }, totalEl,
    el('button', { onclick: () => { for (const k in counts) counts[k] = 0; render(); } }, 'Clear')));
  const list = el('div'); body.append(list);
  const render = () => {
    list.innerHTML = '';
    for (const mn of mods) {
      const mo = D.modules[mn];
      const inp = el('input', { type: 'number', min: '0', max: String(m.ms), step: '1', value: counts[mn] || 0 });
      inp.oninput = () => { counts[mn] = Math.max(0, parseInt(inp.value) || 0); upd(); };
      const eff = Object.entries(mo.e).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`).join(', ');
      list.append(el('div', { class: 'mrow' }, itemIcon(mn), el('span', { class: 'nm' }, mo.n), el('span', { class: 'tm' }, eff), inp,
        el('button', { onclick: () => { for (const k in counts) counts[k] = 0; counts[mn] = m.ms; render(); } }, 'fill')));
    }
    if (!mods.length) list.append(el('div', { class: 'sg-title' }, 'no modules fit this machine'));
    upd();
  };
  render();
  const sp = el('input', { type: 'number', step: 'any', value: Math.round((n.extra_speed || 0) * 1000) / 10 });
  const pr = el('input', { type: 'number', step: 'any', value: Math.round((n.extra_prod || 0) * 1000) / 10 });
  body.append(el('div', { class: 'toolbar2', style: 'margin-top:10px' }, 'Extra speed % (beacons etc.)', sp, 'Extra productivity %', pr));
  body.append(el('div', { class: 'toolbar2' }, el('button', { class: 'primary', onclick: () => {
    n.modules = Object.entries(counts).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count }));
    n.extra_speed = (parseFloat(sp.value) || 0) / 100; n.extra_prod = (parseFloat(pr.value) || 0) / 100;
    closeModal(); changed();
  } }, 'Apply')));
  openModal(`Modules: ${m.n} (${m.ms} slots)`, body);
}

// ---------------- summary ----------------
function chip(item, v, bad) { return el('span', { class: 'chip' + (bad ? ' bad' : ''), 'data-tip': itemName(item) }, itemIcon(item), fmt(v * unit()) + unitLabel()); }
function renderSummary() {
  const s = $('#summary'); s.innerHTML = '';
  if (!R || !S.nodes.length) return;
  const sec = (title, obj, bad) => {
    const ent = Object.entries(obj || {}).filter(([, v]) => v > 1e-9).sort((a, b) => b[1] - a[1]);
    if (!ent.length) return;
    s.append(el('div', {}, el('h4', {}, title), el('div', { class: 'chips' }, ...ent.map(([k, v]) => chip(k, v, bad)))));
  };
  sec('Inputs needed (unconnected / imported)', R.raw_inputs);
  sec('Outputs & byproducts', R.outputs);
  sec('Drawn from infinite sources', R.sources);
  sec('Dumped into infinite sinks', R.sinks);
  sec('Short on linked inputs', R.deficits, true);
  sec('Over-production (secondary on top of demand)', R.excess);
  const P = R.potential;
  if (P && !(P.machines > 1e-9 || Object.keys(P.outputs || {}).length)) {
    const anySec = S.links.some((l) => (l.priority || 1) > 1);
    s.append(el('div', { class: 'potsec' }, el('h4', {}, 'Potential'), el('div', { class: 'pot dim' }, anySec
      ? 'No over-supply arriving via secondary/tertiary links right now — nothing extra to run.'
      : 'No secondary over-supply in this layout — mark a link as S (click its P badge) to see potential.')));
  }
  if (P && (P.machines > 1e-9 || Object.keys(P.outputs || {}).length)) {
    const ent = (o) => Object.entries(o || {}).filter(([, v]) => v > 1e-9).sort((a, b) => b[1] - a[1]);
    const box = el('div', { class: 'potsec' }, el('h4', {}, 'Potential extra output (using over-supply)'),
      el('div', { class: 'chips' }, ...ent(P.outputs).map(([k, v]) => chip(k, v))));
    if (ent(P.inputs).length) box.append(el('h4', {}, 'Extra imports for that'), el('div', { class: 'chips' }, ...ent(P.inputs).map(([k, v]) => chip(k, v))));
    box.append(el('div', {}, `+${fmt(P.machines)} machines${P.note ? ' · ' + P.note : ''}`));
    s.append(box);
  }
  s.append(el('div', {}, el('h4', {}, 'Totals'), el('div', {}, `${fmt(R.total_machines)} machines · ${fmtW(R.total_power_w)} electric${R.fuel_power_w ? ' · ' + fmtW(R.fuel_power_w) + ' from fuel' : ''}`)));
}

// ---------------- solving ----------------
let solveTimer = null, solveSeq = 0;
function solveSoon() { clearTimeout(solveTimer); solveTimer = setTimeout(solve, 120); }
async function solve() {
  const seq = ++solveSeq;
  const body = { potential: !!$('#showPotential')?.checked, nodes: S.nodes.map((n) => ({ id: n.id, kind: n.kind || 'machine', item: n.item || null, fuel: n.fuel || null, machine: n.machine || '', recipe: n.recipe, modules: n.modules, extra_speed: n.extra_speed || 0, extra_prod: n.extra_prod || 0, target: n.target })), links: S.links };
  try {
    const res = await fetch('api/solve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (seq !== solveSeq) return;
    if (!j.ok) { status(j.message, true); return; }
    R = { ...j, nodes: Object.fromEntries(j.nodes.map((n) => [n.id, n])), links: Object.fromEntries(j.links.map((l) => [l.id, l.rate])) };
    status(j.message || `solved: ${S.nodes.length} nodes, ${S.links.length} links`, !!j.message && /deficit|failed|ignored/.test(j.message));
    renderNodes(); renderSummary();
  } catch (e) { status('solve error: ' + e, true); }
}
function changed() {
  pruneLinks(); renderNodes(); persist();
  if ($('#autoSolve').checked) solveSoon();
}

// ---------------- persistence ----------------
function serial() { return { version: 1, nodes: S.nodes, links: S.links, view: S.view, unit: unit() }; }
function loadState(j, name = '') {
  S.nodes = (j.nodes || []).filter((n) => D.machines[n.machine] || true);
  S.links = (j.links || []).map((l) => ({ ...l, priority: l.priority || 1 })); S.view = j.view || S.view; S.name = name;
  for (const n of S.nodes) { n.modules ||= []; n.extra_speed ||= 0; n.extra_prod ||= 0; if (!n.kind && n.fuel === undefined) n.fuel = defaultFuel(n.machine); }
  if (j.unit) $('#unit').value = String(j.unit);
  $('#layoutName').textContent = name ? '— ' + name : '';
  R = null; selNode = null; selLink = null;
  applyView(); changed();
}
function persist() { localStorage.setItem('pp.current', JSON.stringify({ ...serial(), name: S.name })); autosaveSoon(); }
// server-side copy of the current canvas (layouts/_autosave.json) so it survives browser resets and can be inspected
let ast = null;
function autosaveSoon() {
  clearTimeout(ast);
  ast = setTimeout(() => { fetch('api/layouts/_autosave', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...serial(), name: S.name }, null, 1) }).catch(() => {}); }, 2000);
}
let pt = null; function persistSoon() { clearTimeout(pt); pt = setTimeout(persist, 300); }
async function saveLayout() {
  const name = prompt('Save layout as:', S.name || 'my-factory');
  if (!name) return;
  const r = await fetch('api/layouts/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serial(), null, 1) });
  if (r.ok) { S.name = name.replace(/[^A-Za-z0-9\-_ .]/g, ''); $('#layoutName').textContent = '— ' + S.name; persist(); status('saved ' + S.name); } else status('save failed: ' + (await r.text()), true);
}
async function openLoad() {
  const names = await (await fetch('api/layouts')).json();
  const body = el('div');
  if (!names.length) body.append(el('div', { class: 'sg-title' }, 'no saved layouts yet (they live in the layouts/ folder)'));
  for (const n of names) {
    body.append(el('div', { class: 'mrow' },
      el('span', { class: 'nm', onclick: async () => { const j = await (await fetch('api/layouts/' + encodeURIComponent(n))).json(); closeModal(); loadState(j, n); setTimeout(fitView, 50); } }, n),
      el('button', { onclick: async (e) => { e.stopPropagation(); if (confirm('Delete layout ' + n + '?')) { await fetch('api/layouts/' + encodeURIComponent(n), { method: 'DELETE' }); openLoad(); } } }, 'delete')));
  }
  openModal('Load layout', body);
}

// ---------------- init ----------------
async function init() {
  status('loading dataset…');
  D = await (await fetch('api/data')).json();
  prep();
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
    tab = b.dataset.tab; $('#search').placeholder = tab === 'machines' ? 'Search machines…' : 'Search recipes / products…'; renderSidebar();
  });
  let st = null; $('#search').oninput = () => { clearTimeout(st); st = setTimeout(renderSidebar, 120); };
  $('#showVariants').onchange = renderSidebar;
  $('#btnSolve').onclick = solve;
  $('#unit').onchange = () => { renderNodes(); renderSummary(); persist(); };
  $('#btnFit').onclick = fitView;
  $('#showLabels').checked = localStorage.getItem('pp.labels') !== '0';
  $('#showPotential').checked = localStorage.getItem('pp.potential') === '1';
  $('#showPotential').onchange = () => { localStorage.setItem('pp.potential', $('#showPotential').checked ? '1' : '0'); solve(); };
  $('#showLabels').onchange = () => { localStorage.setItem('pp.labels', $('#showLabels').checked ? '1' : '0'); renderLinks(); };
  $('#btnNew').onclick = () => { if (!S.nodes.length || confirm('Clear the canvas?')) loadState({ nodes: [], links: [], view: { x: 300, y: 80, z: 1 } }); };
  $('#btnSave').onclick = saveLayout;
  $('#btnLoad').onclick = openLoad;
  $('#btnExport').onclick = () => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(serial(), null, 1)], { type: 'application/json' })), download: (S.name || 'layout') + '.json' }); a.click(); };
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { loadState(JSON.parse(await f.text()), f.name.replace(/\.json$/, '')); setTimeout(fitView, 50); } catch (err) { status('import failed: ' + err, true); } e.target.value = ''; };
  renderSidebar();
  const saved = localStorage.getItem('pp.current');
  if (saved) { try { const j = JSON.parse(saved); loadState(j, j.name || ''); } catch { applyView(); } } else applyView();
  status(`${Object.keys(D.machines).length} machines · ${Object.keys(D.recipes).length} recipes · ${Object.keys(D.items).length} items/fluids`);
  if (S.nodes.length) { solve(); autosaveSoon(); }
}
init();
