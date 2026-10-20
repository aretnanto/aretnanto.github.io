// ---- Neighbours page: block groups as a network ----
// Nodes are block groups; two are joined when their boundaries share a line
// (rook contiguity, network_prep.py). Two analyses run on that network:
//   * Hot spots, local Moran's I (Anselin 1995, "Local indicators of spatial
//     association - LISA"): each block group's value (z-score) against the
//     mean of its neighbours (row-standardised weights). High-High and
//     Low-Low are clusters; High-Low and Low-High are outliers. Significance
//     by conditional permutation (999 random neighbour sets, seeded).
//   * Regions, SKATER (Assunção et al. 2006, "Efficient regionalization
//     techniques for socio-economic geographical units using minimum spanning
//     trees"): weight each edge by the distance between the two block groups'
//     indicator profiles, keep the minimum spanning tree, then repeatedly cut
//     the edge that most reduces the within-region sum of squares, so every
//     region stays connected.
// Both use the ACS release chosen here (shared with the dashboard).
const NB_EDGES = window.ADJACENCY.edges;
const NB_NEI = d3.range(NBG).map(() => []);
NB_EDGES.forEach(([i, j]) => { NB_NEI[i].push(j); NB_NEI[j].push(i); });

const nbState = { mode: "lisa", show: "poly", tool: "pan", v: "TEPI", alpha: 0.05, k: 6, min: 10, vars: [...INDICATORS], focus: null, pick: null };
const NB_PERMS = 999;
const LISA_CLASS = [
  { key: "HH", label: "High–High (hot spot)", color: "#d7191c" },
  { key: "LL", label: "Low–Low (cold spot)", color: "#2c7bb6" },
  { key: "HL", label: "High among low (outlier)", color: "#fdae61" },
  { key: "LH", label: "Low among high (outlier)", color: "#abd9e9" },
  { key: "ns", label: "Not significant", color: "#e6e5e0" },
];
const LISA_COLOR = Object.fromEntries(LISA_CLASS.map(c => [c.key, c.color]));
const REGION_COLORS = [...d3.schemeTableau10, "#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e"];
const nbRel = y => relName(y).replace(/^ACS /, "");

// value of a variable for block group i in release y
const nbValue = (key, y, i) => (key === "TEPI" ? TEPI_YEARS[y][i] : MAP.census.value[key][y][i]);
const nbVarLabel = k => (k === "TEPI" ? "TEPI percentile" : k);

// seeded random numbers, so the permutation test gives the same answer each run
function nbRandom(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- Local Moran's I ----
// This page compares decades: 1990, 2000 (censuses), 2009-13 (the first ACS
// block-group release, ~2010) and 2019-23 (~2020, the release TEPI uses).
// Ten years apart, the snapshots share no survey years.
const NB_YEARS = [1990, 2000, 2013, 2023].filter(y => YEARS.includes(y));
const nbDecade = y => ({ 1990: "1990", 2000: "2000", 2013: "2010", 2023: "2020" }[y] || relShort(y));
// Each (variable, release, significance) is computed once and cached.
const nbLisaCache = new Map();
function runLisa(key, y) {
  const ck = `${key}|${y}|${nbState.alpha}`;
  if (!nbLisaCache.has(ck)) nbLisaCache.set(ck, lisaCompute(key, y));
  return nbLisaCache.get(ck);
}
function lisaCompute(key, y) {
  const x = d3.range(NBG).map(i => nbValue(key, y, i));
  const ok = d3.range(NBG).filter(i => x[i] != null);
  if (ok.length < 3) return { key, y, out: d3.range(NBG).map(() => ({ z: null, lag: null, I: null, p: null, cls: "ns" })), globalI: NaN, n: 0 }; // not measured this release
  const mean = d3.mean(ok, i => x[i]), sd = d3.deviation(ok, i => x[i]);
  const z = x.map(v => (v == null ? null : (v - mean) / sd));
  const nei = i => NB_NEI[i].filter(j => z[j] != null);
  const lag = z.map((v, i) => { const n = nei(i); return v == null || !n.length ? null : d3.mean(n, j => z[j]); });
  const rand = nbRandom(20261019);
  const zs = Float64Array.from(ok, i => z[i]), pos = new Map(ok.map((i, a) => [i, a])), nz = zs.length;
  const out = d3.range(NBG).map(i => {
    if (lag[i] == null) return { z: null, lag: null, I: null, p: null, cls: "ns" };
    const Ii = z[i] * lag[i], k = nei(i).length, self = pos.get(i);
    // conditional permutation: hold z_i, draw k other values at random
    // (from all values but its own: skip over its position)
    let extreme = 0;
    for (let r = 0; r < NB_PERMS; r++) {
      let s = 0;
      for (let m = 0; m < k; m++) { const a = Math.floor(rand() * (nz - 1)); s += zs[a >= self ? a + 1 : a]; }
      const Ip = z[i] * (s / k);
      if (Ii >= 0 ? Ip >= Ii : Ip <= Ii) extreme++;
    }
    const p = (extreme + 1) / (NB_PERMS + 1);
    const cls = p >= nbState.alpha ? "ns" : z[i] > 0 ? (lag[i] > 0 ? "HH" : "HL") : (lag[i] < 0 ? "LL" : "LH");
    return { z: z[i], lag: lag[i], I: Ii, p, cls };
  });
  // global Moran's I with row-standardised weights: sum(z * lag) / sum(z^2)
  const valid = ok.filter(i => lag[i] != null);
  const globalI = d3.sum(valid, i => z[i] * lag[i]) / d3.sum(valid, i => z[i] * z[i]);
  return { key, y, out, globalI, n: valid.length };
}

// ---- SKATER ----
function runSkater(vars, y, kMax, minSize) {
  // standardised indicator profiles; block groups missing any are left out
  const cols = vars.map(v => {
    const x = d3.range(NBG).map(i => MAP.census.value[v][y][i]);
    const ok = x.filter(a => a != null), m = d3.mean(ok), s = d3.deviation(ok) || 1;
    return x.map(a => (a == null ? null : (a - m) / s));
  });
  const vec = d3.range(NBG).map(i => (cols.some(c => c[i] == null) ? null : cols.map(c => c[i])));
  const inMod = i => vec[i] != null;
  const dist = (a, b) => Math.sqrt(d3.sum(vec[a], (v, d) => (v - vec[b][d]) ** 2));
  // minimum spanning tree (Kruskal) over the contiguity edges
  const parent = d3.range(NBG), find = a => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const tree = d3.range(NBG).map(() => new Set());
  NB_EDGES.filter(([i, j]) => inMod(i) && inMod(j)).map(([i, j]) => [i, j, dist(i, j)]).sort((a, b) => a[2] - b[2])
    .forEach(([i, j]) => { const a = find(i), b = find(j); if (a !== b) { parent[a] = b; tree[i].add(j); tree[j].add(i); } });
  const treeEdges = [];
  tree.forEach((s, i) => s.forEach(j => { if (i < j) treeEdges.push([i, j]); }));
  // regions = connected parts of the (cut) tree
  const label = () => {
    const reg = new Array(NBG).fill(null); let r = 0;
    d3.range(NBG).filter(inMod).forEach(s => {
      if (reg[s] != null) return;
      const stack = [s]; reg[s] = r;
      while (stack.length) { const u = stack.pop(); tree[u].forEach(v => { if (reg[v] == null) { reg[v] = r; stack.push(v); } }); }
      r++;
    });
    return { reg, n: r };
  };
  const ssd = ids => { if (!ids.length) return 0; const m = vars.map((_, d) => d3.mean(ids, i => vec[i][d])); return d3.sum(ids, i => d3.sum(vec[i], (v, d) => (v - m[d]) ** 2)); };
  const all = d3.range(NBG).filter(inMod), tss = ssd(all);
  const cuts = [], history = [];
  let { reg, n } = label();
  history.push({ k: n, ssd: d3.sum(d3.range(n), r => ssd(all.filter(i => reg[i] === r))) });
  while (n < kMax) {
    // best cut: for each tree edge, split its region in two and score the drop in SSD
    let best = null;
    for (let r = 0; r < n; r++) {
      const ids = all.filter(i => reg[i] === r);
      if (ids.length < 2 * minSize) continue;
      const base = ssd(ids);
      // root the region's tree, collect subtree sums in post-order
      const root = ids[0], order = [], par = new Map([[root, -1]]), stack = [root];
      while (stack.length) { const u = stack.pop(); order.push(u); tree[u].forEach(v => { if (!par.has(v)) { par.set(v, u); stack.push(v); } }); }
      const cnt = new Map(), sum = new Map(), sq = new Map();
      for (let o = order.length - 1; o >= 0; o--) {
        const u = order[o];
        let c = 1, s = vec[u].slice(), q = d3.sum(vec[u], v => v * v);
        tree[u].forEach(v => { if (par.get(v) === u) { c += cnt.get(v); sum.get(v).forEach((a, d) => (s[d] += a)); q += sq.get(v); } });
        cnt.set(u, c); sum.set(u, s); sq.set(u, q);
      }
      const N = cnt.get(root), S = sum.get(root), Q = sq.get(root);
      order.forEach(u => {
        const pu = par.get(u);
        if (pu < 0) return;
        const c1 = cnt.get(u), c2 = N - c1;
        if (c1 < minSize || c2 < minSize) return;
        const s1 = sum.get(u), s2 = S.map((a, d) => a - s1[d]);
        const q1 = sq.get(u), q2 = Q - q1;
        const after = q1 - d3.sum(s1, a => a * a) / c1 + q2 - d3.sum(s2, a => a * a) / c2;
        if (!best || base - after > best.gain) best = { gain: base - after, i: u, j: pu };
      });
    }
    if (!best) break; // no cut leaves both parts at the minimum size
    tree[best.i].delete(best.j); tree[best.j].delete(best.i);
    cuts.push([best.i, best.j]);
    ({ reg, n } = label());
    history.push({ k: n, ssd: d3.sum(d3.range(n), r => ssd(all.filter(i => reg[i] === r))) });
  }
  return { reg, n, cuts, treeEdges, history, tss, vec, vars, y };
}
// SKATER is greedy, so one run to the largest k gives every smaller k: the
// first k - 1 cuts. Cache the run and relabel for the chosen k.
let nbSkaterRun = null;
function skaterAt(k) {
  const R = nbSkaterRun, cut = new Set(R.cuts.slice(0, k - 1).map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  const tree = d3.range(NBG).map(() => []);
  R.treeEdges.forEach(([a, b]) => { if (!cut.has(`${a}-${b}`)) { tree[a].push(b); tree[b].push(a); } });
  const reg = new Array(NBG).fill(null); let n = 0;
  d3.range(NBG).filter(i => R.vec[i] != null).forEach(s => {
    if (reg[s] != null) return;
    const stack = [s]; reg[s] = n;
    while (stack.length) { const u = stack.pop(); tree[u].forEach(v => { if (reg[v] == null) { reg[v] = n; stack.push(v); } }); }
    n++;
  });
  // number regions by mean TEPI, highest first, so colours are stable as k changes
  const mt = d3.range(n).map(r => d3.mean(d3.range(NBG).filter(i => reg[i] === r), i => TEPI_YEARS[R.y][i]) ?? -1);
  const rank = d3.range(n).sort((a, b) => mt[b] - mt[a]), newId = new Map(rank.map((r, k2) => [r, k2]));
  return { reg: reg.map(r => (r == null ? null : newId.get(r))), n, cut };
}

// ---- Run and draw ----
let nbLisa = null, nbRegions = null;
function nbCompute() {
  const y = mapState.year;
  if (nbState.mode === "lisa") nbLisa = runLisa(nbState.v, y);
  else {
    if (!nbState.vars.length) { nbRegions = null; return; }
    nbSkaterRun = runSkater(nbState.vars, y, 15, nbState.min);
    nbRegions = skaterAt(nbState.k);
  }
}
const nbFill = i => {
  if (nbState.mode === "lisa") return LISA_COLOR[nbLisa.out[i].cls] || "#f3f2ee";
  if (!nbRegions || nbRegions.reg[i] == null) return "#f3f2ee";
  return REGION_COLORS[nbRegions.reg[i] % REGION_COLORS.length];
};

const nbSvg = d3.select("#nb-map");
let nbG, nbPath, nbCent;
function drawNbMap() {
  const box = nbSvg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height;
  nbSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  nbPath = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[10, 10], [W - 10, H - 10]], MAP.focus));
  nbCent = d3.range(NBG).map(i => nbPath.centroid(bgFeature(i)));
  nbSvg.append("rect").attr("width", W).attr("height", H).attr("fill", "var(--surface)").on("click", () => { nbState.focus = null; nbState.pick = null; updateNb(); });
  nbG = nbSvg.append("g");
  nbG.append("g").attr("class", "polys").selectAll("path").data(d3.range(NBG)).join("path").attr("class", "bg").attr("d", i => nbPath(bgFeature(i)))
    .on("mousemove", (e, i) => showTip(e, nbTip(i))).on("mouseleave", hideTip)
    .on("click", nbClick);
  nbG.append("g").attr("class", "edges").selectAll("line").data(NB_EDGES).join("line").attr("class", "edge")
    .attr("x1", e => nbCent[e[0]][0]).attr("y1", e => nbCent[e[0]][1]).attr("x2", e => nbCent[e[1]][0]).attr("y2", e => nbCent[e[1]][1]);
  const r = d3.scaleSqrt([0, d3.max(d3.range(NBG), popOf)], [0, 7]);
  nbG.append("g").attr("class", "nodes").selectAll("circle").data(d3.range(NBG)).join("circle").attr("class", "node")
    .attr("cx", i => nbCent[i][0]).attr("cy", i => nbCent[i][1]).attr("r", i => Math.max(1.5, r(popOf(i))))
    .on("mousemove", (e, i) => showTip(e, nbTip(i))).on("mouseleave", hideTip)
    .on("click", nbClick);
  const zoom = d3.zoom().scaleExtent([0.3, 20]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : nbState.tool === "pan"))
    .on("zoom", ({ transform }) => nbG.attr("transform", transform));
  nbSvg.call(zoom).on("dblclick.zoom", null);
  nbG.attr("transform", d3.zoomTransform(nbSvg.node()));
  d3.select("#nb-reset").on("click", () => nbSvg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
  // lasso in screen space; block groups are picked by centroid
  nbLasso(nbSvg, () => true, i => d3.zoomTransform(nbSvg.node()).apply(nbCent[i]), () => nbState.tool === "lasso");
  updateNbMap();
}
// Click: Shift-click adds to / removes from the active group (either tool);
// with the lasso tool a plain click selects; with pan, it shows the neighbours.
function nbClick(e, i) {
  e.stopPropagation();
  if (e.shiftKey || nbState.tool === "lasso") { clickBg(e, i); updateNb(); return; }
  nbState.focus = nbState.focus === i ? null : i; updateNb();
}
// Lasso on an svg: candidates come from ids(), positioned by pos(i) in screen space
function nbLasso(svg, keep, pos, active, ids = () => d3.range(NBG)) {
  const path = svg.append("path").attr("class", "lasso");
  let pts = [];
  svg.call(d3.drag().filter(e => active(e) && !e.button)
    .on("start", () => { pts = []; })
    .on("drag", e => { pts.push([e.x, e.y]); path.attr("d", "M" + pts.join("L") + "Z"); })
    .on("end", e => {
      path.attr("d", null);
      if (pts.length < 3) return;
      const s = e.sourceEvent.shiftKey ? new Set(mapState.groups[mapState.active]) : new Set();
      ids().filter(i => keep(i) && d3.polygonContains(pts, pos(i))).forEach(i => s.add(i));
      setGroup(mapState.active, s);
      nbState.focus = null; nbState.pick = null;
      updateNb();
    }));
}
// block groups highlighted by a click on the map, a scatter class, a region row or a group
const nbOn = i => {
  if (nbState.focus != null) return i === nbState.focus || NB_NEI[nbState.focus].includes(i);
  if (nbState.pick == null) return !anySelected() || !!groupOf(i);
  return nbState.mode === "lisa" ? nbLisa.out[i].cls === nbState.pick : nbRegions && nbRegions.reg[i] === nbState.pick;
};
function updateNbMap() {
  if (!nbG) return;
  const net = nbState.show === "net", sk = nbState.mode === "skater" && nbRegions;
  nbG.selectAll(".bg").attr("fill", i => (net ? "#f7f6f3" : nbFill(i))).classed("dim", i => !net && !nbOn(i)).classed("focus", i => i === nbState.focus)
    .classed("pickA", i => mapState.groups.A.has(i)).classed("pickB", i => mapState.groups.B.has(i));
  nbG.selectAll(".bg.pickA, .bg.pickB").raise();
  nbG.select(".nodes").attr("display", net ? null : "none").selectAll(".node").attr("fill", nbFill).classed("dim", i => !nbOn(i))
    .classed("pickA", i => mapState.groups.A.has(i)).classed("pickB", i => mapState.groups.B.has(i));
  nbSvg.classed("lasso-mode", nbState.tool === "lasso");
  nbSelSummary();
  nbG.select(".edges").attr("display", net || nbState.focus != null ? null : "none").selectAll(".edge")
    .attr("display", e => (net || e[0] === nbState.focus || e[1] === nbState.focus ? null : "none"))
    .classed("focus", e => e[0] === nbState.focus || e[1] === nbState.focus)
    .classed("tree", e => sk && nbSkaterRun.treeEdges.some(t => t[0] === e[0] && t[1] === e[1]) && !nbRegions.cut.has(`${e[0]}-${e[1]}`))
    .classed("cut", e => sk && nbRegions.cut.has(`${e[0]}-${e[1]}`));
  // legend
  const lg = d3.select("#nb-legend").html("");
  if (nbState.mode === "lisa") {
    lg.append("span").attr("class", "legend-title").text(`${nbVarLabel(nbState.v)}, ${relName(nbLisa.y)}:`);
    LISA_CLASS.forEach(c => lg.append("span").attr("class", "legend-item").html(`<span class="swatch" style="background:${c.color}"></span>${c.label} (${nbLisa.out.filter(o => o.cls === c.key).length})`));
  } else if (nbRegions) {
    lg.append("span").attr("class", "legend-title").text(`${nbRegions.n} regions (SKATER, ${nbState.vars.length} indicators, ${relName(nbSkaterRun.y)}), numbered by mean TEPI:`);
    if (net) lg.append("span").attr("class", "legend-item").html('<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#3d3c39" stroke-width="1.5"/></svg>spanning tree <svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#e8710a" stroke-width="2" stroke-dasharray="3 2"/></svg>cut');
  } else lg.append("span").attr("class", "legend-title").text("Choose at least one indicator");
  if (net) lg.append("span").attr("class", "legend-item").text("Node size = population");
  d3.select("#nb-map-title").text(net ? "The block-group network: nodes and shared borders" : "Block groups and their neighbours");
}
function nbTip(i) {
  const y = mapState.year, p = TEPI_YEARS[y][i];
  let h = `<strong>${bgLabel(i)}</strong> <span class="muted">· pop. ${d3.format(",")(popOf(i))} · ${NB_NEI[i].length} neighbours</span>` +
    `<br>TEPI (${relName(y)}): ${p == null ? "n/a" : `${d3.format(".0f")(p)} (${tierOf(p)})`}`;
  if (nbState.mode === "lisa" && nbLisa.out[i].z != null) {
    const o = nbLisa.out[i], v = nbValue(nbState.v, y, i), nm = d3.mean(NB_NEI[i].map(j => nbValue(nbState.v, y, j)).filter(a => a != null));
    const f = nbState.v === "TEPI" ? d3.format(".0f") : nbState.v === INCOME ? d3.format("$,.0f") : a => d3.format(".1f")(a) + "%";
    h += `<br>${nbVarLabel(nbState.v)}: <strong>${f(v)}</strong>; neighbours' mean ${f(nm)}` +
      `<br>Local Moran's I ${d3.format(".2f")(o.I)}, p = ${d3.format(".3f")(o.p)} · <strong>${LISA_CLASS.find(c => c.key === o.cls).label}</strong>`;
  } else if (nbState.mode === "skater" && nbRegions) h += nbRegions.reg[i] == null ? "<br>Not in a region (missing indicator)" : `<br>Region <strong>${nbRegions.reg[i] + 1}</strong>`;
  return h + `<br><span class="muted">Click to show its neighbours</span>`;
}

// ---- Top right: Moran scatterplot / region profiles ----
function drawNbTop() {
  const svg = d3.select("#nb-top"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  if (nbState.mode === "lisa") {
    d3.select("#nb-top-title").text(`Moran scatterplot: ${nbVarLabel(nbState.v)}`);
    d3.select("#nb-top-info").attr("title", "Each dot is a block group: x = its value, y = the mean of its neighbours (both in standard deviations from the county mean). The slope of the line is global Moran's I: above 0 means neighbours tend to be alike. Colour = local cluster class (significant at the chosen level). Click a quadrant label to show that class on the map.");
    const m = { l: 40, r: 12, t: 40, b: 30 };
    const pts = d3.range(NBG).filter(i => nbLisa.out[i].z != null);
    const ext = d3.max(pts, i => Math.max(Math.abs(nbLisa.out[i].z), Math.abs(nbLisa.out[i].lag))) * 1.05;
    const x = d3.scaleLinear([-ext, ext], [m.l, W - m.r]), y = d3.scaleLinear([-ext, ext], [H - m.b, m.t]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(5).tickSize(3));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${x(0)},0)`).call(d3.axisLeft(y).ticks(5).tickSize(3));
    svg.append("text").attr("class", "muted").attr("x", W - m.r).attr("y", H - 6).attr("text-anchor", "end").text("block group (z) →");
    svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", m.t - 8).text("↑ neighbours' mean (z)");
    svg.selectAll("circle").data(pts).join("circle").attr("class", "pt").attr("r", 2.6)
      .attr("cx", i => x(nbLisa.out[i].z)).attr("cy", i => y(nbLisa.out[i].lag)).attr("fill", i => LISA_COLOR[nbLisa.out[i].cls])
      .classed("dim", i => !nbOn(i)).classed("focus", i => i === nbState.focus)
      .classed("pickA", i => mapState.groups.A.has(i)).classed("pickB", i => mapState.groups.B.has(i))
      .on("mousemove", (e, i) => showTip(e, nbTip(i))).on("mouseleave", hideTip)
      .on("click", (e, i) => { if (e.shiftKey) { clickBg(e, i); updateNb(); return; } nbState.focus = nbState.focus === i ? null : i; updateNb(); });
    svg.selectAll(".pt.pickA, .pt.pickB").raise();
    // lasso points in the scatterplot into the active group
    nbLasso(svg, i => nbLisa.out[i].z != null, i => [x(nbLisa.out[i].z), y(nbLisa.out[i].lag)], () => true, () => pts);
    svg.append("line").attr("x1", x(-ext)).attr("x2", x(ext)).attr("y1", y(-ext * nbLisa.globalI)).attr("y2", y(ext * nbLisa.globalI)).attr("stroke", "#1f1f1f").attr("stroke-width", 1.2);
    [["HH", W - m.r - 4, m.t + 12, "end"], ["LL", m.l + 4, H - m.b - 6, "start"], ["HL", W - m.r - 4, H - m.b - 6, "end"], ["LH", m.l + 4, m.t + 12, "start"]].forEach(([k, qx, qy, a]) =>
      svg.append("text").attr("x", qx).attr("y", qy).attr("text-anchor", a).style("font-weight", 700).style("cursor", "pointer")
        .style("fill", d3.color(LISA_COLOR[k]).darker(0.6)).text(`${k} ${nbLisa.out.filter(o => o.cls === k).length}`)
        .on("click", () => { nbState.pick = nbState.pick === k ? null : k; nbState.focus = null; updateNb(); }));
    svg.append("text").attr("x", m.l).attr("y", 12).style("font-weight", 600)
      .text(`Global Moran's I = ${d3.format(".2f")(nbLisa.globalI)} (${nbLisa.n} block groups; 0 = no spatial pattern)`);
    return;
  }
  d3.select("#nb-top-title").text("Region profiles: mean of each indicator");
  d3.select("#nb-top-info").attr("title", "Rows: SKATER regions, numbered by mean TEPI (1 = highest). Cells: the region's mean of each indicator in standard deviations from the county mean (orange above, purple below). Right: residents by TEPI tier. Click a row to show the region on the map.");
  if (!nbRegions) return;
  const R = nbRegions, vars = nbState.vars, m = { l: 34, r: 150, t: 96, b: 6 };
  const rows = d3.range(R.n).map(r => {
    const ids = d3.range(NBG).filter(i => R.reg[i] === r), pop = d3.sum(ids, popOf);
    return { r, ids, pop, means: vars.map((_, d) => d3.mean(ids, i => nbSkaterRun.vec[i][d])),
      tiers: TIERS.map((_, t) => d3.sum(ids.filter(i => tierIdx(TEPI_YEARS[nbSkaterRun.y][i]) === t), popOf) / pop) };
  });
  const cw = Math.min(28, (W - m.l - m.r) / vars.length), rh = Math.min(24, (H - m.t - m.b) / rows.length);
  const col = d3.scaleDiverging([-1.5, 0, 1.5], t => d3.interpolatePuOr(1 - t)).clamp(true);
  vars.forEach((v, d) => svg.append("text").attr("class", "muted").attr("transform", `translate(${m.l + d * cw + cw / 2 + 3},${m.t - 4}) rotate(-60)`).text(v.length > 18 ? v.slice(0, 17) + "…" : v));
  svg.append("text").attr("class", "muted").attr("x", W - m.r + 8).attr("y", m.t - 6).text("residents by TEPI tier");
  const g = svg.append("g").selectAll("g").data(rows).join("g").attr("class", "row").classed("on", d => d.r === nbState.pick)
    .attr("transform", d => `translate(0,${m.t + d.r * rh})`)
    .on("click", (_, d) => { nbState.pick = nbState.pick === d.r ? null : d.r; nbState.focus = null; updateNb(); })
    .on("mousemove", (e, d) => showTip(e, `<strong>Region ${d.r + 1}</strong>: ${d.ids.length} block groups, ${d3.format(",")(d.pop)} people<br>` +
      vars.map((v, k) => `${v}: ${d3.format("+.1f")(d.means[k])} SD`).join("<br>") + `<br>${TIERS.map((n, t) => `${n} ${d3.format(".0%")(d.tiers[t])}`).join(" · ")}`))
    .on("mouseleave", hideTip);
  g.append("rect").attr("class", "row-bg").attr("width", W).attr("height", rh - 1).attr("fill", "transparent");
  g.append("rect").attr("x", 4).attr("y", rh / 2 - 6).attr("width", 12).attr("height", 12).attr("rx", 2).attr("fill", d => REGION_COLORS[d.r % REGION_COLORS.length]);
  g.append("text").attr("x", 20).attr("y", rh / 2 + 4).text(d => d.r + 1);
  g.selectAll("rect.cell").data(d => d.means).join("rect").attr("class", "cell").attr("x", (_, k) => m.l + k * cw).attr("width", cw - 1).attr("height", rh - 2).attr("fill", v => col(v));
  g.each(function (d) {
    let acc = 0; const bw = m.r - 16;
    d3.select(this).selectAll("rect.tier").data(d.tiers).join("rect").attr("class", "tier")
      .attr("x", v => { const x0 = W - m.r + 8 + acc * bw; acc += v; return x0; }).attr("y", 2).attr("width", v => Math.max(0, v * bw - 0.5)).attr("height", rh - 5).attr("fill", (_, t) => TIER_FILL(t));
  });
}

// ---- Bottom right: clusters by release / elbow chart ----
function drawNbBot() {
  const svg = d3.select("#nb-bot"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, m = { l: 44, r: 12, t: 22, b: 30 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  if (nbState.mode === "lisa") {
    d3.select("#nb-bot-title").text(`Hot spots by decade: ${nbVarLabel(nbState.v)}`);
    d3.select("#nb-bot-info").attr("title", "Local Moran's I run on each decade separately: 1990 and 2000 censuses, ACS 2009–13 (2010) and 2019–23 (2020). Ten years apart, the snapshots share no survey years. Bars that stay the same height mean stable clusters. Click a decade to map it. Below each bar: share of its High–High block groups that were also High–High a decade earlier. * = moved from older block groups by area, which averages neighbouring values and so raises clustering (Moran's I) by itself: compare earlier decades with care.");
    const runs = NB_YEARS.map(y => (y === nbLisa.y ? nbLisa : runLisa(nbState.v, y)));
    const keys = ["HH", "LL", "HL", "LH"];
    const x = d3.scaleBand(NB_YEARS, [m.l, W - m.r]).padding(0.3);
    const tot = runs.map(R => keys.map(k => R.out.filter(o => o.cls === k).length));
    const y = d3.scaleLinear([0, d3.max(tot, t => d3.sum(t))], [H - m.b - 14, m.t]).nice();
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)))
      .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4"));
    svg.append("text").attr("class", "muted").attr("x", 4).attr("y", 12).text("block groups in each class");
    const col = svg.append("g").selectAll("g").data(runs).join("g").attr("class", "col").classed("on", R => R.y === mapState.year)
      .on("click", (_, R) => nbSetYear(R.y));
    col.append("rect").attr("class", "col-bg").attr("x", R => x(R.y) - x.step() * 0.15).attr("width", x.step()).attr("y", m.t).attr("height", H - m.t).attr("fill", "transparent");
    col.each(function (R, k) {
      let acc = 0;
      d3.select(this).selectAll("rect.seg").data(keys).join("rect").attr("class", "seg").attr("x", x(R.y)).attr("width", x.bandwidth())
        .attr("y", c => { const n = tot[k][keys.indexOf(c)]; acc += n; return y(acc); }).attr("height", c => y(0) - y(tot[k][keys.indexOf(c)]))
        .attr("fill", c => LISA_COLOR[c]);
    });
    col.append("text").attr("x", R => x(R.y) + x.bandwidth() / 2).attr("y", H - m.b + 2).attr("text-anchor", "middle").style("font-weight", R => (R.y === mapState.year ? 700 : 400)).text(R => nbDecade(R.y)).style("fill", R => (INTERP.has(R.y) ? "var(--text-muted)" : null));
    col.append("text").attr("class", "muted").attr("x", R => x(R.y) + x.bandwidth() / 2).attr("y", H - m.b + 16).attr("text-anchor", "middle")
      .text((R, k) => { if (!k) return ""; const prev = runs[k - 1], hh = d3.range(NBG).filter(i => R.out[i].cls === "HH"); return hh.length ? `${d3.format(".0%")(hh.filter(i => prev.out[i].cls === "HH").length / hh.length)} kept` : ""; });
    col.append("text").attr("x", R => x(R.y) + x.bandwidth() / 2).attr("y", (R, k) => y(d3.sum(tot[k])) - 4).attr("text-anchor", "middle").text((R, k) => `${tot[k][0]} HH`);
    return;
  }
  d3.select("#nb-bot-title").text("How many regions? Variance explained by k");
  d3.select("#nb-bot-info").attr("title", "Share of the indicators' total variation explained by the regions (1 − within-region sum of squares ÷ total), for 1 to 15 regions. SKATER makes one cut at a time, so this is the same run stopped earlier. Where the curve flattens, extra regions add little. Click a point to choose k.");
  if (!nbSkaterRun) return;
  const hist = nbSkaterRun.history.map(h => ({ k: h.k, r2: 1 - h.ssd / nbSkaterRun.tss }));
  const x = d3.scaleLinear([1, 15], [m.l, W - m.r]), y = d3.scaleLinear([0, d3.max(hist, h => h.r2) || 1], [H - m.b, m.t]).nice();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(14).tickSize(3));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4, ".0%").tickSize(-(W - m.l - m.r)))
    .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4"));
  svg.append("text").attr("class", "muted").attr("x", W - m.r).attr("y", H - 2).attr("text-anchor", "end").text("number of regions (k) →");
  svg.append("text").attr("class", "muted").attr("x", 4).attr("y", 12).text("variance explained");
  svg.append("path").datum(hist).attr("fill", "none").attr("stroke", "#3d3c39").attr("stroke-width", 1.5).attr("d", d3.line().x(h => x(h.k)).y(h => y(h.r2)));
  svg.selectAll("circle").data(hist).join("circle").attr("class", "kpt").attr("cx", h => x(h.k)).attr("cy", h => y(h.r2))
    .attr("r", h => (h.k === nbRegions.n ? 6 : 3.5)).attr("fill", h => (h.k === nbRegions.n ? "#e8710a" : "#3d3c39"))
    .on("click", (_, h) => { if (h.k > 1) nbSetK(h.k); })
    .on("mousemove", (e, h) => showTip(e, `k = ${h.k}: ${d3.format(".0%")(h.r2)} of the variation explained`)).on("mouseleave", hideTip);
  const cur = hist.find(h => h.k === nbRegions.n);
  if (cur) svg.append("text").attr("x", x(cur.k) + 8).attr("y", y(cur.r2) + 14).style("font-weight", 600).text(`k = ${cur.k}: ${d3.format(".0%")(cur.r2)}`);
  if (hist[hist.length - 1].k < 15) svg.append("text").attr("class", "muted").attr("x", W - m.r).attr("y", m.t + 4).attr("text-anchor", "end")
    .text(`Stops at ${hist[hist.length - 1].k}: no cut leaves both parts ≥ ${nbState.min} block groups`);
}

// What the selected groups contain
function nbSelSummary() {
  d3.selectAll(".nb-n").text(function () { const n = mapState.groups[this.dataset.n].size; return n ? `(${n})` : ""; });
  const el = d3.select("#nb-sel");
  if (!anySelected()) { el.html('<span class="muted">Lasso (or Shift-click) block groups to put them in Group A or B; the groups are shared with the dashboard.</span>'); return; }
  el.html(["A", "B"].filter(g => mapState.groups[g].size).map(g => {
    const ids = [...mapState.groups[g]], pop = d3.sum(ids, popOf), tepi = d3.mean(ids, i => TEPI_YEARS[mapState.year][i]);
    let detail;
    if (nbState.mode === "lisa") detail = LISA_CLASS.filter(c => c.key !== "ns").map(c => `${c.key} ${ids.filter(i => nbLisa.out[i].cls === c.key).length}`).join(" · ");
    else detail = nbRegions ? `regions ${[...new Set(ids.map(i => nbRegions.reg[i]).filter(r => r != null))].sort(d3.ascending).map(r => r + 1).join(", ")}` : "";
    return `<strong style="color:${GROUPS[g].color}">${GROUPS[g].label}</strong>: ${ids.length} block groups, ${d3.format(",")(pop)} people, mean TEPI ${d3.format(".0f")(tepi)} · ${detail}`;
  }).join("<br>"));
}

// ---- Controls ----
function nbSetK(k) {
  nbState.k = k; nbState.pick = null;
  d3.select("#nb-k").property("value", k); d3.select("#nb-k-out").text(k);
  if (nbSkaterRun) nbRegions = skaterAt(Math.min(k, nbSkaterRun.history[nbSkaterRun.history.length - 1].k));
  updateNb();
}
function nbSetYear(y) {
  mapState.year = y;
  setMapYearControl(y);
  if (typeof updateMap === "function") updateMap();
  document.dispatchEvent(new Event("release-change"));
  showNbPage();
}
function updateNb() { updateNbMap(); drawNbTop(); drawNbBot(); }
function showNbPage() {
  // the page shows decades: move the shared release to the nearest one
  if (!NB_YEARS.includes(mapState.year)) {
    const y = NB_YEARS.reduce((a, b) => (Math.abs(b - mapState.year) < Math.abs(a - mapState.year) ? b : a));
    mapState.year = y; setMapYearControl(y); if (typeof updateMap === "function") updateMap();
  }
  d3.selectAll("#nb-year [data-year]").attr("aria-pressed", function () { return +this.dataset.year === mapState.year; });
  d3.selectAll("#nbview .nb-lisa").property("hidden", nbState.mode !== "lisa");
  d3.selectAll("#nbview .nb-skater").property("hidden", nbState.mode !== "skater");
  nbCompute();
  drawNbMap(); drawNbTop(); drawNbBot();
}
d3.selectAll("#nb-mode [data-mode]").on("click", function () {
  nbState.mode = this.dataset.mode; nbState.pick = null; nbState.focus = null;
  d3.selectAll("#nb-mode [data-mode]").attr("aria-pressed", function () { return this.dataset.mode === nbState.mode; });
  showNbPage();
});
d3.selectAll("#nb-show [data-show]").on("click", function () {
  nbState.show = this.dataset.show;
  d3.selectAll("#nb-show [data-show]").attr("aria-pressed", function () { return this.dataset.show === nbState.show; });
  updateNbMap();
});
d3.select("#nb-var").selectAll("option").data(["TEPI", INCOME, ...INDICATORS]).join("option").attr("value", d => d).text(nbVarLabel);
d3.select("#nb-var").property("value", nbState.v).on("change", function () { nbState.v = this.value; nbState.pick = null; showNbPage(); });
d3.select("#nb-alpha").on("change", function () { nbState.alpha = +this.value; nbState.pick = null; showNbPage(); });
d3.select("#nb-k").property("value", nbState.k).on("input", function () { nbSetK(+this.value); });
d3.select("#nb-k-out").text(nbState.k);
d3.select("#nb-min").property("value", nbState.min).on("change", function () { nbState.min = +this.value; d3.select("#nb-min-out").text(nbState.min); showNbPage(); })
  .on("input", function () { d3.select("#nb-min-out").text(this.value); });
d3.select("#nb-min-out").text(nbState.min);
function nbVarBoxes() {
  d3.select("#nb-vars").selectAll("label").data([...INDICATORS, INCOME]).join("label").attr("class", "ctl")
    .html(v => `<input type="checkbox" value="${v}"${nbState.vars.includes(v) ? " checked" : ""}> ${v}`)
    .select("input").on("change", function () {
      nbState.vars = [...INDICATORS, INCOME].filter(v => d3.select(`#nb-vars input[value="${v}"]`).property("checked"));
      showNbPage();
    });
}
nbVarBoxes();
d3.select("#nb-all").on("click", () => { nbState.vars = [...INDICATORS]; nbVarBoxes(); showNbPage(); });
d3.select("#nb-none").on("click", () => { nbState.vars = []; nbVarBoxes(); showNbPage(); });
d3.select("#nb-year").selectAll("button").data(NB_YEARS).join("button").attr("class", "tool").attr("data-year", y => y)
  .text(y => nbDecade(y) + (INTERP.has(y) ? "*" : "")).attr("title", y => relName(y) + (INTERP.has(y) ? ": moved from older block groups by area weighting" : ""))
  .on("click", (_, y) => nbSetYear(y));
d3.select('[data-view="nbview"]').on("click.nb", () => requestAnimationFrame(showNbPage));
window.addEventListener("resize", () => { if (!document.getElementById("nbview").hidden) showNbPage(); });
d3.selectAll("#nbview [data-group]").on("click", function () { setActive(this.dataset.group); });
d3.selectAll("#nbview [data-nbclear]").on("click", function () { setGroup(this.dataset.nbclear, new Set()); updateNb(); });
d3.selectAll("#nbview [data-nbtool]").on("click", function () {
  nbState.tool = this.dataset.nbtool;
  d3.selectAll("#nbview [data-nbtool]").attr("aria-pressed", function () { return this.dataset.nbtool === nbState.tool; });
  drawNbMap();
});
