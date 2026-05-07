# Microbiome Avatar + CBC Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static-site dashboard for the Inspiration 4 mission that lets an astronaut read their CBC recovery story (breadth) and click into a 2×2 SVG body avatar grid to see *where* their microbiome shifted post-flight (depth) — all wrapped in honest, calibrated uncertainty.

**Architecture:** Three layers. Python analysis (notebooks + scripts) → two JSON files in `dashboard/data/` (the only contract) → static HTML/JS/SVG frontend. No backend, no build step. Frontend developed in parallel against hand-authored fixture JSON until real data arrives.

**Tech Stack:** Python 3.11, pandas, numpy, scipy (Bray-Curtis + bootstrap), Jupyter; vanilla HTML/CSS/JS, SVG (hand-authored in Inkscape/Figma), Plotly.js for CBC plots, deployed via GitHub Pages.

**Spec:** [docs/superpowers/specs/2026-05-07-microbiome-avatar-design.md](../specs/2026-05-07-microbiome-avatar-design.md)

**Wall-clock budget:** ~56 hours, ending Saturday 2026-05-09 16:00 CT.

**Owners:** Thomas (T) — microbiome pipeline. Earl (E) — CBC pipeline + frontend integration. Mollie (M) — SVG avatar + design polish.

**Tag legend:** **MVP** = must ship for a complete submission. **POLISH** = ship if MVP locks early. **STRETCH** = explicitly cuttable, only if everything else is done.

---

## Phase 0 — Hour 0–1: Lock the Contract (everyone, together)

The single highest-leverage hour of the hackathon. After Phase 0, all three streams can run in parallel without blocking each other.

### Task 0.1: Read the spec [ALL] **MVP**

**Files:** none (read-only)

- [ ] Each of you reads the spec at `docs/superpowers/specs/2026-05-07-microbiome-avatar-design.md` end-to-end (15 min). Bring questions.
- [ ] Together, walk through the **Data Contract** and **Avatar — Visual Model** sections aloud. Disagreements get resolved now, not later.

### Task 0.2: Agree on the file/folder layout [ALL] **MVP**

**Files:**
- Create: `analysis/`, `analysis/shared/`, `dashboard/`, `dashboard/data/`

- [ ] Confirm the layout from the spec's "Repository Structure" section. The `.gitkeep` placeholders in `analysis/`, `dashboard/`, `data/`, `docs/`, `notebooks/` will be replaced as real files arrive.
- [ ] Decide who pushes to `main` directly vs. who uses feature branches. Recommendation for this size: short-lived branches per task, merge to `main` when green. Avoid long-lived branches; they cause merge pain at hour 50.

### Task 0.3: Hand-author the microbiome fixture JSON [T] **MVP**

**Files:**
- Create: `dashboard/data/fixture-microbiome.json`

- [ ] Author a small but realistic fixture covering **all 4 crew × 10 sites × at least 4 timepoints**, with plausible-looking scores in `[0.0, 1.0]`. Goal: frontend has something to render before the real pipeline finishes.

```json
{
  "crew": ["C001", "C002", "C003", "C004"],
  "sites": ["oral", "nasal", "post_auricular", "axillary", "forearm",
            "occiput", "umbilicus", "gluteal", "glabella", "toe_web"],
  "timepoints": ["L-92", "L-44", "L-3", "FD2", "FD3", "R+1", "R+45", "R+82"],
  "baseline_timepoints": ["L-92", "L-44", "L-3"],
  "scores": {
    "C001": {
      "oral":   {"FD2": {"d": 0.42, "ci_lo": 0.31, "ci_hi": 0.55, "n_baseline": 3, "within_baseline_noise": false}},
      "nasal":  {"FD2": {"d": 0.18, "ci_lo": 0.10, "ci_hi": 0.27, "n_baseline": 3, "within_baseline_noise": true}}
    }
  },
  "drilldown": {
    "C001": {
      "oral": {
        "FD2": {
          "top_taxa_up":   [{"name": "Streptococcus mitis", "delta": 0.18},
                            {"name": "Veillonella parvula", "delta": 0.11}],
          "top_taxa_down": [{"name": "Lactobacillus salivarius", "delta": -0.14},
                            {"name": "Rothia dentocariosa",     "delta": -0.09}]
        }
      }
    }
  }
}
```

- [ ] Fill enough entries so each crew has at least one site with a high score and one with a low score, at FD2 or R+1 (the visually interesting timepoints).
- [ ] Commit:

```bash
git add dashboard/data/fixture-microbiome.json
git commit -m "Add microbiome JSON fixture for parallel frontend dev"
```

### Task 0.4: Hand-author the CBC fixture JSON [E] **MVP**

**Files:**
- Create: `dashboard/data/fixture-cbc.json`

- [ ] Author a fixture covering **3–4 metrics × 4 crew × all 7 timepoints**. Pick metrics with known clinical reference ranges so the layout work is realistic: `wbc`, `rbc`, `hemoglobin`, `platelets`.

```json
{
  "crew": ["C001", "C002", "C003", "C004"],
  "timepoints": ["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"],
  "metrics": {
    "wbc": {
      "label": "White blood cell count",
      "units": "10^9/L",
      "reference_range": [4.0, 11.0],
      "values": {
        "C001": {"L-92": 6.2, "L-44": 5.9, "L-3": 6.1, "R+1": 8.4, "R+45": 6.5, "R+82": 6.0, "R+194": 5.8}
      },
      "trajectory_ci": {
        "C001": {"L-92": [5.8, 6.6], "L-44": [5.5, 6.3], "L-3": [5.7, 6.5],
                 "R+1": [7.6, 9.2], "R+45": [6.0, 7.0], "R+82": [5.6, 6.4], "R+194": [5.4, 6.2]}
      }
    }
  }
}
```

- [ ] Fill all four crew for `wbc`, then partially fill the other three metrics.
- [ ] Commit:

```bash
git add dashboard/data/fixture-cbc.json
git commit -m "Add CBC JSON fixture for parallel frontend dev"
```

### Task 0.5: Pin the schema [ALL] **MVP**

**Files:** the two fixture files above

- [ ] Open both fixture files side-by-side. **Schema is now frozen.** From this point: any change to the JSON shape requires a 5-minute Slack/Discord agreement and an immediate update to both fixtures **and** any consumer code. No silent schema drift.
- [ ] Sanity check: `python3 -m json.tool dashboard/data/fixture-microbiome.json` and same for `fixture-cbc.json`. Both should pretty-print without error.

---

## Phase 1 — Hours 1–14: Three Parallel Streams

### Stream A — SVG body template + design system [M]

#### Task 1.A.1: Author `body.svg` [M] **MVP**

**Files:**
- Create: `dashboard/body.svg`

- [ ] In Inkscape or Figma, draw a simple front-facing 2D human figure. Stylized is fine; this is not anatomy class.
- [ ] Add **10 distinct closed paths** for the regions, with these exact `id` attributes (the ID strings are part of the locked contract — they must match the `sites` array in `fixture-microbiome.json`):

| `id`              | What to draw |
|-------------------|--------------|
| `oral`            | mouth area on the face |
| `nasal`           | nose / nostril area |
| `post_auricular`  | behind-the-ear region (visible side) |
| `axillary`        | armpit |
| `forearm`         | volar (inner) forearm |
| `occiput`         | back-of-head crown (you can position figure 3/4 view, or include a small inset) |
| `umbilicus`       | belly button area |
| `gluteal`         | small marker low on the back/hip; 3/4 view helps |
| `glabella`        | between the eyebrows |
| `toe_web`         | between toes (foot region) |

- [ ] Each region gets a `fill="#cccccc"` default. The frontend will overwrite `fill` at runtime.
- [ ] Save as plain SVG (not Inkscape SVG). Open the raw file and confirm each region path has its `id`. Commit:

```bash
git add dashboard/body.svg
git commit -m "Add 10-region SVG body template for avatar grid"
```

#### Task 1.A.2: Pick the color scale [M] **MVP**

**Files:**
- Create: `dashboard/styles.css` (skeleton)

- [ ] Pick a colorblind-safe sequential scale. Recommended: light-gray (low / near baseline) → orange → deep red (high / strongly shifted). Pick 5–7 stops and write them as CSS custom properties so JS can interpolate cheaply:

```css
:root {
  --score-0: #e8e8e8;  /* near baseline */
  --score-1: #fde0c5;
  --score-2: #fbb88a;
  --score-3: #f78250;
  --score-4: #d94a1f;
  --score-5: #8c1d10;  /* strongly shifted */
  --no-data: repeating-linear-gradient(
    45deg, #f0f0f0, #f0f0f0 4px, #d8d8d8 4px, #d8d8d8 8px
  );
}
```

- [ ] Add a small swatch/legend block to the page mockup (HTML in the next task) showing the 6 stops with labels: "near baseline", "moderate", "strong shift". Don't show numeric ranges yet — Thomas will tell you the score distribution after Task 1.B.5.

#### Task 1.A.3: Mock the page layout [M] **MVP**

**Files:**
- Modify: `dashboard/styles.css`
- Create: `dashboard/index.html` (skeleton, Earl will wire it)

- [ ] Author a static `index.html` skeleton with these regions, no JS yet:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Recovery, Honestly — Inspiration 4</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <h1>Recovery, Honestly</h1>
    <p class="subtitle">Am I back to baseline — and where on me did things shift?</p>
  </header>

  <aside id="honesty-strip">
    4 crew members, 3 pre-flight baseline swabs per site, no in-flight CBC.
    Treat all numbers as descriptive of these four people, not predictive.
  </aside>

  <section id="cbc-panel">
    <h2>Bloodwork (CBC) trajectories</h2>
    <div id="cbc-plots"><!-- Plotly mounts here --></div>
  </section>

  <section id="avatar-section">
    <h2>Microbiome — where on the body did things shift?</h2>
    <div id="timepoint-slider-wrap">
      <label for="timepoint">Timepoint:</label>
      <input type="range" id="timepoint" min="0" max="7" value="0">
      <span id="timepoint-label">L-92</span>
    </div>
    <div id="avatar-grid">
      <figure data-crew="C001"><figcaption>C001</figcaption><div class="avatar"></div></figure>
      <figure data-crew="C002"><figcaption>C002</figcaption><div class="avatar"></div></figure>
      <figure data-crew="C003"><figcaption>C003</figcaption><div class="avatar"></div></figure>
      <figure data-crew="C004"><figcaption>C004</figcaption><div class="avatar"></div></figure>
    </div>

    <aside id="legend">
      <!-- color stops + labels -->
    </aside>

    <section id="drilldown" hidden>
      <h3 id="drilldown-title"></h3>
      <p id="drilldown-summary"></p>
      <div id="drilldown-tables">
        <div><h4>Top taxa increased vs baseline</h4><ol id="taxa-up"></ol></div>
        <div><h4>Top taxa decreased vs baseline</h4><ol id="taxa-down"></ol></div>
      </div>
      <p class="caveat">With only 3 baseline samples, these rankings are noisy.</p>
    </section>
  </section>

  <footer>
    <p>Inspiration 4 mission · NASA OSDR <a href="https://osdr.nasa.gov/">OSD-572 / OSD-569</a> · Track 3</p>
  </footer>

  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <script src="app.js" type="module"></script>
</body>
</html>
```

- [ ] Style the layout: CBC panel above, 2×2 avatar grid below, drill-down hidden by default. Mobile-friendly is not a goal; focus on a clean ~1200px desktop layout.
- [ ] Commit when the skeleton renders the four placeholder figures and the slider is visible.

```bash
git add dashboard/index.html dashboard/styles.css
git commit -m "Add dashboard HTML/CSS skeleton with avatar grid placeholders"
```

#### Task 1.A.4: Honesty strip and drill-down copy [M] **POLISH**

**Files:** `dashboard/index.html`, `dashboard/styles.css`

- [ ] Style the honesty strip so it's persistently visible (sticky top? colored background?) and undismissible. Copy is already in the spec.
- [ ] Write three plain-language interpretation strings the JS will pick from:
  - score in `[0.0, 0.2)`: "near your pre-flight baseline"
  - score in `[0.2, 0.5)`: "moderately shifted from your pre-flight baseline"
  - score `≥ 0.5`: "strongly shifted from your pre-flight baseline"
- [ ] If `within_baseline_noise == true`, the plain-language string overrides to: "within your pre-flight noise — no clear shift."
- [ ] Hand the thresholds to Thomas before he wires things; numbers may shift after he sees the real distribution.

---

### Stream B — Microbiome analysis pipeline [T]

#### Task 1.B.1: Notebook scaffolding + load OSD-572 taxa [T] **MVP**

**Files:**
- Create: `notebooks/01_microbiome_explore.ipynb`

- [ ] Make a copy of the kickoff Colab as a starting point. Load only the **taxa** file — ignore KEGG, pathway, and gene-family files for MVP.

```python
import pandas as pd
TAXA_URL = "https://osdr.nasa.gov/geode-py/ws/studies/OSD-572/download?source=datamanager&file=GLDS-564_GMetagenomics_Combined-taxonomy_GLmetagenomics.tsv"
taxa = pd.read_csv(TAXA_URL, index_col=0, sep='\t')
taxa.head()
print(taxa.shape, "rows = taxa, cols = samples")
```

- [ ] Print column names. Note the sample-naming convention; you'll need it for the parser. Expect strings like `C001_oral_FD2` or similar — confirm the exact format before writing the regex.
- [ ] Commit the notebook with a clear first-cell narrative.

#### Task 1.B.2: Sample-name parser [T] **MVP**

**Files:**
- Create: `analysis/shared/__init__.py` (empty)
- Create: `analysis/shared/sample_parser.py`

- [ ] Write the parser based on the actual format you observed in 1.B.1.

```python
# analysis/shared/sample_parser.py
import re
from dataclasses import dataclass

VALID_SITES = {"oral", "nasal", "post_auricular", "axillary", "forearm",
               "occiput", "umbilicus", "gluteal", "glabella", "toe_web"}
VALID_TIMEPOINTS = ["L-92", "L-44", "L-3", "FD2", "FD3", "R+1", "R+45", "R+82"]
BASELINE_TIMEPOINTS = ["L-92", "L-44", "L-3"]

@dataclass
class SampleID:
    crew: str          # e.g., "C001"
    site: str          # one of VALID_SITES
    timepoint: str     # one of VALID_TIMEPOINTS

def parse_sample(name: str) -> SampleID | None:
    """Return SampleID or None if unparseable. Update regex to match real format."""
    # EXAMPLE — adjust pattern after seeing real sample names in 1.B.1
    m = re.match(r"^(C00\d)_([a-z_]+)_(L-\d+|FD\d|R\+\d+)$", name)
    if not m:
        return None
    crew, site, tp = m.groups()
    if site not in VALID_SITES or tp not in VALID_TIMEPOINTS:
        return None
    return SampleID(crew, site, tp)
```

- [ ] Quick sanity test in the notebook: parse every column, count successes, print any that failed. **Aim for 100% success.** If site labels don't match `VALID_SITES`, agree on a rename map and document it in the same file.

#### Task 1.B.3: Bootstrap utility [T] **MVP**

**Files:**
- Create: `analysis/shared/bootstrap.py`

```python
# analysis/shared/bootstrap.py
import numpy as np

def bootstrap_ci(values: np.ndarray, statistic, n_boot: int = 1000,
                 ci: float = 0.95, rng=None) -> tuple[float, float, float]:
    """Return (point_estimate, ci_lo, ci_hi)."""
    rng = rng or np.random.default_rng(0)  # deterministic for reproducibility
    n = len(values)
    boots = np.empty(n_boot)
    for i in range(n_boot):
        sample = rng.choice(values, size=n, replace=True)
        boots[i] = statistic(sample)
    lo, hi = np.quantile(boots, [(1 - ci) / 2, 1 - (1 - ci) / 2])
    return float(statistic(values)), float(lo), float(hi)
```

- [ ] Quick test in the notebook: feed `np.array([1,2,3,4,5])` with `np.mean` — point estimate should be 3.0, CI bounds finite.

#### Task 1.B.4: Bray-Curtis distance from baseline [T] **MVP**

**Files:**
- Modify: `notebooks/01_microbiome_explore.ipynb`

```python
from scipy.spatial.distance import braycurtis
import numpy as np

def relative_abundance(col: pd.Series) -> np.ndarray:
    total = col.sum()
    return (col / total).values if total > 0 else np.zeros_like(col.values, dtype=float)

# For each crew × site:
#   1. Find baseline samples (timepoints in BASELINE_TIMEPOINTS)
#   2. Compute mean baseline abundance vector
#   3. For each non-baseline timepoint at that site, compute braycurtis(timepoint_vec, baseline_mean)
```

- [ ] Implement a function `score_one(crew, site, timepoint, taxa, parsed_cols) -> dict` that returns `{"d": ..., "ci_lo": ..., "ci_hi": ..., "n_baseline": ..., "within_baseline_noise": ...}`. Use `bootstrap_ci` from 1.B.3, where the statistic is "Bray-Curtis distance between the timepoint vector and the bootstrapped-baseline mean."
- [ ] **Within-baseline noise rule:** compute the pairwise within-baseline Bray-Curtis distances (3 baseline samples → 3 pairwise distances). If the post-flight `d` ≤ the *max* of those within-baseline distances, set `within_baseline_noise = true`.

#### Task 1.B.5: Top-taxa drill-down [T] **MVP**

**Files:**
- Modify: `notebooks/01_microbiome_explore.ipynb`

- [ ] For each (crew, site, non-baseline timepoint), compute per-taxon delta vs. mean baseline relative abundance. Return the top 5 increases (`delta > 0`) and top 5 decreases (`delta < 0`) by absolute magnitude:

```python
def top_taxa(timepoint_vec: np.ndarray, baseline_mean: np.ndarray,
             taxa_names: list[str], k: int = 5) -> dict:
    delta = timepoint_vec - baseline_mean
    idx_up = np.argsort(delta)[::-1][:k]
    idx_down = np.argsort(delta)[:k]
    return {
        "top_taxa_up":   [{"name": taxa_names[i], "delta": float(delta[i])} for i in idx_up if delta[i] > 0],
        "top_taxa_down": [{"name": taxa_names[i], "delta": float(delta[i])} for i in idx_down if delta[i] < 0],
    }
```

#### Task 1.B.6: Export to `microbiome.json` [T] **MVP**

**Files:**
- Create: `analysis/microbiome_pipeline.py`

- [ ] Move the working code out of the notebook into a runnable script:

```python
# analysis/microbiome_pipeline.py
"""Generate dashboard/data/microbiome.json from OSD-572 taxa data."""
import json
from pathlib import Path
import pandas as pd
from analysis.shared.sample_parser import parse_sample, VALID_SITES, VALID_TIMEPOINTS, BASELINE_TIMEPOINTS

TAXA_URL = "https://osdr.nasa.gov/geode-py/ws/studies/OSD-572/download?source=datamanager&file=GLDS-564_GMetagenomics_Combined-taxonomy_GLmetagenomics.tsv"
OUT = Path(__file__).resolve().parent.parent / "dashboard" / "data" / "microbiome.json"

def main() -> None:
    taxa = pd.read_csv(TAXA_URL, index_col=0, sep='\t')
    # ... compute scores + drilldown ...
    payload = {
        "crew": sorted({s.crew for s in parsed.values()}),
        "sites": sorted(VALID_SITES),
        "timepoints": VALID_TIMEPOINTS,
        "baseline_timepoints": BASELINE_TIMEPOINTS,
        "scores": scores,
        "drilldown": drilldown,
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
```

- [ ] Run it, **diff the output schema against `fixture-microbiome.json` field-by-field** (`diff <(jq -S 'del(.scores,.drilldown)' dashboard/data/microbiome.json) <(jq -S 'del(.scores,.drilldown)' dashboard/data/fixture-microbiome.json)` — should be empty).
- [ ] Commit:

```bash
git add analysis/shared/ analysis/microbiome_pipeline.py notebooks/01_microbiome_explore.ipynb dashboard/data/microbiome.json
git commit -m "Add microbiome pipeline: Bray-Curtis distance from per-crew baseline + drill-down"
```

#### Task 1.B.7: Hand thresholds to design [T] **POLISH**

- [ ] Print the score distribution (`min`, `25th`, `median`, `75th`, `max`) and tell Mollie. If thresholds in 1.A.4 (`0.2`, `0.5`) don't fit the data, propose new ones based on quartiles. Don't pick thresholds that hide all the variance.

---

### Stream C — CBC pipeline + frontend skeleton [E]

#### Task 1.C.1: Notebook + load OSD-569 CBC [E] **MVP**

**Files:**
- Create: `notebooks/02_cbc_explore.ipynb`

- [ ] Use the same sample-name parser from `analysis/shared/sample_parser.py`. The CBC sub-dataset is the longitudinal panel referenced in the existing README. Confirm the exact filename in the OSD-569 file list before fetching.

```python
import pandas as pd
# Replace with the actual CBC file URL from OSD-569's data table
CBC_URL = "https://osdr.nasa.gov/geode-py/ws/studies/OSD-569/download?source=datamanager&file=<EXACT-FILENAME-HERE>"
cbc = pd.read_csv(CBC_URL)
cbc.head()
```

- [ ] Inspect: rows = samples, columns = metrics (or vice versa). Either way, end up with a long-form DataFrame indexed by `(crew, timepoint, metric)`.

#### Task 1.C.2: Per-crew trajectory + bootstrap CI on baseline [E] **MVP**

**Files:**
- Modify: `notebooks/02_cbc_explore.ipynb`

- [ ] For each metric, for each crew member: collect their L-92 / L-44 / L-3 values as the personal baseline, bootstrap to get a CI on the per-crew baseline mean. The trajectory CI at each timepoint is the per-crew baseline CI **shifted** to that timepoint's measured value (i.e., we're communicating uncertainty about the *baseline anchor*, not measurement error of a single point).
- [ ] Use `analysis/shared/bootstrap.py`.

#### Task 1.C.3: Reference ranges [E] **MVP**

**Files:**
- Modify: `notebooks/02_cbc_explore.ipynb`

- [ ] Hard-code clinical reference ranges for the CBC metrics you're plotting. Source from Quest Diagnostics' published ranges (the kickoff transcript notes Quest ran the CMP) or a standard reference like LabCorp. Keep it to 6–10 metrics for the MVP — `wbc`, `rbc`, `hemoglobin`, `hematocrit`, `platelets`, `neutrophils`, `lymphocytes`. Cite the source in the notebook.

```python
REFERENCE_RANGES = {
    "wbc":         {"label": "White blood cell count", "units": "10^9/L", "range": [4.0, 11.0]},
    "rbc":         {"label": "Red blood cell count",   "units": "10^12/L", "range": [4.5, 5.9]},
    "hemoglobin":  {"label": "Hemoglobin",             "units": "g/dL",    "range": [13.5, 17.5]},
    # ... add the rest
}
```

#### Task 1.C.4: Export to `cbc.json` [E] **MVP**

**Files:**
- Create: `analysis/cbc_pipeline.py`

- [ ] Move working code out of the notebook into a script that emits the schema from `fixture-cbc.json`.
- [ ] Diff the schema against the fixture, same as 1.B.6.
- [ ] Commit:

```bash
git add analysis/cbc_pipeline.py notebooks/02_cbc_explore.ipynb dashboard/data/cbc.json
git commit -m "Add CBC pipeline: per-crew trajectories with bootstrap baseline CIs"
```

#### Task 1.C.5: Frontend bootstrap — fetch JSONs [E] **MVP**

**Files:**
- Create: `dashboard/app.js`

- [ ] Wire a minimal `app.js` that fetches **fixtures** at startup (so frontend works before real pipelines finish). Switch to real files at integration time by changing the URL string in one place:

```js
// dashboard/app.js
const DATA_DIR = "./data";

// During development, point to fixture-*.json. Flip to "microbiome.json"/"cbc.json" once pipelines emit those.
const MICROBIOME_URL = `${DATA_DIR}/fixture-microbiome.json`;
const CBC_URL = `${DATA_DIR}/fixture-cbc.json`;

async function loadAll() {
  const [microbiome, cbc] = await Promise.all([
    fetch(MICROBIOME_URL).then(r => r.json()),
    fetch(CBC_URL).then(r => r.json()),
  ]);
  return { microbiome, cbc };
}

document.addEventListener("DOMContentLoaded", async () => {
  const data = await loadAll();
  console.log("loaded", data);  // sanity check
  // Stream-D tasks below wire the rest.
});
```

- [ ] Open `index.html` via a static server (`python3 -m http.server 8080` in `dashboard/`). Confirm both fixtures load without error in the browser console.
- [ ] Commit:

```bash
git add dashboard/app.js
git commit -m "Add frontend bootstrap: fetch microbiome and CBC JSON fixtures"
```

---

## Phase 2 — Hours 14–30: Wire the Frontend

By now: `body.svg` exists (M), `microbiome.json` is real (T), `cbc.json` is real (E). All frontend integration is **Earl** with **Mollie** doing visual QA.

### Task 2.1: Inline the SVG into each avatar slot [E] **MVP**

**Files:** `dashboard/app.js`

- [ ] Fetch `body.svg` once, then clone it into each `figure[data-crew]` so each crew member has its own DOM-addressable copy of the body. Inline (vs `<img src>`) is required so JS can recolor `<path>` fills.

```js
async function loadBodyTemplate() {
  const text = await fetch("./body.svg").then(r => r.text());
  return new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
}

function mountAvatars(template) {
  document.querySelectorAll("figure[data-crew] .avatar").forEach(host => {
    host.appendChild(template.cloneNode(true));
  });
}
```

### Task 2.2: Color regions by score [E] **MVP**

**Files:** `dashboard/app.js`, `dashboard/styles.css`

- [ ] Implement `colorForScore(d, withinBaselineNoise)` that returns a CSS color drawn from the `--score-*` custom properties. Linearly interpolate between adjacent stops. If `withinBaselineNoise === true`, return the lowest stop regardless.
- [ ] Implement `paintAvatar(crew, timepoint, microbiome)` that loops over the 10 sites, finds the score for that crew at that timepoint, and sets the `<path>` fill. **If a site is missing from `scores[crew][site]`, set its fill to `var(--no-data)` via a pattern attribute or CSS class — never red.**

### Task 2.3: Wire the timepoint slider [E] **MVP**

**Files:** `dashboard/app.js`, `dashboard/index.html`

- [ ] On `input` events, read the slider's index, look up `timepoints[i]`, update the visible label, and call `paintAvatar` for all four crew. Also re-render the CBC panel (Task 2.5) filtered to the selected timepoint when relevant.

### Task 2.4: Hover tooltip + click drill-down [E] **MVP**

**Files:** `dashboard/app.js`, `dashboard/styles.css`

- [ ] Attach `mouseenter`/`mouseleave`/`click` listeners to each region path. Tooltip on hover (CSS-only `title` is acceptable for MVP). Click reveals the drill-down panel with crew/site/timepoint, plain-language summary, and the two top-taxa lists from `microbiome.drilldown`.
- [ ] If the user clicks a region with no data, drill-down says "no swab collected at this site for this timepoint" — never invent data.

### Task 2.5: CBC plots with Plotly [E] **MVP**

**Files:** `dashboard/app.js`

- [ ] For each metric in `cbc.metrics`, render a small-multiples row of 4 Plotly line charts (one per crew). Each plot:
  - X axis: timepoint (categorical, in order from the `timepoints` array)
  - Y axis: metric value with units
  - Trajectory line + filled CI band from `trajectory_ci`
  - **Visible gap** between L-3 and R+1 (no in-flight CBC). Don't connect those points with a line.
  - Horizontal shaded band for `reference_range`.
- [ ] Clicking a crew's avatar should scroll/highlight that crew's CBC plots (or filter the panel to that crew). Pick whichever is simpler.

### Task 2.6: Switch to real data [E + T] **MVP**

**Files:** `dashboard/app.js`

- [ ] Once both pipelines have written real `microbiome.json` and `cbc.json` and the schema-diff passed, change the URLs in Task 1.C.5 from `fixture-*.json` → real files.
- [ ] Visual QA together: walk through every (crew, timepoint) combination. Look for `NaN`s, missing tooltips, regions that "should" be red but aren't (sanity check against the notebook).
- [ ] Commit:

```bash
git add dashboard/app.js dashboard/styles.css
git commit -m "Wire avatar grid, timepoint slider, drill-down, and CBC plots"
```

---

## Phase 3 — Hours 30–44: MVP Lock + Polish

### Task 3.1: Honesty strip implemented [M] **MVP**

**Files:** `dashboard/index.html`, `dashboard/styles.css`

- [ ] The honesty strip from Task 1.A.4 is now sticky-top, can't be dismissed, and reads correctly on the live data. If the data has surprises (e.g., a site with only 2 baseline swabs), the strip gets a sentence about it.

### Task 3.2: README rewrite [T] **MVP**

**Files:** `README.md`

- [ ] Rewrite the project README to reflect the dual-view (CBC + avatar) framing. Keep the "Recovery, Honestly" identity. Add a screenshot of the dashboard. Add a "How to view" section: clone, `python3 -m http.server` in `dashboard/`, open `localhost:8000`.
- [ ] Add a "Methods" section pointing to the spec and plan in `docs/`.

### Task 3.3: Cross-crew comparison polish [E] **POLISH**

**Files:** `dashboard/app.js`, `dashboard/styles.css`

- [ ] When the user selects a crew, the other three avatars render slightly faded (`opacity: 0.5`) so the focused crew pops. Click again to deselect.

### Task 3.4: Drill-down narrative copy [M] **POLISH**

**Files:** `dashboard/app.js`

- [ ] Replace placeholder strings with the three-tier interpretations from Task 1.A.4. Add a per-site one-liner explaining what microbes typically live at that site (one well-cited sentence — cite NIH Human Microbiome Project where applicable).

### Task 3.5: Missing-data audit [E] **MVP**

- [ ] Walk through all (crew, site, timepoint) cells. Confirm: every missing combination renders as hatched neutral, never red, never NaN-text. The "no swab collected" message fires when expected.

### Task 3.6: Mobile/narrow-screen graceful degradation [M] **POLISH**

- [ ] Below 900px wide, stack the 2×2 grid into 1×4 and shrink the CBC panel. Don't try to make it phone-pretty; just don't break.

---

## Phase 4 — Hours 44–56: Submit

### Task 4.1: Final QA pass [ALL] **MVP**

- [ ] Three-person walkthrough. Each person opens the live site cold and reads it as if they were Hayley/Sian/Chris/Jared.
- [ ] Check: every assertion has a CI or "within baseline noise" tag; no clinical recommendations slip in; honesty strip is visible from every scroll position; the dashboard works offline (download a copy of the repo, open locally).

### Task 4.2: GitHub Pages deploy [T or E] **MVP**

- [ ] Push to `main`. In the GitHub repo settings, enable Pages → source: `main` branch / `dashboard/` folder. Wait for the green check, click the Pages URL, do a final sanity load.
- [ ] Add the Pages URL to the README.

### Task 4.3: Make the repo public [T] **MVP**

- [ ] At submission time only — repo settings → change visibility → public.
- [ ] Submit the public repo URL to the hackathon checkpoint form.

### Task 4.4: Stretch — claim-check view [ALL] **STRETCH**

**Only attempted if Tasks 4.1–4.3 are done with ≥6 hours remaining.**

- [ ] Pick 3 specific claims from published Inspiration 4 papers (Mason lab, Nature 2024).
- [ ] For each: paper's claim → underlying CBC or microbiome evidence → honest reinterpretation given n=4. One paragraph each, in a new "Claim check" section in `index.html`.
- [ ] Cut at any time if quality slips.

---

## Spec Coverage Self-Check

| Spec section | Implemented in |
|---|---|
| Astronaut's Question | README rewrite (3.2), header in `index.html` (1.A.3) |
| CBC panel (breadth) | Tasks 1.C.1–1.C.4, 2.5 |
| Avatar grid (depth) | Tasks 1.A.1, 2.1–2.4 |
| Honesty strip | Tasks 1.A.3, 1.A.4, 3.1 |
| 3-layer architecture | Phase 0 contract + Streams B/C + Stream A |
| `microbiome.json` schema | Tasks 0.3 (fixture), 1.B.6 (real) |
| `cbc.json` schema | Tasks 0.4 (fixture), 1.C.4 (real) |
| Bray-Curtis from baseline | Task 1.B.4 |
| Bootstrap CI methodology | Task 1.B.3, used in 1.B.4, 1.C.2 |
| Within-baseline-noise flag | Task 1.B.4 |
| Top-taxa drill-down | Tasks 1.B.5, 2.4 |
| CBC reference ranges | Task 1.C.3 |
| Missing-data hatched fill | Tasks 2.2, 3.5 |
| MVP scope | Phase 0–3 tasks tagged **MVP** |
| Cuts (RNA-seq, KEGG, etc.) | Not implemented — explicitly cut in spec |
| Stretch — claim-check | Task 4.4, gated on ≥6 hours remaining |

---

## Daily Checkpoints

The hackathon enforces daily check-ins; align task completion to these:

- **Wed 2026-05-06 21:00 CT** — repo initialized, project idea stated. *Already met.*
- **Thu 2026-05-07 evening** — Phase 0 + Phase 1 complete (fixtures committed, three streams running). Send a screenshot of the avatar skeleton with fixture data.
- **Fri 2026-05-08 evening** — Phase 2 complete. Real data, end-to-end working.
- **Sat 2026-05-09 16:00 CT** — Phase 3 + 4 complete. Repo public. Submitted.
