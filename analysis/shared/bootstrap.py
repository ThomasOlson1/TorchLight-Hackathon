"""Deterministic bootstrap utilities for small-N uncertainty bands.

Every CI in the dashboard ultimately runs through one of these functions.
We use a fixed RNG seed by default so the JSON is reproducible across runs —
the hackathon scoring is on the published numbers, not on flaky resampling.
"""

from __future__ import annotations

from typing import Callable

import numpy as np


def bootstrap_ci(
    values: np.ndarray,
    statistic: Callable[[np.ndarray], float],
    n_boot: int = 1000,
    ci: float = 0.95,
    rng: np.random.Generator | None = None,
) -> tuple[float, float, float]:
    """Bootstrap a 1-D array.

    Returns (point_estimate, ci_lo, ci_hi) where the point estimate is the
    statistic applied to the un-resampled values. CI bounds are percentile.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    values = np.asarray(values)
    n = len(values)
    if n == 0:
        return float("nan"), float("nan"), float("nan")

    boots = np.empty(n_boot)
    for i in range(n_boot):
        sample = rng.choice(values, size=n, replace=True)
        boots[i] = statistic(sample)

    lo, hi = np.quantile(boots, [(1 - ci) / 2, 1 - (1 - ci) / 2])
    return float(statistic(values)), float(lo), float(hi)


def bootstrap_distance_ci(
    baseline_matrix: np.ndarray,
    target_vec: np.ndarray,
    distance_fn: Callable[[np.ndarray, np.ndarray], float],
    n_boot: int = 1000,
    ci: float = 0.95,
    rng: np.random.Generator | None = None,
) -> tuple[float, float, float]:
    """CI on the distance from a target vector to a *bootstrapped baseline mean*.

    `baseline_matrix` is shape (n_baseline_samples, n_features).
    Each bootstrap iteration resamples baseline rows with replacement,
    computes the mean baseline vector, and computes distance(target_vec, mean).

    Returns (point_estimate, ci_lo, ci_hi). Point estimate uses the
    un-resampled baseline mean.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    baseline_matrix = np.asarray(baseline_matrix, dtype=float)
    target_vec = np.asarray(target_vec, dtype=float)
    n = len(baseline_matrix)
    if n == 0:
        return float("nan"), float("nan"), float("nan")

    point = float(distance_fn(target_vec, baseline_matrix.mean(axis=0)))

    boots = np.empty(n_boot)
    indices = np.arange(n)
    for i in range(n_boot):
        sampled_idx = rng.choice(indices, size=n, replace=True)
        bmean = baseline_matrix[sampled_idx].mean(axis=0)
        boots[i] = distance_fn(target_vec, bmean)

    lo, hi = np.quantile(boots, [(1 - ci) / 2, 1 - (1 - ci) / 2])
    return point, float(lo), float(hi)
