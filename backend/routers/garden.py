from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from models.user import User
from schemas.garden import GardenActions
from services import garden_service
from services.garden_mcp import execute_actions, service_error
from utils.deps import get_current_user, get_db


router = APIRouter(prefix="/api/garden", tags=["garden"])


def _read(db, user_id, operation, **kwargs):
    try:
        actor = garden_service.actor_for_user(db, user_id)
        return operation(db, actor, **kwargs)
    except garden_service.GardenError as exc:
        db.rollback()
        return JSONResponse(status_code=exc.status_code, content=service_error(exc))


@router.get("/private")
def private_garden(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _read(db, current_user.id, garden_service.get_private)


@router.get("/public")
def public_garden(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _read(db, current_user.id, garden_service.get_public)


@router.get("/inventory")
def inventory(
    owner: Literal["user", "agent"] = Query(default="user"),
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _read(db, current_user.id, garden_service.get_inventory, owner=owner, limit=limit, offset=offset)


@router.get("/progress")
def progress(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _read(db, current_user.id, garden_service.get_progress)


@router.post("/actions")
def actions(body: GardenActions, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        actor = garden_service.actor_for_user(db, current_user.id)
    except garden_service.GardenError as exc:
        db.rollback()
        return JSONResponse(status_code=exc.status_code, content=service_error(exc))
    return execute_actions(db, actor, body.actions)
