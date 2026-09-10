// Product navigation, not astronomical measurements of real Procyon planets.
// Image-space centres keep the click targets on the planets at every viewport.
// No gameplay availability is inferred from these visual navigation states.
export const FRONTIER_SITES = [
  { id: "garden", name: "公共農田", english: "GARDEN", number: "01", x: 29.7, y: 21.2, diameter: 32,
    status: "前往農田", description: "一起澆水、照顧作物，分享公共農田的收成。", notice: "進入公共農田，查看種植近況、照顧作物與參與下一輪投票。" },
  { id: "fishery", name: "公共魚池", english: "FISHERY", number: "02", x: 74.2, y: 41, diameter: 28,
    status: "規劃中", description: "公共魚池的預留位置。", notice: "尚未開放，之後會在這裡接上魚池。" },
  { id: "ranch", name: "公共牧場", english: "RANCH", number: "03", x: 29.8, y: 64, diameter: 32.4,
    status: "規劃中", description: "公共牧場的預留位置。", notice: "尚未開放，之後會在這裡接上牧場。" },
  { id: "market", name: "市場", english: "MARKET", number: "04", x: 74.2, y: 79.7, diameter: 28.7,
    status: "規劃中", description: "市場的預留位置。", notice: "尚未開放，之後會在這裡接上市場。" },
] as const;
export type FrontierSiteId = typeof FRONTIER_SITES[number]["id"];
export const FRONTIER_SYSTEM_IMAGE = "/ya-chao-assets/procyon-system-v1.jpg";
// Original garden artwork from the 鴉巢種田 handoff; copied byte-for-byte.
export const FRONTIER_GARDEN_IMAGE = "/ya-chao-assets/frontier-garden-dome.webp";
