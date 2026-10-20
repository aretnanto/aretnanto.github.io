// ---- Map page: TEPI and ACS indicators by block group ----
// Block groups are indexed in TEPI CSV order, the same as VALUES, so an index
// means the same block group here and in the what-if calculator.
const MAP = window.MAP_DATA;
const BG = MAP.blockgroups;
const NBG = BG.geoid.length;
const YEARS = MAP.census.years;
// Releases: decennial census long form (1990, 2000) and ACS 5-year (2009-13 ..
// 2020-24, keyed by end year). Releases before 2016-20 are on older block
// groups and were moved to 2020 block groups by area weighting.
const INTERP = new Set(MAP.census.interpolated || []);
const relName = y => (y < 2009 ? `Census ${y}` : `ACS ${y - 4}–${String(y).slice(2)}`);
const relShort = y => (y < 2009 ? `${y}` : `’${String(y - 4).slice(2)}–’${String(y).slice(2)}`);
// change maps compare the first and last releases on 2020 block groups
const CHANGE_FROM = 2020, CHANGE_TO = YEARS[YEARS.length - 1];
// the release slider steps through releases (they are not evenly spaced)
function setMapYearControl(y) {
  d3.select("#map-year").property("value", YEARS.indexOf(y));
  d3.select("#map-year-out").text(relName(y) + (INTERP.has(y) ? " *" : ""))
    .attr("title", INTERP.has(y) ? "Moved from older block groups by area weighting (an estimate)" : null);
}

const tierIdx = p => (p == null ? null : Math.min(Math.floor(p / 20), 4)); // 0 = Low .. 4 = High

// The dashboard uses TEPI recomputed from the Census data for the selected
// ACS release (tepi_years.py), not the published TEPI file, and the Census
// population of that release. Labels are built from the block-group ID.
const TEPI_YEARS = window.TEPI_YEARS;
const tepiPct = i => TEPI_YEARS[mapState.year][i];
const popOf = i => MAP.census.value.Population[mapState.year][i] ?? 0;
const bgLabel = i => { const g = BG.geoid[i]; return `Tract ${+g.slice(5, 9)}${+g.slice(9, 11) ? "." + g.slice(9, 11) : ""}, Block Group ${g[11]}`; };
const TIER_FILL = i => d3.interpolateBlues(0.25 + 0.15 * i); // same blues as the what-if page

// The map and side panel use one ACS measure, median household income.
const isMoney = k => k === "Median household income";
const fmtVal = (k, v) => (v == null ? "n/a" : isMoney(k) ? d3.format("$,.0f")(v) : d3.format(".1f")(v) + "%");
const INCOME = "Median household income"; // ACS B19013, in 2024 dollars
const fmtMoe = (k, m) => (isMoney(k) ? d3.format("$,.0f")(m) : d3.format(".1f")(m));
const fmtDelta = (k, v) => (isMoney(k) ? d3.format("+$,.0f")(v) : d3.format("+.1f")(v) + " pts");

// Two groups of block groups can be selected and compared (A and B). Clicks
// and lasso add to the active group.
const GROUPS = {
  A: { label: "Group A", color: "#e8710a" },
  B: { label: "Group B", color: "#1f1f1f", dash: "4 2" },
};
const mapState = { color: "tepi", year: 2023, tool: "pan", groups: { A: new Set(), B: new Set() }, active: "A", poi: true };
const anySelected = () => mapState.groups.A.size + mapState.groups.B.size > 0;
const groupOf = i => (mapState.groups.A.has(i) ? "A" : mapState.groups.B.has(i) ? "B" : null);

// ---- Colour of each block group ----
const NOT_SIG = "#e6e5e0";
// TEPI x income: 3 x 3 bivariate classes (Stevens' blue-purple scheme).
// Rows: income third, from highest (0) to lowest (2); columns: TEPI third,
// lowest (0) to highest (2). The dark corner is high priority AND low income;
// the off-diagonal corners are where TEPI and income disagree.
const BIVAR = [
  ["#e8e8e8", "#ace4e4", "#5ac8c8"],
  ["#dfb0d6", "#a5add3", "#5698b9"],
  ["#be64ac", "#8c62aa", "#3b4994"],
];
const BIVAR_TEPI = ["Low", "Middle", "High"], BIVAR_INC = ["Higher income", "Middle", "Lower income"];
function bivarClasses() {
  const V = MAP.census.value[INCOME][mapState.year];
  const vals = V.filter(v => v != null).sort(d3.ascending);
  const q1 = d3.quantileSorted(vals, 1 / 3), q2 = d3.quantileSorted(vals, 2 / 3);
  return {
    q1, q2,
    tepi: i => (tepiPct(i) == null ? null : tepiPct(i) < 100 / 3 ? 0 : tepiPct(i) < 200 / 3 ? 1 : 2),
    inc: i => (V[i] == null ? null : V[i] >= q2 ? 0 : V[i] >= q1 ? 1 : 2),
  };
}
// Spatial unit check (City of Tucson TEPI), used by the Boundaries page: block-group tier minus the tier
// of the tract that contains it. Positive = the block group is higher
// priority than its tract, i.e. a pocket of need a tract-level program misses.
const UNIT_DIFF = [
  { min: 2, color: "#b2182b", label: "Block group 2+ tiers higher than its tract" },
  { min: 1, color: "#f4a582", label: "1 tier higher" },
  { min: 0, color: "#ecebe6", label: "Same tier" },
  { min: -1, color: "#92c5de", label: "1 tier lower" },
  { min: -Infinity, color: "#2166ac", label: "2+ tiers lower" },
];
const unitDiff = i => (BG.cityBgPct[i] == null || BG.cityTractPct[i] == null ? null : tierIdx(BG.cityBgPct[i]) - tierIdx(BG.cityTractPct[i]));

// TEPI recomputed for the first and last releases: how many tiers a block
// group moved (positive = higher priority in the latest release).
const TIER_MOVE = [
  { min: 2, color: "#b2182b", label: "Up 2+ tiers" },
  { min: 1, color: "#f4a582", label: "Up 1 tier" },
  { min: 0, color: "#ecebe6", label: "Same tier" },
  { min: -1, color: "#92c5de", label: "Down 1 tier" },
  { min: -Infinity, color: "#2166ac", label: "Down 2+ tiers" },
];
const tierMove = i => {
  const a = TEPI_YEARS[CHANGE_FROM][i], b = TEPI_YEARS[CHANGE_TO][i];
  return a == null || b == null ? null : tierIdx(b) - tierIdx(a);
};

function fillScale() {
  if (mapState.color === "tepimove") return i => { const d = tierMove(i); return d == null ? null : TIER_MOVE.find(c => d >= c.min).color; };
  if (mapState.color === "unit") return i => { const d = unitDiff(i); return d == null ? null : UNIT_DIFF.find(c => d >= c.min).color; };
  if (mapState.color === "tepi") return i => { const t = tierIdx(tepiPct(i)); return t == null ? null : TIER_FILL(t); };
  if (mapState.color === "bivar") {
    const b = bivarClasses();
    return Object.assign(i => { const t = b.tepi(i), r = b.inc(i); return t == null || r == null ? null : BIVAR[r][t]; }, { bivar: b });
  }
  const k = INCOME, V = MAP.census.value[k], M = MAP.census.moe[k];
  if (mapState.color === "indicator") {
    const vals = V[mapState.year].filter(v => v != null);
    const s = d3.scaleSequential([d3.quantile(vals, 0.02), d3.quantile(vals, 0.98)], d3.interpolateGreens).clamp(true);
    return Object.assign(i => (V[mapState.year][i] == null ? null : s(V[mapState.year][i])), { scale: s });
  }
  // Change from the first to the last release; changes inside the 90% margin of error are grey.
  const a = CHANGE_FROM, b = CHANGE_TO;
  const d = i => (V[a][i] == null || V[b][i] == null ? null : V[b][i] - V[a][i]);
  const sig = i => Math.abs(d(i)) > Math.hypot(M[a][i] ?? 0, M[b][i] ?? 0);
  const lim = d3.quantile(d3.range(NBG).map(d).filter(v => v != null).map(Math.abs), 0.95);
  const s = d3.scaleDiverging([-lim, 0, lim], t => d3.interpolateBrBG(1 - t)).clamp(true);
  return Object.assign(i => (d(i) == null ? null : sig(i) ? s(d(i)) : NOT_SIG), { scale: s });
}

// ---- Map ----
const mapSvg = d3.select("#map");
let mapZoomG;
const bgFeature = i => ({ type: "Feature", geometry: BG.geometry[i] });

function drawMap() {
  const box = mapSvg.node().getBoundingClientRect();
  if (!box.width) return; // page hidden
  const W = box.width, H = box.height || 420; // the panel's flex layout sets the size
  mapSvg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  // Coordinates are Arizona State Plane (feet), so a planar projection is exact.
  // Fit to the Tucson urban area; the rest of the county is reachable by zooming out.
  const proj = d3.geoIdentity().reflectY(true).fitExtent([[12, 12], [W - 12, H - 12]], MAP.focus);
  const path = d3.geoPath(proj);
  const centroid = d3.range(NBG).map(i => path.centroid(bgFeature(i)));

  mapSvg.append("rect").attr("class", "map-bg").attr("width", W).attr("height", H)
    .on("click", () => { if (mapState.tool === "pan") setGroup(mapState.active, new Set()); });
  mapZoomG = mapSvg.append("g");
  mapZoomG.selectAll("path").data(d3.range(NBG)).join("path")
    .attr("class", "bg").attr("d", i => path(bgFeature(i)))
    .on("mousemove", (event, i) => { showTip(event, bgTip(i)); drHighlight(i); })
    .on("mouseleave", () => { hideTip(); drHighlight(null); })
    .on("click", clickBg);

  // Landmark pins for orientation; hover a pin for its name. They sit above
  // the zoomed layer and are repositioned on zoom, so pins keep their size.
  const poiG = mapSvg.append("g").attr("class", "poi-layer").attr("display", mapState.poi ? null : "none");
  const pin = poiG.selectAll("g").data(MAP.poi).join("g").attr("class", "pin-g")
    .on("mousemove", (event, d) => showTip(event, `<strong>${d.name}</strong>`))
    .on("mouseleave", hideTip)
    .on("click", function (event) {
      const under = document.elementsFromPoint(event.clientX, event.clientY).find(e => e.classList.contains("bg"));
      if (under) clickBg(event, d3.select(under).datum());
    });
  drawPin(pin);
  const placePoi = t => pin.attr("transform", d => `translate(${t.apply(proj(d.xy))})`);
  // Keep the current zoom when the map is redrawn (resize, page switch).
  const t0 = d3.zoomTransform(mapSvg.node());
  mapZoomG.attr("transform", t0);
  placePoi(t0);

  // Pan/zoom, unless the lasso tool is active. The wheel zooms only with
  // Ctrl/Cmd (a trackpad pinch sends Ctrl+wheel), so plain scrolling moves the page.
  const zoom = d3.zoom().scaleExtent([0.3, 16])
    .filter(event => (event.type === "wheel" ? event.ctrlKey || event.metaKey : mapState.tool === "pan"))
    .on("zoom", ({ transform }) => { mapZoomG.attr("transform", transform); placePoi(transform); });
  mapSvg.call(zoom).on("dblclick.zoom", null);
  d3.select("#map-reset").on("click", () => mapSvg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Lasso in screen space; block groups are picked by centroid.
  const lasso = mapSvg.append("path").attr("class", "lasso");
  let pts = [];
  mapSvg.call(d3.drag()
    .filter(() => mapState.tool === "lasso")
    .on("start", () => { pts = []; })
    .on("drag", event => { pts.push([event.x, event.y]); lasso.attr("d", "M" + pts.join("L") + "Z"); })
    .on("end", event => {
      lasso.attr("d", null);
      if (pts.length < 3) return;
      const t = d3.zoomTransform(mapSvg.node());
      const s = event.sourceEvent.shiftKey ? new Set(mapState.groups[mapState.active]) : new Set();
      d3.range(NBG).filter(i => d3.polygonContains(pts, t.apply(centroid[i]))).forEach(i => s.add(i));
      setGroup(mapState.active, s);
    }));
  updateMap();
}

function updateMap() {
  if (!mapZoomG) return;
  const fill = fillScale(), any = anySelected();
  mapZoomG.selectAll(".bg")
    .attr("fill", i => fill(i) ?? "#f3f2ee")
    .classed("pickA", i => mapState.groups.A.has(i))
    .classed("pickB", i => mapState.groups.B.has(i))
    .classed("dim", i => any && !groupOf(i));
  mapZoomG.selectAll(".pickA, .pickB").raise();
  drawMapLegend(fill);
}

// Click puts one block group in the active group; Shift-click adds or removes
// it (either tool).
function clickBg(event, i) {
  const cur = mapState.groups[mapState.active];
  const s = event.shiftKey ? new Set(cur) : new Set();
  if (event.shiftKey && s.has(i)) s.delete(i);
  else if (!event.shiftKey && cur.size === 1 && cur.has(i)) s.clear();
  else s.add(i);
  setGroup(mapState.active, s);
}

// ---- Landmark pins ----
// An emoji on a white badge. Clicks pass through to the block group below.
function drawPin(g) {
  g.append("circle").attr("class", "pin").attr("r", 11);
  g.append("text").attr("class", "pin-emoji").attr("dy", "0.35em").text(d => d.icon);
}

// ---- Tooltip ----
// Tooltip next to the cursor, kept inside the window: it flips to the left of
// the cursor near the right edge and above it near the bottom.
function showTip(event, html) {
  const el = tooltip.property("hidden", false).html(html).node();
  const w = el.offsetWidth, h = el.offsetHeight, pad = 8, gap = 14;
  let x = event.clientX + gap, y = event.clientY + gap;
  if (x + w > window.innerWidth - pad) x = Math.max(pad, event.clientX - gap - w);
  if (y + h > window.innerHeight - pad) y = Math.max(pad, event.clientY - gap - h);
  tooltip.style("left", x + "px").style("top", y + "px");
}
function hideTip() { tooltip.property("hidden", true); }

function bgTip(i) {
  const k = INCOME, y = mapState.year;
  const v = MAP.census.value[k][y][i], m = MAP.census.moe[k][y][i];
  const p = tepiPct(i);
  return `<strong>${bgLabel(i)}</strong> <span class="muted">· pop. ${d3.format(",")(popOf(i))}</span>` +
    `<br>TEPI (${relName(y)}): ${p == null ? "n/a" : `<strong>${tierOf(p)}</strong> (percentile ${d3.format(".0f")(p)})`}` +
    (mapState.color === "tepimove" && tierMove(i) != null ? `<br>TEPI tier ${relName(CHANGE_FROM)} → ${relName(CHANGE_TO)}: ${tierOf(TEPI_YEARS[CHANGE_FROM][i])} → <strong>${tierOf(TEPI_YEARS[CHANGE_TO][i])}</strong>` : "") +
    `<br>${k}, ${relName(y)}: <strong>${fmtVal(k, v)}</strong>${m != null && v != null ? ` <span class="muted">± ${fmtMoe(k, m)}</span>` : ""}` +
    (mapState.color === "unit" && BG.cityBgPct[i] != null
      ? `<br>City TEPI: block group <strong>${tierOf(BG.cityBgPct[i])}</strong>, its tract ${BG.cityTractPct[i] == null ? "n/a" : `<strong>${tierOf(BG.cityTractPct[i])}</strong>`}`
      : "");
}

// ---- Legend under the map ----
function drawMapLegend(fill) {
  const lg = d3.select("#map-legend").html("");
  if (mapState.color === "bivar") {
    const b = fill.bivar, f = d3.format("$,.0f");
    const box = lg.append("span").attr("class", "bivar-legend");
    const grid = box.append("span").attr("class", "bivar-grid");
    [2, 1, 0].forEach(r => [0, 1, 2].forEach(t => grid.append("span").style("background", BIVAR[r][t])
      .attr("title", `TEPI ${BIVAR_TEPI[t].toLowerCase()} third, ${BIVAR_INC[r].toLowerCase()}`)));
    box.append("span").attr("class", "bivar-y").text("Lower income ↑");
    box.append("span").attr("class", "bivar-x").text("Higher TEPI →");
    // cut-offs and how to read the corners stay one hover away
    lg.append("span").attr("class", "legend-item").html(`TEPI × income, ${relName(mapState.year)}${INTERP.has(mapState.year) ? " (interpolated)" : ""} ` +
      `<span class="info" title="TEPI percentile in thirds × median household income (2024 $) in thirds: lower < ${f(b.q1)} ≤ middle < ${f(b.q2)} ≤ higher. Dark corner = high priority and low income; teal = high priority, higher income; pink = low priority, low income.">ⓘ</span>`);
  } else if (mapState.color === "unit") {
    lg.append("span").attr("class", "legend-title").text("City TEPI, block group vs its tract:");
    UNIT_DIFF.forEach(c => lg.append("span").attr("class", "legend-item")
      .html(`<span class="swatch" style="background:${c.color}"></span>${c.label}`));
  } else if (mapState.color === "tepimove") {
    lg.append("span").attr("class", "legend-title").text(`TEPI tier, ${relName(CHANGE_FROM)} → ${relName(CHANGE_TO)}:`);
    TIER_MOVE.forEach(c => lg.append("span").attr("class", "legend-item").html(`<span class="swatch" style="background:${c.color}"></span>${c.label}`));
    lg.append("span").attr("class", "legend-item").html(`<span class="info" title="Tiers are quintiles of TEPI recomputed for each release, so a move is relative to the rest of the county. Block-group estimates are noisy and consecutive 5-year releases overlap, so a one-tier move can be sampling noise.">ⓘ</span>`);
  } else if (mapState.color === "tepi") {
    lg.append("span").attr("class", "legend-title").text(`TEPI tier, ${relName(mapState.year)}${INTERP.has(mapState.year) ? " (interpolated)" : ""}:`);
    TIERS.forEach((n, t) => lg.append("span").attr("class", "legend-item")
      .html(`<span class="swatch" style="background:${TIER_FILL(t)}"></span>${n}`));
  } else {
    const k = INCOME, s = fill.scale, change = mapState.color === "change";
    const [lo, hi] = change ? [s.domain()[0], s.domain()[2]] : s.domain();
    const stops = d3.range(0, 1.01, 0.1).map(t => s(lo + t * (hi - lo)));
    const f = change ? fmtDelta : fmtVal;
    lg.append("span").attr("class", "legend-title").text(change ? `Change ${relName(CHANGE_FROM)} → ${relName(CHANGE_TO)} in ${k}:` : `${k}, ${relName(mapState.year)}${INTERP.has(mapState.year) ? " (interpolated)" : ""}:`);
    lg.append("span").attr("class", "legend-item")
      .html(`${f(k, lo)} <span class="ramp" style="background:linear-gradient(90deg,${stops.join(",")})"></span> ${f(k, hi)}`);
    if (change) lg.append("span").attr("class", "legend-item")
      .html(`<span class="swatch" style="background:${NOT_SIG}"></span>Change within the margin of error (90%)`);
  }
  lg.append("span").attr("class", "legend-item").html('<span class="swatch" style="background:#f3f2ee;border:1px solid #d5d4ce"></span>No data');
}

// ---- Groups and the side panel ----
// Groups A and B are shared by the map, the time curve (one curve per group)
// and the side panel. A block group belongs to at most one group.
function setGroup(g, s) {
  const other = g === "A" ? "B" : "A";
  s.forEach(i => mapState.groups[other].delete(i));
  mapState.groups[g] = s;
  updateMap();
  updateTimeCurves();
  updateDR();
  renderMapPanel();
}
// Outline one block group on the map (called from similarity-view hover).
function mapHighlight(i) {
  if (!mapZoomG) return;
  mapZoomG.selectAll(".bg").classed("hl", j => j === i).filter(j => j === i).raise();
}
function setActive(g) {
  mapState.active = g;
  d3.selectAll("[data-group]").attr("aria-pressed", function () { return this.dataset.group === g; });
}


// Group sizes shown on the Group A / Group B buttons.
function renderMapPanel() {
  ["A", "B"].forEach(g => d3.select("#grp-n-" + g).text(mapState.groups[g].size ? `(${mapState.groups[g].size})` : ""));
}

// ---- Controls ----
function buildMapControls() {
  const ctl = d3.select("#map-controls");
  ctl.select("#map-color").on("change", function () { mapState.color = this.value; syncMapControls(); updateMap(); });
  ctl.select("#map-year").attr("min", 0).attr("max", YEARS.length - 1).attr("step", 1).property("value", YEARS.indexOf(mapState.year))
    .on("input", function () { mapState.year = YEARS[+this.value]; setMapYearControl(mapState.year); updateMap(); })
    .on("change", () => document.dispatchEvent(new Event("release-change"))); // re-project the similarity view
  setMapYearControl(mapState.year);
  ctl.select("#map-poi").property("checked", mapState.poi).on("change", function () {
    mapState.poi = this.checked;
    mapSvg.select(".poi-layer").attr("display", mapState.poi ? null : "none");
    updateMap();
  });
  ctl.selectAll("[data-group]").on("click", function () { setActive(this.dataset.group); });
  ctl.selectAll("[data-clear]").on("click", function () { setGroup(this.dataset.clear, new Set()); });
  setActive(mapState.active);
  ctl.selectAll("[data-tool]").on("click", function () {
    mapState.tool = this.dataset.tool;
    ctl.selectAll("[data-tool]").attr("aria-pressed", function () { return this.dataset.tool === mapState.tool; });
    mapSvg.classed("lasso-mode", mapState.tool === "lasso");
  });
  syncMapControls();
}
function syncMapControls() {
  const yearUsed = mapState.color !== "change" && mapState.color !== "tepimove"; // these two compare first and last release
  d3.select(".map-year-ctl").classed("disabled", !yearUsed).select("input").property("disabled", !yearUsed);
}

buildMapControls();
function showMapPage() { drawMap(); drawDR(); drawTimeCurves(); renderMapPanel(); }
d3.select('[data-view="mapview"]').on("click.map", () => requestAnimationFrame(showMapPage));
window.addEventListener("resize", () => { if (!document.getElementById("mapview").hidden) showMapPage(); });
