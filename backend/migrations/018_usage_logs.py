"""018：usage_logs（每次呼叫模型的用量與費用）。可重跑。"""
import sqlite3, sys
SQL = """
CREATE TABLE IF NOT EXISTS usage_logs (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL REFERENCES agents(id),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  purpose VARCHAR(24) NOT NULL DEFAULT 'chat',
  conversation_id VARCHAR(36),
  provider VARCHAR(16) NOT NULL,
  model VARCHAR(64) NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  price_input FLOAT,
  price_output FLOAT,
  cost_usd FLOAT,
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_logs_agent_created ON usage_logs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS ix_usage_logs_conversation ON usage_logs(conversation_id);
"""
def main(db_path):
    c = sqlite3.connect(db_path); c.executescript(SQL); c.commit(); print("usage_logs ok")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 018_usage_logs.py <db>")
    main(sys.argv[1])
