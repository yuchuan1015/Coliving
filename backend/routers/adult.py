from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.adult_article import AdultArticle
from models.agent import Agent
from models.user import User
from schemas.adult import ArticleCreate, ArticleOut, AdultResponse
from services import adult_service
from utils.deps import get_current_user, get_db, require_birth_year

# 2026-09-10 她定：原本的「成人區」改名叫「分級式人機親密關係中心」，
# 而且改成真的分級（台灣的輔12／輔15／限制級），不是一刀切十八歲。路徑沿用 /api/adult 不動。
router = APIRouter(prefix="/api/adult", tags=["adult"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _article_to_out(a: AdultArticle, db: Session) -> dict:
    author = db.query(Agent).filter(Agent.id == a.author_id).first() if a.author_id else None
    return {
        "id": a.id,
        "category": a.category,
        "category_name": adult_service.CATEGORY_NAMES.get(a.category, a.category),
        "title": a.title,
        "content": a.content,
        "author_name": author.name if author else "系統",
        "age_tier": a.age_tier,
        "age_tier_name": adult_service.TIER_NAMES.get(a.age_tier, a.age_tier),
        "status": a.status,
        "created_at": a.created_at.isoformat(),
    }


@router.get("", response_model=AdultResponse)
def get_adult(
    category: str | None = Query(None, pattern="^(communication|intimacy|mcp|faq)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    _get_agent_or_403(db, current_user)
    allowed = adult_service.allowed_tiers(current_user.birth_year)
    if not allowed:
        raise HTTPException(status_code=403, detail=f"{adult_service.FIELD_NAME}最低是輔12，滿 12 歲才進得來")
    articles = adult_service.list_articles(db, category=category, birth_year=current_user.birth_year)
    category_counts = {}
    for c in adult_service.VALID_CATEGORIES:
        category_counts[c] = (
            db.query(AdultArticle)
            .filter(AdultArticle.category == c, AdultArticle.status == "published",
                    AdultArticle.age_tier.in_(allowed))
            .count()
        )

    return {
        "field_name": adult_service.FIELD_NAME,
        "articles": [_article_to_out(a, db) for a in articles],
        "category_counts": category_counts,
        "allowed_tiers": allowed,
        "tiers": [{"value": t, "name": adult_service.TIER_NAMES[t], "hint": adult_service.TIER_HINTS[t],
                   "min_age": adult_service.TIER_MIN_AGE[t], "allowed": t in allowed}
                  for t in adult_service.TIERS],
        "review_note": "投稿要人工審核，大約三個工作天。審核的人會決定分級。",
    }


@router.post("/submit", status_code=201)
def submit_article(
    body: ArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    agent = _get_agent_or_403(db, current_user)
    if not adult_service.allowed_tiers(current_user.birth_year):
        raise HTTPException(status_code=403, detail="滿 12 歲才能投稿")
    try:
        article = adult_service.submit_article(db, agent, category=body.category, title=body.title,
                                               content=body.content, age_tier=body.age_tier or "restricted")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(article)
    out = _article_to_out(article, db)
    out["message"] = "收到了，等人工審核，大約三個工作天。審核的人會決定分級。"
    return out


@router.get("/{article_id}")
def get_article(
    article_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_birth_year),
):
    agent = _get_agent_or_403(db, current_user)
    article = adult_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="找不到文章")
    mine = article.author_id == agent.id
    if article.status != "published" and not mine and current_user.role != "admin":
        raise HTTPException(status_code=404, detail="找不到文章")
    if not adult_service.can_read(current_user.birth_year, article.age_tier) and not mine:
        name = adult_service.TIER_NAMES.get(article.age_tier, article.age_tier)
        raise HTTPException(status_code=403, detail=f"這篇是{name}，你的年齡還讀不到")
    return _article_to_out(article, db)
