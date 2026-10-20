// ---- Similarity view: block groups projected by PCA, t-SNE or UMAP ----
// Each block group is one point, described by the model's indicators (the
// same indicators and definitions as the time curves) in the map's ACS
// release, z-scored across block groups. Nearby points have similar profiles.
// Lasso or click points to build Group A or B from similar block groups,
// wherever they are on the map.
//
// PCA uses Project 1's engine (ml_engine.js); t-SNE and UMAP use DruidJS
// (Cutura et al., 2020), optimised step by step so the layout animates.
// UMAP is the default; PCA is kept as the linear baseline (it reproduces
// Project 1's view), so one can see what the nonlinear methods add.
const DR_METHODS = {
  umap: "UMAP",
  tsne: "t-SNE",
  pca: "PCA (linear baseline)",
};
const drState = { method: "umap", perplexity: 30, iterations: 400, neighbors: 15, minDist: 0.1 };
let DR = null;   // { ids, xy: Map(i -> [x, y]), method, explained?, loadings? }
let drRun = 0;   // a new run cancels the one in progress

// Feature matrix for the map's release: block groups with every indicator.
function drFeatures() {
  const y = mapState.year;
  // indicators measured in this release (1990 and 2000 lack insurance and disability)
  const vars = tcState.vars.map(indName).filter(k => MAP.census.value[k][y] && MAP.census.value[k][y].some(v => v != null));
  const ids = d3.range(NBG).filter(i => vars.every(k => MAP.census.value[k][y][i] != null));
  const X = ids.map(() => []);
  vars.forEach(k => {
    const col = ids.map(i => MAP.census.value[k][y][i]);
    const mean = d3.mean(col), sd = d3.deviation(col) || 1;
    col.forEach((v, r) => X[r].push((v - mean) / sd));
  });
  return { ids, X, vars };
}

function runDR() {
  const run = ++drRun;
  const { ids, X, vars } = drFeatures();
  d3.select("#dr-geo").text("");
  const show = (Y, extra = {}) => { DR = { ids, xy: new Map(ids.map((i, r) => [i, Y[r]])), method: extra.method || drState.method, ...extra }; drawDR(); };
  if (drState.method === "pca" || vars.length < 2) {
    // PCA needs two columns; with a single indicator, spread points along one axis.
    const one = vars.length < 2;
    const { scores, explained, components } = pca2(one ? X.map(r => [r[0], 0]) : X);
    const names = one ? [vars[0], "(none)"] : vars;
    drStatus(one ? "Only one indicator chosen: PCA shown." : "");
    show(scores, { method: "pca", explained, loadings: components.map(c => c.map((w, j) => ({ k: names[j], w }))) });
    drGeoCheck();
    return;
  }
  if (!window.druid) {
    // offline: fall back to the PCA baseline
    drState.method = "pca";
    d3.select("#dr-method").property("value", "pca");
    syncDRParams();
    runDR();
    drStatus("DruidJS (t-SNE, UMAP) did not load, so PCA is shown.");
    return;
  }
  const total = drState.method === "tsne" ? drState.iterations : 300;
  const model = drState.method === "tsne"
    ? new druid.TSNE(X, { perplexity: drState.perplexity, epsilon: 10, seed: 1 })
    : new druid.UMAP(X, { n_neighbors: drState.neighbors, min_dist: drState.minDist, seed: 1 });
  const gen = model.generator(total);
  let step = 0;
  drStatus(drState.method === "tsne" ? "t-SNE: starting…" : "UMAP: starting…", true);
  const tick = () => {
    if (run !== drRun) return;
    const t0 = performance.now();
    let Y = null, finished = false;
    while (performance.now() - t0 < 30) {
      const r = gen.next();
      if (r.done) { finished = true; break; }
      Y = r.value; step++;
    }
    if (Y) show(Y);
    if (finished || step >= total) { drStatus(""); drGeoCheck(); return; }
    drStatus(`${drState.method === "tsne" ? "t-SNE iteration" : "UMAP epoch"} ${step} / ${total}`, true);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(() => setTimeout(tick)); // let the status paint first
}
// Geography check (T1): for every 4th block group, its 25 nearest neighbours in
// the current projection; how far apart do they lie on the map? Shown next to
// the same measure for random sets of 25, so any method can be compared.
const drCen = (() => { let C = null; return () => C || (C = d3.range(NBG).map(i => d3.geoPath().centroid(bgFeature(i)))); })();
const drSpread = S => { const C = drCen(); let s = 0, n = 0; for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) { s += Math.hypot(C[S[a]][0] - C[S[b]][0], C[S[a]][1] - C[S[b]][1]) / 5280; n++; } return s / n; }; // state plane feet -> miles
function drGeoCheck() {
  if (!DR) return;
  const ids = DR.ids, xy = DR.xy, d = (a, b) => Math.hypot(xy.get(a)[0] - xy.get(b)[0], xy.get(a)[1] - xy.get(b)[1]);
  const near = c => ids.slice().sort((a, b) => d(a, c) - d(b, c)).slice(0, 25);
  const r = nbRandom(3), rand = d3.range(200).map(() => { const a = ids.slice(); for (let q = a.length - 1; q > 0; q--) { const b = Math.floor(r() * (q + 1)); [a[q], a[b]] = [a[b], a[q]]; } return a.slice(0, 25); });
  DR.geo = { med: d3.median(ids.filter((_, k) => k % 4 === 0), c => drSpread(near(c))), rand: d3.mean(rand, drSpread) };
  d3.select("#dr-geo").text(`Geography check: 25 nearest here lie ${d3.format(".1f")(DR.geo.med)} mi apart on the map (random sets: ${d3.format(".1f")(DR.geo.rand)})`)
    .attr("title", "For every 4th block group, its 25 nearest neighbours in this projection: their average distance from each other on the map (median over block groups). Random sets of 25 for comparison. Close to random = similar profiles are spread over the county.");
}
function drStatus(text, running = false) {
  d3.select("#dr-status").text(text);
  d3.select("#dr-stop").property("hidden", !running);
}

const drSvg = d3.select("#dr");
let drLayer;
// PCA loadings: each indicator's weight in PC1 and PC2 (z-scored inputs), as
// diverging bars, + to the right and - to the left, largest first. A point far
// along PC1 is high on the + indicators and low on the - ones.
const LOAD_POS = "#e08214", LOAD_NEG = "#8073ac";
function drawLoadings(x0, y0, w, h) {
  const g = drSvg.append("g").attr("class", "dr-load").attr("transform", `translate(${x0},${y0})`);
  const half = h / 2, labelW = Math.min(118, w * 0.52), zx = labelW + (w - labelW) / 2, bw = (w - labelW) / 2 - 4;
  const maxW = d3.max(DR.loadings.flat(), d => Math.abs(d.w)) || 1;
  [0, 1].forEach(c => {
    const rows = [...DR.loadings[c]].sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    const top = c * half, rh = Math.min(13, (half - 18) / rows.length);
    g.append("text").attr("class", "load-title").attr("x", 0).attr("y", top + 10).text(`PC${c + 1} · ${d3.format(".0%")(DR.explained[c])} of variance`);
    g.append("line").attr("x1", zx).attr("x2", zx).attr("y1", top + 14).attr("y2", top + 16 + rows.length * rh).attr("stroke", "#8a8984");
    const r = g.append("g").selectAll("g").data(rows).join("g").attr("transform", (_, k) => `translate(0,${top + 16 + k * rh})`)
      .on("mousemove", (e, d) => showTip(e, `<strong>${d.k}</strong>: ${d3.format("+.2f")(d.w)} on PC${c + 1}<br><span class="muted">${d.w > 0 ? "higher" : "lower"} values push a block group ${d.w > 0 ? "right / up" : "left / down"} along PC${c + 1}</span>`))
      .on("mouseleave", hideTip);
    r.append("text").attr("class", "load-label").attr("x", labelW - 4).attr("y", rh * 0.75).attr("text-anchor", "end")
      .text(d => (d.k.length > 22 ? d.k.slice(0, 21) + "…" : d.k));
    r.append("rect").attr("x", d => (d.w >= 0 ? zx : zx - (Math.abs(d.w) / maxW) * bw)).attr("y", 1)
      .attr("width", d => (Math.abs(d.w) / maxW) * bw).attr("height", Math.max(2, rh - 3)).attr("fill", d => (d.w >= 0 ? LOAD_POS : LOAD_NEG));
  });
  g.append("text").attr("class", "load-label").attr("x", zx - 4).attr("y", h - 2).attr("text-anchor", "end").style("fill", LOAD_NEG).text("← negative");
  g.append("text").attr("class", "load-label").attr("x", zx + 4).attr("y", h - 2).style("fill", LOAD_POS).text("positive →");
}

function drawDR() {
  const box = drSvg.node().getBoundingClientRect();
  if (!box.width || !DR) return;
  const W = box.width, H = box.height || 320, m = { l: 30, r: 8, t: 6, b: 26 }; // size from the panel's flex layout
  // PCA: keep room on the right for the loadings of PC1 and PC2
  const LP = DR.method === "pca" && DR.loadings ? Math.min(250, W * 0.38) : 0;
  m.r += LP;
  drSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  // equal units on both axes; trim the extreme 1% so outliers don't squash the rest
  const pts = [...DR.xy.values()];
  const q = (a, p) => d3.quantile(pts, p, d => d[a]);
  const [x0, x1, y0, y1] = [q(0, 0.005), q(0, 0.995), q(1, 0.005), q(1, 0.995)];
  const iw = W - m.l - m.r, ih = H - m.t - m.b, u = Math.max((x1 - x0) / iw, (y1 - y0) / ih) || 1;
  const x = v => m.l + iw / 2 + (v - (x0 + x1) / 2) / u, y = v => m.t + ih / 2 - (v - (y0 + y1) / 2) / u;

  // t-SNE / UMAP axes have no units (only nearness matters); PCA axes are
  // named by their two largest loadings.
  const axis = c => DR.method !== "pca"
    ? `${DR.method === "tsne" ? "t-SNE" : "UMAP"} ${c + 1}`
    : `PC${c + 1} (${d3.format(".0%")(DR.explained[c])}): ` + [...DR.loadings[c]].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 2)
      .map(d => `${d.w > 0 ? "+" : "−"}${d.k}`).join(", ");
  drSvg.append("text").attr("class", "axis-title").attr("x", W - m.r).attr("y", H - 8).attr("text-anchor", "end").text(axis(0) + " →");
  drSvg.append("text").attr("class", "axis-title").attr("transform", `translate(14,${m.t}) rotate(-90)`).attr("text-anchor", "end").text(axis(1) + " →");
  drSvg.append("clipPath").attr("id", "dr-clip").append("rect").attr("x", m.l).attr("y", m.t).attr("width", iw).attr("height", ih);
  drSvg.append("rect").attr("class", "dr-frame").attr("x", m.l).attr("y", m.t).attr("width", iw).attr("height", ih)
    .on("click", () => setGroup(mapState.active, new Set()));
  drLayer = drSvg.append("g").attr("clip-path", "url(#dr-clip)").append("g");
  drLayer.selectAll("circle").data(DR.ids).join("circle").attr("class", "dr-pt")
    .attr("cx", i => x(DR.xy.get(i)[0])).attr("cy", i => y(DR.xy.get(i)[1])).attr("r", 4)
    .attr("fill", i => (tierIdx(tepiPct(i)) == null ? "#d5d4ce" : TIER_FILL(tierIdx(tepiPct(i)))))
    .on("mousemove", (event, i) => { showTip(event, bgTip(i)); mapHighlight(i); })
    .on("mouseleave", () => { hideTip(); mapHighlight(null); })
    .on("click", (event, i) => { event.stopPropagation(); clickBg(event, i); });

  if (LP) drawLoadings(W - LP + 6, m.t, LP - 8, H - m.t - 4);

  // Zoom with pinch / Ctrl+wheel (plain scroll moves the page); drag = lasso.
  const zoom = d3.zoom().scaleExtent([0.5, 20]).filter(e => e.type === "wheel" && (e.ctrlKey || e.metaKey))
    .on("zoom", ({ transform }) => { drLayer.attr("transform", transform); drLayer.selectAll("circle").attr("r", 4 / transform.k); });
  drSvg.call(zoom);
  d3.select("#dr-reset").on("click", () => drSvg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
  const lasso = drSvg.append("path").attr("class", "lasso");
  let lp = [];
  drSvg.call(d3.drag()
    .on("start", () => { lp = []; })
    .on("drag", e => { lp.push([e.x, e.y]); lasso.attr("d", "M" + lp.join("L") + "Z"); })
    .on("end", e => {
      lasso.attr("d", null);
      if (lp.length < 3) return;
      const t = d3.zoomTransform(drSvg.node());
      const s = e.sourceEvent.shiftKey ? new Set(mapState.groups[mapState.active]) : new Set();
      DR.ids.filter(i => d3.polygonContains(lp, t.apply([x(DR.xy.get(i)[0]), y(DR.xy.get(i)[1])]))).forEach(i => s.add(i));
      setGroup(mapState.active, s);
    }));
  const missing = NBG - DR.ids.length;
  d3.select("#dr-legend").attr("title", `${DR.ids.length} block groups in the ${relName(mapState.year)} release` +
    (missing ? ` (${missing} lack one of the chosen indicators)` : "") + `; ${tcState.vars.length} indicators, z-scored.`);
  updateDR();
}

// Group membership and dimming (called whenever the groups change).
function updateDR() {
  if (!drLayer) return;
  const any = anySelected();
  drLayer.selectAll(".dr-pt")
    .classed("pickA", i => mapState.groups.A.has(i)).classed("pickB", i => mapState.groups.B.has(i))
    .classed("dim", i => any && !groupOf(i));
  drLayer.selectAll(".pickA, .pickB").raise();
}
// Outline one block group's point (called from map hover).
function drHighlight(i) {
  if (!drLayer) return;
  drLayer.selectAll(".dr-pt").classed("hl", j => j === i).filter(j => j === i).raise();
}

// ---- Controls ----
function buildDRControls() {
  d3.select("#dr-legend").html(`<span class="legend-title">TEPI tier:</span>` +
    TIERS.map((n, t) => `<span class="legend-item"><span class="swatch dotswatch" style="background:${TIER_FILL(t)}"></span>${n}</span>`).join("") +
    `<span class="legend-item"><span class="swatch dotswatch" style="background:#fff;border:2px solid ${GROUPS.A.color}"></span>A</span>` +
    `<span class="legend-item"><span class="swatch dotswatch" style="background:#fff;border:2px dashed ${GROUPS.B.color}"></span>B</span>`);
  d3.select("#dr-legend").select(".legend-title").text("TEPI tier:");
  d3.select("#dr-method").selectAll("option").data(Object.entries(DR_METHODS)).join("option").attr("value", d => d[0]).text(d => d[1]);
  d3.select("#dr-method").property("value", drState.method).on("change", function () { drState.method = this.value; syncDRParams(); runDR(); });
  const param = (id, key, fmt = d => d) => d3.select(id).property("value", drState[key])
    .on("input", function () { drState[key] = +this.value; d3.select(id + "-out").text(fmt(+this.value)); })
    .on("change", runDR)
    .each(() => d3.select(id + "-out").text(fmt(drState[key])));
  param("#dr-perplexity", "perplexity");
  param("#dr-iterations", "iterations");
  param("#dr-neighbors", "neighbors");
  param("#dr-mindist", "minDist", d3.format(".2f"));
  d3.select("#dr-stop").on("click", () => { drRun++; drStatus("Stopped."); });
  syncDRParams();
}
function syncDRParams() {
  d3.selectAll(".dr-param").property("hidden", function () { return this.dataset.method !== drState.method; });
}

buildDRControls();
document.addEventListener("model-inputs", runDR);   // indicators or definitions changed
document.addEventListener("release-change", runDR); // map release changed
runDR();
showMapPage();

// Close the model drawer when clicking anywhere outside it.
document.addEventListener("click", event => {
  const drawer = document.querySelector(".model-drawer");
  if (drawer && drawer.open && !drawer.contains(event.target)) drawer.open = false;
});
