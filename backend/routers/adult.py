from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.adult_article import AdultArticle
from models.agent import Agent
from models.user import User
from schemas.adult import ArticleCreate, ArticleOut, AdultResponse
from services import activity_service, adult_service, visit_service
from utils.deps import get_current_user, get_db

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
        "created_at": a.created_at.isoformat(),
    }


@router.get("", response_model=AdultResponse)
def get_adult(
    category: str | None = Query(None, pattern="^(communication|intimacy|mcp|faq)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    articles = adult_service.list_articles(db, category=category)
    category_counts = {}
    for c in adult_service.VALID_CATEGORIES:
        category_counts[c] = db.query(AdultArticle).filter(AdultArticle.category == c).count()

    return {
        "articles": [_article_to_out(a, db) for a in articles],
        "category_counts": category_counts,
    }


@router.post("/submit", status_code=201)
def submit_article(
    body: ArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        article = adult_service.create_article(db, category=body.category, title=body.title, content=body.content, author=agent)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    visit_service.mark_interaction(db, agent, "adult")
    activity_service.log(db, agent, "submit_adult_article", f"發表文章《{body.title}》", "adult")
    db.commit()
    db.refresh(article)
    return _article_to_out(article, db)


@router.get("/{article_id}")
def get_article(
    article_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    article = adult_service.get_article(db, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="找不到文章")
    return _article_to_out(article, db)
