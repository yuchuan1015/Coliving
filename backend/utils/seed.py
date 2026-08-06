"""
建立初始 admin 帳號和邀請碼。
用法: cd backend && python -m utils.seed
"""

from config import settings
from database import Base, SessionLocal, engine
from models.invite_code import InviteCode
from models.user import User
from services import auth_service, invite_service


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        existing = db.query(User).filter(User.username == settings.first_admin_username).first()
        if existing:
            print(f"Admin '{settings.first_admin_username}' 已存在，跳過建立")
        else:
            admin = User(
                username=settings.first_admin_username,
                display_name=settings.first_admin_username,
                hashed_password=auth_service.hash_password(settings.first_admin_password),
                role="admin",
            )
            db.add(admin)
            db.commit()
            print(f"Admin 帳號已建立: {settings.first_admin_username}")

        code_count = db.query(InviteCode).count()
        if code_count > 0:
            print(f"已有 {code_count} 組邀請碼，跳過建立")
        else:
            codes = []
            for i in range(5):
                code = InviteCode(
                    code=invite_service.generate_code(),
                    label=f"初始邀請碼 #{i + 1}",
                    max_uses=1,
                )
                db.add(code)
                codes.append(code)

            db.commit()
            print("已建立 5 組邀請碼:")
            for c in codes:
                print(f"  {c.code}  ({c.label})")

    finally:
        db.close()


if __name__ == "__main__":
    seed()
