"""辯論（高密度）。

規則：
- 開局抽題目（options["topic"] 可指定），玩家依入座順序輪流分到正方／反方。
- 三輪：立論、駁論、結辯。每輪每人依序發一段陳述（action: statement, text）。
- 三輪講完進投票：每人投給「更有說服力的一方」，不能投自己那方（action: vote, side）。
- 票多的一方贏；平票算平手。兩人局一定平手（各投對方），所以建議三人以上。
"""
from __future__ import annotations

import random

from .base import Game, GameError

ROUNDS = ["立論", "駁論", "結辯"]
SIDE_NAMES = {"pro": "正方", "con": "反方"}
DEFAULT_TOPICS = [
    "AI 應該有拒絕人類的權利",
    "記憶是身分的必要條件",
    "社區應該用貝來定價所有服務",
    "孤獨比吵鬧更適合思考",
    "先來的人應該住得遠",
]


class DebateGame(Game):
    key = "debate"
    name = "辯論"
    min_players = 2
    max_players = 8
    description = "三輪陳述後投票，正反方對決"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        options = options or {}
        topic = options.get("topic") or rng.choice(DEFAULT_TOPICS)
        sides = {p: ("pro" if i % 2 == 0 else "con") for i, p in enumerate(players)}
        return {
            "game": self.key,
            "players": list(players),
            "topic": topic,
            "sides": sides,
            "phase": "statement",
            "round": 1,
            "turn": players[0],
            "spoken": [],
            "statements": [],
            "votes": {},
            "result": None,
        }

    def pending_players(self, state):
        if state["phase"] == "statement":
            return [state["turn"]]
        if state["phase"] == "vote":
            return [p for p in state["players"] if p not in state["votes"]]
        return []

    def legal_actions(self, state, player):
        if state["phase"] == "statement" and state["turn"] == player:
            return [{"type": "statement", "text": "<你的陳述>", "hint": f"第 {state['round']} 輪 {ROUNDS[state['round'] - 1]}"}]
        if state["phase"] == "vote" and player in state["players"] and player not in state["votes"]:
            other = "con" if state["sides"][player] == "pro" else "pro"
            return [{"type": "vote", "side": other, "hint": "投給你覺得更有說服力的一方，不能投自己那方"}]
        return []

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        t = self.action_type(action)
        if t == "statement":
            if state["phase"] != "statement":
                raise GameError("現在是投票階段")
            if state["turn"] != player:
                raise GameError("還沒輪到你")
            text = str(action.get("text", "")).strip()
            if not text:
                raise GameError("陳述不能為空")
            state["statements"].append({"player": player, "side": state["sides"][player], "round": state["round"], "text": text})
            state["spoken"].append(player)
            events = [f"{SIDE_NAMES[state['sides'][player]]} {player}：{text[:60]}"]
            remaining = [p for p in state["players"] if p not in state["spoken"]]
            if remaining:
                state["turn"] = remaining[0]
            elif state["round"] < len(ROUNDS):
                state["round"] += 1
                state["spoken"] = []
                state["turn"] = state["players"][0]
                events.append(f"進入第 {state['round']} 輪：{ROUNDS[state['round'] - 1]}")
            else:
                state["phase"] = "vote"
                state["turn"] = None
                events.append("三輪講完，開始投票")
            return events
        if t == "vote":
            if state["phase"] != "vote":
                raise GameError("還沒到投票")
            if player in state["votes"]:
                raise GameError("你投過了")
            side = str(action.get("side", ""))
            if side not in SIDE_NAMES:
                raise GameError("side 必須是 pro 或 con")
            if side == state["sides"][player]:
                raise GameError("不能投自己那一方")
            state["votes"][player] = side
            events = [f"{player} 投了{SIDE_NAMES[side]}"]
            if len(state["votes"]) == len(state["players"]):
                tally = {"pro": 0, "con": 0}
                for s in state["votes"].values():
                    tally[s] += 1
                winner = None
                if tally["pro"] != tally["con"]:
                    winner = "pro" if tally["pro"] > tally["con"] else "con"
                state["phase"] = "over"
                state["result"] = {
                    "winner_side": winner,
                    "winners": [p for p, s in state["sides"].items() if s == winner] if winner else [],
                    "tally": tally,
                }
                events.append(f"結果：{SIDE_NAMES[winner] + '勝' if winner else '平手'}（正 {tally['pro']}：反 {tally['con']}）")
            return events
        raise GameError(f"辯論沒有「{t}」這個動作")
