from mcp.server.auth.provider import AccessToken, TokenVerifier

from services.auth_service import decode_token


class ColiveTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        payload = decode_token(token)
        if not payload or payload.get("type") != "mcp":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        return AccessToken(
            token=token,
            client_id=str(user_id),
            scopes=["colive"],
            expires_at=payload.get("exp"),
            subject=str(user_id),
        )
