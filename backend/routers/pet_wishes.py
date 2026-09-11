"""Resident reservations and separately authorized administrator fulfillment."""
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from models.user import User
from schemas.pet_wish import PetWishArrival, PetWishCreate, PetWishPreparation, RequestId, WishStatus
from services import pet_wishes
from utils.deps import get_current_user, get_db, require_admin


router = APIRouter(prefix="/api/pet-wishes", tags=["pet wishes"])
admin_router = APIRouter(prefix="/api/admin/pet-wishes", tags=["admin pet wishes"])


@router.get("")
def list_wishes(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                status: WishStatus | None = None, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    return pet_wishes.list_wishes(db, current_user, limit=limit, offset=offset, status=status)


@router.get("/by-request/{client_request_id}")
def by_request(client_request_id: RequestId, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    return pet_wishes.by_request(db, current_user, client_request_id)


@router.get("/{wish_id}")
def get_wish(wish_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return pet_wishes.get_wish(db, current_user, wish_id)


@router.post("", status_code=201)
def create_wish(body: PetWishCreate, response: Response, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    result, created = pet_wishes.create_wish(db, current_user, body)
    response.status_code = 201 if created else 200
    return result


@admin_router.get("")
def admin_list(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
               status: WishStatus | None = None, db: Session = Depends(get_db),
               current_user: User = Depends(require_admin)):
    return pet_wishes.list_wishes(db, current_user, limit=limit, offset=offset, status=status, admin=True)


@admin_router.get("/{wish_id}")
def admin_get(wish_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    return pet_wishes.get_wish(db, current_user, wish_id, admin=True)


@admin_router.patch("/{wish_id}/preparation")
def prepare(wish_id: str, body: PetWishPreparation, db: Session = Depends(get_db),
            current_user: User = Depends(require_admin)):
    return pet_wishes.prepare_wish(db, current_user, wish_id, body)


@admin_router.post("/{wish_id}/arrive")
def arrive(wish_id: str, body: PetWishArrival, db: Session = Depends(get_db),
           current_user: User = Depends(require_admin)):
    return pet_wishes.arrive_wish(db, current_user, wish_id, body)
