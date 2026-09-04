from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database import SessionLocal
from models.user import User
from services.auth_service import decode_token

security = HTTPBearer()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)

    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="無效的 token")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="使用者不存在或已停用")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理員權限")
    return current_user


def require_adult(current_user: User = Depends(get_current_user)) -> User:
    from services import age_service
    if not current_user.birth_year:
        raise HTTPException(status_code=403, detail="需要設定出生年份才能進入此區域")
    if not age_service.is_adult(current_user.birth_year):
        raise HTTPException(status_code=403, detail="此區域僅限 18 歲以上使用者")
    return current_user


def require_birth_year(current_user: User = Depends(get_current_user)) -> User:
    """有填出生年就放行，分級由各場域自己算。給女性健康中心這種分級區用。"""
    if not current_user.birth_year:
        raise HTTPException(status_code=403, detail="需要設定出生年份才能進入此區域")
    return current_user
