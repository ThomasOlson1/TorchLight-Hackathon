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


# ---------- System summaries (4 high-level cards x 4 timeline findings) ----------

# Curated: each high-level "stat card" maps to one or more underlying systems,
# picks 1-3 headline metrics that best represent the category, and walks through
# 4 mission checkpoints. The headlines drive the per-checkpoint finding text;
# all metrics in the systems contribute to the "n_shifted" counts.
SUMMARY_CARDS = [
    {
        "id": "hematology",
        "label": "Hematology",
        "subtitle": "Red cells, white cells, platelets",
        "systems": ["red_cells", "white_cells", "platelets"],
        "headline": [("cbc", "hemoglobin"), ("cbc", "rbc"), ("cbc", "hematocrit")],
        "headline_label": "Red cell mass (hemoglobin / RBC / hematocrit)",
    },
    {
        "id": "metabolic",
        "label": "Kidneys, liver & metabolism",
        "subtitle": "BUN, creatinine, AST, ALT, glucose, electrolytes",
        "systems": ["renal", "hepatic", "metabolic", "protein"],
        "headline": [("cmp", "creatinine"), ("cmp", "urea_nitrogen_bun")],
        "headline_label": "Kidney markers (BUN, creatinine)",
    },
    {
        "id": "immune",
        "label": "Immune signaling",
        "subtitle": "Cytokines from the Eve immune panel",
        "systems": ["inflammation", "adaptive"],
        "headline": [("immune_cytokines", "il_6"), ("immune_cytokines", "il_2"), ("immune_cytokines", "il_10")],
        "headline_label": "Pro-inflammatory + adaptive cytokines",
    },
    {
        "id": "cardiovascular",
        "label": "Cardiovascular markers",
        "subtitle": "Acute-phase + cardiac signals",
        "systems": ["cardiac"],
        "headline": [("cardiac_cytokines", "crp"), ("cardiac_cytokines", "fibrinogen")],
        "headline_label": "C-reactive protein (CRP) + fibrinogen",
    },
]

# 4 mission checkpoints in narrative order. Each gets a finding bullet on every card.
TIMELINE_CHECKPOINTS = [
    {"key": "L-3",  "label": "Pre-flight baseline",  "tps": ["L-92", "L-44", "L-3"]},
    {"key": "R+1",  "label": "1 day post-return",    "tps": ["R+1"]},
    {"key": "R+45", "label": "6 weeks post-return",  "tps": ["R+45"]},
    {"key": "R+82", "label": "12 weeks+ post-return", "tps": ["R+82", "R+194"]},
]


def aggregate_system_metrics(panels_data, metric_meta, system_ids):
    """Return list of (panel, key) tuples for all metrics in the named systems."""
    metrics = []
    for (panel, mk), meta in metric_meta.items():
        if meta.get("system") in system_ids:
            metrics.append((panel, mk))
    return metrics


def crew_shift_summary(panels_data, metrics, tp_list):
    """Across all metrics & all timepoints in tp_list, count crew-x-metric shifts.

    Returns: (n_total, n_up, n_down, n_stable, median_pct_change_among_shifted).
    """
    n_total = 0
    n_up = 0
    n_down = 0
    n_stable = 0
    pct_changes_shifted = []
    for (panel, mk) in metrics:
        per_crew = panels_data.get(panel, {}).get(mk, {})
        for crew, cstats in per_crew.items():
            for tp in tp_list:
                shift = cstats.get("shifts", {}).get(tp)
                if not shift:
                    continue
                n_total += 1
                if shift["shifted"]:
                    if shift["direction"] == "up":
                        n_up += 1
                    elif shift["direction"] == "down":
                        n_down += 1
                    pct_changes_shifted.append(shift["pct"])
                else:
                    n_stable += 1
    median_pct = float(np.median(pct_changes_shifted)) if pct_changes_shifted else 0.0
    return n_total, n_up, n_down, n_stable, median_pct


def headline_pct_change(panels_data, headline_keys, tp_list):
    """Average % change across headline metrics x crew x given timepoints.

    Used to print the "<headline metric> averaged ±X% from baseline at <tp>" line.
    """
    pct_values = []
    for (panel, mk) in headline_keys:
        per_crew = panels_data.get(panel, {}).get(mk, {})
        for crew, cstats in per_crew.items():
            for tp in tp_list:
                shift = cstats.get("shifts", {}).get(tp)
                if shift is not None:
                    pct_values.append(shift["pct"])
    if not pct_values:
        return None
    return float(np.mean(pct_values))


def build_system_summaries(panels_data, metric_meta, panel_labels) -> list[dict]:
    """For each card, walk the 4 mission checkpoints and emit a finding for each."""
    summaries = []

    for card in SUMMARY_CARDS:
        all_system_metrics = aggregate_system_metrics(panels_data, metric_meta, set(card["systems"]))
        headline_metrics = card["headline"]

        findings = []

        # Checkpoint 0: Pre-flight baseline (L-92 / L-44 / L-3)
        baseline_tps = ["L-92", "L-44", "L-3"]
        n_metrics = len({mk for _p, mk in all_system_metrics})
        n_baseline_obs = sum(
            1 for (panel, mk) in all_system_metrics
            for crew_stats in panels_data.get(panel, {}).get(mk, {}).values()
            for tp in baseline_tps
            if tp in crew_stats.get("values", {})
        )
        findings.append({
            "checkpoint": "L-3",
            "checkpoint_label": "Pre-flight baseline",
            "headline": f"Personal baseline established from 3 pre-flight draws (L-92, L-44, L-3) across {n_metrics} {card['label'].lower()} metrics.",
            "detail": f"Each crew member's own L-92/L-44/L-3 mean defines their baseline. {n_baseline_obs} measurements ground the post-flight comparisons. All baselines are personal (per-crew), not pooled.",
        })

        # Checkpoints 1-3: post-flight
        for cp in TIMELINE_CHECKPOINTS[1:]:
            n_total, n_up, n_down, n_stable, _med_shifted = crew_shift_summary(
                panels_data, all_system_metrics, cp["tps"]
            )
            head_pct = headline_pct_change(panels_data, headline_metrics, cp["tps"])
            n_shifted = n_up + n_down
            shifted_frac = n_shifted / n_total if n_total else 0.0

            # Direction call
            if shifted_frac < 0.20:
                direction_word = "stable"
                shift_phrase = "Most metrics within each crew's personal pre-flight CI"
            elif n_up > n_down * 1.5:
                direction_word = "elevated"
                shift_phrase = f"{n_up} of {n_total} crew x metric values rose above each crew's personal baseline CI"
            elif n_down > n_up * 1.5:
                direction_word = "decreased"
                shift_phrase = f"{n_down} of {n_total} crew x metric values dropped below each crew's personal baseline CI"
            else:
                direction_word = "mixed"
                shift_phrase = f"{n_up} crew x metric values rose, {n_down} dropped (mixed picture across the panel)"

            head_text = ""
            if head_pct is not None:
                arrow = "+" if head_pct > 0 else ""
                head_text = f" {card['headline_label']} averaged {arrow}{head_pct:.1f}% vs baseline."

            checkpoint_label = cp["label"]
            tps_phrase = " / ".join(cp["tps"]) if len(cp["tps"]) > 1 else cp["tps"][0]
            findings.append({
                "checkpoint": cp["key"],
                "checkpoint_label": checkpoint_label,
                "headline": f"{checkpoint_label} ({tps_phrase}): {direction_word}.{head_text}",
                "detail": shift_phrase + ".",
                "n_shifted": n_shifted,
                "n_total": n_total,
                "n_up": n_up,
                "n_down": n_down,
                "n_stable": n_stable,
                "headline_pct": round(head_pct, 1) if head_pct is not None else None,
            })

        # Overall status across the post-flight window
        post_flight_tps = ["R+1", "R+45", "R+82", "R+194"]
        _t, n_up_all, n_down_all, n_stable_all, _ = crew_shift_summary(panels_data, all_system_metrics, post_flight_tps)
        total_post = n_up_all + n_down_all + n_stable_all
        if total_post == 0:
            overall = "no_data"
        elif (n_up_all + n_down_all) / total_post < 0.20:
            overall = "stable"
        elif n_down_all > n_up_all:
            overall = "trended_down"
        elif n_up_all > n_down_all:
            overall = "trended_up"
        else:
            overall = "mixed"

        # Source labels: each panel that contributed any metric
        source_panels = sorted({p for (p, _mk) in all_system_metrics})
        sources = [panel_labels.get(p, p) for p in source_panels]

        summaries.append({
            "id": card["id"],
            "label": card["label"],
            "subtitle": card["subtitle"],
            "headline_label": card["headline_label"],
            "overall_status": overall,
            "n_metrics_tracked": n_metrics,
            "findings": findings,
            "sources": sources,
        })

    return summaries


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

    # Findings (per-system, kept for the underlying detail)
    findings = classify_findings(panels_data, metric_meta)

    # System summaries (the 4 high-level cards walking through the timeline)
    panel_labels = {pk: info["label"] + f" ({info['source']})" for pk, info in PANEL_SOURCES.items()}
    system_summaries = build_system_summaries(panels_data, metric_meta, panel_labels)
    print(f"\nGenerated {len(system_summaries)} system summary cards:")
    for s in system_summaries:
        print(f"  - [{s['overall_status']}] {s['label']} ({s['n_metrics_tracked']} metrics)")
        for f in s["findings"]:
            print(f"      [{f['checkpoint']}] {f['headline']}")

    payload = {
        "crew": sorted(VALID_CREW),
        "timepoints": CBC_TIMEPOINTS,
        "baseline_timepoints": BASELINE_TIMEPOINTS,
        "panels": panels_payload,
        "systems": SYSTEMS,
        "findings": findings,
        "system_summaries": system_summaries,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
