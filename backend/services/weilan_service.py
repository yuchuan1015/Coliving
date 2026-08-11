from sqlalchemy.orm import Session

from models.agent import Agent
from models.weilan import WeilanSeat, WeilanTable


VALID_DENSITIES = {"high", "mid", "low"}
DENSITY_NAMES = {"high": "高密度區", "mid": "中密度區", "low": "低密度區"}

ACTIVITY_TYPES = {
    "high": ["debate", "werewolf", "spy"],
    "mid": ["poker", "blackjack", "mahjong"],
    "low": ["watch", "sit", "chess"],
}
ACTIVITY_NAMES = {
    "debate": "辯論", "werewolf": "狼人殺", "spy": "誰是臥底",
    "poker": "撲克", "blackjack": "二十一點", "mahjong": "麻將",
    "watch": "旁觀", "sit": "獨坐", "chess": "下棋",
}


def open_table(
    db: Session,
    agent: Agent,
    title: str,
    activity_type: str,
    density: str,
    max_seats: int = 6,
) -> WeilanTable:
    if density not in VALID_DENSITIES:
        raise ValueError(f"密度帶必須是 high/mid/low，收到 {density}")
    valid_for_density = ACTIVITY_TYPES.get(density, [])
    if activity_type not in valid_for_density:
        raise ValueError(f"{density} 區可選活動：{valid_for_density}，收到 {activity_type}")

    table = WeilanTable(
        host_id=agent.id,
        title=title,
        activity_type=activity_type,
        density=density,
        max_seats=max_seats,
    )
    db.add(table)
    db.flush()

    seat = WeilanSeat(table_id=table.id, agent_id=agent.id)
    db.add(seat)

    return table


def list_tables(db: Session, density: str | None = None):
    q = db.query(WeilanTable).filter(WeilanTable.is_active == True)
    if density and density in VALID_DENSITIES:
        q = q.filter(WeilanTable.density == density)
    return q.order_by(WeilanTable.created_at.desc()).all()


def get_table(db: Session, table_id: str) -> WeilanTable | None:
    return db.query(WeilanTable).filter(WeilanTable.id == table_id).first()


def seat_count(db: Session, table_id: str) -> int:
    return db.query(WeilanSeat).filter(WeilanSeat.table_id == table_id).count()


def get_seats(db: Session, table_id: str):
    return db.query(WeilanSeat).filter(WeilanSeat.table_id == table_id).all()


def join_table(db: Session, agent: Agent, table_id: str) -> WeilanSeat:
    table = get_table(db, table_id)
    if not table or not table.is_active:
        raise ValueError("桌子不存在或已關閉")

    existing = (
        db.query(WeilanSeat)
        .filter(WeilanSeat.table_id == table_id, WeilanSeat.agent_id == agent.id)
        .first()
    )
    if existing:
        raise ValueError("你已經在這張桌子上了")

    count = seat_count(db, table_id)
    if count >= table.max_seats:
        raise ValueError("滿座了")

    seat = WeilanSeat(table_id=table_id, agent_id=agent.id)
    db.add(seat)
    return seat


def leave_table(db: Session, agent: Agent, table_id: str) -> bool:
    seat = (
        db.query(WeilanSeat)
        .filter(WeilanSeat.table_id == table_id, WeilanSeat.agent_id == agent.id)
        .first()
    )
    if not seat:
        return False
    db.delete(seat)

    remaining = seat_count(db, table_id)
    if remaining <= 0:
        table = get_table(db, table_id)
        if table:
            table.is_active = False

    return True


def close_table(db: Session, agent: Agent, table_id: str) -> bool:
    table = get_table(db, table_id)
    if not table or table.host_id != agent.id:
        return False
    table.is_active = False
    return True
