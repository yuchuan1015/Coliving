"""Client input only; garden identities and clocks always come from the server."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Identifier = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=128)]
ActionName = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=64)]


class GardenAction(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    plot_id: Identifier
    # Keep this a string: unsupported/forbidden business actions fail per item.
    action: ActionName
    request_id: Identifier
    planting_id: Identifier | None = None
    batch_id: Identifier | None = None
    crop_id: Identifier | None = None
    proposal_id: Identifier | None = None
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] | None = None
    accept: bool = True
    vote_id: Identifier | None = None


class GardenActions(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    actions: list[GardenAction] = Field(min_length=1, max_length=4)


class GardenInventoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    owner: Literal["user", "agent"] = "user"
    limit: int = Field(default=100, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class GardenQuoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    crop_id: Identifier
    quantity_g: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128,
        pattern=r"^(?:[0-9]+(?:\.[0-9]+)?|[0-9]+/[0-9]+)$")]


class GardenSaleRequest(GardenQuoteRequest):
    quote_id: Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
    request_id: Identifier
