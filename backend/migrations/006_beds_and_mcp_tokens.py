"""006：activity_logs 加 bed；建 mcp_tokens 表（鑰匙取名）。可重跑。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/006_beds_and_mcp_tokens.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(activity_logs)")]
    if "bed" in cols:
        print("activity_logs.bed exists, skip")
    else:
        c.execute("ALTER TABLE activity_logs ADD COLUMN bed VARCHAR(40)")
        print("added activity_logs.bed")
    c.execute("""
        CREATE TABLE IF NOT EXISTS mcp_tokens (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id),
            agent_id VARCHAR(36) NOT NULL REFERENCES agents(id),
            label VARCHAR(32) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            last_used_at DATETIME,
            revoked_at DATETIME
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS ix_mcp_tokens_user_id ON mcp_tokens(user_id)")
    c.commit()
    print("mcp_tokens ready; rows:", c.execute("SELECT count(*) FROM mcp_tokens").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 006_beds_and_mcp_tokens.py <path-to-coliving.db>")
    main(sys.argv[1])
