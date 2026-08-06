from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.invite_code import InviteCode
from models.user import User
from schemas.auth import CreateInviteCodeRequest, LoginRequest, RefreshRequest, RegisterRequest, TokenResponse
from schemas.user import AuthResponse, UserPublic
from services import auth_service, invite_service
from utils.deps import get_db, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="使用者名稱已被使用")

    try:
        invite = invite_service.validate_and_consume(req.invite_code, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = User(
        username=req.username,
        display_name=req.display_name or req.username,
        hashed_password=auth_service.hash_password(req.password),
        invite_code_id=invite.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return AuthResponse(
        user=UserPublic.model_validate(user),
        access_token=auth_service.create_access_token(user.id, user.username, user.role),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not auth_service.verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="帳號已停用")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    return AuthResponse(
        user=UserPublic.model_validate(user),
        access_token=auth_service.create_access_token(user.id, user.username, user.role),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    payload = auth_service.decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="無效的 refresh token")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="使用者不存在或已停用")

    return TokenResponse(
        access_token=auth_service.create_access_token(user.id, user.username, user.role),
        refresh_token=auth_service.create_refresh_token(user.id),
    )


@router.post("/invite-codes", status_code=status.HTTP_201_CREATED)
def create_invite_code(
    req: CreateInviteCodeRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    code = InviteCode(
        code=invite_service.generate_code(),
        label=req.label,
        max_uses=req.max_uses,
        created_by=admin.id,
    )
    db.add(code)
    db.commit()
    db.refresh(code)

    return {
        "id": code.id,
        "code": code.code,
        "label": code.label,
        "max_uses": code.max_uses,
        "used_count": code.used_count,
        "is_active": code.is_active,
        "created_at": code.created_at,
    }
