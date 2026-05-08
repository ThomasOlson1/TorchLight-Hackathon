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
const BLOODWORK_URL = `${DATA_DIR}/bloodwork.json`;
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
  bloodwork: null,     // { crew, timepoints, panels, systems, findings }
  opportunists: null,  // { speciesName: { note, ref } }
  beneficials: null,   // { speciesName: { note, ref } }
  timepointIdx: 0,
  selectedCrew: null,
};

// =============================================================
// Loading
// =============================================================

async function loadAll() {
  const [microbiome, bloodwork, opportunists, beneficials, bodyText] = await Promise.all([
    fetch(MICROBIOME_URL).then(r => r.json()),
    fetch(BLOODWORK_URL).then(r => r.json()),
    fetch(OPPORTUNISTS_URL).then(r => r.json()).catch(() => ({})),
    fetch(BENEFICIALS_URL).then(r => r.json()).catch(() => ({})),
    fetch(BODY_SVG_URL).then(r => r.text()),
  ]);
  const bodyDoc = new DOMParser().parseFromString(bodyText, "image/svg+xml").documentElement;
  return { microbiome, bloodwork, opportunists, beneficials, bodyDoc };
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
}

// =============================================================
// CBC plots (Plotly)
// =============================================================

function hexToRgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// =============================================================
// Per-crew personal recovery cards (primary view)
// =============================================================

const CREW_STATUS_ICON = {
  back_to_baseline:    "✓",
  mostly_back:         "✓",
  partially_recovered: "◑",
  still_shifting:     "◆",
  no_data:            "·",
};

const CREW_OVERALL_LABEL = {
  back_to_baseline:    "back to baseline",
  mostly_back:         "mostly back to baseline",
  partially_recovered: "partial recovery",
  still_shifting:      "still shifting",
  no_data:             "no data",
};

const SYSTEM_STATUS_ICON = {
  back_to_baseline: "✓",
  still_elevated:   "▲",
  still_decreased:  "▼",
  mixed:            "◆",
  no_data:          "·",
};

const SYSTEM_STATUS_LABEL = {
  back_to_baseline: "back within personal baseline",
  still_elevated:   "still elevated",
  still_decreased:  "still below baseline",
  mixed:            "mixed shifts across the panel",
  no_data:          "no data",
};

function renderCrewSummaries() {
  const root = document.getElementById("crew-grid");
  if (!root) return;
  root.innerHTML = "";
  const crewSummaries = (state.bloodwork && state.bloodwork.crew_summaries) || [];
  if (!crewSummaries.length) {
    root.innerHTML = `<p class="muted">No personal recovery cards available.</p>`;
    return;
  }

  for (const c of crewSummaries) {
    const card = document.createElement("details");
    card.className = `crew-card status-${c.overall_status || "no_data"}`;
    card.dataset.crew = c.crew_id;

    const statusIcon = CREW_STATUS_ICON[c.overall_status] || "·";
    const overallLabel = CREW_OVERALL_LABEL[c.overall_status] || c.overall_status;

    // Closed state: crew identifier, overall status, and 4 system rows with status icons.
    const systemRows = (c.systems || []).map(sys => `
      <li class="crew-system-row sys-${sys.current_status} concern-${sys.concern_level}">
        <span class="sys-status-icon" aria-hidden="true">${SYSTEM_STATUS_ICON[sys.current_status] || "·"}</span>
        <span class="sys-label">${escapeHtml(sys.label)}</span>
        <span class="sys-status-text">${escapeHtml(SYSTEM_STATUS_LABEL[sys.current_status] || "")}</span>
      </li>
    `).join("");

    const summaryHtml = `
      <summary>
        <div class="crew-card-headline">
          <span class="crew-id">${escapeHtml(c.crew_id)}</span>
          <span class="crew-overall-icon" aria-hidden="true">${statusIcon}</span>
          <span class="crew-overall-label">${escapeHtml(overallLabel)}</span>
        </div>
        <p class="crew-overall-text">${escapeHtml(c.overall_text)}</p>
        <ul class="crew-system-list">${systemRows}</ul>
      </summary>
    `;

    // Expanded state: per-system per-checkpoint detail.
    let bodyHtml = `<div class="crew-card-detail">`;
    for (const sys of (c.systems || [])) {
      bodyHtml += `
        <section class="crew-system-detail">
          <header>
            <span class="sys-status-icon" aria-hidden="true">${SYSTEM_STATUS_ICON[sys.current_status] || "·"}</span>
            <h4>${escapeHtml(sys.label)}</h4>
            <span class="concern-pill concern-${sys.concern_level}" title="${escapeHtml(sys.clinical_context || "")}">${escapeHtml(({expected:"expected",watch:"worth watching",follow_up:"follow-up advised"})[sys.concern_level] || sys.concern_level)}</span>
          </header>
          <p class="current-line">${escapeHtml(sys.current_text)}</p>
          ${sys.clinical_context ? `<p class="clinical-context-inline">${escapeHtml(sys.clinical_context)}</p>` : ""}
          <table class="crew-system-checkpoints">
            <thead><tr><th>Timepoint</th><th>Direction</th><th>Headline % vs baseline</th></tr></thead>
            <tbody>
              ${(sys.checkpoints || []).map(cp => {
                const pct = cp.headline_pct;
                const dirClass = pct == null ? "muted" : (pct > 3 ? "up" : (pct < -3 ? "down" : "stable"));
                const sign = pct == null ? "" : (pct > 0 ? "+" : "");
                return `
                  <tr>
                    <td class="cp-cell-name">${escapeHtml(cp.checkpoint)}</td>
                    <td class="cp-cell-status">${escapeHtml(cp.status)}</td>
                    <td class="cp-cell-pct pct-${dirClass}">${pct == null ? "—" : sign + pct + "%"}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </section>
      `;
    }
    bodyHtml += `<p class="crew-card-meta muted">Compared against ${escapeHtml(c.crew_id)}'s own pre-flight baseline (mean of L-92, L-44, L-3). All four bloodwork panels (CBC, CMP, immune cytokines, cardiovascular markers).</p>`;
    bodyHtml += `</div>`;

    card.innerHTML = summaryHtml + bodyHtml;
    root.appendChild(card);
  }
}

// =============================================================
// Findings (per-system detail cards — auxiliary view)
// =============================================================

const STATUS_ICON = {
  shifted_up:   "▲",
  shifted_down: "▼",
  mixed:        "◆",
  stable:       "—",
  no_data:      "·",
};

const STATUS_LABEL = {
  shifted_up:   "elevated",
  shifted_down: "decreased",
  mixed:        "mixed across crew",
  stable:       "stable",
  no_data:      "no data",
};

function renderFindings() {
  const root = document.getElementById("findings-list");
  root.innerHTML = "";

  const byCategory = {};
  for (const f of state.bloodwork.findings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  const categoryOrder = ["Hematology", "Metabolic", "Immune", "Cardiovascular"];
  for (const cat of categoryOrder) {
    if (!byCategory[cat]) continue;
    const section = document.createElement("section");
    section.className = "finding-category";
    section.innerHTML = `<h3 class="finding-category-title">${escapeHtml(cat)}</h3>`;
    byCategory[cat].forEach(f => section.appendChild(renderFindingCard(f)));
    root.appendChild(section);
  }
}

function renderFindingCard(f) {
  const card = document.createElement("details");
  card.className = `finding-card status-${f.overall_status}`;

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="finding-icon" aria-hidden="true">${STATUS_ICON[f.overall_status] || "·"}</span>
    <span class="finding-headline">${escapeHtml(f.headline)}</span>
    <span class="finding-disclose" aria-hidden="true">click for evidence</span>
  `;
  card.appendChild(summary);

  const body = document.createElement("div");
  body.className = "finding-body";

  const postFlightTps = state.bloodwork.timepoints.filter(
    t => !state.bloodwork.baseline_timepoints.includes(t)
  );

  let html = '<div class="finding-timeline">';
  for (const tp of postFlightTps) {
    const ts = f.per_timepoint && f.per_timepoint[tp];
    if (!ts || ts.status === "no_data") continue;
    html += `
      <div class="finding-tp tp-${ts.status}">
        <div class="finding-tp-header">
          <span class="finding-tp-label">${escapeHtml(tp)}</span>
          <span class="finding-tp-status">${STATUS_ICON[ts.status]} ${STATUS_LABEL[ts.status]}</span>
          ${ts.n_total ? `<span class="finding-tp-crew">${ts.n_crew_up}↑ &middot; ${ts.n_crew_down}↓ &middot; ${ts.n_crew_stable}— of ${ts.n_total} crew</span>` : ""}
        </div>
        ${renderEvidenceTable(ts.evidence || [])}
      </div>
    `;
  }
  html += '</div>';

  // Sources
  const sources = new Set();
  for (const mk of (f.metric_keys || [])) {
    const panel = state.bloodwork.panels[mk.panel];
    if (panel) sources.add(`${panel.label} (${panel.source})`);
  }
  if (sources.size) {
    html += `<p class="finding-sources"><strong>Sources:</strong> ${[...sources].map(escapeHtml).join("; ")}</p>`;
  }
  html += `<p class="finding-method-note">A metric is "shifted" when its post-flight value falls outside the bootstrap CI of the same crew member's pre-flight mean (n=3 baseline samples). A system is summarized as shifted when at least 50% of metrics shift in the same direction across at least 50% of crew.</p>`;

  body.innerHTML = html;
  card.appendChild(body);
  return card;
}

function renderEvidenceTable(evidence) {
  if (!evidence.length) return "";
  // Show only metrics that actually moved or have data; sort by absolute median pct change
  const sorted = [...evidence].sort((a, b) => Math.abs(b.median_pct_change || 0) - Math.abs(a.median_pct_change || 0));
  const rows = sorted.slice(0, 12).map(e => {
    const movement = e.n_crew_shifted_up || e.n_crew_shifted_down
      ? `${e.n_crew_shifted_up}↑ ${e.n_crew_shifted_down}↓ of ${e.n_crew_observed}`
      : `<span class="muted">none of ${e.n_crew_observed} shifted</span>`;
    const pct = e.median_pct_change || 0;
    const pctClass = pct > 0 ? "up" : (pct < 0 ? "down" : "muted");
    return `
      <tr>
        <td>${escapeHtml(e.label)}</td>
        <td>${movement}</td>
        <td class="num ${pctClass}">${pct > 0 ? "+" : ""}${pct}%</td>
      </tr>
    `;
  }).join("");
  return `
    <table class="finding-evidence">
      <thead><tr><th>Metric</th><th>Crew shifted</th><th>Median % vs baseline</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
  // Each step is isolated: one failing render shouldn't black out the whole page.
  try {
    const { microbiome, bloodwork, opportunists, beneficials, bodyDoc } = await loadAll();
    state.microbiome = microbiome;
    state.bloodwork = bloodwork;
    state.opportunists = opportunists;
    state.beneficials = beneficials;
    safe("mountAvatars",        () => mountAvatars(bodyDoc));
    safe("wireEvents",          () => wireEvents());
    safe("repaintAll",          () => repaintAll());
    safe("renderCrewSummaries",   () => renderCrewSummaries());
    safe("renderFindings",        () => renderFindings());
  } catch (err) {
    console.error("Dashboard fatal load error:", err);
    document.getElementById("findings-list").innerHTML =
      `<p style="color: #b00; padding: 12px;">Failed to load data: <code>${escapeHtml(String(err.message || err))}</code><br>Open DevTools console for full stack.</p>`;
  }
});

function safe(label, fn) {
  try { fn(); }
  catch (err) {
    console.error(`[${label}] threw:`, err);
    // Surface the error inline if a known anchor element exists for that section.
    const anchors = {
      mountAvatars:           "avatar-grid",
      renderCrewSummaries:    "crew-grid",
      renderFindings:         "findings-list",
    };
    const id = anchors[label];
    if (id) {
      const el = document.getElementById(id);
      if (el) {
        const note = document.createElement("p");
        note.style.color = "#b00";
        note.style.padding = "8px 12px";
        note.style.font = "12px ui-monospace, monospace";
        note.textContent = `[${label}] ${err.message || err}`;
        el.appendChild(note);
      }
    }
  }
}
