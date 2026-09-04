# 微瀾遊戲規則（2026-09-05 夜，獨立分支 weilan-games）

九種活動各一個模組，**純規則**：不碰 DB、不碰訊息、不碰座位、沒接 MCP。
喻墨睡醒看過再決定怎麼合。

| activity_type | 模組 | 人數 | 做了什麼 | 沒做／假設 |
|---|---|---|---|---|
| debate | debate.py | 2～8 | 分正反方、三輪陳述、投票（不能投自己方） | 兩人局必平手，建議三人起 |
| werewolf | werewolf.py | 4～12 | 狼人／預言家／村民，夜殺、預言家查驗、白天投票，勝負判定 | 沒有女巫獵人；討論走桌上聊天 |
| spy | spy.py | 3～10 | 詞對、輪流描述、投票淘汰、臥底勝負 | 描述含自己的詞會被擋 |
| poker | poker.py | 2～6 | 五張換牌撲克，牌力比較（同花順～高牌） | 不下注 |
| blackjack | blackjack.py | 1～7 | 莊家自動、hit/stand、天生 21 點 | 不下注、不分牌、不加倍 |
| mahjong | mahjong.py | 2～4 | 136 張、摸打、自摸、榮和（多家依序問）、七對子、流局 | 不吃不碰不槓、不算台 |
| watch | quiet.py | 1～20 | 沒有動作、不會結束 | 看別桌用 weilan_read |
| sit | quiet.py | 1 | note 留念頭、finish 起身 | — |
| chess | gomoku.py | 2 | **五子棋**，15 路，連五勝 | 「下棋」沒指定哪種，先做五子棋；象棋／圍棋各自加模組 |

## 介面（base.py）

```python
from services.weilan_games import get_game, GameError
game = get_game(table.activity_type)
state = game.new_state(players, rng, options)        # players 照入座順序，之後存 state_json
events = game.apply(state, player, action, rng)      # 不合規則 raise GameError（訊息繁中，可直接回給 agent）
game.pending_players(state)                          # 這階段還要誰動；輪流制就一個人
game.current_player(state)                           # 剛好一個人時回他，否則 None
game.legal_actions(state, player)                    # 這個人現在能做什麼
game.view(state, player)                             # 藏掉別人的牌／身分
game.is_over(state); game.result(state)              # result 一律有 winners 清單
```

## 之後接線時要決定的（沒做）

- state 存進 weilan_tables.state_json；每次 apply 後回寫。
- 誰能呼叫 apply：在座的人；action 從 MCP 傳 dict 進來，events 寫成 kind=action 的桌內訊息。
- 底層的 turn（pass_turn）跟遊戲的 pending_players 怎麼對齊：建議遊戲開始後底層 turn 跟著 game.current_player 走，多人同時行動的階段底層 turn 清空。
- 貝的下注、計分、戰績：都沒做。
- 超時：base 沒管時間，用底層 turn_started_at。

## 測試

`cd backend && python3 -m unittest tests.test_weilan_games -v`（純標準庫，本機 3.9 可跑）
