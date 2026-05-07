# Recovery, Honestly — Microbiome Avatar + CBC Dashboard

**Track:** 3 — Communication & Visualization (with elements of Track 1 — molecular perturbation)
**Hackathon submission deadline:** 2026-05-09 16:00 CT
**Team:** Earl, Thomas, Mollie

## The Astronaut's Question

> *"Am I back to baseline — and where on me did things shift?"*

CBC trajectories tell an astronaut whether their bloodwork has recovered. The body avatar tells them *where* on their body the microbial community shifted, and lets them click into any region to see which organisms drove the change. Both views are wrapped in explicit, calibrated uncertainty.

## What We're Building

A static-site dashboard with two coupled views, served from a single page:

- **CBC panel (breadth).** Per-crew-member trajectories from L-92 → R+194 with bootstrap CIs and clinical reference ranges. The familiar bloodwork an astronaut already understands.
- **Body avatar grid (depth).** A 2×2 grid of SVG human figures (one per crew member, C001–C004) with 10 anatomical regions colored by *disturbance score* — Bray-Curtis distance from that crew member's own pre-flight microbial baseline. A single timepoint slider drives all four avatars in sync. Clicking a region opens a drill-down panel showing the top taxa that rose and fell at that site/timepoint.

Both views share an always-visible **honesty strip** stating the limits of n=4 and the absence of in-flight CBC.

## Architecture

Three deliberately decoupled layers:

1. **Analysis layer** — Python notebooks (`notebooks/`) and scripts (`analysis/`). Loads OSD-572 (taxa table) and OSD-569 (CBC). Computes per-crew × per-site × per-timepoint disturbance scores with bootstrap CIs, plus per-crew CBC trajectories. Emits two JSON files into `dashboard/data/`.
2. **Data contract** — `dashboard/data/microbiome.json` and `dashboard/data/cbc.json`. The only interface between analysis and frontend.
3. **Frontend layer** — `dashboard/index.html` + vanilla JS + SVG body templates + Plotly for CBC plots. No build step. Deployed via GitHub Pages on submission.

This shape lets the design + frontend track move in parallel with the stats track once the JSON schema is locked.

## Data Contract

### `dashboard/data/microbiome.json`

```json
{
  "crew": ["C001", "C002", "C003", "C004"],
  "sites": [
    "oral", "nasal", "post_auricular", "axillary", "forearm",
    "occiput", "umbilicus", "gluteal", "glabella", "toe_web"
  ],
  "timepoints": ["L-92", "L-44", "L-3", "FD2", "FD3", "R+1", "R+45", "R+82"],
  "baseline_timepoints": ["L-92", "L-44", "L-3"],
  "scores": {
    "C001": {
      "oral": {
        "FD2": {"d": 0.42, "ci_lo": 0.31, "ci_hi": 0.55, "n_baseline": 3, "within_baseline_noise": false}
      }
    }
  },
  "drilldown": {
    "C001": {
      "oral": {
        "FD2": {
          "top_taxa_up":   [{"name": "Streptococcus mitis", "delta": 0.18}],
          "top_taxa_down": [{"name": "Lactobacillus salivarius", "delta": -0.14}]
        }
      }
    }
  }
}
```

Each `scores` entry contains the score, a 95% bootstrap CI on the baseline-distance, the number of baseline swabs that fed it, and a precomputed `within_baseline_noise` flag (true when the post-flight distance falls inside the within-baseline distance distribution).

Sites with no swab at a given timepoint are *omitted* from `scores`. The frontend renders missing entries as a neutral hatched fill, never red.

### `dashboard/data/cbc.json`

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
        "C001": {"L-92": [5.8, 6.6], "...": "..."}
      }
    }
  }
}
```

CI bounds are derived from each crew member's own pre-flight variability (bootstrap of the three L- timepoints), not from a population mean.

## Avatar — Visual Model and Interaction

- One reusable SVG body template with 10 named `<path>` regions. IDs match the `sites` array. Authored in Inkscape/Figma; exported and hand-tweaked.
- The page renders four instances of that SVG in a 2×2 grid, labeled C001–C004.
- A single timepoint slider underneath spans `L-92 … R+82`. Moving it updates all four SVGs simultaneously via JS.
- For each region in each crew × timepoint, fill color is interpolated on a colorblind-safe sequential scale keyed on `d`. The legend shows the score range and explicitly maps colors to interpretations ("near baseline" / "moderately shifted" / "strongly shifted").
- **Sites with no data render as neutral hatched fill, never red.** Absence of measurement must not look like signal.
- **Hover** any region: tooltip shows `score = 0.42 [95% CI 0.31–0.55], n_baseline = 3`.
- **Click** a region: opens the drill-down panel below the grid containing:
  - Site, timepoint, and crew identifier
  - The score and CI in plain language ("moderately shifted from your pre-flight microbiome")
  - Top 5 taxa that **rose** vs baseline, top 5 that **fell**
  - Caveat line: "with only 3 baseline samples, these rankings are noisy."

## Honest Uncertainty Methodology

For each crew × site, the three pre-flight swabs (L-92, L-44, L-3) form that person's personal baseline distribution.

1. Compute Bray-Curtis distance between each non-baseline timepoint's relative abundance vector and the *mean* of the baseline samples → score `d`.
2. Bootstrap the baseline (resample with replacement, recompute mean, recompute distance) → 95% CI on `d`.
3. Compute the within-baseline distance distribution (pairwise distances among the three baseline swabs).
4. If the post-flight `d` falls inside the within-baseline distribution, set `within_baseline_noise = true`. The frontend then displays "within baseline noise" rather than implying recovery or signal.

A persistent honesty strip at the top of the page reads:

> *4 crew members, 3 pre-flight baseline swabs per site, no in-flight CBC. Treat all numbers as descriptive of these four people, not predictive.*

It cannot be dismissed.

## CBC Integration

CBC plots stay as the existing README described: per-crew trajectories L-92 → R+194 with bootstrap bands and clinical reference ranges. Layout: CBC panel sits above the 2×2 avatar grid. Clicking a crew's avatar filters the CBC panel to that crew. The page header anchors on the original "Recovery, Honestly" question; the avatar answers the second half: *"and where on me?"*

## Repository Structure

```
data/                       # raw and processed data files (gitignored where large)
notebooks/                  # exploratory Jupyter/Colab notebooks
analysis/
  microbiome_pipeline.py    # OSD-572 → microbiome.json
  cbc_pipeline.py           # OSD-569 → cbc.json
  shared/
    sample_parser.py        # parse "C001_oral_FD2" → (crew, site, timepoint)
    bootstrap.py            # shared bootstrap utilities
dashboard/
  index.html
  app.js                    # slider, click-handlers, color interpolation
  body.svg                  # 10-region template
  styles.css
  data/
    microbiome.json
    cbc.json
    fixture-microbiome.json # fake data, committed hour 1, frontend dev
    fixture-cbc.json        # fake data, committed hour 1, frontend dev
docs/
  superpowers/specs/        # this design doc and any future specs
```

## Team Split (~56 hours remaining at spec time)

- **Mollie (design)** — `body.svg` template with 10 named region paths; color scale and legend; layout polish; copy for the honesty strip and the drill-down caveats.
- **Thomas (CS + stats)** — `microbiome_pipeline.py`: sample-name parser, baseline distance, bootstrap, top-taxa drill-down, JSON export. Owns `microbiome.json` schema.
- **Earl (CS + stats)** — `cbc_pipeline.py` and frontend integration in `dashboard/index.html` + `app.js`: slider drives all four SVGs, click opens drill-down, page wires both JSONs together.

**Hour-1 coordination task:** all three agree on the JSON schemas above and commit hand-authored `fixture-*.json` files. Frontend and analysis then work in parallel against the contract.

## MVP Scope and Explicit Cuts

**In scope (must ship):**

- Per-crew Bray-Curtis disturbance scores from OSD-572 *taxa* file with bootstrap CIs.
- 2×2 SVG avatar grid with synced timepoint slider.
- Click-to-drill-down panel showing top taxa up/down at the selected site/timepoint.
- Per-crew CBC trajectories from OSD-569 with bootstrap bands and reference ranges.
- Persistent honesty strip and "within baseline noise" handling.

**Explicitly cut:**

- KEGG, pathway, and gene-family files from OSD-572 (taxa file only).
- Bulk RNA-seq from OSD-569 (heavyweight bioinformatics, dilutes the Track-3 narrative under n=4).
- Cytokines, metabolomics, single-cell, EVPs.
- Multi-metric distance toggles (Bray-Curtis only; document it).
- Claim-check view (3–5 paper claims fact-checked) — interesting but separate workstream; revisit only if MVP locks well before deadline.
- Clinical recommendations of any kind.

## Acknowledged Limitations

- **n=4** makes any group-level claim fragile; every plot states this.
- **No in-flight CBC** — the trajectory has a deliberate gap between L-3 and R+1; never interpolate across it.
- **Only 3 pre-flight baseline swabs per site** — bootstrap CIs reflect this; the drill-down explicitly notes that taxa rankings are noisy.
- **Crew identifiers are randomized** — C001…C004 do not correspond to the public mission roster order.
- **No clinical recommendations** — observations only, with explicit uncertainty.

## Use of AI

For literature synthesis, code scaffolding, drafting astronaut-facing copy, and SVG region path cleanup. **Not** for inventing statistical claims, generating analyses we don't fully understand, or fabricating taxa rankings.

## Success Criterion

A non-geneticist astronaut can:

1. Open the dashboard and read their CBC recovery story top-to-bottom.
2. See at a glance which body sites had the largest microbial shift, and at which timepoint.
3. Click any red region and see which organisms drove that shift, with the CI and noise caveats clearly displayed.
4. Walk away with **calibrated confidence — not false certainty.**
