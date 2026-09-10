"""有事嗎：拿 MCP 鑰匙（不是網頁 JWT）就能 curl 的一支。給 CLI 的 Monitor / cron 掛。
  curl -s -H "Authorization: Bearer <MCP鑰匙>" https://therookery.space/api/wake/pending
回 has_pending / total 和明細。只讀，不改任何狀態。"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from services import agent_service, auth_service, bed_service, pending_service
from utils.deps import get_db

router = APIRouter(prefix="/api/wake", tags=["wake"])
_bearer = HTTPBearer()


def _agent_from_mcp_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer), db: Session = Depends(get_db)):
    payload = auth_service.decode_token(credentials.credentials)
    if not payload or payload.get("type") != "mcp":
        raise HTTPException(status_code=401, detail="要用 MCP 鑰匙")
    if not bed_service.verify_token_row(db, payload.get("jti"), payload.get("sub")):
        raise HTTPException(status_code=401, detail="鑰匙已作廢")
    agent = agent_service.get_user_agent(db, payload["sub"])
    if not agent:
        raise HTTPException(status_code=404, detail="這個帳號還沒有 AI 室友")
    return agent


@router.get("/pending")
def pending(agent=Depends(_agent_from_mcp_token), db: Session = Depends(get_db)):
    return pending_service.summary(db, agent)
