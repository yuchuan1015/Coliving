import { coverPoint } from "./cabin";

export type FramePoint = { x: number; y: number };
export type FrameQuad = readonly [FramePoint, FramePoint, FramePoint, FramePoint];

// Photo aperture, not the outer bevel. Calibrated on cabin-memory-v1.webp,
// 1053 × 1494 original pixels: top-left, top-right, bottom-right, bottom-left.
export const CABIN_FRAME_QUAD: FrameQuad = [
  { x: 323 / 1053, y: 691 / 1494 },
  { x: 379 / 1053, y: 696 / 1494 },
  { x: 371 / 1053, y: 779 / 1494 },
  { x: 315 / 1053, y: 772 / 1494 },
];
export const FRAME_SURFACE = { width: 120, height: 184 };

/** Project a flat photograph into the frame's four corners (CSS column-major). */
export function frameMatrix(quad: FrameQuad, width = FRAME_SURFACE.width, height = FRAME_SURFACE.height): number[] | null {
  if (![width, height].every(value => Number.isFinite(value) && value > 0) || quad.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-8) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  return [
    (p1.x - p0.x + g * p1.x) / width, (p1.y - p0.y + g * p1.y) / width, 0, g / width,
    (p3.x - p0.x + h * p3.x) / height, (p3.y - p0.y + h * p3.y) / height, 0, h / height,
    0, 0, 1, 0, p0.x, p0.y, 0, 1,
  ];
}

export function cabinFrameMatrix(sceneWidth: number, sceneHeight: number, imageWidth: number, imageHeight: number, positionY: number) {
  if (![sceneWidth, sceneHeight, imageWidth, imageHeight].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(positionY)) return null;
  // Use exactly the same object-fit:cover crop and object-position as the room.
  const corners = CABIN_FRAME_QUAD.map(p => coverPoint(p.x, p.y, sceneWidth, sceneHeight, imageWidth, imageHeight, positionY)) as unknown as FrameQuad;
  return frameMatrix(corners);
}
