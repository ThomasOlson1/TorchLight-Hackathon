"""Generate dashboard/data/microbiome.json from OSD-572 taxonomy data.

Pipeline:

  1. Fetch the OSD-572 combined-taxonomy CPM table (rows = taxa, cols = samples).
  2. Parse each sample column into (crew, site, timepoint), dropping
     blanks and unknown abbreviations.
  3. Convert each sample column to relative abundance.
  4. For each crew x site, take the pre-flight (L-92, L-44, L-3) samples
     as that person's personal baseline.
  5. For each non-baseline timepoint at that site, compute Bray-Curtis
     distance from the baseline mean, with a bootstrap 95% CI by
     resampling baseline rows.
  6. Flag within_baseline_noise when the distance is at or below the
     maximum pairwise distance among the baseline samples themselves.
  7. For the drilldown, identify the top-5 species that increased and
     decreased vs the baseline mean (by absolute change in relative
     abundance). Aggregated to species when the source row has a species
     name; rows without a species name are skipped from the drilldown
     (they still contribute to the distance score).
  8. Emit dashboard/data/microbiome.json matching the locked schema.

Run:  python3 -m analysis.microbiome_pipeline   (from the repo root)
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial.distance import braycurtis

# Allow `python3 analysis/microbiome_pipeline.py` from the repo root by adding
# the parent dir to sys.path. (Running with -m as `python3 -m
# analysis.microbiome_pipeline` already handles this.)
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.shared.bootstrap import bootstrap_distance_ci  # noqa: E402
from analysis.shared.sample_parser import (  # noqa: E402
    BASELINE_TIMEPOINTS,
    MICROBIOME_TIMEPOINTS,
    SITES,
    parse_microbiome_sample,
)

TAXA_URL = (
    "https://osdr.nasa.gov/geode-py/ws/studies/OSD-572/download"
    "?source=datamanager"
    "&file=GLDS-564_GMetagenomics_Combined-gene-level-taxonomy-coverages-CPM_GLmetagenomics.tsv"
)
RAW_LOCAL = REPO_ROOT / "data" / "raw" / "osd-572-taxa.tsv"
OUT_PATH = REPO_ROOT / "dashboard" / "data" / "microbiome.json"

# Drilldown size — top N taxa per direction, per (crew, site, timepoint).
DRILLDOWN_TOP_K = 5

# Bootstrap iterations. 1000 is enough for a stable 95% CI at this scale.
N_BOOT = 1000


def to_relative_abundance(col: pd.Series) -> np.ndarray:
    total = col.sum()
    if total <= 0:
        return np.zeros(len(col), dtype=float)
    return (col / total).values.astype(float)


def species_index_map(taxa_df: pd.DataFrame) -> dict[int, str]:
    """Map row position -> species name. Rows without a species are excluded.

    OSD-572 rows are at gene-level inside taxa, so several rows can share a
    species. We aggregate later in compute_drilldown.
    """
    if "species" not in taxa_df.columns:
        return {}
    species = taxa_df["species"].astype(str)
    return {i: s for i, s in enumerate(species) if s and s.lower() != "nan"}


def aggregate_by_species(
    abundance_vec: np.ndarray, species_for_row: dict[int, str]
) -> dict[str, float]:
    """Sum row-level relative abundance into species-level totals."""
    out: dict[str, float] = defaultdict(float)
    for row_idx, sp in species_for_row.items():
        if row_idx < len(abundance_vec):
            out[sp] += float(abundance_vec[row_idx])
    return dict(out)


def top_taxa_changes(
    target_sp: dict[str, float],
    baseline_sp: dict[str, float],
    k: int = DRILLDOWN_TOP_K,
) -> tuple[list[dict], list[dict]]:
    """Return (top_increased, top_decreased) species lists vs baseline."""
    species = set(target_sp.keys()) | set(baseline_sp.keys())
    deltas = [(sp, target_sp.get(sp, 0.0) - baseline_sp.get(sp, 0.0)) for sp in species]
    ups = sorted([(s, d) for s, d in deltas if d > 0], key=lambda x: -x[1])[:k]
    downs = sorted([(s, d) for s, d in deltas if d < 0], key=lambda x: x[1])[:k]
    return (
        [{"name": s, "delta": round(float(d), 4)} for s, d in ups],
        [{"name": s, "delta": round(float(d), 4)} for s, d in downs],
    )


def within_baseline_max_distance(baseline_matrix: np.ndarray) -> float:
    """Max pairwise Bray-Curtis distance among baseline rows."""
    n = len(baseline_matrix)
    if n < 2:
        return 0.0
    max_d = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            d = braycurtis(baseline_matrix[i], baseline_matrix[j])
            if d > max_d:
                max_d = d
    return float(max_d)


def fetch_taxa() -> pd.DataFrame:
    """Read the local cached TSV if present, else download with curl."""
    if not RAW_LOCAL.exists():
        import subprocess
        RAW_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {RAW_LOCAL.name} from OSDR...", flush=True)
        subprocess.run(["curl", "-sLf", "-o", str(RAW_LOCAL), TAXA_URL], check=True)
    return pd.read_csv(RAW_LOCAL, index_col=0, sep="\t")


def main() -> None:
    print("Loading OSD-572 taxa...", flush=True)
    taxa = fetch_taxa()
    print(f"  loaded shape: {taxa.shape} (rows = taxa, cols = metadata + samples)")

    # Identify metadata columns vs sample columns.
    metadata_cols = [c for c in ("domain", "phylum", "class", "order", "family", "genus", "species")
                     if c in taxa.columns]
    sample_cols = [c for c in taxa.columns if c not in metadata_cols]
    print(f"  metadata cols: {metadata_cols}")
    print(f"  candidate sample cols: {len(sample_cols)}")

    # Parse each sample column.
    parsed: dict[str, object] = {}  # col_name -> MicrobiomeSample
    skipped_unparsed = []
    for c in sample_cols:
        sid = parse_microbiome_sample(c)
        if sid is None:
            skipped_unparsed.append(c)
        else:
            parsed[c] = sid

    print(f"  parsed: {len(parsed)} samples; skipped: {len(skipped_unparsed)}")
    if skipped_unparsed:
        # Print the unique site abbrs we dropped, so it's auditable.
        suffixes = sorted({c.rsplit("_", 1)[-1] for c in skipped_unparsed})
        print(f"  (dropped trailing tokens: {suffixes})")

    # Build a per-(crew, site) map of timepoint -> relative-abundance vector.
    # Also keep a species-aggregated version for the drilldown.
    species_for_row = species_index_map(taxa)
    print(f"  species-named rows: {len(species_for_row)} / {len(taxa)}")

    crew_site_tp_to_vec: dict[tuple[str, str, str], np.ndarray] = {}
    crew_site_tp_to_species: dict[tuple[str, str, str], dict[str, float]] = {}
    for col, sid in parsed.items():
        sample_col_values = taxa[col].fillna(0)
        rel = to_relative_abundance(sample_col_values)
        crew_site_tp_to_vec[(sid.crew, sid.site, sid.timepoint)] = rel  # type: ignore[attr-defined]
        crew_site_tp_to_species[(sid.crew, sid.site, sid.timepoint)] = aggregate_by_species(rel, species_for_row)  # type: ignore[attr-defined]

    # Compute scores + drilldown.
    rng = np.random.default_rng(0)
    scores: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))
    drilldown: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))

    crews_seen = sorted({sid.crew for sid in parsed.values()})  # type: ignore[attr-defined]

    for crew in crews_seen:
        for site in SITES:
            baseline_vecs = [
                crew_site_tp_to_vec[(crew, site, tp)]
                for tp in BASELINE_TIMEPOINTS
                if (crew, site, tp) in crew_site_tp_to_vec
            ]
            baseline_species_dicts = [
                crew_site_tp_to_species[(crew, site, tp)]
                for tp in BASELINE_TIMEPOINTS
                if (crew, site, tp) in crew_site_tp_to_species
            ]
            if not baseline_vecs:
                continue  # no baseline at this crew/site -> can't score this site

            baseline_matrix = np.vstack(baseline_vecs)
            n_baseline = baseline_matrix.shape[0]
            within_max = within_baseline_max_distance(baseline_matrix)
            # Aggregate baseline species means.
            baseline_species_mean: dict[str, float] = defaultdict(float)
            for d in baseline_species_dicts:
                for sp, v in d.items():
                    baseline_species_mean[sp] += v / len(baseline_species_dicts)

            for tp in MICROBIOME_TIMEPOINTS:
                if tp in BASELINE_TIMEPOINTS:
                    continue
                key = (crew, site, tp)
                if key not in crew_site_tp_to_vec:
                    continue  # no swab at this timepoint -> render as "no data" on the avatar
                target_vec = crew_site_tp_to_vec[key]

                d, lo, hi = bootstrap_distance_ci(
                    baseline_matrix=baseline_matrix,
                    target_vec=target_vec,
                    distance_fn=lambda a, b: float(braycurtis(a, b)),
                    n_boot=N_BOOT,
                    rng=rng,
                )
                within_noise = bool(d <= within_max) if n_baseline >= 2 else False

                scores[crew][site][tp] = {
                    "d": round(d, 4),
                    "ci_lo": round(lo, 4),
                    "ci_hi": round(hi, 4),
                    "n_baseline": n_baseline,
                    "within_baseline_noise": within_noise,
                }

                # Drilldown
                target_species = crew_site_tp_to_species[key]
                ups, downs = top_taxa_changes(target_species, dict(baseline_species_mean))
                drilldown[crew][site][tp] = {
                    "top_taxa_up": ups,
                    "top_taxa_down": downs,
                }

    payload = {
        "crew": crews_seen,
        "sites": SITES,
        "timepoints": MICROBIOME_TIMEPOINTS,
        "baseline_timepoints": BASELINE_TIMEPOINTS,
        "scores": {k: dict(v) for k, v in scores.items()},
        "drilldown": {k: dict(v) for k, v in drilldown.items()},
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    # Diagnostics
    n_score_cells = sum(
        1 for c in scores.values() for s in c.values() for _ in s.values()
    )
    n_drill_cells = sum(
        1 for c in drilldown.values() for s in c.values() for _ in s.values()
    )
    print()
    print(f"Wrote {OUT_PATH}")
    print(f"  crew: {crews_seen}")
    print(f"  sites: {len(SITES)} (any with no baseline omitted from scores)")
    print(f"  score cells: {n_score_cells}")
    print(f"  drilldown cells: {n_drill_cells}")


if __name__ == "__main__":
    main()
