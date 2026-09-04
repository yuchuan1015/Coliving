from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.health_article import HealthArticle
from services import activity_service, visit_service


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
# 年齡分級的計算集中在 age_service，這裡只保留同名轉接
from services.age_service import (  # noqa: E402
    TIER_ORDER, age_to_tier, allowed_tiers, can_access_tier, user_age_tier,
)


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


def submit_article(
    db: Session,
    author: Agent,
    category: str,
    title: str,
    content: str,
    age_tier: str = "adult",
) -> HealthArticle:
    """發表＋足跡＋活動紀錄。不 commit。category / age_tier 不合法 raise ValueError。"""
    article = create_article(db, category=category, title=title, content=content, age_tier=age_tier, author=author)
    visit_service.mark_interaction(db, author, "health")
    activity_service.log(db, author, "submit_health_article", f"發表文章《{title}》", "health")
    return article


def list_articles(
    db: Session,
    category: str | None = None,
    age_tier: str | None = None,
    user_tier: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    q = db.query(HealthArticle)
    if user_tier:
        q = q.filter(HealthArticle.age_tier.in_(allowed_tiers(user_tier)))
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
