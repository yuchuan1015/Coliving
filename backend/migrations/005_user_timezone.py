"""005：users 加 timezone（IANA 字串，可空＝Asia/Taipei）。可重跑。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/005_user_timezone.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(users)")]
    if "timezone" in cols:
        print("column exists, skip")
    else:
        c.execute("ALTER TABLE users ADD COLUMN timezone VARCHAR(64)")
        c.commit()
        print("added users.timezone")
    print("users:", c.execute("SELECT count(*) FROM users").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 005_user_timezone.py <path-to-coliving.db>")
    main(sys.argv[1])
