"""Read-only trusted release registry; no client URLs, uploads, or generated assets."""
import json
from pathlib import Path
import re

REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "pets" / "assets.json"
KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
IMAGE_PATH = re.compile(r"/assets/pets/(?:[A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|webp|avif)\Z")


def _registry():
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if (not isinstance(data, dict) or data.get("schema_version") != 1
            or not isinstance(data.get("catalog_version"), str)
            or not 1 <= len(data["catalog_version"]) <= 128
            or not isinstance(data.get("assets"), list)):
        raise ValueError("寵物圖庫設定無效")
    return data


def get_assets() -> dict[str, dict]:
    items = {}
    seen = set()
    for raw in _registry()["assets"]:
        if not isinstance(raw, dict):
            raise ValueError("寵物圖庫項目無效")
        key = raw.get("asset_key")
        if not isinstance(key, str) or not KEY.fullmatch(key) or key in seen:
            raise ValueError("寵物圖庫識別無效或重複")
        seen.add(key)
        if raw.get("published") is not True:
            continue
        species, emoji, path = raw.get("species"), raw.get("emoji"), raw.get("image_url")
        if (not isinstance(species, str) or not species.strip() or not 1 <= len(species) <= 64
                or not isinstance(emoji, str) or not emoji.strip() or not 1 <= len(emoji) <= 8
                or not isinstance(path, str) or not IMAGE_PATH.fullmatch(path) or ".." in path):
            raise ValueError("已發布寵物圖庫項目無效")
        items[key] = {"asset_key": key, "species": species, "emoji": emoji, "image_url": path}
    return items


def get_asset(asset_key: str | None) -> dict | None:
    if not isinstance(asset_key, str) or not KEY.fullmatch(asset_key):
        return None
    return get_assets().get(asset_key)


def catalog() -> dict:
    return {"items": list(get_assets().values()), "catalog_version": _registry()["catalog_version"]}


def resolve_asset(species: str | None, emoji: str | None, asset_key: str | None) -> dict | None:
    if asset_key is not None:
        asset = get_asset(asset_key)
        if asset is None or (species not in (None, "") and species != asset["species"]) or (emoji not in (None, "") and emoji != asset["emoji"]):
            return None
        return asset
    matches = [a for a in get_assets().values() if a["species"] == species and a["emoji"] == emoji]
    return matches[0] if len(matches) == 1 else None
