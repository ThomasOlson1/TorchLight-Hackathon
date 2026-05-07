# Recovery, Honestly

**Track 3 — Communication & Visualization** (with rigorous uncertainty quantification)

## The Astronaut's Question

*"Am I back to baseline — and how confident should I be?"*

Most research about astronaut health is written for scientists, not astronauts. A returning crew member wants to know whether their bloodwork has recovered, when that recovery happened, and how much they should trust the answer when only four people have similar data.

## What We're Building

A per-crew-member **recovery dashboard** for the Inspiration 4 mission, built on **Complete Blood Count (CBC)** data — the same kind of bloodwork an astronaut already gets at every doctor's visit. We plot each crew member's CBC values from **L-92 through R+194** with statistically honest uncertainty bands. Layered on top: a **claim-check** view that fact-checks specific published I4 findings against the data — showing where the science is solid and where n=4 makes a claim more fragile than it sounds.

The differentiator isn't the visualization. It's the honesty layer. We don't oversell. Every claim is wrapped in explicit uncertainty.

## Why CBC

CBC is the right anchor for Track 3 because it is:

- **Familiar** — every astronaut recognizes it from a routine doctor's visit (white blood cells, red blood cells, hemoglobin, platelets, etc.). No genetics literacy required.
- **Longitudinal** — CBC is the only Inspiration 4 measurement collected at *every* ground time point: L-92, L-44, L-3, R+1, R+45, R+82, R+194. That's 7 points spanning 286 days, the richest recovery curve in the entire dataset.
- **Per-crew-member** — each crew member has their own values at each time point (not averaged), so we can build a true individualized recovery story.
- **Bounded in complexity** — ~15-20 standard metrics with established clinical reference ranges, which lets our team spend time on *rigorous statistics* rather than fighting bioinformatics complexity.

## Approach

1. **Trajectory layer** — for each CBC metric, plot per-crew-member values across L-92 → R+194 with bootstrap confidence intervals. Mark established clinical reference ranges where they exist.
2. **Uncertainty layer** — every plot annotated with what we can and cannot say given n=4, individual baseline variation, and the specific time points available. No false precision. We will explicitly flag when an apparent "recovery" is within the noise floor.
3. **Claim-check layer** — for 5–10 specific findings from published I4 papers, present: *the paper's claim → the underlying CBC evidence → an honest reinterpretation given the data's limits.*

## Primary Data

**OSD-569 — Whole Blood Profiling** from NASA's Open Science Data Repository. We use the **Complete Blood Count (CBC)** sub-dataset specifically. Other layers in OSD-569 (total RNA-seq, m6A modification) and supplementary datasets like OSD-575 (serum cytokines) may be added if scope allows — but the rigorous CBC analysis is the core deliverable.

## Why Track 3 Fits Our Team

Three of us are strong in math/stats; one is a designer. Track 3 explicitly rewards honest communication of uncertainty — exactly where rigorous statistics outperform teams that hand-wave the small-N problem. CBC's tractable feature space lets us spend our time *modeling uncertainty correctly* rather than wrestling with bioinformatics pipelines.

## Acknowledged Limitations

- **n=4** makes most population-level claims fragile; we will say so on every plot.
- **No in-flight CBC data exists** — blood collection during flight was limited. Our trajectory has a deliberate gap between L-3 and R+1, and we will not interpolate across it.
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
