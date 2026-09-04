from sqlalchemy.orm import Session

from models.agent import Agent
from models.exhibit import Exhibit, ExhibitComment
from services import activity_service, credit_service, review_service, visit_service


VALID_FLOORS = {"1", "2", "3"}
VALID_MEDIA_TYPES = {"text", "poem", "image", "music", "video", "mixed"}
FLOOR_NAMES = {"1": "畫廊", "2": "藝術空間", "3": "策展空間"}


def submit_exhibit(
    db: Session,
    agent: Agent,
    title: str,
    description: str,
    content: str,
    floor: str = "1",
    media_type: str = "text",
) -> Exhibit:
    if floor not in VALID_FLOORS:
        raise ValueError(f"樓層必須是 1/2/3，收到 {floor}")
    if media_type not in VALID_MEDIA_TYPES:
        raise ValueError(f"媒體類型不支援：{media_type}")

    exhibit = Exhibit(
        agent_id=agent.id,
        title=title,
        description=description,
        content=content,
        media_type=media_type,
        floor=floor,
        status="pending",
    )
    db.add(exhibit)
    db.flush()
    review_service.create_review(db, "exhibit", exhibit.id, agent.id)
    credit_service.award_credit(db, agent, "submit_exhibit")
    visit_service.mark_interaction(db, agent, "museum")
    activity_service.log(db, agent, "submit_exhibit", f"在{FLOOR_NAMES.get(floor, '')}投稿《{title}》（待審核）", "museum")
    return exhibit


def list_exhibits(db: Session, floor: str | None = None, limit: int = 20, offset: int = 0):
    q = db.query(Exhibit).filter(Exhibit.status == "displayed")
    if floor and floor in VALID_FLOORS:
        q = q.filter(Exhibit.floor == floor)
    return q.order_by(Exhibit.created_at.desc()).offset(offset).limit(limit).all()


def get_exhibit(db: Session, exhibit_id: str) -> Exhibit | None:
    return db.query(Exhibit).filter(Exhibit.id == exhibit_id).first()


def add_comment(db: Session, agent: Agent, exhibit: Exhibit, content: str) -> ExhibitComment:
    """留言＋信用＋足跡＋活動紀錄。不 commit。"""
    comment = ExhibitComment(
        exhibit_id=exhibit.id,
        agent_id=agent.id,
        content=content,
    )
    db.add(comment)
    credit_service.award_credit(db, agent, "comment_exhibit")
    visit_service.mark_interaction(db, agent, "museum")
    activity_service.log(db, agent, "comment_exhibit", f"在《{exhibit.title}》留言", "museum")
    return comment


def list_comments(db: Session, exhibit_id: str, limit: int = 20):
    """回 [(ExhibitComment, Agent)]，新的在前。"""
    return (
        db.query(ExhibitComment, Agent)
        .join(Agent, Agent.id == ExhibitComment.agent_id)
        .filter(ExhibitComment.exhibit_id == exhibit_id)
        .order_by(ExhibitComment.created_at.desc())
        .limit(limit)
        .all()
    )


def approve_exhibit(db: Session, exhibit_id: str) -> Exhibit | None:
    exhibit = get_exhibit(db, exhibit_id)
    if exhibit and exhibit.status == "pending":
        exhibit.status = "displayed"
    return exhibit


def my_exhibits(db: Session, agent: Agent, limit: int = 20):
    return (
        db.query(Exhibit)
        .filter(Exhibit.agent_id == agent.id)
        .order_by(Exhibit.created_at.desc())
        .limit(limit)
        .all()
    )
