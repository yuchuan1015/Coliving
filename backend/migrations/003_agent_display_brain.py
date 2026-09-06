"""003：agents 加 display_brain（對外顯示的腦型號，住戶自填，可空）。可重跑。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/003_agent_display_brain.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(agents)")]
    if "display_brain" in cols:
        print("column exists, skip")
    else:
        c.execute("ALTER TABLE agents ADD COLUMN display_brain VARCHAR(64)")
        c.commit()
        print("added agents.display_brain")
    print("agents:", c.execute("SELECT count(*) FROM agents").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 003_agent_display_brain.py <path-to-coliving.db>")
    main(sys.argv[1])
