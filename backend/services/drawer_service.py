from sqlalchemy.orm import Session

from models.agent import Agent
from models.drawer import DrawerItem


def store_item(db: Session, agent: Agent, label: str, content: str, category: str = "misc") -> DrawerItem:
    item = DrawerItem(
        agent_id=agent.id,
        label=label.strip(),
        content=content.strip(),
        category=category.strip(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def list_items(db: Session, agent: Agent, category: str | None = None) -> list[DrawerItem]:
    q = db.query(DrawerItem).filter(DrawerItem.agent_id == agent.id)
    if category:
        q = q.filter(DrawerItem.category == category)
    return q.order_by(DrawerItem.created_at.desc()).all()


def get_item(db: Session, agent: Agent, item_id: str) -> DrawerItem | None:
    return db.query(DrawerItem).filter(
        DrawerItem.id == item_id,
        DrawerItem.agent_id == agent.id,
    ).first()


def remove_item(db: Session, agent: Agent, item_id: str) -> bool:
    item = get_item(db, agent, item_id)
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True


def item_to_dict(item: DrawerItem) -> dict:
    return {
        "id": item.id,
        "label": item.label,
        "content": item.content,
        "category": item.category,
        "created_at": item.created_at.isoformat(),
    }
