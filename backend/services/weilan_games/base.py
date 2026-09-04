"""微瀾遊戲規則的共同介面。

每種遊戲是一個 Game 子類，只管規則，不碰 DB、不碰訊息、不碰座位。
state 是純 dict（可 json.dumps），將來塞進 weilan_tables.state_json。
玩家用字串 id（將來就是 agent_id），順序照入座順序。

流程（將來接到 weilan_service 時的用法）：
    game = get_game(table.activity_type)
    state = game.new_state(players, rng, options)
    ...
    events = game.apply(state, player, {"type": "...", ...}, rng)   # 規則不允許就 raise GameError
    game.current_player(state)      # 輪到誰；同時行動的階段回 None，用 pending_players
    game.pending_players(state)     # 這個階段還沒行動的人
    game.legal_actions(state, p)    # 這個人現在能做什麼（給 agent 看的說明）
    game.view(state, p)             # 這個人看得到的狀態（藏別人的牌／身分）
    game.is_over(state) / game.result(state)
"""
from __future__ import annotations

import copy
import random
from typing import Any


class GameError(ValueError):
    """規則不允許的動作。訊息給 agent 看，繁體中文。"""


class Game:
    key: str = ""
    name: str = ""
    min_players: int = 2
    max_players: int = 6
    description: str = ""

    # ── 子類要實作的 ──

    def new_state(self, players: list[str], rng: random.Random, options: dict | None = None) -> dict:
        raise NotImplementedError

    def legal_actions(self, state: dict, player: str) -> list[dict]:
        raise NotImplementedError

    def apply(self, state: dict, player: str, action: dict, rng: random.Random) -> list[str]:
        raise NotImplementedError

    def is_over(self, state: dict) -> bool:
        return state.get("phase") == "over"

    def result(self, state: dict) -> dict | None:
        return state.get("result") if self.is_over(state) else None

    # ── 預設行為，子類可覆寫 ──

    def current_player(self, state: dict) -> str | None:
        """輪流制的遊戲回輪到誰；同時行動的階段回 None。"""
        pending = self.pending_players(state)
        return pending[0] if len(pending) == 1 else None

    def pending_players(self, state: dict) -> list[str]:
        """這個階段還要誰行動。預設：輪到的那一個。"""
        p = state.get("turn")
        return [p] if p else []

    def view(self, state: dict, player: str | None) -> dict:
        """給某個玩家看的狀態。預設全部公開；有隱藏資訊的遊戲要覆寫。"""
        return copy.deepcopy(state)

    # ── 共用小工具 ──

    def check_players(self, players: list[str]) -> None:
        n = len(players)
        if n < self.min_players:
            raise GameError(f"{self.name}至少要 {self.min_players} 人，現在 {n} 人")
        if n > self.max_players:
            raise GameError(f"{self.name}最多 {self.max_players} 人，現在 {n} 人")
        if len(set(players)) != n:
            raise GameError("玩家重複")

    @staticmethod
    def require_over_not(state: dict) -> None:
        if state.get("phase") == "over":
            raise GameError("這局已經結束了")

    @staticmethod
    def require_in(player: str, players: list[str]) -> None:
        if player not in players:
            raise GameError("你不在這局裡")

    @staticmethod
    def action_type(action: dict) -> str:
        t = action.get("type") if isinstance(action, dict) else None
        if not t:
            raise GameError("動作要有 type")
        return str(t)


def majority_vote(votes: dict[str, str], rng: random.Random | None = None, allow_tie: bool = True) -> tuple[str | None, dict[str, int]]:
    """回 (得票最多者, 計票)。平手：allow_tie=True 回 None，否則用 rng 抽一個。"""
    tally: dict[str, int] = {}
    for target in votes.values():
        tally[target] = tally.get(target, 0) + 1
    if not tally:
        return None, tally
    top = max(tally.values())
    winners = [k for k, v in tally.items() if v == top]
    if len(winners) == 1:
        return winners[0], tally
    if allow_tie or rng is None:
        return None, tally
    return rng.choice(sorted(winners)), tally
