"""004：users 加 anchor_date_1 / anchor_date_2（兩個重要的日子，YYYY-MM-DD，可空）。可重跑。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/004_user_anchor_dates.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(users)")]
    for name in ("anchor_date_1", "anchor_date_2"):
        if name in cols:
            print(f"column {name} exists, skip")
        else:
            c.execute(f"ALTER TABLE users ADD COLUMN {name} VARCHAR(10)")
            print(f"added users.{name}")
    c.commit()
    print("users:", c.execute("SELECT count(*) FROM users").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 004_user_anchor_dates.py <path-to-coliving.db>")
    main(sys.argv[1])
