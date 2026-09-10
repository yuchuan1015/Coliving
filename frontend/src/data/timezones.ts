import { translateUi } from "../i18n/core";

export const COMMON_TIMEZONES = [
  "Asia/Taipei", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore",
  "Asia/Seoul", "Europe/London", "America/New_York", "America/Los_Angeles",
] as const;

const cities: Readonly<Record<string, string>> = {
  "Asia/Taipei": "台北", "Asia/Hong_Kong": "香港", "Asia/Tokyo": "東京",
  "Asia/Singapore": "新加坡", "Asia/Seoul": "首爾", "Europe/London": "倫敦",
  "America/New_York": "紐約", "America/Los_Angeles": "洛杉磯",
  "Asia/Shanghai": "北京／上海", "Asia/Macau": "澳門", "Asia/Bangkok": "曼谷",
  "Asia/Urumqi": "烏魯木齊（新疆地方時間）",
  "Asia/Kuala_Lumpur": "吉隆坡", "Asia/Manila": "馬尼拉", "Asia/Jakarta": "雅加達",
  "Asia/Ho_Chi_Minh": "胡志明市", "Asia/Kolkata": "加爾各答", "Asia/Calcutta": "加爾各答",
  "Asia/Kathmandu": "加德滿都", "Asia/Katmandu": "加德滿都", "Asia/Dubai": "杜拜",
  "Europe/Paris": "巴黎", "Europe/Berlin": "柏林", "Europe/Rome": "羅馬",
  "Europe/Madrid": "馬德里", "Europe/Amsterdam": "阿姆斯特丹",
  "America/Chicago": "芝加哥", "America/Denver": "丹佛", "America/Toronto": "多倫多",
  "America/Vancouver": "溫哥華", "Pacific/Honolulu": "檀香山",
  "Australia/Sydney": "雪梨", "Australia/Melbourne": "墨爾本",
  "Australia/Perth": "伯斯", "Pacific/Auckland": "奧克蘭", "UTC": "協調世界時",
};

// City search aliases, not separate account timezones. Beijing time is stored
// as Asia/Shanghai; Asia/Urumqi remains a distinct, clearly labelled option.
const aliases: Readonly<Record<string, string>> = {
  "Asia/Shanghai": "中國大陸 北京時間 北京 上海 廣州 深圳 成都 杭州 南京 蘇州 武漢 重慶 天津 西安 長沙 鄭州 青島 濟南 福州 廈門 瀋陽 大連 哈爾濱 長春 昆明 貴陽 南寧 海口 三亞 合肥 南昌 石家莊 太原 蘭州 西寧 銀川 呼和浩特 拉薩 烏魯木齊 China Beijing Shanghai Guangzhou Canton Shenzhen Chengdu Hangzhou Nanjing Suzhou Wuhan Chongqing Tianjin Xian Changsha Zhengzhou Qingdao Jinan Fuzhou Xiamen Shenyang Dalian Harbin Changchun Kunming Guiyang Nanning Haikou Sanya Hefei Nanchang Shijiazhuang Taiyuan Lanzhou Xining Yinchuan Hohhot Lhasa Urumqi UTC+8",
  "Asia/Urumqi": "新疆地方時間 烏魯木齊 Xinjiang Urumqi UTC+6",
};

export function validTimezone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; }
  catch { return false; }
}

export function browserTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validTimezone(zone) ? zone : "UTC";
  } catch { return "UTC"; }
}

// Preserve the saved identifier, including accepted IANA aliases. Detection is
// only a draft default; neither detection nor selection writes the account.
export function initialTimezone(saved: unknown, detected = browserTimezone()): string {
  return validTimezone(saved) ? saved : validTimezone(detected) ? detected : "UTC";
}

export function availableTimezones(saved?: string, detected = browserTimezone()): string[] {
  let supported: string[] = [];
  try { supported = Intl.supportedValuesOf?.("timeZone") ?? []; }
  catch { /* Older browsers still get common cities and their saved zone. */ }
  return [...new Set([...COMMON_TIMEZONES, saved, detected, "UTC", ...supported, ...Object.keys(cities)].filter(validTimezone))];
}

export function timezoneLabel(zone: string): string {
  return cities[zone] ?? (zone.split("/").slice(1).join(" / ").replaceAll("_", " ") || zone);
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replaceAll("臺", "台").replace(/[\s_-]+/g, "");
export function matchesTimezone(zone: string, query: string): boolean {
  if (!query.trim()) return true;
  const label = timezoneLabel(zone);
  const extra = aliases[zone] ?? "";
  return normalize([zone, label, translateUi(label, "zh-CN"), extra, translateUi(extra, "zh-CN")].join(" ")).includes(normalize(query));
}

export function timezoneTime(zone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}
