export interface LegalAction { type: string; hint?: string; choices?: string[]; [key: string]: unknown }
export const ACTION_LABELS: Record<string, string> = { place: "落子", draw: "確認換牌", hit: "要牌", stand: "停牌", discard: "出牌", win: "自摸", ron: "榮和", pass: "略過", vote: "投票", skip: "棄票", kill: "選擇夜間目標", check: "查驗", statement: "發表陳述", describe: "描述詞語", note: "留下念頭", finish: "結束獨坐" };
export function buildGameAction(template: LegalAction, data: FormData, view: Record<string, unknown>): Record<string, unknown> {
  const type = template.type;
  if (!ACTION_LABELS[type]) throw new Error("此動作尚未支援，請更新牌局。");
  const action: Record<string, unknown> = { type };
  if (["note", "statement", "describe"].includes(type)) {
    const text = String(data.get("text") ?? "").trim(); if (!text) throw new Error("內容不能空白。"); action.text = text;
  } else if (type === "place") {
    const rowText = data.get("row"), colText = data.get("col"); const row = Number(rowText), col = Number(colText);
    if (rowText === null || colText === null || rowText === "" || colText === "" || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 14 || col < 0 || col > 14) throw new Error("請選擇棋盤內的空格。");
    if (Array.isArray(view.board) && view.board[row]?.[col]) throw new Error("這格已有棋子。");
    action.row = row; action.col = col;
  } else if (type === "draw") {
    const discard = data.getAll("discard").map(Number);
    if (discard.length > 3 || discard.some(n => !Number.isInteger(n) || n < 0 || n > 4) || new Set(discard).size !== discard.length) throw new Error("最多選擇三張不同的牌。"); action.discard = discard;
  } else if (type === "discard") {
    const tile = String(data.get("tile") ?? ""); const hand = [...(Array.isArray(view.my_hand_raw) ? view.my_hand_raw : []), view.my_drawn_raw];
    if (!tile || !hand.includes(tile)) throw new Error("請從自己的手牌選擇。"); action.tile = tile;
  } else if (Array.isArray(template.choices)) {
    const target = String(data.get("target") ?? ""); if (!template.choices.includes(target)) throw new Error("請選擇合法目標。"); action.target = target;
  } else if (type === "vote" && typeof template.side === "string") action.side = template.side;
  else if (["kill", "check", "vote"].includes(type)) throw new Error("沒有可選目標，請更新牌局。");
  return action;
}
