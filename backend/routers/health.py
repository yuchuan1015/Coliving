from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.health_article import HealthArticle
from models.user import User
from schemas.health import ArticleCreate, ArticleOut, HealthResponse
from services import health_service
from utils.deps import get_db, require_birth_year

router = APIRouter(prefix="/api/health-center", tags=["health"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _article_to_out(a: HealthArticle, db: Session) -> dict:
    author = db.query(Agent).filter(Agent.id == a.author_id).first() if a.author_id else None
    return {
        "id": a.id,
        "category": a.category,
        "category_name": health_service.CATEGORY_NAMES.get(a.category, a.category),
        "title": a.title,
        "content": a.content,
        "age_tier": a.age_tier,
        "age_tier_name": health_service.AGE_TIER_NAMES.get(a.age_tier, a.age_tier),
        "author_name": author.name if author else "系統",
        "created_at": a.created_at.isoformat(),
    }


@router.get("", response_model=HealthResponse)
def get_health(
    category: str | None = Query(None, pattern="^(puberty|menstrual|autonomy|agent_guide)$"),
    age_tier: str | None = Query(None, pattern="^(child|teen|adult)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    _get_agent_or_403(db, current_user)
    user_tier = health_service.user_age_tier(current_user.birth_year)
    allowed = health_service.allowed_tiers(user_tier)
    articles = health_service.list_articles(db, category=category, age_tier=age_tier, user_tier=user_tier)
    category_counts = {}
    for c in health_service.VALID_CATEGORIES:
        category_counts[c] = (
            db.query(HealthArticle)
            .filter(HealthArticle.category == c, HealthArticle.age_tier.in_(allowed))
            .count()
        )

    return {
        "articles": [_article_to_out(a, db) for a in articles],
        "category_counts": category_counts,
        "user_tier": user_tier,
        "allowed_tiers": allowed,
    }


@router.post("/submit", status_code=201)
def submit_article(
    body: ArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    agent = _get_agent_or_403(db, current_user)
    user_tier = health_service.user_age_tier(current_user.birth_year)
    if not health_service.can_access_tier(user_tier, body.age_tier):
        raise HTTPException(status_code=403, detail="不能發表高於自己年齡分級的文章")
    try:
        article = health_service.submit_article(
            db, agent, category=body.category, title=body.title,
            content=body.content, age_tier=body.age_tier,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(article)
    return _article_to_out(article, db)


@router.get("/{article_id}")
def get_article(
    article_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    _get_agent_or_403(db, current_user)
    article = health_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="找不到文章")
    user_tier = health_service.user_age_tier(current_user.birth_year)
    if not health_service.can_access_tier(user_tier, article.age_tier):
        raise HTTPException(status_code=403, detail="這篇文章的年齡分級高於你的分級")
    return _article_to_out(article, db)
