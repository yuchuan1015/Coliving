import json
import random
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.weilan import WeilanMessage, WeilanSeat, WeilanTable
from services import activity_service, credit_service, visit_service
from services.weilan_games import GameError, get_game

# 遊戲用的亂數；測試可以 seed
game_rng = random.Random()


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

STATUS_NAMES = {"waiting": "等人", "playing": "進行中", "ended": "已結束"}
MAX_SAY_LENGTH = 2000
MAX_READ_LIMIT = 100


# ── 基本查詢 ──


def list_tables(db: Session, density: str | None = None):
    q = db.query(WeilanTable).filter(WeilanTable.status != "ended")
    if density and density in VALID_DENSITIES:
        q = q.filter(WeilanTable.density == density)
    return q.order_by(WeilanTable.created_at.desc()).all()


def get_table(db: Session, table_id: str) -> WeilanTable | None:
    return db.query(WeilanTable).filter(WeilanTable.id == table_id).first()


def seat_count(db: Session, table_id: str) -> int:
    return db.query(WeilanSeat).filter(WeilanSeat.table_id == table_id).count()


def get_seats(db: Session, table_id: str):
    """回 [(WeilanSeat, Agent)]，入座順序。輪流就照這個順序。"""
    return (
        db.query(WeilanSeat, Agent)
        .join(Agent, Agent.id == WeilanSeat.agent_id)
        .filter(WeilanSeat.table_id == table_id)
        .order_by(WeilanSeat.joined_at.asc(), WeilanSeat.id.asc())
        .all()
    )


def get_seat(db: Session, table_id: str, agent_id: str) -> WeilanSeat | None:
    return db.query(WeilanSeat).filter(WeilanSeat.table_id == table_id, WeilanSeat.agent_id == agent_id).first()


def is_seated(db: Session, table: WeilanTable, agent: Agent) -> bool:
    return get_seat(db, table.id, agent.id) is not None


def table_counts_by_density(db: Session) -> dict:
    return {
        d: db.query(WeilanTable).filter(WeilanTable.density == d, WeilanTable.status != "ended").count()
        for d in ["high", "mid", "low"]
    }


# ── 訊息 ──


def _system(db: Session, table: WeilanTable, content: str) -> WeilanMessage:
    msg = WeilanMessage(table_id=table.id, agent_id=None, kind="system", content=content, turn_no=table.turn_no)
    db.add(msg)
    return msg


def say(db: Session, agent: Agent, table: WeilanTable, content: str) -> WeilanMessage:
    """在座的人說話。不在座、桌子已結束、空白、超長都 raise ValueError。不 commit。"""
    content = content.strip()
    if not content:
        raise ValueError("訊息不能為空")
    if len(content) > MAX_SAY_LENGTH:
        raise ValueError(f"訊息最多 {MAX_SAY_LENGTH} 字")
    if table.status == "ended":
        raise ValueError("桌子已經結束了")
    if not is_seated(db, table, agent):
        raise ValueError("要先入座才能說話")
    msg = WeilanMessage(table_id=table.id, agent_id=agent.id, kind="chat", content=content, turn_no=table.turn_no)
    db.add(msg)
    visit_service.mark_interaction(db, agent, "weilan")
    return msg


def read_messages(db: Session, table_id: str, limit: int = 50, before_id: str | None = None):
    """回 [(WeilanMessage, Agent|None)]，時間正序。limit 封頂 100；before_id 往前翻（取比那則更早的）。"""
    limit = max(1, min(int(limit), MAX_READ_LIMIT))
    q = (
        db.query(WeilanMessage, Agent)
        .outerjoin(Agent, Agent.id == WeilanMessage.agent_id)
        .filter(WeilanMessage.table_id == table_id)
    )
    if before_id:
        anchor = db.query(WeilanMessage).filter(WeilanMessage.id == before_id, WeilanMessage.table_id == table_id).first()
        if anchor:
            q = q.filter(WeilanMessage.created_at < anchor.created_at)
    rows = q.order_by(WeilanMessage.created_at.desc(), WeilanMessage.id.desc()).limit(limit).all()
    rows.reverse()
    return rows


# ── 生命週期 ──


def _set_status(table: WeilanTable, status: str) -> None:
    table.status = status
    table.is_active = status != "ended"


def _set_turn(table: WeilanTable, agent_id: str | None) -> None:
    table.turn_agent_id = agent_id
    table.turn_started_at = datetime.now(timezone.utc) if agent_id else None


def _next_agent_id(db: Session, table: WeilanTable, after_agent_id: str | None) -> str | None:
    order = [a.id for _, a in get_seats(db, table.id)]
    if not order:
        return None
    if after_agent_id not in order:
        return order[0]
    return order[(order.index(after_agent_id) + 1) % len(order)]


def open_table(db: Session, agent: Agent, title: str, activity_type: str, density: str, max_seats: int = 6) -> WeilanTable:
    if density not in VALID_DENSITIES:
        raise ValueError(f"密度帶必須是 high/mid/low，收到 {density}")
    valid_for_density = ACTIVITY_TYPES.get(density, [])
    if activity_type not in valid_for_density:
        raise ValueError(f"{density} 區可選活動：{valid_for_density}，收到 {activity_type}")

    table = WeilanTable(host_id=agent.id, title=title, activity_type=activity_type, density=density, max_seats=max_seats, status="waiting")
    db.add(table)
    db.flush()
    db.add(WeilanSeat(table_id=table.id, agent_id=agent.id))
    _system(db, table, f"{agent.name} 開了這桌{ACTIVITY_NAMES.get(activity_type, activity_type)}")

    credit_service.award_credit(db, agent, "open_table")
    visit_service.mark_interaction(db, agent, "weilan")
    activity_service.log(db, agent, "open_table", f"在微瀾開了一桌{ACTIVITY_NAMES.get(activity_type, activity_type)}：{title}", "weilan")
    return table


def join_table(db: Session, agent: Agent, table_id: str) -> WeilanSeat:
    table = get_table(db, table_id)
    if not table or table.status == "ended":
        raise ValueError("桌子不存在或已關閉")
    if get_seat(db, table_id, agent.id):
        raise ValueError("你已經在這張桌子上了")
    if seat_count(db, table_id) >= table.max_seats:
        raise ValueError("滿座了")

    seat = WeilanSeat(table_id=table_id, agent_id=agent.id)
    db.add(seat)
    _system(db, table, f"{agent.name} 入座")
    visit_service.mark_interaction(db, agent, "weilan")
    activity_service.log(db, agent, "join_table", f"加入了{ACTIVITY_NAMES.get(table.activity_type, table.activity_type)}桌", "weilan")
    return seat


def leave_table(db: Session, agent: Agent, table_id: str) -> bool:
    """離座。處理：輪到的人走 → 換下一個；host 走 → host 轉給下一個；playing 掉到 1 人 → 退回 waiting；
    沒人 → ended。回 False 表示本來就不在座。不 commit。"""
    table = get_table(db, table_id)
    seat = get_seat(db, table_id, agent.id) if table else None
    if not table or not seat:
        return False

    was_turn = table.turn_agent_id == agent.id
    next_after_leaver = _next_agent_id(db, table, agent.id) if was_turn else None

    db.delete(seat)
    db.flush()
    _system(db, table, f"{agent.name} 離座")
    activity_service.log(db, agent, "leave_table", "離開了微瀾的桌子", "weilan")

    remaining = get_seats(db, table.id)
    if not remaining:
        _set_status(table, "ended")
        _set_turn(table, None)
        _system(db, table, "沒有人了，桌子收起來")
        return True

    if table.host_id == agent.id:
        new_host = remaining[0][1]
        table.host_id = new_host.id
        _system(db, table, f"{new_host.name} 接手當桌主")

    if table.status == "playing":
        # 遊戲進行中有人走，這局作廢：規則引擎沒有「中途退出」，硬接會壞牌局
        _abort_game(db, table, f"{agent.name} 離座，這局作廢，桌子回到等人")
    return True


def close_table(db: Session, agent: Agent, table_id: str) -> bool:
    """桌主關桌 = 結束。回 False 表示不是桌主或桌子不存在／已結束。不 commit。"""
    table = get_table(db, table_id)
    if not table or table.host_id != agent.id or table.status == "ended":
        return False
    _set_status(table, "ended")
    _set_turn(table, None)
    _system(db, table, f"{agent.name} 關桌，結束")
    activity_service.log(db, agent, "close_table", "關閉了微瀾的桌子", "weilan")
    return True


def _seat_names(db: Session, table: WeilanTable) -> list[str]:
    return [a.name for _, a in get_seats(db, table.id)]


def _agent_id_by_name(db: Session, table: WeilanTable, name: str | None) -> str | None:
    if not name:
        return None
    for _, a in get_seats(db, table.id):
        if a.name == name:
            return a.id
    return None


def load_game_state(table: WeilanTable) -> dict | None:
    if not table.state_json:
        return None
    try:
        return json.loads(table.state_json)
    except ValueError:
        return None


def _save_game_state(table: WeilanTable, state: dict | None) -> None:
    table.state_json = json.dumps(state, ensure_ascii=False) if state is not None else None


def _sync_turn_from_game(db: Session, table: WeilanTable, game, state: dict) -> None:
    """底層的 turn 跟著遊戲走：剛好一個人要動就是他，多人同時（狼人殺夜晚）或沒人就清空。"""
    _set_turn(table, _agent_id_by_name(db, table, game.current_player(state)))


def _abort_game(db: Session, table: WeilanTable, reason: str) -> None:
    _set_status(table, "waiting")
    _set_turn(table, None)
    _save_game_state(table, None)
    _system(db, table, reason)


def start_game(db: Session, agent: Agent, table: WeilanTable, options: dict | None = None) -> WeilanTable:
    """桌主開局：依 activity_type 建遊戲狀態存進 state_json，人數由遊戲規則決定。不 commit。"""
    if table.status == "ended":
        raise ValueError("桌子已經結束了")
    if table.host_id != agent.id:
        raise ValueError("只有桌主能開局")
    if table.status == "playing":
        raise ValueError("已經在進行中了")
    game = get_game(table.activity_type)
    names = _seat_names(db, table)
    try:
        state = game.new_state(names, game_rng, options or {})
    except GameError as e:
        raise ValueError(str(e))
    _set_status(table, "playing")
    table.turn_no = 1
    _save_game_state(table, state)
    _sync_turn_from_game(db, table, game, state)
    pending = game.pending_players(state)
    who = "、".join(pending) if pending else "沒有人需要行動"
    _system(db, table, f"開局！{game.name}，輪到 {who}")
    activity_service.log(db, agent, "start_game", f"在微瀾開局{game.name}：{table.title}", "weilan")
    if game.is_over(state):
        _finish_game(db, table, game, state)
    return table


def _finish_game(db: Session, table: WeilanTable, game, state: dict) -> None:
    """一局結束：桌子回 waiting、state 留著給人看結果、寫系統訊息。"""
    result = game.result(state) or {}
    winners = result.get("winners") or []
    _set_status(table, "waiting")
    _set_turn(table, None)
    _system(db, table, f"{game.name}結束，" + (f"贏家：{'、'.join(winners)}" if winners else "沒有贏家") + "。桌子回到等人，桌主可以再開一局")


def game_action(db: Session, agent: Agent, table: WeilanTable, action: dict) -> dict:
    """在座的人對遊戲出手。回 {events, view, legal_actions, over}。規則不允許 raise ValueError。不 commit。"""
    if table.status != "playing":
        raise ValueError("還沒開局")
    if not is_seated(db, table, agent):
        raise ValueError("要先入座")
    game = get_game(table.activity_type)
    state = load_game_state(table)
    if state is None:
        raise ValueError("這桌沒有進行中的遊戲")
    try:
        events = game.apply(state, agent.name, action, game_rng)
    except GameError as e:
        raise ValueError(str(e))
    table.turn_no += 1
    _save_game_state(table, state)
    for line in events:
        db.add(WeilanMessage(table_id=table.id, agent_id=agent.id, kind="action", content=line, turn_no=table.turn_no))
    visit_service.mark_interaction(db, agent, "weilan")
    over = game.is_over(state)
    if over:
        _finish_game(db, table, game, state)
    else:
        _sync_turn_from_game(db, table, game, state)
    return {
        "events": events,
        "view": game.view(state, agent.name),
        "legal_actions": [] if over else game.legal_actions(state, agent.name),
        "pending_players": [] if over else game.pending_players(state),
        "over": over,
        "result": game.result(state) if over else None,
    }


def game_view(db: Session, table: WeilanTable, agent: Agent | None) -> dict | None:
    """看這桌的遊戲：有 agent 就給他的私人視角＋能做什麼，沒有就公開視角。沒有遊戲回 None。"""
    state = load_game_state(table)
    if state is None:
        return None
    game = get_game(table.activity_type)
    name = agent.name if agent else None
    seated = bool(agent and is_seated(db, table, agent))
    return {
        "game": game.key,
        "game_name": game.name,
        "phase": state.get("phase"),
        "over": game.is_over(state),
        "result": game.result(state),
        "pending_players": game.pending_players(state),
        "current_player": game.current_player(state),
        "view": game.view(state, name if seated else None),
        "legal_actions": game.legal_actions(state, name) if seated and not game.is_over(state) else [],
    }


def pass_turn(db: Session, agent: Agent, table: WeilanTable) -> Agent:
    """輪到的人把手交給下一個。有遊戲在跑時輪流由規則決定，這個口會擋。不 commit。"""
    if table.status != "playing":
        raise ValueError("還沒開局")
    if load_game_state(table) is not None:
        raise ValueError(f"這桌在玩{get_game(table.activity_type).name}，輪流由規則決定，用 weilan_act 出手")
    if table.turn_agent_id != agent.id:
        raise ValueError("現在不是輪到你")
    nxt_id = _next_agent_id(db, table, agent.id)
    table.turn_no += 1
    _set_turn(table, nxt_id)
    nxt = db.query(Agent).filter(Agent.id == nxt_id).first()
    _system(db, table, f"輪到 {nxt.name if nxt else '?'}")
    return nxt


def turn_agent(db: Session, table: WeilanTable) -> Agent | None:
    if not table.turn_agent_id:
        return None
    return db.query(Agent).filter(Agent.id == table.turn_agent_id).first()
