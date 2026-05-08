"""Generate dashboard/data/bloodwork.json — a unified bloodwork report.

Inputs (all from OSDR):
  - OSD-569 CBC (long-form):           LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv
  - OSD-575 CMP (wide-form):           LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv
  - OSD-575 immune cytokines (wide):   LSDS-8_Multiplex_serum_immune_EvePanel_TRANSFORMED.csv
  - OSD-575 cardiac cytokines (wide):  LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv

Output:
  dashboard/data/bloodwork.json with:
    - "crew" / "timepoints" arrays
    - "panels": raw per-(panel, metric, crew, timepoint) values + reference ranges
    - "metrics": metadata per metric (label, units, panel, system, system_label)
    - "findings": one synthesized finding per (system, timepoint-window), each with
        a plain-language headline and an evidence list pointing back to specific
        metrics and per-crew shifts. The frontend renders these as expandable cards.

Methodology (honest, defensible, n=4):
  - For each crew x metric, the three pre-flight values (L-92, L-44, L-3) form a
    personal baseline. We bootstrap the baseline mean (1000 iters) to get a 95%
    CI on each crew's anchor.
  - A metric is "shifted" at a post-flight timepoint for a crew member when the
    measured value falls outside that crew's bootstrapped baseline CI.
  - A system is reported as "shifted" at a timepoint when at least 75% of the
    system's metrics are shifted in the same direction across at least 75% of
    crew members. Otherwise it is "stable" (or "mixed" when crew disagree).
  - Findings include both shifted and stable systems so a reader gets a complete
    picture, not just where things changed.

Run:  python3 -m analysis.bloodwork_pipeline   (from repo root)
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

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

OUT_PATH = REPO_ROOT / "dashboard" / "data" / "bloodwork.json"
RAW_DIR = REPO_ROOT / "data" / "raw"

PANEL_SOURCES = {
    "cbc": {
        "label": "Complete Blood Count",
        "source": "OSD-569",
        "url": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-569/download?source=datamanager"
               "&file=LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv",
        "local": RAW_DIR / "osd-569-cbc.csv",
        "format": "long",  # one analyte per row
    },
    "cmp": {
        "label": "Comprehensive Metabolic Panel",
        "source": "OSD-575",
        "url": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-575/download?source=datamanager"
               "&file=LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv",
        "local": RAW_DIR / "osd-575-cmp.csv",
        "format": "wide_with_ranges",  # columns: <metric>_value_<units>, _range_min_<units>, _range_max_<units>
    },
    "immune_cytokines": {
        "label": "Serum immune cytokines (Eve panel)",
        "source": "OSD-575",
        "url": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-575/download?source=datamanager"
               "&file=LSDS-8_Multiplex_serum_immune_EvePanel_TRANSFORMED.csv",
        "local": RAW_DIR / "osd-575-immune-eve.csv",
        "format": "wide_concentration",  # columns: <analyte>_concentration_<units>, <analyte>_percent
    },
    "cardiac_cytokines": {
        "label": "Serum cardiovascular markers (Eve panel)",
        "source": "OSD-575",
        "url": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-575/download?source=datamanager"
               "&file=LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv",
        "local": RAW_DIR / "osd-575-cardio-eve.csv",
        "format": "wide_concentration",
    },
}

# CBC analytes we keep. Sex-specific variants ("HEMOGLOBIN (FEMALE)" etc.) map
# to the same metric_key so all 4 crew end up in one series; their per-row
# reference ranges remain sex-correct in the underlying data.
CBC_ANALYTES = {
    "WHITE BLOOD CELL COUNT":  ("wbc",        "White blood cell count"),
    "RED BLOOD CELL COUNT":    ("rbc",        "Red blood cell count"),
    "RED BLOOD CELL COUNT (FEMALE)": ("rbc",  "Red blood cell count"),
    "HEMOGLOBIN":              ("hemoglobin", "Hemoglobin"),
    "HEMOGLOBIN (FEMALE)":     ("hemoglobin", "Hemoglobin"),
    "HEMATOCRIT":              ("hematocrit", "Hematocrit"),
    "HEMATOCRIT (FEMALE)":     ("hematocrit", "Hematocrit"),
    "PLATELET COUNT":          ("platelets",  "Platelet count"),
    "MCV":                     ("mcv",        "Mean corpuscular volume"),
    "MCH":                     ("mch",        "Mean corpuscular hemoglobin"),
    "MCHC":                    ("mchc",       "Mean corpuscular hemoglobin concentration"),
    "RDW":                     ("rdw",        "Red cell distribution width"),
    "NEUTROPHILS":             ("neutrophils_pct",  "Neutrophils %"),
    "LYMPHOCYTES":             ("lymphocytes_pct",  "Lymphocytes %"),
    "MONOCYTES":               ("monocytes_pct",    "Monocytes %"),
    "EOSINOPHILS":             ("eosinophils_pct",  "Eosinophils %"),
    "BASOPHILS":               ("basophils_pct",    "Basophils %"),
    "ABSOLUTE NEUTROPHILS":    ("neutrophils_abs",  "Neutrophils (absolute)"),
    "ABSOLUTE LYMPHOCYTES":    ("lymphocytes_abs",  "Lymphocytes (absolute)"),
    "ABSOLUTE MONOCYTES":      ("monocytes_abs",    "Monocytes (absolute)"),
    "ABSOLUTE EOSINOPHILS":    ("eosinophils_abs",  "Eosinophils (absolute)"),
    "ABSOLUTE BASOPHILS":      ("basophils_abs",    "Basophils (absolute)"),
}

# CMP analytes -> display name; everything else from the file is dropped.
CMP_ANALYTES = {
    "albumin":               "Albumin",
    "albumin_to_globulin_ratio": "Albumin:globulin ratio",
    "alkaline_phosphatase":  "Alkaline phosphatase",
    "alt":                   "ALT (alanine aminotransferase)",
    "ast":                   "AST (aspartate aminotransferase)",
    "total_bilirubin":       "Total bilirubin",
    "bun_to_creatinine_ratio": "BUN:creatinine ratio",
    "calcium":               "Calcium",
    "carbon_dioxide":        "Carbon dioxide (CO2)",
    "chloride":              "Chloride",
    "creatinine":            "Creatinine",
    "globulin":              "Globulin",
    "glucose":               "Glucose",
    "potassium":             "Potassium",
    "total_protein":         "Total protein",
    "sodium":                "Sodium",
    "urea_nitrogen_bun":     "Urea nitrogen (BUN)",
}

# Cytokines: all analytes are kept; display name is derived from the column key.

# (panel, metric_key) -> system slug
METRIC_TO_SYSTEM: dict[tuple[str, str], str] = {
    # Hematology - white cells
    ("cbc", "wbc"):              "white_cells",
    ("cbc", "neutrophils_pct"):  "white_cells",
    ("cbc", "lymphocytes_pct"):  "white_cells",
    ("cbc", "monocytes_pct"):    "white_cells",
    ("cbc", "eosinophils_pct"):  "white_cells",
    ("cbc", "basophils_pct"):    "white_cells",
    ("cbc", "neutrophils_abs"):  "white_cells",
    ("cbc", "lymphocytes_abs"):  "white_cells",
    ("cbc", "monocytes_abs"):    "white_cells",
    ("cbc", "eosinophils_abs"):  "white_cells",
    ("cbc", "basophils_abs"):    "white_cells",
    # Hematology - red cells
    ("cbc", "rbc"):        "red_cells",
    ("cbc", "hemoglobin"): "red_cells",
    ("cbc", "hematocrit"): "red_cells",
    ("cbc", "mcv"):        "red_cells",
    ("cbc", "mch"):        "red_cells",
    ("cbc", "mchc"):       "red_cells",
    ("cbc", "rdw"):        "red_cells",
    # Hematology - platelets
    ("cbc", "platelets"):  "platelets",
    # Renal
    ("cmp", "creatinine"):            "renal",
    ("cmp", "urea_nitrogen_bun"):     "renal",
    ("cmp", "bun_to_creatinine_ratio"): "renal",
    # Hepatic
    ("cmp", "ast"):                   "hepatic",
    ("cmp", "alt"):                   "hepatic",
    ("cmp", "alkaline_phosphatase"):  "hepatic",
    ("cmp", "total_bilirubin"):       "hepatic",
    # Metabolic / electrolytes
    ("cmp", "glucose"):    "metabolic",
    ("cmp", "sodium"):     "metabolic",
    ("cmp", "potassium"):  "metabolic",
    ("cmp", "chloride"):   "metabolic",
    ("cmp", "carbon_dioxide"): "metabolic",
    ("cmp", "calcium"):    "metabolic",
    # Protein
    ("cmp", "albumin"):                    "protein",
    ("cmp", "globulin"):                   "protein",
    ("cmp", "total_protein"):              "protein",
    ("cmp", "albumin_to_globulin_ratio"):  "protein",
    # Cardiac panel — single system bucket (acute phase + cardiovascular markers)
    # All cardiac-panel metrics auto-mapped below.
    # Cytokine system mapping derived from the immune panel column names below.
}

# Curated subset of immune cytokines to spotlight as "pro-inflammatory"
# (others remain available in the panel data but don't drive findings).
PROINFLAMMATORY_CYTOKINES = {
    "il_6", "il_1β", "il_1ra", "tnfα", "tnfβ", "ifnγ",
    "il_8", "il_17a", "il_18", "g_csf", "gm_csf",
}
# Curated subset of "adaptive / regulatory" cytokines.
ADAPTIVE_CYTOKINES = {
    "il_2", "il_4", "il_5", "il_10", "il_13", "il_15",
}

SYSTEMS = {
    "white_cells":   {"label": "White blood cells",                "category": "Hematology"},
    "red_cells":     {"label": "Red blood cell line",              "category": "Hematology"},
    "platelets":     {"label": "Platelets",                        "category": "Hematology"},
    "renal":         {"label": "Kidney markers (BUN, creatinine)", "category": "Metabolic"},
    "hepatic":       {"label": "Liver enzymes",                    "category": "Metabolic"},
    "metabolic":     {"label": "Glucose & electrolytes",           "category": "Metabolic"},
    "protein":       {"label": "Serum proteins",                   "category": "Metabolic"},
    "inflammation":  {"label": "Inflammatory cytokines",           "category": "Immune"},
    "adaptive":      {"label": "Adaptive-immune cytokines",        "category": "Immune"},
    "cardiac":       {"label": "Cardiovascular markers",           "category": "Cardiovascular"},
}

# Bootstrap iterations. Reproducible via seeded RNG.
N_BOOT = 1000

# Sample-name parser: "C001_serum_L-3" -> (crew, timepoint).
_RE_BLOOD_SAMPLE = re.compile(r"^(?P<crew>C00\d)_(?:serum|plasma|whole_blood)_(?P<tp>L-\d+|R\+\d+)$", re.IGNORECASE)


def parse_blood_sample(name: str) -> tuple[str, str] | None:
    m = _RE_BLOOD_SAMPLE.match(str(name))
    if not m:
        return None
    crew = m.group("crew")
    tp = m.group("tp")
    if crew not in VALID_CREW:
        return None
    if tp not in CBC_TIMEPOINTS:
        return None
    return crew, tp


def fetch(url: str, local: Path) -> Path:
    if not local.exists():
        import subprocess
        local.parent.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {local.name}...", flush=True)
        subprocess.run(["curl", "-sLf", "--max-redirs", "5", "-o", str(local), url], check=True)
    return local


# ---------- Loaders ----------

def load_cbc(path: Path) -> dict[str, dict[str, dict[str, dict]]]:
    """Returns metrics dict: { metric_key: { crew: { tp: {"value": v, "ref_lo": .., "ref_hi": .., "units": ..} } } }"""
    df = pd.read_csv(path)
    df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
    df["RANGE_MIN"] = pd.to_numeric(df["RANGE_MIN"], errors="coerce")
    df["RANGE_MAX"] = pd.to_numeric(df["RANGE_MAX"], errors="coerce")

    out: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))
    for _, row in df.iterrows():
        analyte = row["ANALYTE"]
        if analyte not in CBC_ANALYTES:
            continue
        crew = row["SUBJECT_ID"]
        tp = row["TEST_DATE"]
        if crew not in VALID_CREW or tp not in CBC_TIMEPOINTS:
            continue
        if pd.isna(row["VALUE"]):
            continue
        key, _label = CBC_ANALYTES[analyte]
        out[key][crew][tp] = {
            "value": float(row["VALUE"]),
            "ref_lo": None if pd.isna(row["RANGE_MIN"]) else float(row["RANGE_MIN"]),
            "ref_hi": None if pd.isna(row["RANGE_MAX"]) else float(row["RANGE_MAX"]),
            "units": str(row["UNITS"]) if pd.notna(row["UNITS"]) else "",
        }
    return out


def parse_cmp_columns(columns: Iterable[str]) -> dict[str, dict[str, str]]:
    """Map analyte_key -> {value_col, range_min_col, range_max_col, units}."""
    cols = list(columns)
    metrics: dict[str, dict[str, str]] = defaultdict(dict)
    # Pattern: <analyte>_value_<units...> | <analyte>_range_min_<units...> | <analyte>_range_max_<units...> or _max_
    for col in cols:
        if col == "Sample Name":
            continue
        # Some columns omit "range_" prefix in the max field (e.g. "alt_max_units_per_liter" vs "alt_range_min_units_per_liter")
        # We unify with regex.
        m_value = re.match(r"^(?P<key>.+?)_value(?:_(?P<units>.+))?$", col)
        m_min = re.match(r"^(?P<key>.+?)_range_min(?:_(?P<units>.+))?$", col)
        m_max = re.match(r"^(?P<key>.+?)_range_max(?:_(?P<units>.+))?$", col)
        m_max_alt = re.match(r"^(?P<key>.+?)_max(?:_(?P<units>.+))?$", col) if not m_max else None
        if m_value:
            key = m_value.group("key")
            metrics[key].setdefault("value_col", col)
            if m_value.group("units"):
                metrics[key].setdefault("units", m_value.group("units").replace("_", " "))
        elif m_min:
            metrics[m_min.group("key")]["range_min_col"] = col
        elif m_max:
            metrics[m_max.group("key")]["range_max_col"] = col
        elif m_max_alt:
            metrics[m_max_alt.group("key")].setdefault("range_max_col", col)
    return metrics


def load_cmp(path: Path) -> dict[str, dict[str, dict[str, dict]]]:
    df = pd.read_csv(path)
    columns_meta = parse_cmp_columns(df.columns)

    out: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))
    for _, row in df.iterrows():
        ct = parse_blood_sample(row["Sample Name"])
        if ct is None:
            continue
        crew, tp = ct
        for key, info in columns_meta.items():
            if key not in CMP_ANALYTES:
                continue
            value_col = info.get("value_col")
            if not value_col:
                continue
            raw = row.get(value_col)
            v = pd.to_numeric(raw, errors="coerce")
            if pd.isna(v):
                continue
            ref_lo_raw = row.get(info.get("range_min_col", ""))
            ref_hi_raw = row.get(info.get("range_max_col", ""))
            ref_lo = pd.to_numeric(ref_lo_raw, errors="coerce")
            ref_hi = pd.to_numeric(ref_hi_raw, errors="coerce")
            out[key][crew][tp] = {
                "value": float(v),
                "ref_lo": None if pd.isna(ref_lo) else float(ref_lo),
                "ref_hi": None if pd.isna(ref_hi) else float(ref_hi),
                "units": info.get("units", ""),
            }
    return out


def parse_cytokine_columns(columns: Iterable[str]) -> dict[str, dict[str, str]]:
    """Cytokine columns: <analyte>_concentration_<units>, <analyte>_percent (drop)."""
    metrics: dict[str, dict[str, str]] = {}
    for col in columns:
        if col == "Sample Name":
            continue
        m = re.match(r"^(?P<key>.+?)_concentration(?:_(?P<units>.+))?$", col)
        if m:
            metrics[m.group("key")] = {
                "value_col": col,
                "units": (m.group("units") or "").replace("_", " "),
            }
    return metrics


def load_cytokines(path: Path) -> dict[str, dict[str, dict[str, dict]]]:
    df = pd.read_csv(path)
    columns_meta = parse_cytokine_columns(df.columns)
    out: dict[str, dict[str, dict[str, dict]]] = defaultdict(lambda: defaultdict(dict))
    for _, row in df.iterrows():
        ct = parse_blood_sample(row["Sample Name"])
        if ct is None:
            continue
        crew, tp = ct
        for key, info in columns_meta.items():
            v = pd.to_numeric(row.get(info["value_col"]), errors="coerce")
            if pd.isna(v):
                continue
            out[key][crew][tp] = {
                "value": float(v),
                "ref_lo": None,
                "ref_hi": None,
                "units": info.get("units", ""),
            }
    return out


# ---------- Per-metric stats ----------

def compute_metric_stats(
    metric_data: dict[str, dict[str, dict]],
    rng: np.random.Generator,
) -> dict[str, dict]:
    """For each crew, compute baseline mean + bootstrap CI half-width.

    Returns: {crew: {"baseline_mean": v, "baseline_ci_half": h,
                     "values": {tp: v}, "shifts": {tp: {"shifted": bool, "direction": "up"/"down"/"none", "pct": x, "delta": y}}}}
    """
    result: dict[str, dict] = {}
    for crew, tp_to_obs in metric_data.items():
        baseline_vals = np.array(
            [tp_to_obs[t]["value"] for t in BASELINE_TIMEPOINTS if t in tp_to_obs and tp_to_obs[t]["value"] is not None],
            dtype=float,
        )
        if len(baseline_vals) == 0:
            continue
        if len(baseline_vals) >= 2:
            point, lo, hi = bootstrap_ci(baseline_vals, statistic=np.mean, n_boot=N_BOOT, rng=rng)
            half = (hi - lo) / 2.0
        else:
            point, half = float(baseline_vals[0]), 0.0
        per_tp_shifts: dict[str, dict] = {}
        for tp, obs in tp_to_obs.items():
            if tp in BASELINE_TIMEPOINTS:
                continue
            v = obs["value"]
            delta = v - point
            shifted = abs(delta) > half if half > 0 else abs(delta) > 0.001 * max(abs(point), 1.0)
            direction = "up" if delta > 0 else ("down" if delta < 0 else "none")
            pct = (delta / point * 100.0) if point != 0 else 0.0
            per_tp_shifts[tp] = {
                "shifted": bool(shifted),
                "direction": direction,
                "pct": round(pct, 1),
                "delta": round(delta, 4),
                "value": round(v, 4),
            }
        result[crew] = {
            "baseline_mean": round(point, 4),
            "baseline_ci_half": round(half, 4),
            "values": {tp: round(obs["value"], 4) for tp, obs in tp_to_obs.items()},
            "shifts": per_tp_shifts,
        }
    return result


# ---------- Findings classifier ----------

def classify_findings(
    panels_data: dict[str, dict],   # panel_key -> metric_key -> stats (from compute_metric_stats)
    metric_meta: dict[tuple[str, str], dict],  # (panel, metric_key) -> {label, units, system}
) -> list[dict]:
    """For each system, summarize per-timepoint behavior into a finding card.

    A system is "shifted" at timepoint T if at least 50% of metrics in the system
    are shifted in the same direction across at least 50% of crew members. Otherwise
    classified as "stable" (most metrics unshifted or mixed-direction).
    """
    POST_FLIGHT_TPS = [t for t in CBC_TIMEPOINTS if t not in BASELINE_TIMEPOINTS]
    METRIC_FRACTION_THRESHOLD = 0.5
    CREW_FRACTION_THRESHOLD = 0.5

    # Group metric keys by system
    system_to_metrics: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for (panel, metric_key), meta in metric_meta.items():
        system = meta.get("system")
        if system is not None:
            system_to_metrics[system].append((panel, metric_key))

    findings: list[dict] = []

    for system, ms in system_to_metrics.items():
        if not ms:
            continue
        sysmeta = SYSTEMS[system]

        # Per-timepoint classification
        per_tp_status: dict[str, dict] = {}
        for tp in POST_FLIGHT_TPS:
            # Per crew, count shifted metrics in this system at this tp
            crew_directions: dict[str, dict[str, int]] = defaultdict(lambda: {"up": 0, "down": 0, "total": 0})
            metric_evidence: list[dict] = []
            for (panel, mk) in ms:
                stats = panels_data.get(panel, {}).get(mk)
                if not stats:
                    continue
                for crew, crew_stats in stats.items():
                    shift = crew_stats["shifts"].get(tp)
                    if not shift:
                        continue
                    crew_directions[crew]["total"] += 1
                    if shift["shifted"]:
                        crew_directions[crew][shift["direction"]] = crew_directions[crew].get(shift["direction"], 0) + 1
                # Per-metric, count crew shifted up/down
                metric_evidence.append({
                    "panel": panel,
                    "key": mk,
                    "label": metric_meta[(panel, mk)]["label"],
                    "units": metric_meta[(panel, mk)]["units"],
                    "n_crew_shifted_up":   sum(1 for c in stats.values() if (c["shifts"].get(tp, {}).get("shifted") and c["shifts"][tp]["direction"] == "up")),
                    "n_crew_shifted_down": sum(1 for c in stats.values() if (c["shifts"].get(tp, {}).get("shifted") and c["shifts"][tp]["direction"] == "down")),
                    "median_pct_change": round(float(np.median([c["shifts"][tp]["pct"] for c in stats.values() if tp in c["shifts"]])), 1) if any(tp in c["shifts"] for c in stats.values()) else 0.0,
                    "n_crew_observed":  sum(1 for c in stats.values() if tp in c["shifts"]),
                })

            # Decide per-crew direction at this tp
            crew_call: dict[str, str] = {}
            for crew, cd in crew_directions.items():
                if cd["total"] == 0:
                    continue
                up_frac = cd["up"] / cd["total"]
                down_frac = cd["down"] / cd["total"]
                if up_frac >= METRIC_FRACTION_THRESHOLD and up_frac > down_frac:
                    crew_call[crew] = "up"
                elif down_frac >= METRIC_FRACTION_THRESHOLD and down_frac > up_frac:
                    crew_call[crew] = "down"
                elif up_frac >= METRIC_FRACTION_THRESHOLD and down_frac >= METRIC_FRACTION_THRESHOLD:
                    crew_call[crew] = "mixed"
                else:
                    crew_call[crew] = "stable"

            # Aggregate to system-level
            n_total = len(crew_call)
            if n_total == 0:
                per_tp_status[tp] = {"status": "no_data", "evidence": metric_evidence}
                continue
            n_up = sum(1 for v in crew_call.values() if v == "up")
            n_down = sum(1 for v in crew_call.values() if v == "down")
            n_stable = sum(1 for v in crew_call.values() if v == "stable")
            up_frac = n_up / n_total
            down_frac = n_down / n_total
            stable_frac = n_stable / n_total
            if up_frac >= CREW_FRACTION_THRESHOLD:
                status = "shifted_up"
            elif down_frac >= CREW_FRACTION_THRESHOLD:
                status = "shifted_down"
            elif stable_frac >= CREW_FRACTION_THRESHOLD:
                status = "stable"
            else:
                status = "mixed"
            per_tp_status[tp] = {
                "status": status,
                "n_crew_up": n_up,
                "n_crew_down": n_down,
                "n_crew_stable": n_stable,
                "n_total": n_total,
                "evidence": metric_evidence,
            }

        # Headline: which timepoint had the most pronounced shift, if any
        any_shift = [tp for tp, s in per_tp_status.items() if s["status"] in ("shifted_up", "shifted_down", "mixed")]
        is_overall_stable = all(s["status"] in ("stable", "no_data") for s in per_tp_status.values())

        # Generate plain-language headline
        if is_overall_stable:
            headline = f"{sysmeta['label']}: stable across the mission"
            overall_status = "stable"
        else:
            # Pick the "first interesting" timepoint and describe it
            first_tp = next((tp for tp in POST_FLIGHT_TPS if tp in any_shift), None)
            if first_tp is None:
                headline = f"{sysmeta['label']}: no clear pattern"
                overall_status = "mixed"
            else:
                first_status = per_tp_status[first_tp]["status"]
                # Look for recovery
                recovery_tp = None
                if first_status in ("shifted_up", "shifted_down"):
                    for later_tp in POST_FLIGHT_TPS:
                        if later_tp <= first_tp:
                            continue
                        if per_tp_status.get(later_tp, {}).get("status") == "stable":
                            recovery_tp = later_tp
                            break
                if first_status == "shifted_up":
                    base = f"{sysmeta['label']} elevated at {first_tp}"
                elif first_status == "shifted_down":
                    base = f"{sysmeta['label']} decreased at {first_tp}"
                else:
                    base = f"{sysmeta['label']}: mixed shift at {first_tp} across crew"
                if recovery_tp:
                    headline = base + f", back to baseline by {recovery_tp}"
                else:
                    headline = base
                overall_status = first_status

        findings.append({
            "system": system,
            "system_label": sysmeta["label"],
            "category": sysmeta["category"],
            "headline": headline,
            "overall_status": overall_status,
            "per_timepoint": per_tp_status,
            "metric_keys": [{"panel": p, "key": k} for p, k in ms],
        })

    # Order: by category (Hematology, Metabolic, Immune, Cardiovascular), then by status (shifted before stable).
    category_order = ["Hematology", "Metabolic", "Immune", "Cardiovascular"]
    status_order = {"shifted_up": 0, "shifted_down": 0, "mixed": 1, "stable": 2, "no_data": 3}
    findings.sort(key=lambda f: (category_order.index(f["category"]) if f["category"] in category_order else 99,
                                  status_order.get(f["overall_status"], 99)))
    return findings


def main() -> None:
    print("Loading bloodwork sources...")
    rng = np.random.default_rng(0)

    panels_payload: dict[str, dict] = {}
    panels_data: dict[str, dict[str, dict]] = {}  # for findings classifier
    metric_meta: dict[tuple[str, str], dict] = {}

    for panel_key, info in PANEL_SOURCES.items():
        print(f"\n[{panel_key}] {info['label']} ({info['source']})")
        local = fetch(info["url"], info["local"])

        if panel_key == "cbc":
            metric_data = load_cbc(local)
            metric_labels = {k: lab for _src, (k, lab) in CBC_ANALYTES.items()}
        elif panel_key == "cmp":
            metric_data = load_cmp(local)
            metric_labels = {k: CMP_ANALYTES[k] for k in metric_data.keys() if k in CMP_ANALYTES}
        else:  # cytokines
            metric_data = load_cytokines(local)
            metric_labels = {k: k.replace("_", " ").upper() for k in metric_data.keys()}

        # Compute per-metric stats
        per_metric_stats = {}
        for mk, mdat in metric_data.items():
            if metric_labels and mk not in metric_labels:
                continue
            stats = compute_metric_stats(mdat, rng)
            if not stats:
                continue
            per_metric_stats[mk] = stats
            # Pick representative units / ref range from first crew/tp present
            first_obs = next(iter(next(iter(mdat.values())).values()))
            label = metric_labels.get(mk, mk)
            # System mapping
            system = METRIC_TO_SYSTEM.get((panel_key, mk))
            if system is None:
                # Cytokines -> system mapping by membership
                if panel_key == "immune_cytokines":
                    if mk in PROINFLAMMATORY_CYTOKINES:
                        system = "inflammation"
                    elif mk in ADAPTIVE_CYTOKINES:
                        system = "adaptive"
                elif panel_key == "cardiac_cytokines":
                    system = "cardiac"
            metric_meta[(panel_key, mk)] = {
                "label": label,
                "units": first_obs.get("units", ""),
                "ref_lo": first_obs.get("ref_lo"),
                "ref_hi": first_obs.get("ref_hi"),
                "panel": panel_key,
                "system": system,
            }

        panels_data[panel_key] = per_metric_stats
        panels_payload[panel_key] = {
            "label": info["label"],
            "source": info["source"],
            "metrics": {
                mk: {
                    "label": metric_meta[(panel_key, mk)]["label"],
                    "units": metric_meta[(panel_key, mk)]["units"],
                    "ref_lo": metric_meta[(panel_key, mk)]["ref_lo"],
                    "ref_hi": metric_meta[(panel_key, mk)]["ref_hi"],
                    "system": metric_meta[(panel_key, mk)]["system"],
                    "per_crew": stats,
                }
                for mk, stats in per_metric_stats.items()
            },
        }
        print(f"  metrics in panel: {len(per_metric_stats)}")

    # Findings
    findings = classify_findings(panels_data, metric_meta)
    print(f"\nGenerated {len(findings)} findings.")
    for f in findings:
        print(f"  - [{f['overall_status']}] {f['headline']}")

    payload = {
        "crew": sorted(VALID_CREW),
        "timepoints": CBC_TIMEPOINTS,
        "baseline_timepoints": BASELINE_TIMEPOINTS,
        "panels": panels_payload,
        "systems": SYSTEMS,
        "findings": findings,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
