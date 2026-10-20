// ---- Page-by-page walkthrough ----
// A footer at the bottom of each page links to the previous and next page,
// in tab order. It switches pages by clicking the page's tab, so each page's
// own drawing code runs as usual, then scrolls back to the top.
// The left/right arrow keys do the same (unless typing in a field).
// Slides (class slide-tab, e.g. the title) are in this sequence but hidden
// from the tab bar, which lists only the dashboards.
const PAGES = d3.selectAll(".toggle button").nodes().filter(b => !b.hidden);
const goTo = k => {
  if (k < 0 || k >= PAGES.length) return;
  PAGES[k].click();
  window.scrollTo(0, 0);
};
const current = () => PAGES.findIndex(b => b.getAttribute("aria-selected") === "true");

PAGES.forEach((btn, k) => {
  const section = document.getElementById(btn.dataset.view);
  const nav = d3.select(section).append("nav").attr("class", "page-nav").attr("aria-label", "Page navigation");
  nav.append("button").attr("class", "btn page-prev").property("disabled", k === 0)
    .text(k > 0 ? `← ${PAGES[k - 1].textContent}` : "")
    .style("visibility", k > 0 ? null : "hidden")
    .on("click", () => goTo(k - 1));
  nav.append("span").attr("class", "page-count").text(`Page ${k + 1} of ${PAGES.length}`);
  nav.append("button").attr("class", "btn page-next")
    .text(k < PAGES.length - 1 ? `Next: ${PAGES[k + 1].textContent} →` : "")
    .style("visibility", k < PAGES.length - 1 ? null : "hidden")
    .on("click", () => goTo(k + 1));
});

document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey || sorterOpen()) return;
  if (e.key === "ArrowRight") goTo(current() + 1);
  if (e.key === "ArrowLeft") goTo(current() - 1);
});
d3.select("#home-link").on("click", e => { e.preventDefault(); goTo(0); });

// ---- Slide sorter (like PowerPoint's): every page and slide as a card ----
// Grouped by the tab's data-section; Findings lists the "Show me" walkthroughs.
function openSorter() {
  const cur = current(), body = d3.select("#sorter-body").html("");
  const sections = [...new Set(PAGES.map(b => b.dataset.section || "Other"))];
  sections.forEach(sec => {
    body.append("div").attr("class", "sorter-section").text(sec);
    const grid = body.append("div").attr("class", "sorter-grid");
    PAGES.forEach((b, k) => {
      if ((b.dataset.section || "Other") !== sec) return;
      const dash = !b.classList.contains("slide-tab");
      const card = grid.append("button").attr("class", "sorter-card").classed("on", k === cur).classed("dash", dash)
        .on("click", () => { closeSorter(); goTo(k); });
      card.append("span").attr("class", "n").text(k + 1);
      card.append("span").attr("class", "t").text(b.textContent.replace(/^\d+ · /, ""));
      card.append("span").attr("class", "k").text(dash ? "Dashboard" : "Slide");
    });
  });
  if (typeof TOURS !== "undefined") {
    body.append("div").attr("class", "sorter-section").text("Findings (walkthroughs)");
    const grid = body.append("div").attr("class", "sorter-grid");
    Object.entries(TOURS).forEach(([id, T]) => {
      const card = grid.append("button").attr("class", "sorter-card find").on("click", () => { closeSorter(); tourStart(id); });
      card.append("span").attr("class", "n").text("▶ " + id);
      card.append("span").attr("class", "t").text(T.title.replace(/^T\d · /, ""));
      card.append("span").attr("class", "k").text(`${T.steps.length} steps`);
    });
  }
  d3.select("#sorter").property("hidden", false);
}
function closeSorter() { d3.select("#sorter").property("hidden", true); }
const sorterOpen = () => !document.getElementById("sorter").hidden;
d3.select("#sorter-open").on("click", openSorter);
d3.select("#sorter-close").on("click", closeSorter);
document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "g" || e.key === "G") sorterOpen() ? closeSorter() : openSorter();
  else if (e.key === "Escape" && sorterOpen()) closeSorter();
});
