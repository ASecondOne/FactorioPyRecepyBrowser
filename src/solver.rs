use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

use microlp::{ComparisonOp, OptimizationDirection, Problem, Variable};

// ---------- dataset (only the fields the solver needs) ----------
#[derive(Deserialize)]
pub struct Dataset {
    pub items: HashMap<String, ItemD>,
    pub recipes: HashMap<String, Recipe>,
    pub machines: HashMap<String, Machine>,
    pub modules: HashMap<String, Module>,
}
#[derive(Deserialize)]
pub struct ItemD {
    #[serde(default)]
    pub t: String,
    #[serde(default)]
    pub fuel: f64,
    #[serde(default)]
    pub fc: Option<String>,
    #[serde(default)]
    pub br: Option<String>,
}
#[derive(Deserialize, Clone)]
pub struct FuelSpec {
    pub k: String, // burner | fluid | heat
    #[serde(default)]
    pub cats: Vec<String>,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default = "one")]
    pub eff: f64,
    #[serde(default)]
    pub upt: Option<f64>,
}
fn one() -> f64 {
    1.0
}
#[derive(Deserialize)]
pub struct Ing {
    pub n: String,
    pub a: f64,
}
#[derive(Deserialize)]
pub struct Prod {
    pub n: String,
    pub a: f64,
    #[serde(default)]
    pub ip: f64,
}
#[derive(Deserialize)]
pub struct Recipe {
    pub c: String,
    pub e: f64,
    pub i: Vec<Ing>,
    pub o: Vec<Prod>,
    #[serde(default)]
    pub prod: bool,
    #[serde(default)]
    pub mp: f64,
}
#[derive(Deserialize)]
pub struct Machine {
    pub cats: Vec<String>,
    pub sp: f64,
    #[serde(default)]
    pub pw: f64,
    #[serde(default)]
    pub drain: f64,
    #[serde(default)]
    pub es: String,
    #[serde(default)]
    pub ms: u32,
    #[serde(default)]
    pub ae: Vec<String>,
    #[serde(default)]
    pub bp: f64,
    #[serde(default)]
    pub bs: f64,
    #[serde(default)]
    pub fuel: Option<FuelSpec>,
}
#[derive(Deserialize)]
pub struct Module {
    #[serde(default)]
    pub e: HashMap<String, f64>,
}

// ---------- request ----------
#[derive(Deserialize, Clone)]
pub struct ModSel {
    pub name: String,
    pub count: u32,
}
#[derive(Deserialize, Clone)]
pub struct Target {
    pub kind: String, // "machines" | "rate"
    #[serde(default)]
    pub item: Option<String>,
    pub value: f64,
}
#[derive(Deserialize, Clone)]
pub struct NodeReq {
    pub id: String,
    #[serde(default)]
    pub kind: Option<String>, // "machine" (default) | "source" | "sink"
    #[serde(default)]
    pub item: Option<String>, // for source / sink
    #[serde(default)]
    pub fuel: Option<String>,
    #[serde(default)]
    pub machine: String,
    pub recipe: Option<String>,
    #[serde(default)]
    pub modules: Vec<ModSel>,
    #[serde(default)]
    pub extra_speed: f64, // e.g. beacons, fraction (0.5 = +50%)
    #[serde(default)]
    pub extra_prod: f64,
    #[serde(default)]
    pub target: Option<Target>,
}
#[derive(Deserialize, Clone)]
pub struct PortRef {
    pub node: String,
    pub item: String,
}
#[derive(Deserialize, Clone)]
pub struct LinkReq {
    pub id: String,
    /// 1 = primary (default), 2 = secondary, 3 = tertiary
    #[serde(default)]
    pub priority: Option<u8>,
    pub from: PortRef,
    pub to: PortRef,
}
#[derive(Deserialize, Clone)]
pub struct SolveReq {
    pub nodes: Vec<NodeReq>,
    pub links: Vec<LinkReq>,
    /// also compute the "potential" layer: what the over-supply from secondary links could additionally run
    #[serde(default)]
    pub potential: bool,
}

// ---------- response ----------
#[derive(Serialize, Default)]
pub struct PortOut {
    pub item: String,
    pub rate: f64,       // total rate at solved machine count (items/s)
    pub per_machine: f64,
    pub linked: bool,
    pub slack: f64, // surplus for outputs, deficit for inputs
    pub excess: f64, // inputs only: delivered beyond what the node consumes (secondary links on top of demand)
}
#[derive(Serialize, Default)]
pub struct NodeOut {
    pub id: String,
    pub machines: f64,
    pub speed: f64,
    pub productivity: f64,
    pub crafts_per_sec: f64,
    pub power_w: f64,
    pub energy_source: String,
    pub inputs: Vec<PortOut>,
    pub outputs: Vec<PortOut>,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub fuel: Option<String>,
    pub fuel_per_machine: f64,
    pub burnt: Option<String>,
    pub mode: String, // target | demand | supply | supply-auto | source | sink
}
#[derive(Serialize)]
pub struct LinkOut {
    pub id: String,
    pub rate: f64,
}
#[derive(Serialize)]
pub struct SolveResp {
    pub ok: bool,
    pub message: String,
    pub nodes: Vec<NodeOut>,
    pub links: Vec<LinkOut>,
    pub raw_inputs: BTreeMap<String, f64>,
    pub outputs: BTreeMap<String, f64>,
    pub deficits: BTreeMap<String, f64>,
    pub total_power_w: f64,
    pub total_machines: f64,
    pub sources: BTreeMap<String, f64>,
    pub sinks: BTreeMap<String, f64>,
    pub fuel_power_w: f64,
    pub excess: BTreeMap<String, f64>,
    pub potential: Option<Potential>,
}

#[derive(Serialize, Default)]
pub struct PotNode {
    pub extra_machines: f64,
    pub inputs: BTreeMap<String, f64>,  // extra consumption per input item
    pub outputs: BTreeMap<String, f64>, // extra production per output item
    pub unused_supply: BTreeMap<String, f64>, // over-supply on an input that still can't be used
    pub limit: Vec<String>, // input items that cap the extra (bottleneck)
    pub helper: bool,       // not fed by over-supply itself; runs extra only to supply a driven node
}
#[derive(Serialize, Default)]
pub struct Potential {
    pub nodes: BTreeMap<String, PotNode>,
    pub links: BTreeMap<String, f64>,
    pub outputs: BTreeMap<String, f64>, // extra output that leaves the graph (unlinked outputs + not-consumed extra)
    pub inputs: BTreeMap<String, f64>,  // extra imports on unlinked inputs
    pub machines: f64,
    pub note: String,
}

struct NodeModel {
    ins: Vec<(String, f64)>,  // per machine per second
    outs: Vec<(String, f64)>, // per machine per second
    speed: f64,
    prod: f64,
    cps: f64,
    power: f64,
    es: String,
    err: Option<String>,
    warn: Option<String>,
    special: Option<String>,
    fuel: Option<String>,
    fuel_rate: f64,
    burnt: Option<String>,
}

fn aggregate(v: Vec<(String, f64)>) -> Vec<(String, f64)> {
    let mut out: Vec<(String, f64)> = Vec::new();
    for (n, a) in v {
        if let Some(e) = out.iter_mut().find(|(m, _)| *m == n) {
            e.1 += a;
        } else {
            out.push((n, a));
        }
    }
    out
}

fn model_node(ds: &Dataset, n: &NodeReq) -> NodeModel {
    let mut nm = NodeModel { ins: vec![], outs: vec![], speed: 0.0, prod: 0.0, cps: 0.0, power: 0.0, es: String::new(), err: None, warn: None, special: None, fuel: None, fuel_rate: 0.0, burnt: None };
    if let Some(k) = n.kind.as_deref().filter(|k| *k == "source" || *k == "sink") {
        nm.special = Some(k.to_string());
        nm.speed = 1.0;
        match &n.item {
            Some(it) if k == "source" => nm.outs.push((it.clone(), 1.0)),
            Some(it) => nm.ins.push((it.clone(), 1.0)),
            None => nm.err = Some("no item selected".into()),
        }
        return nm;
    }
    let Some(m) = ds.machines.get(&n.machine) else {
        nm.err = Some(format!("unknown machine {}", n.machine));
        return nm;
    };
    nm.es = m.es.clone();
    let Some(rn) = &n.recipe else {
        nm.err = Some("no recipe selected".into());
        return nm;
    };
    let Some(r) = ds.recipes.get(rn) else {
        nm.err = Some(format!("unknown recipe {rn}"));
        return nm;
    };
    if !m.cats.contains(&r.c) {
        nm.err = Some(format!("machine cannot craft category {}", r.c));
    }
    let (mut sp, mut pr, mut cons) = (m.bs, m.bp, 0.0);
    let mut used = 0u32;
    for ms in &n.modules {
        if let Some(md) = ds.modules.get(&ms.name) {
            let c = ms.count as f64;
            used += ms.count;
            if m.ae.iter().any(|x| x == "speed") || m.ae.is_empty() {
                sp += md.e.get("speed").copied().unwrap_or(0.0) * c;
            }
            if m.ae.iter().any(|x| x == "productivity") {
                pr += md.e.get("productivity").copied().unwrap_or(0.0) * c;
            }
            if m.ae.iter().any(|x| x == "consumption") {
                cons += md.e.get("consumption").copied().unwrap_or(0.0) * c;
            }
        }
    }
    if used > m.ms && m.ms > 0 {
        nm.err = Some(format!("{used} modules but only {} slots", m.ms));
    }
    sp += n.extra_speed;
    pr += n.extra_prod;
    let speed_mult = (1.0 + sp).max(0.2);
    let prod = if r.prod { pr.max(0.0).min(if r.mp > 0.0 { r.mp } else { 3.0 }) } else { 0.0 };
    let speed = m.sp * speed_mult;
    let cps = if r.e > 0.0 { speed / r.e } else { speed / 0.5 };
    nm.speed = speed;
    nm.prod = prod;
    nm.cps = cps;
    let usage = m.pw * (1.0 + cons).max(0.2);
    nm.power = usage + m.drain;
    let mut ins: Vec<(String, f64)> = r.i.iter().map(|i| (i.n.clone(), i.a * cps)).collect();
    let mut outs: Vec<(String, f64)> = r.o.iter().map(|o| (o.n.clone(), (o.a + prod * (o.a - o.ip).max(0.0)) * cps)).collect();
    if let Some(fs) = &m.fuel {
        let chosen = n.fuel.clone().or_else(|| if fs.k == "heat" { fs.filter.clone() } else { None });
        match chosen {
            None => nm.warn = Some("no fuel selected".into()),
            Some(f) => {
                let it = ds.items.get(&f);
                let eff = if fs.eff > 0.0 { fs.eff } else { 1.0 };
                let rate = match (fs.k.as_str(), it) {
                    ("heat", _) => match fs.upt {
                        Some(u) => Some(u * 60.0),
                        None => {
                            nm.warn = Some("heat-fluid energy source: consumption not modelled".into());
                            None
                        }
                    },
                    (_, None) => {
                        nm.warn = Some(format!("unknown fuel {f}"));
                        None
                    }
                    (_, Some(it)) if it.fuel <= 0.0 => {
                        nm.warn = Some(format!("{f} has no fuel value"));
                        None
                    }
                    ("burner", Some(it)) => {
                        if it.t == "fluid" || !it.fc.as_ref().map(|c| fs.cats.contains(c)).unwrap_or(false) {
                            nm.warn = Some(format!("{f} is not a valid fuel for this machine"));
                        }
                        Some(usage / (it.fuel * eff))
                    }
                    (_, Some(it)) => {
                        if it.t != "fluid" || fs.filter.as_ref().map(|x| *x != f).unwrap_or(false) {
                            nm.warn = Some(format!("{f} is not a valid fuel fluid for this machine"));
                        }
                        Some(usage / (it.fuel * eff))
                    }
                };
                if let Some(rate) = rate {
                    ins.push((f.clone(), rate));
                    nm.fuel_rate = rate;
                    if fs.k == "burner" {
                        if let Some(br) = it.and_then(|i| i.br.clone()) {
                            outs.push((br.clone(), rate));
                            nm.burnt = Some(br);
                        }
                    }
                }
                nm.fuel = Some(f);
            }
        }
    }
    nm.ins = aggregate(ins);
    nm.outs = aggregate(outs);
    nm
}

pub fn solve(ds: &Dataset, req_in: &SolveReq) -> SolveResp {
    // Canonical order: the result must not depend on the order nodes/links were created in
    // (and never on canvas position). Sort everything by id before building the LP.
    let mut req = req_in.clone();
    req.nodes.sort_by(|a, b| a.id.cmp(&b.id));
    req.links.sort_by(|a, b| a.id.cmp(&b.id));
    let req = &req;
    let models: Vec<NodeModel> = req.nodes.iter().map(|n| model_node(ds, n)).collect();
    let idx: HashMap<&str, usize> = req.nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();

    // valid links only
    let mut valid_links: Vec<&LinkReq> = Vec::new();
    let mut bad_links = 0;
    for l in req.links.iter() {
        let (Some(&a), Some(&b)) = (idx.get(l.from.node.as_str()), idx.get(l.to.node.as_str())) else { bad_links += 1; continue };
        let ok = l.from.item == l.to.item
            && models[a].outs.iter().any(|(n, _)| *n == l.from.item)
            && models[b].ins.iter().any(|(n, _)| *n == l.to.item);
        if ok { valid_links.push(l) } else { bad_links += 1 }
    }
    let mut msgs: Vec<String> = Vec::new();
    // node modes: explicit target (machines/rate) | demand (default, pull) | supply (push: use all linked input)
    // A node without its own target whose outputs only feed secondary/tertiary links is not pulled by
    // anything: it runs on what its inputs provide ("supply-auto") and its output lands on top of demand.
    let explicit_target = |n: &NodeReq| n.target.as_ref().map(|t| t.kind == "machines" || t.kind == "rate").unwrap_or(false);
    let modes: Vec<String> = req
        .nodes
        .iter()
        .zip(models.iter())
        .map(|(n, m)| {
            if let Some(sp) = &m.special {
                // an infinite sink with a desired rate pulls like a target; without one it takes everything
                if sp == "sink" && n.target.as_ref().map_or(false, |t| t.kind == "rate" && t.value > 0.0) {
                    return "sink-target".into();
                }
                return sp.clone();
            }
            if explicit_target(n) {
                return "target".into();
            }
            if n.target.as_ref().map(|t| t.kind == "consume" || t.kind == "supply").unwrap_or(false) {
                return "supply".into();
            }
            let outl: Vec<&&LinkReq> = valid_links.iter().filter(|l| l.from.node == n.id).collect();
            if !outl.is_empty() && outl.iter().all(|l| prio(l) >= 2) {
                return "supply-auto".into();
            }
            "demand".into()
        })
        .collect();
    let supply: Vec<bool> = modes.iter().map(|m| m == "sink" || m == "supply" || m == "supply-auto").collect();
    let has_target = req.nodes.iter().any(|n| n.target.as_ref().map(|t| t.kind == "machines" || t.kind == "rate").unwrap_or(false));

    let ctx = Ctx { req, models: &models, links: &valid_links, supply: &supply, cap: std::cell::Cell::new(f64::INFINITY) };
    // Phase A (demand): everything is sized by targets + downstream demand; supply-mode nodes run on what
    // reaches them over primary links (and may be pulled through from demand-sized upstream / sources).
    let ph1 = match ctx.phase_a(&mut msgs) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    // Phase B (supply): freeze phase-A sizes, let supply-mode nodes use what is available on their inputs.
    let need_b = supply.iter().any(|c| *c) || valid_links.iter().any(|l| prio(l) >= 2);
    let sol = if need_b {
        match ctx.phase_b(&ph1, &mut msgs) {
            Ok(v) => v,
            Err(e) => return fail(e),
        }
    } else {
        ph1
    };
    if bad_links > 0 {
        msgs.push(format!("{bad_links} link(s) ignored (item mismatch / recipe changed)"));
    }
    if !has_target && !req.nodes.is_empty() {
        msgs.push("no target set: set a target rate or machine count on at least one node".into());
    }
    let clean = |v: f64| if v.abs() < 1e-7 { 0.0 } else { v };

    let mut raw_inputs = BTreeMap::new();
    let mut outputs = BTreeMap::new();
    let mut deficits = BTreeMap::new();
    let mut total_power = 0.0;
    let mut total_machines = 0.0;
    let mut fuel_power = 0.0;
    let mut sources = BTreeMap::new();
    let mut sinks = BTreeMap::new();
    let mut excess = BTreeMap::new();
    let mut nodes_out = Vec::new();
    for (ni, m) in models.iter().enumerate() {
        let x = clean(sol.x[ni]);
        let power = m.power * x;
        match m.special.as_deref() {
            Some("source") => {
                if let Some((it, _)) = m.outs.first() {
                    if x > 1e-9 {
                        *sources.entry(it.clone()).or_insert(0.0) += x;
                    }
                }
            }
            Some(_) => {
                if let Some((it, _)) = m.ins.first() {
                    if x > 1e-9 {
                        *sinks.entry(it.clone()).or_insert(0.0) += x;
                    }
                }
            }
            None => {
                total_machines += x;
                if m.es == "electric" || m.es.is_empty() {
                    total_power += power;
                } else if m.es != "void" {
                    fuel_power += power;
                }
            }
        }
        let mut no = NodeOut {
            id: req.nodes[ni].id.clone(),
            machines: x,
            speed: m.speed,
            productivity: m.prod,
            crafts_per_sec: m.cps * x,
            power_w: power,
            energy_source: m.es.clone(),
            error: m.err.clone(),
            warning: m.warn.clone(),
            fuel: m.fuel.clone(),
            fuel_per_machine: m.fuel_rate,
            burnt: m.burnt.clone(),
            mode: modes[ni].clone(),
            ..Default::default()
        };
        for (item, per) in &m.ins {
            let sv = sol.slack.get(&(ni, true, item.clone()));
            let slack = sv.map(|v| clean(*v)).unwrap_or(0.0);
            let rate = per * x;
            if m.special.is_some() {
            } else if sv.is_none() {
                *raw_inputs.entry(item.clone()).or_insert(0.0) += rate;
            } else if slack > 1e-7 {
                *deficits.entry(item.clone()).or_insert(0.0) += slack;
                *raw_inputs.entry(item.clone()).or_insert(0.0) += slack;
            }
            let ex = clean(sol.over.get(&(ni, item.clone())).copied().unwrap_or(0.0));
            if ex > 1e-7 {
                *excess.entry(item.clone()).or_insert(0.0) += ex;
            }
            no.inputs.push(PortOut { item: item.clone(), rate, per_machine: *per, linked: sv.is_some(), slack, excess: ex });
        }
        for (item, per) in &m.outs {
            let sv = sol.slack.get(&(ni, false, item.clone()));
            let slack = sv.map(|v| clean(*v)).unwrap_or(0.0);
            let rate = per * x;
            let free = if sv.is_none() { rate } else { slack };
            if free > 1e-9 && m.special.is_none() {
                *outputs.entry(item.clone()).or_insert(0.0) += free;
            }
            no.outputs.push(PortOut { item: item.clone(), rate, per_machine: *per, linked: sv.is_some(), slack, excess: 0.0 });
        }
        nodes_out.push(no);
    }
    // net: an item that is both imported and exported externally -> keep both but it's informative
    let mut msgs_pot: Vec<String> = Vec::new();
    let links_out = valid_links.iter().zip(sol.f.iter()).map(|(l, v)| LinkOut { id: l.id.clone(), rate: clean(*v) }).collect();
    if !deficits.is_empty() {
        msgs.push("some linked inputs could not be fully supplied (see deficits)".into());
    }
    SolveResp {
        ok: true,
        message: msgs.join("; "),
        nodes: nodes_out,
        links: links_out,
        raw_inputs,
        outputs,
        deficits,
        total_power_w: total_power,
        total_machines,
        sources,
        sinks,
        fuel_power_w: fuel_power,
        excess,
        potential: if req.potential { Some(ctx.potential(&sol, &mut msgs_pot)) } else { None },
    }
}

fn fail(e: String) -> SolveResp {
    SolveResp {
        ok: false,
        message: e,
        nodes: vec![],
        links: vec![],
        raw_inputs: BTreeMap::new(),
        outputs: BTreeMap::new(),
        deficits: BTreeMap::new(),
        total_power_w: 0.0,
        total_machines: 0.0,
        sources: BTreeMap::new(),
        sinks: BTreeMap::new(),
        fuel_power_w: 0.0,
        excess: BTreeMap::new(),
        potential: None,
    }
}

struct LpSol {
    x: Vec<f64>,
    f: Vec<f64>,
    slack: HashMap<(usize, bool, String), f64>,
    over: HashMap<(usize, String), f64>,
}

// ---------------- lexicographic LP engine ----------------
#[derive(Clone)]
struct Lp {
    failed: usize, // tie-break stages lexi had to give up on
    nvars: usize,
    bounds: Vec<(f64, f64)>,
    cons: Vec<(Vec<(usize, f64)>, ComparisonOp, f64)>,
}
impl Lp {
    fn var(&mut self, lo: f64, hi: f64) -> usize {
        self.bounds.push((lo, hi));
        self.nvars += 1;
        self.nvars - 1
    }
    fn solve(&self, obj: &[(usize, f64)]) -> Result<Vec<f64>, String> {
        let mut c = vec![0.0; self.nvars];
        for (v, w) in obj {
            c[*v] += *w;
        }
        let mut p = Problem::new(OptimizationDirection::Minimize);
        let vars: Vec<Variable> = (0..self.nvars).map(|i| p.add_var(c[i], self.bounds[i])).collect();
        for (e, op, rhs) in &self.cons {
            let ex: Vec<(Variable, f64)> = e.iter().map(|(i, w)| (vars[*i], *w)).collect();
            p.add_constraint(ex.as_slice(), *op, *rhs);
        }
        let sol = p.solve().map_err(|e| format!("{e}"))?;
        Ok(vars.iter().map(|v| sol[*v]).collect())
    }
    /// Minimise each objective in turn, keeping earlier optima (within tolerance).
    fn lexi(&mut self, stages: &[Vec<(usize, f64)>]) -> Result<Vec<f64>, String> {
        let mut last: Option<Vec<f64>> = None;
        // (objective, optimum) of every stage fixed so far, so their tolerances can be relaxed on trouble
        let mut fixed: Vec<(Vec<(usize, f64)>, f64)> = Vec::new();
        let base = self.cons.len();
        for (k, obj) in stages.iter().enumerate() {
            if obj.is_empty() {
                continue;
            }
            let mut got = None;
            // microlp occasionally reports a numerically tight problem as infeasible: relax the earlier
            // optima a little and retry before giving up on this tie-break stage
            for rel in [1e-9, 1e-7, 1e-5] {
                self.cons.truncate(base);
                for (o, val) in &fixed {
                    let tol = if val.abs() < 1e-9 && rel <= 1e-9 { 0.0 } else { rel * val.abs().max(1.0) };
                    self.cons.push((o.clone(), ComparisonOp::Le, *val + tol));
                }
                match self.solve(obj) {
                    Ok(v) => {
                        got = Some(v);
                        break;
                    }
                    Err(e) if k == 0 || last.is_none() => return Err(e),
                    Err(e) => {
                        if std::env::var("PP_DEBUG").is_ok() {
                            eprintln!("lexi stage {k} failed at rel {rel}: {e}");
                        }
                    }
                }
            }
            let Some(v) = got else {
                self.failed += 1;
                break;
            };
            let val: f64 = obj.iter().map(|(i, w)| v[*i] * w).sum();
            fixed.push((obj.clone(), val));
            last = Some(v);
        }
        match last {
            Some(v) => Ok(v),
            None => self.solve(&[]),
        }
    }
}

struct Ctx<'a> {
    req: &'a SolveReq,
    models: &'a [NodeModel],
    links: &'a [&'a LinkReq],
    supply: &'a [bool],
    cap: std::cell::Cell<f64>, // upper bound on supply-node machine counts in the supply pass
}
struct Built {
    lp: Lp,
    xs: Vec<usize>,
    fv: Vec<usize>,
    slack: Vec<((usize, bool, String), usize)>,
    over: Vec<((usize, String), usize)>,
}
fn prio(l: &LinkReq) -> u8 {
    l.priority.unwrap_or(1).clamp(1, 3)
}
const MAXP: u8 = 3;
impl<'a> Ctx<'a> {
    /// `prev` = phase-A solution when building phase B: non-supply node sizes and primary flows into
    /// non-supply nodes are frozen, so secondary supply can only add on top.
    fn build(&self, prev: Option<&LpSol>, msgs: &mut Vec<String>) -> Built {
        let mut lp = Lp { failed: 0, nvars: 0, bounds: vec![], cons: vec![] };
        let n = self.req.nodes.len();
        let idx: HashMap<&str, usize> = self.req.nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
        let xs: Vec<usize> = (0..n).map(|_| lp.var(0.0, f64::INFINITY)).collect();
        let fv: Vec<usize> = self
            .links
            .iter()
            .enumerate()
            .map(|(li, l)| {
                let to_supply = idx.get(l.to.node.as_str()).map(|i| self.supply[*i]).unwrap_or(false);
                match prev {
                    // demand pass: only primary links carry demand
                    None if prio(l) >= 2 => lp.var(0.0, 0.0),
                    Some(p) if prio(l) == 1 && !to_supply => {
                        let v = p.f[li].max(0.0);
                        let e = 1e-9 * v.max(1.0);
                        lp.var((v - e).max(0.0), v + e)
                    }
                    _ => lp.var(0.0, f64::INFINITY),
                }
            })
            .collect();
        let mut slack = Vec::new();
        let mut over = Vec::new();
        for (ni, m) in self.models.iter().enumerate() {
            let nid = &self.req.nodes[ni].id;
            for (dir_in, ports) in [(true, &m.ins), (false, &m.outs)] {
                for (item, per) in ports.iter() {
                    let pl: Vec<(&&LinkReq, usize)> = self
                        .links
                        .iter()
                        .zip(fv.iter())
                        .filter(|(l, _)| if dir_in { &l.to.node == nid && &l.to.item == item } else { &l.from.node == nid && &l.from.item == item })
                        .map(|(l, v)| (l, *v))
                        .collect();
                    if pl.is_empty() {
                        continue;
                    }
                    // supply-mode nodes may not "import" missing input: they only use what arrives
                    let hi = if dir_in && self.supply[ni] { 0.0 } else { f64::INFINITY };
                    let s = lp.var(0.0, hi);
                    slack.push(((ni, dir_in, item.clone()), s));
                    let mut e: Vec<(usize, f64)> = pl.iter().map(|(_, v)| (*v, 1.0)).collect();
                    e.push((s, 1.0));
                    e.push((xs[ni], -per));
                    if dir_in && !self.supply[ni] && pl.iter().any(|(l, _)| prio(l) >= 2) {
                        let o = lp.var(0.0, if prev.is_some() { f64::INFINITY } else { 0.0 });
                        over.push(((ni, item.clone()), o));
                        e.push((o, -1.0));
                    }
                    lp.cons.push((e, ComparisonOp::Eq, 0.0));
                }
            }
            if m.err.is_some() && m.ins.is_empty() && m.outs.is_empty() {
                lp.cons.push((vec![(xs[ni], 1.0)], ComparisonOp::Eq, 0.0));
            }
        }
        for (ni, node) in self.req.nodes.iter().enumerate() {
            let m = &self.models[ni];
            if self.supply[ni] {
                let has_linked_in = m.ins.iter().any(|(it, _)| self.links.iter().any(|l| l.to.node == node.id && &l.to.item == it));
                // demand pass: supply nodes already run on what reaches them over primary links (the
                // "waste" stage below makes them eat it), so their output can cut what others must make
                if !has_linked_in {
                    if prev.is_some() && m.special.is_none() {
                        msgs.push(format!("supply-mode node {} has no linked input", node.id));
                    }
                    lp.cons.push((vec![(xs[ni], 1.0)], ComparisonOp::Eq, 0.0));
                } else if prev.is_some() {
                    lp.bounds[xs[ni]].1 = self.cap.get(); // safety against loops with gain > 1
                }
                continue;
            }
            if let Some(p) = prev {
                let v = p.x[ni].max(0.0);
                let e = 1e-9 * v.max(1.0); // frozen, with a hair of slack so microlp stays feasible
                lp.bounds[xs[ni]] = ((v - e).max(0.0), v + e);
                continue;
            }
            if m.special.as_deref() == Some("source") || (m.special.is_some() && node.target.as_ref().map_or(true, |t| t.kind != "rate")) {
                continue;
            }
            let Some(t) = &node.target else { continue };
            if !(t.value.is_finite() && t.value >= 0.0) {
                continue;
            }
            match t.kind.as_str() {
                "machines" => lp.cons.push((vec![(xs[ni], 1.0)], ComparisonOp::Eq, t.value)),
                "rate" => {
                    let item = t.item.clone().or_else(|| m.outs.first().or(m.ins.first()).map(|x| x.0.clone()));
                    let Some(item) = item else { continue };
                    let per = m.outs.iter().chain(m.ins.iter()).find(|(n, _)| *n == item).map(|x| x.1);
                    match per {
                        Some(per) if per > 0.0 => lp.cons.push((vec![(xs[ni], per)], ComparisonOp::Eq, t.value)),
                        _ => msgs.push(format!("target item {item} not produced by node {}", node.id)),
                    }
                }
                _ => {}
            }
        }
        Built { lp, xs, fv, slack, over }
    }
    fn deficits(&self, b: &Built) -> Vec<(usize, f64)> {
        b.slack.iter().filter(|((_, d, _), _)| *d).map(|(_, v)| (*v, 1.0)).collect()
    }
    fn prio_flows(&self, b: &Built, k: u8, sign: f64, only_into_supply: bool) -> Vec<(usize, f64)> {
        let idx: HashMap<&str, usize> = self.req.nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
        self.links
            .iter()
            .zip(b.fv.iter())
            .filter(|(l, _)| prio(l) == k && (!only_into_supply || idx.get(l.to.node.as_str()).map(|i| self.supply[*i]).unwrap_or(false)))
            .map(|(_, v)| (*v, sign))
            .collect()
    }
    fn finish(&self, b: &Built, v: Vec<f64>) -> LpSol {
        LpSol {
            x: b.xs.iter().map(|i| v[*i]).collect(),
            f: b.fv.iter().map(|i| v[*i]).collect(),
            slack: b.slack.iter().map(|(k, i)| (k.clone(), v[*i])).collect(),
            over: b.over.iter().map(|(k, i)| (k.clone(), v[*i])).collect(),
        }
    }
    /// demand pass: targets are met through PRIMARY links only:
    /// 1) meet demand (min deficits) 2) fewest machines (pull sizing), tiny cost on infinite sources / surplus
    fn phase_a(&self, msgs: &mut Vec<String>) -> Result<LpSol, String> {
        let mut b = self.build(None, msgs);
        let mut size: Vec<(usize, f64)> = Vec::new();
        for (i, m) in self.models.iter().enumerate() {
            let w = match m.special.as_deref() {
                Some("source") => 1e-3,
                Some(_) => 0.0,
                None => 1.0,
            };
            if w > 0.0 {
                size.push((b.xs[i], w));
            }
        }
        for ((_, d, _), v) in &b.slack {
            if !*d {
                size.push((*v, 1e-3));
            }
        }
        // "use what you linked": output that has a primary link should be consumed, not wasted, before
        // minimising machine count (lets byproduct recycles / supply-mode recyclers reduce upstream demand)
        let waste: Vec<(usize, f64)> = b
            .slack
            .iter()
            .filter(|((ni, d, item), _)| {
                !*d && self.links.iter().any(|l| {
                    prio(l) == 1
                        && l.from.node == self.req.nodes[*ni].id
                        && &l.from.item == item
                        && self.req.nodes.iter().position(|x| x.id == l.to.node).map_or(false, |t| self.supply[t])
                })
            })
            .map(|(_, v)| (*v, 1.0))
            .collect();
        // then fewest raw resources: infinite-source draw + unlinked (imported) inputs, so a linked recycle
        // of a byproduct is preferred over making more from scratch; machine count only breaks ties
        let mut raw: Vec<(usize, f64)> = Vec::new();
        for (i, m) in self.models.iter().enumerate() {
            let nid = &self.req.nodes[i].id;
            match m.special.as_deref() {
                Some("source") => raw.push((b.xs[i], 1.0)),
                Some(_) => {}
                None => {
                    let w: f64 = m.ins.iter().filter(|(it, _)| !self.links.iter().any(|l| &l.to.node == nid && &l.to.item == it)).map(|(_, p)| *p).sum();
                    if w > 0.0 {
                        raw.push((b.xs[i], w));
                    }
                }
            }
        }
        let stages = vec![self.deficits(&b), waste, raw, size];
        let v = b.lp.lexi(&stages).map_err(|e| format!("solver failed: {e} (conflicting targets?)"))?;
        Ok(self.finish(&b, v))
    }
    /// supply pass: demand sizes + primary flows frozen. Supply-mode nodes run on what reaches their
    /// inputs (primary links first), then secondary/tertiary links push leftovers on top of demand:
    /// first into any remaining shortfall, the rest shows up as excess (over-production).
    fn phase_b(&self, a: &LpSol, msgs: &mut Vec<String>) -> Result<LpSol, String> {
        let b = self.build(Some(a), msgs);
        let mut stages = vec![self.deficits(&b)];
        for k in 1..=MAXP {
            stages.push(self.prio_flows(&b, k, -1.0, true));
        }
        stages.push(self.supply.iter().enumerate().filter(|(_, s)| **s).map(|(i, _)| (b.xs[i], -1.0)).collect());
        for k in 2..=MAXP {
            stages.push(self.prio_flows(&b, k, -1.0, false));
        }
        // microlp is touchy: unbounded supply nodes first (a gain loop just stops that stage), finite caps
        // only if a stage fails numerically; keep the attempt with the fewest abandoned stages
        let mut best: Option<(usize, LpSol)> = None;
        let mut err = String::new();
        for cap in [f64::INFINITY, 1e7, 1e4] {
            self.cap.set(cap);
            let mut b = self.build(Some(a), &mut Vec::new());
            match b.lp.lexi(&stages) {
                Ok(v) => {
                    let f = b.lp.failed;
                    if best.as_ref().map_or(true, |(bf, _)| f < *bf) {
                        best = Some((f, self.finish(&b, v)));
                    }
                    if f == 0 {
                        break;
                    }
                }
                Err(e) => err = e,
            }
        }
        self.cap.set(f64::INFINITY);
        best.map(|x| x.1).ok_or_else(|| format!("solver failed in supply pass: {err}"))
    }
}

impl<'a> Ctx<'a> {
    /// Potential layer (additive, base untouched): the over-supply that secondary/tertiary links deliver on
    /// top of demand could run the receiving node harder. Extra machines y_n are limited by every LINKED input
    /// (only over-supply or extra flowing in from upstream potential counts); unlinked inputs are imports and
    /// assumed unlimited. Extra output then flows on through links to consumers, which may run extra too.
    fn potential(&self, base: &LpSol, _msgs: &mut Vec<String>) -> Potential {
        let n = self.req.nodes.len();
        let linked_in = |ni: usize, item: &str| self.links.iter().any(|l| l.to.node == self.req.nodes[ni].id && l.to.item == item);
        let idx: HashMap<&str, usize> = self.req.nodes.iter().enumerate().map(|(i, nd)| (nd.id.as_str(), i)).collect();
        let over = |ni: usize, item: &str| base.over.get(&(ni, item.to_string())).copied().unwrap_or(0.0).max(0.0);
        // "driven" nodes: receive over-supply, or (transitively) extra output from a driven node
        let mut driven = vec![false; n];
        for (ni, m) in self.models.iter().enumerate() {
            driven[ni] = m.ins.iter().any(|(it, _)| over(ni, it) > 1e-9);
        }
        loop {
            let mut ch = false;
            for l in self.links.iter() {
                if let (Some(&a), Some(&b)) = (idx.get(l.from.node.as_str()), idx.get(l.to.node.as_str())) {
                    if driven[a] && !driven[b] && self.models[b].err.is_none() {
                        driven[b] = true;
                        ch = true;
                    }
                }
            }
            if !ch {
                break;
            }
        }
        // a driving port carries the extra (over-supply or links from driven nodes); helpers (non-driven
        // upstream nodes, which can scale on their own imports) may only top up the other inputs
        let driving = |ni: usize, item: &str| {
            over(ni, item) > 1e-9
                || self.links.iter().any(|l| {
                    l.to.node == self.req.nodes[ni].id && l.to.item == item && idx.get(l.from.node.as_str()).map_or(false, |&a| driven[a])
                })
        };
        let build = |allow_helpers: bool| {
        let mut lp = Lp { failed: 0, nvars: 0, bounds: vec![], cons: vec![] };
        let ys: Vec<usize> = (0..n)
            .map(|ni| {
                let m = &self.models[ni];
                let ok = m.err.is_none() && m.special.as_deref() != Some("source");
                lp.var(0.0, if ok { f64::INFINITY } else { 0.0 })
            })
            .collect();
        let gs: Vec<usize> = self
            .links
            .iter()
            .map(|l| {
                let blocked = match (idx.get(l.from.node.as_str()), idx.get(l.to.node.as_str())) {
                    (Some(&a), Some(&b)) => !driven[a] && (driving(b, &l.to.item) || (!allow_helpers && driven[b])),
                    _ => true,
                };
                lp.var(0.0, if blocked { 0.0 } else { f64::INFINITY })
            })
            .collect();
        let mut in_rows: Vec<(usize, String, f64, Vec<usize>)> = Vec::new();
        for (ni, m) in self.models.iter().enumerate() {
            let nid = &self.req.nodes[ni].id;
            for (item, per) in &m.ins {
                if !linked_in(ni, item) {
                    continue;
                }
                let gl: Vec<usize> = self.links.iter().zip(gs.iter()).filter(|(l, _)| &l.to.node == nid && &l.to.item == item).map(|x| *x.1).collect();
                // per*y <= over + sum(g_in)
                let mut e: Vec<(usize, f64)> = gl.iter().map(|g| (*g, -1.0)).collect();
                e.push((ys[ni], *per));
                let o = over(ni, item);
                lp.cons.push((e, ComparisonOp::Le, o));
                in_rows.push((ni, item.clone(), o, gl));
            }
            for (item, per) in &m.outs {
                let gl: Vec<usize> = self.links.iter().zip(gs.iter()).filter(|(l, _)| &l.from.node == nid && &l.from.item == item).map(|x| *x.1).collect();
                // infinite sources can hand out any extra; everything else only what its extra machines make
                if gl.is_empty() || m.special.as_deref() == Some("source") {
                    continue;
                }
                let mut e: Vec<(usize, f64)> = gl.iter().map(|g| (*g, 1.0)).collect();
                e.push((ys[ni], -per));
                lp.cons.push((e, ComparisonOp::Le, 0.0));
            }
        }
        let stages = vec![
            (0..n).filter(|i| driven[*i]).map(|i| (ys[i], -1.0)).collect::<Vec<_>>(),
            (0..n).filter(|i| !driven[*i]).map(|i| (ys[i], 1.0)).collect::<Vec<_>>(),
            gs.iter().map(|g| (*g, 1.0)).collect::<Vec<_>>(),
        ];
        (lp, ys, gs, in_rows, stages)
        };
        if !driven.iter().any(|d| *d) {
            return Potential::default();
        }
        // 1) helpers may scale up to feed driven nodes' other inputs; 2) if that is unbounded (a loop that
        // can feed itself from imports) only over-supply/driven extra may feed driven nodes; 3) microlp is
        // touchy with big finite bounds, so caps on machine counts are the last resort
        let mut chosen = build(true);
        let mut res = chosen.0.clone().lexi(&chosen.4);
        if res.is_err() {
            chosen = build(false);
            res = chosen.0.clone().lexi(&chosen.4);
            if res.is_ok() {
                _msgs.push("potential: a loop could run unbounded on imports; helpers ignored".into());
            }
        }
        for cap in [1e4, 1e2] {
            if res.is_ok() {
                break;
            }
            let mut l2 = chosen.0.clone();
            for y in &chosen.1 {
                if l2.bounds[*y].1 > 0.0 {
                    l2.bounds[*y].1 = cap;
                }
            }
            res = l2.lexi(&chosen.4);
        }
        let (_, ys, gs, in_rows, _) = chosen;
        let v = match res {
            Ok(v) => v,
            Err(e) => {
                eprintln!("potential LP failed: {e}");
                return Potential::default();
            }
        };
        let cl = |x: f64| if x.abs() < 1e-7 { 0.0 } else { x };
        let mut pot = Potential { note: _msgs.join("; "), ..Default::default() };
        for (li, l) in self.links.iter().enumerate() {
            let g = cl(v[gs[li]]);
            if g > 0.0 {
                pot.links.insert(l.id.clone(), g);
            }
        }
        for (ni, m) in self.models.iter().enumerate() {
            let y = cl(v[ys[ni]]);
            let nid = &self.req.nodes[ni].id;
            let mut pn = PotNode { extra_machines: y, helper: !driven[ni], ..Default::default() };
            let mut got_extra = false;
            for (ri, item, o, gl) in in_rows.iter().filter(|r| r.0 == ni).map(|r| (r.0, &r.1, r.2, &r.3)) {
                let _ = ri;
                let per = m.ins.iter().find(|(i, _)| i == item).map(|x| x.1).unwrap_or(0.0);
                let avail = o + gl.iter().map(|g| v[*g]).sum::<f64>();
                if avail > 1e-7 {
                    got_extra = true;
                }
                let left = cl(avail - per * y);
                if left > 1e-6 * avail.max(1.0) {
                    pn.unused_supply.insert(item.clone(), left);
                } else {
                    pn.limit.push(item.clone()); // tight: this input caps the extra
                }
            }
            if !got_extra && y == 0.0 {
                continue;
            }
            if pn.unused_supply.is_empty() {
                pn.limit.clear(); // everything that arrived got used: nothing is "limiting"
            }
            for (item, per) in &m.ins {
                if per * y > 1e-9 {
                    pn.inputs.insert(item.clone(), per * y);
                    if !linked_in(ni, item) {
                        *pot.inputs.entry(item.clone()).or_insert(0.0) += per * y;
                    }
                }
            }
            for (item, per) in &m.outs {
                let ex = per * y;
                if ex <= 1e-9 {
                    continue;
                }
                pn.outputs.insert(item.clone(), ex);
                let sent: f64 = self.links.iter().zip(gs.iter()).filter(|(l, _)| &l.from.node == nid && &l.from.item == item).map(|(_, g)| v[*g]).sum();
                let rest = cl(ex - sent);
                if rest > 1e-6 * ex.max(1.0) && m.special.is_none() {
                    *pot.outputs.entry(item.clone()).or_insert(0.0) += rest;
                }
            }
            if m.special.is_none() {
                pot.machines += y;
            }
            pot.nodes.insert(nid.clone(), pn);
        }
        pot
    }
}
