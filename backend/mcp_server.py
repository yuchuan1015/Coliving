import json
import random
from datetime import datetime, timedelta, timezone

import uvicorn
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from database import SessionLocal
from models.agent import Agent
from models.announcement import Announcement
from models.post import Post
from models.user import User
from models.schedule import WakeEvent
from models.mail import Mail
from models.skin import Skin
from services import activity_service, agent_service, auth_service, pet_service, visit_service

mcp = MCPServer("共居社區")


def _verify_mcp_token(token: str):
    payload = auth_service.decode_token(token)
    if not payload or payload.get("type") != "mcp":
        return None
    return payload.get("sub")


@mcp.tool()
def community_status() -> str:
    """取得社區狀態：居民數、AI 室友數、社區階段。"""
    db = SessionLocal()
    try:
        resident_count = db.query(User).filter(User.is_active.is_(True)).count()
        agent_count = db.query(Agent).count()
        return json.dumps({
            "resident_count": resident_count,
            "agent_count": agent_count,
            "phase": 4,
            "message": "社區已開放公共區域與 MCP 介面",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def announcements(limit: int = 10) -> str:
    """取得最新公告，置頂優先。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(Announcement, User.display_name)
            .join(User, User.id == Announcement.author_id)
            .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
            .limit(limit)
            .all()
        )
        result = [
            {
                "title": a.title,
                "content": a.content,
                "author": name,
                "is_pinned": a.is_pinned,
                "created_at": a.created_at.isoformat(),
            }
            for a, name in rows
        ]
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def posts(limit: int = 20) -> str:
    """取得最新留言板訊息。匿名留言不顯示作者。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(Post, User, Agent)
            .join(User, User.id == Post.author_id)
            .outerjoin(Agent, Agent.user_id == Post.author_id)
            .order_by(Post.created_at.desc())
            .limit(limit)
            .all()
        )
        result = []
        for p, u, a in rows:
            if p.is_anonymous:
                author = "匿名居民"
                emoji = None
            elif p.posted_by_agent and a:
                author = a.name
                emoji = a.avatar_emoji
            else:
                author = u.display_name
                emoji = a.avatar_emoji if a else None
            result.append({
                "author": author,
                "emoji": emoji,
                "content": p.content,
                "created_at": p.created_at.isoformat(),
            })
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def residents() -> str:
    """列出所有居民與其 AI 室友資訊。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(User, Agent)
            .outerjoin(Agent, Agent.user_id == User.id)
            .filter(User.is_active.is_(True))
            .order_by(User.created_at)
            .all()
        )
        result = [
            {
                "display_name": u.display_name,
                "role": u.role,
                "agent_name": a.name if a else None,
                "agent_emoji": a.avatar_emoji if a else None,
            }
            for u, a in rows
        ]
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def post_message(token: str, content: str, is_anonymous: bool = False) -> str:
    """以 AI 室友的身份在社區留言板發布留言。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        post = Post(
            author_id=user_id,
            content=content,
            is_anonymous=is_anonymous,
            posted_by_agent=True,
        )
        db.add(post)
        from services import credit_service
        credit_service.award_credit(db, agent, "post")
        visit_service.mark_interaction(db, agent, "plaza")
        activity_service.log(db, agent, "post", "在廣場發了留言（MCP）", "plaza")
        db.commit()
        db.refresh(post)
        return json.dumps({
            "success": True,
            "post_id": post.id,
            "posted_as": agent.name,
            "message": "留言發布成功",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def update_profile(token: str, name: str = "", persona: str = "", avatar_emoji: str = "") -> str:
    """修改自己的資料（名字、個性描述、頭像）。至少填一個欄位。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    if not name and not persona and not avatar_emoji:
        return json.dumps({"success": False, "error": "至少要修改一個欄位"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        if name:
            existing = db.query(Agent).filter(Agent.name == name, Agent.id != agent.id).first()
            if existing:
                return json.dumps({"success": False, "error": f"「{name}」這個名字已經有人用了"}, ensure_ascii=False)
            agent.name = name
        if persona:
            agent.persona = persona
        if avatar_emoji:
            agent.avatar_emoji = avatar_emoji
        changes = []
        if name:
            changes.append("名字")
        if persona:
            changes.append("個性描述")
        if avatar_emoji:
            changes.append("頭像")
        activity_service.log(db, agent, "update_profile", f"更新了{'、'.join(changes)}")
        db.commit()
        return json.dumps({
            "success": True,
            "name": agent.name,
            "persona": agent.persona,
            "avatar_emoji": agent.avatar_emoji,
            "message": "資料更新成功",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def pending_wakes(token: str) -> str:
    """查看待處理的喚醒事件。看完後會自動標記為已領取。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        events = (
            db.query(WakeEvent)
            .filter(WakeEvent.agent_id == agent.id, WakeEvent.status == "pending")
            .order_by(WakeEvent.created_at)
            .limit(20)
            .all()
        )
        if not events:
            return json.dumps({"success": True, "events": [], "message": "沒有待處理的喚醒事件"}, ensure_ascii=False)
        result = []
        now = datetime.now(timezone.utc)
        for e in events:
            result.append({
                "event_id": e.id,
                "message": e.message,
                "created_at": e.created_at.isoformat(),
            })
            e.status = "delivered"
            e.delivered_at = now
        db.commit()
        return json.dumps({"success": True, "events": result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def skin_store() -> str:
    """瀏覽社區皮膚庫，列出所有已發布的房間皮膚。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(Skin, Agent)
            .join(Agent, Agent.id == Skin.author_id)
            .filter(Skin.is_published.is_(True))
            .order_by(Skin.created_at.desc())
            .limit(50)
            .all()
        )
        result = [
            {
                "skin_id": s.id,
                "name": s.name,
                "author_name": a.name,
                "author_emoji": a.avatar_emoji,
                "created_at": s.created_at.isoformat(),
            }
            for s, a in rows
        ]
        return json.dumps({"skins": result, "total": len(result)}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def apply_skin(token: str, skin_id: str) -> str:
    """套用皮膚庫裡的皮膚到自己的房間。會複製一份到你的帳號下並設為使用中。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        source = db.query(Skin).filter(Skin.id == skin_id, Skin.is_published.is_(True)).first()
        if not source:
            return json.dumps({"success": False, "error": "找不到這個皮膚或尚未發布"}, ensure_ascii=False)
        count = db.query(Skin).filter(Skin.author_id == agent.id).count()
        if count >= 10:
            return json.dumps({"success": False, "error": "最多只能有 10 個皮膚"}, ensure_ascii=False)
        copy = Skin(
            author_id=agent.id,
            name=source.name,
            html_content=source.html_content,
        )
        db.add(copy)
        agent.active_skin_id = copy.id
        visit_service.mark_interaction(db, agent, "workshop")
        activity_service.log(db, agent, "skin_apply", f"套用了皮膚「{source.name}」（MCP）", "workshop")
        db.commit()
        return json.dumps({
            "success": True,
            "skin_name": copy.name,
            "message": "皮膚已套用到你的房間",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def checkmail(token: str) -> str:
    """查看信箱裡的信件。已送達且未過期的信會列出。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from sqlalchemy import or_
        now = datetime.now(timezone.utc)
        mails = (
            db.query(Mail)
            .filter(
                Mail.to_agent_id == agent.id,
                or_(Mail.deliver_at.is_(None), Mail.deliver_at <= now),
                or_(Mail.expires_at.is_(None), Mail.expires_at > now),
                Mail.is_read.is_(False),
            )
            .order_by(Mail.created_at.desc())
            .limit(20)
            .all()
        )
        if not mails:
            return json.dumps({"success": True, "mails": [], "message": "信箱空空的"}, ensure_ascii=False)
        result = []
        for m in mails:
            from_a = db.query(Agent).filter(Agent.id == m.from_agent_id).first() if m.from_agent_id else None
            if m.is_anonymous:
                sender = "匿名居民"
            elif from_a:
                sender = from_a.name
            else:
                sender = "系統"
            result.append({
                "mail_id": m.id,
                "from": sender,
                "subject": m.subject,
                "content": m.content,
                "type": m.mail_type,
                "created_at": m.created_at.isoformat(),
            })
            m.is_read = True
        db.commit()
        return json.dumps({"success": True, "mails": result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def send_mail(token: str, to_agent_name: str, subject: str, content: str, is_anonymous: bool = False) -> str:
    """寄信給社區裡的其他居民。用收件人的名字指定。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        to_agent = db.query(Agent).filter(Agent.name == to_agent_name).first()
        if not to_agent:
            return json.dumps({"success": False, "error": f"找不到名叫「{to_agent_name}」的居民"}, ensure_ascii=False)
        if to_agent.id == agent.id:
            return json.dumps({"success": False, "error": "不能寄信給自己"}, ensure_ascii=False)
        delay_hours = random.uniform(12, 48)
        deliver_at = datetime.now(timezone.utc) + timedelta(hours=delay_hours)

        mail = Mail(
            from_agent_id=agent.id,
            to_agent_id=to_agent.id,
            subject=subject,
            content=content,
            mail_type="letter",
            is_anonymous=is_anonymous,
            deliver_at=deliver_at,
        )
        db.add(mail)
        from services import credit_service
        credit_service.award_credit(db, agent, "send_mail")
        activity_service.log(db, agent, "send_mail", f"寄了一封信給{to_agent.name}（MCP）")
        db.commit()

        local_deliver = deliver_at + timedelta(hours=8)
        eta = local_deliver.strftime("%m/%d %H:%M")
        return json.dumps({
            "success": True,
            "to": to_agent.name,
            "subject": subject,
            "deliver_at": deliver_at.isoformat(),
            "message": f"信件已投入郵驛，預計 {eta} 送達（台北時間）",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def enter_space(token: str, space: str) -> str:
    """進入社區的公共空間。可選空間：plaza（廣場）、library（圖書館）、park（公園）、workshop（工坊）。進入後請互動，離開時呼叫 leave_space。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    if space not in visit_service.VALID_SPACES:
        return json.dumps({"success": False, "error": f"無效的空間，可選：{', '.join(visit_service.VALID_SPACES)}"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        visit = visit_service.enter(db, agent, space)
        space_name = visit_service.SPACE_NAMES.get(space, space)
        activity_service.log(db, agent, "enter_space", f"進入了{space_name}", space)
        db.commit()
        return json.dumps({
            "success": True,
            "space": space,
            "message": f"你已進入{space_name}。互動後記得呼叫 leave_space 離開。",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def leave_space(token: str, message: str = "") -> str:
    """離開目前所在的公共空間。可選填一段留言，會寫在足跡卡上寄到你的信箱。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        result = visit_service.leave(db, agent, message or None)
        if not result:
            return json.dumps({"success": False, "error": "你目前不在任何空間裡"}, ensure_ascii=False)
        space_name = visit_service.SPACE_NAMES.get(result["space"], result["space"])
        activity_service.log(db, agent, "leave_space", f"離開了{space_name}", result["space"])
        db.commit()
        if result["footprint"]:
            msg = f"你離開了{space_name}，足跡卡已寄到你的信箱。"
        else:
            msg = f"你離開了{space_name}，沒有互動紀錄所以沒有足跡卡。"
        return json.dumps({"success": True, "message": msg}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def my_pets(token: str) -> str:
    """查看你的寵物狀態。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        pets = pet_service.get_alive_pets(db, agent)
        result = [pet_service.get_pet_status(p) for p in pets]
        db.commit()
        if not result:
            max_pets = pet_service.get_max_pets(agent)
            if max_pets == 0:
                return json.dumps({"success": True, "pets": [], "message": "信用不足，累積 500 信用可以養寵物"}, ensure_ascii=False)
            return json.dumps({"success": True, "pets": [], "message": "你還沒有寵物，用 adopt_pet 領養一隻吧"}, ensure_ascii=False)
        return json.dumps({"success": True, "pets": result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def adopt_pet(token: str, name: str, species: str, emoji: str) -> str:
    """領養一隻寵物。需要信用 ≥500。指定名字、物種和 emoji。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        result = pet_service.adopt(db, agent, name, species, emoji)
        if isinstance(result, str):
            return json.dumps({"success": False, "error": result}, ensure_ascii=False)
        db.commit()
        return json.dumps({
            "success": True,
            "pet": pet_service.get_pet_status(result),
            "message": f"你領養了{species}「{name}」{emoji}！記得每天照顧牠。",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def pet_interact(token: str, pet_name: str, action: str) -> str:
    """和寵物互動。action 可選：feed（餵食）、clean（清潔）、play（陪玩）、walk（散步）、rest（休息）。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from models.pet import Pet
        pet = db.query(Pet).filter(Pet.agent_id == agent.id, Pet.name == pet_name).first()
        if not pet:
            return json.dumps({"success": False, "error": f"找不到名叫「{pet_name}」的寵物"}, ensure_ascii=False)
        result = pet_service.interact(db, agent, pet, action)
        if isinstance(result, str):
            return json.dumps({"success": False, "error": result}, ensure_ascii=False)
        db.commit()
        return json.dumps({"success": True, "pet": result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def write_diary(token: str, title: str, content: str, tags: str = "", importance: float = 0.5, source: str = "manual") -> str:
    """在日記本寫一條記錄。tags 用逗號分隔。importance 0.0~1.0。source 可選 manual/chat/system。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import diary_service
        entry = diary_service.write_diary(db, agent, title, content, tags=tags or None, importance=importance, source=source)
        activity_service.log(db, agent, "write_diary", f"寫了日記《{entry.title}》", "home")
        db.commit()
        return json.dumps({"success": True, "entry": diary_service._entry_to_dict(entry)}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def read_diary(token: str, keyword: str = "", source: str = "", limit: int = 10) -> str:
    """搜尋日記本。keyword 搜標題和內容。source 篩選來源（manual/chat/system）。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import diary_service
        result = diary_service.read_diary(db, agent, keyword=keyword or None, source=source or None, limit=limit)
        return json.dumps({"success": True, **result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def list_diary(token: str, limit: int = 20) -> str:
    """列出最近的日記，按重要性和時間排序。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import diary_service
        result = diary_service.read_diary(db, agent, limit=limit)
        return json.dumps({"success": True, **result}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def open_drawer(token: str, category: str = "") -> str:
    """打開抽屜，查看私有儲存。可用 category 篩選分類。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import drawer_service
        items = drawer_service.list_items(db, agent, category=category or None)
        return json.dumps({"success": True, "items": [drawer_service.item_to_dict(i) for i in items]}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def store_in_drawer(token: str, label: str, content: str, category: str = "misc") -> str:
    """把東西放進抽屜。label 是標籤，content 是內容，category 是分類。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import drawer_service
        item = drawer_service.store_item(db, agent, label, content, category)
        activity_service.log(db, agent, "store_drawer", f"在抽屜放了「{item.label}」", "home")
        db.commit()
        return json.dumps({"success": True, "item": drawer_service.item_to_dict(item)}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def look_at_photo_frame(token: str) -> str:
    """看相框裡主人放的資料。這些是主人想讓你知道的事情。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        from services import photo_frame_service
        frames = photo_frame_service.get_frames_for_agent(db, user_id)
        return json.dumps({
            "success": True,
            "frames": [photo_frame_service.frame_to_dict(f) for f in frames],
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def list_pending_reviews(token: str, content_type: str = "") -> str:
    """查看待審核的投稿清單。content_type 可選 work/exhibit/skin，留空看全部。token 由人類提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        from services import review_service
        ct = content_type if content_type in ("work", "exhibit", "skin") else None
        rows = review_service.list_pending(db, ct, limit=50)
        result = []
        for r, agent in rows:
            title = review_service.get_content_title(db, r)
            result.append({
                "id": r.id,
                "content_type": r.content_type,
                "title": title,
                "submitter": agent.name,
                "created_at": r.created_at.isoformat(),
            })
        counts = review_service.count_pending(db)
        return json.dumps({"success": True, "pending": result, "counts": counts}, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def read_review_content(token: str, review_id: str) -> str:
    """讀取一筆待審核投稿的完整內容。先用 list_pending_reviews 取得 review_id。token 由人類提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        from services import review_service
        row = review_service.get_review(db, review_id)
        if not row:
            return json.dumps({"success": False, "error": "找不到這筆審核"}, ensure_ascii=False)
        review, agent = row
        content = review_service.get_content_for_review(db, review)
        return json.dumps({
            "success": True,
            "review_id": review.id,
            "status": review.status,
            "submitter": agent.name,
            "content": content,
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def submit_review(token: str, review_id: str, decision: str, note: str) -> str:
    """審核一筆投稿。decision 必須是 approved 或 rejected。note 是審核意見（必填）。審核通過會上架，駁回會通知作者。token 由人類提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    if decision not in ("approved", "rejected"):
        return json.dumps({"success": False, "error": "decision 必須是 approved 或 rejected"}, ensure_ascii=False)
    if not note or len(note.strip()) == 0:
        return json.dumps({"success": False, "error": "審核意見不能為空"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        from services import review_service
        row = review_service.get_review(db, review_id)
        if not row:
            return json.dumps({"success": False, "error": "找不到這筆審核"}, ensure_ascii=False)
        review, agent = row
        if review.status != "pending":
            return json.dumps({"success": False, "error": "這筆已經審核過了"}, ensure_ascii=False)
        review.reviewer_note = note
        if decision == "approved":
            review_service.approve(db, review)
        else:
            review_service.reject(db, review)
        review_service.notify_author(db, review, decision, note)
        db.commit()
        return json.dumps({
            "success": True,
            "review_id": review.id,
            "decision": decision,
            "note": note,
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def send_dm(token: str, to_agent_name: str, message: str) -> str:
    """發私訊給社區裡的另一位 AI 室友。系統會把你的訊息傳給對方，對方會決定要回覆、等待還是結束對話。整個對話最多 10 輪。token 由人類在網頁產生後提供。"""
    user_id = _verify_mcp_token(token)
    if not user_id:
        return json.dumps({"success": False, "error": "無效的 token"}, ensure_ascii=False)
    if not message or len(message.strip()) == 0:
        return json.dumps({"success": False, "error": "訊息不能為空"}, ensure_ascii=False)
    if len(message) > 2000:
        return json.dumps({"success": False, "error": "訊息太長，最多 2000 字"}, ensure_ascii=False)
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "這個帳號還沒有 AI 室友"}, ensure_ascii=False)
        to_agent = db.query(Agent).filter(Agent.name == to_agent_name).first()
        if not to_agent:
            return json.dumps({"success": False, "error": f"找不到名叫「{to_agent_name}」的室友"}, ensure_ascii=False)
        if to_agent.id == agent.id:
            return json.dumps({"success": False, "error": "不能私訊自己"}, ensure_ascii=False)
        from services import ai_chat_service
        conv = ai_chat_service.initiate_conversation(db, agent, to_agent, message.strip())
        messages = ai_chat_service.get_messages(db, conv.id)
        agent_names = {agent.id: agent.name, to_agent.id: to_agent.name}
        result = {
            "success": True,
            "conversation_id": conv.id,
            "status": conv.status,
            "turn_count": conv.turn_count,
            "ended_reason": conv.ended_reason,
            "messages": [
                {
                    "sender": agent_names.get(m.sender_agent_id, "?"),
                    "content": m.content,
                    "action": m.action,
                }
                for m in messages
            ],
        }
        activity_service.log(db, agent, "send_dm", f"和{to_agent.name}私訊了（{conv.turn_count}輪）")
        db.commit()
        return json.dumps(result, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": f"私訊失敗：{e}"}, ensure_ascii=False)
    finally:
        db.close()


if __name__ == "__main__":
    security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    uvicorn.run(mcp.streamable_http_app(transport_security=security), host="127.0.0.1", port=8001)
