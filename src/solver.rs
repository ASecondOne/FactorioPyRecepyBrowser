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
    pub from: PortRef,
    pub to: PortRef,
}
#[derive(Deserialize)]
pub struct SolveReq {
    pub nodes: Vec<NodeReq>,
    pub links: Vec<LinkReq>,
}

// ---------- response ----------
#[derive(Serialize, Default)]
pub struct PortOut {
    pub item: String,
    pub rate: f64,       // total rate at solved machine count (items/s)
    pub per_machine: f64,
    pub linked: bool,
    pub slack: f64, // surplus for outputs, deficit for inputs
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

pub fn solve(ds: &Dataset, req: &SolveReq) -> SolveResp {
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
    let consume: Vec<bool> = req
        .nodes
        .iter()
        .zip(models.iter())
        .map(|(n, m)| m.special.as_deref() == Some("sink") || n.target.as_ref().map(|t| t.kind == "consume").unwrap_or(false))
        .collect();
    let has_target = req.nodes.iter().any(|n| n.target.as_ref().map(|t| t.kind != "consume").unwrap_or(false));

    // phase 1: normal solve, "consume" nodes act like untargeted nodes
    let ph1 = match run_lp(req, &models, &valid_links, None, &mut msgs) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    // phase 2: freeze everything else, let "consume" nodes eat the leftovers
    let sol = if consume.iter().any(|c| *c) {
        let fixed: Vec<Option<f64>> = (0..req.nodes.len()).map(|i| if consume[i] { None } else { Some(ph1.x[i]) }).collect();
        let mut m2 = Vec::new();
        match run_lp(req, &models, &valid_links, Some(&fixed), &mut m2) {
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
    let clean = |v: f64| if v.abs() < 1e-9 { 0.0 } else { v };

    let mut raw_inputs = BTreeMap::new();
    let mut outputs = BTreeMap::new();
    let mut deficits = BTreeMap::new();
    let mut total_power = 0.0;
    let mut total_machines = 0.0;
    let mut fuel_power = 0.0;
    let mut sources = BTreeMap::new();
    let mut sinks = BTreeMap::new();
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
            ..Default::default()
        };
        for (item, per) in &m.ins {
            let sv = sol.slack.get(&(ni, true, item.clone()));
            let slack = sv.map(|v| clean(*v)).unwrap_or(0.0);
            let rate = per * x;
            if m.special.is_some() {
            } else if sv.is_none() {
                *raw_inputs.entry(item.clone()).or_insert(0.0) += rate;
            } else if slack > 1e-9 {
                *deficits.entry(item.clone()).or_insert(0.0) += slack;
                *raw_inputs.entry(item.clone()).or_insert(0.0) += slack;
            }
            no.inputs.push(PortOut { item: item.clone(), rate, per_machine: *per, linked: sv.is_some(), slack });
        }
        for (item, per) in &m.outs {
            let sv = sol.slack.get(&(ni, false, item.clone()));
            let slack = sv.map(|v| clean(*v)).unwrap_or(0.0);
            let rate = per * x;
            let free = if sv.is_none() { rate } else { slack };
            if free > 1e-9 && m.special.is_none() {
                *outputs.entry(item.clone()).or_insert(0.0) += free;
            }
            no.outputs.push(PortOut { item: item.clone(), rate, per_machine: *per, linked: sv.is_some(), slack });
        }
        nodes_out.push(no);
    }
    // net: an item that is both imported and exported externally -> keep both but it's informative
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
    }
}

struct LpSol {
    x: Vec<f64>,
    f: Vec<f64>,
    slack: HashMap<(usize, bool, String), f64>,
}

fn run_lp(req: &SolveReq, models: &[NodeModel], links: &[&LinkReq], fixed: Option<&[Option<f64>]>, msgs: &mut Vec<String>) -> Result<LpSol, String> {
    const DEFICIT_COST: f64 = 1e6;
    const SURPLUS_COST: f64 = 1e-3;
    let mut p = Problem::new(OptimizationDirection::Minimize);
    let xs: Vec<Variable> = (0..req.nodes.len())
        .map(|i| {
            let sp = models[i].special.as_deref();
            let c = match fixed {
                Some(fx) if fx[i].is_none() => -1.0, // phase 2: maximise "consume"/sink nodes
                Some(_) => 0.0,
                None => match sp {
                    Some("source") => 1e-3, // per unit/s drawn
                    Some("sink") => 0.0,
                    _ => 1.0,
                },
            };
            p.add_var(c, (0.0, f64::INFINITY))
        })
        .collect();
    let fv: Vec<Variable> = links.iter().map(|_| p.add_var(0.0, (0.0, f64::INFINITY))).collect();
    let mut slack_vars: Vec<((usize, bool, String), Variable)> = Vec::new();
    for (ni, m) in models.iter().enumerate() {
        let nid = &req.nodes[ni].id;
        for (dir_in, ports) in [(true, &m.ins), (false, &m.outs)] {
            for (item, per) in ports.iter() {
                let ls: Vec<Variable> = links
                    .iter()
                    .zip(fv.iter())
                    .filter(|(l, _)| if dir_in { &l.to.node == nid && &l.to.item == item } else { &l.from.node == nid && &l.from.item == item })
                    .map(|x| *x.1)
                    .collect();
                if ls.is_empty() {
                    continue;
                }
                let s = p.add_var(if dir_in { DEFICIT_COST } else { SURPLUS_COST }, (0.0, f64::INFINITY));
                slack_vars.push(((ni, dir_in, item.clone()), s));
                let mut expr: Vec<(Variable, f64)> = ls.iter().map(|v| (*v, 1.0)).collect();
                expr.push((s, 1.0));
                expr.push((xs[ni], -per));
                p.add_constraint(expr.as_slice(), ComparisonOp::Eq, 0.0);
            }
        }
        if m.err.is_some() && m.ins.is_empty() && m.outs.is_empty() {
            p.add_constraint(&[(xs[ni], 1.0)], ComparisonOp::Eq, 0.0);
        }
    }
    for (ni, n) in req.nodes.iter().enumerate() {
        if models[ni].special.is_some() && fixed.is_none() {
            continue; // sources/sinks have no targets
        }
        if let Some(fx) = fixed {
            if let Some(v) = fx[ni] {
                p.add_constraint(&[(xs[ni], 1.0)], ComparisonOp::Eq, v);
            } else if !models[ni].ins.iter().any(|(it, _)| links.iter().any(|l| &l.to.node == &n.id && &l.to.item == it)) {
                if models[ni].special.is_none() {
                    msgs.push(format!("'consume' node {} has no linked input", n.id));
                }
                p.add_constraint(&[(xs[ni], 1.0)], ComparisonOp::Eq, 0.0);
            }
            continue;
        }
        let Some(t) = &n.target else { continue };
        if !(t.value.is_finite() && t.value >= 0.0) {
            continue;
        }
        match t.kind.as_str() {
            "consume" => {}
            "machines" => p.add_constraint(&[(xs[ni], 1.0)], ComparisonOp::Eq, t.value),
            _ => {
                let item = t.item.clone().or_else(|| models[ni].outs.first().map(|x| x.0.clone()));
                let Some(item) = item else { continue };
                let per = models[ni].outs.iter().chain(models[ni].ins.iter()).find(|(n, _)| *n == item).map(|x| x.1);
                match per {
                    Some(per) if per > 0.0 => p.add_constraint(&[(xs[ni], per)], ComparisonOp::Eq, t.value),
                    _ => msgs.push(format!("target item {item} not produced by node {}", n.id)),
                }
            }
        }
    }
    let sol = p.solve().map_err(|e| format!("solver failed: {e} (conflicting targets?)"))?;
    Ok(LpSol {
        x: xs.iter().map(|v| sol[*v]).collect(),
        f: fv.iter().map(|v| sol[*v]).collect(),
        slack: slack_vars.into_iter().map(|(k, v)| (k, sol[v])).collect(),
    })
}
