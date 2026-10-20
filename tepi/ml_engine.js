// ---- Browser ML pipeline: preprocessing -> k-means -> PCA -> scores ----
// Mirrors scikit-learn's defaults (SimpleImputer, StandardScaler,
// MinMaxScaler, KMeans with k-means++ and n_init=10, PCA) so the "novice
// default" setting matches prep_data.py's reference run.

// Small seeded RNG so results are the same every time the page loads.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sqDist = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) { const d = a[j] - b[j]; s += d * d; } return s; };

// ---- Preprocessing ----
// columns: array of arrays (one per variable, null = missing).
// Returns { rows: kept row indices, X: rows × vars matrix }.
function preprocess(columns, { missing, scaling }) {
  const n = columns[0].length;
  let rows = d3.range(n);
  if (missing === "drop") rows = rows.filter(i => columns.every(c => c[i] != null));

  const X = rows.map(() => new Array(columns.length));
  columns.forEach((col, j) => {
    let v = rows.map(i => col[i]);
    if (missing === "median") {
      const med = d3.median(v.filter(x => x != null));
      v = v.map(x => (x == null ? med : x));
    }
    if (scaling === "log") v = v.map(x => Math.log1p(x));
    if (scaling === "percentile") {
      // TEPI's formula: (rank − 1) / (n − 1), ties share the lowest rank.
      const sorted = [...v].sort(d3.ascending);
      v = v.map(x => d3.bisectLeft(sorted, x) / (sorted.length - 1));
    } else if (scaling === "minmax") {
      const [lo, hi] = d3.extent(v);
      v = v.map(x => (hi > lo ? (x - lo) / (hi - lo) : 0));
    } else {
      // standard / log: z-score with the population std, like StandardScaler.
      const mean = d3.mean(v);
      const sd = Math.sqrt(d3.mean(v, x => (x - mean) ** 2)) || 1;
      v = v.map(x => (x - mean) / sd);
    }
    v.forEach((x, r) => (X[r][j] = x));
  });
  return { rows, X };
}

// ---- k-means (Lloyd's algorithm, k-means++ init, best of nInit runs) ----
function kmeans(X, k, { nInit = 10, maxIter = 300, seed = 0 } = {}) {
  const n = X.length, d = X[0].length;
  let best = null;
  for (let run = 0; run < nInit; run++) {
    const rand = mulberry32(seed * 1000 + run);
    // k-means++: each new centre is picked with probability ∝ squared distance.
    const centres = [X[Math.floor(rand() * n)].slice()];
    const dist = X.map(x => sqDist(x, centres[0]));
    while (centres.length < k) {
      let r = rand() * d3.sum(dist), i = 0;
      while ((r -= dist[i]) > 0 && i < n - 1) i++;
      centres.push(X[i].slice());
      X.forEach((x, p) => (dist[p] = Math.min(dist[p], sqDist(x, centres.at(-1)))));
    }
    const labels = new Array(n).fill(0);
    for (let it = 0; it < maxIter; it++) {
      let moved = false;
      X.forEach((x, p) => {
        let bi = 0, bd = Infinity;
        centres.forEach((c, ci) => { const dd = sqDist(x, c); if (dd < bd) { bd = dd; bi = ci; } });
        if (labels[p] !== bi) { labels[p] = bi; moved = true; }
      });
      centres.forEach((c, ci) => {
        const members = X.filter((_, p) => labels[p] === ci);
        if (members.length) for (let j = 0; j < d; j++) c[j] = d3.mean(members, m => m[j]);
      });
      if (!moved && it > 0) break;
    }
    const inertia = d3.sum(X, (x, p) => sqDist(x, centres[labels[p]]));
    if (!best || inertia < best.inertia) best = { labels, centres, inertia };
  }
  return best;
}

// ---- PCA: top-2 eigenvectors of the covariance matrix (power iteration) ----
function pca2(X) {
  const n = X.length, d = X[0].length;
  const mean = d3.range(d).map(j => d3.mean(X, x => x[j]));
  const C = d3.range(d).map(a => d3.range(d).map(b =>
    d3.sum(X, x => (x[a] - mean[a]) * (x[b] - mean[b])) / (n - 1)));
  const total = d3.sum(d3.range(d), j => C[j][j]);
  const comps = [], explained = [];
  for (let c = 0; c < Math.min(2, d); c++) {
    let v = d3.range(d).map((_, j) => 1 / Math.sqrt(d) + j * 1e-3);
    for (let it = 0; it < 500; it++) {
      const w = C.map(row => d3.sum(row, (x, j) => x * v[j]));
      const norm = Math.hypot(...w) || 1;
      v = w.map(x => x / norm);
    }
    const lambda = d3.sum(C, (row, a) => v[a] * d3.sum(row, (x, b) => x * v[b]));
    comps.push(v);
    explained.push(lambda / total);
    C.forEach((row, a) => row.forEach((_, b) => (row[b] -= lambda * v[a] * v[b]))); // deflate
  }
  // Orient PC1 so that higher = more of the indicators on average.
  if (d3.sum(comps[0]) < 0) comps[0] = comps[0].map(x => -x);
  const scores = X.map(x => comps.map(v => d3.sum(v, (w, j) => w * (x[j] - mean[j]))));
  return { scores, explained, components: comps };
}

// ---- Agreement and cluster-quality scores ----
function adjustedRand(a, b) {
  const c2 = x => (x * (x - 1)) / 2;
  const table = d3.rollup(a.map((x, i) => [x, b[i]]), v => v.length, p => p[0], p => p[1]);
  let sumCells = 0;
  table.forEach(row => row.forEach(n => (sumCells += c2(n))));
  const sumA = d3.sum([...d3.rollup(a, v => v.length, x => x).values()], c2);
  const sumB = d3.sum([...d3.rollup(b, v => v.length, x => x).values()], c2);
  const expected = (sumA * sumB) / c2(a.length);
  const max = (sumA + sumB) / 2;
  return max === expected ? 0 : (sumCells - expected) / (max - expected);
}

function silhouette(X, labels) {
  const k = d3.max(labels) + 1;
  const scores = X.map((x, i) => {
    const sum = new Array(k).fill(0), cnt = new Array(k).fill(0);
    X.forEach((y, j) => { if (i !== j) { sum[labels[j]] += Math.sqrt(sqDist(x, y)); cnt[labels[j]]++; } });
    if (!cnt[labels[i]]) return 0; // singleton cluster
    const a = sum[labels[i]] / cnt[labels[i]];
    const b = d3.min(d3.range(k).filter(c => c !== labels[i] && cnt[c]), c => sum[c] / cnt[c]);
    return b == null ? 0 : (b - a) / Math.max(a, b);
  });
  return d3.mean(scores);
}
