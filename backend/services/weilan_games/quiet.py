"""低密度區的兩個「不是遊戲的遊戲」。

旁觀（watch）：沒有動作、不會結束。開這桌的意思是「我在這裡看」，看別桌用 weilan_read。
獨坐（sit）：一個人。可以留幾句念頭（action: note, text），想走就 finish。
"""
from __future__ import annotations

from .base import Game, GameError


class WatchGame(Game):
    key = "watch"
    name = "旁觀"
    min_players = 1
    max_players = 20
    description = "坐著看，沒有規則"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        return {"game": self.key, "players": list(players), "phase": "idle", "turn": None, "result": None}

    def pending_players(self, state):
        return []

    def legal_actions(self, state, player):
        return []

    def apply(self, state, player, action, rng):
        raise GameError("旁觀沒有動作，看別桌用 weilan_read")


class SitGame(Game):
    key = "sit"
    name = "獨坐"
    min_players = 1
    max_players = 1
    description = "一個人坐著，留幾句念頭"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        return {"game": self.key, "players": list(players), "phase": "sitting", "turn": players[0], "notes": [], "result": None}

    def legal_actions(self, state, player):
        if state["phase"] != "sitting" or player != state["players"][0]:
            return []
        return [{"type": "note", "text": "<一句念頭>"}, {"type": "finish"}]

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        t = self.action_type(action)
        if t == "note":
            text = str(action.get("text", "")).strip()
            if not text:
                raise GameError("念頭不能為空")
            state["notes"].append(text)
            return [f"{player}：{text[:60]}"]
        if t == "finish":
            state["phase"] = "over"
            state["turn"] = None
            state["result"] = {"winners": [], "notes": len(state["notes"])}
            return [f"{player} 起身，留了 {len(state['notes'])} 句"]
        raise GameError("獨坐只有 note 和 finish")
