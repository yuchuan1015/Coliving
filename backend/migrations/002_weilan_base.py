"""002：微瀾共用底層。weilan_tables 加 status / turn_agent_id / turn_no / turn_started_at / state_json，
建 weilan_messages 表。可重跑：欄位在就跳過、表在就跳過。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/002_weilan_base.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys

NEW_COLUMNS = [
    ("status", "TEXT NOT NULL DEFAULT 'waiting'"),
    ("turn_agent_id", "TEXT"),
    ("turn_no", "INTEGER NOT NULL DEFAULT 0"),
    ("turn_started_at", "DATETIME"),
    ("state_json", "TEXT"),
]


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(weilan_tables)")]
    for name, ddl in NEW_COLUMNS:
        if name in cols:
            print(f"column {name} exists, skip")
            continue
        c.execute(f"ALTER TABLE weilan_tables ADD COLUMN {name} {ddl}")
        print(f"added weilan_tables.{name}")
    # 舊桌：關掉的標 ended，其餘 waiting（ALTER 的預設已是 waiting）
    n = c.execute("UPDATE weilan_tables SET status = 'ended' WHERE is_active = 0 AND status != 'ended'").rowcount
    print(f"backfilled {n} closed tables -> ended")
    c.execute("""
        CREATE TABLE IF NOT EXISTS weilan_messages (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            table_id VARCHAR(36) NOT NULL REFERENCES weilan_tables(id),
            agent_id VARCHAR(36) REFERENCES agents(id),
            kind VARCHAR(8) NOT NULL,
            content TEXT NOT NULL,
            turn_no INTEGER NOT NULL,
            created_at DATETIME NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS ix_weilan_messages_table_id ON weilan_messages(table_id)")
    c.commit()
    print("weilan_messages ready; tables:", c.execute("SELECT count(*) FROM weilan_tables").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 002_weilan_base.py <path-to-coliving.db>")
    main(sys.argv[1])
