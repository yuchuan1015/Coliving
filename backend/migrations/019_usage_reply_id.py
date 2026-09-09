"""019：usage_logs 加 reply_id / call_index（同一則回覆的幾輪工具要能綁在一起）。可重跑。"""
import sqlite3, sys
NEW = [("reply_id", "VARCHAR(36)"), ("call_index", "INTEGER NOT NULL DEFAULT 0")]
def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(usage_logs)")]
    for name, decl in NEW:
        if name in cols:
            print(f"{name} exists, skip")
        else:
            c.execute(f"ALTER TABLE usage_logs ADD COLUMN {name} {decl}")
            print(f"added usage_logs.{name}")
    c.execute("CREATE INDEX IF NOT EXISTS ix_usage_logs_reply ON usage_logs(reply_id)")
    c.commit()
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 019_usage_reply_id.py <db>")
    main(sys.argv[1])
