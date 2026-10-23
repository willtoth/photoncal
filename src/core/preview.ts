// Presentation only. Never use this transform for captured pixels or solver inputs.
export function previewPoint(x: number, y: number, rotated: boolean) {
  return rotated ? { x: 1 - x, y: 1 - y } : { x, y };
}
