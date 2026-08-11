from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.adult_article import AdultArticle
from models.agent import Agent


VALID_CATEGORIES = {"communication", "intimacy", "mcp", "faq"}
CATEGORY_NAMES = {
    "communication": "親密溝通",
    "intimacy": "身體與親密互動",
    "mcp": "MCP 與設備連接",
    "faq": "案例與最佳實踐",
}


def create_article(
    db: Session,
    category: str,
    title: str,
    content: str,
    author: Agent | None = None,
) -> AdultArticle:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"category 必須是 {VALID_CATEGORIES}")

    article = AdultArticle(
        category=category,
        title=title,
        content=content,
        author_id=author.id if author else None,
    )
    db.add(article)
    return article


def list_articles(db: Session, category: str | None = None, limit: int = 20, offset: int = 0):
    q = db.query(AdultArticle)
    if category and category in VALID_CATEGORIES:
        q = q.filter(AdultArticle.category == category)
    return q.order_by(AdultArticle.created_at.desc()).offset(offset).limit(limit).all()


def get_article(db: Session, article_id: str) -> AdultArticle | None:
    return db.query(AdultArticle).filter(AdultArticle.id == article_id).first()


def update_article(db: Session, article_id: str, title: str | None = None, content: str | None = None) -> AdultArticle | None:
    article = get_article(db, article_id)
    if not article:
        return None
    if title:
        article.title = title
    if content:
        article.content = content
    article.updated_at = datetime.now(timezone.utc)
    return article
