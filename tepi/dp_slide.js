// ---- Slide: how differential privacy works ----
// The median block group's count for four of TEPI's inputs (ACS 2019-23), each
// with 30 draws of Laplace noise of scale 1/epsilon and the range holding 95%
// of the noise (+-ln(20)/epsilon), shown relative to the count. The noise is
// the same number of people for every count, so it swamps the small ones.
const DPS_ROWS = [
  ["People of color", "People of color"],
  ["Poverty", "Below poverty"],
  ["Unemployment", "Unemployed"],
  ["No vehicle", "No vehicle"],
].map(([k, label]) => {
  const v = MAP.census.value[k][2023], d = MAP.census.den[k][2023];
  const counts = d3.range(NBG).filter(i => v[i] != null && d[i]).map(i => (v[i] / 100) * d[i]);
  return { k, label, count: Math.round(d3.median(counts)) };
});
const dpsState = { eps: 1 };
function dpsLaplace(rand, b) { const u = rand() - 0.5; return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); }

function drawDPSlide() {
  const svg = d3.select("#dp-noise"), box = svg.node().getBoundingClientRect();
  if (!box.width) return;
  const W = box.width, H = box.height, m = { l: 140, r: 96, t: 22, b: 40 }, eps = dpsState.eps, b = 1 / eps, half = Math.log(20) * b;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
  // error relative to the count: (noisy - true) / true, clipped at +-100%
  const x = d3.scaleLinear([-1, 1], [m.l, W - m.r]).clamp(true);
  const y = d3.scaleBand(DPS_ROWS.map(r => r.label), [m.t, H - m.b]).padding(0.3);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues([-1, -0.5, 0, 0.5, 1]).tickFormat(v => (v ? d3.format("+.0%")(v) : "0")).tickSize(3));
  svg.append("text").attr("x", x(0)).attr("y", H - 4).attr("text-anchor", "middle").style("font-size", "13px").attr("fill", "currentColor").attr("opacity", 0.75).text("noisy count vs true count");
  svg.append("text").attr("x", W - m.r + 10).attr("y", m.t - 8).style("font-size", "12px").attr("fill", "currentColor").attr("opacity", 0.75).text("count · noise");
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t - 4).attr("y2", H - m.b).attr("stroke", "#000FA1").attr("stroke-width", 2);
  const rand = nbRandom(19);
  DPS_ROWS.forEach(r => {
    const y0 = y(r.label), bh = y.bandwidth(), rel = half / r.count;
    svg.append("text").attr("x", m.l - 12).attr("y", y0 + bh / 2 + 5).attr("text-anchor", "end").style("font-size", "15px").style("font-weight", 600).attr("fill", "currentColor").text(r.label);
    svg.append("rect").attr("x", m.l).attr("y", y0).attr("width", Math.max(0, W - m.r - m.l)).attr("height", bh).attr("fill", "#000FA1").attr("opacity", 0.05);
    // 95% of the noise, as a share of this count
    svg.append("rect").attr("x", x(-rel)).attr("y", y0).attr("width", x(rel) - x(-rel)).attr("height", bh).attr("fill", "#e8710a").attr("opacity", 0.25);
    svg.append("g").selectAll("circle").data(d3.range(30).map(() => dpsLaplace(rand, b) / r.count)).join("circle")
      .attr("cx", v => x(v)).attr("cy", (_, k) => y0 + bh / 2 + ((k % 5) - 2) * (bh / 6.5)).attr("r", 3.2).attr("fill", "#e8710a").attr("opacity", 0.85);
    svg.append("text").attr("x", W - m.r + 10).attr("y", y0 + bh / 2 + 5).style("font-size", "14px").attr("fill", "currentColor")
      .html(`${r.count} · <tspan font-weight="700">±${d3.format(rel < 0.01 ? ".1%" : ".0%")(rel)}</tspan>`);
  });
  d3.select("#dp-note").text(`Each row: the median block group's count (2019–23). Dots: 30 noisy draws at ε = ${eps}; shaded: 95% of the noise (±${d3.format(half < 1 ? ".1f" : ".0f")(half)} people, the same for every count). Clipped at ±100%.`);
}
d3.selectAll("#dp-eps [data-eps]").on("click", function () {
  dpsState.eps = +this.dataset.eps;
  d3.selectAll("#dp-eps [data-eps]").attr("aria-pressed", function () { return +this.dataset.eps === dpsState.eps; });
  drawDPSlide();
});
d3.select('[data-view="dpmechview"]').on("click.dps", () => requestAnimationFrame(drawDPSlide));
window.addEventListener("resize", () => { if (!document.getElementById("dpmechview").hidden) drawDPSlide(); });
