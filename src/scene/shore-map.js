import * as THREE from 'three';

// Гашение волн у берега: на урезе и над сушей остаётся min от волны (накат),
// с глубины depth (м) — полная волна. Одна формула для CPU (waves.damp) и вершинного
// шейдера воды (SHORE_DAMP_GLSL), чтобы лодка качалась на той же волне, что видна.
export const SHORE_DAMP = { min: 0.25, depth: 3 };
export function shoreDamp(depth) {
  const t = Math.min(1, Math.max(0, depth / SHORE_DAMP.depth));
  return SHORE_DAMP.min + (1 - SHORE_DAMP.min) * t * t * (3 - 2 * t);
}

// Карта берега: один раз при старте запекаем в мировую текстуру расстояние до берега,
// глубину и нормаль от берега. Шейдер воды (SURF_GLSL) берёт одну выборку на пиксель —
// цена не зависит ни от числа островов, ни от сложности береговой линии.
//
// shores — g.userData.shore островов: { x, z, R, height(wx, wz), rocks: [{ x, z, r }] }.
// Каналы RGBA8 (линейная фильтрация float-текстур на мобильных не гарантирована):
//   R — знаковое расстояние до берега, [−range, range] м, плюс — вода;
//   G — глубина, [0, maxDepth] м;
//   B, A — нормаль от берега (в сторону воды), xz·0.5 + 0.5.
// maxDepth = 4: глубже рельеф островов не опускается.
export function bakeShoreMap(shores, { texel = 0.6, maxSize = 2048, range = 16, maxDepth = 4 } = {}) {
  // рельеф острова доходит до глубины maxDepth на t ≈ 1.1–1.3 радиуса
  const reach = (s) => s.R * 1.3;
  const pad = range + 2;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of shores) {
    x0 = Math.min(x0, s.x - reach(s)); x1 = Math.max(x1, s.x + reach(s));
    z0 = Math.min(z0, s.z - reach(s)); z1 = Math.max(z1, s.z + reach(s));
  }
  if (!shores.length) { x0 = z0 = -1; x1 = z1 = 1; }
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const step = Math.max(texel, (x1 - x0) / maxSize, (z1 - z0) / maxSize);
  const W = Math.ceil((x1 - x0) / step), H = Math.ceil((z1 - z0) / step);
  const N = W * H;

  // высоты: только в окрестности островов, остальное — открытое море
  const height = new Float32Array(N).fill(-maxDepth);
  for (const s of shores) {
    const r = reach(s);
    const i0 = Math.max(0, Math.floor((s.x - r - x0) / step)), i1 = Math.min(W - 1, Math.ceil((s.x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((s.z - r - z0) / step)), j1 = Math.min(H - 1, Math.ceil((s.z + r - z0) / step));
    for (let j = j0; j <= j1; j++) {
      const wz = z0 + (j + 0.5) * step;
      for (let i = i0; i <= i1; i++) {
        const wx = x0 + (i + 0.5) * step;
        const k = j * W + i;
        height[k] = Math.max(height[k], s.height(wx, wz));
      }
    }
  }
  const land = new Uint8Array(N);
  for (let k = 0; k < N; k++) land[k] = height[k] > 0 ? 1 : 0;
  // прибрежные скалы — суша для прибоя: пена их обтекает
  for (const s of shores) {
    for (const r of s.rocks) {
      const i0 = Math.max(0, Math.floor((r.x - r.r - x0) / step)), i1 = Math.min(W - 1, Math.ceil((r.x + r.r - x0) / step));
      const j0 = Math.max(0, Math.floor((r.z - r.r - z0) / step)), j1 = Math.min(H - 1, Math.ceil((r.z + r.r - z0) / step));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (Math.hypot(x0 + (i + 0.5) * step - r.x, z0 + (j + 0.5) * step - r.z) < r.r) land[j * W + i] = 1;
        }
      }
    }
  }

  // берег проходит между центрами текселей суши и воды — отсюда −step/2
  const toLand = edt(land, 1, W, H), toWater = edt(land, 0, W, H);
  const dist = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    dist[k] = land[k] ? -(Math.sqrt(toWater[k]) - 0.5) * step : (Math.sqrt(toLand[k]) - 0.5) * step;
  }

  const data = new Uint8Array(N * 4);
  const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const gx = dist[j * W + Math.min(W - 1, i + 1)] - dist[j * W + Math.max(0, i - 1)];
      const gz = dist[Math.min(H - 1, j + 1) * W + i] - dist[Math.max(0, j - 1) * W + i];
      const gl = Math.hypot(gx, gz) || 1;
      data[k * 4] = byte(dist[k] / range * 0.5 + 0.5);
      data[k * 4 + 1] = byte(-height[k] / maxDepth);
      data[k * 4 + 2] = byte(gx / gl * 0.5 + 0.5);
      data[k * 4 + 3] = byte(gz / gl * 0.5 + 0.5);
    }
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  // то же на CPU, билинейно (как LinearFilter в шейдере): для физики волн и мели
  const depth = new Float32Array(N);
  for (let k = 0; k < N; k++) depth[k] = Math.min(maxDepth, Math.max(0, -height[k]));
  const inside = (x, z) => x >= x0 && z >= z0 && x < x0 + W * step && z < z0 + H * step;
  function bilinear(a, x, z) {
    const fx = Math.min(W - 1, Math.max(0, (x - x0) / step - 0.5));
    const fz = Math.min(H - 1, Math.max(0, (z - z0) / step - 0.5));
    const i = Math.min(W - 2, Math.floor(fx)), j = Math.min(H - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j, k = j * W + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + W] * (1 - tx) + a[k + W + 1] * tx) * tz;
  }
  // глубина (м)
  function depthAt(x, z) {
    return inside(x, z) ? bilinear(depth, x, z) : maxDepth;
  }
  // расстояние до кромки (м, плюс — вода), глубина и нормаль от берега (в сторону воды)
  function info(x, z) {
    if (!inside(x, z)) return { dist: Infinity, depth: maxDepth, nx: 0, nz: 0 };
    // широкий шаблон (±4 текселя) сглаживает «лесенку» контура: у кромки ошибка ~5° вместо ~25°
    const e = 4 * step;
    const gx = bilinear(dist, x + e, z) - bilinear(dist, x - e, z);
    const gz = bilinear(dist, x, z + e) - bilinear(dist, x, z - e);
    const gl = Math.hypot(gx, gz) || 1;
    return { dist: bilinear(dist, x, z), depth: bilinear(depth, x, z), nx: gx / gl, nz: gz / gl };
  }

  const sites = bakeSites();

  return { texture, bounds: new THREE.Vector4(x0, z0, W * step, H * step), range, maxDepth, info, depthAt, sites, width: W, height: H };

  // Точки берега для брызг прибоя: тексели воды у кромки, по одной на ячейку SITE_GAP м.
  //   steep 0..1 — круча: суша резко поднимается вглубь или дно резко уходит к морю
  //   (обрыв, скала — брызги стеной вверх; пляж — низкий веер);
  //   rock — точка у прибрежной скалы.
  // query(x, z, r, cb) — точки в радиусе r (корзины по SITE_BUCKET м).
  function bakeSites() {
    const SITE_GAP = 3, SITE_BUCKET = 32;
    const taken = new Set();
    const xs = [], zs = [], nxs = [], nzs = [], steeps = [], rocks = [];
    const allRocks = shores.flatMap((s) => s.rocks);
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i;
        if (land[k] || !(land[k - 1] || land[k + 1] || land[k - W] || land[k + W])) continue;
        const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
        const cell = Math.floor(x / SITE_GAP) + ',' + Math.floor(z / SITE_GAP);
        if (taken.has(cell)) continue;
        taken.add(cell);
        const s = info(x, z);
        const inland = inside(x - s.nx * 2.5, z - s.nz * 2.5) ? bilinear(height, x - s.nx * 2.5, z - s.nz * 2.5) : 0;
        // склоны под водой у всех островов ~0.4 м/м — круча только там, где дно обрывается резче
        const drop = (depthAt(x + s.nx * 3, z + s.nz * 3) / 3 - 0.5) / 0.5;
        let steep = Math.min(1, Math.max(0, inland / 1.5, drop));
        const rock = allRocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 1);
        if (rock) steep = Math.max(steep, 0.8);
        xs.push(x); zs.push(z); nxs.push(s.nx); nzs.push(s.nz); steeps.push(steep); rocks.push(rock ? 1 : 0);
      }
    }
    const count = xs.length;
    const buckets = new Map();
    const key = (bx, bz) => bx * 65536 + bz;
    for (let n = 0; n < count; n++) {
      const kb = key(Math.floor(xs[n] / SITE_BUCKET), Math.floor(zs[n] / SITE_BUCKET));
      if (!buckets.has(kb)) buckets.set(kb, []);
      buckets.get(kb).push(n);
    }
    const out = {
      count,
      x: Float32Array.from(xs), z: Float32Array.from(zs),
      nx: Float32Array.from(nxs), nz: Float32Array.from(nzs),
      steep: Float32Array.from(steeps), rock: Uint8Array.from(rocks),
      query(qx, qz, r, cb) {
        const b0x = Math.floor((qx - r) / SITE_BUCKET), b1x = Math.floor((qx + r) / SITE_BUCKET);
        const b0z = Math.floor((qz - r) / SITE_BUCKET), b1z = Math.floor((qz + r) / SITE_BUCKET);
        for (let bz = b0z; bz <= b1z; bz++) {
          for (let bx = b0x; bx <= b1x; bx++) {
            const list = buckets.get(key(bx, bz));
            if (!list) continue;
            for (const n of list) if (Math.hypot(out.x[n] - qx, out.z[n] - qz) < r) cb(n);
          }
        }
      },
    };
    return out;
  }
}

// Квадрат евклидова расстояния от каждого текселя до ближайшего с mask == target
// (Felzenszwalb & Huttenlocher: точный EDT за O(N), сначала по столбцам, потом по строкам).
export function edt(mask, target, W, H) {
  const INF = 1e20;
  const g = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) g[k] = mask[k] === target ? 0 : INF;
  const n = Math.max(W, H);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), zb = new Float32Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = g[j * W + i];
    edt1d(f, H, d, v, zb);
    for (let j = 0; j < H; j++) g[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    const o = j * W;
    for (let i = 0; i < W; i++) f[i] = g[o + i];
    edt1d(f, W, d, v, zb);
    for (let i = 0; i < W; i++) g[o + i] = d[i];
  }
  return g;
}

// нижняя огибающая парабол (q − p)² + f(p)
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  const cross = (q, p) => ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = cross(q, v[k]);
    // z[0] = −∞, так что k не уходит ниже нуля
    while (s <= z[k]) { k--; s = cross(q, v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}
