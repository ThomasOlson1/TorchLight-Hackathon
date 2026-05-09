# Design Philosophy

**Recovery, Honestly — Track 3, 2026 Torchlight Sovereignty Hackathon**

## Core thesis

The dashboard's job is to give each astronaut a **sensible, individualized read on what happened to their body during the mission and whether they're back to baseline yet**. Every design and analytical decision falls out of that.

Existing space-omics communication tends to flatten four people into one population graph and report "spaceflight does X." A returning crew member can't use that. They want to know what *their* numbers did, when *they* recovered, and which systems are still off. The whole dashboard is structured around answering exactly that question for one astronaut at a time.

## What that drives, decision by decision

### Each crew is its own story
The hero panel is a 4-tab character-select widget — one tab per anonymized crew member (C001 – C004). Picking a tab swaps the entire view: a different giant rotating astronaut, a different stats column, a different overall recovery summary. There is no global "average" view by default; pooling four people obscures the per-individual recovery story we are trying to tell.

### Baseline is personal, not normative
For every metric — microbiome distance, CBC trajectory, CMP analyte, cytokine — the comparison is against the **same astronaut's** three pre-flight draws (L-92, L-44, L-3). We never compare a crew member to a population reference range as if it were ground truth. Pre-flight clinical reference ranges are shown for context where they exist, but the load-bearing question is always *"vs. your own baseline."*

### Uncertainty is computed, not asserted
Wherever we report a deviation from baseline, the uncertainty band comes from a 1000-iteration bootstrap of the same crew's pre-flight values. The width of the band is proportional to how much that astronaut's own ground-side variability is. When a post-flight reading falls inside that band we say so explicitly: *"within your pre-flight noise."* That phrase is doing real work — it tells the reader we cannot tell the difference between a real shift and the person's own day-to-day variation. With n=4 and three baseline draws per site, that honest equivalence shows up often.

### "Back to baseline?" is the spine of the stats column
The right side of the hero is organized as four collapsible system tiles (Hematology, Kidneys + liver + metabolism, Immune, Cardiovascular). Each tile leads with a one-line answer to the central question — `back to baseline`, `still elevated`, `still below baseline`, `mixed shifts` — followed by the recovery checkpoints (R+1, R+45, R+82). Click any tile to expand the per-checkpoint trajectory plus the fine-grained sub-system findings (white-cell line, red-cell line, platelets, etc.) that roll up into that headline. Headline first, evidence on demand.

### Color = "shifted," not "dangerous"
On the astronaut model, hotspot color encodes Bray-Curtis distance from baseline — *how much* a body site moved, not whether the move is good or bad. The Bray-Curtis distance is direction-blind by design; a bloom of beneficial commensals is mathematically indistinguishable from a bloom of opportunists. Direction comes from a separate signal: a curated, citation-bearing list of literature-flagged opportunists and beneficials. In the drilldown, taxa rising are tagged ⚠ if they are on the opportunist list (a shift that *may* matter) and ✓ if they are on the beneficial list (a shift that *may* be favorable). Decreases get the opposite tags. Both lists are conservative; absence of a badge is not a clean bill of health.

### Spatial, anatomical microbiome
The microbiome data is per body site — oral, nasal, axillary, forearm, and so on across ten sites — so the data wants to be presented spatially. Hotspot spheres on a 3D astronaut model let an astronaut see *where* on their body a shift happened at a glance, then click for the per-site Bray-Curtis distance, top taxa up and down, and any concern badges. The model spins by default to assure the reader that all ten sites really are visible (front of face, back of helmet, lower back, boot top); the spin pauses while you hover so the click target sits still.

### Time is not a slider afterthought
The timeline strip below the hero shows discrete clickable checkpoints — L-92, L-44, L-3, FD2, FD3, R+1, R+45, R+82 — instead of a continuous slider alone. The pre-flight points let an astronaut see how much their microbiome was already drifting *before* launch, which is essential context when interpreting how big the post-flight numbers actually are.

### A finding worth surfacing
The pipeline computes that **159 of 197 microbiome score cells (~81%) fall within each crew member's own pre-flight noise floor**. The dashboard surfaces this directly rather than burying it. An honest dashboard for four astronauts has to admit when the math says we cannot statistically distinguish post-flight shifts from each person's pre-existing day-to-day variability. That admission is the project's point of view.

## Visual style

The visual treatment is dark to put attention on the rotating astronaut and the per-crew accent color, with a single mission-orange accent thread that runs through the active tab, the active timepoint mark, and the drilldown panel's score badge. Mono type (JetBrains Mono) for telemetry-style values (crew IDs, percentages, timepoints), Space Grotesk for headlines, Inter for body — the same hierarchy a flight surgeon's tablet might use. HUD-style angular corner cuts on the panels and selected tabs nod at the videogame character-select reference; the page is meant to feel like a place an astronaut would actually want to open, not a generic data viz.
