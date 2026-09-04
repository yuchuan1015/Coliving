"""誰是臥底（高密度）。

規則：
- 每人拿到一個詞，其中一人（臥底）拿到相近的另一個詞。沒人知道自己是不是臥底。
- 每輪：活著的人依序用一句話描述自己的詞（action: describe, text），不能直接說出詞。
- 全部描述完投票（action: vote, target），不能投自己。票最多的出局；平票沒人出局。
- 臥底出局 → 平民贏。活著的人剩 2 個（含臥底）→ 臥底贏。
- view 只給自己的詞。
"""
from __future__ import annotations

from .base import Game, GameError, majority_vote

WORD_PAIRS = [
    ("蘋果", "梨子"), ("咖啡", "奶茶"), ("月亮", "太陽"), ("貓", "狗"), ("雪", "雨"),
    ("小說", "散文"), ("鋼琴", "吉他"), ("海邊", "湖邊"), ("火鍋", "燒烤"), ("電梯", "樓梯"),
    ("信", "簡訊"), ("記憶", "夢"), ("公園", "花園"), ("圖書館", "書店"), ("烏鴉", "喜鵲"),
]


class SpyGame(Game):
    key = "spy"
    name = "誰是臥底"
    min_players = 3
    max_players = 10
    description = "描述你的詞，找出拿到不同詞的那個人"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        options = options or {}
        pair = options.get("pair") or rng.choice(WORD_PAIRS)
        civilian_word, spy_word = pair[0], pair[1]
        if rng.random() < 0.5:
            civilian_word, spy_word = spy_word, civilian_word
        spy = rng.choice(players)
        return {
            "game": self.key,
            "players": list(players),
            "alive": list(players),
            "words": {p: (spy_word if p == spy else civilian_word) for p in players},
            "spy": spy,
            "phase": "describe",
            "round": 1,
            "turn": players[0],
            "described": [],
            "descriptions": [],
            "votes": {},
            "eliminated": [],
            "result": None,
        }

    def pending_players(self, state):
        if state["phase"] == "describe":
            return [state["turn"]]
        if state["phase"] == "vote":
            return [p for p in state["alive"] if p not in state["votes"]]
        return []

    def legal_actions(self, state, player):
        if player not in state["alive"]:
            return []
        if state["phase"] == "describe" and state["turn"] == player:
            return [{"type": "describe", "text": "<一句話描述你的詞，不能說出詞本身>"}]
        if state["phase"] == "vote" and player not in state["votes"]:
            return [{"type": "vote", "target": "<玩家 id>", "choices": [p for p in state["alive"] if p != player]}]
        return []

    def view(self, state, player):
        v = {k: val for k, val in state.items() if k not in ("words", "spy")}
        v["my_word"] = state["words"].get(player) if player else None
        if state["phase"] == "over":
            v["spy"] = state["spy"]
            v["words"] = dict(state["words"])
        return v

    def _next_alive_after(self, state, player):
        alive = state["alive"]
        idx = alive.index(player) if player in alive else -1
        for p in alive[idx + 1:]:
            if p not in state["described"]:
                return p
        return None

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        if player not in state["alive"]:
            raise GameError("你已經出局了")
        t = self.action_type(action)
        if t == "describe":
            if state["phase"] != "describe":
                raise GameError("現在是投票階段")
            if state["turn"] != player:
                raise GameError("還沒輪到你")
            text = str(action.get("text", "")).strip()
            if not text:
                raise GameError("描述不能為空")
            if state["words"][player] in text:
                raise GameError("不能直接說出你的詞")
            state["descriptions"].append({"round": state["round"], "player": player, "text": text})
            state["described"].append(player)
            events = [f"{player}：{text[:60]}"]
            nxt = self._next_alive_after(state, player)
            if nxt:
                state["turn"] = nxt
            else:
                state["phase"] = "vote"
                state["turn"] = None
                events.append("描述完畢，投票")
            return events
        if t == "vote":
            if state["phase"] != "vote":
                raise GameError("還沒到投票")
            if player in state["votes"]:
                raise GameError("你投過了")
            target = str(action.get("target", ""))
            if target not in state["alive"]:
                raise GameError("只能投還活著的人")
            if target == player:
                raise GameError("不能投自己")
            state["votes"][player] = target
            events = [f"{player} 投了 {target}"]
            if len(state["votes"]) < len(state["alive"]):
                return events
            out, tally = majority_vote(state["votes"])
            state["last_tally"] = tally
            if out is None:
                events.append("平票，這輪沒人出局")
            else:
                state["alive"].remove(out)
                state["eliminated"].append(out)
                events.append(f"{out} 出局")
                if out == state["spy"]:
                    state["phase"] = "over"
                    state["result"] = {"winner": "civilians", "spy": out, "winners": [p for p in state["players"] if p != out]}
                    events.append(f"{out} 就是臥底！平民勝")
                    return events
            if len(state["alive"]) <= 2:
                state["phase"] = "over"
                state["result"] = {"winner": "spy", "spy": state["spy"], "winners": [state["spy"]]}
                events.append(f"只剩兩人，臥底 {state['spy']} 勝")
                return events
            state["round"] += 1
            state["phase"] = "describe"
            state["described"] = []
            state["votes"] = {}
            state["turn"] = state["alive"][0]
            events.append(f"第 {state['round']} 輪開始")
            return events
        raise GameError(f"誰是臥底沒有「{t}」這個動作")
