from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.health_article import HealthArticle


VALID_CATEGORIES = {"puberty", "menstrual", "autonomy", "agent_guide"}
CATEGORY_NAMES = {
    "puberty": "青春期與初經",
    "menstrual": "月經週期與經期照護",
    "autonomy": "身體自主與性教育",
    "agent_guide": "Agent 陪伴指南",
}

VALID_AGE_TIERS = {"child", "teen", "adult"}
AGE_TIER_NAMES = {
    "child": "兒童與初青春期",
    "teen": "青少年",
    "adult": "成年人",
}


def create_article(
    db: Session,
    category: str,
    title: str,
    content: str,
    age_tier: str = "adult",
    author: Agent | None = None,
) -> HealthArticle:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"category 必須是 {VALID_CATEGORIES}")
    if age_tier not in VALID_AGE_TIERS:
        raise ValueError(f"age_tier 必須是 {VALID_AGE_TIERS}")

    article = HealthArticle(
        category=category,
        title=title,
        content=content,
        age_tier=age_tier,
        author_id=author.id if author else None,
    )
    db.add(article)
    return article


def list_articles(
    db: Session,
    category: str | None = None,
    age_tier: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    q = db.query(HealthArticle)
    if category and category in VALID_CATEGORIES:
        q = q.filter(HealthArticle.category == category)
    if age_tier and age_tier in VALID_AGE_TIERS:
        q = q.filter(HealthArticle.age_tier == age_tier)
    return q.order_by(HealthArticle.created_at.desc()).offset(offset).limit(limit).all()


def get_article(db: Session, article_id: str) -> HealthArticle | None:
    return db.query(HealthArticle).filter(HealthArticle.id == article_id).first()


def update_article(
    db: Session,
    article_id: str,
    title: str | None = None,
    content: str | None = None,
    age_tier: str | None = None,
) -> HealthArticle | None:
    article = get_article(db, article_id)
    if not article:
        return None
    if title:
        article.title = title
    if content:
        article.content = content
    if age_tier and age_tier in VALID_AGE_TIERS:
        article.age_tier = age_tier
    article.updated_at = datetime.now(timezone.utc)
    return article
