"""Parse Inspiration 4 OSDR sample identifiers.

Microbiome samples (OSD-572) are columns named like ``C001_FD2_ARM`` —
``{crew}_{timepoint}_{site_abbr}``. This module canonicalizes site
abbreviations to the names the dashboard's body.svg uses.

CBC samples (OSD-569) live in long-form rows with explicit SUBJECT_ID and
TEST_DATE columns, so no parser is needed there — but the timepoint constants
in this module apply to both.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# The 10 standardized body sites the dashboard expects.
# These match the data-region attributes in dashboard/body.svg and the
# `sites` array in dashboard/data/microbiome.json.
SITES = [
    "oral", "nasal", "post_auricular", "axillary", "forearm",
    "occiput", "umbilicus", "gluteal", "glabella", "toe_web",
]

# Map raw OSD-572 site abbreviations -> standardized site names.
# H20 (water blank) and OAC (single anomalous sample) are dropped at parse time.
SITE_ABBR_TO_NAME = {
    "ORC": "oral",            # oral cavity
    "NAC": "nasal",           # nasal cavity (anterior naris)
    "EAR": "post_auricular",  # behind the ear
    "PIT": "axillary",        # armpit
    "ARM": "forearm",         # volar forearm
    "NAP": "occiput",         # nape of neck (back-of-head proxy)
    "UMB": "umbilicus",       # belly button
    "GLU": "gluteal",         # gluteal crease
    "TZO": "glabella",        # T-zone (forehead between brows)
    "WEB": "toe_web",         # toe web space
}

DROP_SITE_ABBRS = {"H20", "OAC"}  # blanks / unknown — skip silently.

# Timepoints in display order. Microbiome has 8; CBC has 7 (no flight days).
MICROBIOME_TIMEPOINTS = ["L-92", "L-44", "L-3", "FD2", "FD3", "R+1", "R+45", "R+82"]
CBC_TIMEPOINTS = ["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"]
BASELINE_TIMEPOINTS = ["L-92", "L-44", "L-3"]

VALID_CREW = {"C001", "C002", "C003", "C004"}


@dataclass(frozen=True)
class MicrobiomeSample:
    crew: str          # e.g. "C001"
    timepoint: str     # e.g. "FD2"
    site: str          # standardized site name from SITES


# Format: <crew>_<timepoint>_<siteAbbr>
# Timepoints contain - and + (e.g. "L-92", "R+1"); the leading [LR] tells us
# we're in a timepoint segment. FD2/FD3 also valid.
_RE_MICROBIOME_SAMPLE = re.compile(
    r"^(?P<crew>C00\d)_(?P<tp>L-\d+|FD\d|R\+\d+)_(?P<site>[A-Z0-9]+)$"
)


def parse_microbiome_sample(name: str) -> MicrobiomeSample | None:
    """Return a MicrobiomeSample, or None if the column should be skipped.

    Skip cases (returning None):
      - Drop-list site abbreviations (H20, OAC).
      - Unknown site abbreviation (logs nothing — caller should warn).
      - Timepoint not in MICROBIOME_TIMEPOINTS.
      - Crew not in VALID_CREW.
    """
    m = _RE_MICROBIOME_SAMPLE.match(name)
    if not m:
        return None
    crew = m.group("crew")
    tp = m.group("tp")
    site_abbr = m.group("site")
    if site_abbr in DROP_SITE_ABBRS:
        return None
    if crew not in VALID_CREW:
        return None
    if tp not in MICROBIOME_TIMEPOINTS:
        return None
    site = SITE_ABBR_TO_NAME.get(site_abbr)
    if site is None:
        return None
    return MicrobiomeSample(crew=crew, timepoint=tp, site=site)
