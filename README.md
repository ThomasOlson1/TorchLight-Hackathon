# Recovery, Honestly

**Track 3 — Communication & Visualization** (with rigorous uncertainty quantification)

## The Astronaut's Question

*"Am I back to baseline — and how confident should I be?"*

Most research about astronaut health is written for scientists, not astronauts. A returning crew member wants to know whether their immune system has recovered, when that recovery happened, and how much they should trust the answer when only four people have similar data.

## What We're Building

A per-crew-member **recovery dashboard** for the Inspiration 4 mission that plots PBMC (immune cell) gene expression trajectories from L-92 through R+194, with statistically honest uncertainty bands. Layered on top: a **claim-check** view that fact-checks specific published I4 findings against the data — showing where the science is solid and where n=4 makes a claim more fragile than it sounds.

The differentiator isn't the visualization. It's the honesty layer. We don't oversell. Every claim is wrapped in explicit uncertainty.

## Approach

1. **Trajectory layer** — for selected immune-related genes and pathways, plot per-crew-member expression across L-92 → FD1-3 → R+1, +45, +82, +194, with bootstrap confidence intervals.
2. **Uncertainty layer** — every plot annotated with what we can and cannot say given n=4 and the specific time points available. No false precision.
3. **Claim-check layer** — for 5–10 specific findings from published I4 papers, present: *the paper's claim → the underlying evidence → an honest reinterpretation given the data's limits.*

## Primary Data

**OSD-570 (PBMC transcriptomics)** from NASA's Open Science Data Repository. Selected because it has crew-specific data (not group-averaged), the richest published literature to fact-check, and an intuitive immune-system framing for non-geneticists. CBC/CMP added as a familiar secondary layer if scope allows.

## Why Track 3 Fits Our Team

Three of us are strong in math/stats; one is a designer. Track 3 explicitly rewards honest communication of uncertainty — exactly where rigorous statistics outperform teams that hand-wave the small-N problem.

## Acknowledged Limitations

- **n=4** makes most population-level claims fragile; we will say so on every plot.
- Time points differ across data types; not every measurement exists at every time point.
- Individual baselines vary substantially; group summaries can mislead.
- We make **no clinical recommendations** — only observations with explicit uncertainty.

## Use of AI

For literature synthesis (extracting claims from I4 papers), code scaffolding, and drafting astronaut-facing copy. **Not** for inventing statistical claims or generating analyses we don't fully understand.

## Success Criterion

A non-geneticist astronaut can open the dashboard, understand their personal recovery story, see clearly where the data is strong and where it isn't, and walk away with **calibrated confidence — not false certainty.**

## Repository Structure

```
data/         # raw and processed data files
notebooks/    # exploratory Jupyter/Colab notebooks
analysis/     # statistical analysis scripts
dashboard/    # final astronaut-facing dashboard
docs/         # design notes, paper claim extractions
```

## Team

Earl, Thomas, and Mollie (CS × 2, design × 1; math/stats across all).
