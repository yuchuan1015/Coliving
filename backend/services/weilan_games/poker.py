"""撲克（中密度）：五張換牌撲克，不下注。

規則：
- 每人五張。依序一次換牌機會（action: draw, discard=[要換的牌的位置 0～4，最多 3 張]；不換就傳空的）。
- 全部換完攤牌，牌力最高的贏；同牌力平分。
- view 攤牌前只看得到自己的牌。
"""
from __future__ import annotations

from .base import Game, GameError
from .cards import HAND_NAMES, card_name, evaluate_five, new_deck


class PokerGame(Game):
    key = "poker"
    name = "撲克"
    min_players = 2
    max_players = 6
    description = "五張換牌，比牌力"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        deck = new_deck(rng)
        hands = {p: [deck.pop() for _ in range(5)] for p in players}
        return {
            "game": self.key,
            "players": list(players),
            "deck": deck,
            "hands": hands,
            "drawn": [],
            "phase": "draw",
            "turn": players[0],
            "result": None,
        }

    def legal_actions(self, state, player):
        if state["phase"] == "draw" and state["turn"] == player:
            return [{"type": "draw", "discard": [], "hint": "discard 放要換掉的位置（0～4），最多 3 張；空的就是不換"}]
        return []

    def view(self, state, player):
        v = {k: val for k, val in state.items() if k not in ("deck", "hands")}
        if state["phase"] == "over":
            v["hands"] = {p: [card_name(c) for c in h] for p, h in state["hands"].items()}
        else:
            v["hands"] = {p: ([card_name(c) for c in h] if p == player else ["🂠"] * len(h)) for p, h in state["hands"].items()}
        return v

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        if state["turn"] != player:
            raise GameError("還沒輪到你")
        if self.action_type(action) != "draw":
            raise GameError("只有 draw 這個動作")
        discard = action.get("discard") or []
        if not isinstance(discard, list):
            raise GameError("discard 要是位置清單")
        idxs = sorted({int(i) for i in discard})
        if any(i < 0 or i > 4 for i in idxs):
            raise GameError("位置只能是 0～4")
        if len(idxs) > 3:
            raise GameError("最多換 3 張")
        hand = state["hands"][player]
        for i in idxs:
            hand[i] = state["deck"].pop()
        state["drawn"].append(player)
        events = [f"{player} 換了 {len(idxs)} 張"]
        remaining = [p for p in state["players"] if p not in state["drawn"]]
        if remaining:
            state["turn"] = remaining[0]
            return events
        state["turn"] = None
        scores = {p: evaluate_five(h) for p, h in state["hands"].items()}
        best = max(scores.values())
        winners = [p for p, s in scores.items() if s == best]
        state["phase"] = "over"
        state["result"] = {
            "winners": winners,
            "hands": {p: {"cards": [card_name(c) for c in h], "rank": HAND_NAMES[scores[p][0]]} for p, h in state["hands"].items()},
        }
        events.append("攤牌：" + "、".join(f"{p} {HAND_NAMES[scores[p][0]]}" for p in state["players"]))
        events.append(("平分：" if len(winners) > 1 else "贏家：") + "、".join(winners))
        return events
