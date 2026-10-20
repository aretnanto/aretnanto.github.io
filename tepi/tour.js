// ---- Finding walkthroughs ("Show me") ----
// Each task's finding is replayed by driving the real interface: switching
// pages, setting controls, selecting block groups, moving sliders. A caption
// bar narrates each step. Steps advance on their own (pause with ⏸), or
// with Next / the → key; Esc ends the walkthrough. The numbers in the
// captions are computed from the same data when each step runs.
const tourWait = ms => new Promise(r => setTimeout(r, ms));
const tourGo = async view => { document.querySelector(`[data-view="${view}"]`).click(); window.scrollTo(0, 0); await tourWait(700); };
const tourSelect = (sel, v) => d3.select(sel).property("value", v).dispatch("change");
const tourYear = y => { d3.select("#map-year").property("value", YEARS.indexOf(y)).dispatch("input").dispatch("change"); };
// add block groups to a group one by one, so the selection is seen happening
async function tourPick(g, ids, ms = 1200) {
  setActive(g);
  const s = new Set();
  const step = Math.ceil(ids.length / 12); // large groups are added in about 12 batches
  for (let k = 0; k < ids.length; k += step) {
    ids.slice(k, k + step).forEach(i => s.add(i));
    setGroup(g, new Set(s));
    if (typeof updateNb === "function" && !document.getElementById("nbview").hidden) updateNb();
    await tourWait((ms * step) / ids.length);
  }
}
const tourClear = () => { setGroup("A", new Set()); setGroup("B", new Set()); setActive("A"); };
// slide a what-if input from its value to a target
async function tourSlide(key, to, ms = 1500) {
  const el = document.getElementById("wi-" + key), from = +el.value, n = 20;
  for (let k = 1; k <= n; k++) { el.value = from + ((to - from) * k) / n; el.dispatchEvent(new Event("input")); await tourWait(ms / n); }
}
const nbSetMode = m => document.querySelector(`#nb-mode [data-mode="${m}"]`).click();
const tierNow = (y, i) => tierIdx(TEPI_YEARS[y][i]);
const tourPct = d3.format(".0%"), tourPts = v => d3.format(".1f")(v);

// ---- T1 helpers: neighbourhoods in the similarity view vs distance on the map ----
// wait until the similarity view has finished its UMAP run
async function tourWaitDR(m = "umap") {
  for (let k = 0; k < 240 && !(DR && DR.method === m && DR.geo && !d3.select("#dr-status").text()); k++) await tourWait(250);
}
// the same geography check in the full 12-indicator space (no projection)
function tourHDSpread() {
  const { ids, X } = drFeatures(), pos = new Map(ids.map((i, r) => [i, r]));
  const d = (a, b) => d3.sum(X[pos.get(a)], (v, j) => (v - X[pos.get(b)][j]) ** 2);
  return d3.median(ids.filter((_, k) => k % 4 === 0), c => tourSpread(ids.slice().sort((a, b) => d(a, c) - d(b, c)).slice(0, 25)));
}
const tourCen = (() => { let C = null; return () => C || (C = d3.range(NBG).map(i => d3.geoPath().centroid(bgFeature(i)))); })();
const tourMiles = (a, b) => { const C = tourCen(); return Math.hypot(C[a][0] - C[b][0], C[a][1] - C[b][1]) / 5280; }; // state plane feet
const tourSpread = S => { let s = 0, n = 0; for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) { s += tourMiles(S[a], S[b]); n++; } return s / n; };
const tourTouch = S => { const set = new Set(S); return d3.mean(S, i => (NB_NEI[i].some(j => set.has(j)) ? 1 : 0)); };
// the 25 block groups nearest to one block group in the similarity view
function tourDRNear(seed, k = 25) {
  const p = DR.xy.get(seed), d = i => { const q = DR.xy.get(i); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  return DR.ids.slice().sort((a, b) => d(a) - d(b)).slice(0, k);
}
// random sets of 25 for comparison (fixed seed)
const tourRandom25 = () => { const r = nbRandom(3); return d3.range(200).map(() => { const a = DR.ids.slice(); for (let q = a.length - 1; q > 0; q--) { const b = Math.floor(r() * (q + 1)); [a[q], a[b]] = [a[b], a[q]]; } return a.slice(0, 25); }); };
const tourT1 = {};
function tourT1Stats() {
  const R = tourRandom25();
  tourT1.rand = d3.mean(R, tourSpread); tourT1.randTouch = d3.mean(R, tourTouch);
  const all = DR.ids.filter((_, k) => k % 4 === 0).map(s => tourDRNear(s)); // every 4th block group as a centre
  tourT1.med = d3.median(all, tourSpread); tourT1.medTouch = d3.median(all, tourTouch);
}
const tierMix = (S, y) => { const c = d3.rollup(S, v => v.length, i => tierNow(y, i)); const [t, n] = [...c].sort((a, b) => b[1] - a[1])[0]; return `${n} of ${S.length} ${TIERS[t]}`; };

// ---- T2 helpers: TEPI tiers of 1990, followed to today ----
const t2High = () => d3.range(NBG).filter(i => tierNow(1990, i) === 4), t2Low = () => d3.range(NBG).filter(i => tierNow(1990, i) === 0);
const t2Gap = (k, y) => aggregate(t2High(), k, y) - aggregate(t2Low(), k, y);
const tourDomain = d => document.querySelector(`[data-domain="${d}"]`).click();
const tourSpan = v => tourSelect("#tc-span", String(v));
const tourLayout = v => { const r = document.querySelector(`input[name="tc-layout"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event("change")); };

// ---- T4 helpers ----
function t3Stats(c) {
  const y = ensYear(c), M = ENS_MATCH[c], P = ENS_MATCH[ENS_CYCLES[ENS_CYCLES.indexOf(c) - 1]], t = i => tierNow(y, i);
  const moved = i => P && M[i] != null && P[i] != null && M[i] !== P[i]; // same rule as the network
  const ids = d3.range(NBG).filter(i => M[i] != null && t(i) != null), mv = ids.filter(moved), st = ids.filter(i => !moved(i));
  const share = (L, k) => L.filter(i => t(i) === k).length / (L.length || 1);
  const hiTo = d3.rollups(mv.filter(i => t(i) === 4), v => v.length, i => M.names.get(M[i])).sort((a, b) => b[1] - a[1]);
  return { mv, st, hiM: share(mv, 4), hiS: share(st, 4), loM: share(mv, 0) + share(mv, 1), loS: share(st, 0) + share(st, 1), hiTo, high: mv.filter(i => t(i) === 4) };
}
const tourCycle = async c => { for (let k = 0; k < 40 && !document.getElementById("ens-net").__pts; k++) await tourWait(100); ensVorShow(c, true); await tourWait(900); };
// the moved piece of 2011 -> 2021 with the most High-priority block groups
const t4TopPiece = () => ensPieces("2021").filter(p => p.moved).map(p => ({ ...p, high: p.ids.filter(i => tierNow(ensYear("2021"), i) === 4).length })).sort((a, b) => b.high - a.high)[0];

// ---- T5 helpers ----
const tourEps = async e => { privState.eps = e; syncPrivControls(); privUpdate(); for (let k = 0; k < 80 && privState.busy; k++) await tourWait(100); await tourWait(400); };
const tourFeat = async f => { document.querySelector(`#priv-feat [data-feat="${f}"]`).click(); await tourWait(600); for (let k = 0; k < 80 && privState.busy; k++) await tourWait(100); await tourWait(300); };
const knnAt = (f, e) => d3.median(privPCAStats(privState.curve.find(R => R.eps === e), f).knn);
const moranAt = e => d3.median(privState.curve.find(R => R.eps === e).moran);

const TOURS = {
  T2: { title: "T2 · If TEPI had existed since 1990…", steps: [
    { run: async () => { tourClear(); await tourGo("mapview"); tourYear(1990); },
      text: "TEPI recomputed retroactively from the 1990 Census (moved onto today's block groups by area). Which block groups would it have flagged then?" },
    { run: async () => { await tourPick("A", t2High()); await tourPick("B", t2Low()); },
      text: () => `Group A: the ${t2High().length} block groups in 1990's High tier; Group B: the ${t2Low().length} in its Low tier.` },
    { run: async () => { tourSpan(1990); tourDomain("Economic"); tourLayout("gap"); await tourWait(600); tourYear(2023); },
      text: () => `Gap chart, Economic inputs, 1990 → 2024: Group A minus Group B, one line per indicator. ${tourPct(d3.mean(t2High().filter(i => TEPI_YEARS[2023][i] != null), i => (tierNow(2023, i) === 4 ? 1 : 0)))} of 1990's High block groups are still High in 2019–23.` },
    { run: () => {},
      text: () => `Poverty, High minus Low: ${tourPts(t2Gap("Poverty", 1990))} pts in 1990, ${tourPts(t2Gap("Poverty", 2000))} in 2000, ${tourPts(t2Gap("Poverty", 2013))} after the 2008 recession (2009–13), ${tourPts(t2Gap("Poverty", 2024))} in 2020–24. Unemployment: ${tourPts(t2Gap("Unemployment", 1990))} → ${tourPts(t2Gap("Unemployment", 2024))} pts.` },
    { run: () => {},
      text: () => `But renters' cost burden never closed: ${tourPts(t2Gap("Cost-burdened renters", 1990))} pts in 1990, ${tourPts(t2Gap("Cost-burdened renters", 2024))} in 2020–24. The gaps that shrank are the ones the economy moves; housing cost did not.` },
  ] },
  T1: { title: "T1 · Are similar profiles neighbours?", steps: [
    { run: async () => { tourClear(); await tourGo("mapview"); tourYear(2023); tourLayout("separate"); document.getElementById("tc-all").click(); await tourWaitDR(); tourT1Stats(); },
      text: "Similarity view: UMAP of TEPI's 12 inputs, ACS 2019–23. Block groups with similar profiles sit close together; colour is the TEPI tier." },
    { run: () => tourPick("A", tourDRNear(54)),
      text: () => { const S = tourDRNear(54); return `Group A: 25 neighbours in the similarity view (${tierMix(S, 2023)}). On the map they lie ${tourPts(tourSpread(S))} miles apart on average; random sets of 25: ${tourPts(tourT1.rand)} miles.`; } },
    { run: () => tourPick("B", tourDRNear(224)),
      text: () => { const S = tourDRNear(224); return `Group B: another tight cluster (${tierMix(S, 2023)}), ${tourPts(tourSpread(S))} miles apart. Across all clusters of 25 the median is ${tourPts(tourT1.med)} miles: similar profiles are spread over the county, so the similarity view shows little geography.`; } },
    { run: async () => { const r = {}; for (const m of ["pca", "tsne", "umap"]) { tourSelect("#dr-method", m); await tourWaitDR(m); r[m] = DR.geo.med; } r.hd = tourHDSpread(); tourT1.methods = r; },
      text: () => { const r = tourT1.methods; return `Is it the method? Same check (bottom of the view) for every projection: PCA ${tourPts(r.pca)}, t-SNE ${tourPts(r.tsne)}, UMAP ${tourPts(r.umap)} miles, and ${tourPts(r.hd)} in the full 12-indicator space; random sets ${tourPts(tourT1.rand)}. Every method agrees: profile look-alikes are only slightly closer than random.`; } },
  ] },
  T3: { title: "T3 · Is TEPI tied to geography?", steps: [
    { run: async () => { tourClear(); tourYear(2023); await tourGo("nbview"); nbSetMode("lisa"); tourSelect("#nb-var", "TEPI"); },
      text: () => `The neighbour network shows the geography: TEPI's global Moran's I is ${d3.format(".2f")(moranI(TEPI_YEARS[2023], NB_NEI))}, and local Moran's I finds a High–High hot spot on the south and west side. Similar scores sit together, even where the profiles behind them differ (T1).` },
    { run: async () => { for (const y of [1990, 2000, 2013, 2023]) { d3.select(`#nb-year [data-year="${y}"]`).dispatch("click"); await tourWait(1300); } },
      text: "Step through the decades: the hot spot is there in every census since 1990." },
  ] },
  T4: { title: "T4 · Did redistricting move or gather high-priority areas?", steps: [
    { run: async () => { tourClear(); await tourGo("ensview"); await tourCycle("2011"); },
      text: () => { const s = t3Stats("2011"); return `2001 → 2011: old lines dashed, new lines solid; the pieces in between moved. ${s.mv.length} block groups changed district. Low and Low-Moderate priority are ${tourPct(s.loM)} of movers vs ${tourPct(s.loS)} of stayers; High is ${tourPct(s.hiM)} vs ${tourPct(s.hiS)}: the lines moved mostly lower-priority areas.`; } },
    { run: async () => { await tourCycle("2021"); },
      text: () => { const s = t3Stats("2021"); return `2011 → 2021: ${s.mv.length} moved; High is ${tourPct(s.hiM)} of movers vs ${tourPct(s.hiS)} of stayers, but they did not move evenly.`; } },
    { run: () => { ensPieceSelect(t4TopPiece().key); },
      text: () => { const p = t4TopPiece(), s = t3Stats("2021"); return `Click a piece: ${p.fromName} → ${p.toName} moved ${p.ids.length} block groups, ${p.high} of them High. High movers went mostly to ${s.hiTo.slice(0, 2).map(d => `${d[0]} (${d[1]})`).join(" and ")}.`; } },
    { run: async () => { ensPieceSelect(null); await tourCycle("all"); },
      text: () => { const ok = d3.range(NBG).filter(i => ensMoves(i) != null), t = i => tierNow(2023, i), g = k => ok.filter(i => ensMoves(i) === k && t(i) != null), hi = L => L.filter(i => t(i) === 4).length / (L.length || 1);
        return `All three plans: grey = core that never changed district (${g(0).length}), orange = margins moved once (${g(1).length}) or twice (${g(2).length}). High priority is ${tourPct(hi(g(0)))} of the core but ${tourPct(hi(g(1)))} and ${tourPct(hi(g(2)))} of the margins: redistricting redraws a lower-priority margin around a stable core.`; } },
  ] },
  T5: { title: "T5 · Would TEPI survive differential privacy?", steps: [
    { run: async () => { await tourGo("privview"); await tourFeat("all"); await tourEps(10); },
      text: "Laplace noise on every count behind TEPI (2019–23), TEPI recomputed, 20 runs per privacy budget ε. ε = 10: little noise." },
    { run: async () => { for (const e of [5, 2, 1, 0.5, 0.2, 0.1]) await tourEps(e); },
      text: () => `Down to ε = 0.1, global Moran's I barely moves (${d3.format(".2f")(moranAt(0.1))} vs ${d3.format(".2f")(PRIV_I0)} without noise): the geographic clustering is robust.` },
    { run: () => {},
      text: () => `The PCA neighbourhoods are not: ${tourPct(knnAt("all", 1))} of each block group's 10 nearest neighbours are kept at ε = 1, ${tourPct(knnAt("all", 0.1))} at ε = 0.1.` },
    { run: async () => { await tourEps(1); await tourFeat("Economic"); },
      text: () => `Economic inputs alone are the most fragile: ${tourPct(knnAt("Economic", 1))} kept at ε = 1, ${tourPct(knnAt("Economic", 0.1))} at ε = 0.1 (Personal: ${tourPct(knnAt("Personal", 1))}, ${tourPct(knnAt("Personal", 0.1))}). Their small counts, such as unemployment and no vehicle, carry the most noise.` },
  ] },
};

// ---- Engine ----
const tour = { id: null, k: 0, playing: true, token: 0 };
const DWELL = 5500;
async function tourStep(k) {
  const T = TOURS[tour.id], token = ++tour.token;
  tour.k = k;
  const text = T.steps[k].text;
  // computed captions read the interface's state, so they appear once the step has run
  d3.select("#tour-caption").text(typeof text === "function" ? "…" : text);
  d3.select("#tour-count").text(`${k + 1} / ${T.steps.length}`);
  d3.select("#tour-next").text(k === T.steps.length - 1 ? "Done" : "Next →");
  await T.steps[k].run();
  if (token !== tour.token) return;
  if (typeof text === "function") d3.select("#tour-caption").text(text());
  if (!tour.playing) return;
  await tourWait(DWELL);
  if (tour.playing && token === tour.token && tour.k === k && k < T.steps.length - 1) tourStep(k + 1);
}
function tourStart(id) {
  tour.id = id; tour.playing = true;
  d3.select("#tour-title").text(TOURS[id].title);
  d3.select("#tour-pause").text("⏸");
  d3.select("#tour-bar").property("hidden", false);
  tourStep(0);
}
function tourEnd() { tour.id = null; tour.token++; d3.select("#tour-bar").property("hidden", true); }
function tourNext() {
  if (!tour.id) return;
  if (tour.k >= TOURS[tour.id].steps.length - 1) tourEnd(); else tourStep(tour.k + 1);
}
d3.selectAll(".tour-btn").on("click", function () { tourStart(this.dataset.tour); });
d3.select("#tour-next").on("click", tourNext);
d3.select("#tour-close").on("click", tourEnd);
d3.select("#tour-pause").on("click", function () {
  tour.playing = !tour.playing;
  d3.select(this).text(tour.playing ? "⏸" : "▶");
  if (tour.playing) tourNext();
});
// While a walkthrough runs, → advances it and Esc ends it (page arrows are off).
document.addEventListener("keydown", e => {
  if (!tour.id) return;
  if (e.key === "ArrowRight") { e.stopImmediatePropagation(); tourNext(); }
  else if (e.key === "ArrowLeft") e.stopImmediatePropagation();
  else if (e.key === "Escape") tourEnd();
}, true);
