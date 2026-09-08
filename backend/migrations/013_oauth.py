"""013：oauth_clients / oauth_requests / oauth_grants（MCP OAuth 授權伺服器）。可重跑。"""
import sqlite3, sys
SQL = """
CREATE TABLE IF NOT EXISTS oauth_clients (
  id VARCHAR(36) PRIMARY KEY,
  client_secret_hash VARCHAR(64),
  client_name VARCHAR(128) NOT NULL DEFAULT '',
  client_uri VARCHAR(512),
  logo_uri VARCHAR(512),
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  token_endpoint_auth_method VARCHAR(32) NOT NULL DEFAULT 'none',
  created_at DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_requests (
  id VARCHAR(36) PRIMARY KEY,
  client_id VARCHAR(36) NOT NULL REFERENCES oauth_clients(id),
  redirect_uri VARCHAR(512) NOT NULL,
  scope VARCHAR(64) NOT NULL DEFAULT 'mcp',
  state VARCHAR(512),
  code_challenge VARCHAR(128) NOT NULL,
  resource VARCHAR(512),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  code_hash VARCHAR(64),
  code_expires_at DATETIME,
  user_id VARCHAR(36) REFERENCES users(id),
  agent_id VARCHAR(36) REFERENCES agents(id),
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  agent_id VARCHAR(36) NOT NULL REFERENCES agents(id),
  client_id VARCHAR(36) NOT NULL REFERENCES oauth_clients(id),
  scope VARCHAR(64) NOT NULL DEFAULT 'mcp',
  refresh_token_hash VARCHAR(64),
  refresh_expires_at DATETIME,
  created_at DATETIME NOT NULL,
  last_used_at DATETIME,
  revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_oauth_grants_user_id ON oauth_grants(user_id);
"""
def main(db_path):
    c = sqlite3.connect(db_path); c.executescript(SQL); c.commit(); print("oauth tables ok")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 013_oauth.py <db>")
    main(sys.argv[1])
