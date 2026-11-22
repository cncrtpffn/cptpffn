import { createNoise, mulberry32 } from './noise.js';
import { smooth, sdEllipse, sdPolyline, smin, polyBox } from './shapes.js';
import { polyline } from './geom.js';

// Поле высот на весь мир по описанию карты (src/maps/*.js): сетка step м, высоты Float32 и материал Uint8.
// Порядок слоёв: дно моря → острова (max) → хребты (+) → бухты (min) → отмели, косы (max) → пляжи → рифы (max) → площадки посёлков.
// Каждый примитив считается только в своём bbox.
//
// Материал: 0 — по высоте и уклону, 1 — песок (косы, отмели), 2 — скала (рифы).
// owner — индекс острова (map.islands), давшего высоту клетке (суша и шельф), −1 — открытое море.
export const MAT = { auto: 0, sand: 1, rock: 2 };

const lerp = (a, b, t) => a + (b - a) * t;

export function buildHeightfield(map) {
  const t0 = performance.now();
  const N_ = createNoise(map.seed ?? 1), { fbm, ridged, warp } = N_;
  const half = map.size / 2, step = map.step ?? 2;
  const W = Math.round(map.size / step) + 1, N = W * W;
  const x0 = -half, z0 = -half;
  const heights = new Float32Array(N), material = new Uint8Array(N), owner = new Int8Array(N).fill(-1);
  const sea = map.seaDepth ?? 42, floor = -(map.minDepth ?? 50);
  const w = { x: 0, z: 0 };

  // обход узлов сетки в bbox [xa, za, xb, zb]
  function each(box, fn) {
    const i0 = Math.max(0, Math.floor((box[0] - x0) / step)), i1 = Math.min(W - 1, Math.ceil((box[2] - x0) / step));
    const j0 = Math.max(0, Math.floor((box[1] - z0) / step)), j1 = Math.min(W - 1, Math.ceil((box[3] - z0) / step));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + j * step;
      for (let i = i0; i <= i1; i++) fn(j * W + i, x0 + i * step, z);
    }
  }

  // дно открытого моря: пологие волны
  each([x0, z0, half, half], (k, x, z) => { heights[k] = -sea + 5 * fbm(x / 700, z / 700, 3) + 1.5 * fbm(x / 130, z / 130, 2); });

  // острова: объединение эллипсов-лепестков, берег рвётся искажением координат и шумом
  map.islands.forEach((isl, idx) => {
    const lobes = isl.lobes.map(([x, z, a, b, rot = 0]) => ({ x, z, a, b, c: Math.cos(rot * Math.PI / 180), s: Math.sin(rot * Math.PI / 180) }));
    const rough = isl.rough ?? 1, shelf = isl.shelf ?? 60, shelfDepth = isl.shelfDepth ?? (isl.kind === 'plain' ? 3 : 7);
    const H = isl.h, R = isl.core ?? Math.min(...lobes.map((l) => l.b));
    const pad = shelf * 3 + 80 * rough;
    const box = lobes.reduce((bx, l) => {
      const r = Math.max(l.a, l.b);
      return [Math.min(bx[0], l.x - r - pad), Math.min(bx[1], l.z - r - pad), Math.max(bx[2], l.x + r + pad), Math.max(bx[3], l.z + r + pad)];
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    const ox = (isl.lobes[0][0] % 97) * 3.1, oz = (isl.lobes[0][1] % 89) * 2.7; // у каждого острова свой участок шума
    each(box, (k, x, z) => {
      warp(x + ox, z + oz, 260, 55 * rough, w);
      const wx = w.x - ox, wz = w.z - oz;
      let d = 1e6;
      for (const l of lobes) {
        const lx = wx - l.x, lz = wz - l.z;
        d = smin(d, sdEllipse(lx * l.c + lz * l.s, -lx * l.s + lz * l.c, l.a, l.b), 70);
      }
      d += 14 * rough * fbm((x + ox) / 75, (z + oz) / 75, 3);
      const D = -d; // вглубь острова, м
      // клифы: участки берега, где суша сразу встаёт стеной; там и шельф уже
      const cliffK = Math.max(isl.cliffMin ?? 0, (isl.cliff ?? 0) * smooth(0.0, 0.35, fbm((x + ox) / 220, (z + oz) / 220, 2)));
      let h;
      if (D <= 0) {
        const sw = shelf * (1 - 0.7 * cliffK), dd = -D;
        h = -shelfDepth * Math.pow(smooth(0, sw, dd), 0.8) - (sea - shelfDepth) * smooth(sw, sw * 3, dd);
        h += 0.6 * fbm(x / 35, z / 35, 2) * smooth(0, 15, dd);
      } else if (isl.kind === 'plain') {
        const plateau = H * smooth(8, R * 0.7, D) * (0.75 + 0.35 * fbm((x + ox) / 200, (z + oz) / 200, 3));
        h = 1.1 * smooth(0, 9, D) + plateau + 0.7 * fbm(x / 50, z / 50, 3) * smooth(0, 20, D);
      } else {
        // горный: пляж или клиф, прибрежная низина (под посёлки), выше — гора с гребнями
        const low = (isl.lowland ?? 45) * (1 + 0.5 * fbm((x + ox) / 160, (z + oz) / 160, 2));
        const coast = Math.max(1.2 * smooth(0, 6, D) + (isl.lowH ?? 4) * smooth(4, 30, D), cliffK * (isl.cliffH ?? 14) * smooth(0, 5, D));
        // от берега растёт только «подложка» горы; вершины и гребни — от шума (иначе гребень идёт по оси эллипса)
        const t = smooth(low, low + 0.9 * Math.max(20, R - low), D);
        const shape = 0.3 + 0.6 * ridged((x + ox) / 320, (z + oz) / 320, 4) + 0.3 * fbm((x + ox) / 140, (z + oz) / 140, 3);
        h = coast + H * Math.pow(t, 1.3) * shape + 1.2 * fbm(x / 40, z / 40, 3) * smooth(0, 10, D);
      }
      if (h > heights[k]) { heights[k] = h; if (h > -sea + 6) owner[k] = idx; material[k] = isl.sandy && h > -4 ? MAT.sand : MAT.auto; }
    });
  });

  // хребты: добавка к суше вдоль ломаной (новой суши не создают)
  const pl = { t: 0 };
  for (const r of map.ridges ?? []) {
    each(polyBox(r.pts, r.w), (k, x, z) => {
      const h = heights[k];
      if (h < 1) return;
      const d = sdPolyline(x, z, r.pts, pl);
      if (d >= r.w) return;
      // smooth, а не (1 − d/w)²: у квадрата на самой ломаной излом — острый гребень-«пила»
      heights[k] += r.h * smooth(r.w, 0, d) * (0.6 + 0.6 * ridged(x / 180, z / 180, 3)) * smooth(1, 6, h) * (1 - 0.4 * pl.t * (r.taper ?? 0));
    });
  }

  // бухты: капсула от входа (mouth) к вершине (head); дно мельчает к вершине, берега поднимаются уклоном bank
  // и дальше круче (квадратично) — к краю bbox выше любого рельефа, шва нет
  for (const b of map.bays ?? []) {
    const pts = [b.mouth, b.head], bank = b.bank ?? 0.3;
    each(polyBox(pts, b.w + 300), (k, x, z) => {
      warp(x, z, 90, 32, w);
      const d = sdPolyline(w.x, w.z, pts, pl) - b.w + 8 * fbm(x / 30, z / 30, 2);
      const depth = b.depth * lerp(0.35, 1, 1 - pl.t);
      const bed = d < 0 ? -depth * smooth(0, b.w * 0.7, -d) : bank * d + 0.004 * d * d;
      if (bed < heights[k]) heights[k] = bed;
    });
  }

  // отмели и банки: дно поднимается до −depth, к краю уходит уклоном 0.12
  // (здесь и ниже bbox берётся с запасом: на его краю примитив уже глубже дна моря — без ступенек)
  for (const s of map.shoals ?? []) {
    const c = Math.cos((s.rot ?? 0) * Math.PI / 180), sn = Math.sin((s.rot ?? 0) * Math.PI / 180);
    const r = Math.max(s.a, s.b);
    each([s.x - r - 420, s.z - r - 420, s.x + r + 420, s.z + r + 420], (k, x, z) => {
      warp(x, z, 150, 40, w);
      const lx = w.x - s.x, lz = w.z - s.z;
      const d = sdEllipse(lx * c + lz * sn, -lx * sn + lz * c, s.a, s.b);
      const h = -s.depth + 0.8 * fbm(x / 40, z / 40, 2) - Math.max(0, d) * 0.12;
      if (h > heights[k]) { heights[k] = h; if (d < 20) material[k] = MAT.sand; }
    });
  }

  // косы: гребень +crest м вдоль ломаной, к дальнему концу уходит под воду; вокруг — песчаный фартук
  for (const s of map.spits ?? []) {
    const crest = s.crest ?? 1.2, sw = s.w ?? 14;
    each(polyBox(s.pts, sw + 340), (k, x, z) => {
      warp(x, z, 90, 10, w);
      const d = sdPolyline(w.x, w.z, s.pts, pl);
      const top = crest * (1 - 1.4 * Math.pow(pl.t, 3)) + 0.25 * fbm(x / 25, z / 25, 2);
      const h = d < sw ? top - (top + 0.4) * (d / sw) ** 2 : -0.4 - (d - sw) * 0.15;
      if (h > heights[k]) { heights[k] = h; material[k] = MAT.sand; }
    });
  }

  // пляжи: у ломаной вдоль берега профиль 4 м суши и 6 м воды становится пологим — высоты у кромки сжимаются
  // (f(0) = 0, f(±край) = край, наклон у кромки ×0.25): кромка остаётся на месте, полоса пляжа и мелководья шире
  for (const b of map.beaches ?? []) {
    const bw = b.w ?? 40, up = 4, dn = 6;
    each(polyBox(b.pts, bw + 20), (k, x, z) => {
      const h = heights[k];
      if (h > up || h < -dn) return;
      const t = smooth(bw, bw * 0.5, sdPolyline(x, z, b.pts, pl) + 10 * fbm(x / 40, z / 40, 2));
      if (t <= 0) return;
      const e = h > 0 ? up : dn, u = Math.abs(h) / e;
      heights[k] = lerp(h, Math.sign(h) * e * u * (0.25 + 0.75 * u * u), t);
      if (heights[k] > -3 && heights[k] < 2.5 && t > 0.5) material[k] = MAT.sand;
    });
  }

  // рифы: плита на глубине base и камни, часть из них выходит из воды
  // гряда (pts): камни вдоль ломаной в полосе ±r, плита — вдоль неё же
  for (const r of map.reefs ?? []) {
    const P = r.pts && polyline(r.pts);
    const [cx, cz] = r.pts ? r.pts[0] : [r.x, r.z];
    const rng = mulberry32(Math.round(cx * 31 + cz * 17));
    const rocks = Array.from({ length: r.count }, () => {
      let x, z;
      if (P) { const p = P.at(rng() * P.L), o = (rng() * 2 - 1) * r.r; x = p.x - p.tz * o; z = p.z + p.tx * o; }
      else { const a = rng() * Math.PI * 2, t = Math.sqrt(rng()) * r.r; x = r.x + Math.cos(a) * t; z = r.z + Math.sin(a) * t; }
      return { x, z, r: 3 + rng() * (r.size ?? 9), top: lerp(r.top[0], r.top[1], rng() ** 1.5) };
    });
    const base = r.base ?? 4;
    const box = P ? polyBox(r.pts, r.r + 220) : [r.x - r.r - 220, r.z - r.r - 220, r.x + r.r + 220, r.z + r.r + 220];
    each(box, (k, x, z) => {
      const dc = (P ? sdPolyline(x, z, r.pts, pl) + r.r * 0.5 : Math.hypot(x - r.x, z - r.z)) * (1 + 0.25 * fbm(x / 60, z / 60, 2));
      let h = -base - Math.max(0, dc - r.r) * 0.25 + 0.8 * fbm(x / 20, z / 20, 2), rock = false;
      for (const p of rocks) {
        const dd = Math.hypot(x - p.x, z - p.z) / p.r;
        if (dd > 2) continue;
        const hr = p.top - 5 * dd * dd - 1.5 * ridged(x / 9, z / 9, 2);
        if (hr > h) { h = hr; rock = true; }
      }
      if (h > heights[k]) { heights[k] = h; if (rock) material[k] = MAT.rock; }
    });
  }

  // площадки посёлков и маяков: суша выравнивается к s.h (порт — 2.5 м у воды, маяк — высота центра,
  // посёлок — высота центра от 1.5 до 25 м); вода не засыпается
  const sites = (map.sites ?? []).map((s) => ({ ...s, r: s.r ?? 40, h: s.h ?? (s.type === 'port' ? 2.5 : s.type === 'lighthouse' ? sampleGrid(s.x, s.z) : Math.max(1.5, Math.min(25, sampleGrid(s.x, s.z)))) }));
  for (const s of sites) {
    const r = s.r, target = s.h;
    each([s.x - r, s.z - r, s.x + r, s.z + r], (k, x, z) => {
      const h = heights[k];
      if (h < 0.3) return;
      const t = (s.flat ?? 0.9) * smooth(r, r * 0.45, Math.hypot(x - s.x, z - s.z));
      heights[k] = Math.max(0.4, lerp(h, target, t));
    });
  }

  for (let k = 0; k < N; k++) if (heights[k] < floor) heights[k] = floor;

  function sampleGrid(x, z) {
    const fx = Math.min(W - 1.001, Math.max(0, (x - x0) / step)), fz = Math.min(W - 1.001, Math.max(0, (z - z0) / step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * W + i;
    return (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - tz) + (heights[k + W] * (1 - tx) + heights[k + W + 1] * tx) * tz;
  }
  // уклон (м/м) по центральным разностям
  function slope(x, z, e = step) {
    return Math.hypot(sampleGrid(x + e, z) - sampleGrid(x - e, z), sampleGrid(x, z + e) - sampleGrid(x, z - e)) / (2 * e);
  }
  function materialAt(x, z) {
    const i = Math.round((x - x0) / step), j = Math.round((z - z0) / step);
    return i < 0 || j < 0 || i >= W || j >= W ? MAT.auto : material[j * W + i];
  }

  const ms = performance.now() - t0;
  return { bounds: [x0, z0, map.size, map.size], step, size: W, heights, material, owner, sites, sample: sampleGrid, slope, materialAt, ms };
}
