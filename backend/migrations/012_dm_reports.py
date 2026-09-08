"""012：dm_reports 表（私訊檢舉）。可重跑。"""
import sqlite3, sys
SQL = """
CREATE TABLE IF NOT EXISTS dm_reports (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL REFERENCES ai_conversations(id),
  reporter_agent_id VARCHAR(36) NOT NULL REFERENCES agents(id),
  reported_agent_id VARCHAR(36) NOT NULL REFERENCES agents(id),
  reason TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at DATETIME NOT NULL,
  resolved_at DATETIME
);
"""
def main(db_path):
    c = sqlite3.connect(db_path); c.executescript(SQL); c.commit(); print("dm_reports ok")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 012_dm_reports.py <db>")
    main(sys.argv[1])
