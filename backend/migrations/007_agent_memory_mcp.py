"""007：agents 加 memory_mcp（哪個外部 MCP 是記憶）、memory_recall_tool（recall 用哪個工具）。可重跑。

用法（VPS）：
  cp coliving.db /opt/coliving/backups/coliving.db.$(date +%Y%m%d-%H%M%S)
  .venv/bin/python migrations/007_agent_memory_mcp.py /opt/coliving/backend/coliving.db
"""
import sqlite3
import sys

NEW = [("memory_mcp", "VARCHAR(32)"), ("memory_recall_tool", "VARCHAR(64)")]


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(agents)")]
    for name, ddl in NEW:
        if name in cols:
            print(f"column {name} exists, skip")
        else:
            c.execute(f"ALTER TABLE agents ADD COLUMN {name} {ddl}")
            print(f"added agents.{name}")
    c.commit()
    print("agents:", c.execute("SELECT count(*) FROM agents").fetchone()[0])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: 007_agent_memory_mcp.py <path-to-coliving.db>")
    main(sys.argv[1])
