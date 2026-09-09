import { clockHandAngles } from "../data/cabin-clock";

export function CabinClockFace({ now, timeZone, width, height }: {
  now: Date; timeZone?: string; width: number; height: number;
}) {
  const angle = clockHandAngles(now, timeZone);
  return <svg className="cabin-clock-face" viewBox="0 0 100 100" preserveAspectRatio="none"
    width={width} height={height} aria-hidden="true" focusable="false">
    <circle className="cabin-clock-dial" cx="50" cy="50" r="50" />
    {Array.from({ length: 12 }, (_, index) => <line key={index} className="cabin-clock-tick"
      x1="50" y1="8" x2="50" y2={index % 3 === 0 ? 19 : 14} transform={`rotate(${index * 30} 50 50)`} />)}
    <line className="cabin-clock-hour" x1="50" y1="54" x2="50" y2="29" transform={`rotate(${angle.hour} 50 50)`} />
    <line className="cabin-clock-minute" x1="50" y1="56" x2="50" y2="16" transform={`rotate(${angle.minute} 50 50)`} />
    <line className="cabin-clock-second" x1="50" y1="59" x2="50" y2="12" transform={`rotate(${angle.second} 50 50)`} />
    <circle className="cabin-clock-pin" cx="50" cy="50" r="3" />
  </svg>;
}
