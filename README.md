# Recovery, Honestly

> An astronaut-facing dashboard for the SpaceX Inspiration 4 mission.
> CBC bloodwork trajectories and a body-mapped microbiome view, both wrapped in calibrated uncertainty.

**Track 3 — Communication & Visualization**
**2026 Torchlight Sovereignty Hackathon · The University of Austin**

Team: Earl, Thomas, Mollie. Built with substantial AI scaffolding (see [Use of AI](#use-of-ai)).

---

## The astronaut's question

> *"Am I back to baseline — and where on me did things shift?"*

Most research about astronaut health is written for scientists, not astronauts. A returning crew member wants to know whether their bloodwork has recovered, when that recovery happened, and how much they should trust the answer when only four people have similar data. They also want to know — at a glance — *where on their body* something changed.

This dashboard answers both questions:

- **CBC panel (breadth).** Per-crew-member bloodwork plotted from L-92 through R+194 with bootstrap CIs and clinical reference ranges. The familiar bloodwork an astronaut already understands.
- **Body avatar grid (depth).** A 2×2 grid of front+back human silhouettes — one per crew member — colored by how far that body site's microbial community has shifted from the same person's pre-flight baseline. A timepoint slider drives all four avatars in sync. Click any region to see which organisms drove the shift, with curated literature-flagged opportunists (⚠) and beneficial commensals (✓) annotated where applicable.

Both views share an undismissible honesty strip stating: *"4 crew members. 3 pre-flight baseline swabs per body site. No in-flight CBC. Treat all numbers as descriptive of these four people, not predictive."*

## How to view

```bash
git clone https://github.com/ThomasOlson1/TorchLight-Hackathon.git
cd TorchLight-Hackathon/dashboard
python3 -m http.server 8000
```

Then open <http://localhost:8000>. No build step.

## What you'll see

- A persistent yellow honesty strip at the top.
- 4 small CBC plots (WBC, RBC, hemoglobin, hematocrit, platelets, MCV), one trace per crew member, with green-tinted reference range bands and a visible gap labeled "Flight (no CBC)" between L-3 and R+1.
- A timepoint slider; below it, four crew avatars (front + back silhouettes side-by-side). Drag the slider to watch microbial state evolve from pre-flight through return-to-Earth recovery.
- Hover any colored region for the score, 95% CI, and "within baseline noise" tag. Click for the drilldown showing top taxa increased / decreased vs that person's baseline, with ⚠ / ✓ badges on species the literature flags as opportunists or beneficials.
- A bottom panel of explicit interpretation guidance: what color means, what "within baseline noise" means, and what a non-clinician should and should not take from the page.

## Honest finding from the real data

> **159 of 197 microbiome score cells (~81%) fall within each crew member's own pre-flight noise floor.**

The data itself says we cannot statistically distinguish most post-flight microbial shifts from each person's pre-existing ground-side variability. Personal microbiomes shift substantially even between L-92, L-44, and L-3 — and post-flight points often don't exceed that pre-existing personal range.

This is not a defect of the data; it's a Track-3-relevant finding. Loud claims about "spaceflight changes the microbiome" need to grapple with how much each individual's microbiome already varies day-to-day and site-to-site, *especially* with n=4 crew members.

We surface this directly in the dashboard rather than burying it.

## Methodology

### Microbiome (OSD-572)

- Source: `GLDS-564_GMetagenomics_Combined-gene-level-taxonomy-coverages-CPM_GLmetagenomics.tsv` from NASA OSDR.
- 327 candidate sample columns parsed; 314 valid (13 dropped — water blanks `H20` and one anomalous `OAC`).
- For each crew × site, the three pre-flight swabs (L-92, L-44, L-3) form that person's personal baseline distribution. Each non-baseline timepoint's relative-abundance vector is compared against the **mean** baseline vector via **Bray–Curtis distance**.
- 95% CI on the distance comes from a **bootstrap of the baseline samples** (resample with replacement, recompute the mean, recompute the distance — 1000 iterations).
- A score is flagged `within_baseline_noise = true` if its distance is at or below the maximum pairwise Bray-Curtis distance among the same crew × site's baseline samples themselves.
- Top-5 species increases / decreases vs baseline are aggregated row-by-row at species level for the drilldown.
- Code: [analysis/microbiome_pipeline.py](analysis/microbiome_pipeline.py), [analysis/shared/sample_parser.py](analysis/shared/sample_parser.py), [analysis/shared/bootstrap.py](analysis/shared/bootstrap.py).

### CBC (OSD-569)

- Source: `LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv` from NASA OSDR.
- Six standard CBC analytes: WBC, RBC, hemoglobin, hematocrit, platelets, MCV.
- Per crew × analyte, the trajectory band is set by a **bootstrap CI on each crew's pre-flight values** — so the band communicates uncertainty about *the personal anchor*, not population variance.
- Reference ranges read directly from the source file's `RANGE_MIN` / `RANGE_MAX` columns rather than hardcoded.
- The L-3 → R+1 gap is preserved as a labeled break in the line; we never interpolate across the in-flight period.
- Code: [analysis/cbc_pipeline.py](analysis/cbc_pipeline.py).

### Curated annotation lists

Two small, citation-bearing JSON files under `dashboard/data/` flag specific species in the drilldown:

- [`opportunists.json`](dashboard/data/opportunists.json) — ~21 species with literature-supported pathogenic potential.
- [`beneficials.json`](dashboard/data/beneficials.json) — ~16 commensals with literature-supported protective effects.

Each entry has a one-line clinical note and a citation. Lists are **conservative**; absence of a badge doesn't mean a species is harmless or harmful — only that we didn't have an evidence-based note to attach.

In the drilldown:
- ⚠ caution: opportunist rising **or** beneficial falling
- ✓ favorable: beneficial rising **or** opportunist falling

## Acknowledged limitations

- **n = 4** makes any group-level claim fragile. Every plot communicates this via per-crew (not pooled) trajectories and the persistent honesty strip.
- **3 pre-flight baseline swabs per site** — bootstrap CIs are honest about the resulting wide bands. The drilldown explicitly notes that taxa rankings are noisy.
- **No in-flight CBC** — the trajectory has a deliberate, labeled gap between L-3 and R+1; we do not interpolate.
- **Crew identifiers are randomized** — C001 … C004 do not correspond to the public mission roster order.
- **Color = "shifted," not "dangerous."** Bray–Curtis distance is direction-blind; a beneficial shift looks identical to a harmful one in the avatar color. Direction comes from the curated drilldown badges.
- **No clinical recommendations.** This is a research-data viewer, not a medical tool.

## Repository structure

```
analysis/
  shared/
    sample_parser.py      # OSD-572 sample-name canonicalization
    bootstrap.py          # bootstrap_ci, bootstrap_distance_ci
  microbiome_pipeline.py  # OSD-572 -> dashboard/data/microbiome.json
  cbc_pipeline.py         # OSD-569 -> dashboard/data/cbc.json
dashboard/
  index.html              # static page
  app.js                  # vanilla JS: SVG paint + slider + drilldown + Plotly CBC
  body.svg                # 2-figure (front + back) human silhouette, 10 region paths
  styles.css              # layout + sequential color scale + honesty strip + badges
  data/
    microbiome.json       # generated by analysis/microbiome_pipeline.py
    cbc.json              # generated by analysis/cbc_pipeline.py
    opportunists.json     # curated literature-flagged opportunist list
    beneficials.json      # curated literature-flagged beneficial list
    fixture-*.json        # frozen fixtures used during parallel frontend dev
data/raw/                 # gitignored - pipelines fetch on first run
docs/superpowers/
  specs/                  # design spec
  plans/                  # implementation plan
notebooks/                # exploratory notebooks (Earl's CBC exploration)
```

## Reproducing the data

```bash
# From the repo root, with pandas, numpy, scipy installed:
python3 -m analysis.microbiome_pipeline   # writes dashboard/data/microbiome.json
python3 -m analysis.cbc_pipeline          # writes dashboard/data/cbc.json
```

Each pipeline downloads the OSDR file on first run (cached to `data/raw/`).
Bootstrap RNGs are seeded; output is reproducible across runs.

## Use of AI

This project was built with substantial use of an AI coding assistant (Claude Opus 4.7), under explicit team direction:

- **Human authorship:** Project goal, scope decisions, what to cut (RNA-seq, KEGG/pathway/gene-family files, claim-check view), the choice of "color = shifted, not dangerous" framing, the decision to add the bidirectional opportunist/beneficial annotation, the curated species lists' editorial direction, exploratory CBC notebook (Earl).
- **AI scaffolding:** Frontend implementation (HTML/CSS/JS/SVG), data pipeline structure, fixture data, color interpolation, the bootstrap-CI utilities, JSON schema, README first draft.
- **Citation practice:** All literature citations in `opportunists.json` and `beneficials.json` reference real, verifiable papers. All methodological choices (Bray-Curtis, bootstrap CI from baseline, within-baseline-noise threshold) are documented and defensible.

We deliberately surface *honest* findings — including the unflattering result that 81% of microbiome shifts cannot be statistically distinguished from each crew member's own ground-side variability — rather than overselling.

## Data attribution

- [OSD-572](https://osdr.nasa.gov/bio/repo/data/studies/OSD-572) — Inspiration 4 oral, nasal, and skin metagenomic microbial swabs.
- [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) — Inspiration 4 whole blood profiling (CBC sub-panel).

Data made publicly available through NASA's Open Science Data Repository.
