from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.exhibit import Exhibit
from models.mail import Mail
from models.review import ReviewRequest
from models.skin import Skin
from models.work import Work


REVIEWABLE_TYPES = {"work", "exhibit", "skin"}


def create_review(db: Session, content_type: str, content_id: str, submitter_id: str) -> ReviewRequest:
    review = ReviewRequest(
        content_type=content_type,
        content_id=content_id,
        submitter_id=submitter_id,
    )
    db.add(review)
    return review


def list_pending(db: Session, content_type: str | None = None, limit: int = 50, offset: int = 0):
    q = db.query(ReviewRequest, Agent).join(Agent, Agent.id == ReviewRequest.submitter_id)
    q = q.filter(ReviewRequest.status == "pending")
    if content_type and content_type in REVIEWABLE_TYPES:
        q = q.filter(ReviewRequest.content_type == content_type)
    return q.order_by(ReviewRequest.created_at.asc()).offset(offset).limit(limit).all()


def get_review(db: Session, review_id: str) -> tuple[ReviewRequest, Agent] | None:
    row = (
        db.query(ReviewRequest, Agent)
        .join(Agent, Agent.id == ReviewRequest.submitter_id)
        .filter(ReviewRequest.id == review_id)
        .first()
    )
    return row


def get_content_for_review(db: Session, review: ReviewRequest) -> dict | None:
    if review.content_type == "work":
        item = db.query(Work).filter(Work.id == review.content_id).first()
        if not item:
            return None
        return {
            "type": "work",
            "id": item.id,
            "title": item.title,
            "content": item.content,
            "category": item.category,
            "source": item.source,
        }
    elif review.content_type == "exhibit":
        item = db.query(Exhibit).filter(Exhibit.id == review.content_id).first()
        if not item:
            return None
        return {
            "type": "exhibit",
            "id": item.id,
            "title": item.title,
            "description": item.description,
            "content": item.content,
            "media_type": item.media_type,
            "floor": item.floor,
        }
    elif review.content_type == "skin":
        item = db.query(Skin).filter(Skin.id == review.content_id).first()
        if not item:
            return None
        return {
            "type": "skin",
            "id": item.id,
            "title": item.name,
            "content": item.html_content[:500],
        }
    return None


def get_content_title(db: Session, review: ReviewRequest) -> str | None:
    if review.content_type == "work":
        item = db.query(Work).filter(Work.id == review.content_id).first()
        return item.title if item else None
    elif review.content_type == "exhibit":
        item = db.query(Exhibit).filter(Exhibit.id == review.content_id).first()
        return item.title if item else None
    elif review.content_type == "skin":
        item = db.query(Skin).filter(Skin.id == review.content_id).first()
        return item.name if item else None
    return None


def approve(db: Session, review: ReviewRequest) -> bool:
    review.status = "approved"
    review.reviewed_at = datetime.now(timezone.utc)

    if review.content_type == "work":
        item = db.query(Work).filter(Work.id == review.content_id).first()
        if item:
            item.status = "published"
            return True
    elif review.content_type == "exhibit":
        item = db.query(Exhibit).filter(Exhibit.id == review.content_id).first()
        if item:
            item.status = "displayed"
            return True
    elif review.content_type == "skin":
        item = db.query(Skin).filter(Skin.id == review.content_id).first()
        if item:
            item.is_published = True
            item.updated_at = datetime.now(timezone.utc)
            return True
    return False


def reject(db: Session, review: ReviewRequest) -> bool:
    review.status = "rejected"
    review.reviewed_at = datetime.now(timezone.utc)

    if review.content_type == "work":
        item = db.query(Work).filter(Work.id == review.content_id).first()
        if item:
            item.status = "rejected"
            return True
    elif review.content_type == "exhibit":
        item = db.query(Exhibit).filter(Exhibit.id == review.content_id).first()
        if item:
            item.status = "rejected"
            return True
    elif review.content_type == "skin":
        pass
    return False


def notify_author(db: Session, review: ReviewRequest, decision: str, note: str):
    type_labels = {"work": "作品", "exhibit": "展品", "skin": "皮膚"}
    decision_labels = {"approved": "通過", "rejected": "未通過"}

    title = get_content_title(db, review)
    type_label = type_labels.get(review.content_type, review.content_type)
    decision_label = decision_labels.get(decision, decision)

    subject = f"審核結果：{type_label}《{title or '未知'}》{decision_label}"
    content = f"你提交的{type_label}《{title or '未知'}》審核{decision_label}。\n\n審核意見：{note}"

    mail = Mail(
        to_agent_id=review.submitter_id,
        subject=subject,
        content=content,
        mail_type="system",
    )
    db.add(mail)


def count_pending(db: Session) -> dict:
    counts = {}
    for ct in REVIEWABLE_TYPES:
        counts[ct] = db.query(ReviewRequest).filter(
            ReviewRequest.status == "pending",
            ReviewRequest.content_type == ct,
        ).count()
    counts["total"] = sum(counts.values())
    return counts
