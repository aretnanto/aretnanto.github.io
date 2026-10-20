// ---- Spatial page: 2010 | 2020 block groups, swipe to compare ----
// ACS releases up to 2015-19 use 2010 block groups; from 2016-20 on, 2020
// block groups (TEPI's). The slider says how far we are from 2010 to 2020:
// at 2010 the whole map shows 2010 block groups, and moving toward 2020 wipes
// the 2020 block groups in from the left (2020 left of the divider, 2010
// right of it). Dragging the divider does the same. Counts: boundary_prep.py.
const SP = window.BOUNDARY_CHANGE;
const spState = { at: 0.5 }; // 0 = all 2010, 1 = all 2020 (= divider position, 0..1 of the map width)
let spG, spW, spH;

function drawSpatialMap() {
  const svg = d3.select("#sp-map"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  spW = box.width; spH = box.height;
  svg.attr("viewBox", `0 0 ${spW} ${spH}`).selectAll("*").remove();
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[8, 8], [spW - 8, spH - 8]], MAP.focus));
  const defs = svg.append("defs");
  defs.append("clipPath").attr("id", "sp-clip-left").append("rect").attr("id", "sp-clip-left-rect").attr("height", spH);
  defs.append("clipPath").attr("id", "sp-clip-right").append("rect").attr("id", "sp-clip-right-rect").attr("height", spH);
  const layer = (cls, clip, geoms, tip) => svg.append("g").attr("clip-path", `url(#${clip})`).append("g").attr("class", "sp-zoom")
    .selectAll("path").data(geoms).join("path").attr("class", cls).attr("d", g => path(g))
    .on("mousemove", (event, g) => showTip(event, tip(g))).on("mouseleave", hideTip);
  layer("bg10", "sp-clip-right", SP.old.map((g, j) => Object.assign({}, g, { _id: SP.oldId[j] })),
    g => `<strong>2010 block group</strong><br>${fmtGeoid(g._id)}`);
  layer("bg20", "sp-clip-left", d3.range(NBG).map(i => Object.assign({}, BG.geometry[i], { _i: i })),
    g => `<strong>2020 block group</strong><br>${bgLabel(g._i)}`);
  spG = svg.selectAll(".sp-zoom");
  // divider with a draggable handle and side labels
  const div = svg.append("g").attr("class", "sp-divider");
  div.append("line").attr("class", "divider").attr("y1", 0).attr("y2", spH);
  div.append("circle").attr("class", "handle").attr("r", 10).attr("cy", spH / 2)
    .call(d3.drag().on("drag", e => setSwipe(Math.max(0, Math.min(1, e.x / spW)))));
  div.append("text").attr("class", "side-label").attr("y", 22).attr("text-anchor", "end").style("fill", "#2f6b9a")
    .attr("id", "sp-label-left").text(`2020: ${SP.n2020} block groups`);
  div.append("text").attr("class", "side-label").attr("y", 22).style("fill", "#8a6d3b")
    .attr("id", "sp-label-right").text(`2010: ${SP.n2010} block groups`);
  svg.call(d3.zoom().scaleExtent([0.5, 16]).filter(e => (e.type === "wheel" ? e.ctrlKey || e.metaKey : !e.target.classList.contains("handle")))
    .on("zoom", ({ transform }) => spG.attr("transform", transform)));
  spG.attr("transform", d3.zoomTransform(svg.node()));
  setSwipe(spState.at);
}
const fmtGeoid = g => `Tract ${+g.slice(5, 9)}${+g.slice(9, 11) ? "." + g.slice(9, 11) : ""}, Block Group ${g[11]}`;

function setSwipe(at) {
  spState.at = at;
  d3.select("#sp-swipe").property("value", 100 * at);
  if (!spW) return;
  const x = at * spW;
  d3.select("#sp-clip-left-rect").attr("x", 0).attr("width", x);
  d3.select("#sp-clip-right-rect").attr("x", x).attr("width", spW - x);
  d3.select("#sp-map .sp-divider line").attr("x1", x).attr("x2", x);
  d3.select("#sp-map .sp-divider circle").attr("cx", x);
  d3.select("#sp-label-left").attr("x", x - 14).attr("display", x > 180 ? null : "none");
  d3.select("#sp-label-right").attr("x", x + 14).attr("display", spW - x > 180 ? null : "none");
}

function showSpatialPage() {
  const c = SP.counts;
  d3.select("#sp-summary").html(`Block groups <strong>${SP.n2010} → ${SP.n2020}</strong>, tracts <strong>${SP.tracts2010} → ${SP.tracts2020}</strong>. ` +
    `Of the 2020 block groups, ${c.unchanged} kept their 2010 shape; ${c.split} were split off, ${c.merged} merged and ${c.redrawn} redrawn.`);
  drawSpatialMap();
}
d3.select("#sp-swipe").on("input", function () { setSwipe(this.value / 100); });
d3.select('[data-view="spview"]').on("click.sp", () => requestAnimationFrame(showSpatialPage));
window.addEventListener("resize", () => { if (!document.getElementById("spview").hidden) showSpatialPage(); });
showSpatialPage();
