// =============================================================
// Recovery, Honestly — frontend
// Single dark hero: crew tabs, big rotating 3D astronaut, expandable
// per-system bloodwork tiles (with auto-classified findings embedded),
// top-microbiome hotspot list, timepoint slider with checkpoint marks,
// drilldown overlay.
// =============================================================

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DATA_DIR = "./data";
const MICROBIOME_URL = `${DATA_DIR}/microbiome.json`;
const BLOODWORK_URL = `${DATA_DIR}/bloodwork.json`;
const OPPORTUNISTS_URL = `${DATA_DIR}/opportunists.json`;
const BENEFICIALS_URL = `${DATA_DIR}/beneficials.json`;

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
  const [microbiome, bloodwork, opportunists, beneficials] = await Promise.all([
    fetch(MICROBIOME_URL).then(r => r.json()),
    fetch(BLOODWORK_URL).then(r => r.json()),
    fetch(OPPORTUNISTS_URL).then(r => r.json()).catch(() => ({})),
    fetch(BENEFICIALS_URL).then(r => r.json()).catch(() => ({})),
  ]);
  return { microbiome, bloodwork, opportunists, beneficials };
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
// Microbiome character-select: one big featured body + 4 roster tiles
// =============================================================

const avatars = new Map();   // crew_id -> Avatar2D (small roster body)
let stageAvatar = null;      // the big featured body (shows selected crew)
let selectedMicrobiomeCrew = "C001";

function mountAvatars() {
  // Build the roster: 4 buttons, each containing a small static body.
  const roster = document.getElementById("microbiome-roster");
  if (roster) {
    roster.innerHTML = "";
    const crewIds = (state.microbiome && state.microbiome.crew) || ["C001","C002","C003","C004"];
    if (!crewIds.includes(selectedMicrobiomeCrew)) selectedMicrobiomeCrew = crewIds[0];

    crewIds.forEach((crew, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roster-tile";
      btn.dataset.crew = crew;
      btn.dataset.index = String(i);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", crew === selectedMicrobiomeCrew ? "true" : "false");
      btn.innerHTML = `
        <span class="roster-frame">
          <span class="roster-corner rc-tl"></span>
          <span class="roster-corner rc-tr"></span>
          <span class="roster-corner rc-bl"></span>
          <span class="roster-corner rc-br"></span>
        </span>
        <span class="roster-id">${escapeHtml(crew)}</span>
        <div class="roster-body"></div>
        <span class="roster-ready">${crew === selectedMicrobiomeCrew ? "READY" : "SELECT"}</span>
      `;
      btn.addEventListener("click", () => selectMicrobiomeCrewById(crew));
      btn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = crewIds[(i + 1) % crewIds.length];
          selectMicrobiomeCrewById(next);
          focusActiveRosterTile();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prev = crewIds[(i - 1 + crewIds.length) % crewIds.length];
          selectMicrobiomeCrewById(prev);
          focusActiveRosterTile();
        }
      });
      roster.appendChild(btn);

      // Tiny non-interactive body inside the tile.
      const bodyHost = btn.querySelector(".roster-body");
      avatars.set(crew, new Avatar2D(bodyHost, crew, { interactive: false }));
    });
  }

  // Build the big featured body. Its crewId is dynamic so re-renders aren't
  // needed when the user picks a different crew - we just call setScores.
  const stageHost = document.getElementById("featured-body-host");
  if (stageHost) {
    stageAvatar = new Avatar2D(stageHost, () => selectedMicrobiomeCrew, { interactive: true });
  }
  refreshFeaturedHeader();
}

function refreshFeaturedHeader() {
  const idEl = document.getElementById("stage-crew-id");
  if (idEl) idEl.textContent = selectedMicrobiomeCrew;
  const featured = document.getElementById("stage-featured");
  if (featured) featured.dataset.crew = selectedMicrobiomeCrew;
}

function selectMicrobiomeCrewById(crew) {
  if (!crew || crew === selectedMicrobiomeCrew) return;
  const crewIds = (state.microbiome && state.microbiome.crew) || [];
  const oldIdx = crewIds.indexOf(selectedMicrobiomeCrew);
  const newIdx = crewIds.indexOf(crew);
  selectedMicrobiomeCrew = crew;

  // Update roster tile states + READY/SELECT label
  document.querySelectorAll("#microbiome-roster .roster-tile").forEach(btn => {
    const isSel = btn.dataset.crew === crew;
    btn.setAttribute("aria-selected", isSel ? "true" : "false");
    const r = btn.querySelector(".roster-ready");
    if (r) r.textContent = isSel ? "READY" : "SELECT";
  });

  // Animate featured: slide out, swap data, slide in.
  const featured = document.getElementById("stage-featured");
  const dir = (newIdx > oldIdx) ? "left" : "right";
  if (featured) {
    featured.classList.remove("slide-in-left", "slide-in-right");
    featured.classList.add(`slide-out-${dir}`);
    featured.addEventListener("animationend", function onOut() {
      featured.removeEventListener("animationend", onOut);
      featured.classList.remove(`slide-out-${dir}`);
      refreshFeaturedHeader();
      paintFeaturedBody();
      featured.classList.add(`slide-in-${dir === "left" ? "right" : "left"}`);
    }, { once: true });
  } else {
    refreshFeaturedHeader();
    paintFeaturedBody();
  }

  // Sync the bloodwork side's selectCrew (so cross-section "selected" stays in step).
  selectCrew(crew);

  // If the drilldown is open, update it for the new crew.
  if (activeDrilldown) {
    activeDrilldown.crew = crew;
    refreshDrilldown();
  }
}

function focusActiveRosterTile() {
  const active = document.querySelector(`#microbiome-roster .roster-tile[aria-selected="true"]`);
  if (active && document.activeElement !== active) active.focus();
}

function paintFeaturedBody() {
  if (!stageAvatar || !state.microbiome) return;
  const tp = state.microbiome.timepoints[state.timepointIdx];
  stageAvatar.setScores(state.microbiome.scores[selectedMicrobiomeCrew] || {}, tp);
}

// =============================================================
// 2D SVG fallback (when WebGL context creation fails)
// =============================================================

const AVATAR_SVG_TEMPLATE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260" preserveAspectRatio="xMidYMid meet" class="body-svg">
  <defs>
    <pattern id="no-data-pattern-{ID}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#f0eada"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#cdcdcd" stroke-width="2"/>
    </pattern>
  </defs>
  <g class="figure" data-view="front" transform="translate(0,0)">
    <circle class="body-fill" cx="55" cy="28" r="16"/>
    <rect class="body-fill" x="51" y="42" width="8" height="6"/>
    <path class="body-fill" d="M 36 48 Q 55 45 74 48 L 70 116 Q 55 120 40 116 Z"/>
    <path class="body-fill" d="M 36 50 L 22 105 Q 22 116 30 116 L 36 106 Q 40 80 42 54 Z"/>
    <path class="body-fill" d="M 74 50 L 88 105 Q 88 116 80 116 L 74 106 Q 70 80 68 54 Z"/>
    <path class="body-fill" d="M 40 116 L 35 218 Q 35 232 44 232 L 53 218 Q 54 165 53 116 Z"/>
    <path class="body-fill" d="M 70 116 L 75 218 Q 75 232 66 232 L 57 218 Q 56 165 57 116 Z"/>
    <ellipse class="body-fill" cx="40" cy="234" rx="8" ry="3"/>
    <ellipse class="body-fill" cx="70" cy="234" rx="8" ry="3"/>
    <text class="figure-label" x="55" y="252" text-anchor="middle">front</text>
    <circle class="region" data-region="glabella"  cx="55" cy="20" r="3"/>
    <circle class="region" data-region="nasal"     cx="55" cy="29" r="3"/>
    <circle class="region" data-region="oral"      cx="55" cy="38" r="3"/>
    <circle class="region" data-region="axillary"  cx="36" cy="55" r="4.5"/>
    <circle class="region" data-region="forearm"   cx="26" cy="92" r="4.5"/>
    <circle class="region" data-region="umbilicus" cx="55" cy="90" r="3.5"/>
    <circle class="region" data-region="toe_web"   cx="40" cy="232" r="3.5"/>
  </g>
  <g class="figure" data-view="back" transform="translate(110,0)">
    <circle class="body-fill" cx="55" cy="28" r="16"/>
    <rect class="body-fill" x="51" y="42" width="8" height="6"/>
    <path class="body-fill" d="M 36 48 Q 55 45 74 48 L 70 116 Q 55 120 40 116 Z"/>
    <path class="body-fill" d="M 36 50 L 22 105 Q 22 116 30 116 L 36 106 Q 40 80 42 54 Z"/>
    <path class="body-fill" d="M 74 50 L 88 105 Q 88 116 80 116 L 74 106 Q 70 80 68 54 Z"/>
    <path class="body-fill" d="M 40 116 L 35 218 Q 35 232 44 232 L 53 218 Q 54 165 53 116 Z"/>
    <path class="body-fill" d="M 70 116 L 75 218 Q 75 232 66 232 L 57 218 Q 56 165 57 116 Z"/>
    <ellipse class="body-fill" cx="40" cy="234" rx="8" ry="3"/>
    <ellipse class="body-fill" cx="70" cy="234" rx="8" ry="3"/>
    <text class="figure-label" x="55" y="252" text-anchor="middle">back</text>
    <circle class="region" data-region="occiput"        cx="55" cy="22" r="4"/>
    <circle class="region" data-region="post_auricular" cx="42" cy="32" r="3"/>
    <circle class="region" data-region="gluteal"        cx="55" cy="125" r="5"/>
  </g>
</svg>
`;

class Avatar2D {
  /**
   * @param {HTMLElement} host
   * @param {string|Function} crewIdOrGetter  static id or () => id (for the stage)
   * @param {Object} [opts]
   * @param {boolean} [opts.interactive=true]  if false, regions don't open drilldown on click
   */
  constructor(host, crewIdOrGetter, opts = {}) {
    const interactive = opts.interactive !== false;
    this._getCrewId = typeof crewIdOrGetter === "function"
      ? crewIdOrGetter
      : () => crewIdOrGetter;
    host.innerHTML = AVATAR_SVG_TEMPLATE.replace(/\{ID\}/g, this._getCrewId());
    this.svg = host.querySelector("svg");
    this.regions = new Map();
    this.svg.querySelectorAll("[data-region]").forEach(node => {
      this.regions.set(node.dataset.region, node);
      if (interactive) {
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          const crew = this._getCrewId();
          openDrilldown(crew, node.dataset.region);
          selectCrew(crew);
        });
      } else {
        node.style.pointerEvents = "none";
      }
    });
  }

  setScores(scoresForCrew, timepoint) {
    for (const [site, node] of this.regions) {
      const cell = (scoresForCrew[site] || {})[timepoint];
      let title = node.querySelector("title");
      if (!title) {
        title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        node.appendChild(title);
      }
      if (!cell) {
        node.setAttribute("data-no-data", "true");
        node.style.fill = "";
        title.textContent = `${labelForSite(site)} · ${timepoint}: no swab collected`;
      } else {
        node.removeAttribute("data-no-data");
        node.style.fill = colorForScore(cell.d, cell.within_baseline_noise);
        const noiseTag = cell.within_baseline_noise ? " (within baseline noise)" : "";
        title.textContent = `${labelForSite(site)} · ${timepoint}\nd = ${cell.d.toFixed(2)} [95% CI ${cell.ci_lo.toFixed(2)}–${cell.ci_hi.toFixed(2)}], n=${cell.n_baseline}${noiseTag}`;
      }
    }
  }
}

function repaintAll() {
  if (!state.microbiome) return;
  const tp = state.microbiome.timepoints[state.timepointIdx];
  const lbl = document.getElementById("timepoint-label");
  if (lbl) lbl.textContent = tp;

  // Active timepoint mark
  document.querySelectorAll(".timepoint-mark").forEach(m => {
    m.classList.toggle("active", Number(m.dataset.idx) === state.timepointIdx);
  });

  // Hero body + stats (the stats panel rebuilds the top-3 hotspot list,
  // which is timepoint-dependent).
  paintHeroBody();
  renderHeroStats();

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
    return "Within your pre-flight noise. We can't distinguish this from your normal variation.";
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
        ? ` <span class="annot-badge ${annot.kind}" title="${escapeHtml(annot.note)} (${escapeHtml(annot.ref)})">${annot.icon} ${escapeHtml(annot.label)}</span>`
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

// "Character select" pattern: a thumbnail row across the top, one large
// feature panel below showing the currently selected crew. Switching is
// animated; both keyboard arrows and click work.

let selectedCrewIndex = 0;

function renderCrewSummaries() {
  const root = document.getElementById("crew-select");
  if (!root) return;
  root.innerHTML = "";
  const crewSummaries = (state.bloodwork && state.bloodwork.crew_summaries) || [];
  if (!crewSummaries.length) {
    root.innerHTML = `<p class="muted">No personal recovery cards available.</p>`;
    return;
  }

  // ---- Thumbnail row -----------------------------------------------------
  const thumbRow = document.createElement("nav");
  thumbRow.className = "crew-thumb-row";
  thumbRow.setAttribute("role", "tablist");
  thumbRow.setAttribute("aria-label", "Select crew member");

  for (let i = 0; i < crewSummaries.length; i++) {
    const c = crewSummaries[i];
    const statusIcon = CREW_STATUS_ICON[c.overall_status] || "·";
    const overallLabel = CREW_OVERALL_LABEL[c.overall_status] || c.overall_status || "";

    // Mini status dots, one per system, color-coded by current_status.
    const systemDots = (c.systems || []).map(sys => `
      <span class="thumb-sys sys-${sys.current_status} concern-${sys.concern_level}"
            title="${escapeHtml(sys.label)}: ${escapeHtml(SYSTEM_STATUS_LABEL[sys.current_status] || "")}"></span>
    `).join("");

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = `crew-thumb status-${c.overall_status || "no_data"}`;
    thumb.dataset.crew = c.crew_id;
    thumb.dataset.index = String(i);
    thumb.setAttribute("role", "tab");
    thumb.setAttribute("aria-selected", i === selectedCrewIndex ? "true" : "false");
    thumb.innerHTML = `
      <span class="thumb-frame">
        <span class="thumb-corner tc-tl"></span>
        <span class="thumb-corner tc-tr"></span>
        <span class="thumb-corner tc-bl"></span>
        <span class="thumb-corner tc-br"></span>
      </span>
      <span class="thumb-id">${escapeHtml(c.crew_id)}</span>
      <span class="thumb-status">
        <span class="thumb-icon" aria-hidden="true">${statusIcon}</span>
        <span class="thumb-label">${escapeHtml(overallLabel)}</span>
      </span>
      <span class="thumb-systems" aria-hidden="true">${systemDots}</span>
      <span class="thumb-ready">${i === selectedCrewIndex ? "READY" : "SELECT"}</span>
    `;
    thumb.addEventListener("click", () => selectCrewByIndex(i));
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        selectCrewByIndex((selectedCrewIndex + 1) % crewSummaries.length);
        focusActiveThumb();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        selectCrewByIndex((selectedCrewIndex - 1 + crewSummaries.length) % crewSummaries.length);
        focusActiveThumb();
      }
    });
    thumbRow.appendChild(thumb);
  }
  root.appendChild(thumbRow);

  // ---- Featured panel ----------------------------------------------------
  const feature = document.createElement("div");
  feature.className = "crew-feature";
  feature.setAttribute("role", "tabpanel");
  root.appendChild(feature);

  renderFeatured(feature, crewSummaries[selectedCrewIndex]);
}

function selectCrewByIndex(i) {
  const crewSummaries = (state.bloodwork && state.bloodwork.crew_summaries) || [];
  if (!crewSummaries.length || i === selectedCrewIndex) return;
  const root = document.getElementById("crew-select");
  if (!root) return;

  const oldIdx = selectedCrewIndex;
  selectedCrewIndex = i;

  // Update tab states + READY/SELECT labels
  root.querySelectorAll(".crew-thumb").forEach((btn, j) => {
    btn.setAttribute("aria-selected", j === i ? "true" : "false");
    const ready = btn.querySelector(".thumb-ready");
    if (ready) ready.textContent = j === i ? "READY" : "SELECT";
  });

  // Animate the featured panel: slide-out in the direction of nav, then in
  const feature = root.querySelector(".crew-feature");
  if (!feature) return;
  const dir = (i > oldIdx) ? "left" : "right";
  feature.classList.remove("slide-in-left", "slide-in-right");
  feature.classList.add(`slide-out-${dir}`);
  feature.addEventListener("animationend", function onOut() {
    feature.removeEventListener("animationend", onOut);
    feature.classList.remove(`slide-out-${dir}`);
    renderFeatured(feature, crewSummaries[i]);
    feature.classList.add(`slide-in-${dir === "left" ? "right" : "left"}`);
  }, { once: true });

  // Also drive the rest of the page's "selected crew" plumbing.
  const cs = crewSummaries[i];
  if (cs && cs.crew_id) selectCrew(cs.crew_id);
}

function focusActiveThumb() {
  const root = document.getElementById("crew-select");
  if (!root) return;
  const active = root.querySelector(`.crew-thumb[aria-selected="true"]`);
  if (active && document.activeElement !== active) active.focus();
}

function renderFeatured(feature, c) {
  if (!feature || !c) return;
  feature.dataset.crew = c.crew_id;
  feature.className = `crew-feature status-${c.overall_status || "no_data"}`;

  const statusIcon = CREW_STATUS_ICON[c.overall_status] || "·";
  const overallLabel = CREW_OVERALL_LABEL[c.overall_status] || c.overall_status || "";

  let html = `
    <header class="feature-header">
      <div class="feature-id-block">
        <span class="feature-id-label">CREW</span>
        <span class="feature-id">${escapeHtml(c.crew_id)}</span>
      </div>
      <div class="feature-status-block">
        <span class="feature-status-icon" aria-hidden="true">${statusIcon}</span>
        <span class="feature-status-label">${escapeHtml(overallLabel)}</span>
      </div>
    </header>
    <p class="feature-overall">${escapeHtml(c.overall_text)}</p>
    <div class="feature-systems">
  `;
  for (const sys of (c.systems || [])) {
    const concernLabel = ({expected:"expected", watch:"worth watching", follow_up:"follow-up advised"})[sys.concern_level] || sys.concern_level;
    html += `
      <section class="feature-system sys-${sys.current_status} concern-${sys.concern_level}">
        <header>
          <span class="sys-status-icon" aria-hidden="true">${SYSTEM_STATUS_ICON[sys.current_status] || "·"}</span>
          <h4>${escapeHtml(sys.label)}</h4>
          <span class="concern-pill concern-${sys.concern_level}" title="${escapeHtml(sys.clinical_context || "")}">${escapeHtml(concernLabel)}</span>
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
  html += `</div>`;
  html += `<p class="feature-meta">Compared against ${escapeHtml(c.crew_id)}'s own pre-flight baseline (mean of L-92, L-44, L-3). All four bloodwork panels (CBC, CMP, immune cytokines, cardiovascular markers).</p>`;
  feature.innerHTML = html;
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
// 3D astronaut body for the hero (spinning glTF model + clickable hotspots)
// =============================================================

const ASTRONAUT_URL = "./assets/Astronaut.glb";
const HERO_SPIN_RPM = 4;
const HERO_RADIANS_PER_FRAME = (HERO_SPIN_RPM * 2 * Math.PI) / 60 / 60;

// Hotspot positions as FRACTIONS of the model's actual bounding box.
// y: -1 is bottom (boots), +1 is top (helmet apex); 0 is vertical center.
// x: -1 is left, +1 is right; 0 is centerline.
// z: -1 is back, +1 is front (model assumed to face +z).
//
// Calibrated for the Google astronaut model where the bbox includes the
// helmet top and backpack rear, which inflates the bbox extents. Hotspot
// fractions stay conservative so they sit ON the body / helmet front,
// not at bbox extremes (where the helmet apex or backpack hump are).
const HERO_HOTSPOT_FRACTIONS = {
  // Visor / face area on the helmet front. y=0.62 is below the helmet apex
  // (~0.95) but above the neck (~0.45), z=0.42 is on the visor not behind it.
  glabella:       { x:  0.00, y:  0.66, z:  0.42 },
  nasal:          { x:  0.00, y:  0.60, z:  0.46 },
  oral:           { x:  0.00, y:  0.54, z:  0.46 },
  post_auricular: { x: -0.32, y:  0.60, z:  0.06 },
  occiput:        { x:  0.00, y:  0.62, z: -0.36 },
  // Body - shoulders/chest at y~0.30, mid-body at y~0.00.
  axillary:       { x: -0.38, y:  0.30, z:  0.05 },
  forearm:        { x: -0.42, y:  0.02, z:  0.05 },
  umbilicus:      { x:  0.00, y:  0.04, z:  0.40 },
  gluteal:        { x:  0.00, y: -0.18, z: -0.36 },
  // Boots at the very bottom; offset slightly to one foot.
  toe_web:        { x: -0.18, y: -0.86, z:  0.22 },
};

// Shared loader (cached so the model only fetches once).
let _astronautPromise = null;
function loadAstronaut() {
  if (!_astronautPromise) {
    const loader = new GLTFLoader();
    _astronautPromise = new Promise((resolve, reject) => {
      loader.load(ASTRONAUT_URL, resolve, undefined, reject);
    });
  }
  return _astronautPromise;
}

async function createHeroBody3D({ host, getCrewId, getTimepoint, getScores, onSiteClick }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      failIfMajorPerformanceCaveat: false,
    });
  } catch (err) {
    console.warn("Hero body 3D: WebGL unavailable, falling back to 2D.", err);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.classList.add("hero-body-canvas");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

  scene.add(new THREE.AmbientLight(0xfff5e0, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 4, 3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7d8ff, 0.45);
  fill.position.set(-3, 2, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffaa55, 0.35);
  rim.position.set(0, 1, -3); scene.add(rim);

  // Pivot at world origin; model + hotspots are children. Pivot owns the spin.
  const pivot = new THREE.Group();
  scene.add(pivot);

  let gltf;
  try {
    gltf = await loadAstronaut();
  } catch (err) {
    console.warn("Hero body 3D: model failed to load.", err);
    host.removeChild(canvas);
    return null;
  }
  const model = gltf.scene.clone(true);
  pivot.add(model);

  // Compute the model's actual bounding box and re-center it so its visual
  // mid-body sits at the pivot's origin. Then position hotspots as fractions
  // of the actual bbox so they land on real anatomy regardless of how the
  // glTF was authored / scaled.
  const initialBox = new THREE.Box3().setFromObject(model);
  const initialCenter = initialBox.getCenter(new THREE.Vector3());
  model.position.sub(initialCenter);

  const finalBox = new THREE.Box3().setFromObject(model);
  const size = finalBox.getSize(new THREE.Vector3());
  const halfW = size.x / 2;
  const halfH = size.y / 2;
  const halfD = size.z / 2;
  console.log("[hero body] model bbox size:", size, "center:", finalBox.getCenter(new THREE.Vector3()));

  // Frame the camera to fit the model head-to-toe with margin. With
  // FOV 28 the visible vertical extent at distance D is ~0.5*D, so
  // D = 3*H gives ~50% headroom (model fills ~67% of frame height).
  const camDistance = Math.max(size.y, size.x * 1.4) * 3.0;
  camera.position.set(0, 0, camDistance);
  camera.lookAt(0, 0, 0);

  // Hotspot radius scales with model height so it reads proportionally.
  const hotspotRadius = size.y * 0.025;

  const hotspots = new Map();
  const hotspotGeom = new THREE.SphereGeometry(hotspotRadius, 22, 16);
  const debugPositions = {};
  for (const [site, frac] of Object.entries(HERO_HOTSPOT_FRACTIONS)) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xececec, roughness: 0.35, metalness: 0.0, emissive: 0x000000,
    });
    const mesh = new THREE.Mesh(hotspotGeom, mat);
    const x = frac.x * halfW, y = frac.y * halfH, z = frac.z * halfD;
    mesh.position.set(x, y, z);
    mesh.userData.site = site;
    pivot.add(mesh);
    hotspots.set(site, mesh);
    debugPositions[site] = { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3) };
  }
  console.log("[hero body] hotspot world positions:", debugPositions);

  function fitToHost() {
    const w = Math.max(1, host.clientWidth  || 480);
    const h = Math.max(1, host.clientHeight || 560);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  fitToHost();
  window.addEventListener("resize", fitToHost);
  requestAnimationFrame(() => requestAnimationFrame(fitToHost));

  // Raycaster for hover/click on hotspots.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let isHover = false;

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width)  *  2 - 1;
    pointer.y = ((e.clientY - r.top)  / r.height) * -2 + 1;
  }
  function pickHotspot(e) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...hotspots.values()], false);
    return hits.length ? hits[0].object : null;
  }

  canvas.addEventListener("mousemove", (e) => {
    const hit = pickHotspot(e);
    isHover = !!hit;
    canvas.style.cursor = hit ? "pointer" : "default";
    canvas.title = hit ? (hit.userData.tooltip || labelForSite(hit.userData.site)) : "";
  });
  canvas.addEventListener("mouseleave", () => {
    isHover = false;
    canvas.style.cursor = "";
    canvas.title = "";
  });
  canvas.addEventListener("click", (e) => {
    const hit = pickHotspot(e);
    if (hit && onSiteClick) onSiteClick(hit.userData.site);
  });

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(48, now - prev);
    prev = now;
    // Auto-rotate around y, but pause while the user is hovering so they can click.
    if (!isHover) pivot.rotation.y += HERO_RADIANS_PER_FRAME * (dt / (1000 / 60));
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setScores(scoresForCrew, timepoint) {
    for (const [site, mesh] of hotspots) {
      const cell = (scoresForCrew[site] || {})[timepoint];
      if (!cell) {
        mesh.material.color.set(0xeeeae0);
        mesh.material.emissive.set(0x000000);
        mesh.userData.tooltip = `${labelForSite(site)} · ${timepoint}: no swab collected`;
      } else {
        const css = colorForScore(cell.d, cell.within_baseline_noise);
        const m = css.match(/rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
        if (m) {
          mesh.material.color.setRGB(parseInt(m[1])/255, parseInt(m[2])/255, parseInt(m[3])/255);
        }
        const intensity = Math.max(0, Math.min(1, cell.d - 0.4));
        mesh.material.emissive.setRGB(intensity * 0.6, intensity * 0.18, 0.0);
        const noiseTag = cell.within_baseline_noise ? " (within baseline noise)" : "";
        mesh.userData.tooltip = `${labelForSite(site)} · ${timepoint}\nd = ${cell.d.toFixed(2)} [95% CI ${cell.ci_lo.toFixed(2)}–${cell.ci_hi.toFixed(2)}], n=${cell.n_baseline}${noiseTag}`;
      }
    }
  }

  return { setScores, canvas, pivot };
}

// =============================================================
// Hero (unified single-screen view: tabs + body + stats + timeline)
// =============================================================

let selectedHeroCrew = "C001";
let heroBody = null;       // 3D body (createHeroBody3D return) when available
let heroAvatar = null;     // 2D SVG fallback Avatar2D when 3D fails

// Map the 4 hero stat tiles to their fine-grained system findings so the
// auto-classified findings get embedded inside the right tile.
const SYSTEM_CARD_TO_FINE = {
  hematology:     ["red_cells", "white_cells", "platelets"],
  metabolic:      ["renal", "hepatic", "metabolic", "protein"],
  immune:         ["inflammation", "adaptive"],
  cardiovascular: ["cardiac"],
};

async function mountHero() {
  const tabs = document.getElementById("hero-tabs");
  if (tabs) renderHeroTabs(tabs);

  const host = document.getElementById("hero-body-host");
  if (host) {
    // Try the 3D astronaut first; fall back to the 2D SVG body if WebGL
    // or the model load fails.
    heroBody = await createHeroBody3D({
      host,
      onSiteClick: (site) => openDrilldown(selectedHeroCrew, site),
    });
    if (!heroBody) {
      heroAvatar = new Avatar2D(host, () => selectedHeroCrew, { interactive: true });
    }
  }

  renderHeroStats();
  renderTimelineMarks();

  const hero = document.getElementById("hero");
  if (hero) hero.dataset.crew = selectedHeroCrew;

  const closeBtn = document.querySelector(".drilldown-close");
  if (closeBtn) closeBtn.addEventListener("click", closeDrilldown);

  // Initial body paint (now that the 3D body has loaded async).
  paintHeroBody();
}

function renderHeroTabs(tabs) {
  const crewIds = (state.bloodwork && state.bloodwork.crew)
    || (state.microbiome && state.microbiome.crew)
    || ["C001","C002","C003","C004"];
  if (!crewIds.includes(selectedHeroCrew)) selectedHeroCrew = crewIds[0];

  tabs.innerHTML = "";
  crewIds.forEach((crew, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-tab";
    btn.dataset.crew = crew;
    btn.dataset.index = String(i);
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", crew === selectedHeroCrew ? "true" : "false");
    btn.innerHTML = `
      <span class="hero-tab-id">${escapeHtml(crew)}</span>
      <span class="hero-tab-status" data-status="${escapeHtml(crewStatusFor(crew))}"></span>
    `;
    btn.addEventListener("click", () => selectHeroCrew(crew));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        selectHeroCrew(crewIds[(i + 1) % crewIds.length]);
        focusActiveHeroTab();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        selectHeroCrew(crewIds[(i - 1 + crewIds.length) % crewIds.length]);
        focusActiveHeroTab();
      }
    });
    tabs.appendChild(btn);
  });
}

function crewStatusFor(crew) {
  const cs = (state.bloodwork && state.bloodwork.crew_summaries) || [];
  const c = cs.find(x => x.crew_id === crew);
  return c ? (c.overall_status || "no_data") : "no_data";
}

function focusActiveHeroTab() {
  const t = document.querySelector(`.hero-tab[aria-selected="true"]`);
  if (t && document.activeElement !== t) t.focus();
}

function selectHeroCrew(crew) {
  if (!crew || crew === selectedHeroCrew) return;
  selectedHeroCrew = crew;

  // Tabs
  document.querySelectorAll(".hero-tab").forEach(t => {
    t.setAttribute("aria-selected", t.dataset.crew === crew ? "true" : "false");
  });

  // Banner
  const idEl = document.getElementById("hero-crew-id");
  if (idEl) idEl.textContent = crew;
  const hero = document.getElementById("hero");
  if (hero) hero.dataset.crew = crew;

  // Body + stats
  paintHeroBody();
  renderHeroStats();

  // Cross-section sync
  selectCrew(crew);

  // Drilldown follows the new crew if open
  if (activeDrilldown) {
    activeDrilldown.crew = crew;
    refreshDrilldown();
  }
}

function paintHeroBody() {
  if (!state.microbiome) return;
  const tp = state.microbiome.timepoints[state.timepointIdx];
  const scoresForCrew = state.microbiome.scores[selectedHeroCrew] || {};
  if (heroBody) heroBody.setScores(scoresForCrew, tp);
  if (heroAvatar) heroAvatar.setScores(scoresForCrew, tp);
}

function renderHeroStats() {
  const root = document.getElementById("hero-stats");
  if (!root) return;
  const crewSummaries = (state.bloodwork && state.bloodwork.crew_summaries) || [];
  const c = crewSummaries.find(x => x.crew_id === selectedHeroCrew);
  if (!c) {
    root.innerHTML = `<p class="muted">No data for ${escapeHtml(selectedHeroCrew)}</p>`;
    return;
  }

  const overallIcon = CREW_STATUS_ICON[c.overall_status] || "·";
  const overallLabel = CREW_OVERALL_LABEL[c.overall_status] || c.overall_status || "";

  // System tiles - click any to expand into both the per-checkpoint table
  // AND the auto-classified fine-grained findings that roll up into this
  // system card (e.g., expanding "Hematology" reveals the per-system
  // findings for white_cells / red_cells / platelets).
  const allFindings = (state.bloodwork && state.bloodwork.findings) || [];

  const systemTiles = (c.systems || []).map(sys => {
    const fineKeys = SYSTEM_CARD_TO_FINE[sys.system_id] || [];
    const fineFindings = allFindings.filter(f => fineKeys.includes(f.system));
    return `
    <details class="hero-sys sys-${escapeHtml(sys.current_status)} concern-${escapeHtml(sys.concern_level)}">
      <summary>
        <span class="hero-sys-icon">${SYSTEM_STATUS_ICON[sys.current_status] || "·"}</span>
        <span class="hero-sys-label">${escapeHtml(sys.label)}</span>
        <span class="hero-sys-status">${escapeHtml(SYSTEM_STATUS_LABEL[sys.current_status] || "")}</span>
        <span class="hero-sys-disclose">+</span>
      </summary>
      <div class="hero-sys-detail">
        <p class="current-line">${escapeHtml(sys.current_text)}</p>
        ${sys.clinical_context ? `<p class="clinical-context-inline">${escapeHtml(sys.clinical_context)}</p>` : ""}
        <table class="crew-system-checkpoints">
          <thead><tr><th>Timepoint</th><th>Direction</th><th>Headline % vs baseline</th></tr></thead>
          <tbody>
            ${(sys.checkpoints || []).map(cp => {
              const pct = cp.headline_pct;
              const dirClass = pct == null ? "muted" : (pct > 3 ? "up" : (pct < -3 ? "down" : "stable"));
              const sign = pct == null ? "" : (pct > 0 ? "+" : "");
              return `<tr>
                <td class="cp-cell-name">${escapeHtml(cp.checkpoint)}</td>
                <td class="cp-cell-status">${escapeHtml(cp.status)}</td>
                <td class="cp-cell-pct pct-${dirClass}">${pct == null ? "—" : sign + pct + "%"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        ${fineFindings.length ? `
          <h5 class="hero-sys-fine-title">Fine-grained findings (population-level, n=4)</h5>
          <ul class="hero-sys-fine-list">
            ${fineFindings.map(f => renderEmbeddedFinding(f)).join("")}
          </ul>
        ` : ""}
      </div>
    </details>
  `;}).join("");

  // Top microbiome shifts at the current timepoint
  const tp = state.microbiome ? state.microbiome.timepoints[state.timepointIdx] : "";
  const sites = state.microbiome ? state.microbiome.sites : [];
  const scoresByCrew = state.microbiome ? state.microbiome.scores[selectedHeroCrew] || {} : {};
  const sortedSites = sites
    .map(site => {
      const cell = (scoresByCrew[site] || {})[tp];
      return cell ? { site, d: cell.d, cell } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.d - a.d)
    .slice(0, 4);

  const hotspotList = sortedSites.length === 0
    ? `<li class="muted">No swab data at ${escapeHtml(tp)}</li>`
    : sortedSites.map(({ site, d, cell }) => `
        <li class="hero-hotspot" data-site="${escapeHtml(site)}">
          <span class="hero-hotspot-dot" style="background: ${colorForScore(d, cell.within_baseline_noise)}"></span>
          <span class="hero-hotspot-name">${escapeHtml(labelForSite(site))}</span>
          <span class="hero-hotspot-d">d = ${d.toFixed(2)}</span>
        </li>
      `).join("");

  root.innerHTML = `
    <header class="hero-stats-header status-${escapeHtml(c.overall_status || "no_data")}">
      <span class="hero-stats-status-icon">${overallIcon}</span>
      <div>
        <span class="hero-stats-status-label">${escapeHtml(overallLabel)}</span>
        <p class="hero-stats-overview">${escapeHtml(c.overall_text)}</p>
      </div>
    </header>

    <div class="blood-legend" aria-label="Bloodwork legend">
      <div class="blood-legend-row">
        <span class="legend-title">Status</span>
        <span class="blood-legend-item"><span class="status-dot back_to_baseline"></span>back to baseline</span>
        <span class="blood-legend-item"><span class="status-dot mixed"></span>mixed</span>
        <span class="blood-legend-item"><span class="status-dot still_elevated"></span>elevated</span>
        <span class="blood-legend-item"><span class="status-dot still_decreased"></span>below baseline</span>
      </div>
      <div class="blood-legend-row">
        <span class="legend-title">Concern</span>
        <span class="blood-legend-item"><span class="concern-dot expected"></span>expected</span>
        <span class="blood-legend-item"><span class="concern-dot watch"></span>worth watching</span>
        <span class="blood-legend-item"><span class="concern-dot follow_up"></span>follow-up</span>
      </div>
    </div>

    <h3 class="hero-stats-h3">Bloodwork systems <span class="muted">(click to expand)</span></h3>
    <div class="hero-systems">${systemTiles}</div>

    <h3 class="hero-stats-h3">Top microbiome shifts at <span class="current-tp">${escapeHtml(tp)}</span></h3>
    <ul class="hero-hotspots">${hotspotList}</ul>

    <p class="hero-stats-meta">Compared against ${escapeHtml(selectedHeroCrew)}'s own pre-flight baseline (mean of L-92, L-44, L-3).</p>
  `;

  // Wire hotspot clicks
  root.querySelectorAll(".hero-hotspot").forEach(li => {
    li.addEventListener("click", () => {
      openDrilldown(selectedHeroCrew, li.dataset.site);
    });
  });
}

// A compact rendering of a single auto-classified finding embedded inside
// a hero system tile (no <details> wrapper here - it's already nested).
function renderEmbeddedFinding(f) {
  const tps = ["R+1", "R+45", "R+82"];
  return `
    <li class="hero-sys-fine status-${escapeHtml(f.overall_status || "no_data")}">
      <div class="fine-headline">
        <span class="fine-icon">${STATUS_ICON[f.overall_status] || "·"}</span>
        <span class="fine-text">${escapeHtml(f.headline || "")}</span>
      </div>
      <div class="fine-tp-row">
        ${tps.map(tp => {
          const ts = (f.per_timepoint || {})[tp];
          if (!ts || ts.status === "no_data") {
            return `<span class="fine-tp tp-no_data"><span class="fine-tp-name">${escapeHtml(tp)}</span><span class="fine-tp-status">—</span></span>`;
          }
          return `<span class="fine-tp tp-${escapeHtml(ts.status)}">
            <span class="fine-tp-name">${escapeHtml(tp)}</span>
            <span class="fine-tp-status">${escapeHtml(STATUS_LABEL[ts.status] || ts.status)}</span>
            <span class="fine-tp-counts">${ts.n_crew_up}↑ ${ts.n_crew_down}↓ of ${ts.n_total}</span>
          </span>`;
        }).join("")}
      </div>
    </li>
  `;
}

function renderTimelineMarks() {
  const root = document.getElementById("timepoint-marks");
  if (!root || !state.microbiome) return;
  const tps = state.microbiome.timepoints;
  root.innerHTML = tps.map((tp, i) => `
    <button type="button" class="timepoint-mark" data-idx="${i}" title="Jump to ${escapeHtml(tp)}">
      <span class="tp-dot"></span>
      <span class="tp-label">${escapeHtml(tp)}</span>
    </button>
  `).join("");
  root.querySelectorAll(".timepoint-mark").forEach(btn => {
    btn.addEventListener("click", () => {
      state.timepointIdx = Number(btn.dataset.idx);
      const slider = document.getElementById("timepoint");
      if (slider) slider.value = String(state.timepointIdx);
      repaintAll();
    });
  });
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

  // The microbiome roster (.roster-tile) wires its own click + arrow-key
  // handlers in mountAvatars(). No avatar-grid fallback needed anymore.
}

// =============================================================
// Boot
// =============================================================

document.addEventListener("DOMContentLoaded", async () => {
  // Each step is isolated: one failing render shouldn't black out the whole page.
  try {
    const { microbiome, bloodwork, opportunists, beneficials } = await loadAll();
    state.microbiome = microbiome;
    state.bloodwork = bloodwork;
    state.opportunists = opportunists;
    state.beneficials = beneficials;
    safe("mountHero",  () => mountHero());
    safe("wireEvents", () => wireEvents());
    safe("repaintAll", () => repaintAll());
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
      mountHero:      "hero",
      renderFindings: "findings-list",
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
