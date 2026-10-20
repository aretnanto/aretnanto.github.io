// ---- Data & preprocessing page ----
// How our Census-based indicators compare with TEPI's published values:
//   * small multiples: our ACS value (selected release) vs TEPI's value, per indicator;
//   * match grid: % of block groups matching, by indicator x release;
//   * map: where the selected indicator does not match (TEPI minus ours);
//   * TEPI recomputed for the release vs the published TEPI.
// Hovering a block group highlights it in every panel and on the map.
const PREP_ORDER = ["Poverty", "No health insurance", "HS education or less", "Low English proficiency",
  "Disability", "People of color", "Cost-burdened owners", "Cost-burdened renters", "No vehicle",
  "Unemployment", "Children", "Seniors"];
const PREP_NOT_ACS = new Set(["Unemployment", "Children", "Seniors"]);
const PREP_TOL = 0.15; // TEPI rounds to 2 decimals
const PREP_MATCH = "#2f6b9a", PREP_MISS = "#c9c8c2";
const prepState = { year: 2023, ind: "Poverty", hover: null };
// exact matching only makes sense for releases published on 2020 block groups
const PREP_YEARS = YEARS.filter(y => !INTERP.has(y));

const ours = (k, y = prepState.year) => MAP.census.value[k][y];
const theirs = k => VALUES[k]; // TEPI's published value (TEPI CSV, same block-group order)
const matches = (k, y, i) => ours(k, y)[i] != null && theirs(k)[i] != null && Math.abs(ours(k, y)[i] - theirs(k)[i]) < PREP_TOL;
const exactShare = (k, y) => {
  const ids = d3.range(NBG).filter(i => ours(k, y)[i] != null && theirs(k)[i] != null);
  return d3.mean(ids, i => (matches(k, y, i) ? 1 : 0));
};
const pearson = (a, b) => {
  const ma = d3.mean(a), mb = d3.mean(b);
  return d3.sum(a, (v, j) => (v - ma) * (b[j] - mb)) / Math.sqrt(d3.sum(a, v => (v - ma) ** 2) * d3.sum(b, v => (v - mb) ** 2));
};
const ranks = a => { const o = d3.range(a.length).sort((x, y) => a[x] - a[y]), r = new Array(a.length); o.forEach((k, j) => (r[k] = j)); return r; };
const fmtPct = d3.format(".0%");

function prepTip(i, k = prepState.ind) {
  const a = ours(k)[i], b = theirs(k)[i];
  return `<strong>${bgLabel(i)}</strong><br>${k}: ours (${relLabel(prepState.year)}) <strong>${a == null ? "n/a" : d3.format(".2f")(a) + "%"}</strong>, ` +
    `TEPI <strong>${b == null ? "n/a" : d3.format(".2f")(b) + "%"}</strong>` +
    (a != null && b != null ? `<br><span class="muted">difference ${d3.format("+.2f")(b - a)} points · ${Math.abs(b - a) < PREP_TOL ? "matches" : "does not match"}</span>` : "");
}
function prepHover(i) {
  prepState.hover = i;
  d3.selectAll("#prep-sm .pt").classed("hl", j => j === i).filter(j => j === i).raise();
  d3.selectAll("#prep-map .bg").classed("hl", j => j === i).filter(j => j === i).raise();
}

// ---- Small multiples ----
function drawPrepSM() {
  const svg = d3.select("#prep-sm"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, cols = 4, rows = 3, gx = 14, gy = 10;
  const pw = (W - gx * (cols - 1)) / cols, ph = (H - gy * (rows - 1)) / rows;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  PREP_ORDER.forEach((k, n) => {
    const g = svg.append("g").attr("transform", `translate(${(n % cols) * (pw + gx)},${Math.floor(n / cols) * (ph + gy)})`);
    const ids = d3.range(NBG).filter(i => ours(k)[i] != null && theirs(k)[i] != null);
    const xs = ids.map(i => ours(k)[i]), ys = ids.map(i => theirs(k)[i]);
    const lim = Math.max(d3.quantile([...xs].sort(d3.ascending), 0.995), d3.quantile([...ys].sort(d3.ascending), 0.995)) * 1.05 || 1;
    const top = 26, left = 26, size = Math.min(pw - left - 6, ph - top - 18);
    const x = d3.scaleLinear([0, lim], [left, left + size]).clamp(true), y = d3.scaleLinear([0, lim], [top + size, top]).clamp(true);
    g.append("rect").attr("class", "sm-frame" + (k === prepState.ind ? " on" : "")).attr("x", left).attr("y", top).attr("width", size).attr("height", size);
    g.append("line").attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(lim)).attr("y2", y(lim)).attr("stroke", "#85847e").attr("stroke-dasharray", "3 3");
    g.append("g").attr("transform", `translate(0,${top + size})`).call(d3.axisBottom(x).ticks(3).tickSize(3)).call(a => a.select(".domain").remove());
    g.append("g").attr("transform", `translate(${left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(3)).call(a => a.select(".domain").remove());
    g.append("rect").attr("class", "panel-hit").attr("x", 0).attr("y", 0).attr("width", pw).attr("height", ph)
      .on("click", () => { prepState.ind = k; drawPrepAll(); });
    // draw mismatches first so matching dots sit on top
    const order = ids.slice().sort((a, b) => matches(k, prepState.year, a) - matches(k, prepState.year, b));
    g.append("g").selectAll("circle").data(order).join("circle").attr("class", "pt").attr("r", 1.8)
      .attr("cx", i => x(ours(k)[i])).attr("cy", i => y(theirs(k)[i]))
      .attr("fill", i => (matches(k, prepState.year, i) ? PREP_MATCH : PREP_MISS))
      .on("mouseenter", (event, i) => prepHover(i))
      .on("mousemove", (event, i) => showTip(event, prepTip(i, k)))
      .on("mouseleave", () => { hideTip(); prepHover(null); })
      .on("click", () => { prepState.ind = k; drawPrepAll(); });
    g.append("text").attr("class", "sm-title" + (PREP_NOT_ACS.has(k) ? " notacs" : "")).attr("x", left).attr("y", 10).text(k + (PREP_NOT_ACS.has(k) ? " (not ACS)" : ""));
    g.append("text").attr("x", left).attr("y", 22).text(`r = ${d3.format(".3f")(pearson(xs, ys))} · match ${fmtPct(exactShare(k, prepState.year))}`);
  });
}

// ---- Match grid: indicator x release ----
function drawPrepHeat() {
  const svg = d3.select("#prep-heat"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, left = 150, top = 16;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const cw = (W - left - 4) / PREP_YEARS.length, ch = (H - top - 2) / PREP_ORDER.length;
  const shade = d3.scaleSequential([0, 1], t => d3.interpolateBlues(0.08 + 0.85 * t));
  PREP_YEARS.forEach((y, c) => svg.append("text").attr("x", left + (c + 0.5) * cw).attr("y", 11).attr("text-anchor", "middle")
    .style("font-weight", y === prepState.year ? 700 : 400).text(`’${String(y - 4).slice(2)}–’${String(y).slice(2)}`));
  PREP_ORDER.forEach((k, r) => {
    svg.append("text").attr("x", left - 6).attr("y", top + (r + 0.5) * ch + 3.5).attr("text-anchor", "end")
      .style("font-weight", k === prepState.ind ? 700 : 400).style("fill", PREP_NOT_ACS.has(k) ? "#c2410c" : null).text(k);
    PREP_YEARS.forEach((y, c) => {
      const v = exactShare(k, y);
      const g = svg.append("g").attr("class", "cell" + (k === prepState.ind && y === prepState.year ? " on" : ""))
        .attr("transform", `translate(${left + c * cw},${top + r * ch})`)
        .on("click", () => { prepState.ind = k; prepState.year = y; drawPrepAll(); })
        .on("mousemove", event => showTip(event, `<strong>${fmtPct(v)}</strong> of block groups match<br><span class="muted">${k}, ${relLabel(y)}</span>`))
        .on("mouseleave", hideTip);
      g.append("rect").attr("width", cw).attr("height", ch).attr("fill", shade(v));
      g.append("text").attr("x", cw / 2).attr("y", ch / 2 + 3.5).style("fill", v > 0.55 ? "#fff" : "var(--text)").text(Math.round(100 * v));
    });
  });
}

// ---- Map: TEPI minus ours for the selected indicator ----
let prepMapG;
function drawPrepMap() {
  const svg = d3.select("#prep-map"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, k = prepState.ind;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[4, 4], [W - 4, H - 4]], MAP.focus));
  const diff = i => (ours(k)[i] == null || theirs(k)[i] == null ? null : theirs(k)[i] - ours(k)[i]);
  const big = d3.quantile(d3.range(NBG).map(diff).filter(v => v != null).map(Math.abs).sort(d3.ascending), 0.95) || 1;
  const color = d3.scaleDiverging([-big, 0, big], t => d3.interpolatePuOr(1 - t)).clamp(true); // orange = TEPI higher
  prepMapG = svg.append("g");
  prepMapG.selectAll("path").data(d3.range(NBG)).join("path").attr("class", "bg").attr("d", i => path(bgFeature(i)))
    .attr("fill", i => { const d = diff(i); return d == null ? "#f3f2ee" : Math.abs(d) < PREP_TOL ? "#ecebe6" : color(d); })
    .on("mouseenter", (event, i) => prepHover(i))
    .on("mousemove", (event, i) => showTip(event, prepTip(i)))
    .on("mouseleave", () => { hideTip(); prepHover(null); });
  svg.call(d3.zoom().scaleExtent([0.5, 12]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : true))
    .on("zoom", ({ transform }) => prepMapG.attr("transform", transform)));
  d3.select("#prep-map-title").text(`Mismatches: ${k} (${relLabel(prepState.year)})`);
  d3.select("#prep-map-legend").html(
    `<span class="legend-item">TEPI lower ${d3.format(".1f")(big)} pts <span class="ramp" style="background:linear-gradient(90deg,${d3.range(-1, 1.01, 0.2).map(t => color(t * big)).join(",")})"></span> TEPI higher</span>` +
    `<span class="legend-item"><span class="swatch" style="background:#ecebe6"></span>Matches</span>`);
}

// ---- TEPI recomputed vs published ----
function drawPrepTepi() {
  const svg = d3.select("#prep-tepi"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, s = Math.min(W - 30, H - 30), m = { l: 26, t: 4 };
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  const rec = TEPI_YEARS[prepState.year], pub = VALUES._tepiPct;
  const ids = d3.range(NBG).filter(i => rec[i] != null && pub[i] != null);
  const x = d3.scaleLinear([0, 100], [m.l, m.l + s]), y = d3.scaleLinear([0, 100], [m.t + s, m.t]);
  [20, 40, 60, 80].forEach(v => {
    svg.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", y(0)).attr("y2", y(100)).attr("stroke", "#eceae4");
    svg.append("line").attr("y1", y(v)).attr("y2", y(v)).attr("x1", x(0)).attr("x2", x(100)).attr("stroke", "#eceae4");
  });
  svg.append("rect").attr("x", x(0)).attr("y", y(100)).attr("width", s).attr("height", s).attr("fill", "none").attr("stroke", "var(--border)");
  const same = i => tierIdx(rec[i]) === tierIdx(pub[i]);
  svg.append("g").selectAll("circle").data(ids.sort((a, b) => same(a) - same(b))).join("circle").attr("r", 1.6)
    .attr("cx", i => x(rec[i])).attr("cy", i => y(pub[i])).attr("fill", i => (same(i) ? PREP_MATCH : PREP_MISS))
    .on("mousemove", (event, i) => showTip(event, `<strong>${bgLabel(i)}</strong><br>TEPI percentile: recomputed ${d3.format(".0f")(rec[i])} (${tierOf(rec[i])}), published ${d3.format(".0f")(pub[i])} (${tierOf(pub[i])})`))
    .on("mouseleave", hideTip);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y(0)})`).call(d3.axisBottom(x).ticks(5).tickSize(3)).call(a => a.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(3)).call(a => a.select(".domain").remove());
  const rho = pearson(ranks(ids.map(i => rec[i])), ranks(ids.map(i => pub[i])));
  svg.append("text").attr("x", x(2)).attr("y", y(96)).style("font-size", "10px").text(`ρ = ${d3.format(".3f")(rho)} · same tier ${fmtPct(d3.mean(ids, i => (same(i) ? 1 : 0)))}`);
  svg.append("text").attr("x", x(100)).attr("y", y(0) + 24).attr("text-anchor", "end").style("font-size", "9px").style("fill", "var(--text-muted)").text(`recomputed (${relLabel(prepState.year)}) →`);
}

function drawPrepAll() {
  d3.selectAll("#prep-year .tool").attr("aria-pressed", function () { return +this.dataset.year === prepState.year; });
  drawPrepSM(); // the page shows only the small multiples; heat grid, map and TEPI scatter are kept below but unused
}
d3.select("#prep-year").selectAll("button").data(PREP_YEARS).join("button").attr("class", "tool").attr("data-year", y => y)
  .text(y => `${y - 4}–${String(y).slice(2)}`).on("click", (_, y) => { prepState.year = y; drawPrepAll(); });
d3.select('[data-view="prepview"]').on("click.prep", () => requestAnimationFrame(drawPrepAll));
window.addEventListener("resize", () => { if (!document.getElementById("prepview").hidden) drawPrepAll(); });
drawPrepAll();
