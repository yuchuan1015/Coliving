"""麻將（中密度），簡化版：不吃、不碰、不槓，只有自摸和榮和。

牌：萬筒條 1～9 各 4 張（108）＋ 東南西北中發白各 4 張（28）＝ 136。
牌用字串："1m"～"9m" 萬、"1p"～"9p" 筒、"1s"～"9s" 條、"E S W N" 風、"C F B" 中發白。
規則：
- 每人 13 張。輪到的人自動摸一張，然後 win（自摸，手牌 14 張成和）或 discard（打一張）。
- 打出的牌若讓別家能和，進入 claim 階段：能和的人依序決定 ron（榮和）或 pass。全 pass 才輪下一家。
- 和牌型：4 組面子（順子只限數牌／刻子）＋ 1 對將；或七對子。
- 牌山摸完沒人和 → 流局。
- 不算番、不算台，只記誰和了、自摸還是榮和、放槍的是誰。
- view 只看自己的手牌，別人的只看張數；牌河（打出的牌）公開。
"""
from __future__ import annotations

from collections import Counter

from .base import Game, GameError

SUITS = ["m", "p", "s"]
HONORS = ["E", "S", "W", "N", "C", "F", "B"]
TILE_NAMES = {"m": "萬", "p": "筒", "s": "條", "E": "東", "S": "南", "W": "西", "N": "北", "C": "中", "F": "發", "B": "白"}
HAND_SIZE = 13


def full_wall():
    wall = []
    for s in SUITS:
        for n in range(1, 10):
            wall += [f"{n}{s}"] * 4
    for h in HONORS:
        wall += [h] * 4
    return wall


def tile_name(t: str) -> str:
    return f"{t[0]}{TILE_NAMES[t[1]]}" if len(t) == 2 else TILE_NAMES[t]


def sort_tiles(tiles):
    def k(t):
        if len(t) == 2:
            return (SUITS.index(t[1]), int(t[0]))
        return (3, HONORS.index(t))
    return sorted(tiles, key=k)


def _melds_possible(counter: Counter) -> bool:
    """counter 裡的牌能不能全部拆成順子／刻子。"""
    if sum(counter.values()) == 0:
        return True
    tile = sort_tiles([t for t, c in counter.items() if c > 0])[0]
    c = counter[tile]
    # 刻子
    if c >= 3:
        counter[tile] -= 3
        if _melds_possible(counter):
            counter[tile] += 3
            return True
        counter[tile] += 3
    # 順子（只限數牌）
    if len(tile) == 2:
        n, s = int(tile[0]), tile[1]
        if n <= 7:
            t2, t3 = f"{n + 1}{s}", f"{n + 2}{s}"
            if counter[t2] > 0 and counter[t3] > 0:
                counter[tile] -= 1
                counter[t2] -= 1
                counter[t3] -= 1
                ok = _melds_possible(counter)
                counter[tile] += 1
                counter[t2] += 1
                counter[t3] += 1
                if ok:
                    return True
    return False


def is_winning(tiles: list[str]) -> bool:
    """14 張成不成和：4 面子 + 1 將，或七對子。"""
    if len(tiles) != HAND_SIZE + 1:
        return False
    counter = Counter(tiles)
    if len(counter) == 7 and all(c == 2 for c in counter.values()):
        return True
    for pair in [t for t, c in counter.items() if c >= 2]:
        counter[pair] -= 2
        if _melds_possible(Counter({t: c for t, c in counter.items() if c > 0})):
            counter[pair] += 2
            return True
        counter[pair] += 2
    return False


class MahjongGame(Game):
    key = "mahjong"
    name = "麻將"
    min_players = 2
    max_players = 4
    description = "簡化麻將：不吃不碰不槓，自摸或榮和"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        wall = full_wall()
        rng.shuffle(wall)
        hands = {p: sort_tiles([wall.pop() for _ in range(HAND_SIZE)]) for p in players}
        state = {
            "game": self.key,
            "players": list(players),
            "wall": wall,
            "hands": hands,
            "drawn": {p: None for p in players},
            "discards": {p: [] for p in players},
            "phase": "turn",
            "turn": players[0],
            "last_discard": None,
            "claimants": [],
            "claim_index": 0,
            "result": None,
        }
        self._draw(state, players[0])
        return state

    def _draw(self, state, player):
        if not state["wall"]:
            state["phase"] = "over"
            state["turn"] = None
            state["result"] = {"winners": [], "reason": "流局"}
            return
        state["drawn"][player] = state["wall"].pop()
        state["turn"] = player

    def _next(self, state, player):
        ps = state["players"]
        return ps[(ps.index(player) + 1) % len(ps)]

    def pending_players(self, state):
        if state["phase"] == "turn":
            return [state["turn"]]
        if state["phase"] == "claim":
            return [state["claimants"][state["claim_index"]]]
        return []

    def legal_actions(self, state, player):
        if state["phase"] == "turn" and state["turn"] == player:
            acts = [{"type": "discard", "tile": "<牌，例如 3m>"}]
            if is_winning(state["hands"][player] + [state["drawn"][player]]):
                acts.insert(0, {"type": "win", "hint": "自摸！"})
            return acts
        if state["phase"] == "claim" and self.pending_players(state) == [player]:
            return [{"type": "ron", "hint": f"榮和 {tile_name(state['last_discard']['tile'])}"}, {"type": "pass"}]
        return []

    def view(self, state, player):
        v = {k: val for k, val in state.items() if k not in ("wall", "hands", "drawn")}
        v["wall_left"] = len(state["wall"])
        v["hand_counts"] = {p: len(h) for p, h in state["hands"].items()}
        if player in state["hands"]:
            v["my_hand"] = [tile_name(t) for t in state["hands"][player]]
            v["my_hand_raw"] = list(state["hands"][player])
            v["my_drawn"] = tile_name(state["drawn"][player]) if state["drawn"][player] else None
            v["my_drawn_raw"] = state["drawn"][player]
        v["discards"] = {p: [tile_name(t) for t in d] for p, d in state["discards"].items()}
        if state["phase"] == "over":
            v["hands"] = {p: [tile_name(t) for t in h] for p, h in state["hands"].items()}
        return v

    def _finish(self, state, winner, how, from_player=None):
        state["phase"] = "over"
        state["turn"] = None
        state["result"] = {"winners": [winner], "how": how, "from": from_player}

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        t = self.action_type(action)
        if state["phase"] == "turn":
            if state["turn"] != player:
                raise GameError("還沒輪到你")
            hand14 = state["hands"][player] + [state["drawn"][player]]
            if t == "win":
                if not is_winning(hand14):
                    raise GameError("這手牌沒有和")
                state["hands"][player] = sort_tiles(hand14)
                state["drawn"][player] = None
                self._finish(state, player, "self_draw")
                return [f"{player} 自摸！"]
            if t == "discard":
                tile = str(action.get("tile", ""))
                if tile not in hand14:
                    raise GameError("你沒有這張牌")
                hand14.remove(tile)
                state["hands"][player] = sort_tiles(hand14)
                state["drawn"][player] = None
                state["discards"][player].append(tile)
                state["last_discard"] = {"player": player, "tile": tile}
                events = [f"{player} 打 {tile_name(tile)}"]
                claimants = [p for p in state["players"] if p != player and is_winning(state["hands"][p] + [tile])]
                if claimants:
                    # 從下家開始順時針問
                    order = []
                    q = self._next(state, player)
                    while q != player:
                        if q in claimants:
                            order.append(q)
                        q = self._next(state, q)
                    state["phase"] = "claim"
                    state["claimants"] = order
                    state["claim_index"] = 0
                    state["turn"] = None
                    events.append(f"{order[0]} 可以榮和，等他決定")
                    return events
                self._draw(state, self._next(state, player))
                if state["phase"] == "over":
                    events.append("牌山摸完，流局")
                return events
            raise GameError("輪到你時只能 win 或 discard")
        if state["phase"] == "claim":
            if self.pending_players(state) != [player]:
                raise GameError("現在不是問你")
            tile = state["last_discard"]["tile"]
            if t == "ron":
                state["hands"][player] = sort_tiles(state["hands"][player] + [tile])
                state["discards"][state["last_discard"]["player"]].pop()
                self._finish(state, player, "ron", state["last_discard"]["player"])
                return [f"{player} 榮和 {tile_name(tile)}，{state['last_discard']['player']} 放槍"]
            if t == "pass":
                state["claim_index"] += 1
                if state["claim_index"] < len(state["claimants"]):
                    return [f"{player} 過，換 {state['claimants'][state['claim_index']]} 決定"]
                state["phase"] = "turn"
                state["claimants"] = []
                state["claim_index"] = 0
                self._draw(state, self._next(state, state["last_discard"]["player"]))
                return [f"{player} 過"] + (["牌山摸完，流局"] if state["phase"] == "over" else [])
            raise GameError("只能 ron 或 pass")
        raise GameError("這局已經結束了")
