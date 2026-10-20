// ---- Redistricting page: legislative lines and TEPI over time ----
// Three maps, one per redistricting, each over the TEPI tiers of its own
// time (2001 lines: Census 2000; 2011: ACS 2009-13; 2021: ACS 2019-23), and
// one chart: the share of High-priority residents held by the two most
// concentrated districts, enacted (red) against random neutral plans (grey
// band, ensemble_prep.py: ReCom, connected, equal population, no VRA rule).
// The maps pan and zoom together.
const ENS_ALL = window.ENSEMBLE.districts ? { 2021: window.ENSEMBLE } : window.ENSEMBLE; // older single-run file
const ENS_CYCLES = Object.keys(ENS_ALL).sort();
const ensState = { zoom: d3.zoomIdentity, kind: "ld", net: "2011", piece: null }; // kind: state legislative or city wards
// City wards (wards_prep.py): 2002 wards with Census 2000 TEPI, 2012 wards with
// ACS 2009-13, and the same (still current) 2012 wards with ACS 2019-23
const WARDS = window.WARDS;
// the panels on screen: one per cycle, each with its lines, block-group assignment and TEPI release
function ensPanels() {
  if (ensState.kind === "ward") return WARDS.panels.map(p => ({
    key: p.label, title: p.label === "2012 today" ? "2012 wards, today" : `${p.wards} wards`, year: p.year,
    lines: WARDS.geometry[p.wards].map(w => ({ code: w.ward, short: `Ward ${w.ward}`, geometry: w.geometry })),
    of: i => p.bg[i], inArea: i => p.bg[i] != null, top2: p.top2,
  }));
  return ENS_CYCLES.map(c => { const P = ELEC.plans[c].ld; return {
    key: c, title: `${c} lines`, year: ensYear(c), lines: P.districts, of: i => P.bg[i], inArea: () => true, top2: ensTop2(c), cycle: c,
  }; });
}
const ENS_ERA = { 2001: 2000, 2011: 2013, 2021: 2023 }; // TEPI of each cycle's time
const ensYear = c => +(ENS_ALL[c].year || ENS_ERA[c] || 2023);
const ensFmt = d3.format(".0%");
const ensTop2 = c => ENS_ALL[c].enacted.top2;
const ensPercentile = c => { const R = ENS_ALL[c]; return R.samples.filter(s => s[s.length - 1] < R.enacted.top2).length / R.samples.length; };

const ensZoom = d3.zoom().scaleExtent([0.5, 16]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : true))
  .on("zoom", ({ transform }) => {
    ensState.zoom = transform;
    d3.selectAll("#ens-maps .ens-g").attr("transform", transform);
    d3.selectAll("#ens-maps svg").each(function () { this.__zoom = transform; }); // keep all three in step
  });

function ensTip(i, pn) {
  const p = TEPI_YEARS[pn.year][i], d = pn.lines.find(x => x.code === pn.of(i));
  return `<strong>${bgLabel(i)}</strong><br>TEPI (${relName(pn.year)}): ${p == null ? "n/a" : `<strong>${tierOf(p)}</strong>`}<br>${d ? d.short : ensState.kind === "ward" ? "Outside the city" : "No district"} (${pn.title})`;
}

function drawEnsMaps() {
  const box = d3.select("#ens-maps").html(""), panels = ensPanels();
  d3.select("#ens-maps-title").text(ensState.kind === "ward" ? "Tucson City Council wards over TEPI, each in its own time" : "State legislative districts over TEPI, each in its own time");
  panels.forEach((pn, k) => {
    const cell = box.append("div").attr("class", "ens3-cell");
    cell.append("h3").html(k ? `${pn.title} <span class="muted">· dashed: ${panels[k - 1].title}</span>` : pn.title);
    cell.append("svg").attr("data-k", k);
  });
  const svgs = box.selectAll("svg").nodes();
  const r = svgs[0].getBoundingClientRect();
  if (!r.width || !r.height) return;
  const W = r.width, H = r.height;
  // wards: frame the city; legislative: the usual county frame
  const frame = ensState.kind === "ward"
    ? { type: "FeatureCollection", features: d3.range(NBG).filter(i => panels[0].inArea(i)).map(i => bgFeature(i)) } : MAP.focus;
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[6, 6], [W - 6, H - 6]], frame));
  svgs.forEach(node => {
    const k = +node.dataset.k, pn = panels[k], prev = k ? panels[k - 1] : null;
    const svg = d3.select(node).attr("viewBox", `0 0 ${W} ${H}`);
    svg.call(ensZoom).on("dblclick.zoom", null);
    node.__zoom = ensState.zoom;
    const g = svg.append("g").attr("class", "ens-g").attr("transform", ensState.zoom);
    g.append("g").selectAll("path").data(d3.range(NBG)).join("path").attr("class", "bg").attr("d", i => path(bgFeature(i)))
      .attr("fill", "#f1f0ec").attr("stroke", "#fff")
      .on("mousemove", (e, i) => showTip(e, ensTip(i, pn))).on("mouseleave", hideTip);
    // the previous redistricting's lines, thin and dashed, under this one's in bold
    if (prev) g.append("g").selectAll("path").data(prev.lines).join("path").attr("class", "dline-old").attr("d", d => path(d.geometry));
    g.append("g").selectAll("path").data(pn.lines).join("path").attr("class", "dline").attr("d", d => path(d.geometry));
    g.append("g").selectAll("text").data(pn.lines).join("text").attr("class", "dlabel")
      .attr("transform", d => {
        const pts = d3.range(NBG).filter(i => pn.of(i) === d.code).map(i => path.centroid(bgFeature(i)));
        return pts.length ? `translate(${d3.mean(pts, p => p[0])},${d3.mean(pts, p => p[1])})` : "translate(-99,-99)";
      }).text(d => d.short);
  });
  const lg = d3.select("#ens-legend").html("");
  lg.append("span").attr("class", "legend-item").html('<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="2.4"/></svg>state legislative districts of that redistricting');
  lg.append("span").attr("class", "legend-item").html('<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#8a8984" stroke-width="1" stroke-dasharray="4 3"/></svg>the previous lines');
  lg.append("span").attr("class", "legend-item").html('<span class="swatch" style="background:#f1f0ec;border:1px solid #d5d4ce"></span>block groups');
}

// One row per cycle: grey dots = random neutral maps, red dot = the real lines.
// x = share of High-priority residents living in the two districts that hold
// the most of them (left: spread out, right: gathered together).
function drawEnsTrend() {
  const svg = d3.select("#ens-trend"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, m = { l: 200, r: 16, t: 22, b: 24 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const band = ensState.kind === "ld", unit = band ? "districts" : "wards";
  const rows = ensPanels().map(pn => ({ pn, en: pn.top2, sims: band ? ENS_ALL[pn.cycle].samples.map(s => s[s.length - 1]) : [], pct: band ? ensPercentile(pn.cycle) : null }));
  const all = rows.flatMap(r => r.sims.concat([r.en]));
  const x = d3.scaleLinear([Math.max(0, d3.min(all) - 0.05), Math.min(1, d3.max(all) + 0.05)], [m.l, W - m.r]).nice();
  const rh = (H - m.t - m.b) / rows.length;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6, ".0%").tickSize(3));
  svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", 12).text("← spread out");
  svg.append("text").attr("class", "muted").attr("x", W - m.r).attr("y", 12).attr("text-anchor", "end").text("gathered →");
  const jit = k => ((k * 2654435761) % 1000) / 1000 - 0.5; // fixed vertical jitter
  rows.forEach((r, k) => {
    const yc = m.t + k * rh + rh / 2, g = svg.append("g");
    g.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", yc).attr("y2", yc).attr("stroke", "#eceae4");
    g.append("text").attr("x", m.l - 12).attr("y", yc - 10).attr("text-anchor", "end").style("font-weight", 700).text(r.pn.title);
    g.append("text").attr("class", "muted").attr("x", m.l - 12).attr("y", yc + 4).attr("text-anchor", "end").text(`TEPI ${relName(r.pn.year).replace("ACS ", "")}`);
    g.selectAll("circle.sim").data(r.sims).join("circle").attr("class", "sim").attr("r", 2.2)
      .attr("cx", v => x(v)).attr("cy", (_, j) => yc + jit(j) * Math.min(28, rh * 0.6)).attr("fill", "#8a8984").attr("fill-opacity", 0.35);
    g.append("circle").attr("cx", x(r.en)).attr("cy", yc).attr("r", 8).attr("fill", "#d7191c").attr("stroke", "#fff").attr("stroke-width", 2)
      .on("mousemove", e => showTip(e, `<strong>${r.pn.title}</strong> (TEPI ${relName(r.pn.year)})<br>The real lines put <strong>${ensFmt(r.en)}</strong> of High-priority residents in their two most concentrated ${unit}` +
        (band ? `<br>Random neutral maps: median ${ensFmt(d3.median(r.sims))}; the real lines are more gathered than ${d3.format(".1%")(r.pct)} of them` : "")))
      .on("mouseleave", hideTip);
    g.append("text").attr("x", m.l - 12).attr("y", yc + 18).attr("text-anchor", "end").style("fill", band && r.pct > 0.9 ? "#b3141a" : "var(--text)").style("font-weight", 700)
      .text(band ? `> ${d3.format(".1%")(r.pct)} of random maps` : `${ensFmt(r.en)} in two ${unit}`);
  });
  // key
  const k = svg.append("g").attr("transform", `translate(${m.l},${H - 6})`);
}

// ---- District network, animated over the redistrictings ----
// Nodes: every block group, linked to its neighbours (rook contiguity), placed
// by rank on each axis so the dense city opens up (north stays north). The
// districts are Voronoi cells around the nodes, coloured by district; colours
// carry across cycles by matching each district to the earlier district it
// shares the most residents with. Only High-priority block groups of each
// era are highlighted; an orange ring marks those whose (matched) district
// changed since the previous redistricting. Play steps 2001 -> 2011 -> 2021.
// district hues avoid blue: blue (light -> dark) always means TEPI tier
const ENS_DCOL = ["#f28e2b", "#59a14f", "#b07aa1", "#9c755f", "#edc948", "#e15759", "#ff9da7", "#8c8c3c", "#bab0ac", "#d37295"];
// the TEPI tier key, repeated wherever tier blues appear
const ensTierKey = sel => sel.append("span").attr("class", "legend-item").html("<strong>TEPI tier:</strong> " + TIERS.map((t, k) => `<svg width="11" height="11"><rect width="11" height="11" fill="${TIER_FILL(k)}"/></svg> ${t}`).join(" "));
let ensVorTimer = null;
// matched district label per block group and cycle
const ENS_MATCH = (() => {
  const out = {}, cyc = ENS_CYCLES.length ? ENS_CYCLES : ["2001", "2011", "2021"];
  let prev = null, next = 0;
  cyc.forEach(c => {
    const P = ELEC.plans[c].ld, pop = MAP.census.value.Population[ensYear(c)] || MAP.census.value.Population[2023];
    const codes = P.districts.map(d => d.code), lab = new Map();
    if (prev) {
      // overlap in residents between each new district and each earlier label
      const ov = [];
      codes.forEach(code => {
        const m = new Map();
        d3.range(NBG).forEach(i => { if (P.bg[i] === code && prev[i] != null) m.set(prev[i], (m.get(prev[i]) || 0) + (pop[i] || 0)); });
        m.forEach((v, l) => ov.push({ code, l, v }));
      });
      ov.sort((x, y) => y.v - x.v);
      const used = new Set();
      ov.forEach(o => { if (!lab.has(o.code) && !used.has(o.l)) { lab.set(o.code, o.l); used.add(o.l); } });
    }
    codes.forEach(code => { if (!lab.has(code)) lab.set(code, next++); });
    next = Math.max(next, ...lab.values()) + 1;
    out[c] = d3.range(NBG).map(i => (P.bg[i] == null ? null : lab.get(P.bg[i])));
    out[c].names = new Map(P.districts.map(d => [lab.get(d.code), d.short]));
    prev = out[c];
  });
  return out;
})();
const ensHighAt = (c, i) => { const v = TEPI_YEARS[ensYear(c)][i]; return v != null && v >= 80; };
// Each redistricting is a delta between two layers, the lines before (pc) and
// after (c). Their intersection cuts the county into pieces: block groups with
// the same old and new district. A piece whose (matched) district changed is a
// move. Pieces are drawn as Voronoi regions over the network and can be clicked.
const ensPrev = c => { const k = ENS_CYCLES.indexOf(c); return k > 0 ? ENS_CYCLES[k - 1] : null; };
const ensDeltas = () => ENS_CYCLES.slice(1); // "2011" = 2001 -> 2011, "2021" = 2011 -> 2021
// "all": the three layers at once; a piece shares all three districts, and its
// number of moves (0, 1, 2) separates the stable core from the margins
const ensMoves = i => { const L = ENS_CYCLES.map(c => ENS_MATCH[c][i]); return L.some(v => v == null) ? null : d3.range(1, L.length).filter(k => L[k] !== L[k - 1]).length; };
const ensPieceKey = (c, i) => {
  if (c === "all") { const L = ENS_CYCLES.map(y => ENS_MATCH[y][i]); return L.some(v => v == null) ? null : L.join("|"); }
  const P = ENS_MATCH[ensPrev(c)], M = ENS_MATCH[c]; return P[i] == null || M[i] == null ? null : `${P[i]}|${M[i]}`;
};
function ensPieces(c) {
  if (c === "all") {
    const by = new Map();
    d3.range(NBG).forEach(i => { const k = ensPieceKey(c, i); if (k == null) return; if (!by.has(k)) by.set(k, { key: k, ids: [], moves: ensMoves(i) }); by.get(k).ids.push(i); });
    return [...by.values()].map(p => ({ ...p, moved: p.moves > 0, fromName: ENS_CYCLES.map(y => ENS_MATCH[y].names.get(ENS_MATCH[y][p.ids[0]])).join(" → "), toName: "" }));
  }
  const P = ENS_MATCH[ensPrev(c)], M = ENS_MATCH[c], by = new Map();
  d3.range(NBG).forEach(i => { const k = ensPieceKey(c, i); if (k == null) return; if (!by.has(k)) by.set(k, { key: k, from: P[i], to: M[i], ids: [] }); by.get(k).ids.push(i); });
  return [...by.values()].map(p => ({ ...p, moved: p.from !== p.to, fromName: ENS_MATCH[ensPrev(c)].names.get(p.from), toName: M.names.get(p.to) }));
}
// Voronoi edges between neighbouring cells i, j for which split(i, j) is true
function ensEdges(split) {
  const vor = d3.select("#ens-net").node().__vor, segs = [];
  const key = p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  for (let i = 0; i < NBG; i++) for (const j of vor.delaunay.neighbors(i)) {
    if (j <= i || !split(i, j)) continue;
    const a = vor.cellPolygon(i), b = vor.cellPolygon(j);
    if (!a || !b) continue;
    const bs = new Set(b.map(key)), shared = a.filter(p => bs.has(key(p)));
    if (shared.length >= 2) segs.push([shared[0], shared[1]]);
  }
  return segs;
}
function drawEnsNet() {
  const svg = d3.select("#ens-net"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, pad = 10;
  if (!ensDeltas().includes(ensState.net) && ensState.net !== "all") ensState.net = ensDeltas()[0];
  d3.select("#ens-net-cycle").selectAll("button").data([...ensDeltas(), "all", "play"]).join("button").attr("class", "tool")
    .text(ensBtnText).attr("aria-pressed", c => c === ensState.net)
    .on("click", (_, c) => (c === "play" ? ensVorPlay() : (ensVorStop(), ensVorShow(c))));
  if (svg.attr("data-w") !== String(W) || svg.attr("data-h") !== String(H) || !svg.select(".vor-cells").size()) {
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("data-w", W).attr("data-h", H).selectAll("*").remove();
    // fixed node positions: rank on each axis of the block-group centres; the
    // block groups are then placed on those slots by ENS_LAYOUT, a few swaps of
    // neighbouring slots so district regions stay in one piece as on the map
    const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[0, 0], [1000, 1000]], MAP.focus));
    const cen = d3.range(NBG).map(i => path.centroid(bgFeature(i)));
    const spread = k => { const o = d3.range(NBG).sort((a, b) => cen[a][k] - cen[b][k]), r = new Array(NBG); o.forEach((idx, q) => (r[idx] = q / (NBG - 1))); return r; };
    const rx = spread(0), ry = spread(1);
    const slots = d3.range(NBG).map(i => [pad + rx[i] * (W - 2 * pad), pad + ry[i] * (H - 2 * pad)]);
    const pts = new Array(NBG);
    (window.ENS_LAYOUT || d3.range(NBG)).forEach((i, s) => (pts[i] = slots[s]));
    const vor = d3.Delaunay.from(pts).voronoi([0, 0, W, H]);
    svg.node().__pts = pts; svg.node().__vor = vor;
    const g = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.5, 12]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : true)).on("zoom", ({ transform }) => g.attr("transform", transform)));
    // cells: click to select the piece (old district x new district) the block group is in
    g.append("g").attr("class", "vor-cells").selectAll("path").data(d3.range(NBG)).join("path").attr("d", i => vor.renderCell(i)).attr("stroke", "none").attr("fill", "#f3f2ee").attr("fill-opacity", 0.32)
      .on("mousemove", (e, i) => showTip(e, ensVorTip(i))).on("mouseleave", hideTip)
      .on("click", (e, i) => ensPieceSelect(ensPieceKey(ensState.net, i) === ensState.piece ? null : ensPieceKey(ensState.net, i)));
    g.append("g").attr("class", "vor-links").selectAll("line").data(NB_EDGES).join("line")
      .attr("x1", e => pts[e[0]][0]).attr("y1", e => pts[e[0]][1]).attr("x2", e => pts[e[1]][0]).attr("y2", e => pts[e[1]][1]);
    g.append("g").attr("class", "vor-old");
    g.append("g").attr("class", "vor-borders");
    g.append("g").attr("class", "vor-piece");
    g.append("g").attr("class", "vor-nodes").selectAll("circle").data(d3.range(NBG)).join("circle")
      .attr("cx", i => pts[i][0]).attr("cy", i => pts[i][1])
      .on("mousemove", (e, i) => { showTip(e, ensVorTip(i)); d3.selectAll("#ens-sm rect.seg").classed("hit", d => d.list.includes(i)); })
      .on("mouseleave", () => { hideTip(); d3.selectAll("#ens-sm rect.seg").classed("hit", false); })
      .on("click", (e, i) => ensPieceSelect(ensPieceKey(ensState.net, i) === ensState.piece ? null : ensPieceKey(ensState.net, i)));
  }
  ensVorShow(ensState.net, false);
}
function ensVorTip(i) {
  if (ensState.net === "all") {
    const m = ensMoves(i), k = ensPieceKey("all", i), piece = k && ensPieces("all").find(p => p.key === k);
    return `<strong>${bgLabel(i)}</strong><br>${ENS_CYCLES.map(y => `${y}: ${ENS_MATCH[y].names.get(ENS_MATCH[y][i]) || "—"}`).join("<br>")}` +
      (m == null ? "" : `<br><strong>${m === 0 ? "Never moved (core)" : m === 1 ? "Moved once" : "Moved twice"}</strong>`) +
      (piece ? ` · piece of ${piece.ids.length} · <span class="muted">click to select</span>` : "");
  }
  const c = ensState.net, pc = ensPrev(c), M = ENS_MATCH[c], P = ENS_MATCH[pc], k = ensPieceKey(c, i);
  const piece = k && ensPieces(c).find(p => p.key === k);
  return `<strong>${bgLabel(i)}</strong>${ensHighAt(c, i) ? " · <strong>High priority</strong>" : ""}<br>${pc}: ${P.names.get(P[i]) || "—"} → ${c}: ${M.names.get(M[i]) || "—"}` +
    (piece ? `<br>${piece.moved ? "Moved" : "Stayed"} with ${piece.ids.length - 1} other block group${piece.ids.length === 2 ? "" : "s"} · <span class="muted">click to select this piece</span>` : "");
}
// show one redistricting (delta into cycle c): new districts as cells, new lines
// solid, old lines dashed; pieces that moved are filled stronger
function ensVorShow(c, animate = true) {
  if (c === "all") return ensAllShow(animate);
  if (!ensDeltas().includes(c)) c = ensDeltas()[0];
  d3.select("#ens-net-title").text("Redistricting as a delta: old lines (dashed) × new lines (solid)");
  if (ensState.net !== c) ensState.piece = null;
  ensState.net = c;
  const svg = d3.select("#ens-net"), pts = svg.node().__pts;
  if (!pts || ensState.kind === "ward") return;
  d3.selectAll("#ens-net-cycle button").attr("aria-pressed", d => d === c);
  const pc = ensPrev(c), M = ENS_MATCH[c], P = ENS_MATCH[pc];
  const T = animate ? d3.transition().duration(900) : d3.transition().duration(0);
  const moved = i => M[i] != null && P[i] != null && M[i] !== P[i];
  ensState.moved = moved;
  // a new transition interrupts one in progress; without animation set the colours directly
  const cells = svg.select(".vor-cells").selectAll("path").interrupt();
  (animate ? cells.transition(T) : cells).attr("fill", i => (M[i] == null ? "#f3f2ee" : ENS_DCOL[M[i] % ENS_DCOL.length])).attr("fill-opacity", i => (moved(i) ? 0.55 : 0.16));
  const line = (sel, segs) => sel.selectAll("line").data(segs).join("line")
    .attr("x1", d => d[0][0]).attr("y1", d => d[0][1]).attr("x2", d => d[1][0]).attr("y2", d => d[1][1]);
  line(svg.select(".vor-borders"), ensEdges((i, j) => M[i] !== M[j]));
  line(svg.select(".vor-old"), ensEdges((i, j) => P[i] !== P[j]));
  // moved block groups in their TEPI tier, the rest small and grey
  const tier = i => tierIdx(TEPI_YEARS[ensYear(c)][i]);
  svg.select(".vor-nodes").selectAll("circle").raise()
    .attr("class", i => (moved(i) ? "vn moved" : "vn"))
    .transition(T).attr("r", i => (moved(i) ? 4 : 1.5))
    .style("fill", i => (moved(i) ? (tier(i) == null ? "#c9c8c2" : TIER_FILL(tier(i))) : "#c9c8c2"));
  svg.select(".vor-nodes").raise();
  const all = d3.range(NBG).filter(i => M[i] != null), mv = all.filter(moved), np = ensPieces(c).filter(p => p.moved).length;
  const lg = d3.select("#ens-net-legend").html("");
  lg.append("span").attr("class", "legend-item").html(`<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="1.4" stroke-dasharray="4 3"/></svg> ${pc} lines`);
  lg.append("span").attr("class", "legend-item").html(`<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="2.2"/></svg> ${c} lines`);
  lg.append("span").attr("class", "legend-item").html('<svg width="14" height="12"><rect width="14" height="12" fill="#f28e2b" fill-opacity="0.55"/></svg> piece that moved · <svg width="14" height="12"><rect width="14" height="12" fill="#f28e2b" fill-opacity="0.16"/></svg> stayed (hue: new district)');
  lg.append("span").attr("class", "legend-item").html('<svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#6baed6" stroke="#1f1f1f" stroke-width="1"/></svg> moved block group, fill = TEPI tier');
  ensTierKey(lg);
  lg.append("span").attr("class", "legend-item").html(`<strong>${pc} → ${c}:</strong> ${mv.length} of ${all.length} block groups moved, in ${np} pieces · click a piece`);
  drawEnsBars(c);
  ensPieceSelect(ensState.piece);
}
// select one piece (or null): outline it in the network, highlight its bar
function ensPieceSelect(key) {
  ensState.piece = key;
  const c = ensState.net, svg = d3.select("#ens-net");
  if (!svg.node().__pts) return;
  const inP = i => key != null && ensPieceKey(c, i) === key;
  svg.select(".vor-piece").selectAll("line").data(key ? ensEdges((i, j) => inP(i) !== inP(j)) : []).join("line")
    .attr("x1", d => d[0][0]).attr("y1", d => d[0][1]).attr("x2", d => d[1][0]).attr("y2", d => d[1][1]);
  svg.select(".vor-cells").selectAll("path").classed("dim", i => key != null && !inP(i));
  d3.selectAll("#ens-sm .piece-row").classed("on", d => d.key === key);
  const piece = key && ensPieces(c).find(p => p.key === key);
  const ty = c === "all" ? 2023 : ensYear(c);
  d3.select("#ens-piece-note").html(piece ? `<strong>${piece.fromName}${piece.toName ? " → " + piece.toName : ""}</strong>${c === "all" ? ` (${piece.moves === 0 ? "never moved" : piece.moves === 1 ? "moved once" : "moved twice"})` : ""}: ${piece.ids.length} block groups, ` +
    TIERS.map((t, k) => [t, piece.ids.filter(i => tierIdx(TEPI_YEARS[ty][i]) === k).length]).filter(d => d[1]).map(d => `${d[1]} ${d[0]}`).join(", ") + ` <button class="linkbtn" id="ens-piece-clear">clear</button>`
    : `<span class="muted">${c === "all" ? "How to read: grey = the stable core, kept in the same district in 2001, 2011 and 2021; orange = the margins that redistricting moves (darker = moved twice)." : "How to read: each region is a piece of the map with one old and one new district. Strong fill = the piece was moved to another district; faint = it stayed. Dots in moved pieces show their TEPI tier."} Click a piece.</span>`);
  d3.select("#ens-piece-clear").on("click", () => ensPieceSelect(null));
}
const ensBtnText = c => (c === "play" ? (ensVorTimer ? "⏸" : "▶ Play") : c === "all" ? "All three: core vs margin" : `${ensPrev(c)} → ${c}`);
function ensVorStop() { clearInterval(ensVorTimer); ensVorTimer = null; d3.selectAll("#ens-net-cycle button").text(ensBtnText); }
function ensVorPlay() {
  if (ensVorTimer) return ensVorStop();
  const D = ensDeltas();
  let k = 0;
  ensVorShow(D[0]);
  ensVorTimer = setInterval(() => { k += 1; if (k >= D.length) return ensVorStop(); ensVorShow(D[k]); }, 2600);
  d3.selectAll("#ens-net-cycle button").text(ensBtnText);
}

// ---- All three redistrictings: the stable core and the margins ----
const ENS_MOVE_COL = ["#e4e2dc", "#f6b26b", "#c4520a"]; // never, once, twice
function ensAllShow(animate = true) {
  if (ensState.net !== "all") ensState.piece = null;
  ensState.net = "all";
  const svg = d3.select("#ens-net");
  if (!svg.node().__pts) return;
  d3.selectAll("#ens-net-cycle button").attr("aria-pressed", d => d === "all");
  d3.select("#ens-net-title").text("All three redistrictings: which block groups never moved?");
  const T = animate ? d3.transition().duration(900) : d3.transition().duration(0);
  const first = ENS_MATCH[ENS_CYCLES[0]], last = ENS_MATCH[ENS_CYCLES[ENS_CYCLES.length - 1]];
  const cells = svg.select(".vor-cells").selectAll("path").interrupt();
  (animate ? cells.transition(T) : cells).attr("fill", i => { const m = ensMoves(i); return m == null ? "#f7f6f2" : ENS_MOVE_COL[m]; }).attr("fill-opacity", 0.85);
  const line = (sel, segs) => sel.selectAll("line").data(segs).join("line").attr("x1", d => d[0][0]).attr("y1", d => d[0][1]).attr("x2", d => d[1][0]).attr("y2", d => d[1][1]);
  line(svg.select(".vor-borders"), ensEdges((i, j) => last[i] !== last[j]));
  line(svg.select(".vor-old"), ensEdges((i, j) => first[i] !== first[j]));
  const moved = i => (ensMoves(i) || 0) > 0, tier = i => tierIdx(TEPI_YEARS[2023][i]);
  ensState.moved = moved;
  svg.select(".vor-nodes").selectAll("circle").raise().attr("class", i => (moved(i) ? "vn moved" : "vn"))
    .transition(T).attr("r", i => (moved(i) ? 3.4 : 1.5))
    .style("fill", i => (moved(i) ? (tier(i) == null ? "#c9c8c2" : TIER_FILL(tier(i))) : "#9e9d97"));
  svg.select(".vor-nodes").raise();
  const ok = d3.range(NBG).filter(i => ensMoves(i) != null), n = k => ok.filter(i => ensMoves(i) === k).length;
  const lg = d3.select("#ens-net-legend").html("");
  ENS_MOVE_COL.forEach((col, k) => lg.append("span").attr("class", "legend-item").html(`<svg width="14" height="12"><rect width="14" height="12" fill="${col}"/></svg> ${["never moved (core)", "moved once", "moved twice"][k]} (${n(k)})`));
  lg.append("span").attr("class", "legend-item").html(`<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="1.4" stroke-dasharray="4 3"/></svg> ${ENS_CYCLES[0]} lines · <svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="2.2"/></svg> ${ENS_CYCLES[ENS_CYCLES.length - 1]} lines`);
  lg.append("span").attr("class", "legend-item").text("dots in the margins: fill = TEPI tier (2019–23)");
  ensTierKey(lg);
  drawEnsAllBars();
  ensPieceSelect(ensState.piece);
}
// bars: core vs margins by tier, then each 2021 district split into core and margins
function drawEnsAllBars() {
  ensTierKey(d3.select("#ens-sm-legend").html(""));
  const svg = d3.select("#ens-sm"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, tier = i => tierIdx(TEPI_YEARS[2023][i]);
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  d3.select("#ens-sm-title").text(`Core or margin? ${ENS_CYCLES.join(" · ")}, by TEPI tier (2019–23)`);
  const ok = d3.range(NBG).filter(i => ensMoves(i) != null && tier(i) != null), grp = k => ok.filter(i => ensMoves(i) === k);
  const last = ENS_MATCH[ENS_CYCLES[ENS_CYCLES.length - 1]];
  const dists = [...new Set(ok.map(i => last[i]))].map(l => ({ l, name: last.names.get(l), ids: ok.filter(i => last[i] === l) })).sort((a, b) => b.ids.length - a.ids.length);
  const m = { l: 108, r: 40, t: 10 }, rowH = Math.max(14, Math.min(26, (H - m.t - 70) / (dists.length + 4)));
  const x100 = d3.scaleLinear([0, 1], [m.l, W - m.r]);
  const label = (y0, text) => svg.append("text").attr("x", m.l - 8).attr("y", y0 + rowH * 0.55).attr("text-anchor", "end").style("font-weight", 700).style("font-size", "11px").text(text);
  const note = (y0, text) => svg.append("text").attr("class", "muted").attr("x", W - m.r + 6).attr("y", y0 + rowH * 0.55).style("font-size", "10px").text(text);
  const stack = (y0, parts, total, fill, tipName) => {
    let acc = 0;
    parts.forEach((list, k) => {
      const x0 = x100(acc); acc += list.length / (total || 1);
      if (!list.length) return;
      svg.append("rect").attr("class", "seg").attr("x", x0).attr("y", y0).attr("width", Math.max(0, x100(acc) - x0 - 1)).attr("height", rowH - 6).attr("fill", fill(k)).datum({ list, t: k })
        .on("mouseenter", e => { ensNodeFocus(list); showTip(e, `${list.length} block groups · ${tipName(k)} (${d3.format(".0%")(list.length / total)})<br><span class="muted">highlighted in the network</span>`); })
        .on("mouseleave", () => { ensNodeFocus(null); hideTip(); });
    });
  };
  // core vs margins, each 100% by tier
  [["Never moved", 0], ["Moved once", 1], ["Moved twice", 2]].forEach(([name, k], j) => {
    const y0 = m.t + j * rowH, L = grp(k);
    label(y0, name); note(y0, `${L.length}`);
    stack(y0, TIERS.map((_, t) => L.filter(i => tier(i) === t)), L.length, TIER_FILL, t => TIERS[t]);
  });
  svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", m.t + 3 * rowH + 14).style("font-size", "10px").text(`Each ${ENS_CYCLES[ENS_CYCLES.length - 1]} district: core vs margins (block groups)`);
  dists.forEach((d, j) => {
    const y0 = m.t + (j + 3) * rowH + 22;
    label(y0, d.name || "?"); note(y0, `${d.ids.length}`);
    stack(y0, [0, 1, 2].map(k => d.ids.filter(i => ensMoves(i) === k)), d.ids.length, k => ENS_MOVE_COL[k], k => ["never moved", "moved once", "moved twice"][k]);
  });
  const hi = k => { const L = grp(k); return L.filter(i => tier(i) === 4).length / (L.length || 1); };
  svg.append("text").attr("x", m.l).attr("y", H - 6).style("font-size", "11px").style("font-weight", 600)
    .text(`High priority: ${d3.format(".0%")(hi(0))} of the core vs ${d3.format(".0%")(hi(1))} moved once, ${d3.format(".0%")(hi(2))} moved twice`);
}

// ---- Bars: who moved, and the pieces they moved in ----
// Top: moved vs stayed, each as 100% by tier (do movers skew to high or low
// priority?). Below: each piece that moved (old district -> new district),
// stacked by tier. Click a row to select the piece in the network; hover a
// segment to find its block groups; hover a dot to find its segment.
function drawEnsBars(c = ensState.net) {
  ensTierKey(d3.select("#ens-sm-legend").html(""));
  const svg = d3.select("#ens-sm"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, pc = ensPrev(c), y = ensYear(c);
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  d3.select("#ens-sm-title").text(`Who moved? ${pc} → ${c}, by TEPI tier (${relName(y).replace("ACS ", "")})`);
  const M = ENS_MATCH[c], moved = ensState.moved, tier = i => tierIdx(TEPI_YEARS[y][i]);
  const ids = d3.range(NBG).filter(i => M[i] != null && tier(i) != null), mv = ids.filter(moved), st = ids.filter(i => !moved(i));
  const byTier = list => TIERS.map((_, t) => list.filter(i => tier(i) === t));
  const pieces = ensPieces(c).filter(p => p.moved).map(p => ({ ...p, ids: p.ids.filter(i => tier(i) != null) })).filter(p => p.ids.length).sort((a, b) => b.ids.length - a.ids.length);
  const show = pieces.slice(0, 14);
  const m = { l: 128, r: 40, t: 10 }, rowH = Math.max(14, Math.min(26, (H - m.t - 64) / (show.length + 3)));
  const x100 = d3.scaleLinear([0, 1], [m.l, W - m.r]), xN = d3.scaleLinear([0, d3.max(show, d => d.ids.length) || 1], [m.l, W - m.r]);
  const row = (label, y0, segs, x, total, pct, note, piece) => {
    const g = svg.append("g").attr("class", piece ? "piece-row" : null).datum(piece || {});
    if (piece) g.append("rect").attr("class", "piece-bg").attr("x", 0).attr("y", y0 - 2).attr("width", W).attr("height", rowH - 2).attr("fill", "transparent")
      .style("cursor", "pointer").on("click", () => ensPieceSelect(ensState.piece === piece.key ? null : piece.key));
    g.append("text").attr("x", m.l - 8).attr("y", y0 + rowH * 0.55).attr("text-anchor", "end").style("font-weight", 700).style("font-size", "11px").style("pointer-events", "none").text(label);
    let acc = 0;
    segs.forEach((list, t) => {
      const v = pct ? list.length / (total || 1) : list.length, x0 = x(acc); acc += v;
      if (!list.length) return;
      g.append("rect").attr("class", "seg").attr("x", x0).attr("y", y0).attr("width", Math.max(0, x(acc) - x0 - 1)).attr("height", rowH - 6)
        .attr("fill", TIER_FILL(t)).datum({ list, t })
        .on("mouseenter", (e, d) => { ensNodeFocus(d.list); showTip(e, `${list.length} block groups · ${TIERS[t]}${pct ? ` (${d3.format(".0%")(list.length / total)})` : ""}<br><span class="muted">highlighted in the network${piece ? "; click to select the piece" : ""}</span>`); })
        .on("mouseleave", () => { ensNodeFocus(null); hideTip(); })
        .on("click", () => piece && ensPieceSelect(ensState.piece === piece.key ? null : piece.key));
    });
    g.append("text").attr("class", "muted").attr("x", W - m.r + 6).attr("y", y0 + rowH * 0.55).style("font-size", "10px").text(note);
  };
  row("Moved", m.t, byTier(mv), x100, mv.length, true, `${mv.length}`);
  row("Stayed", m.t + rowH, byTier(st), x100, st.length, true, `${st.length}`);
  svg.append("text").attr("class", "muted").attr("x", m.l).attr("y", m.t + 2 * rowH + 12).style("font-size", "10px")
    .text(`Pieces that moved, old → new district (block groups${pieces.length > show.length ? `; largest ${show.length} of ${pieces.length}` : ""}):`);
  show.forEach((d, j) => row(`${d.fromName} → ${d.toName}`, m.t + (j + 2) * rowH + 20, byTier(d.ids), xN, d.ids.length, false, `${d.ids.length}`, d));
  const hiM = mv.filter(i => tier(i) === 4).length / (mv.length || 1), hiS = st.filter(i => tier(i) === 4).length / (st.length || 1);
  svg.append("text").attr("x", m.l).attr("y", H - 6).style("font-size", "11px").style("font-weight", 600)
    .text(`High priority: ${d3.format(".0%")(hiM)} of movers vs ${d3.format(".0%")(hiS)} of those who stayed`);
}
// highlight a set of block groups in the network (null = clear)
function ensNodeFocus(list) {
  const on = list ? new Set(list) : null;
  d3.select("#ens-net .vor-nodes").selectAll("circle").classed("focus", i => !!on && on.has(i)).classed("faded", i => !!on && !on.has(i));
  if (on) d3.select("#ens-net .vor-nodes").selectAll("circle.focus").raise();
}
// dim every district but one in the network
function ensVorHighlight(label) {
  const M = ENS_MATCH[ensState.net];
  d3.select("#ens-net .vor-cells").selectAll("path").classed("dim", i => label != null && M[i] !== label);
}

function showEnsPage() { drawEnsNet(); }
function showRedistSlide() { drawEnsMaps(); }
d3.select('[data-view="redistview"]').on("click.redist", () => requestAnimationFrame(showRedistSlide));
// kept for the walkthrough: the page shows every cycle at once
function setEnsCycle() { showEnsPage(); }
d3.select("#ens-reset").on("click", () => { ensState.zoom = d3.zoomIdentity; showEnsPage(); });
d3.select('[data-view="ensview"]').on("click.ens", () => requestAnimationFrame(showEnsPage));
window.addEventListener("resize", () => {
  if (!document.getElementById("ensview").hidden) { d3.select("#ens-net").attr("data-w", null); showEnsPage(); }
  if (!document.getElementById("redistview").hidden) showRedistSlide();
});
