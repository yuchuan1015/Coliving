import random
import unittest

from services.weilan_games import GAMES, GameError, get_game
from services.weilan_games.cards import evaluate_five, blackjack_value
from services.weilan_games.mahjong import is_winning


def play_random(game, players, seed, options=None, max_steps=5000):
    """隨機亂玩到結束，回 (state, steps)。用來抓 crash 和卡死。"""
    rng = random.Random(seed)
    state = game.new_state(players, rng, options)
    steps = 0
    while not game.is_over(state) and steps < max_steps:
        pending = game.pending_players(state)
        assert pending, f"{game.key}: 沒結束卻沒人要動 phase={state.get('phase')}"
        p = pending[0]
        acts = game.legal_actions(state, p)
        assert acts, f"{game.key}: {p} 在 pending 卻沒有 legal_actions"
        a = dict(rng.choice(acts))
        # 把範本填成真的值
        if "choices" in a:
            a["target"] = rng.choice(a["choices"])
        if a["type"] in ("statement", "describe", "note"):
            a["text"] = f"這是 {p} 的第 {steps} 句"
        if a["type"] == "draw":
            a["discard"] = rng.sample(range(5), rng.randint(0, 3))
        if a["type"] == "place":
            empties = [(r, c) for r in range(15) for c in range(15) if not state["board"][r][c]]
            a["row"], a["col"] = rng.choice(empties)
        if a["type"] == "discard":
            a["tile"] = rng.choice(state["hands"][p] + [state["drawn"][p]])
        if a["type"] == "vote" and game.key == "debate":
            pass
        game.apply(state, p, a, rng)
        steps += 1
    return state, steps


class RegistryTest(unittest.TestCase):
    def test_nine_games(self):
        self.assertEqual(set(GAMES), {"debate", "werewolf", "spy", "poker", "blackjack", "mahjong", "watch", "sit", "chess"})
        with self.assertRaises(GameError):
            get_game("nope")

    def test_player_count_checks(self):
        rng = random.Random(0)
        with self.assertRaises(GameError):
            get_game("werewolf").new_state(["a", "b", "c"], rng)
        with self.assertRaises(GameError):
            get_game("chess").new_state(["a", "b", "c"], rng)
        with self.assertRaises(GameError):
            get_game("sit").new_state(["a", "b"], rng)


class RandomPlayTest(unittest.TestCase):
    """每種遊戲用不同 seed 亂玩到底，不能 crash、不能卡死、結果要有 winners。"""

    def _run(self, key, players, seeds=range(8)):
        game = get_game(key)
        for seed in seeds:
            state, steps = play_random(game, players, seed)
            self.assertTrue(game.is_over(state), f"{key} seed {seed} 沒結束（{steps} 步）")
            self.assertIsInstance(game.result(state)["winners"], list)
            for p in players:
                game.view(state, p)  # 不能炸

    def test_debate(self): self._run("debate", ["a", "b", "c"])
    def test_spy(self): self._run("spy", ["a", "b", "c", "d"])
    def test_werewolf(self): self._run("werewolf", ["a", "b", "c", "d", "e", "f"], seeds=range(20))
    def test_poker(self): self._run("poker", ["a", "b", "c"])
    def test_blackjack(self): self._run("blackjack", ["a", "b"])
    def test_mahjong(self): self._run("mahjong", ["a", "b", "c", "d"], seeds=range(6))
    def test_gomoku(self): self._run("chess", ["a", "b"], seeds=range(4))
    def test_sit(self): self._run("sit", ["a"])


class DebateTest(unittest.TestCase):
    def test_flow_and_vote_rule(self):
        g = get_game("debate"); rng = random.Random(1)
        s = g.new_state(["a", "b", "c"], rng, {"topic": "T"})
        self.assertEqual(s["sides"], {"a": "pro", "b": "con", "c": "pro"})
        with self.assertRaises(GameError):
            g.apply(s, "b", {"type": "statement", "text": "x"}, rng)  # not b's turn
        for _ in range(3):
            for p in ["a", "b", "c"]:
                g.apply(s, p, {"type": "statement", "text": "論點"}, rng)
        self.assertEqual(s["phase"], "vote")
        with self.assertRaises(GameError):
            g.apply(s, "a", {"type": "vote", "side": "pro"}, rng)  # own side
        g.apply(s, "a", {"type": "vote", "side": "con"}, rng)
        g.apply(s, "b", {"type": "vote", "side": "pro"}, rng)
        ev = g.apply(s, "c", {"type": "vote", "side": "con"}, rng)
        self.assertEqual(s["result"]["winner_side"], "con")
        self.assertEqual(s["result"]["winners"], ["b"])
        self.assertIn("反方勝", ev[-1])


class SpyTest(unittest.TestCase):
    def test_hidden_words_and_spy_caught(self):
        g = get_game("spy"); rng = random.Random(3)
        s = g.new_state(["a", "b", "c", "d"], rng)
        spy = s["spy"]
        v = g.view(s, "a")
        self.assertNotIn("spy", v); self.assertNotIn("words", v); self.assertEqual(v["my_word"], s["words"]["a"])
        with self.assertRaises(GameError):
            g.apply(s, "a", {"type": "describe", "text": "就是" + s["words"]["a"]}, rng)
        for p in ["a", "b", "c", "d"]:
            g.apply(s, p, {"type": "describe", "text": "嗯"}, rng)
        for p in ["a", "b", "c", "d"]:
            target = spy if p != spy else [q for q in "abcd" if q != spy][0]
            g.apply(s, p, {"type": "vote", "target": target}, rng)
        self.assertEqual(s["result"]["winner"], "civilians")
        self.assertIn("spy", g.view(s, "a"))


class WerewolfTest(unittest.TestCase):
    def test_roles_and_night_day(self):
        g = get_game("werewolf"); rng = random.Random(5)
        ps = ["a", "b", "c", "d", "e", "f"]
        s = g.new_state(ps, rng)
        roles = s["roles"]
        wolves = [p for p in ps if roles[p] == "werewolf"]; seer = [p for p in ps if roles[p] == "seer"][0]
        self.assertEqual(len(wolves), 2)
        self.assertEqual(set(g.pending_players(s)), set(wolves))
        self.assertIsNone(g.current_player(s))
        victim = [p for p in ps if p not in wolves and p != seer][0]
        with self.assertRaises(GameError):
            g.apply(s, seer, {"type": "kill", "target": victim}, rng)
        for w in wolves:
            g.apply(s, w, {"type": "kill", "target": victim}, rng)
        self.assertEqual(s["phase"], "night_seer")
        ev = g.apply(s, seer, {"type": "check", "target": wolves[0]}, rng)
        self.assertTrue(g.view(s, seer)["seer_checks"][0]["is_werewolf"])
        self.assertNotIn("seer_checks", g.view(s, victim if victim in s["alive"] else "a"))
        self.assertNotIn(victim, s["alive"]); self.assertEqual(s["phase"], "day_vote")
        # villagers lynch a wolf
        for p in s["alive"]:
            g.apply(s, p, {"type": "vote", "target": wolves[0]} if p != wolves[0] else {"type": "skip"}, rng)
        self.assertNotIn(wolves[0], s["alive"]); self.assertEqual(s["phase"], "night_wolf"); self.assertEqual(s["night"], 2)
        self.assertEqual(set(g.view(s, wolves[1])["wolves"]), set(wolves))


class CardsTest(unittest.TestCase):
    def test_hand_ranks(self):
        self.assertEqual(evaluate_five(["10S", "JS", "QS", "KS", "AS"])[0], 8)
        self.assertEqual(evaluate_five(["AS", "2H", "3D", "4C", "5S"])[0], 4)
        self.assertEqual(evaluate_five(["9S", "9H", "9D", "9C", "2S"])[0], 7)
        self.assertEqual(evaluate_five(["9S", "9H", "9D", "2C", "2S"])[0], 6)
        self.assertEqual(evaluate_five(["2S", "5S", "9S", "JS", "KS"])[0], 5)
        self.assertEqual(evaluate_five(["9S", "9H", "3D", "3C", "2S"])[0], 2)
        self.assertGreater(evaluate_five(["AS", "AH", "3D", "4C", "5S"]), evaluate_five(["KS", "KH", "3D", "4C", "5S"]))
        self.assertEqual(blackjack_value(["AS", "KS"]), 21)
        self.assertEqual(blackjack_value(["AS", "AH", "9D"]), 21)
        self.assertEqual(blackjack_value(["KS", "QS", "5D"]), 25)

    def test_blackjack_hidden_dealer(self):
        g = get_game("blackjack"); rng = random.Random(2)
        s = g.new_state(["a", "b"], rng)
        if s["phase"] != "over":
            self.assertEqual(g.view(s, "a")["dealer"][1], "🂠")
            p = s["turn"]; g.apply(s, p, {"type": "stand"}, rng)

    def test_poker_hidden_then_shown(self):
        g = get_game("poker"); rng = random.Random(4)
        s = g.new_state(["a", "b"], rng)
        self.assertEqual(g.view(s, "a")["hands"]["b"], ["🂠"] * 5)
        with self.assertRaises(GameError):
            g.apply(s, "a", {"type": "draw", "discard": [0, 1, 2, 3]}, rng)
        g.apply(s, "a", {"type": "draw", "discard": [0]}, rng)
        g.apply(s, "b", {"type": "draw", "discard": []}, rng)
        self.assertEqual(s["phase"], "over"); self.assertNotIn("🂠", g.view(s, "a")["hands"]["b"])


class MahjongTest(unittest.TestCase):
    def test_is_winning(self):
        self.assertTrue(is_winning(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "E", "C", "C"]))
        self.assertTrue(is_winning(["1m", "1m", "2m", "2m", "3m", "3m", "E", "E", "S", "S", "C", "C", "B", "B"]))  # 七對
        self.assertFalse(is_winning(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "S", "C", "C"]))
        self.assertFalse(is_winning(["E", "S", "W", "N", "C", "F", "B", "1m", "1m", "1m", "2m", "3m", "4m", "5m"]))  # 字牌不能順

    def test_ron_flow(self):
        g = get_game("mahjong"); rng = random.Random(0)
        s = g.new_state(["a", "b"], rng)
        # 直接擺一手聽牌給 b：等 3m
        s["hands"]["b"] = ["1m", "2m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "E", "C", "C"]
        s["hands"]["a"] = ["3m"] + s["hands"]["a"][1:]
        s["drawn"]["a"] = "9p"
        ev = g.apply(s, "a", {"type": "discard", "tile": "3m"}, rng)
        self.assertEqual(s["phase"], "claim"); self.assertEqual(g.pending_players(s), ["b"])
        with self.assertRaises(GameError):
            g.apply(s, "a", {"type": "pass"}, rng)
        ev = g.apply(s, "b", {"type": "ron"}, rng)
        self.assertEqual(s["result"], {"winners": ["b"], "how": "ron", "from": "a"})
        self.assertIn("放槍", ev[0])

    def test_self_draw(self):
        g = get_game("mahjong"); rng = random.Random(0)
        s = g.new_state(["a", "b"], rng)
        s["hands"]["a"] = ["1m", "2m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "E", "C", "C"]
        s["drawn"]["a"] = "3m"
        self.assertEqual(g.legal_actions(s, "a")[0]["type"], "win")
        g.apply(s, "a", {"type": "win"}, rng)
        self.assertEqual(s["result"]["how"], "self_draw")


class GomokuTest(unittest.TestCase):
    def test_five_in_row(self):
        g = get_game("chess"); rng = random.Random(0)
        s = g.new_state(["a", "b"], rng)
        for i in range(4):
            g.apply(s, "a", {"type": "place", "row": 7, "col": i}, rng)
            g.apply(s, "b", {"type": "place", "row": 8, "col": i}, rng)
        with self.assertRaises(GameError):
            g.apply(s, "a", {"type": "place", "row": 8, "col": 0}, rng)
        ev = g.apply(s, "a", {"type": "place", "row": 7, "col": 4}, rng)
        self.assertEqual(s["result"]["winners"], ["a"]); self.assertIn("連五", ev[-1])


class QuietTest(unittest.TestCase):
    def test_watch_and_sit(self):
        rng = random.Random(0)
        w = get_game("watch"); s = w.new_state(["a", "b"], rng)
        self.assertFalse(w.is_over(s)); self.assertEqual(w.pending_players(s), [])
        with self.assertRaises(GameError):
            w.apply(s, "a", {"type": "anything"}, rng)
        t = get_game("sit"); s = t.new_state(["a"], rng)
        t.apply(s, "a", {"type": "note", "text": "安靜"}, rng)
        t.apply(s, "a", {"type": "finish"}, rng)
        self.assertEqual(s["result"]["notes"], 1)


if __name__ == "__main__":
    unittest.main()
