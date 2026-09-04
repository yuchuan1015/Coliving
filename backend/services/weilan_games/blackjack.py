"""二十一點（中密度）。莊家是桌子自己（自動），玩家輪流要牌／停牌。

規則：
- 每人兩張、莊家兩張（一張蓋著）。玩家依序 hit / stand，超過 21 爆。
- 全部停了莊家翻牌，不到 17 就補牌。
- 結算：爆了輸；莊家爆了沒爆的都贏；否則比點數，同點平手。天生 21 點（兩張）算 blackjack，贏一般 21。
- 不下注（貝的事之後再說），只記勝負。
"""
from __future__ import annotations

from .base import Game, GameError
from .cards import blackjack_value, card_name, new_deck


class BlackjackGame(Game):
    key = "blackjack"
    name = "二十一點"
    min_players = 1
    max_players = 7
    description = "跟莊家比誰更接近 21 點"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        deck = new_deck(rng)
        hands = {p: [deck.pop(), deck.pop()] for p in players}
        dealer = [deck.pop(), deck.pop()]
        state = {
            "game": self.key,
            "players": list(players),
            "deck": deck,
            "hands": hands,
            "dealer": dealer,
            "done": {p: False for p in players},
            "phase": "player",
            "turn": players[0],
            "result": None,
        }
        # 每個人天生 21 點就直接算停
        for p in players:
            if blackjack_value(hands[p]) == 21:
                state["done"][p] = True
        self._advance(state)
        return state

    def _advance(self, state):
        for p in state["players"]:
            if not state["done"][p]:
                state["turn"] = p
                return
        state["turn"] = None
        self._dealer_play(state)

    def _dealer_play(self, state):
        state["phase"] = "dealer"
        while blackjack_value(state["dealer"]) < 17:
            state["dealer"].append(state["deck"].pop())
        dv = blackjack_value(state["dealer"])
        dealer_bj = dv == 21 and len(state["dealer"]) == 2
        outcomes = {}
        for p in state["players"]:
            hv = blackjack_value(state["hands"][p])
            pbj = hv == 21 and len(state["hands"][p]) == 2
            if hv > 21:
                outcomes[p] = "lose"
            elif pbj and not dealer_bj:
                outcomes[p] = "blackjack"
            elif dv > 21:
                outcomes[p] = "win"
            elif hv > dv:
                outcomes[p] = "win"
            elif hv < dv:
                outcomes[p] = "lose"
            else:
                outcomes[p] = "push"
        state["phase"] = "over"
        state["result"] = {
            "dealer_value": dv,
            "outcomes": outcomes,
            "winners": [p for p, o in outcomes.items() if o in ("win", "blackjack")],
        }

    def legal_actions(self, state, player):
        if state["phase"] == "player" and state["turn"] == player:
            return [{"type": "hit", "hint": "再要一張"}, {"type": "stand", "hint": "停"}]
        return []

    def view(self, state, player):
        v = {k: val for k, val in state.items() if k != "deck"}
        v["hands"] = {p: [card_name(c) for c in h] for p, h in state["hands"].items()}
        v["values"] = {p: blackjack_value(h) for p, h in state["hands"].items()}
        if state["phase"] == "over":
            v["dealer"] = [card_name(c) for c in state["dealer"]]
        else:
            v["dealer"] = [card_name(state["dealer"][0]), "🂠"]
        return v

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        if state["turn"] != player:
            raise GameError("還沒輪到你")
        t = self.action_type(action)
        hand = state["hands"][player]
        if t == "hit":
            card = state["deck"].pop()
            hand.append(card)
            v = blackjack_value(hand)
            events = [f"{player} 要牌：{card_name(card)}，{v} 點"]
            if v > 21:
                state["done"][player] = True
                events.append(f"{player} 爆了")
            elif v == 21:
                state["done"][player] = True
        elif t == "stand":
            state["done"][player] = True
            events = [f"{player} 停在 {blackjack_value(hand)} 點"]
        else:
            raise GameError("只能 hit 或 stand")
        self._advance(state)
        if state["phase"] == "over":
            r = state["result"]
            events.append(f"莊家 {r['dealer_value']} 點。結果：" + "、".join(f"{p} {o}" for p, o in r["outcomes"].items()))
        return events
