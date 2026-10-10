#!/usr/bin/env python3
"""Convert a Factorio --dump-data / --dump-icon-sprites output into the planner dataset.
Usage: process_dump.py <script-output-dir> <project-dir>"""
import json, os, re, shutil, sys

src, proj = sys.argv[1], sys.argv[2]
d = json.load(open(os.path.join(src, 'data-raw-dump.json')))

def loc(kind):
    p = os.path.join(src, f'{kind}-locale.json')
    if not os.path.exists(p): return {}
    return json.load(open(p)).get('names', {})
L_item, L_fluid, L_recipe, L_entity, L_group = loc('item'), loc('fluid'), loc('recipe'), loc('entity'), loc('item-group')

def energy(s):
    if s is None: return 0.0
    if isinstance(s, (int, float)): return float(s)
    m = re.match(r'^([0-9.eE+-]+)\s*([kMGTPEZY]?)([WJ])$', s.strip())
    if not m: return 0.0
    mult = {'': 1, 'k': 1e3, 'M': 1e6, 'G': 1e9, 'T': 1e12, 'P': 1e15, 'E': 1e18, 'Z': 1e21, 'Y': 1e24}[m.group(2)]
    return float(m.group(1)) * mult

ITEM_TYPES = ['item', 'capsule', 'repair-tool', 'tool', 'item-with-entity-data', 'rail-planner', 'module',
              'ammo', 'gun', 'armor', 'spidertron-remote', 'selection-tool', 'blueprint', 'blueprint-book',
              'deconstruction-item', 'upgrade-item', 'copy-paste-tool', 'item-with-inventory', 'item-with-label',
              'item-with-tags', 'space-platform-starter-pack']
subgroups = d.get('item-subgroup', {})
groups = d.get('item-group', {})

def grp(sg):
    s = subgroups.get(sg or '', {})
    return s.get('group', 'other'), s.get('order', 'zzz')

icon_dir = os.path.join(proj, 'static', 'icons')
for sub in ['item', 'fluid', 'recipe', 'entity', 'item-group']:
    os.makedirs(os.path.join(icon_dir, sub), exist_ok=True)

def copy_icon(kind, name):
    s = os.path.join(src, kind, name + '.png')
    if not os.path.exists(s): return None
    t = os.path.join(icon_dir, kind, name + '.png')
    if not os.path.exists(t): shutil.copyfile(s, t)
    return f'{kind}/{name}'

items = {}
for t in ITEM_TYPES:
    for n, it in d.get(t, {}).items():
        if n in items: continue
        g, so = grp(it.get('subgroup'))
        items[n] = dict(t='item', n=L_item.get(n, n), g=g, sg=it.get('subgroup', ''), o=f"{so}|{it.get('order', '')}",
                        h=bool(it.get('hidden')), fuel=energy(it.get('fuel_value')), place=it.get('place_result'),
                        stack=it.get('stack_size', 0), fc=it.get('fuel_category'), br=it.get('burnt_result'))
for n, f in d.get('fluid', {}).items():
    g, so = grp(f.get('subgroup', 'fluid'))
    items[n] = dict(t='fluid', n=L_fluid.get(n, n), g=g, sg=f.get('subgroup', 'fluid'), o=f"{so}|{f.get('order', '')}",
                    h=bool(f.get('hidden')), fuel=energy(f.get('fuel_value')), temp=f.get('default_temperature', 15))

def norm_list(x):
    if x is None: return []
    if isinstance(x, dict): return list(x.values())
    return x

def ingr(i):
    if isinstance(i, list):  # legacy short form
        return dict(n=i[0], a=float(i[1]), t='item')
    o = dict(n=i['name'], a=float(i.get('amount', 1)), t=i.get('type', 'item'))
    if 'minimum_temperature' in i: o['tmin'] = i['minimum_temperature']
    if 'maximum_temperature' in i: o['tmax'] = i['maximum_temperature']
    if 'temperature' in i: o['temp'] = i['temperature']
    return o

def product(r):
    if isinstance(r, list):
        r = dict(name=r[0], amount=r[1])
    if 'amount' in r: base = float(r['amount'])
    else: base = (float(r.get('amount_min', 1)) + float(r.get('amount_max', 1))) / 2
    p = float(r.get('probability', 1))
    extra = float(r.get('extra_count_fraction', 0))
    o = dict(n=r['name'], t=r.get('type', 'item'), a=p * (base + extra))
    if p != 1: o['p'] = p
    if 'amount_min' in r and r.get('amount_min') != r.get('amount_max'): o['min'] = r['amount_min']; o['max'] = r['amount_max']
    if extra: o['x'] = extra
    ip = float(r.get('ignored_by_productivity', 0))
    if ip: o['ip'] = min(ip, base) * p
    if 'temperature' in r: o['temp'] = r['temperature']
    return o

recipes = {}
cat_recipes = {}
def add_recipe(name, rec):
    recipes[name] = rec
    cat_recipes.setdefault(rec['c'], []).append(name)

for n, r in d['recipe'].items():
    cat = r.get('category', 'crafting')
    if cat == 'recycling': continue
    ing = [ingr(i) for i in norm_list(r.get('ingredients'))]
    res = norm_list(r.get('results'))
    if not res and r.get('result'):
        res = [dict(name=r['result'], amount=r.get('result_count', 1))]
    out = [product(x) for x in res]
    main = r.get('main_product') or (out[0]['n'] if len(out) == 1 else None)
    label = L_recipe.get(n) or (items.get(main, {}).get('n') if main else None) or n
    has_own_icon = 'icon' in r or 'icons' in r
    icon = copy_icon('recipe', n) if has_own_icon else None
    if not icon and main:
        icon = f"{items[main]['t']}/{main}" if main in items else None
    if not icon: icon = copy_icon('recipe', n)
    sg = r.get('subgroup') or (d.get(items.get(main, {}).get('t', 'item'), {}).get(main, {}).get('subgroup') if main else None) or ''
    g, so = grp(sg)
    add_recipe(n, dict(n=label, c=cat, e=float(r.get('energy_required', 0.5)), i=ing, o=out, m=main,
                       prod=bool(r.get('allow_productivity', False)), mp=float(r.get('maximum_productivity', 3)),
                       h=bool(r.get('hidden')) or cat in ('py-incineration',), en=r.get('enabled', True) is not False,
                       icon=icon, g=g, sg=sg, ord=f"{so}|{r.get('order', '')}"))

# placer items
placers = {}
for n, it in items.items():
    if it.get('place'): placers.setdefault(it['place'], n)

def machine_base(n, e, kind):
    item = placers.get(n) or placers.get(re.sub(r'-turd\d*$', '', n)) or placers.get(re.sub(r'-legacy$', '', n))
    sg = items[item]['sg'] if item else (e.get('subgroup') or '')
    g, so = grp(sg)
    es = e.get('energy_source') or {}
    er = e.get('effect_receiver') or {}
    be = er.get('base_effect') or {}
    label = L_entity.get(n) or (items[item]['n'] if item else n)
    if n.endswith('-legacy') or re.search(r'-turd\d*$', n):
        suffix = 'legacy' if n.endswith('-legacy') else 'TURD ' + n.rsplit('-', 1)[1]
        if suffix not in label: label = f"{label} [{suffix}]"
    icon = copy_icon('entity', n) or (copy_icon('item', item) if item else None)
    fuel = None
    if es.get('type') == 'burner':
        fuel = dict(k='burner', cats=es.get('fuel_categories') or [es.get('fuel_category', 'chemical')], eff=float(es.get('effectivity', 1)))
    elif es.get('type') == 'fluid':
        fb = es.get('fluid_box') or {}
        fuel = dict(k='fluid' if es.get('burns_fluid') else 'heat', filter=fb.get('filter'), eff=float(es.get('effectivity', 1)),
                    upt=es.get('fluid_usage_per_tick'), scale=es.get('scale_fluid_usage', False) is not False, maxt=es.get('maximum_temperature'))
    return dict(n=label, k=kind, item=item, fuel=fuel, g=g, sg=sg, o=f"{so}|{(d.get('item', {}).get(item or '', {}) or {}).get('order', e.get('order', ''))}|{n}",
                es=es.get('type', 'void'), fuelcat=es.get('fuel_categories') or ([es['fuel_category']] if es.get('fuel_category') else []),
                eff=float(es.get('effectivity', 1)),
                pw=energy(e.get('energy_usage')), drain=energy(es.get('drain')),
                ms=int(e.get('module_slots') or 0), mc=e.get('allowed_module_categories'),
                ae=e.get('allowed_effects') or [], bp=float(be.get('productivity', 0)), bs=float(be.get('speed', 0)),
                um=(er.get('uses_module_effects', True) is not False), icon=icon,
                h=bool(e.get('hidden')), size=e.get('collision_box'))

machines = {}
for kind in ['assembling-machine', 'furnace', 'rocket-silo']:
    for n, e in d.get(kind, {}).items():
        m = machine_base(n, e, kind)
        m.update(cats=e.get('crafting_categories', []), sp=float(e.get('crafting_speed', 1)), fixed=e.get('fixed_recipe'))
        machines[n] = m

# mining: pseudo recipes per resource
res_by_cat = {}
for rn, r in d.get('resource', {}).items():
    mn = r.get('minable') or {}
    res = norm_list(mn.get('results'))
    if not res and mn.get('result'):
        res = [dict(name=mn['result'], amount=mn.get('count', 1))]
    if not res: continue
    cat = r.get('category') or 'basic-solid'
    out = [product(x) for x in res]
    ing = []
    if mn.get('required_fluid'):
        ing.append(dict(n=mn['required_fluid'], a=float(mn.get('fluid_amount', 0)) / 10.0, t='fluid'))
    name = f'mine:{rn}'
    icon = copy_icon('entity', rn) or (f"{items[out[0]['n']]['t']}/{out[0]['n']}" if out[0]['n'] in items else None)
    label = 'Mine ' + (L_entity.get(rn) or rn)
    if r.get('infinite'): label += ' (100% yield)'
    add_recipe(name, dict(n=label, c='mining:' + cat, e=float(mn.get('mining_time', 1)), i=ing, o=out, m=out[0]['n'],
                          prod=True, mp=1e6, h=False, en=True, icon=icon, g='mining', sg='mining', ord=rn, pseudo='mining'))
for n, e in d.get('mining-drill', {}).items():
    m = machine_base(n, e, 'mining-drill')
    m.update(cats=['mining:' + c for c in e.get('resource_categories', [])], sp=float(e.get('mining_speed', 1)), fixed=None)
    machines[n] = m

# offshore pumps: one pseudo recipe per tile fluid
tile_fluids = sorted({t['fluid'] for t in d.get('tile', {}).values() if t.get('fluid')})
for f in tile_fluids:
    add_recipe(f'pump:{f}', dict(n=f"Pump {items.get(f, {}).get('n', f)}", c='offshore', e=1.0, i=[], o=[dict(n=f, t='fluid', a=60.0)],
                                 m=f, prod=False, mp=0, h=False, en=True, icon=f'fluid/{f}', g='mining', sg='offshore', ord=f, pseudo='offshore'))
for n, e in d.get('offshore-pump', {}).items():
    m = machine_base(n, e, 'offshore-pump')
    # recipe gives 60 units per second at speed 1 => speed = pumping_speed (per tick)
    m.update(cats=['offshore'], sp=float(e.get('pumping_speed', 20)), fixed=None)
    machines[n] = m

# boilers (fluid -> fluid heating); rate derived from energy_consumption
for n, e in d.get('boiler', {}).items():
    fin = (e.get('fluid_box') or {}).get('filter')
    fout = (e.get('output_fluid_box') or {}).get('filter')
    if e.get('mode') == 'heat-fluid-inside' or not fin or not fout: continue
    tin = items.get(fin, {}).get('temp', 15)
    hc = energy((d['fluid'].get(fin) or {}).get('heat_capacity', '1kJ')) or 1000
    dt = max(1, float(e.get('target_temperature', 165)) - float(tin))
    rate = energy(e.get('energy_consumption')) / (hc * dt)
    rn = f'boil:{n}'
    add_recipe(rn, dict(n=f"Heat {items.get(fin, {}).get('n', fin)} → {items.get(fout, {}).get('n', fout)} ({e.get('target_temperature')}°)",
                        c=f'boiler:{n}', e=1.0, i=[dict(n=fin, a=rate, t='fluid')], o=[dict(n=fout, a=rate, t='fluid', temp=e.get('target_temperature'))],
                        m=fout, prod=False, mp=0, h=False, en=True, icon=f'fluid/{fout}', g='mining', sg='boiler', ord=n, pseudo='boiler'))
    m = machine_base(n, e, 'boiler')
    m.update(cats=[f'boiler:{n}'], sp=1.0, fixed=rn, pw=energy(e.get('energy_consumption')), ms=0)
    machines[n] = m

# drop machines that can't craft anything or are hidden internal helpers without a placer
for n in list(machines):
    m = machines[n]
    if not any(c in cat_recipes for c in m['cats']):
        del machines[n]; continue
    if m['h'] and not m['item']:
        del machines[n]

modules = {}
for n, mo in d.get('module', {}).items():
    eff = mo.get('effect') or {}
    modules[n] = dict(n=items.get(n, {}).get('n', n), c=mo.get('category'), t=mo.get('tier', 1),
                      e={k: float(v) for k, v in eff.items()}, o=items.get(n, {}).get('o', ''))

group_out = {}
for gn, g in groups.items():
    group_out[gn] = dict(n=L_group.get(gn, gn), o=g.get('order', 'zzz'), icon=copy_icon('item-group', gn))
group_out.setdefault('mining', dict(n='Mining / pumping', o='0', icon=None))

# item icons (copy for all items that appear somewhere)
used = set()
for r in recipes.values():
    for x in r['i'] + r['o']: used.add(x['n'])
used |= set(modules)
for n in list(items):
    it = items[n]
    if n not in used and it['h']:
        del items[n]; continue
    it['icon'] = copy_icon(it['t'], n)
    it.pop('place', None)
    if not it.get('fc'): it.pop('fc', None)
    if not it.get('br'): it.pop('br', None)

for r in recipes.values():
    if r['icon'] and not os.path.exists(os.path.join(icon_dir, r['icon'] + '.png')):
        r['icon'] = None

data = dict(version=dict(factorio=None), items=items, recipes=recipes, machines=machines, modules=modules,
            groups=group_out, cat_recipes=cat_recipes)
mods = {}
try:
    ms = json.load(open(os.path.join(src, 'mod-settings-dump.json')))
except Exception:
    ms = None
os.makedirs(os.path.join(proj, 'data'), exist_ok=True)
with open(os.path.join(proj, 'data', 'dataset.json'), 'w') as f:
    json.dump(data, f, separators=(',', ':'))
print(f"items={sum(1 for i in items.values() if i['t']=='item')} fluids={sum(1 for i in items.values() if i['t']=='fluid')} "
      f"recipes={len(recipes)} (pseudo={sum(1 for r in recipes.values() if r.get('pseudo'))}, hidden={sum(1 for r in recipes.values() if r['h'])}) "
      f"machines={len(machines)} modules={len(modules)}")
