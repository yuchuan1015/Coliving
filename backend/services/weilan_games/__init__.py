"""微瀾遊戲規則登記表。activity_type → Game。

只有規則。跟 weilan_service（座位、聊天、輪流）、state_json、MCP 的接線都還沒做，
等喻墨看過再合。介面說明在 base.py 和 README.md。
"""
from __future__ import annotations

from .base import Game, GameError
from .blackjack import BlackjackGame
from .debate import DebateGame
from .gomoku import GomokuGame
from .mahjong import MahjongGame
from .poker import PokerGame
from .quiet import SitGame, WatchGame
from .spy import SpyGame
from .werewolf import WerewolfGame

GAMES: dict[str, Game] = {g.key: g for g in (
    DebateGame(), WerewolfGame(), SpyGame(),
    PokerGame(), BlackjackGame(), MahjongGame(),
    WatchGame(), SitGame(), GomokuGame(),
)}


def get_game(activity_type: str) -> Game:
    game = GAMES.get(activity_type)
    if not game:
        raise GameError(f"沒有「{activity_type}」這種遊戲")
    return game


__all__ = ["Game", "GameError", "GAMES", "get_game"]
