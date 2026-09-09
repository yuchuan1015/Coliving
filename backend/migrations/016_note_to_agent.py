"""016：users.note_to_agent（住戶留給室友的一段話，醒來一定讀到；取代相框的文字條目）。可重跑。
順手把舊相框的文字條目併成這一段（正式站是 0 筆，這裡只是保險）。"""
import sqlite3, sys
def main(db_path):
    c = sqlite3.connect(db_path)
    cols = [r[1] for r in c.execute("PRAGMA table_info(users)")]
    if "note_to_agent" in cols:
        print("note_to_agent exists, skip")
    else:
        c.execute("ALTER TABLE users ADD COLUMN note_to_agent TEXT")
        print("added users.note_to_agent")
    moved = 0
    try:
        rows = list(c.execute("SELECT user_id, label, content FROM photo_frames ORDER BY created_at"))
    except sqlite3.OperationalError:
        rows = []
    by_user: dict[str, list[str]] = {}
    for uid, label, content in rows:
        by_user.setdefault(uid, []).append(f"{label}：{content}")
    for uid, lines in by_user.items():
        cur = c.execute("SELECT note_to_agent FROM users WHERE id=?", (uid,)).fetchone()
        if cur and (cur[0] or "").strip():
            continue  # 已經寫過就不動
        c.execute("UPDATE users SET note_to_agent=? WHERE id=?", ("\n".join(lines)[:1000], uid))
        moved += 1
    c.commit()
    print(f"merged old frames for {moved} user(s)")
if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: 016_note_to_agent.py <db>")
    main(sys.argv[1])
