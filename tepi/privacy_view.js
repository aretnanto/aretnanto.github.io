// ---- Privacy page: does TEPI survive census-style privacy protection? ----
// The 2019-23 inputs (the release TEPI uses) are perturbed many times the way
// the Census Bureau protects respondents, TEPI is recomputed after each
// perturbation, and the views show how much its answers move:
// Differential privacy only: Laplace noise of scale 1/epsilon added to every
// count (numerators and denominators); the textbook mechanism (the 2020 Census's
// TopDown uses discrete Gaussian noise under zCDP), rounded back to
// non-negative whole counts as TopDown does (simplified: no
// post-processing to consistent totals across geographies). Robustness
// checked for two results: global Moran's I of TEPI on the neighbour network,
// and the PCA projection (do nearest neighbours stay neighbours?).
// TEPI is recomputed in the browser with the same tree as tepi_years.py
// (checked against it on load).
const PRIV_YEAR = 2023;
const PRIV_NOT_ACS = ["Unemployment", "Children", "Seniors"]; // TEPI's own values (not an ACS release)
const privState = { eps: 1, feat: "all", busy: false, res: null, curve: null };

// inputs: value (%), denominator and MOE per indicator and block group
const PRIV_IN = INDICATORS.map(k => ({
  k,
  v: PRIV_NOT_ACS.includes(k) ? VALUES[k].slice() : MAP.census.value[k][PRIV_YEAR].slice(),
  den: MAP.census.den[k][PRIV_YEAR].map(d => (d == null ? null : d)),
  moe: MAP.census.moe[k][PRIV_YEAR].map(m => (m == null ? null : m)),
}));

// ---- TEPI, recomputed (same rules as tepi_years.py) ----
const privLeaves = n => (n.children ? n.children.flatMap(privLeaves) : [n.id]);
function privPct(arr, mask) {
  // (rank - 1) / (n - 1) x 100, ties share the lowest rank, over rows in mask
  const idx = [], n = arr.length;
  for (let i = 0; i < n; i++) if (mask[i] && arr[i] != null && !Number.isNaN(arr[i])) idx.push(i);
  const r = Math.round, key = i => r(arr[i] * 1e9) / 1e9;
  idx.sort((a, b) => key(a) - key(b));
  const out = new Array(n).fill(null), m = idx.length;
  let rank = 0;
  for (let q = 0; q < m; q++) {
    if (q === 0 || key(idx[q]) !== key(idx[q - 1])) rank = q;
    out[idx[q]] = m > 1 ? (rank / (m - 1)) * 100 : 0;
  }
  return out;
}
function privValue(node, X, n) {
  if (!node.children) return X[node.id];
  const leaves = privLeaves(node), complete = d3.range(n).map(i => leaves.every(k => X[k][i] != null && !Number.isNaN(X[k][i])));
  const parts = node.children.map(c => privPct(privValue(c, X, n), complete));
  return d3.range(n).map(i => (complete[i] ? d3.mean(parts, p => p[i]) : null));
}
function privTEPI(X) {
  const n = NBG, leaves = privLeaves(TEPI_TREE), complete = d3.range(n).map(i => leaves.every(k => X[k][i] != null && !Number.isNaN(X[k][i])));
  return privPct(privValue(TEPI_TREE, X, n), complete);
}
const privTier = p => (p == null ? null : Math.min(Math.floor(p / 20), 4));
const PRIV_BASE = privTEPI(Object.fromEntries(PRIV_IN.map(d => [d.k, d.v])));
const PRIV_BASE_TIER = PRIV_BASE.map(privTier);

// ---- Differential privacy on the counts ----
function privLaplace(rand, b) { const u = rand() - 0.5; return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); }
function privPerturb(rand, eps = privState.eps) {
  const b = 1 / eps, X = {};
  PRIV_IN.forEach(d => {
    X[d.k] = d.v.map((v, i) => {
      const den = d.den[i];
      if (v == null || den == null || !(den > 0)) return v;
      const num = (v / 100) * den;
      // post-processing as the Census does: noisy counts back to non-negative whole numbers
      const den2 = Math.max(1, Math.round(den + privLaplace(rand, b))), num2 = Math.min(den2, Math.max(0, Math.round(num + privLaplace(rand, b))));
      return (100 * num2) / den2;
    });
  });
  return X;
}

// ---- Downstream analyses, unperturbed baselines ----
// hot spots: local Moran's I of the TEPI percentile (99 permutations, p < 0.05)
function privLisa(x, rand) {
  const ok = d3.range(NBG).filter(i => x[i] != null), mean = d3.mean(ok, i => x[i]), sd = d3.deviation(ok, i => x[i]) || 1;
  const z = x.map(v => (v == null ? null : (v - mean) / sd)), zs = ok.map(i => z[i]), nz = zs.length, pos = new Map(ok.map((i, a) => [i, a]));
  return d3.range(NBG).map(i => {
    if (z[i] == null) return false;
    const nb = NB_NEI[i].filter(j => z[j] != null);
    if (!nb.length) return false;
    const lag = d3.mean(nb, j => z[j]), Ii = z[i] * lag, self = pos.get(i);
    if (!(z[i] > 0 && lag > 0)) return false;
    let ext = 0;
    for (let r = 0; r < 99; r++) { let s = 0; for (let m = 0; m < nb.length; m++) { const a = Math.floor(rand() * (nz - 1)); s += zs[a >= self ? a + 1 : a]; } if (z[i] * (s / nb.length) >= Ii) ext++; }
    return (ext + 1) / 100 < 0.05; // High-High hot spot
  });
}
// PCA of the standardised inputs (TEPI's 12, or one TEPI domain); perturbed
// runs are projected on the noise-free axes
const privDomain = id => { const out = []; (function walk(n) { n.children ? n.children.forEach(walk) : out.push(n.id); })(TEPI_TREE.children.find(d => d.id === id)); return out; };
const PRIV_FEATS = { all: INDICATORS, Economic: privDomain("Economic"), Personal: privDomain("Personal") };
const PRIV_FEAT_LABEL = { all: "TEPI's 12 inputs", Economic: "the Economic inputs", Personal: "the Personal (social) inputs" };
const PRIV_OK = d3.range(NBG).filter(i => PRIV_IN.every(d => d.v[i] != null));
const PRIV_X0 = Object.fromEntries(PRIV_IN.map(d => [d.k, d.v]));
const PRIV_K = 10;
// neighbour preservation is checked on a fixed sample of 150 block groups (speed)
const PRIV_SAMPLE = (() => { const r = nbRandom(5), idx = d3.range(PRIV_OK.length); for (let a = idx.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); [idx[a], idx[b]] = [idx[b], idx[a]]; } return idx.slice(0, 150); })();
function privKNN(P) {
  return PRIV_SAMPLE.map(a => { const p = P[a]; return d3.range(P.length).filter(b => b !== a).map(b => [b, (P[b][0] - p[0]) ** 2 + (P[b][1] - p[1]) ** 2])
    .sort((x, y) => x[1] - y[1]).slice(0, PRIV_K).map(d => d[0]); });
}
const privModels = {};
function privModel(feat) {
  if (privModels[feat]) return privModels[feat];
  const keys = PRIV_FEATS[feat];
  const MS = keys.map(k => { const v = PRIV_OK.map(i => PRIV_X0[k][i]); return [d3.mean(v), d3.deviation(v) || 1]; });
  const Z = X => PRIV_OK.map(i => keys.map((k, q) => (X[k][i] - MS[q][0]) / MS[q][1]));
  const pca = pca2(Z(PRIV_X0));
  const project = X => Z(X).map(z => pca.components.map(c => d3.sum(c, (w, q) => w * z[q])));
  const P0 = project(PRIV_X0);
  return (privModels[feat] = { project, P0, KNN0: privKNN(P0) });
}

// One run = noise on every count -> TEPI recomputed -> global Moran's I of the
// TEPI percentile on the neighbour network. The noisy inputs are kept, so the
// PCA check (share of each sampled block group's 10 nearest neighbours that
// stay its neighbours, and how far each block group moves) can be redone for
// any set of inputs.
const PRIV_I0 = moranI(PRIV_BASE, NB_NEI);
function privRun(runs, eps, seed = 7) {
  const rand = nbRandom(seed), moran = [], Xs = [];
  for (let r = 0; r < runs; r++) {
    const X = privPerturb(rand, eps);
    moran.push(moranI(privTEPI(X), NB_NEI));
    Xs.push(X);
  }
  return { eps, moran, Xs, pca: {} };
}
function privPCAStats(R, feat) {
  if (R.pca[feat]) return R.pca[feat];
  const M = privModel(feat), knn = [], disp = new Array(PRIV_OK.length).fill(0);
  R.Xs.forEach(X => {
    const P = M.project(X);
    P.forEach((p, a) => { disp[a] += Math.hypot(p[0] - M.P0[a][0], p[1] - M.P0[a][1]); });
    const K = privKNN(P);
    knn.push(d3.mean(K, (nb, s) => nb.filter(b => M.KNN0[s].includes(b)).length / PRIV_K));
  });
  return (R.pca[feat] = { knn, disp: disp.map(d => d / R.Xs.length) });
}
const PRIV_EPS = [0.1, 0.2, 0.5, 1, 2, 5, 10];
const PRIV_RUNS = 20;

// ---- Views ----
// A strip per epsilon: one dot per noisy run, a bar at the median, the
// noise-free value as a dashed line.
function drawPrivStrip(id, key, label, domain, fmt, ref) {
  const svg = d3.select(id), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height || !privState.curve) return;
  const W = box.width, H = box.height, m = { l: 52, r: 14, t: 14, b: 36 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const x = d3.scalePoint(PRIV_EPS, [W - m.r - 20, m.l + 20]), y = d3.scaleLinear(domain, [H - m.b, m.t]).nice();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickFormat(d3.format("~g")).tickSize(3));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, fmt).tickSize(-(W - m.l - m.r)))
    .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4"));
  svg.append("text").attr("class", "muted").attr("x", (m.l + W - m.r) / 2).attr("y", H - 4).attr("text-anchor", "middle").text("← less noise · privacy budget ε · more noise →");
  // current setting
  svg.append("rect").attr("x", x(privState.eps) - 16).attr("width", 32).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", "#f0efec");
  if (ref != null) {
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(ref)).attr("y2", y(ref)).attr("stroke", "#1f1f1f").attr("stroke-dasharray", "5 3");
    svg.append("text").attr("x", m.l + 4).attr("y", y(ref) - 5).style("font-weight", 600).text(`without noise: ${d3.format(fmt)(ref)}`);
  }
  privState.curve.forEach(R => {
    const v = typeof key === "function" ? key(R) : R[key], cx = x(R.eps), jit = k => ((k * 37) % 11 - 5) * 1.6;
    svg.append("g").selectAll("circle").data(v).join("circle").attr("cx", (_, k) => cx + jit(k)).attr("cy", d => y(d)).attr("r", 2.6)
      .attr("fill", "#e8710a").attr("fill-opacity", 0.55);
    const med = d3.median(v);
    svg.append("line").attr("x1", cx - 12).attr("x2", cx + 12).attr("y1", y(med)).attr("y2", y(med)).attr("stroke", "#1f1f1f").attr("stroke-width", 2.5);
    svg.append("rect").attr("x", cx - 16).attr("width", 32).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", "transparent").style("cursor", "pointer")
      .on("mousemove", e => showTip(e, `ε = ${R.eps}: ${label} median ${d3.format(fmt)(med)}, range ${d3.format(fmt)(d3.min(v))}–${d3.format(fmt)(d3.max(v))} over ${v.length} runs`))
      .on("mouseleave", hideTip).on("click", () => { privState.eps = R.eps; syncPrivControls(); privUpdate(); });
  });
}
// PCA at the chosen epsilon: dots without noise, rings = average move under noise
function drawPrivPCA() {
  const svg = d3.select("#priv-pca"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height || !privState.res) return;
  const W = box.width, H = box.height, m = 14, M = privModel(privState.feat), PRIV_P0 = M.P0, R = { eps: privState.res.eps, ...privPCAStats(privState.res, privState.feat) };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const g = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.5, 16]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : true)).on("zoom", ({ transform }) => g.attr("transform", transform)));
  const xs = d3.extent(PRIV_P0, p => p[0]), ys = d3.extent(PRIV_P0, p => p[1]);
  const u = Math.max((xs[1] - xs[0]) / (W - 2 * m), (ys[1] - ys[0]) / (H - 2 * m));
  const ox = (W - 2 * m - (xs[1] - xs[0]) / u) / 2, oy = (H - 2 * m - (ys[1] - ys[0]) / u) / 2; // centre the plot
  const x = v => m + ox + (v - xs[0]) / u, y = v => H - m - oy - (v - ys[0]) / u;
  g.append("g").selectAll("circle").data(PRIV_OK).join("circle")
    .attr("cx", (_, a) => x(PRIV_P0[a][0])).attr("cy", (_, a) => y(PRIV_P0[a][1])).attr("r", (_, a) => Math.max(1.5, R.disp[a] / u))
    .attr("fill", "#e8710a").attr("fill-opacity", 0.08).attr("stroke", "#e8710a").attr("stroke-opacity", 0.3);
  g.append("g").selectAll("circle").data(PRIV_OK).join("circle").attr("r", 2.4)
    .attr("cx", (_, a) => x(PRIV_P0[a][0])).attr("cy", (_, a) => y(PRIV_P0[a][1]))
    .attr("fill", i => (PRIV_BASE_TIER[i] == null ? "#ccc" : TIER_FILL(PRIV_BASE_TIER[i])))
    .on("mousemove", (e, i) => { const a = PRIV_OK.indexOf(i); showTip(e, `<strong>${bgLabel(i)}</strong><br>TEPI ${PRIV_BASE[i] == null ? "n/a" : TIERS[PRIV_BASE_TIER[i]]}<br>moves ${d3.format(".2f")(R.disp[a])} on average at ε = ${R.eps}`); })
    .on("mouseleave", hideTip);
  d3.select("#priv-pca-legend").html(`<span class="legend-item">PCA of ${PRIV_FEAT_LABEL[privState.feat]} without noise · dot colour: TEPI tier · orange ring: average move under noise at ε = ${R.eps}</span>`);
}
function privDrawAll() {
  // Moran's I on its full 0-1 scale (0 = no spatial pattern), so small wobbles look small
  drawPrivStrip("#priv-moran", "moran", "global Moran's I", [0, 1], ".2f", PRIV_I0);
  drawPrivStrip("#priv-knn", R => privPCAStats(R, privState.feat).knn, "neighbours kept", [0, 1], ".0%", 1);
  drawPrivPCA();
}
function privUpdate(force) {
  if (privState.busy && !force) return;
  privState.busy = true;
  d3.select("#priv-status").text("Running…");
  setTimeout(() => {
    const t0 = performance.now();
    if (!privState.curve) privState.curve = PRIV_EPS.map((e, k) => privRun(PRIV_RUNS, e, 11 + k));
    privState.res = privState.curve.find(R => R.eps === privState.eps);
    privState.busy = false;
    const R = privState.res;
    d3.select("#priv-status").html(`ε = ${privState.eps}: Moran's I ${d3.format(".2f")(d3.median(R.moran))} (without noise ${d3.format(".2f")(PRIV_I0)}) · ` +
      `${d3.format(".0%")(d3.median(privPCAStats(R, privState.feat).knn))} of PCA neighbours kept · ${PRIV_RUNS} runs per ε${performance.now() - t0 > 200 ? `, ${d3.format(".1f")((performance.now() - t0) / 1000)} s` : ""}`);
    privDrawAll();
  }, 30);
}
function syncPrivControls() {
  d3.select("#priv-eps").property("value", PRIV_EPS.indexOf(privState.eps));
  d3.select("#priv-eps-out").text(privState.eps);
}
d3.select("#priv-eps").on("input", function () { privState.eps = PRIV_EPS[+this.value]; syncPrivControls(); privUpdate(); });
d3.selectAll("#priv-feat [data-feat]").on("click", function () {
  privState.feat = this.dataset.feat;
  d3.selectAll("#priv-feat [data-feat]").attr("aria-pressed", function () { return this.dataset.feat === privState.feat; });
  if (!privState.res) return;
  d3.select("#priv-status").text("Running…");
  setTimeout(() => { privUpdate(true); }, 30);
});
function showPrivPage() { syncPrivControls(); if (!privState.res) privUpdate(); else privDrawAll(); }
d3.select('[data-view="privview"]').on("click.priv", () => requestAnimationFrame(showPrivPage));
window.addEventListener("resize", () => { if (!document.getElementById("privview").hidden) privDrawAll(); });
