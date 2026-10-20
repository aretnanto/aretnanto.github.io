// ---- Slide: Global Moran's I, on a toy map ----
// A 10 x 10 grid of squares, each high (1) or low (0); neighbours share a side
// (rook, as for the block groups). Flipping squares updates I, shown on a
// -1..+1 scale next to the value for TEPI in Pima County (NB_NEI from
// network_view.js).
const TOY_N = 10;
const TOY_NEI = d3.range(TOY_N * TOY_N).map(c => {
  const r = Math.floor(c / TOY_N), q = c % TOY_N, out = [];
  if (r > 0) out.push(c - TOY_N); if (r < TOY_N - 1) out.push(c + TOY_N);
  if (q > 0) out.push(c - 1); if (q < TOY_N - 1) out.push(c + 1);
  return out;
});
const TOY_PRESETS = {
  // a blob of high squares in one corner, with a ragged edge
  cluster: () => d3.range(TOY_N * TOY_N).map(c => { const r = Math.floor(c / TOY_N), q = c % TOY_N; return r + q + (((r * 7 + q * 3) % 5) - 2) * 0.6 < 9 ? 1 : 0; }),
  random: () => { const rand = nbRandom(24); return d3.range(TOY_N * TOY_N).map(() => (rand() < 0.5 ? 1 : 0)); },
  checker: () => d3.range(TOY_N * TOY_N).map(c => (Math.floor(c / TOY_N) + (c % TOY_N)) % 2),
};
let toyVals = TOY_PRESETS.cluster();
const TOY_COLOR = v => (v ? "#d7191c" : "#2c7bb6");

// Global Moran's I with row-standardised weights: sum(z * lag) / sum(z^2)
function moranI(x, nei) {
  const ok = d3.range(x.length).filter(i => x[i] != null);
  const m = d3.mean(ok, i => x[i]), sd = d3.deviation(ok, i => x[i]) || 1;
  const z = x.map(v => (v == null ? null : (v - m) / sd));
  const lag = z.map((v, i) => { const n = nei[i].filter(j => z[j] != null); return v == null || !n.length ? null : d3.mean(n, j => z[j]); });
  const use = ok.filter(i => lag[i] != null);
  return d3.sum(use, i => z[i] * lag[i]) / d3.sum(use, i => z[i] * z[i]);
}

function drawToy() {
  const svg = d3.select("#toy-map"), box = svg.node().getBoundingClientRect();
  if (!box.width || !box.height) return;
  const W = box.width, H = box.height, size = Math.min(W, H) / TOY_N, x0 = (W - size * TOY_N) / 2;
  svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("rect").data(toyVals).join("rect")
    .attr("x", (_, c) => x0 + (c % TOY_N) * size).attr("y", (_, c) => Math.floor(c / TOY_N) * size).attr("width", size).attr("height", size)
    .attr("fill", TOY_COLOR)
    .each(function (_, c) {
      d3.select(this).on("click", () => { toyVals[c] = 1 - toyVals[c]; d3.selectAll("#toy-preset button").attr("aria-pressed", false); drawToy(); });
    });

  // -1 .. +1 scale: this map's I, and TEPI's in Pima County
  const sc = d3.select("#toy-scale"), sb = sc.node().getBoundingClientRect();
  if (!sb.width) return;
  const w = sb.width, h = sb.height, I = moranI(toyVals, TOY_NEI);
  const tepiI = moranI(d3.range(NBG).map(i => TEPI_YEARS[mapState.year][i]), NB_NEI);
  const x = d3.scaleLinear([-1, 1], [12, w - 12]), y0 = 64;
  sc.attr("viewBox", `0 0 ${w} ${h}`).selectAll("*").remove();
  sc.append("rect").attr("x", x(-1)).attr("width", x(1) - x(-1)).attr("y", y0 - 4).attr("height", 8).attr("rx", 4)
    .attr("fill", "url(#toy-grad)");
  const grad = sc.append("defs").append("linearGradient").attr("id", "toy-grad");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#2c7bb6");
  grad.append("stop").attr("offset", "50%").attr("stop-color", "#e6e5e0");
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#d7191c");
  [[-1, "−1 alternating"], [0, "0 no pattern"], [1, "+1 clustered"]].forEach(([v, t]) =>
    sc.append("text").attr("class", "muted").attr("x", x(v)).attr("y", y0 + 26).attr("text-anchor", v < 0 ? "start" : v > 0 ? "end" : "middle").text(t));
  sc.append("path").attr("d", `M${x(I)},${y0 - 6}l-7,-10h14z`).attr("fill", "#1f1f1f");
  sc.append("text").attr("x", Math.min(w - 90, Math.max(0, x(I) - 40))).attr("y", y0 - 22).style("font-size", "22px").style("font-weight", 700)
    .text(`I = ${d3.format(".2f")(I)}`);
  sc.append("path").attr("d", `M${x(tepiI)},${y0 + 6}l-6,9h12z`).attr("fill", "#e8710a");
  sc.append("text").attr("x", x(tepiI)).attr("y", y0 + 48).attr("text-anchor", "middle").style("fill", "#b85a07").style("font-weight", 600)
    .text(`TEPI, Pima County block groups: ${d3.format(".2f")(tepiI)}`);
}

d3.selectAll("#toy-preset [data-preset]").on("click", function () {
  const pick = this.dataset.preset;
  toyVals = TOY_PRESETS[pick]();
  d3.selectAll("#toy-preset [data-preset]").attr("aria-pressed", function () { return this.dataset.preset === pick; });
  drawToy();
});
d3.select('[data-view="moranview"]').on("click.moran", () => requestAnimationFrame(drawToy));
window.addEventListener("resize", () => { if (!document.getElementById("moranview").hidden) drawToy(); });
