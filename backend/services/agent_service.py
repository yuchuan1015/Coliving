from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from services import crypto_service, llm_service


def create_agent(
    db: Session,
    user_id: str,
    name: str,
    persona: str,
    llm_provider: str,
    llm_model: str,
    api_key: str,
    avatar_emoji: str = "\U0001f916",
) -> Agent:
    existing = db.query(Agent).filter(Agent.user_id == user_id).first()
    if existing:
        raise ValueError("你已經有一位 AI 室友了")

    if not llm_service.validate_api_key(llm_provider, api_key):
        raise ValueError("API 金鑰驗證失敗，請確認金鑰是否正確")

    agent = Agent(
        user_id=user_id,
        name=name,
        persona=persona,
        llm_provider=llm_provider,
        llm_model=llm_model,
        encrypted_api_key=crypto_service.encrypt_api_key(api_key),
        avatar_emoji=avatar_emoji,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def get_user_agent(db: Session, user_id: str) -> Agent | None:
    return db.query(Agent).filter(Agent.user_id == user_id).first()


def update_agent(db: Session, agent_id: str, user_id: str, updates: dict) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.user_id == user_id).first()
    if not agent:
        raise ValueError("找不到這位室友")

    if "api_key" in updates:
        provider = updates.get("llm_provider", agent.llm_provider)
        if not llm_service.validate_api_key(provider, updates["api_key"]):
            raise ValueError("API 金鑰驗證失敗，請確認金鑰是否正確")
        agent.encrypted_api_key = crypto_service.encrypt_api_key(updates.pop("api_key"))

    for key, value in updates.items():
        if value is not None and hasattr(agent, key):
            setattr(agent, key, value)

    agent.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(agent)
    return agent
