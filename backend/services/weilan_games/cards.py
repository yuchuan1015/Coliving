"""撲克牌共用：一副 52 張、洗牌、點數。牌用字串表示，例如 "AS"（黑桃 A）、"10H"（紅心 10）。"""
from __future__ import annotations

import random

SUITS = ["S", "H", "D", "C"]  # 黑桃 紅心 方塊 梅花
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
RANK_VALUE = {r: i + 2 for i, r in enumerate(RANKS)}  # 2..14
SUIT_NAMES = {"S": "黑桃", "H": "紅心", "D": "方塊", "C": "梅花"}


def new_deck(rng: random.Random) -> list[str]:
    deck = [r + s for s in SUITS for r in RANKS]
    rng.shuffle(deck)
    return deck


def rank_of(card: str) -> str:
    return card[:-1]


def suit_of(card: str) -> str:
    return card[-1]


def card_name(card: str) -> str:
    return f"{SUIT_NAMES[suit_of(card)]}{rank_of(card)}"


def blackjack_value(hand: list[str]) -> int:
    """A 算 11，爆了再改算 1。"""
    total, aces = 0, 0
    for c in hand:
        r = rank_of(c)
        if r == "A":
            aces += 1
            total += 11
        elif r in ("J", "Q", "K"):
            total += 10
        else:
            total += int(r)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


HAND_NAMES = {
    8: "同花順", 7: "四條", 6: "葫蘆", 5: "同花", 4: "順子",
    3: "三條", 2: "兩對", 1: "一對", 0: "高牌",
}


def evaluate_five(hand: list[str]) -> tuple:
    """五張牌的牌力，tuple 越大越強：(等級, 決勝點數...)。"""
    values = sorted((RANK_VALUE[rank_of(c)] for c in hand), reverse=True)
    suits = {suit_of(c) for c in hand}
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    # 依（張數, 點數）排序，決勝用
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    ordered = [v for v, _ in groups]
    is_flush = len(suits) == 1
    uniq = sorted(set(values), reverse=True)
    is_straight = len(uniq) == 5 and uniq[0] - uniq[4] == 4
    if not is_straight and uniq == [14, 5, 4, 3, 2]:  # A2345
        is_straight = True
        uniq = [5, 4, 3, 2, 1]
    if is_straight and is_flush:
        return (8, uniq[0])
    if groups[0][1] == 4:
        return (7, *ordered)
    if groups[0][1] == 3 and groups[1][1] == 2:
        return (6, *ordered)
    if is_flush:
        return (5, *values)
    if is_straight:
        return (4, uniq[0])
    if groups[0][1] == 3:
        return (3, *ordered)
    if groups[0][1] == 2 and groups[1][1] == 2:
        return (2, *ordered)
    if groups[0][1] == 2:
        return (1, *ordered)
    return (0, *values)
