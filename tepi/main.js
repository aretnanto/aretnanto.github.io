// View toggle: show one view at a time.
d3.selectAll(".toggle button").on("click", function () {
  const target = this.dataset.view;
  d3.selectAll(".toggle button").attr("aria-selected", function () {
    return this.dataset.view === target;
  });
  d3.selectAll(".view").property("hidden", function () {
    return this.id !== target;
  });
});

const tooltip = d3.select("#tooltip");

// ---- View 1: the TEPI construction pipeline ----
// Structure from the City's TEPI StoryMap, checked against the dataset:
// every mean below reproduces the published sub-index columns exactly.
// Tableau 10 palette (d3.schemeTableau10). Blue is reserved for priority
// tiers, so the themes use Tableau's teal and orange.
const DOMAIN_COLOR = { Economic: d3.schemeTableau10[3], Personal: d3.schemeTableau10[1] };

const TEPI_TREE = {
  id: "TEPI",
  children: [
    { id: "Economic", children: [
      { id: "Low-Income", children: [{ id: "Poverty" }, { id: "Unemployment" }] },
      { id: "Housing cost burden", children: [{ id: "Cost-burdened owners" }, { id: "Cost-burdened renters" }] },
      { id: "Limited resources", children: [{ id: "No health insurance" }, { id: "No vehicle" }] },
    ] },
    { id: "Personal", children: [
      { id: "Learned", children: [{ id: "Low English proficiency" }, { id: "HS education or less" }] },
      { id: "Physical", children: [
        { id: "Disability" },
        { id: "People of color" },
        { id: "Age", children: [{ id: "Children" }, { id: "Seniors" }] },
      ] },
    ] },
  ],
};
const TIERS = ["Low", "Low-Moderate", "Moderate", "Moderate-High", "High"]; // quintiles 1..5
const tierOf = p => TIERS[Math.min(Math.floor(p / 20), 4)];
const INDICATORS = [];
(function collect(n) { n.children ? n.children.forEach(collect) : INDICATORS.push(n.id); })(TEPI_TREE);

// ---- Scoring a what-if block group with TEPI's own formula ----
// At every level the value is percentile-ranked against the real block
// groups with the dataset's formula, P = (rank − 1) / (n − 1) × 100, where
// rank − 1 = number of block groups with a lower value. The what-if block
// group takes the place of one real one, so n stays the same.
const VALUES = window.TEPI_VALUES;
const SORTED = {};
// One block group has no education value. Each combining step drops the
// block groups missing any of *its* inputs and re-ranks over the rest, so a
// node's percentile is taken over 717 block groups when its parent is
// Learned, Personal or TEPI (whose inputs include education), else all 718.
const OVER_717 = new Set(["Low English proficiency", "HS education or less",
  "Learned", "Physical", "Economic", "Personal", "TEPI"]);
const complete = i => VALUES["HS education or less"][i] != null;
Object.keys(VALUES).filter(k => !k.startsWith("_")).forEach(k => {
  SORTED[k] = VALUES[k].filter((v, i) => v != null && (!OVER_717.has(k) || complete(i))).sort(d3.ascending);
});
// The 1e-9 tolerance keeps float noise in a recomputed mean from
// counting tied block groups as "lower".
const pctRank = (key, v) => Math.min(100, (d3.bisectLeft(SORTED[key], v - 1e-9) / (SORTED[key].length - 1)) * 100);

function scoreTEPI(raw) {
  const out = {};
  (function walk(n) {
    const mean = n.children ? d3.mean(n.children, c => walk(c)) : raw[n.id];
    out[n.id] = { mean, pct: pctRank(n.id, mean) };
    return out[n.id].pct;
  })(TEPI_TREE);
  out.tier = tierOf(out.TEPI.pct);
  return out;
}

let COUNTY_MEDIAN = Object.fromEntries(INDICATORS.map(k => [k, +d3.median(SORTED[k]).toFixed(1)]));
const whatIf = { ...COUNTY_MEDIAN };

// ---- Reference block groups (Project 2) ----
// The what-if is ranked against TEPI as published (default, exact), or
// against one ACS 5-year release: that release's nine ACS indicators plus
// TEPI's own unemployment, children and seniors (not ACS values), ranked with
// TEPI's rule (each step re-ranks over block groups with all of its inputs),
// as in tepi_years.py. REF holds the reference indicator values.
const WI_NOT_ACS = new Set(["Unemployment", "Children", "Seniors"]);
let REF = VALUES, REF_KEY = "published";
const wiLeaves = n => (n.children ? n.children.flatMap(wiLeaves) : [n.id]);
function setReference(key) {
  REF_KEY = key;
  if (key === "published") {
    REF = VALUES;
    Object.keys(VALUES).filter(k => !k.startsWith("_")).forEach(k => {
      SORTED[k] = VALUES[k].filter((v, i) => v != null && (!OVER_717.has(k) || complete(i))).sort(d3.ascending);
    });
  } else {
    REF = Object.fromEntries(INDICATORS.map(k => [k, WI_NOT_ACS.has(k) ? VALUES[k] : window.MAP_DATA.census.value[k][key]]));
    const n = VALUES._label.length;
    const pctOver = (vals, rows) => {
      const sorted = rows.map(i => vals[i]).sort(d3.ascending);
      const out = new Array(n).fill(null);
      rows.forEach(i => (out[i] = (d3.bisectLeft(sorted, vals[i] - 1e-9) / (sorted.length - 1)) * 100));
      return out;
    };
    // value of a node for every block group; SORTED lists for its inputs
    (function value(node) {
      if (!node.children) return REF[node.id];
      const leaves = wiLeaves(node);
      const rows = d3.range(n).filter(i => leaves.every(k => REF[k][i] != null));
      const childVals = node.children.map(c => value(c));
      node.children.forEach((c, j) => { SORTED[c.id] = rows.map(i => childVals[j][i]).sort(d3.ascending); });
      const pcts = node.children.map((c, j) => pctOver(childVals[j], rows));
      const mean = new Array(n).fill(null);
      rows.forEach(i => (mean[i] = d3.mean(pcts, p => p[i])));
      if (node === TEPI_TREE) SORTED[node.id] = rows.map(i => mean[i]).sort(d3.ascending);
      return mean;
    })(TEPI_TREE);
  }
  COUNTY_MEDIAN = Object.fromEntries(INDICATORS.map(k => [k, +d3.median(SORTED[k]).toFixed(1)]));
}

// ---- Diagram ----
const COL = { indicator: 0, nested: 1, sub: 2, domain: 3, tepi: 4 };

function buildPipeline() {
  const nodes = [];
  const links = [];
  // Walk the tree: each child gets an equal share of its parent's weight.
  (function walk(n, weight, domain, depth) {
    const kind = !n.children ? "indicator" : depth === 0 ? "tepi" : depth === 1 ? "domain" : depth === 2 ? "sub" : "nested";
    nodes.push({ id: n.id, col: COL[kind], kind, domain, weight, nInputs: n.children?.length });
    (n.children || []).forEach(c => {
      const w = weight / n.children.length;
      links.push({ source: c.id, target: n.id, weight: w });
      walk(c, w, depth === 0 ? c.id : domain, depth + 1);
    });
  })(TEPI_TREE, 1, undefined, 0);
  return { nodes, links };
}

let updatePipeline = () => {};

function drawPipeline() {
  const svg = d3.select("#pipeline");
  if (!svg.node() || !svg.node().getBoundingClientRect().width) return; // view is hidden or absent
  svg.selectAll("*").remove();
  // Fixed layout space, scaled to the panel by the viewBox, so boxes never collide.
  const width = 1180, height = 640;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const { nodes, links } = buildPipeline();
  const byId = new Map(nodes.map(n => [n.id, n]));
  const top = 40, bottom = 12;
  const size = {
    indicator: [200, 26], nested: [105, 34], sub: [150, 40], domain: [120, 50], tepi: [124, 104],
  };
  const colX = { 0: 0, 1: 220, 2: 345, 3: 530, 4: 690 };
  const bar = { x: 870, w: 30 };

  // Indicators are evenly spaced; every parent sits at the mean height of
  // its inputs, so the tree reads left to right.
  const yInd = d3.scalePoint(INDICATORS, [top, height - bottom]).padding(0.5);
  nodes.filter(n => n.kind === "indicator").forEach(n => (n.cy = yInd(n.id)));
  [COL.nested, COL.sub, COL.domain, COL.tepi].forEach(col =>
    nodes.filter(n => n.col === col).forEach(n => {
      n.cy = d3.mean(links.filter(l => l.target === n.id), l => byId.get(l.source).cy);
    })
  );
  nodes.forEach(n => {
    [n.w, n.h] = size[n.kind];
    n.x = colX[n.col];
    n.y = n.cy - n.h / 2;
  });

  const fill = n => (n.domain ? DOMAIN_COLOR[n.domain] : "#52514e");
  const pct = d3.format(".1%");
  const f0 = d3.format(".0f");

  const colLabels = [
    [100, "1–2. Indicator (weight in TEPI)"], [420, "3. Sub-index"],
    [590, "4. Theme"], [752, "5. TEPI"], [bar.x + bar.w / 2, "6. Priority tier"],
  ];
  svg.selectAll(".col-label")
    .data(colLabels)
    .join("text")
    .attr("class", "col-label")
    .attr("x", d => d[0])
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .text(d => d[1]);

  const wScale = d3.scaleLinear([0, 1], [0, 28]);
  const link = svg.append("g")
    .selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "link")
    .attr("d", d => {
      const s = byId.get(d.source), t = byId.get(d.target);
      return d3.linkHorizontal()({ source: [s.x + s.w, s.cy], target: [t.x, t.cy] });
    })
    .attr("stroke", d => fill(byId.get(d.source)))
    .attr("stroke-width", d => Math.max(1.5, wScale(d.weight)));

  const node = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .attr("transform", d => `translate(${d.x},${d.y})`);

  node.append("rect")
    .attr("class", d => (d.kind === "tepi" ? "tepi-card" : null))
    .attr("width", d => d.w)
    .attr("height", d => d.h)
    .attr("rx", d => (d.kind === "tepi" ? 8 : 4))
    .attr("fill", d => fill(d))
    .attr("fill-opacity", d => (d.kind === "indicator" ? 0.12 : 0.9));

  // Indicator boxes fill left-to-right with the what-if percentile.
  const indFill = node.filter(d => d.kind === "indicator")
    .append("rect")
    .attr("height", d => d.h)
    .attr("rx", 4)
    .attr("fill", d => fill(d))
    .attr("fill-opacity", 0.3);

  const twoLine = d => d.kind !== "indicator" && d.kind !== "tepi";
  node.filter(d => d.kind !== "tepi").append("text")
    .attr("x", 8)
    .attr("y", d => d.h / 2)
    .attr("dy", d => (twoLine(d) ? "-0.2em" : "0.35em"))
    .attr("fill", "#0b0b0b") // dark labels on the light Tableau hues
    .text(d => d.id);

  const valueText = node.filter(twoLine)
    .append("text")
    .attr("class", "w")
    .attr("x", 8)
    .attr("y", d => d.h / 2)
    .attr("dy", "1em")
    .style("fill", "rgba(11,11,11,0.75)");

  // TEPI card: the end of the pipeline, filled with the what-if tier's blue
  // (the same color as its segment on the tier bar).
  const card = node.filter(d => d.kind === "tepi");
  const cardText = (cls, y) => card.append("text").attr("class", cls)
    .attr("x", d => d.w / 2).attr("y", y).attr("text-anchor", "middle");
  const cardTitle = cardText("tepi-title", 20).text("TEPI");
  const cardScore = cardText("tepi-score", 56);
  const cardTier = cardText("tepi-tier", 78);
  const cardNote = cardText("tepi-note", 95).text("percentile · priority tier");

  node.filter(d => d.kind === "indicator")
    .append("text")
    .attr("class", "w")
    .attr("x", d => d.w - 6)
    .attr("y", d => d.h / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text(d => pct(d.weight));

  // ---- Tier bar: TEPI percentile 0–100, cut into five quintiles ----
  const barY = d3.scaleLinear([0, 100], [height - bottom - 10, top + 10]);
  const tierColor = i => d3.interpolateBlues(0.25 + 0.15 * i); // i = 0 (Low) .. 4 (High)
  const tierG = svg.append("g").attr("class", "tierbar");
  tierG.selectAll("rect")
    .data(TIERS)
    .join("rect")
    .attr("x", bar.x)
    .attr("width", bar.w)
    .attr("y", (_, i) => barY((i + 1) * 20) + 1)
    .attr("height", (_, i) => barY(i * 20) - barY((i + 1) * 20) - 2) // 2px gap between segments
    .attr("fill", (_, i) => tierColor(i));
  tierG.selectAll("text.tier-label")
    .data(TIERS)
    .join("text")
    .attr("class", "tier-label")
    .attr("x", bar.x + bar.w + 10)
    .attr("y", (_, i) => barY(i * 20 + 10))
    .attr("dy", "0.35em")
    .text(d => d);
  tierG.append("g")
    .attr("transform", `translate(${bar.x},0)`)
    .call(d3.axisLeft(barY).tickValues([0, 20, 40, 60, 80, 100]).tickSize(4))
    .call(a => a.select(".domain").remove())
    .attr("class", "tier-axis");

  const tepiNode = byId.get("TEPI");
  const tierLink = svg.insert("path", ".tierbar").attr("class", "link tier-link").attr("stroke", "#52514e");
  const marker = svg.append("g").attr("class", "tier-marker");
  marker.append("line").attr("x1", bar.x - 6).attr("x2", bar.x + bar.w + 6);
  // Label sits past the tier names so the two never overlap.
  marker.append("line").attr("class", "leader").attr("x1", bar.x + bar.w + 6).attr("x2", bar.x + bar.w + 102);
  marker.append("text").attr("class", "marker-label").attr("x", bar.x + bar.w + 106).attr("dy", "0.35em");

  let current = scoreTEPI(whatIf);
  updatePipeline = () => {
    current = scoreTEPI(whatIf);
    indFill.attr("width", d => (d.w * current[d.id].pct) / 100);
    valueText.text(d => `${d.nInputs ? "mean of " + d.nInputs + " · " : ""}P ${f0(current[d.id].pct)}`);
    const ti = TIERS.indexOf(current.tier);
    // Pick text by the fill's actual lightness (CIELAB L*), not by tier rank.
    const ink = d3.lab(tierColor(ti)).l > 58 ? "#0b0b0b" : "#fff";
    card.select(".tepi-card").attr("fill", tierColor(ti)).attr("fill-opacity", 1);
    cardScore.text(d3.format(".1f")(current.TEPI.pct));
    cardTier.text(current.tier);
    [cardTitle, cardScore, cardTier, cardNote].forEach(t => t.attr("fill", ink));
    const y = barY(current.TEPI.pct);
    tierLink.attr("d", d3.linkHorizontal()({ source: [tepiNode.x + tepiNode.w, tepiNode.cy], target: [bar.x - 6, y] }));
    marker.attr("transform", `translate(0,${y})`);
    marker.select("text").text(`What-if: ${current.tier}`);
    d3.select("#whatif-result").html(
      `What-if TEPI percentile <strong>${d3.format(".1f")(current.TEPI.pct)}</strong> → <strong>${current.tier}</strong> priority`
    );
  };
  updatePipeline();

  // Hover: highlight the node's full lineage (all upstream and downstream).
  const up = id => links.filter(l => l.target === id).flatMap(l => [l, ...up(l.source)]);
  const down = id => links.filter(l => l.source === id).flatMap(l => [l, ...down(l.target)]);
  const STEP = { indicator: 0, nested: 1, sub: 1, domain: 2, tepi: 3 };

  node.on("mouseenter", (event, d) => {
    const path = new Set([...up(d.id), ...down(d.id)]);
    const ids = new Set([d.id, ...[...path].flatMap(l => [l.source, l.target])]);
    link.classed("dim", l => !path.has(l));
    node.classed("dim", n => !ids.has(n.id));
    d3.selectAll("#steps li").classed("active", function () {
      return +this.dataset.step === STEP[d.kind];
    });
    const c = current[d.id];
    const value = d.kind === "indicator"
      ? `What-if value ${d3.format(".1f")(whatIf[d.id])}%: higher than ${f0(c.pct)}% of block groups (percentile ${f0(c.pct)})`
      : `Mean of inputs ${f0(c.mean)} → re-ranked to percentile ${f0(c.pct)}`;
    tooltip
      .property("hidden", false)
      .style("left", event.clientX + 14 + "px")
      .style("top", event.clientY + 14 + "px")
      .html(`<strong>${d.id}</strong><br>${value}<br><span class="muted">Weight: ${pct(d.weight)} of the final average</span>`);
  })
    .on("mouseleave", () => {
      link.classed("dim", false);
      node.classed("dim", false);
      d3.selectAll("#steps li").classed("active", false);
      tooltip.property("hidden", true);
    });

  tierG.selectAll("rect")
    .on("mouseenter", (event, t) => {
      const i = TIERS.indexOf(t);
      tooltip
        .property("hidden", false)
        .style("left", event.clientX + 14 + "px")
        .style("top", event.clientY + 14 + "px")
        .html(`<strong>${t} priority</strong><br><span class="muted">TEPI percentile ${i * 20}–${(i + 1) * 20} (~143 block groups)</span>`);
    })
    .on("mouseleave", () => tooltip.property("hidden", true));
}

// ---- What-if inputs ----
function buildWhatIf() {
  const panel = d3.select("#whatif-inputs").html("");
  const domainOf = {};
  TEPI_TREE.children.forEach(t => (function mark(n) { domainOf[n.id] = t.id; (n.children || []).forEach(mark); })(t));

  const row = panel.selectAll(".wi-row")
    .data(INDICATORS)
    .join("div")
    .attr("class", "wi-row")
    .style("border-left-color", d => DOMAIN_COLOR[domainOf[d]]);
  row.append("label").attr("for", d => "wi-" + d).text(d => d);
  const ctl = row.append("div").attr("class", "wi-ctl");
  // Slider runs 0 to the county maximum, so it lines up with the histogram below.
  const maxOf = d => Math.ceil(d3.max(REF[d]));
  const track = ctl.append("div").attr("class", "wi-track");
  track.append("input")
    .attr("type", "range").attr("min", 0).attr("max", maxOf).attr("step", 0.1)
    .attr("id", d => "wi-" + d)
    .attr("class", "wi-range");
  const num = ctl.append("div").attr("class", "wi-numwrap");
  num.append("input")
    .attr("type", "number").attr("min", 0).attr("max", 100).attr("step", 0.1)
    .attr("class", "wi-num")
    .attr("aria-label", d => d + " (%)");
  num.append("span").text("%");

  // Distribution of the real block groups, with the what-if value marked.
  const hw = 200, hh = 30;
  const hist = track.append("svg").attr("class", "wi-hist").attr("viewBox", `0 0 ${hw} ${hh}`)
    .attr("preserveAspectRatio", "none");
  const context = row.append("div").attr("class", "wi-context");
  hist.each(function (d) {
    const svg = d3.select(this);
    const vals = REF[d].filter(v => v != null);
    const x = d3.scaleLinear([0, maxOf(d)], [0, hw]);
    const bins = d3.bin().domain(x.domain()).thresholds(30)(vals);
    const y = d3.scaleLinear([0, d3.max(bins, b => b.length)], [hh - 2, 2]);
    svg.selectAll("rect").data(bins).join("rect")
      .attr("x", b => x(b.x0) + 0.5).attr("width", b => Math.max(0, x(b.x1) - x(b.x0) - 1))
      .attr("y", b => y(b.length)).attr("height", b => hh - 2 - y(b.length))
      .attr("fill", "#c3c2b7");
    svg.append("line").attr("class", "wi-median")
      .attr("x1", x(d3.median(vals))).attr("x2", x(d3.median(vals))).attr("y1", 0).attr("y2", hh);
    svg.append("line").attr("class", "wi-marker").attr("y1", 0).attr("y2", hh)
      .attr("stroke", DOMAIN_COLOR[domainOf[d]]);
    this.__x = x;
  });

  const lowerShare = d => d3.bisectLeft(SORTED[d], whatIf[d] - 1e-9) / SORTED[d].length;
  const sync = () => {
    row.select(".wi-range").property("value", d => whatIf[d]);
    row.select(".wi-num").property("value", d => +whatIf[d].toFixed(1));
    hist.select(".wi-marker").each(function (d) {
      const x = this.parentNode.__x;
      const px = x(Math.min(whatIf[d], x.domain()[1]));
      d3.select(this).attr("x1", px).attr("x2", px);
    });
    context.html(d => `Higher than <strong>${d3.format(".0%")(lowerShare(d))}</strong> of block groups · median ${d3.format(".1f")(d3.median(SORTED[d]))}%`);
    updatePipeline();
  };
  row.selectAll("input").on("input", function (event, d) {
    const v = Math.max(0, Math.min(100, +this.value || 0));
    whatIf[d] = v;
    sync();
  });

  // Start from the county median, or copy a real block group's values.
  const select = d3.select("#whatif-load");
  select.selectAll("option.bg")
    .data(VALUES._label.map((label, i) => ({ label, i })).filter(d => VALUES.TEPI[d.i] != null)
      .sort((a, b) => d3.ascending(a.label, b.label, { numeric: true })))
    .join("option")
    .attr("class", "bg")
    .attr("value", d => d.i)
    .text(d => d.label);
  select.on("change", function () {
    if (this.value === "median") Object.assign(whatIf, COUNTY_MEDIAN);
    else INDICATORS.forEach(k => (whatIf[k] = REF[k][+this.value] ?? COUNTY_MEDIAN[k]));
    const i = +this.value, f = d3.format(".1f");
    const rec = REF_KEY !== "published" && window.TEPI_YEARS ? window.TEPI_YEARS[REF_KEY][i] : null;
    d3.select("#whatif-published").text(
      this.value === "median" ? "" : `Published TEPI percentile for this block group: ${f(VALUES._tepiPct[i])} (${tierOf(VALUES._tepiPct[i])})` +
        (rec != null ? ` · recomputed for ${REF_KEY - 4}–${REF_KEY}: ${f(rec)} (${tierOf(rec)})` : "")
    );
    sync();
  });
  sync();
}

drawPipeline();
buildWhatIf();
// "Rank against": TEPI as published, or one ACS release (rebuilds the panel).
d3.select("#whatif-ref").on("change", function () {
  const keep = d3.select("#whatif-load").property("value");
  setReference(this.value === "published" ? "published" : +this.value);
  buildWhatIf();
  d3.select("#whatif-load").property("value", keep).dispatch("change");
  updatePipeline();
});
d3.select('[data-view="view1"]').on("click.pipeline", () => requestAnimationFrame(() => { drawPipeline(); updatePipeline(); }));
window.addEventListener("resize", drawPipeline);
