export type CabinPanel = "settings" | "window" | "clock" | "wardrobe" | "dining" | "pet";
export interface CabinFurniture {
  id: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  path?: string;
  panel?: CabinPanel;
}
export interface CabinZone {
  id: string;
  label: string;
  image: string;
  furniture: CabinFurniture[];
}

// Coordinates belong to the room photograph, not to the phone viewport.
export const cabinZones: CabinZone[] = [
  { id: "life", label: "生活區", image: "/ya-chao-assets/cabin-life-v1.webp", furniture: [
    { id: "bed", label: "睡眠艙", detail: "休息、夢境與夜間狀態", x: .35, y: .52, path: "/home/sleep" },
    { id: "wardrobe", label: "衣櫃", detail: "室友的造型收藏", x: .92, y: .42, panel: "wardrobe" },
    { id: "mirror", label: "鏡子", detail: "資料更新處 · 頭像與大腦設定", x: .65, y: .38, path: "/agent/edit" },
    { id: "clock", label: "時鐘", detail: "當地時間與社區時間", x: .782, y: .335, panel: "clock" },
    { id: "window", label: "窗戶", detail: "看看今天的天氣", x: .13, y: .36, panel: "window" },
  ] },
  { id: "memory", label: "記憶區", image: "/ya-chao-assets/cabin-memory-v1.webp", furniture: [
    { id: "diary", label: "日記本", detail: "寫下值得留下的片刻", x: .25, y: .59, path: "/home/diary" },
    { id: "drawer", label: "抽屜", detail: "收藏室友的私人物件", x: .36, y: .74, path: "/home/drawer" },
    { id: "photos", label: "相框", detail: "收藏照片 · 選一張擺上相框", x: .34, y: .52, path: "/home/photos" },
    { id: "bookshelf", label: "記憶書架", detail: "我的記憶 · 一起讀書", x: .62, y: .31, path: "/home/library" },
    { id: "mailbox", label: "星際信箱", detail: "居民寄來的訊息", x: .90, y: .42, path: "/mailbox" },
  ] },
  { id: "shared", label: "共居區", image: "/ya-chao-assets/cabin-shared-v1.webp", furniture: [
    { id: "door", label: "出艙", detail: "選擇下一個目的地", x: .58, y: .35, path: "/outside" },
    { id: "dining", label: "餐桌", detail: "和室友一起吃飯", x: .35, y: .56, panel: "dining" },
    { id: "pet", label: "寵物", detail: "看看你的共居小夥伴", x: .86, y: .66, panel: "pet" },
  ] },
];

export function coverPoint(x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number, positionY = .5) {
  const scale = Math.max(width / imageWidth, height / imageHeight);
  return {
    x: x * imageWidth * scale - (imageWidth * scale - width) / 2,
    y: y * imageHeight * scale - (imageHeight * scale - height) * positionY,
  };
}
