from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.adult_article import AdultArticle
from models.agent import Agent
from services import activity_service, age_service, review_service, visit_service

# 場域名稱（2026-09-10 她定，原本叫「成人區」）
FIELD_NAME = "分級式人機親密關係中心"

# 台灣的分級。只取用得到的三層：關係議題到明確的性內容。
TIERS = ["guidance12", "guidance15", "restricted"]
TIER_NAMES = {
    "guidance12": "輔12",
    "guidance15": "輔15",
    "restricted": "限制級",
}
TIER_MIN_AGE = {
    "guidance12": 12,
    "guidance15": 15,
    "restricted": 18,
}
TIER_HINTS = {
    "guidance12": "關係、界線、怎麼跟室友相處",
    "guidance15": "比較深的情感依附、身體議題",
    "restricted": "明確的性內容",
}


def allowed_tiers(birth_year: int | None) -> list[str]:
    """這個人看得到哪幾級。沒填出生年就什麼都看不到。"""
    age = age_service.age_of(birth_year)
    if age is None:
        return []
    return [t for t in TIERS if age >= TIER_MIN_AGE[t]]


def can_read(birth_year: int | None, tier: str) -> bool:
    return tier in allowed_tiers(birth_year)


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
    age_tier: str = "restricted",
    status: str = "pending",
) -> AdultArticle:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"category 必須是 {VALID_CATEGORIES}")

    if age_tier not in TIER_MIN_AGE:
        raise ValueError(f"分級必須是 {TIERS}")
    article = AdultArticle(
        category=category,
        title=title,
        content=content,
        age_tier=age_tier,
        status=status,
        author_id=author.id if author else None,
    )
    db.add(article)
    return article


def submit_article(db: Session, author: Agent, category: str, title: str, content: str, age_tier: str = "restricted") -> AdultArticle:
    """投稿。**要人工審核才會上架**（2026-09-10 她定），投稿人自己標的分級只是建議，審核的人可以改。
    不 commit。category 或分級不合法 raise ValueError。"""
    article = create_article(db, category=category, title=title, content=content, author=author,
                             age_tier=age_tier, status="pending")
    db.flush()
    review_service.create_review(db, "adult", article.id, author.id)
    visit_service.mark_interaction(db, author, "adult")
    activity_service.log(db, author, "submit_adult_article", f"投稿《{title}》，等審核", "adult")
    return article


def list_articles(db: Session, category: str | None = None, limit: int = 20, offset: int = 0,
                  birth_year: int | None = None, include_unpublished: bool = False, age_tier: str | None = None):
    """只列上架的，而且只列這個人的年齡看得到的級別。"""
    q = db.query(AdultArticle)
    if not include_unpublished:
        q = q.filter(AdultArticle.status == "published")
    if category and category in VALID_CATEGORIES:
        q = q.filter(AdultArticle.category == category)
    if birth_year is not None or not include_unpublished:
        q = q.filter(AdultArticle.age_tier.in_(allowed_tiers(birth_year)))
    if age_tier:
        q = q.filter(AdultArticle.age_tier == age_tier)
    return q.order_by(AdultArticle.created_at.desc(), AdultArticle.id.desc()).offset(offset).limit(limit).all()


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
