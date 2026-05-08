"""Generate dashboard/data/cbc.json from OSD-569 Complete Blood Count data.

Pipeline:

  1. Load the OSD-569 CBC long-form CSV. Each row is a single (analyte, value)
     measurement at a (subject, timepoint) with reference range bounds and
     units already attached.
  2. Restrict to a curated set of analytes (the bloodwork most commonly
     interpreted in clinical/aerospace contexts).
  3. Per crew x analyte: collect values at every timepoint. Compute a
     bootstrap CI from the per-crew pre-flight values to anchor the
     trajectory uncertainty band on each crew's own baseline variability.
  4. Reference range comes from the data file (RANGE_MIN, RANGE_MAX); we
     take the modal value per analyte since it is essentially constant.
  5. Emit dashboard/data/cbc.json matching the locked schema.

Run:  python3 -m analysis.cbc_pipeline   (from the repo root)
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from analysis.shared.bootstrap import bootstrap_ci  # noqa: E402
from analysis.shared.sample_parser import (  # noqa: E402
    BASELINE_TIMEPOINTS,
    CBC_TIMEPOINTS,
    VALID_CREW,
)

CBC_URL = (
    "https://osdr.nasa.gov/geode-py/ws/studies/OSD-569/download"
    "?source=datamanager"
    "&file=LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv"
)
RAW_LOCAL = REPO_ROOT / "data" / "raw" / "osd-569-cbc.csv"
OUT_PATH = REPO_ROOT / "dashboard" / "data" / "cbc.json"

# Curated analyte set: 6 standard CBC measures that any astronaut would
# recognize from a routine doctor's visit. The labels are short for plot titles.
# Keys here are the slugs we use in cbc.json; the value is the exact ANALYTE
# string in the source CSV plus a display label.
ANALYTE_SPEC = [
    {"key": "wbc",        "analyte": "WHITE BLOOD CELL COUNT", "label": "White blood cell count"},
    {"key": "rbc",        "analyte": "RED BLOOD CELL COUNT",   "label": "Red blood cell count"},
    {"key": "hemoglobin", "analyte": "HEMOGLOBIN",             "label": "Hemoglobin"},
    {"key": "hematocrit", "analyte": "HEMATOCRIT",             "label": "Hematocrit"},
    {"key": "platelets",  "analyte": "PLATELET COUNT",         "label": "Platelet count"},
    {"key": "mcv",        "analyte": "MCV",                    "label": "Mean corpuscular volume"},
]

N_BOOT = 1000


def fetch_cbc() -> pd.DataFrame:
    if not RAW_LOCAL.exists():
        import subprocess
        RAW_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {RAW_LOCAL.name} from OSDR...", flush=True)
        subprocess.run(["curl", "-sLf", "-o", str(RAW_LOCAL), CBC_URL], check=True)
    # First column is the ANALYTE label - keep it as a real column, not the index.
    return pd.read_csv(RAW_LOCAL)


def main() -> None:
    print("Loading OSD-569 CBC...", flush=True)
    cbc = fetch_cbc()
    print(f"  loaded shape: {cbc.shape}")
    print(f"  columns: {list(cbc.columns)}")
    print(f"  unique analytes: {cbc['ANALYTE'].nunique()}")
    print(f"  unique subjects: {sorted(cbc['SUBJECT_ID'].unique())}")
    print(f"  unique timepoints: {sorted(cbc['TEST_DATE'].unique())}")

    # Coerce types
    cbc["VALUE"] = pd.to_numeric(cbc["VALUE"], errors="coerce")
    cbc["RANGE_MIN"] = pd.to_numeric(cbc["RANGE_MIN"], errors="coerce")
    cbc["RANGE_MAX"] = pd.to_numeric(cbc["RANGE_MAX"], errors="coerce")

    # Filter to the curated analytes and the 4 known crew + 7 known timepoints.
    spec_by_key = {s["key"]: s for s in ANALYTE_SPEC}
    wanted_analytes = {s["analyte"] for s in ANALYTE_SPEC}
    cbc = cbc[cbc["ANALYTE"].isin(wanted_analytes)]
    cbc = cbc[cbc["SUBJECT_ID"].isin(VALID_CREW)]
    cbc = cbc[cbc["TEST_DATE"].isin(CBC_TIMEPOINTS)]
    print(f"  filtered shape: {cbc.shape}")

    # Build payload
    metrics: dict[str, dict] = {}
    rng = np.random.default_rng(0)

    for spec in ANALYTE_SPEC:
        key = spec["key"]
        subset = cbc[cbc["ANALYTE"] == spec["analyte"]]
        if subset.empty:
            print(f"  WARN: no rows for analyte {spec['analyte']!r}, skipping")
            continue

        # Reference range (take mode; fall back to first non-null pair)
        ref_lo_series = subset["RANGE_MIN"].dropna()
        ref_hi_series = subset["RANGE_MAX"].dropna()
        ref_lo = float(ref_lo_series.mode().iloc[0]) if not ref_lo_series.empty else None
        ref_hi = float(ref_hi_series.mode().iloc[0]) if not ref_hi_series.empty else None
        units = subset["UNITS"].dropna().mode().iloc[0] if not subset["UNITS"].dropna().empty else ""

        per_crew_values: dict[str, dict[str, float]] = {}
        per_crew_ci: dict[str, dict[str, list[float]]] = {}

        for crew in sorted(VALID_CREW):
            crew_rows = subset[subset["SUBJECT_ID"] == crew]
            if crew_rows.empty:
                continue
            tp_to_val: dict[str, float] = {}
            for _, row in crew_rows.iterrows():
                tp = row["TEST_DATE"]
                v = row["VALUE"]
                if pd.notna(v):
                    tp_to_val[tp] = float(v)
            if not tp_to_val:
                continue
            per_crew_values[crew] = tp_to_val

            # Bootstrap CI from per-crew baseline values (L-92, L-44, L-3).
            baseline_vals = np.array(
                [tp_to_val[t] for t in BASELINE_TIMEPOINTS if t in tp_to_val],
                dtype=float,
            )
            tp_to_ci: dict[str, list[float]] = {}
            if len(baseline_vals) >= 2:
                _point, lo_anchor, hi_anchor = bootstrap_ci(
                    baseline_vals, statistic=np.mean, n_boot=N_BOOT, rng=rng
                )
                # The CI half-width on the baseline anchor sets uncertainty around each
                # measured timepoint. We render this as the trajectory band.
                half = (hi_anchor - lo_anchor) / 2.0
                for tp, v in tp_to_val.items():
                    tp_to_ci[tp] = [round(v - half, 4), round(v + half, 4)]
            else:
                # No usable baseline -> no CI band, just use the value as both bounds.
                for tp, v in tp_to_val.items():
                    tp_to_ci[tp] = [round(v, 4), round(v, 4)]

            per_crew_ci[crew] = tp_to_ci

        metrics[key] = {
            "label": spec["label"],
            "units": units,
            "reference_range": [ref_lo, ref_hi] if ref_lo is not None and ref_hi is not None else None,
            "values": {c: {tp: round(v, 4) for tp, v in tps.items()} for c, tps in per_crew_values.items()},
            "trajectory_ci": per_crew_ci,
        }

    payload = {
        "crew": sorted(VALID_CREW),
        "timepoints": CBC_TIMEPOINTS,
        "metrics": metrics,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print()
    print(f"Wrote {OUT_PATH}")
    for k, m in metrics.items():
        n_obs = sum(len(v) for v in m["values"].values())
        print(f"  {k}: {m['label']} ({m['units']}) ref={m['reference_range']} n_obs={n_obs}")


if __name__ == "__main__":
    main()
