// ---- View 2: expert TEPI tiers vs. novice k-means clusters ----
// Uses shared globals from main.js (tooltip, VALUES, INDICATORS, TIERS,
// pctRank, whatIf) and the pipeline functions in ml_engine.js.
const N = VALUES._label.length;
// Fixed slot order; up to 6 clusters (k = 2–6).
// Tableau 10 (d3.schemeTableau10) minus the hues that already mean something:
// blue (TEPI tiers), orange and teal (View 1 themes), gray (histograms).
// Brown before pink, so the default k = 5 never pairs the similar red and pink.
const CLUSTER_COLOR = [2, 4, 5, 6, 8, 7].map(i => d3.schemeTableau10[i]); // red, green, yellow, purple, brown, pink
const TIER_COLOR = t => (t ? d3.interpolateBlues(0.25 + 0.15 * (t - 1)) : "#c3c2b7");
const tierName = t => (t ? TIERS[t - 1] : "No score");
const TIER = d3.range(N).map(i => (VALUES._tepiPct[i] == null ? 0 : Math.min(Math.floor(VALUES._tepiPct[i] / 20), 4) + 1));

// ---- Pipeline settings (the "novice" choices the viewer can change) ----
const PRESETS = {
  novice: { vars: [...INDICATORS], missing: "median", scaling: "standard", k: 5 },
  tepi: { vars: [...INDICATORS], missing: "drop", scaling: "percentile", k: 5 },
};
const config = structuredClone(PRESETS.novice);
const SCALING_LABEL = {
  standard: "StandardScaler (z-score of raw %)", minmax: "Min-max to 0–1",
  log: "log(1 + x), then z-score", percentile: "Percentile rank (TEPI's choice)",
};

// Run the whole pipeline for the current settings. Arrays are indexed by
// block group; dropped block groups get null.
let ML;
function runML() {
  const { rows, X } = preprocess(config.vars.map(k => VALUES[k]), config);
  const km = kmeans(X, config.k);
  const { scores, explained, components } = pca2(X);

  // Cluster ids are arbitrary; renumber 1..k by mean TEPI so they can be
  // read next to the tiers. This is only a relabel.
  const meanTepi = d3.range(config.k).map(c =>
    d3.mean(rows.filter((_, r) => km.labels[r] === c), i => VALUES._tepiPct[i]) ?? -1);
  const order = d3.range(config.k).sort((a, b) => meanTepi[a] - meanTepi[b]);
  const cluster = new Array(N).fill(null), pc = new Array(N).fill(null);
  rows.forEach((i, r) => { cluster[i] = order.indexOf(km.labels[r]) + 1; pc[i] = scores[r]; });

  // With exactly two indicators the axes are the indicators themselves (raw %),
  // so the plot needs no projection; otherwise show the first two PCs.
  const direct = config.vars.length === 2;
  const xy = new Array(N).fill(null);
  if (direct) {
    const med = config.vars.map(k => d3.median(SORTED[k]));
    rows.forEach(i => { xy[i] = config.vars.map((k, j) => VALUES[k][i] ?? med[j]); });
  } else rows.forEach(i => { xy[i] = pc[i]; });

  const scored = rows.filter(i => TIER[i] > 0);
  const crosstab = [1, 2, 3, 4, 5].map(t => d3.range(1, config.k + 1).map(c =>
    scored.filter(i => TIER[i] === t && cluster[i] === c).length));
  ML = {
    k: config.k, rows, cluster, tier: TIER, pc, xy, direct, vars: [...config.vars], explained, components, crosstab,
    ari: adjustedRand(scored.map(i => TIER[i]), scored.map(i => cluster[i])),
    silhouette: silhouette(X, km.labels),
  };
}

// Selection state: one block group (instance) or a set (group).
const state = { colorBy: "cluster", instance: null, group: null, groupLabel: "", parts: [] };

function selectInstance(i) {
  state.instance = i;
  state.group = null;
  render();
}
function selectGroup(ids, label) {
  state.instance = null;
  state.group = ids.length ? new Set(ids) : null;
  state.parts = ids.length ? [{ label, ids }] : [];
  state.groupLabel = label;
  render();
}
// Shift / Ctrl / ⌘ adds to the current selection instead of replacing it;
// picking a part that is already selected removes it again.
const additive = event => event.shiftKey || event.ctrlKey || event.metaKey;
function pickGroup(event, ids, label) {
  if (!additive(event) || !state.group) return selectGroup(ids, label);
  const existing = state.parts.findIndex(p => p.label === label);
  if (existing >= 0) state.parts.splice(existing, 1);
  else state.parts.push({ label, ids });
  const union = new Set(state.parts.flatMap(p => p.ids));
  state.instance = null;
  state.group = union.size ? union : null;
  state.groupLabel = state.parts.length > 1 ? `${state.parts.length} combined selections` : state.parts[0]?.label || "";
  render();
}
const isSelected = i =>
  state.instance != null ? i === state.instance : state.group ? state.group.has(i) : true;

// ---- Scatter: PCA projection of the standardized indicators ----
let renderScatter = () => {};

// Axis titles: the indicator itself (2 variables) or the PC with its main
// ingredients (top 3 loadings by size, with sign).
function pcIngredients(pc, n = 3) {
  return ML.vars.map((k, j) => ({ k, w: ML.components[pc][j] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, n)
    .map(d => `${d.w >= 0 ? "+" : "−"} ${d.k}`).join(", ");
}
function axisTitle(a) {
  if (ML.direct) return `${ML.vars[a]} (%)`;
  return `PC${a + 1} (${d3.format(".0%")(ML.explained[a])}): ${pcIngredients(a)}`;
}

function drawScatter() {
  const svg = d3.select("#scatter");
  if (!svg.node().getBoundingClientRect().width) return;
  svg.selectAll("*").remove();
  const width = 640, height = 460, m = { t: 10, r: 10, b: 40, l: 44 };
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const pts = ML.rows.map(i => ML.xy[i]);
  const x = d3.scaleLinear(d3.extent(pts, d => d[0]), [m.l, width - m.r]).nice();
  const y = d3.scaleLinear(d3.extent(pts, d => d[1] ?? 0), [height - m.b, m.t]).nice();
  const pct = d3.format(".0%");

  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.b})`).call(d3.axisBottom(x).ticks(6));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6));
  svg.append("text").attr("class", "axis-title").attr("x", (m.l + width - m.r) / 2).attr("y", height - 6)
    .attr("text-anchor", "middle").text(axisTitle(0));
  svg.append("text").attr("class", "axis-title").attr("transform", `translate(12,${(m.t + height - m.b) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle").text(axisTitle(1));

  // Transparent layer behind the points so empty space is draggable too.
  svg.append("rect").attr("x", m.l).attr("y", m.t)
    .attr("width", width - m.l - m.r).attr("height", height - m.t - m.b)
    .attr("fill", "transparent").style("cursor", "crosshair");

  const dots = svg.append("g").selectAll("circle")
    .data(ML.rows)
    .join("circle")
    .attr("cx", i => x(ML.xy[i][0]))
    .attr("cy", i => y(ML.xy[i][1]))
    .attr("r", 4)
    .attr("class", "dot")
    .on("mousemove", (event, i) => {
      tooltip.property("hidden", false)
        .style("left", event.clientX + 14 + "px").style("top", event.clientY + 14 + "px")
        .html(`<strong>${VALUES._label[i]}</strong><br>TEPI tier: ${tierName(ML.tier[i])}<br>ML cluster: ${ML.cluster[i]}`);
    })
    .on("mouseleave", () => tooltip.property("hidden", true));

  // Direct labels at each cluster's centre, so color is not the only cue.
  const centres = d3.range(1, ML.k + 1).map(c => {
    const ids = clusterIds(c);
    return { c, x: d3.mean(ids, i => x(ML.xy[i][0])), y: d3.mean(ids, i => y(ML.xy[i][1])) };
  });
  const labels = svg.append("g").selectAll("text")
    .data(centres)
    .join("text")
    .attr("class", "centre-label")
    .attr("x", d => d.x).attr("y", d => d.y)
    .attr("text-anchor", "middle").attr("dy", "0.35em")
    .text(d => `C${d.c}`);

  const lassoPath = svg.append("path").attr("class", "lasso");
  let points = [], pressed = null, lassoCount = 0;
  // Drag anywhere (even starting on a point) to lasso; a short press is a
  // click: on a point it selects that block group, elsewhere it clears.
  svg.call(d3.drag()
    .container(svg.node())
    .on("start", event => {
      points = [[event.x, event.y]];
      pressed = d3.select(event.sourceEvent.target);
    })
    .on("drag", event => {
      points.push([event.x, event.y]);
      lassoPath.attr("d", "M" + points.join("L") + "Z");
    })
    .on("end", event => {
      lassoPath.attr("d", null);
      if (points.length < 4) return pressed.classed("dot") ? selectInstance(pressed.datum()) : selectGroup([], "");
      const ids = ML.rows.filter(i => d3.polygonContains(points, [x(ML.xy[i][0]), y(ML.xy[i][1])]));
      const adding = additive(event.sourceEvent) && state.group;
      pickGroup(event.sourceEvent, ids, adding ? `Lasso ${++lassoCount + 1}` : ((lassoCount = 0), "Lasso selection"));
    }));

  renderScatter = () => {
    dots
      .attr("fill", i => (state.colorBy === "cluster" ? CLUSTER_COLOR[ML.cluster[i] - 1] : TIER_COLOR(ML.tier[i])))
      .classed("dim", i => !isSelected(i))
      .classed("picked", i => i === state.instance);
    dots.filter(i => isSelected(i)).raise();
    labels.style("display", state.colorBy === "cluster" ? null : "none").raise();
    drawScatterLegend();
  };
  renderScatter();
}

function drawScatterLegend() {
  const items = state.colorBy === "cluster"
    ? d3.range(1, ML.k + 1).map(c => ({ label: `Cluster ${c}`, color: CLUSTER_COLOR[c - 1] }))
    : d3.range(1, 6).map(t => ({ label: tierName(t), color: TIER_COLOR(t) }));
  const leg = d3.select("#scatter-legend").html("");
  items.forEach(d => {
    const item = leg.append("span").attr("class", "legend-item");
    item.append("span").attr("class", "swatch").style("background", d.color);
    item.append("span").text(d.label);
  });
}

// ---- Heatmap: tier (rows, High on top) × cluster (columns) ----
let renderHeatmap = () => {};

function drawHeatmap() {
  const svg = d3.select("#heatmap");
  if (!svg.node().getBoundingClientRect().width) return;
  svg.selectAll("*").remove();
  const m = { t: 34, r: 10, b: 10, l: 110 };
  const width = m.l + m.r + 62 * ML.k, height = 330;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const tiers = [5, 4, 3, 2, 1];
  const clusters = d3.range(1, ML.k + 1);
  const x = d3.scaleBand(clusters, [m.l, width - m.r]).padding(0.04);
  const y = d3.scaleBand(tiers, [m.t, height - m.b]).padding(0.04);
  const cells = tiers.flatMap(t => clusters.map(c => ({ t, c, n: ML.crosstab[t - 1][c - 1] })));
  // Counts use a neutral ramp so they are not confused with the blue tiers.
  const color = d3.scaleSequential(d3.interpolateRgb("#f0efec", "#52514e"));
  const idsOf = (t, c) => ML.rows.filter(i => (t == null || ML.tier[i] === t) && (c == null || ML.cluster[i] === c));

  const cell = svg.append("g").selectAll("g")
    .data(cells)
    .join("g")
    .attr("class", "cell")
    .attr("transform", d => `translate(${x(d.c)},${y(d.t)})`)
    .on("click", (event, d) => pickGroup(event, idsOf(d.t, d.c), `${tierName(d.t)} tier × Cluster ${d.c}`));
  cell.append("rect").attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 3);
  const count = cell.append("text").attr("x", x.bandwidth() / 2).attr("y", y.bandwidth() / 2).attr("dy", "0.35em")
    .attr("text-anchor", "middle");
  const total = cell.append("text").attr("class", "hm-total").attr("x", x.bandwidth() / 2).attr("y", y.bandwidth() / 2 + 15)
    .attr("text-anchor", "middle");

  svg.append("g").selectAll("text")
    .data(tiers)
    .join("text")
    .attr("class", "hm-label")
    .attr("x", m.l - 8).attr("y", t => y(t) + y.bandwidth() / 2).attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text(t => tierName(t))
    .on("click", (event, t) => pickGroup(event, idsOf(t, null), `${tierName(t)} tier`));

  const col = svg.append("g").selectAll("g")
    .data(clusters)
    .join("g")
    .attr("class", "hm-label")
    .attr("transform", c => `translate(${x(c) + x.bandwidth() / 2},${m.t - 12})`)
    .on("click", (event, c) => pickGroup(event, idsOf(null, c), `Cluster ${c}`));
  col.append("rect").attr("x", -22).attr("y", -9).attr("width", 8).attr("height", 8).attr("rx", 2)
    .attr("fill", c => CLUSTER_COLOR[c - 1]);
  col.append("text").attr("x", -10).attr("y", -1).text(c => `C${c}`);
  svg.append("text").attr("class", "axis-title").attr("x", 0).attr("y", m.t - 14).text("Tier ↓  Cluster →");

  // With a selection, cells count only the selected block groups (the full
  // total is shown underneath); otherwise they count everything.
  renderHeatmap = () => {
    const active = state.instance != null || state.group;
    const sel = d3.rollup(ML.rows.filter(i => active && isSelected(i)), v => v.length, i => `${ML.tier[i]}-${ML.cluster[i]}`);
    const shown = d => (active ? sel.get(`${d.t}-${d.c}`) || 0 : d.n);
    color.domain([0, d3.max(cells, shown) || 1]);
    cell.select("rect").attr("fill", d => color(shown(d))).classed("hm-hit", d => active && shown(d) > 0);
    count.text(shown).attr("fill", d => (shown(d) > color.domain()[1] * 0.55 ? "#fff" : "#0b0b0b"))
      .attr("dy", active ? "-0.1em" : "0.35em");
    total.text(d => (active ? `of ${d.n}` : "")).attr("fill", d => (shown(d) > color.domain()[1] * 0.55 ? "#e1e0d9" : "#52514e"));
    const n = active ? d3.sum([...sel.values()]) : ML.rows.filter(i => ML.tier[i] > 0).length;
    d3.select("#hm-sub").text(active
      ? `Showing the ${n} selected block group${n === 1 ? "" : "s"} (small number = all block groups). Click empty space in the scatter to clear.`
      : "Block groups per combination. Click a cell, a row or a column to select it; Shift-click to add more.");
  };
  renderHeatmap();
}

// ---- Detail panel: instance, group, or cluster overview ----
// Small horizontal bars: how a set of block groups splits over tiers or clusters.
function splitBars(container, title, ids, keyOf, keys, nameOf, colorOf) {
  const box = container.append("div").attr("class", "split");
  box.append("h3").text(title);
  const counts = d3.rollup(ids, v => v.length, keyOf);
  const max = d3.max(keys, k => counts.get(k) || 0) || 1;
  keys.forEach(k => {
    const n = counts.get(k) || 0;
    const row = box.append("div").attr("class", "split-row");
    row.append("span").attr("class", "split-name").text(nameOf(k));
    row.append("span").attr("class", "split-bar").append("span")
      .style("width", (100 * n) / max + "%").style("background", colorOf(k));
    row.append("span").attr("class", "split-n").text(`${n} (${d3.format(".0%")(n / ids.length)})`);
  });
}

const clusterIds = c => ML.rows.filter(i => ML.cluster[i] === c);

// Small multiples, one per indicator, in the same style as the what-if
// panel: the county distribution (raw %) with markers on top.
//   markers: [{ label, color, value: k => number, cls }]
//   overlay: optional block-group ids whose own distribution is drawn over
//            the county's (scaled to its own peak so the shapes compare)
//   context: optional k => html line under each histogram
function indicatorHistograms(container, { markers, overlay = null, context = null }) {
  const grid = container.append("div").attr("class", "bg-hists");
  const hw = 200, hh = 34;
  const fmt = d3.format(".1f");
  INDICATORS.forEach(k => {
    const vals = VALUES[k].filter(v => v != null);
    const cell = grid.append("div").attr("class", "bg-hist").classed("unused", !config.vars.includes(k));
    cell.append("div").attr("class", "bg-hist-label")
      .html(`${k}${config.vars.includes(k) ? "" : ' <span class="muted">(not used by the model)</span>'}`);
    const x = d3.scaleLinear([0, Math.ceil(d3.max(vals))], [0, hw]);
    const bin = d3.bin().domain(x.domain()).thresholds(30);
    const bars = (g, bins, fill) => {
      const y = d3.scaleLinear([0, d3.max(bins, b => b.length) || 1], [hh - 2, 2]);
      g.selectAll("rect").data(bins).join("rect")
        .attr("x", b => x(b.x0) + 0.5).attr("width", b => Math.max(0, x(b.x1) - x(b.x0) - 1))
        .attr("y", b => y(b.length)).attr("height", b => hh - 2 - y(b.length))
        .attr("fill", fill);
    };
    const svg = cell.append("svg").attr("viewBox", `0 0 ${hw} ${hh}`).attr("preserveAspectRatio", "none");
    bars(svg.append("g"), bin(vals), overlay ? "#e1e0d9" : "#c3c2b7");
    if (overlay) bars(svg.append("g"), bin(overlay.map(i => VALUES[k][i]).filter(v => v != null)), "#a3a29c");

    const shown = markers.map(m => ({ ...m, v: m.value(k) })).filter(m => m.v != null && !isNaN(m.v));
    shown.forEach(m => svg.append("line").attr("class", m.cls)
      .attr("x1", x(m.v)).attr("x2", x(m.v)).attr("y1", 0).attr("y2", hh).attr("stroke", m.color));
    svg.on("mousemove", event => {
      tooltip.property("hidden", false)
        .style("left", event.clientX + 14 + "px").style("top", event.clientY + 14 + "px")
        .html(`<strong>${k}</strong><br>` + shown.map(m =>
          `<span class="swatch" style="background:${m.color}"></span>${m.label}: ${fmt(m.v)}%`).join("<br>"));
    }).on("mouseleave", () => tooltip.property("hidden", true));
    if (context) cell.append("div").attr("class", "bg-hist-context").html(context(k));
  });
  const leg = container.append("div").attr("class", "legend");
  if (overlay) {
    const item = leg.append("span").attr("class", "legend-item");
    item.append("span").attr("class", "swatch").style("background", "#a3a29c");
    item.append("span").text("Selection's distribution");
  }
  markers.forEach(m => {
    const item = leg.append("span").attr("class", "legend-item");
    item.append("span").attr("class", "swatch tick" + (m.cls === "m-median" ? " dashed" : "")).style("background", m.color);
    item.append("span").text(m.label);
  });
}

const COUNTY_MEDIAN_MARK = { label: "County median", color: "#52514e", cls: "m-median", value: k => d3.median(SORTED[k]) };
const clusterMean = (c, k) => d3.mean(clusterIds(c), j => VALUES[k][j]);

function renderDetail() {
  const panel = d3.select("#detail").html("");
  const pctFmt = d3.format(".1f");

  if (state.instance != null) {
    const i = state.instance, c = ML.cluster[i], t = ML.tier[i];
    panel.append("h2").text(VALUES._label[i]);
    const facts = panel.append("div").attr("class", "facts");
    facts.append("div").html(`<span class="k">Expert (TEPI)</span><span class="v">${tierName(t)} tier</span><span class="muted">percentile ${VALUES._tepiPct[i] == null ? "n/a" : pctFmt(VALUES._tepiPct[i])}</span>`);
    facts.append("div").html(`<span class="k">Novice ML</span><span class="v"><span class="swatch" style="background:${CLUSTER_COLOR[c - 1]}"></span>Cluster ${c}</span><span class="muted">${clusterIds(c).length} block groups</span>`);
    facts.append("button").attr("class", "btn").text("Open in what-if calculator")
      .on("click", () => {
        INDICATORS.forEach(k => (whatIf[k] = VALUES[k][i]));
        d3.select("#whatif-load").property("value", String(i)).dispatch("change");
        d3.select('[data-view="view1"]').dispatch("click");
      });
    panel.append("p").attr("class", "sub").text("Each indicator across all 718 block groups (raw %), with this block group, its ML cluster's average and the county median marked.");
    indicatorHistograms(panel, {
      markers: [
        COUNTY_MEDIAN_MARK,
        { label: `Cluster ${c} average`, color: CLUSTER_COLOR[c - 1], cls: "m-cluster", value: k => clusterMean(c, k) },
        { label: "This block group", color: "#0b0b0b", cls: "m-self", value: k => VALUES[k][i] },
      ],
      context: k => (VALUES[k][i] == null ? "No value (missing)"
        : `<strong>${d3.format(".1f")(VALUES[k][i])}%</strong> · higher than ${d3.format(".0%")(d3.bisectLeft(SORTED[k], VALUES[k][i] - 1e-9) / SORTED[k].length)} of block groups`),
    });
    return;
  }

  if (state.group) {
    const ids = [...state.group];
    panel.append("h2").text(`${state.groupLabel}: ${ids.length} block groups`);
    if (state.parts.length > 1) panel.append("p").attr("class", "sub").text("Combined: " + state.parts.map(p => p.label).join(" + "));
    const pop = d3.sum(ids, i => VALUES._pop ? VALUES._pop[i] : 0);
    const scored = ids.filter(i => VALUES._tepiPct[i] != null);
    panel.append("p").attr("class", "sub").text(
      `Mean TEPI percentile ${pctFmt(d3.mean(scored, i => VALUES._tepiPct[i]) ?? NaN)}` + (pop ? ` · ${d3.format(",")(pop)} residents` : "")
    );
    const row = panel.append("div").attr("class", "detail-row");
    const splits = row.append("div").attr("class", "splits");
    splitBars(splits, "Expert: TEPI tier", ids, i => ML.tier[i], [5, 4, 3, 2, 1], tierName, TIER_COLOR);
    splitBars(splits, "Novice ML: cluster", ids, i => ML.cluster[i], d3.range(1, ML.k + 1), c => `Cluster ${c}`, c => CLUSTER_COLOR[c - 1]);
    const prof = row.append("div").attr("class", "detail-profile");
    // Compare the selection with its TEPI tier and its ML cluster. A heatmap
    // cell has exactly one of each; a lasso or combined selection can span
    // several, so use the most common tier and cluster in it.
    const mostCommon = key => d3.greatest(d3.rollups(ids.filter(i => key(i) > 0), v => v.length, key), d => d[1])?.[0];
    const t = mostCommon(i => ML.tier[i]), c = mostCommon(i => ML.cluster[i]);
    const median = (members, k) => d3.median(members, i => VALUES[k][i]);
    const tierIds = ML.rows.filter(i => ML.tier[i] === t), clusterIdsOf = clusterIds(c);
    const f1 = d3.format(".1f");
    const selMean = k => d3.mean(ids, i => VALUES[k][i]);
    prof.append("h3").text(`Indicators: selection vs. its tier and cluster (raw %)`);
    indicatorHistograms(prof, {
      overlay: ids,
      markers: [
        { label: `${tierName(t)} tier median (TEPI)`, color: TIER_COLOR(t), cls: "m-cluster", value: k => median(tierIds, k) },
        { label: `Cluster ${c} median (ML)`, color: CLUSTER_COLOR[c - 1], cls: "m-cluster", value: k => median(clusterIdsOf, k) },
        { label: "Selection mean", color: "#0b0b0b", cls: "m-self", value: selMean },
      ],
      context: k => `Selection mean <strong>${f1(selMean(k))}%</strong> · tier ${f1(median(tierIds, k))}% · cluster ${f1(median(clusterIdsOf, k))}%`,
    });
    return;
  }

  // Nothing selected: show what each cluster looks like.
  panel.append("h2").text("What the ML clusters look like");
  panel.append("p").attr("class", "sub").text("Each indicator across all block groups (raw %), with each cluster's average marked. Hover a histogram for the values. Select a point, a lasso region or a heatmap cell for details.");
  indicatorHistograms(panel, {
    markers: [
      COUNTY_MEDIAN_MARK,
      ...d3.range(1, ML.k + 1).map(c => ({
        label: `Cluster ${c} average (${clusterIds(c).length})`, color: CLUSTER_COLOR[c - 1], cls: "m-cluster", value: k => clusterMean(c, k),
      })),
    ],
  });
}

function render() {
  renderScatter();
  renderHeatmap();
  renderDetail();
}

function describePipeline() {
  const dropped = N - ML.rows.length;
  d3.select("#ml-sub").html(
    `${config.vars.length} of 12 indicators · ${config.missing === "median" ? "median-impute missing" : `drop missing (${dropped} block group${dropped === 1 ? "" : "s"})`}` +
    ` · ${SCALING_LABEL[config.scaling]} · k-means, k = ${config.k}. ${ML.direct ? "Plotted on the two indicators directly." : "Shown on the first two PCA components."}<br>` +
    `Agreement with TEPI tiers: <strong>ARI = ${d3.format(".2f")(ML.ari)}</strong> (0 = chance, 1 = identical) · ` +
    `silhouette = ${d3.format(".2f")(ML.silhouette)} (cluster separation, −1 to 1).`
  );
}

function drawView2() {
  describePipeline();
  d3.select("#scatter-title").text(ML.direct ? `ML clusters on ${ML.vars[0]} vs. ${ML.vars[1]}` : "ML clusters on the first two PCA components");
  drawScatter();
  drawHeatmap();
  render();
}

// Re-run the model after any setting changes; keep the view in sync.
function recompute() {
  runML();
  state.instance = null;
  state.group = null;
  syncControls();
  drawView2();
}

// ---- Pipeline controls ----
function buildControls() {
  const box = d3.select("#ml-controls");
  const vars = box.select("#ml-vars");
  const domainOf = {};
  TEPI_TREE.children.forEach(t => (function mark(n) { domainOf[n.id] = t.id; (n.children || []).forEach(mark); })(t));
  const item = vars.selectAll("label")
    .data(INDICATORS)
    .join("label")
    .attr("class", "var-chip");
  item.append("input").attr("type", "checkbox").attr("value", k => k)
    .on("change", function (event, k) {
      const next = this.checked ? [...config.vars, k] : config.vars.filter(v => v !== k);
      if (next.length < 2) { this.checked = true; return flash("Keep at least 2 indicators for the 2D projection."); }
      config.vars = INDICATORS.filter(v => next.includes(v)); // keep the standard order
      recompute();
    });
  item.append("span").text(k => k);

  box.selectAll('input[name="missing"]').on("change", function () { config.missing = this.value; recompute(); });
  box.select("#ml-scaling").on("change", function () { config.scaling = this.value; recompute(); });
  box.select("#ml-k").on("input", function () { config.k = +this.value; recompute(); });
  box.selectAll("[data-preset]").on("click", function () {
    Object.assign(config, structuredClone(PRESETS[this.dataset.preset]));
    recompute();
  });
  box.select("#ml-all").on("click", () => { config.vars = [...INDICATORS]; recompute(); });
}

function syncControls() {
  const box = d3.select("#ml-controls");
  box.selectAll("#ml-vars input").property("checked", k => config.vars.includes(k));
  box.selectAll('input[name="missing"]').property("checked", function () { return this.value === config.missing; });
  box.select("#ml-scaling").property("value", config.scaling);
  box.select("#ml-k").property("value", config.k);
  box.select("#ml-k-out").text(config.k);
}

function flash(msg) {
  d3.select("#ml-msg").text(msg).classed("show", true);
  setTimeout(() => d3.select("#ml-msg").classed("show", false), 2500);
}

runML();
buildControls();
syncControls();

d3.selectAll('input[name="colorby"]').on("change", function () {
  state.colorBy = this.value;
  renderScatter();
});
d3.select('[data-view="view2"]').on("click.ml", () => requestAnimationFrame(drawView2));
window.addEventListener("resize", () => { drawScatter(); drawHeatmap(); render(); });

// ---- Links that open a given state (for screenshots and demos) ----
//   #view2                                  open View 2
//   #view2&bg=Tract 31.02, Block Group 1    select one block group
//   #view2&cell=5-3                         select heatmap cell (tier 5 × cluster 3)
(function openFromHash() {
  const params = new URLSearchParams(decodeURIComponent(location.hash.slice(1)));
  if (!params.has("view2")) return;
  d3.selectAll(".toggle button").attr("aria-selected", function () { return this.dataset.view === "view2"; });
  d3.selectAll(".view").property("hidden", function () { return this.id !== "view2"; });
  drawView2();
  if (params.has("bg")) {
    const i = VALUES._label.indexOf(params.get("bg"));
    if (i >= 0) selectInstance(i);
  } else if (params.has("cell")) {
    const [t, c] = params.get("cell").split("-").map(Number);
    selectGroup(ML.rows.filter(i => ML.tier[i] === t && ML.cluster[i] === c), `${tierName(t)} tier × Cluster ${c}`);
  }
})();
