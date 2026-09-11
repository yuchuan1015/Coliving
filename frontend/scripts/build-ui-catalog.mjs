// Build-time only. Input is checked-in interface source, never resident data.
import fs from "node:fs";
import ts from "typescript";
import OpenCC from "opencc-js";
function jsxText(text) {
  const lines = text.replaceAll("\r", "").split("\n");
  let last = 0;
  lines.forEach((line, index) => { if (/[^ \t]/.test(line)) last = index; });
  return lines.map((line, index) => {
    let value = line.replaceAll("\t", " ");
    if (index !== 0) value = value.replace(/^ +/, "");
    if (index !== lines.length - 1) value = value.replace(/ +$/, "");
    return value + (value && index !== last ? " " : "");
  }).join("");
}
const convert = OpenCC.Converter({ from: "tw", to: "cn" });
const messages = new Set();
const templates = new Map();
function visitDirectory(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = dir + "/" + name;
    if (fs.statSync(file).isDirectory()) { if (name !== "i18n") visitDirectory(file); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    collect(file);
  }
}
function collect(file) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
      if (parts.length <= 5 && parts.every(Boolean) && (parts.join("").match(/\p{Script=Han}/gu)?.length ?? 0) >= 3) templates.set(JSON.stringify(parts), parts);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      const value = ts.isJsxText(node) ? jsxText(node.text) : node.text;
      if (/\p{Script=Han}/u.test(value)) messages.add(value);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
visitDirectory("src");
collect("src/i18n/LanguageControl.tsx");
// Checked-in garden catalog/system copy only, never resident proposal text or logs.
for (const row of JSON.parse(fs.readFileSync("src/data/garden-reference.json", "utf8"))) {
  [row.name, row.category, row.description].forEach(value => messages.add(value));
}
for (const value of JSON.parse(fs.readFileSync("src/data/garden-system-copy.json", "utf8"))) messages.add(value);
const terms = [
  ["帐户", "账户"], ["帐号", "账号"], ["登录", "登录"], ["登入", "登录"],
  ["注册", "注册"], ["登出", "退出登录"], ["设定", "设置"], ["设定值", "设置值"],
  ["资讯", "信息"], ["讯息", "消息"], ["内文", "正文"], ["档案", "文件"],
  ["联络", "联系"], ["上传", "上传"], ["汇出", "导出"], ["汇入", "导入"],
  ["复制", "复制"], ["贴上", "粘贴"], ["剪贴簿", "剪贴板"], ["连结", "链接"],
  ["浏览器", "浏览器"], ["重新整理", "刷新"], ["滑鼠", "鼠标"], ["排程", "定时任务"],
  ["连线", "连接"], ["网路", "网络"], ["程式", "程序"], ["伺服器", "服务器"],
  ["金钥", "密钥"], ["字元", "字符"], ["暂存", "缓存"], ["预设", "默认"],
  ["私讯", "私信"], ["载入", "加载"], ["暱称", "昵称"], ["介面", "界面"],
  ["收件匣", "收件箱"], ["寄件匣", "发件箱"],
];
const dictionary = Object.fromEntries([...messages].sort().map(source => {
  let target = convert(source);
  for (const [from, to] of terms) target = target.replaceAll(from, to);
  return [source, target];
}));
Object.assign(dictionary, {
  "時間檔案": "时间档案", "尚未連結 Agent": "尚未连接 Agent",
  "等待連結": "等待连接", "連結室友": "连接室友", "先連結室友 →": "先连接室友 →",
  "前往 ": "前往 ", "圖書館": "图书馆",
  "抽屜上鎖了。這是他自己的東西，你看得到抽屜，看不到裡面。": "抽屉上锁了。这是他自己的东西，你看得到抽屉，看不到里面。",
  // Reviewed server-owned labels from adult_service / routers.adult, not resident content.
  "關係、界線、怎麼跟室友相處": "关系、界线、怎么跟室友相处",
  "比較深的情感依附、身體議題": "比较深的情感依附、身体议题",
  "明確的性內容": "明确的性内容",
  "收到了，等人工審核，大約三個工作天。審核的人會決定分級。": "收到了，等人工审核，大约三个工作日。审核的人会决定分级。",
});
const outputs = {
  "src/i18n/zh-CN.json": dictionary,
  "src/i18n/templates.json": [...templates.values()].sort((a, b) => b.join("").length - a.join("").length),
};
const check = process.argv.includes("--check");
for (const [file, data] of Object.entries(outputs)) {
  const expected = JSON.stringify(data, null, 2) + "\n";
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
      console.error(file + " is stale. Run npm run i18n:generate."); process.exitCode = 1;
    }
  } else fs.writeFileSync(file, expected);
}
if (!process.exitCode) console.log(Object.keys(dictionary).length + " interface messages " + (check ? "verified" : "generated") + " (OpenCC 1.4.2 + reviewed UI terminology).");
