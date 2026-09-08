export interface CoordinateSubject {
  coordinate?: { l: number; b: number; r: number; partial?: boolean } | null;
  partial?: boolean; drifting?: boolean; label?: string | null;
}
export function coordinateView(subject?: CoordinateSubject | null) {
  const c = subject?.coordinate;
  if (subject?.drifting || !c || ![c.l, c.b, c.r].every(Number.isFinite)) return { longitude: "—", latitude: "—", radius: "—", label: subject?.label || (subject?.drifting ? "星空漂流中" : "座標尚未同步") };
  const partial = subject?.partial === true || c.partial === true;
  return { longitude: `${c.l.toFixed(1)}°`, latitude: partial ? "尚未設定" : `b ${c.b >= 0 ? "+" : ""}${c.b.toFixed(2)}°`, radius: `${c.r.toFixed(2)} ly`, label: partial ? "定了經度、還在找緯度" : "座標已定位" };
}
export function validMonthDay(value: string) {
  if (!/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
