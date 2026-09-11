"""One capacity calculation for ordinary adoption and irrevocable pet wishes."""
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from models.agent import Agent
from models.pet import Pet
from models.user import User


def lock_agent(db: Session, agent_id: str) -> Agent | None:
    db.flush()
    locked = db.execute(update(Agent).where(Agent.id == agent_id, Agent.status == "active",
        Agent.user_id.in_(select(User.id).where(User.is_active.is_(True))))
        .values(credit_total=Agent.credit_total).execution_options(synchronize_session=False))
    if locked.rowcount != 1:
        return None
    return db.get(Agent, agent_id, populate_existing=True)


def get_capacity(db: Session, agent: Agent) -> dict:
    from models.pet_wish import PetWish
    from services.pet_service import get_max_pets
    maximum = get_max_pets(agent)
    active = db.query(Pet).filter(Pet.agent_id == agent.id, Pet.is_alive.is_(True)).count()
    reserved = db.query(PetWish).filter(PetWish.agent_id == agent.id,
        PetWish.status.in_(("pending", "preparing")), PetWish.pet_id.is_(None)).count()
    available = max(0, maximum - active - reserved)
    owner = db.get(User, agent.user_id, populate_existing=True)
    allowed = bool(owner is not None and owner.is_active and agent.status == "active" and available > 0)
    return {"max_pets": maximum, "active_pets": active, "reserved_pets": reserved,
            "occupied_pets": active + reserved, "available_slots": available,
            "can_adopt": allowed, "can_wish": allowed}


def valid_mcp_actor(db: Session, token: str, user_id: str, agent_id: str) -> bool:
    """Recheck credentials under the already-held capacity lock; never commit here."""
    from services import auth_service
    from models.mcp_token import McpToken
    from models.oauth import OAuthGrant
    payload = auth_service.decode_token(token)
    if not payload or payload.get("sub") != user_id:
        return False
    user = db.get(User, user_id, populate_existing=True)
    agent = db.get(Agent, agent_id, populate_existing=True)
    if user is None or not user.is_active or agent is None or agent.user_id != user_id or agent.status != "active":
        return False
    if payload.get("type") == "mcp":
        key_id = payload.get("jti")
        if not key_id:
            return True  # Preserve the existing legacy-key contract.
        key = db.get(McpToken, key_id, populate_existing=True)
        return bool(key is not None and key.user_id == user_id and key.agent_id == agent_id and key.revoked_at is None)
    if payload.get("type") == "oauth":
        from services import oauth_service
        grant = db.get(OAuthGrant, payload.get("jti"), populate_existing=True) if payload.get("jti") else None
        return bool(grant is not None and grant.user_id == user_id and grant.revoked_at is None
                    and payload.get("aud") == oauth_service.resource_url()
                    and payload.get("client_id") == grant.client_id)
    return False
