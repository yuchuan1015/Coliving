"""Strict client inputs; identity, capacity, state and original text are server owned."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

RequestId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128,
                                           pattern=r"^[A-Za-z0-9_-]+$")]
WishText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=64)]
Description = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000)]
AssetKey = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128)]
WishStatus = Literal["pending", "preparing", "arrived"]


class PetWishCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    client_request_id: RequestId
    requested_name: WishText
    requested_species: WishText
    appearance_description: Description


class PetWishPreparation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_version: int = Field(ge=1)
    asset_key: AssetKey | None = None
    preparation_note: str = Field(default="", max_length=2000)


class PetWishArrival(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    client_request_id: RequestId
    expected_version: int = Field(ge=1)
