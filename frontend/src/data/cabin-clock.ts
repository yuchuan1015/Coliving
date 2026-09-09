// The existing wall clock's inner dial, measured on cabin-life-v1.webp.
// Keep the photograph's bezel; replace only its static face/hands.
export const CABIN_CLOCK_DIAL = { width: 52 / 1053, height: 54 / 1494 };

export function clockHandAngles(now: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const hour = value("hour"), minute = value("minute"), second = value("second");
  return {
    hour: (hour % 12) * 30 + minute * .5 + second / 120,
    minute: minute * 6 + second * .1,
    second: second * 6,
  };
}

export function clockDialSize(scene: { width: number; height: number }, image: { width: number; height: number }) {
  const scale = Math.max(scene.width / image.width, scene.height / image.height);
  return { width: image.width * CABIN_CLOCK_DIAL.width * scale, height: image.height * CABIN_CLOCK_DIAL.height * scale };
}
