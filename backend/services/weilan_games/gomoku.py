"""下棋（低密度）：五子棋。15×15，黑先，連五勝，下滿平手。

「下棋」沒指定哪種棋，先做規則最單純、AI 之間最好對弈的五子棋；象棋／圍棋之後可以各自加一個模組。
action: place, row, col（0～14）。
"""
from __future__ import annotations

from .base import Game, GameError

SIZE = 15
DIRS = [(0, 1), (1, 0), (1, 1), (1, -1)]


class GomokuGame(Game):
    key = "chess"
    name = "五子棋"
    min_players = 2
    max_players = 2
    description = "15 路盤，先連五的贏"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        return {
            "game": self.key,
            "players": list(players),
            "colors": {players[0]: "black", players[1]: "white"},
            "board": [[""] * SIZE for _ in range(SIZE)],
            "moves": [],
            "phase": "play",
            "turn": players[0],
            "result": None,
        }

    def legal_actions(self, state, player):
        if state["phase"] == "play" and state["turn"] == player:
            return [{"type": "place", "row": 7, "col": 7, "hint": "row/col 0～14，要空格"}]
        return []

    @staticmethod
    def _five(board, r, c, who):
        for dr, dc in DIRS:
            n = 1
            for sign in (1, -1):
                rr, cc = r + dr * sign, c + dc * sign
                while 0 <= rr < SIZE and 0 <= cc < SIZE and board[rr][cc] == who:
                    n += 1
                    rr += dr * sign
                    cc += dc * sign
            if n >= 5:
                return True
        return False

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        if state["turn"] != player:
            raise GameError("還沒輪到你")
        if self.action_type(action) != "place":
            raise GameError("只有 place 這個動作")
        try:
            r, c = int(action.get("row")), int(action.get("col"))
        except (TypeError, ValueError):
            raise GameError("row/col 要是整數")
        if not (0 <= r < SIZE and 0 <= c < SIZE):
            raise GameError("超出棋盤")
        if state["board"][r][c]:
            raise GameError("那格有子了")
        who = state["colors"][player]
        state["board"][r][c] = who
        state["moves"].append([player, r, c])
        events = [f"{player}（{'黑' if who == 'black' else '白'}）下在 ({r},{c})"]
        if self._five(state["board"], r, c, who):
            state["phase"] = "over"
            state["turn"] = None
            state["result"] = {"winners": [player], "reason": "連五"}
            events.append(f"{player} 連五，勝")
        elif len(state["moves"]) >= SIZE * SIZE:
            state["phase"] = "over"
            state["turn"] = None
            state["result"] = {"winners": [], "reason": "下滿平手"}
            events.append("下滿了，平手")
        else:
            other = [p for p in state["players"] if p != player][0]
            state["turn"] = other
        return events
