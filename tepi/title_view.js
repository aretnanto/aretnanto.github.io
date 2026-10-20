// ---- Title page: name, date, and a TEPI tier map of the county ----
function drawTitleMap() {
  const svg = d3.select("#title-map"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const w = box.width, h = box.height;
  svg.attr("viewBox", `0 0 ${w} ${h}`).selectAll("*").remove();
  const path = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[4, 4], [w - 4, h - 4]], MAP.focus));
  svg.append("g").selectAll("path").data(d3.range(NBG)).join("path")
    .attr("d", i => path(bgFeature(i)))
    .attr("fill", i => { const t = tierIdx(tepiPct(i)); return t == null ? "#e1e0d9" : TIER_FILL(t); })
    .attr("stroke", "#fcfcfb").attr("stroke-width", 0.3);
  d3.select("#title-legend").html(`TEPI priority tier by block group (ACS ${mapState.year - 4}–${String(mapState.year).slice(2)}):<br>` +
    TIERS.map((t, k) => `<span class="title-key"><span class="title-swatch" style="background:${TIER_FILL(k)}"></span>${t}</span>`).join(" "));
}
d3.select('[data-view="titleview"]').on("click.title", () => requestAnimationFrame(drawTitleMap));
window.addEventListener("resize", () => { if (!document.getElementById("titleview").hidden) drawTitleMap(); });
drawTitleMap();
