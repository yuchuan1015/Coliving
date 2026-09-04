"""狼人殺（高密度），簡化版：狼人、預言家、村民。

規則：
- 身分：狼人 = 人數 // 3（至少 1），預言家 1，其餘村民。至少 4 人。
- 夜晚：每個狼人投一個目標（action: kill, target），全投完取多數（平票隨機）殺掉；
  預言家查一人（action: check, target），只有他自己看得到結果。
- 白天：討論用桌上聊天（不在引擎裡）；活著的人投票放逐（action: vote, target 或 skip），
  多數出局，平票沒人出局。
- 勝負：狼人全死 → 好人勝；狼人數 ≥ 非狼人數 → 狼人勝。
- 同一階段多人同時行動，current_player 回 None，看 pending_players。
- view：只看自己身分；狼人看得到同伴；預言家看得到自己查過的結果。結束後全公開。
"""
from __future__ import annotations

from .base import Game, GameError, majority_vote

ROLE_NAMES = {"werewolf": "狼人", "seer": "預言家", "villager": "村民"}


class WerewolfGame(Game):
    key = "werewolf"
    name = "狼人殺"
    min_players = 4
    max_players = 12
    description = "夜晚狼人殺人，白天大家投票"

    def new_state(self, players, rng, options=None):
        self.check_players(players)
        n = len(players)
        shuffled = list(players)
        rng.shuffle(shuffled)
        n_wolves = max(1, n // 3)
        roles = {}
        for i, p in enumerate(shuffled):
            roles[p] = "werewolf" if i < n_wolves else ("seer" if i == n_wolves else "villager")
        state = {
            "game": self.key,
            "players": list(players),
            "roles": roles,
            "alive": list(players),
            "phase": "night_wolf",
            "night": 1,
            "wolf_votes": {},
            "seer_checks": [],
            "seer_done": False,
            "day_votes": {},
            "log": [],
            "result": None,
        }
        return state

    # ── 查詢 ──

    def _alive_role(self, state, role):
        return [p for p in state["alive"] if state["roles"][p] == role]

    def pending_players(self, state):
        ph = state["phase"]
        if ph == "night_wolf":
            return [w for w in self._alive_role(state, "werewolf") if w not in state["wolf_votes"]]
        if ph == "night_seer":
            return [] if state["seer_done"] else self._alive_role(state, "seer")
        if ph == "day_vote":
            return [p for p in state["alive"] if p not in state["day_votes"]]
        return []

    def legal_actions(self, state, player):
        if player not in state["alive"] or player not in self.pending_players(state):
            return []
        role = state["roles"][player]
        others = [p for p in state["alive"] if p != player]
        if state["phase"] == "night_wolf" and role == "werewolf":
            return [{"type": "kill", "target": "<玩家 id>", "choices": [p for p in others if state["roles"][p] != "werewolf"]}]
        if state["phase"] == "night_seer" and role == "seer":
            return [{"type": "check", "target": "<玩家 id>", "choices": others}]
        if state["phase"] == "day_vote":
            return [{"type": "vote", "target": "<玩家 id>", "choices": others}, {"type": "skip", "hint": "棄票"}]
        return []

    def view(self, state, player):
        v = {k: val for k, val in state.items() if k not in ("roles", "wolf_votes", "seer_checks")}
        if state["phase"] == "over" or player is None:
            v["roles"] = dict(state["roles"]) if state["phase"] == "over" else {}
            return v
        my_role = state["roles"].get(player)
        v["my_role"] = my_role
        v["my_role_name"] = ROLE_NAMES.get(my_role, "")
        if my_role == "werewolf":
            v["wolves"] = [p for p, r in state["roles"].items() if r == "werewolf"]
            v["wolf_votes"] = dict(state["wolf_votes"])
        if my_role == "seer":
            v["seer_checks"] = list(state["seer_checks"])
        return v

    # ── 進程 ──

    def _check_end(self, state):
        wolves = self._alive_role(state, "werewolf")
        others = [p for p in state["alive"] if state["roles"][p] != "werewolf"]
        if not wolves:
            state["phase"] = "over"
            state["result"] = {"winner": "villagers", "winners": [p for p, r in state["roles"].items() if r != "werewolf"]}
            return ["狼人全滅，好人勝"]
        if len(wolves) >= len(others):
            state["phase"] = "over"
            state["result"] = {"winner": "werewolves", "winners": wolves}
            return ["狼人數量壓過好人，狼人勝"]
        return []

    def _resolve_night(self, state, rng):
        target, _ = majority_vote(state["wolf_votes"], rng, allow_tie=False)
        events = []
        if target and target in state["alive"]:
            state["alive"].remove(target)
            state["log"].append({"night": state["night"], "killed": target})
            events.append(f"天亮了，{target} 昨晚死了")
        else:
            events.append("天亮了，昨晚是平安夜")
        state["wolf_votes"] = {}
        state["seer_done"] = False
        end = self._check_end(state)
        if end:
            return events + end
        state["phase"] = "day_vote"
        state["day_votes"] = {}
        events.append("白天：討論後投票")
        return events

    def apply(self, state, player, action, rng):
        self.require_over_not(state)
        self.require_in(player, state["players"])
        if player not in state["alive"]:
            raise GameError("你已經死了")
        t = self.action_type(action)
        role = state["roles"][player]
        ph = state["phase"]

        if t == "kill":
            if ph != "night_wolf":
                raise GameError("現在不是狼人行動的時候")
            if role != "werewolf":
                raise GameError("你不是狼人")
            if player in state["wolf_votes"]:
                raise GameError("你選過了")
            target = str(action.get("target", ""))
            if target not in state["alive"] or state["roles"][target] == "werewolf":
                raise GameError("只能選活著的非狼人")
            state["wolf_votes"][player] = target
            events = []  # 夜裡的事不廣播
            if not self.pending_players(state):
                if self._alive_role(state, "seer"):
                    state["phase"] = "night_seer"
                else:
                    events += self._resolve_night(state, rng)
            return events

        if t == "check":
            if ph != "night_seer":
                raise GameError("現在不是預言家行動的時候")
            if role != "seer":
                raise GameError("你不是預言家")
            if state["seer_done"]:
                raise GameError("今晚查過了")
            target = str(action.get("target", ""))
            if target not in state["alive"] or target == player:
                raise GameError("只能查活著的別人")
            state["seer_checks"].append({"night": state["night"], "target": target, "is_werewolf": state["roles"][target] == "werewolf"})
            state["seer_done"] = True
            return self._resolve_night(state, rng)

        if t in ("vote", "skip"):
            if ph != "day_vote":
                raise GameError("現在不是投票時間")
            if player in state["day_votes"]:
                raise GameError("你投過了")
            if t == "vote":
                target = str(action.get("target", ""))
                if target not in state["alive"] or target == player:
                    raise GameError("只能投活著的別人")
                state["day_votes"][player] = target
                events = [f"{player} 投了 {target}"]
            else:
                state["day_votes"][player] = "__skip__"
                events = [f"{player} 棄票"]
            if self.pending_players(state):
                return events
            real = {p: t2 for p, t2 in state["day_votes"].items() if t2 != "__skip__"}
            out, tally = majority_vote(real)
            state["last_tally"] = tally
            if out is None:
                events.append("平票或沒人投，今天沒人出局")
            else:
                state["alive"].remove(out)
                state["log"].append({"day": state["night"], "lynched": out})
                events.append(f"{out} 被放逐，身分是{ROLE_NAMES[state['roles'][out]]}")
            end = self._check_end(state)
            if end:
                return events + end
            state["night"] += 1
            state["phase"] = "night_wolf"
            state["day_votes"] = {}
            events.append(f"第 {state['night']} 夜，天黑請閉眼")
            return events

        raise GameError(f"狼人殺沒有「{t}」這個動作")
