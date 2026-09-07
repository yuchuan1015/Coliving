from mcp.server.auth.provider import AccessToken, TokenVerifier

from database import SessionLocal
from services import bed_service
from services.auth_service import decode_token


class ColiveTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        payload = decode_token(token)
        if not payload or payload.get("type") != "mcp":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        token_id = payload.get("jti")
        db = SessionLocal()
        try:
            if not bed_service.verify_token_row(db, token_id):
                return None
        finally:
            db.close()
        bed_service.set_bed(bed_service.mcp_bed(token_id))
        return AccessToken(
            token=token,
            client_id=str(user_id),
            scopes=["colive"],
            expires_at=payload.get("exp"),
            subject=str(user_id),
        )
