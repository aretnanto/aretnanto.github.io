// ---- Political analysis page ----
// Where each redistricting's lines put the county's High-priority residents,
// and how Tucson's mayoral vote changed (2011, 2019, 2023):
//   * map: block groups (TEPI tier, a mayoral election's Democratic share, or
//     its change from the previous election) under the 2001, 2011 or 2021
//     state legislative district lines;
//   * trend chart: Democratic mayoral share by TEPI tier across the elections;
//   * district chart: residents of each district by TEPI tier, and its vote;
//   * histogram: TEPI percentiles of the clicked district's residents.
// TEPI tiers are held fixed (the dashboard's ACS release) so that only the
// vote changes. Descriptive only: district lines come from Arizona's
// redistricting commission and can be shaped by the Voting Rights Act; vote
// figures are precinct results split by area (local_prep.py).
const DIST = window.DISTRICT_DATA;   // 2021 lines: block-group split shares (tooltip)
const ELEC = window.ELECTION_DATA;   // district lines of each redistricting cycle
// race null = colour by TEPI tier; change = difference from the previous election
const distState = { cycle: "2021", kind: "ld", /* state legislative only */ race: null, change: false, district: null };
const LOCAL = window.LOCAL_DATA || {};
const MAYORS = ["Mayor (2011)", "Mayor (2019)", "Mayor (2023)"]; // 2015 left out: unopposed
const MAYOR_TAG = { "Mayor (2011)": "Rothschild, open seat", "Mayor (2019)": "Romero, open seat", "Mayor (2023)": "Romero, incumbent" };
const LOCAL_COLOR = d3.scaleDiverging([20, 50, 80], d3.interpolatePRGn).clamp(true);
const CHANGE_COLOR = d3.scaleDiverging([-20, 0, 20], d3.interpolatePuOr).clamp(true);
const prevRace = r => MAYORS[MAYORS.indexOf(r) - 1];
const showChange = () => distState.change && !!prevRace(distState.race);
// share (%) for the Democratic candidate in block group i
const shareIn = (race, i) => { const b = LOCAL[race].bg[i]; return b ? (100 * b[0]) / b[1] : null; };
// the mapped value: share, or change in points from the previous election
const bgShare = i => {
  if (!distState.race) return null;
  const s = shareIn(distState.race, i);
  if (!showChange()) return s;
  const p = shareIn(prevRace(distState.race), i);
  return s == null || p == null ? null : s - p;
};
const valColor = v => (showChange() ? CHANGE_COLOR(v) : LOCAL_COLOR(v));
// [Democratic votes, total] summed over block groups
const voteOf = (race, ids) => ids.reduce((acc, i) => { const b = LOCAL[race].bg[i]; if (b) { acc[0] += b[0]; acc[1] += b[1]; } return acc; }, [0, 0]);
const pctOf = v => (v[1] < 50 ? null : (100 * v[0]) / v[1]);
const distVal = d => {
  const s = pctOf(voteOf(distState.race, d.ids));
  if (!showChange()) return s;
  const p = pctOf(voteOf(prevRace(distState.race), d.ids));
  return s == null || p == null ? null : s - p;
};
const fmtDistVal = v => (v == null ? "—" : showChange() ? d3.format("+.0f")(v) : d3.format(".0f")(v) + "%");

const plan = () => ELEC.plans[distState.cycle][distState.kind];
const distOf = i => plan().bg[i];
const distList = () => plan().districts.map(d => Object.assign(d, { ids: d.ids || d3.range(NBG).filter(i => distOf(i) === d.code) }));
const distHighlighted = i => distState.district == null || distOf(i) === distState.district;

// ---- District map ----
const dmapSvg = d3.select("#dmap");
let dmapG, dmapPath;
function drawDistMap() {
  const box = dmapSvg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height;
  dmapSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const proj = d3.geoIdentity().reflectY(true).fitExtent([[10, 10], [W - 10, H - 10]], MAP.focus);
  dmapPath = d3.geoPath(proj);
  dmapSvg.append("rect").attr("width", W).attr("height", H).attr("fill", "var(--surface)")
    .on("click", () => { distState.district = null; updateDistViews(); });
  dmapG = dmapSvg.append("g");
  dmapG.append("g").selectAll("path").data(d3.range(NBG)).join("path").attr("class", "bg")
    .attr("d", i => dmapPath(bgFeature(i)))
    .on("mousemove", (event, i) => showTip(event, distTip(i)))
    .on("mouseleave", hideTip)
    .on("click", (event, i) => {
      event.stopPropagation();
      const d = distOf(i);
      distState.district = distState.district === d ? null : d;
      updateDistViews();
    });
  const dists = distList();
  dmapG.append("g").selectAll("path").data(dists).join("path").attr("class", "district").attr("d", d => dmapPath(d.geometry));
  // label each district at the mean centre of its block groups (inside the county)
  dmapG.append("g").selectAll("text").data(dists).join("text").attr("class", "dlabel")
    .attr("transform", d => {
      const c = d3.range(NBG).filter(i => distOf(i) === d.code).map(i => dmapPath.centroid(bgFeature(i)));
      return `translate(${d3.mean(c, p => p[0])},${d3.mean(c, p => p[1])})`;
    }).text(d => d.short);
  const zoom = d3.zoom().scaleExtent([0.3, 16])
    .filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : true))
    .on("zoom", ({ transform }) => dmapG.attr("transform", transform));
  dmapSvg.call(zoom).on("dblclick.zoom", null);
  dmapG.attr("transform", d3.zoomTransform(dmapSvg.node()));
  d3.select("#dmap-reset").on("click", () => dmapSvg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
  updateDistMap();
}
function updateDistMap() {
  if (!dmapG) return;
  const fill = distState.race
    ? i => (bgShare(i) == null ? "#f3f2ee" : valColor(bgShare(i)))
    : i => (tierIdx(tepiPct(i)) == null ? "#f3f2ee" : TIER_FILL(tierIdx(tepiPct(i))));
  dmapG.selectAll(".bg").attr("fill", fill).classed("dim", i => !distHighlighted(i));
  dmapG.selectAll(".district").classed("on", d => d.code === distState.district);
  const lg = d3.select("#dmap-legend").html("");
  if (distState.race) {
    const R = LOCAL[distState.race], col = showChange() ? CHANGE_COLOR : LOCAL_COLOR;
    lg.append("span").attr("class", "legend-title").text(showChange()
      ? `Change in Democratic mayoral share, ${prevRace(distState.race).match(/\d{4}/)[0]} → ${R.date.slice(-4)} (points):`
      : `${R.label} (${R.date}), share for ${R.ref}:`);
    lg.append("span").attr("class", "legend-item").html(showChange()
      ? `−20 <span class="ramp" style="background:linear-gradient(90deg,${d3.range(-20, 21, 4).map(col).join(",")})"></span> +20`
      : `20% or less <span class="ramp" style="background:linear-gradient(90deg,${d3.range(20, 81, 6).map(col).join(",")})"></span> 80%+`);
    lg.append("span").attr("class", "legend-item").html('<span class="swatch" style="background:#f3f2ee;border:1px solid #d5d4ce"></span>Outside the City or under 10 votes');
  } else {
    lg.append("span").attr("class", "legend-title").text(`TEPI tier (recomputed, ACS ${mapState.year - 4}–${String(mapState.year).slice(2)}):`);
    TIERS.forEach((n, t) => lg.append("span").attr("class", "legend-item").html(`<span class="swatch" style="background:${TIER_FILL(t)}"></span>${n}`));
  }
  lg.append("span").attr("class", "legend-item").html(`<svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#1f1f1f" stroke-width="2"/></svg>${distState.cycle} district lines`);
}
function distTip(i) {
  const d = distList().find(x => x.code === distOf(i)), v = bgShare(i);
  const share = distState.cycle === "2021" ? DIST[distState.kind].share[i] : 1; // split shares known for the 2021 lines
  const p = tepiPct(i);
  return `<strong>${bgLabel(i)}</strong> <span class="muted">· pop. ${d3.format(",")(popOf(i))}</span>` +
    `<br>TEPI (ACS ${mapState.year - 4}–${String(mapState.year).slice(2)}): ${p == null ? "n/a" : `<strong>${tierOf(p)}</strong>`}` +
    (!distState.race ? "" : MAYORS.map(r => { const x = shareIn(r, i); return `<br>${r.match(/\d{4}/)[0]} ${LOCAL[r].ref}: ${x == null ? "—" : `about ${d3.format(".0f")(x)}%`}`; }).join("") +
      (showChange() && v != null ? `<br>Change: <strong>${d3.format("+.0f")(v)}</strong> points` : "")) +
    `<br>${d ? `${d.short} (${distState.cycle} lines)` : "No district"}${share < 0.95 ? ` <span class="muted">(${d3.format(".0%")(share)} of its area; split by a district line)</span>` : ""}`;
}

// ---- District chart: residents by TEPI tier ----
const dbarsSvg = d3.select("#dbars");
function drawDistBars() {
  const box = dbarsSvg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height;
  dbarsSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const hiTotal = d3.sum(d3.range(NBG).filter(i => tierIdx(tepiPct(i)) === 4), i => popOf(i));
  const rows = distList().map(d => {
    const ids = d3.range(NBG).filter(i => distOf(i) === d.code), pop = d3.sum(ids, i => popOf(i));
    const byTier = TIERS.map((_, t) => d3.sum(ids.filter(i => tierIdx(tepiPct(i)) === t), i => popOf(i)));
    return { ...d, ids, pop, byTier, highShare: byTier[4] / pop, ofCounty: byTier[4] / hiTotal };
  }).sort((a, b) => b.highShare - a.highShare);
  const left = 56, right = distState.race ? 160 : 90, top = 22, rh = Math.min(30, (H - top - 8) / rows.length);
  const x = d3.scaleLinear([0, 1], [left, W - right]);
  dbarsSvg.append("text").attr("x", left).attr("y", 12).attr("class", "muted").text("Residents by TEPI tier of their block group (Low → High)");
  dbarsSvg.append("text").attr("x", W - right + 8).attr("y", 12).attr("class", "muted").text("of county High");
  if (distState.race) dbarsSvg.append("text").attr("x", W - 4).attr("y", 12).attr("class", "muted").attr("text-anchor", "end").text(showChange() ? "change" : `% ${LOCAL[distState.race].ref.split(" ")[0]}`);
  const row = dbarsSvg.append("g").selectAll("g").data(rows).join("g").attr("class", "row")
    .classed("on", d => d.code === distState.district)
    .attr("transform", (_, k) => `translate(0,${top + k * rh})`)
    .on("click", (_, d) => { distState.district = distState.district === d.code ? null : d.code; updateDistViews(); })
    .on("mousemove", (event, d) => showTip(event, `<strong>${d.name}</strong> <span class="muted">(Pima County part: ${d.ids.length} block groups, ${d3.format(",")(d.pop)} people)</span>` +
      `<br>${TIERS.map((n, t) => `${n}: ${d3.format(".0%")(d.byTier[t] / d.pop)}`).join(" · ")}` +
      `<br>Holds <strong>${d3.format(".0%")(d.ofCounty)}</strong> of the county's residents in High-priority block groups` +
      MAYORS.map(r => { const v = voteOf(r, d.ids); return v[1] < 50 ? `<br>${r}: no City votes in this district` :
        `<br>${r} (estimated): ${d3.format(".0%")(v[0] / v[1])} for ${LOCAL[r].ref} of ${d3.format(",.0f")(v[1])} votes`; }).join("")))
    .on("mouseleave", hideTip);
  row.append("rect").attr("class", "row-bg").attr("x", 0).attr("width", W).attr("height", rh - 2).attr("fill", "transparent");
  row.append("text").attr("class", "row-name").attr("x", 4).attr("y", rh / 2 + 3).text(d => d.short);
  row.each(function (d) {
    let acc = 0;
    d3.select(this).selectAll("rect.seg").data(d.byTier).join("rect").attr("class", "seg")
      .attr("x", v => { const x0 = x(acc / d.pop); acc += v; return x0; }).attr("y", 3)
      .attr("width", v => Math.max(0, x(v / d.pop) - x(0) - 1)).attr("height", rh - 8)
      .attr("fill", (_, t) => TIER_FILL(t));
  });
  row.append("text").attr("x", W - right + 8).attr("y", rh / 2 + 3).text(d => d3.format(".0%")(d.ofCounty));
  // local vote: a small swatch in the vote colour plus the share for the reference choice
  if (!distState.race) return;
  row.append("rect").attr("x", W - 70).attr("y", rh / 2 - 5).attr("width", 10).attr("height", 10).attr("rx", 2)
    .attr("fill", d => (distVal(d) == null ? "#f3f2ee" : valColor(distVal(d))));
  row.append("text").attr("x", W - 4).attr("y", rh / 2 + 3).attr("text-anchor", "end").text(d => fmtDistVal(distVal(d)));
}

// ---- Histogram: TEPI percentiles of the selected district's residents ----
function drawDistHist() {
  const svg = d3.select("#dhist"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, m = { l: 44, r: 10, t: 30, b: 28 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const rel = `ACS ${mapState.year - 4}–${String(mapState.year).slice(2)}`;
  const d = distList().find(x => x.code === distState.district);
  if (!d) {
    d3.select("#dlow-title").text(`TEPI distribution in a district (${rel})`);
    svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").style("font-size", "12px")
      .text("Click a district in the chart above or on the map");
    return;
  }
  d3.select("#dlow-title").text(`${d.short} (${distState.cycle} lines): TEPI percentiles, ${rel}`);
  const ids = d3.range(NBG).filter(i => distOf(i) === d.code && tepiPct(i) != null);
  const pop = d3.sum(ids, popOf);
  const bins = d3.range(0, 100, 5).map(x0 => ({ x0, x1: x0 + 5, pop: 0, n: 0 }));
  ids.forEach(i => { const b = bins[Math.min(19, Math.floor(tepiPct(i) / 5))]; b.pop += popOf(i); b.n++; });
  const x = d3.scaleLinear([0, 100], [m.l, W - m.r]);
  const even = pop / 20; // residents per bin if the district had the county's even spread
  const y = d3.scaleLinear([0, Math.max(even, d3.max(bins, b => b.pop))], [H - m.b, m.t]).nice();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues([0, 20, 40, 60, 80, 100]).tickSize(3))
    .call(a => a.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4, "~s").tickSize(-(W - m.l - m.r)))
    .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4"));
  svg.append("text").attr("x", W - m.r).attr("y", H - 2).attr("text-anchor", "end").text("TEPI percentile of the block group →");
  svg.append("text").attr("transform", `translate(10,${m.t}) rotate(-90)`).attr("text-anchor", "end").text("residents");
  svg.selectAll("rect.bar").data(bins).join("rect").attr("class", "bar")
    .attr("x", b => x(b.x0) + 1).attr("width", b => x(b.x1) - x(b.x0) - 2)
    .attr("y", b => y(b.pop)).attr("height", b => y(0) - y(b.pop)).attr("fill", b => TIER_FILL(tierIdx(b.x0)))
    .on("mousemove", (event, b) => showTip(event, `<strong>${d3.format(",")(b.pop)}</strong> residents in ${b.n} block groups<br><span class="muted">TEPI percentile ${b.x0}–${b.x1}</span>`))
    .on("mouseleave", hideTip);
  svg.append("line").attr("class", "even").attr("x1", x(0)).attr("x2", x(100)).attr("y1", y(even)).attr("y2", y(even));
  // summary: residents in each tier vs the 20% an even spread would give
  const tierShare = TIERS.map((_, t) => d3.sum(ids.filter(i => tierIdx(tepiPct(i)) === t), popOf) / pop);
  const wMedian = (() => { const s = ids.slice().sort((a, b) => tepiPct(a) - tepiPct(b)); let acc = 0; for (const i of s) { acc += popOf(i); if (acc >= pop / 2) return tepiPct(i); } return null; })();
  svg.append("text").attr("class", "hstat").attr("x", m.l).attr("y", 14)
    .text(`${ids.length} block groups, ${d3.format(",")(pop)} residents · median percentile ${d3.format(".0f")(wMedian)} · High ${d3.format(".0%")(tierShare[4])}, Low ${d3.format(".0%")(tierShare[0])} (even spread: 20% each)`);
}

// ---- Trend: Democratic mayoral share by TEPI tier, election by election ----
function drawDistTrend() {
  const svg = d3.select("#dtrend"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, m = { l: 40, r: 110, t: 24, b: 34 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const d = distList().find(x => x.code === distState.district);
  const pool = d ? d.ids : d3.range(NBG);
  d3.select("#dtrend-title").text(`Mayoral vote by TEPI tier, 2011 → 2023${d ? ` · ${d.short} (${distState.cycle} lines)` : ""}`);
  const series = TIERS.map((name, t) => ({ name, t, vals: MAYORS.map(r => pctOf(voteOf(r, pool.filter(i => tierIdx(tepiPct(i)) === t)))) }));
  const all = MAYORS.map(r => pctOf(voteOf(r, pool)));
  const vals = series.flatMap(s => s.vals).concat(all).filter(v => v != null);
  if (!vals.length) {
    svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("No City votes in this district");
    return;
  }
  const x = d3.scalePoint(MAYORS, [m.l, W - m.r]).padding(0.3);
  const y = d3.scaleLinear(d3.extent(vals), [H - m.b, m.t]).nice();
  // election columns: click to colour the map by that election
  const col = svg.append("g").selectAll("g").data(MAYORS).join("g").attr("class", "col").classed("on", r => r === distState.race)
    .on("click", (_, r) => setRace(r));
  col.append("rect").attr("x", r => x(r) - x.step() / 2).attr("width", x.step()).attr("y", m.t - 14).attr("height", H - m.t - m.b + 14 + 30);
  col.append("text").attr("x", r => x(r)).attr("y", H - m.b + 16).attr("text-anchor", "middle").style("font-weight", 700).text(r => r.match(/\d{4}/)[0]);
  col.append("text").attr("class", "muted").attr("x", r => x(r)).attr("y", H - m.b + 29).attr("text-anchor", "middle").text(r => MAYOR_TAG[r]);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(v => v + "%").tickSize(-(W - m.l - m.r)))
    .call(a => a.select(".domain").remove()).call(a => a.selectAll("line").attr("stroke", "#eceae4")).style("pointer-events", "none");
  const line = d3.line().defined(v => v != null).x((_, k) => x(MAYORS[k])).y(v => y(v));
  svg.append("path").attr("class", "all").attr("d", line(all));
  const g = svg.append("g").selectAll("g").data(series).join("g").style("pointer-events", "none");
  g.append("path").attr("d", s => line(s.vals)).attr("fill", "none").attr("stroke", s => TIER_FILL(s.t)).attr("stroke-width", s => (s.t === 4 || s.t === 0 ? 3 : 1.6));
  g.selectAll("circle").data(s => s.vals.map(v => ({ v, s }))).join("circle").filter(p => p.v != null)
    .attr("cx", (_, k) => x(MAYORS[k])).attr("cy", p => y(p.v)).attr("r", 3.5).attr("fill", p => TIER_FILL(p.s.t));
  // end labels, nudged apart
  const ends = series.map(s => ({ s, y: y(s.vals[2] ?? s.vals[1] ?? s.vals[0]) })).sort((a, b) => a.y - b.y);
  ends.forEach((e, k) => { if (k) e.y = Math.max(e.y, ends[k - 1].y + 12); });
  svg.append("g").selectAll("text").data(ends).join("text").attr("x", W - m.r + 8).attr("y", e => e.y + 4)
    .style("fill", e => (e.s.t > 1 ? TIER_FILL(e.s.t) : "var(--text-muted)")).text(e => `${e.s.name} ${fmtTierPct(e.s.vals[2])}`);
  // High − Low gap per election
  const gap = MAYORS.map((_, k) => (series[4].vals[k] == null || series[0].vals[k] == null ? null : series[4].vals[k] - series[0].vals[k]));
  svg.append("text").attr("x", m.l).attr("y", 12).text(`High − Low gap: ${MAYORS.map((r, k) => `${r.match(/\d{4}/)[0]} ${gap[k] == null ? "—" : d3.format("+.0f")(gap[k])}`).join(" · ")} points`);
  svg.append("text").attr("class", "muted").attr("x", W - m.r + 8).attr("y", 12).text(`- - all City ${fmtTierPct(all[2])}`);
}
const fmtTierPct = v => (v == null ? "—" : d3.format(".0f")(v) + "%");

function setRace(r) {
  distState.race = r || null;
  d3.selectAll("#dist-race button").attr("aria-pressed", function () { return (this.dataset.race || null) === distState.race; });
  d3.select("#dist-change").property("disabled", !prevRace(distState.race));
  updateDistViews();
}
function updateDistViews() { updateDistMap(); drawDistBars(); drawDistTrend(); drawDistHist(); }
function showDistPage() { drawDistMap(); drawDistBars(); drawDistTrend(); drawDistHist(); }

d3.selectAll("#dist-cycle [data-cycle]").on("click", function () {
  distState.cycle = this.dataset.cycle;
  distState.district = null;
  d3.selectAll("#dist-cycle [data-cycle]").attr("aria-pressed", function () { return this.dataset.cycle === distState.cycle; });
  showDistPage();
});
// colour buttons: TEPI tier, or one of the mayoral elections
d3.select("#dist-race").selectAll("button").data([null, ...MAYORS]).join("button").attr("class", "tool")
  .attr("data-race", r => r || "").attr("aria-pressed", r => r === distState.race)
  .attr("title", r => (r ? `${LOCAL[r].label} (${LOCAL[r].date})` : "TEPI tier (recomputed)"))
  .text(r => (r ? `Mayor ${r.match(/\d{4}/)[0]}` : "TEPI tier")).on("click", (_, r) => setRace(r));
d3.select("#dist-change").on("change", function () { distState.change = this.checked; updateDistViews(); });
d3.select('[data-view="distview"]').on("click.dist", () => requestAnimationFrame(showDistPage));
window.addEventListener("resize", () => { if (!document.getElementById("distview").hidden) showDistPage(); });
