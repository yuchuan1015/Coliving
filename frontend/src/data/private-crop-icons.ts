export const privateCropIcons: Record<string, string> = {
  broccoli: "🥦", carrot: "🥕", cauliflower: "🥦", cucumber: "🥒", daikon: "🌱", kohlrabi: "🌱",
  pak_choi: "🥬", petite_oyster_mushroom: "🍄", potato: "🥔", tomato: "🍅", vegetable_fern: "🌿", water_spinach: "🌿",
};

// Local labels also work when a pending sale has no market response to display.
export const privateCropLabels: Readonly<Record<string, string>> = Object.freeze({
  broccoli: "青花菜", carrot: "胡蘿蔔", cauliflower: "花椰菜", cucumber: "小黃瓜", daikon: "白蘿蔔", kohlrabi: "球莖甘藍",
  pak_choi: "小白菜", petite_oyster_mushroom: "秀珍菇", potato: "馬鈴薯", tomato: "番茄", vegetable_fern: "過貓", water_spinach: "空心菜",
});
export const privateCropLabel = (id: string): string => Object.hasOwn(privateCropLabels, id) ? privateCropLabels[id] : "這份收成";
