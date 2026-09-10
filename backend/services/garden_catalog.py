"""Versioned tier-one crop data, verified before use and never read from previews."""
from __future__ import annotations

from copy import deepcopy
from fractions import Fraction
from functools import lru_cache
import hashlib
import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "garden" / "tier1-v1"


def verify_manifest(directory: Path = DATA_DIR) -> dict:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    expected_files = {"crops.json", "rules.json", "acceptance.json", "validation.json", "README.md"}
    if set(manifest.get("files", {})) != expected_files:
        raise ValueError("Garden handoff manifest has unexpected files")
    if not manifest.get("data_complete") or not manifest.get("ready_for_backend"):
        raise ValueError("Garden handoff is not ready for backend integration")
    for name, expected in manifest["files"].items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Garden handoff checksum mismatch: {name}")
    return manifest


@lru_cache(maxsize=1)
def _load() -> tuple[dict, dict]:
    verify_manifest()
    catalog = json.loads((DATA_DIR / "crops.json").read_text(encoding="utf-8"))
    rules = json.loads((DATA_DIR / "rules.json").read_text(encoding="utf-8"))
    crops = catalog["crops"]
    if len(crops) != 12 or len({crop["id"] for crop in crops}) != 12:
        raise ValueError("Tier one requires exactly twelve distinct crops")
    if catalog["time_multiplier"] != 7 or rules["confirmed_rules"]["time_multiplier"] != 7:
        raise ValueError("Garden cultivation time must use sevenfold acceleration")
    for crop in crops:
        harvest = crop["harvest"]
        offsets = [Fraction(str(value)) for value in harvest["maturity_offsets_days"]]
        yields = harvest["yield_g_per_plot_by_batch"]
        if not offsets or len(offsets) != len(yields) or offsets[0] <= 0:
            raise ValueError(f"Invalid batch schedule: {crop['id']}")
        if any(right <= left for left, right in zip(offsets, offsets[1:])):
            raise ValueError(f"Non-increasing batch schedule: {crop['id']}")
        if any(not isinstance(value, int) or value <= 0 or value % 2 for value in yields):
            raise ValueError(f"Yield must be positive even grams: {crop['id']}")
        timing = crop["timing"]
        if timing["nursery_days"] + timing["growing_days_to_first"] != timing["first_harvest_days"]:
            raise ValueError(f"Nursery counted incorrectly: {crop['id']}")
        if offsets[0] != Fraction(str(timing["first_harvest_days"])):
            raise ValueError(f"First maturity does not match timing: {crop['id']}")
        if harvest["clock"] not in {"independent", "after_harvest"}:
            raise ValueError(f"Unknown batch clock: {crop['id']}")
        if harvest["end_behavior"] == "repeat_perennial_cycle":
            if harvest["clock"] != "independent" or harvest["repeat_cycle_days"] <= offsets[-1] - offsets[0]:
                raise ValueError(f"Invalid perennial cycle: {crop['id']}")
        factors = harvest.get("first_cycle_yield_factors_by_batch")
        if factors is not None and (len(factors) != len(offsets) or any(not 0 <= f <= 1 for f in factors)):
            raise ValueError(f"Invalid first-cycle yield factors: {crop['id']}")
        if not crop["care"]["preferred_months"] or any(month not in range(1, 13) for month in crop["care"]["preferred_months"]):
            raise ValueError(f"Invalid preferred months: {crop['id']}")
    return catalog, rules


def load_catalog() -> dict:
    return deepcopy(_load()[0])


def list_crops() -> list[dict]:
    return deepcopy(_load()[0]["crops"])


def get_crop(crop_id: str) -> dict:
    for crop in _load()[0]["crops"]:
        if crop["id"] == crop_id:
            return deepcopy(crop)
    raise ValueError("Unknown tier-one crop")


def get_rules() -> dict:
    return deepcopy(_load()[1])
