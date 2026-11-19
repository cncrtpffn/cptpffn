// Геометрия для описаний карты: знаковые расстояния (минус — внутри), гладкий минимум, bbox.

export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

// знаковое расстояние до эллипса (приближение Иньиго Килеса), минус — внутри.
// У центра приближение зависит от направления (−a или −b) — острый конус; внутри не глубже −min(a, b)
export function sdEllipse(x, z, a, b) {
  const k0 = Math.hypot(x / a, z / b), k1 = Math.hypot(x / (a * a), z / (b * b));
  return k0 < 1e-6 ? -Math.min(a, b) : Math.max(k0 * (k0 - 1) / k1, -Math.min(a, b));
}
// расстояние до ломаной и параметр вдоль неё 0..1
export function sdPolyline(x, z, pts, out) {
  let best = Infinity, bestT = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / L2);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; bestT = acc + t * L; }
    acc += L;
  }
  out.t = bestT / acc;
  return best;
}
// знаковое расстояние до многоугольника (замкнутого, вершины [[x, z], …])
export function sdPolygon(x, z, pts) {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], [bx, bz] = pts[i];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = clamp01((wx * ex + wz * ez) / (ex * ex + ez * ez));
    d = Math.min(d, Math.hypot(wx - ex * t, wz - ez * t));
    if ((az > z) !== (bz > z) && x < ax + (z - az) * ex / ez) inside = !inside;
  }
  return inside ? -d : d;
}
// гладкий минимум (объединение лепестков без складки)
export function smin(a, b, k) { const h = clamp01(0.5 + 0.5 * (b - a) / k); return lerp(b, a, h) - k * h * (1 - h); }
export const polyBox = (pts, pad) => {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
};
