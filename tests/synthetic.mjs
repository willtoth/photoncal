// Independent Brown-Conrady projection fixture, with deterministic observation noise.
export function syntheticDataset(count = 40, partial = false, project) {
  const width = 1280,
    height = 720,
    board = {
      kind: 'charuco',
      columns: 8,
      rows: 8,
      squareSize: 0.0254,
      markerSize: 0.01905,
      dictionary: 3,
      legacy: false,
    };
  const truth = [
    820, 825, 639.5, 359.5, -0.16, 0.04, 0.0008, -0.0006, -0.006, 0.02, -0.003, 0.0002,
  ];
  let seed = 18457;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const frames = [];
  while (frames.length < count) {
    const ax = (random() - 0.5) * 1.5,
      ay = (random() - 0.5) * 1.5,
      az = (random() - 0.5) * 0.8;
    const ca = Math.cos(ax),
      sa = Math.sin(ax),
      cb = Math.cos(ay),
      sb = Math.sin(ay),
      cc = Math.cos(az),
      sc = Math.sin(az);
    const R = [
      cc * cb,
      cc * sb * sa - sc * ca,
      cc * sb * ca + sc * sa,
      sc * cb,
      sc * sb * sa + cc * ca,
      sc * sb * ca - cc * sa,
      -sb,
      cb * sa,
      cb * ca,
    ];
    const z = 0.28 + random() * 0.6,
      tx = (random() - 0.5) * z * 1.18 - 0.07,
      ty = (random() - 0.5) * z * 0.58 - 0.07;
    const corners = [];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 7; col++) {
        const id = row * 7 + col,
          X = col * board.squareSize,
          Y = row * board.squareSize,
          Z = 0;
        const cx = R[0] * X + R[1] * Y + tx,
          cy = R[3] * X + R[4] * Y + ty,
          cz = R[6] * X + R[7] * Y + z;
        const nx = cx / cz,
          ny = cy / cz,
          r2 = nx * nx + ny * ny;
        const [fx, fy, c0, c1, k1, k2, p1, p2, k3, k4, k5, k6] = truth;
        const radial =
          (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2) /
          (1 + k4 * r2 + k5 * r2 * r2 + k6 * r2 * r2 * r2);
        let x =
          fx * (nx * radial + 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx)) + c0 + 0.12 * normal();
        let y =
          fy * (ny * radial + p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny) + c1 + 0.12 * normal();
        if (project) {
          const q = project(cx, cy, cz);
          x = q[0] + 0.12 * normal();
          y = q[1] + 0.12 * normal();
        }
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
        if (
          partial &&
          ((frames.length % 3 === 0 && col < 2) || (frames.length % 5 === 0 && row > 4))
        )
          continue;
        corners.push({ id, x, y });
      }
    if (corners.length < 15) continue;
    frames.push({ id: `synthetic-${frames.length}`, corners });
  }
  return { request: { width, height, board, fov: 76, frames }, truth };
}
