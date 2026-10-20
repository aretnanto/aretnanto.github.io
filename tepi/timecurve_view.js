// ---- Time curves (Bach et al., "Time Curves: Folding Time to Visualize
// Patterns of Temporal Evolution in Data", IEEE TVCG 22(1), 2016) ----
//
// A time curve has one point per time point (here: each ACS release). Its data
// snapshot aggregates all rows of an entity: for the county, group A or
// group B, each indicator is computed over all its block groups as
// sum(numerator) / sum(denominator) (median of block-group medians for
// income). We compute the distance between every pair of snapshots (6.1),
// place them with classical MDS (6.3, the paper's prototypes 2-4), join each
// entity's points in time order (6.4) and rotate so the county's first and
// last releases are level, first on the left (6.5).
//
// All curves share ONE MDS space, as in the paper's comparison of ten
// individuals (4.3, Fig. 13): curves that run close together mean similar
// profiles; a longer curve means more change.
const TC_SCALING = {
  z: "Block-group standard deviations",
  raw: "Raw values (percentage points)",
};
const TC_METRICS = {
  euclidean: "Euclidean",
  manhattan: "Manhattan",
  cosine: "Cosine (profile shape)",
};
const TC_ENTITIES = {
  county: { label: "County", color: "#8a8983", dash: "5 3" },
  A: { label: "Group A", color: GROUPS.A.color },
  B: { label: "Group B", color: GROUPS.B.color },
};
// layout "shared": every curve in one MDS space (compare groups, Fig. 13);
// "separate": each curve in its own MDS space, side by side (see each curve's
// shape, Fig. 11; not comparable across panels).
const tcState = { vars: [...INDICATORS], scaling: "z", metric: "euclidean", def: "tepi", layout: "separate", picked: null, span: 1990 };
// Time span: from 1990 (14 releases; 1990-2015/19 moved from older block
// groups by area weighting), from 2009-13 (12 releases, all indicators), or
// only the releases native to 2020 block groups (from 2016-20).
const TC_SPANS = { 1990: "Since 1990", 2013: "Since 2009–13", 2020: "2016–20 on (no interpolation)" };
const tcYears = () => YEARS.filter(y => y >= tcState.span);
const indName = k => (tcState.def === "std" && MAP.census.value[k + " (std)"] ? k + " (std)" : k);
const relLabel = yr => (yr < 2009 ? `Census ${yr}` : `ACS ${yr - 4}–${yr}`);
let TC = null; // { ents, points: [{ent, year, ids, prof, f, k, xy}], D, per }

// One entity's snapshot value for one indicator and release.
function aggregate(ids, k, y) {
  const V = MAP.census.value[k][y], N = MAP.census.den[k][y];
  if (isMoney(k)) return d3.median(ids, i => V[i]);
  let num = 0, den = 0;
  ids.forEach(i => { if (V[i] != null && N[i]) { num += V[i] * N[i]; den += N[i]; } });
  return den ? num / den : null;
}

function runTimeCurves() {
  const TY = tcYears();
  // only indicators measured in every release of the span (1990 and 2000 lack
  // health insurance and disability)
  const all = tcState.vars.map(indName);
  const vars = all.filter(k => TY.every(y => MAP.census.value[k][y] && MAP.census.value[k][y].some(v => v != null)));
  tcState.dropped = all.filter(k => !vars.includes(k));
  const ents = [["county", d3.range(NBG)], ...["A", "B"].filter(g => mapState.groups[g].size).map(g => [g, [...mapState.groups[g]]])];
  // Scale each indicator by its block-group spread (pooled over releases), so
  // a 1-unit move means the same for every indicator.
  const sd = vars.map(k => (tcState.scaling === "raw" ? 1 : d3.deviation(TY.flatMap(y => MAP.census.value[k][y].filter(v => v != null))) || 1));
  const points = [];
  ents.forEach(([ent, ids]) => TY.forEach(year => {
    const prof = vars.map(k => aggregate(ids, k, year));
    points.push({ ent, year, ids, prof, f: prof.map((v, j) => (v == null ? 0 : v / sd[j])) });
  }));
  const n = points.length, D = d3.range(n).map(() => new Array(n).fill(0)), per = {};
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const fa = points[a].f, fb = points[b].f;
    const parts = fa.map((v, j) => (tcState.metric === "manhattan" ? Math.abs(v - fb[j]) : (v - fb[j]) ** 2));
    let d;
    if (tcState.metric === "cosine") {
      d = 1 - d3.sum(fa, (v, j) => v * fb[j]) / (Math.hypot(...fa) * Math.hypot(...fb) || 1);
    } else d = tcState.metric === "manhattan" ? d3.sum(parts) : Math.sqrt(d3.sum(parts));
    D[a][b] = D[b][a] = d;
    per[a + "-" + b] = parts;
  }
  // 6.5: rotate so a curve's first and last releases are level, first on the left.
  const level = (Y, f, l) => {
    const ang = Math.atan2(Y[l][1] - Y[f][1], Y[l][0] - Y[f][0]);
    return Y.map(([x, y]) => [x * Math.cos(ang) + y * Math.sin(ang), -x * Math.sin(ang) + y * Math.cos(ang)]);
  };
  points.forEach((p, k) => (p.k = k));
  if (tcState.layout === "shared") {
    const Y = level(classicalMDS(D), 0, TY.length - 1); // levelled on the county curve
    points.forEach((p, k) => (p.xy = Y[k]));
  } else {
    ents.forEach(([ent]) => {
      const idx = points.filter(p => p.ent === ent).map(p => p.k);
      const Y = level(classicalMDS(idx.map(a => idx.map(b => D[a][b]))), 0, idx.length - 1);
      idx.forEach((k, j) => (points[k].xy = Y[j]));
    });
  }
  TC = { ents: ents.map(e => e[0]), points, D, per, years: TY, vars };
  tcLegend();
  drawTimeCurves();
}

// Classical (Torgerson) MDS: double-centre the squared distances and take the
// top two eigenvectors (power iteration with deflation; at most 15 points).
function classicalMDS(D) {
  const n = D.length;
  const D2 = D.map(r => r.map(v => v * v));
  const rowMean = D2.map(r => d3.mean(r)), all = d3.mean(rowMean);
  const B = D2.map((r, i) => r.map((v, j) => -(v - rowMean[i] - rowMean[j] + all) / 2));
  const Y = d3.range(n).map(() => [0, 0]);
  for (let c = 0; c < 2; c++) {
    let v = d3.range(n).map((_, i) => 1 + 0.37 * i);
    for (let it = 0; it < 1000; it++) {
      const w = B.map(row => d3.sum(row, (x, j) => x * v[j]));
      const norm = Math.hypot(...w) || 1;
      v = w.map(x => x / norm);
    }
    const lambda = d3.sum(B, (row, i) => v[i] * d3.sum(row, (x, j) => x * v[j]));
    v.forEach((x, i) => (Y[i][c] = x * Math.sqrt(Math.max(lambda, 0))));
    B.forEach((row, i) => row.forEach((_, j) => (row[j] -= lambda * v[i] * v[j])));
  }
  return Y;
}

// Points along the centripetal Catmull-Rom curve between p1 and p2 (the curve
// d3.curveCatmullRom.alpha(0.5) draws), so each segment can be its own path.
function crSegment(p0, p1, p2, p3, n = 16) {
  const knot = (a, b) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-6);
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const lerp = (a, b, ta, tb, t) => [0, 1].map(c => ((tb - t) * a[c] + (t - ta) * b[c]) / (tb - ta));
  return d3.range(n + 1).map(s => {
    const t = t1 + (t2 - t1) * s / n;
    const A1 = lerp(p0, p1, t0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
    return lerp(lerp(A1, A2, t0, t2, t), lerp(A2, A3, t1, t3, t), t1, t2, t);
  });
}

// Time is lightness within each curve's colour (light = first release, full
// colour = last), so hue stays free to identify the group.
const yearShade = (ent, year) => { const TY = TC ? TC.years : YEARS; return d3.interpolateRgb("#ffffff", TC_ENTITIES[ent].color)(0.25 + 0.75 * TY.indexOf(year) / (TY.length - 1)); };
const tcInterp = y => (MAP.census.interpolated || []).includes(y); // moved from older block groups

const tcSvg = d3.select("#tc");
function drawTimeCurves() {
  const box = tcSvg.node().getBoundingClientRect();
  if (!box.width || !TC) return;
  if (tcState.layout === "gap") return drawGapChart(box);
  const W = box.width, H = box.height || 300, m = 30, right = 70; // size from the panel's flex layout
  tcSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  // Panels: one for the shared space, or one per curve. Equal units on both
  // axes within a panel: distances between points are the message.
  const panels = tcState.layout === "shared" ? [TC.ents] : TC.ents.map(e => [e]);
  const pw = W / panels.length;
  const scaleFor = (ents, px) => {
    const pts = TC.points.filter(p => ents.includes(p.ent));
    const [x0, x1] = d3.extent(pts, p => p.xy[0]), [y0, y1] = d3.extent(pts, p => p.xy[1]);
    const iw = pw - (panels.length > 1 ? 30 : m + right), u = Math.max((x1 - x0) / iw, (y1 - y0) / (H - 2 * m)) || 1;
    const cx = px + (panels.length > 1 ? 15 + iw / 2 : m + iw / 2);
    return [v => cx + (v - (x0 + x1) / 2) / u, v => H / 2 - (v - (y0 + y1) / 2) / u];
  };
  const scales = {};
  panels.forEach((ents, k) => {
    tcSvg.append("rect").attr("class", "tc-frame").attr("x", k * pw).attr("width", pw).attr("height", H);
    const sc = scaleFor(ents, k * pw);
    ents.forEach(e => (scales[e] = sc));
  });

  TC.ents.forEach(ent => {
    const [sx, sy] = scales[ent];
    const E = TC_ENTITIES[ent], pts = TC.points.filter(p => p.ent === ent), xy = pts.map(p => [sx(p.xy[0]), sy(p.xy[1])]);
    const at = j => xy[Math.max(0, Math.min(xy.length - 1, j))];
    const g = tcSvg.append("g").attr("class", "tc-curve " + ent);
    for (let s = 0; s < xy.length - 1; s++) {
      const d = "M" + crSegment(at(s - 1), at(s), at(s + 1), at(s + 2)).join("L");
      // dotted where either end is interpolated from older block groups
      g.append("path").attr("class", "tc-seg").attr("d", d).attr("stroke", E.color)
        .attr("stroke-dasharray", tcInterp(pts[s].year) || tcInterp(pts[s + 1].year) ? "1.5 3" : E.dash || null);
      // wide invisible twin: hover a segment for what changed between two releases
      g.append("path").attr("class", "tc-seg-hit").attr("d", d)
        .on("mousemove", event => showTip(event, segTip(pts[s], pts[s + 1])))
        .on("mouseleave", hideTip);
    }
    g.selectAll("circle").data(pts).join("circle").attr("class", "tc-pt")
      .classed("picked", p => p.year === mapState.year && p.ent === tcState.picked)
      .attr("r", ent === "county" ? 5 : 7).attr("cx", (_, j) => xy[j][0]).attr("cy", (_, j) => xy[j][1])
      .attr("fill", p => yearShade(ent, p.year)).attr("stroke", E.color).attr("stroke-dasharray", p => (tcInterp(p.year) ? "2 2" : null))
      .on("mousemove", (event, p) => showTip(event, ptTip(p))).on("mouseleave", hideTip)
      .on("click", (event, p) => pickRelease(p));
    // label each curve at its last point, and mark its first and last releases
    const end = xy[xy.length - 1];
    if (tcState.layout === "shared") g.append("text").attr("class", "tc-label").attr("x", end[0] + 10).attr("y", end[1] + 4)
      .style("fill", ent === "county" ? "#52514e" : E.color).text(E.label);
    else g.append("text").attr("class", "tc-label").attr("x", panels.findIndex(p => p[0] === ent) * pw + 8).attr("y", 16)
      .style("fill", ent === "county" ? "#52514e" : E.color).text(E.label);
    [0, xy.length - 1].forEach(j => g.append("text").attr("class", "tc-year").attr("x", xy[j][0]).attr("y", xy[j][1] - 10).text(`’${String(pts[j].year).slice(2)}`));
  });
  d3.select("#tc-note").text(TC.ents.length > 1
    ? (tcState.layout === "shared"
      ? "Shared space: curves that run close together have similar profiles; a longer curve changed more. Hover a segment to see what changed; click a release to show it on the map."
      : "Separate spaces: each panel shows the shape of one curve (steady drift, reversal, jump); sizes and positions are not comparable across panels.")
    : "Select Group A (and B) on the map to add their curves. Hover a segment to see what changed; click a release to show it on the map.");
}

// Gap chart (layout "gap"): for each indicator, Group A minus Group B (or minus
// the county when only A is selected), release by release. A line chart of the
// same snapshots the time curves embed: does a gap close, hold or widen?
const GAP_COL = d3.scaleOrdinal(["#e15759", "#f28e2b", "#59a14f", "#b07aa1", "#9c755f", "#edc948", "#d37295", "#8c8c3c", "#7f7f7f", "#bab0ac"]); // no blue: blue means TEPI tier
function drawGapChart(box) {
  const W = box.width, H = box.height || 300, m = { l: 44, r: 128, t: 14, b: 24 };
  tcSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const A = [...mapState.groups.A], B = [...mapState.groups.B];
  if (!A.length) {
    tcSvg.append("text").attr("class", "muted").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("Select Group A (and B) on the map to see their gap");
    d3.select("#tc-note").text("");
    return;
  }
  const ref = B.length ? B : d3.range(NBG), refName = B.length ? "Group B" : "county";
  const TY = TC.years, vars = TC.vars.filter(k => !isMoney(k));
  const rows = vars.map(k => ({ k, pts: TY.map(y => { const a = aggregate(A, k, y), b = aggregate(ref, k, y); return { y, a, b, d: a == null || b == null ? null : a - b }; }).filter(p => p.d != null) }));
  const x = d3.scaleLinear(d3.extent(TY), [m.l, W - m.r]);
  const ext = d3.extent(rows.flatMap(r => r.pts.map(p => p.d)).concat([0]));
  const y = d3.scaleLinear(ext, [H - m.b, m.t]).nice();
  tcSvg.append("rect").attr("class", "tc-frame").attr("width", W).attr("height", H);
  tcSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(TY.filter(t => t < 2009 || t === TY[TY.length - 1] || (t % 2 === 1 && t !== TY[TY.length - 1] - 1))).tickFormat(t => (t < 2009 ? t : "’" + String(t).slice(2))).tickSize(3));
  tcSvg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(v => (v ? d3.format("+")(v) : "0")).tickSize(-(W - m.l - m.r)))
    .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4"));
  tcSvg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#8a8983");
  tcSvg.append("text").attr("class", "muted").attr("x", m.l + 4).attr("y", m.t + 2).attr("dy", "0.7em").style("font-size", "10px").text(`points: Group A − ${refName} (above 0 = A higher)`);
  // the release shown on the map
  if (TY.includes(mapState.year)) tcSvg.append("line").attr("x1", x(mapState.year)).attr("x2", x(mapState.year)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "#1f1f1f").attr("stroke-dasharray", "2 3");
  const line = d3.line().x(p => x(p.y)).y(p => y(p.d));
  const labels = [];
  rows.forEach(r => {
    const g = tcSvg.append("g").attr("class", "gap-line"), col = GAP_COL(r.k);
    for (let s = 0; s < r.pts.length - 1; s++) // dotted where a release is interpolated from older block groups
      g.append("path").attr("d", line([r.pts[s], r.pts[s + 1]])).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2)
        .attr("stroke-dasharray", tcInterp(r.pts[s].y) || tcInterp(r.pts[s + 1].y) ? "1.5 3" : null);
    g.selectAll("circle").data(r.pts).join("circle").attr("cx", p => x(p.y)).attr("cy", p => y(p.d)).attr("r", 3.2).attr("fill", col).style("cursor", "pointer")
      .on("mousemove", (e, p) => showTip(e, `<strong>${r.k}, ${relLabel(p.y)}</strong><br>Group A ${fmtVal(r.k, p.a)} · ${refName} ${fmtVal(r.k, p.b)}<br>gap <strong>${d3.format("+.1f")(p.d)} pts</strong>${tcInterp(p.y) ? '<br><span class="muted">moved from older block groups by area</span>' : ""}<br><span class="muted">Click to show this release on the map</span>`))
      .on("mouseleave", hideTip).on("click", (e, p) => pickRelease({ ent: "A", year: p.y }));
    const last = r.pts[r.pts.length - 1];
    if (last) labels.push({ k: r.k, col, y: y(last.d) });
  });
  // end labels, pushed apart so they do not overlap
  labels.sort((a, b) => a.y - b.y).forEach((l, j) => { if (j && l.y < labels[j - 1].y + 11) l.y = labels[j - 1].y + 11; });
  tcSvg.append("g").selectAll("text").data(labels).join("text").attr("x", W - m.r + 6).attr("y", l => l.y + 3.5).style("font-size", "10px").style("fill", l => l.col).text(l => l.k);
  d3.select("#tc-note").text("");
}

function ptTip(p) {
  const prev = TC.points.find(q => q.ent === p.ent && q.year === p.year - 1);
  return `<strong>${TC_ENTITIES[p.ent].label}, ACS ${relLabel(p.year)}</strong> <span class="muted">· ${p.ids.length} block groups</span>` +
    (prev ? `<br>Distance from ${relLabel(prev.year)}: ${d3.format(".3~g")(TC.D[prev.k][p.k])}` : "") +
    `<br><span class="muted">Click to show this release on the map</span>`;
}
// Segment tooltip: the distance between two releases and the indicators that
// moved most (share of the distance), with their values before and after.
function segTip(a, b) {
  const per = TC.per[Math.min(a.k, b.k) + "-" + Math.max(a.k, b.k)], tot = d3.sum(per) || 1;
  const items = tcState.vars.map((k, j) => ({ k, share: per[j] / tot, from: a.prof[j], to: b.prof[j] }))
    .sort((p, q) => q.share - p.share).slice(0, 4);
  return `<strong>${TC_ENTITIES[a.ent].label}: ${relLabel(a.year)} → ${relLabel(b.year)}</strong>` +
    `<br><span class="muted">Distance ${d3.format(".3~g")(TC.D[a.k][b.k])}. What changed most:</span>` +
    `<table class="tip-table">${items.map(d => `<tr><td>${d.k}</td><td>${fmtVal(d.k, d.from)} → <strong>${fmtVal(d.k, d.to)}</strong></td><td class="muted">${d3.format(".0%")(d.share)}</td></tr>`).join("")}</table>`;
}
// Click a release: show its TEPI tiers on the map.
function pickRelease(p) {
  tcState.picked = p.ent;
  mapState.year = p.year;
  setMapYearControl(p.year);
  updateMap();
  drawTimeCurves();
  document.dispatchEvent(new Event("release-change"));
}
// Groups changed on the map: rebuild the curves.
function updateTimeCurves() { runTimeCurves(); }

// ---- Controls ----
function buildTimeCurveControls() {
  const OPTIONS = [...INDICATORS, INCOME]; // income (2024 $) is optional; TEPI does not use it
  const box = d3.select("#tc-vars");
  const chip = box.selectAll("label").data(OPTIONS).join("label").attr("class", "var-chip");
  chip.append("input").attr("type", "checkbox").property("checked", k => tcState.vars.includes(k))
    .on("change", function (event, k) {
      const next = this.checked ? OPTIONS.filter(v => v === k || tcState.vars.includes(v)) : tcState.vars.filter(v => v !== k);
      if (!next.length) { this.checked = true; return; }
      tcState.vars = next;
      runTimeCurves();
      document.dispatchEvent(new Event("model-inputs"));
    });
  chip.append("span").text(k => k);
  d3.select("#tc-all").on("click", () => {
    tcState.vars = [...INDICATORS];
    box.selectAll("input").property("checked", k => k !== INCOME);
    runTimeCurves();
    document.dispatchEvent(new Event("model-inputs"));
  });
  // one TEPI domain at a time: Economic or Personal (the social indicators)
  const domainLeaves = id => { const out = []; (function walk(n) { n.children ? n.children.forEach(walk) : out.push(n.id); })(TEPI_TREE.children.find(d => d.id === id)); return out; };
  d3.selectAll("[data-domain]").on("click", function () {
    const keep = domainLeaves(this.dataset.domain);
    tcState.vars = INDICATORS.filter(k => keep.includes(k));
    box.selectAll("input").property("checked", k => keep.includes(k));
    runTimeCurves();
    document.dispatchEvent(new Event("model-inputs"));
  });
  d3.select("#tc-scaling").selectAll("option").data(Object.entries(TC_SCALING)).join("option").attr("value", d => d[0]).text(d => d[1]);
  d3.select("#tc-scaling").property("value", tcState.scaling).on("change", function () { tcState.scaling = this.value; runTimeCurves(); });
  d3.select("#tc-metric").selectAll("option").data(Object.entries(TC_METRICS)).join("option").attr("value", d => d[0]).text(d => d[1]);
  d3.select("#tc-metric").property("value", tcState.metric).on("change", function () { tcState.metric = this.value; runTimeCurves(); });
  d3.selectAll('input[name="tc-def"]').on("change", function () { tcState.def = this.value; runTimeCurves(); document.dispatchEvent(new Event("model-inputs")); });
  d3.selectAll('input[name="tc-layout"]').on("change", function () { tcState.layout = this.value; runTimeCurves(); });
  d3.select("#tc-span").selectAll("option").data(Object.entries(TC_SPANS)).join("option").attr("value", d => d[0]).text(d => d[1]);
  d3.select("#tc-span").property("value", tcState.span).on("change", function () { tcState.span = +this.value; runTimeCurves(); });
}
function tcLegend() {
  const TY = TC.years;
  d3.select("#tc-title").text(`${tcState.layout === "gap" ? "Gap over time" : "Time curves"}, ${relLabel(TY[0]).replace("ACS ", "")} → ${relLabel(TY[TY.length - 1]).replace("ACS ", "")}`);
  d3.select("#tc-legend").html(
    (tcState.layout === "gap" ? `<span class="legend-item">one line per indicator · dashed vertical: release on the map</span>` :
    `<span class="legend-item" title="Dot shade encodes the release: light = ${relLabel(TY[0])}, dark = ${relLabel(TY[TY.length - 1])}">light → dark = ${TY[0] < 2009 ? TY[0] : "’" + String(TY[0]).slice(2)} → ’${String(TY[TY.length - 1]).slice(2)}</span>` +
    Object.values(TC_ENTITIES).map(E => `<span class="legend-item"><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="${E.color}" stroke-width="2.5"${E.dash ? ` stroke-dasharray="${E.dash}"` : ""}/></svg>${E.label}</span>`).join("")) +
    (TY.some(tcInterp) ? `<span class="legend-item" title="Releases before 2016–20 are on older block groups; their counts were moved to today's block groups by area (assumes people are spread evenly within a block group). At the 2015–19 / 2016–20 seam, rates still correlate 0.80–0.90 across block groups, against 0.88–0.95 between two native releases."><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#52514e" stroke-width="2" stroke-dasharray="1.5 3"/></svg>interpolated from older block groups ⓘ</span>` : "") +
    (tcState.dropped && tcState.dropped.length ? `<span class="legend-item muted">not in every release, left out: ${tcState.dropped.join(", ")}</span>` : ""));
}

buildTimeCurveControls();
runTimeCurves();
