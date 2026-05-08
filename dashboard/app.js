// =============================================================
// Recovery, Honestly — frontend
// Wires:
//   - microbiome.json  -> 2x2 SVG avatar grid + drilldown
//   - cbc.json         -> per-metric Plotly small multiples
//   - timepoint slider -> repaints all four avatars in sync
//   - region click     -> drilldown panel with top taxa
//   - figure click     -> crew selection (fades others, highlights CBC)
//
// Data contract: dashboard/data/microbiome.json + dashboard/data/cbc.json
// (currently fetched as fixture-*.json — flip URLs once real pipelines emit).
// =============================================================

const DATA_DIR = "./data";
const MICROBIOME_URL = `${DATA_DIR}/microbiome.json`;
const CBC_URL = `${DATA_DIR}/cbc.json`;
const OPPORTUNISTS_URL = `${DATA_DIR}/opportunists.json`;
const BENEFICIALS_URL = `${DATA_DIR}/beneficials.json`;
const BODY_SVG_URL = "./body.svg";

// Color stops mirror the --score-* CSS custom properties in styles.css.
const SCORE_STOPS = ["#ececec", "#fde0c5", "#fbb88a", "#f78250", "#d94a1f", "#8c1d10"];

// Per-crew Plotly line color (kept distinct, colorblind-aware-ish).
const CREW_COLORS = {
  C001: "#1f77b4",
  C002: "#ff7f0e",
  C003: "#2ca02c",
  C004: "#9467bd",
};

// Synthetic in-flight x-tick used to render the L-3 → R+1 gap visibly.
const IN_FLIGHT_TICK = "Flight (no CBC)";

const state = {
  microbiome: null,
  cbc: null,
  opportunists: null,  // { speciesName: { note, ref } }
  beneficials: null,   // { speciesName: { note, ref } }
  timepointIdx: 0,
  selectedCrew: null,
};

// =============================================================
// Loading
// =============================================================

async function loadAll() {
  const [microbiome, cbc, opportunists, beneficials, bodyText] = await Promise.all([
    fetch(MICROBIOME_URL).then(r => r.json()),
    fetch(CBC_URL).then(r => r.json()),
    fetch(OPPORTUNISTS_URL).then(r => r.json()).catch(() => ({})),
    fetch(BENEFICIALS_URL).then(r => r.json()).catch(() => ({})),
    fetch(BODY_SVG_URL).then(r => r.text()),
  ]);
  const bodyDoc = new DOMParser().parseFromString(bodyText, "image/svg+xml").documentElement;
  return { microbiome, cbc, opportunists, beneficials, bodyDoc };
}

// Returns { note, ref } if the species is on the curated opportunist list, else null.
function concernFor(taxonName) {
  if (!state.opportunists) return null;
  const entry = state.opportunists[taxonName];
  if (!entry || !entry.note) return null;
  return entry;
}

// Returns { note, ref } if the species is on the curated beneficial list, else null.
function beneficialFor(taxonName) {
  if (!state.beneficials) return null;
  const entry = state.beneficials[taxonName];
  if (!entry || !entry.note) return null;
  return entry;
}

// =============================================================
// Color interpolation
// =============================================================

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToCss([r, g, b]) {
  return `rgb(${r|0}, ${g|0}, ${b|0})`;
}

function colorForScore(d, withinBaselineNoise) {
  if (withinBaselineNoise || d == null) return SCORE_STOPS[0];
  const clamped = Math.max(0, Math.min(1, d));
  const segments = SCORE_STOPS.length - 1;
  const pos = clamped * segments;
  const i = Math.min(Math.floor(pos), segments - 1);
  const t = pos - i;
  const a = hexToRgb(SCORE_STOPS[i]);
  const b = hexToRgb(SCORE_STOPS[i + 1]);
  return rgbToCss(a.map((v, k) => v + (b[k] - v) * t));
}

// =============================================================
// SVG mounting + painting
// =============================================================

function mountAvatars(bodyDoc) {
  document.querySelectorAll("figure[data-crew] .avatar").forEach(host => {
    host.appendChild(bodyDoc.cloneNode(true));
  });
}

function paintAvatar(crew, timepoint) {
  const fig = document.querySelector(`figure[data-crew="${crew}"]`);
  if (!fig) return;
  const crewScores = state.microbiome.scores[crew] || {};

  fig.querySelectorAll(".region").forEach(node => {
    const site = node.dataset.region;
    const cell = (crewScores[site] || {})[timepoint];
    if (!cell) {
      node.setAttribute("data-no-data", "true");
      node.style.fill = "";
      node.dataset.score = "";
      // Tooltip
      ensureTitle(node, `${labelForSite(site)} · ${timepoint}: no swab collected`);
    } else {
      node.removeAttribute("data-no-data");
      node.style.fill = colorForScore(cell.d, cell.within_baseline_noise);
      node.dataset.score = String(cell.d);
      const noiseTag = cell.within_baseline_noise ? " (within baseline noise)" : "";
      ensureTitle(node, `${labelForSite(site)} · ${timepoint}\nd = ${cell.d.toFixed(2)} [95% CI ${cell.ci_lo.toFixed(2)}–${cell.ci_hi.toFixed(2)}], n_baseline = ${cell.n_baseline}${noiseTag}`);
    }
  });
}

function ensureTitle(node, text) {
  let title = node.querySelector("title");
  if (!title) {
    title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    node.appendChild(title);
  }
  title.textContent = text;
}

function repaintAll() {
  const tp = state.microbiome.timepoints[state.timepointIdx];
  document.getElementById("timepoint-label").textContent = tp;
  state.microbiome.crew.forEach(crew => paintAvatar(crew, tp));
  // Refresh drilldown if it's open against the new timepoint
  refreshDrilldown();
}

// =============================================================
// Site / interpretation helpers
// =============================================================

const SITE_LABELS = {
  oral: "Oral",
  nasal: "Nasal cavity",
  post_auricular: "Post-auricular",
  axillary: "Axillary (armpit)",
  forearm: "Volar forearm",
  occiput: "Occiput (back of head)",
  umbilicus: "Umbilicus (belly button)",
  gluteal: "Gluteal crease",
  glabella: "Glabella (between brows)",
  toe_web: "Toe web space",
};

function labelForSite(site) {
  return SITE_LABELS[site] || site;
}

function plainLanguageScore(d, withinBaselineNoise) {
  if (withinBaselineNoise) {
    return "Within your pre-flight noise — we can't distinguish this from your normal variation.";
  }
  if (d < 0.2) return "Near your pre-flight baseline.";
  if (d < 0.5) return "Moderately shifted from your pre-flight microbiome.";
  return "Strongly shifted from your pre-flight microbiome.";
}

// =============================================================
// Drilldown
// =============================================================

let activeDrilldown = null;  // { crew, site }

function openDrilldown(crew, site) {
  activeDrilldown = { crew, site };
  refreshDrilldown();
}

function closeDrilldown() {
  activeDrilldown = null;
  const panel = document.getElementById("drilldown");
  panel.hidden = true;
}

function refreshDrilldown() {
  if (!activeDrilldown) return;
  const { crew, site } = activeDrilldown;
  const tp = state.microbiome.timepoints[state.timepointIdx];
  const panel = document.getElementById("drilldown");
  panel.hidden = false;

  document.getElementById("drilldown-title").textContent =
    `${labelForSite(site)} · ${tp}`;
  document.getElementById("drilldown-tag").textContent = `crew ${crew}`;

  const cell = ((state.microbiome.scores[crew] || {})[site] || {})[tp];
  const summary = document.getElementById("drilldown-summary");
  const content = document.getElementById("drilldown-content");

  if (!cell) {
    summary.textContent = "";
    content.innerHTML = `<div class="no-swab-msg">No swab was collected at this site for this timepoint. Drag the slider to a different timepoint to see when data is available.</div>`;
    return;
  }

  summary.innerHTML =
    `<span class="score">d = ${cell.d.toFixed(2)}</span> ` +
    `<span class="ci">95% CI ${cell.ci_lo.toFixed(2)} – ${cell.ci_hi.toFixed(2)} · n_baseline = ${cell.n_baseline}</span>` +
    `<br>${plainLanguageScore(cell.d, cell.within_baseline_noise)}`;

  // Drilldown taxa lookup is a separate index in the JSON so missing entries are graceful.
  const drill = (((state.microbiome.drilldown || {})[crew] || {})[site] || {})[tp];

  if (!drill) {
    content.innerHTML = `<div class="no-swab-msg">Top-taxa breakdown not available for this site/timepoint in the current data.</div>`;
    return;
  }

  // Decide which annotation badge (if any) fires for a given taxon in a given list direction.
  // Returns { kind: "caution"|"favorable", icon, label, note, ref } or null.
  function annotationFor(name, klass) {
    const opp = concernFor(name);
    const ben = beneficialFor(name);
    if (klass === "up") {
      if (opp) return { kind: "caution",   icon: "⚠", label: "opportunist increased",   ...opp };
      if (ben) return { kind: "favorable", icon: "✓", label: "beneficial increased",    ...ben };
    } else {  // "down"
      if (opp) return { kind: "favorable", icon: "✓", label: "opportunist decreased",   ...opp };
      if (ben) return { kind: "caution",   icon: "⚠", label: "beneficial decreased",    ...ben };
    }
    return null;
  }

  const renderList = (items, klass) => {
    if (items.length === 0) return `<li class="muted">none</li>`;
    return items.map(t => {
      const annot = annotationFor(t.name, klass);
      const badge = annot
        ? ` <span class="annot-badge ${annot.kind}" title="${escapeHtml(annot.note)} — ${escapeHtml(annot.ref)}">${annot.icon} ${escapeHtml(annot.label)}</span>`
        : "";
      return `<li><span class="taxon">${escapeHtml(t.name)}${badge}</span><span class="delta ${klass}">${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}</span></li>`;
    }).join("");
  };

  const anyAnnot =
    (drill.top_taxa_up   || []).some(t => annotationFor(t.name, "up"))   ||
    (drill.top_taxa_down || []).some(t => annotationFor(t.name, "down"));
  const concernHint = anyAnnot
    ? `<p class="concern-hint">
         <strong>⚠</strong> may matter (opportunist rising or beneficial falling) ·
         <strong>✓</strong> may be favorable (beneficial rising or opportunist falling).
         Lists are curated from microbiome literature; absence of a badge isn't a clean bill of health.
         Hover any badge for the citation.
       </p>`
    : "";

  content.innerHTML = `
    <div id="drilldown-tables">
      <div>
        <h4>Top taxa increased vs baseline</h4>
        <ol>${renderList(drill.top_taxa_up || [], "up")}</ol>
      </div>
      <div>
        <h4>Top taxa decreased vs baseline</h4>
        <ol>${renderList(drill.top_taxa_down || [], "down")}</ol>
      </div>
    </div>
    ${concernHint}
    <p class="caveat">With only ${cell.n_baseline} baseline samples, these rankings are noisy. Treat them as descriptive, not diagnostic.</p>
  `;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// =============================================================
// Crew selection (highlight a crew in CBC + dim others)
// =============================================================

function selectCrew(crew) {
  const grid = document.getElementById("avatar-grid");
  const figs = grid.querySelectorAll("figure[data-crew]");

  if (state.selectedCrew === crew) {
    state.selectedCrew = null;
    grid.classList.remove("has-selection");
    figs.forEach(f => f.classList.remove("selected"));
  } else {
    state.selectedCrew = crew;
    grid.classList.add("has-selection");
    figs.forEach(f => f.classList.toggle("selected", f.dataset.crew === crew));
  }
  // Re-render CBC traces so selected crew comes forward
  renderCBC();
}

// =============================================================
// CBC plots (Plotly)
// =============================================================

function buildCbcXY(metric, crew) {
  // Insert a synthetic in-flight x with null y between L-3 and R+1 so the line breaks.
  const tps = state.cbc.timepoints;
  const vals = state.cbc.metrics[metric].values[crew] || {};
  const ci = (state.cbc.metrics[metric].trajectory_ci || {})[crew] || {};
  const x = [];
  const y = [];
  const yLow = [];
  const yHigh = [];
  for (let i = 0; i < tps.length; i++) {
    const t = tps[i];
    x.push(t);
    y.push(vals[t] != null ? vals[t] : null);
    if (ci[t]) {
      yLow.push(ci[t][0]);
      yHigh.push(ci[t][1]);
    } else {
      yLow.push(null);
      yHigh.push(null);
    }
    if (t === "L-3") {
      x.push(IN_FLIGHT_TICK);
      y.push(null);
      yLow.push(null);
      yHigh.push(null);
    }
  }
  return { x, y, yLow, yHigh };
}

function renderCBC() {
  const root = document.getElementById("cbc-plots");
  root.innerHTML = "";
  const metricKeys = Object.keys(state.cbc.metrics);

  metricKeys.forEach(metric => {
    const m = state.cbc.metrics[metric];

    const card = document.createElement("div");
    card.className = "cbc-metric";
    card.innerHTML = `
      <div class="cbc-metric-title">
        <span>${escapeHtml(m.label)}</span>
        <span class="units">${escapeHtml(m.units || "")}</span>
      </div>
      <div class="cbc-plot" id="plot-${metric}"></div>
    `;
    root.appendChild(card);

    const traces = [];

    // Reference range as filled background band
    if (Array.isArray(m.reference_range)) {
      const [lo, hi] = m.reference_range;
      // Two horizontal traces filled between
      // We'll instead use Plotly shapes via layout for the band.
    }

    state.cbc.crew.forEach(crew => {
      const { x, y, yLow, yHigh } = buildCbcXY(metric, crew);
      const isSelected = state.selectedCrew === null || state.selectedCrew === crew;
      const baseColor = CREW_COLORS[crew] || "#666";
      const opacity = isSelected ? 1.0 : 0.18;

      // CI band as a filled trace (yHigh upper, yLow lower)
      traces.push({
        x: x.concat(x.slice().reverse()),
        y: yHigh.concat(yLow.slice().reverse()),
        fill: "toself",
        fillcolor: hexToRgba(baseColor, isSelected ? 0.12 : 0.04),
        line: { color: "rgba(0,0,0,0)" },
        hoverinfo: "skip",
        showlegend: false,
        connectgaps: false,
        name: `${crew} CI`,
      });
      // Main line
      traces.push({
        x, y,
        mode: "lines+markers",
        type: "scatter",
        name: crew,
        line: { color: baseColor, width: isSelected ? 2.5 : 1.5 },
        marker: { size: isSelected ? 6 : 4, color: baseColor, opacity },
        opacity,
        connectgaps: false,
        hovertemplate: `<b>${crew}</b><br>%{x}: %{y}<extra></extra>`,
      });
    });

    const refRange = Array.isArray(m.reference_range) ? m.reference_range : null;
    const layout = {
      margin: { t: 10, r: 10, b: 36, l: 44 },
      showlegend: false,
      xaxis: { tickfont: { size: 10 }, automargin: true },
      yaxis: { title: { text: m.units || "", font: { size: 10 } }, tickfont: { size: 10 }, automargin: true },
      shapes: refRange ? [{
        type: "rect", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: refRange[0], y1: refRange[1],
        fillcolor: "rgba(60, 130, 60, 0.07)",
        line: { width: 0 },
        layer: "below",
      }] : [],
      annotations: refRange ? [{
        xref: "paper", yref: "y",
        x: 0.99, y: refRange[1],
        text: `clinical reference: ${refRange[0]}–${refRange[1]} ${m.units || ""}`,
        showarrow: false, xanchor: "right", yanchor: "bottom",
        font: { size: 10, color: "#3a6b3a" },
      }] : [],
      hovermode: "x unified",
    };

    Plotly.newPlot(`plot-${metric}`, traces, layout, {
      displayModeBar: false,
      responsive: true,
    });
  });
}

function hexToRgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// =============================================================
// Event wiring
// =============================================================

function wireEvents() {
  // Slider
  const slider = document.getElementById("timepoint");
  slider.max = String(state.microbiome.timepoints.length - 1);
  slider.value = String(state.timepointIdx);
  slider.addEventListener("input", (e) => {
    state.timepointIdx = Number(e.target.value);
    repaintAll();
  });

  // Avatar grid: click figure -> select crew, click region -> drilldown
  const grid = document.getElementById("avatar-grid");
  grid.addEventListener("click", (e) => {
    const region = e.target.closest("[data-region]");
    const figure = e.target.closest("figure[data-crew]");
    if (!figure) return;

    if (region) {
      e.stopPropagation();
      openDrilldown(figure.dataset.crew, region.dataset.region);
    } else {
      selectCrew(figure.dataset.crew);
    }
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const figure = e.target.closest("figure[data-crew]");
    if (figure) { e.preventDefault(); selectCrew(figure.dataset.crew); }
  });
}

// =============================================================
// Boot
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const { microbiome, cbc, opportunists, beneficials, bodyDoc } = await loadAll();
    state.microbiome = microbiome;
    state.cbc = cbc;
    state.opportunists = opportunists;
    state.beneficials = beneficials;

    mountAvatars(bodyDoc);
    wireEvents();
    repaintAll();
    renderCBC();
  } catch (err) {
    console.error("Dashboard failed to load:", err);
    document.getElementById("cbc-plots").innerHTML =
      `<p style="color: #b00; padding: 12px;">Failed to load data. Check the console.</p>`;
  }
});
