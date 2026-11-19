import * as THREE from 'three';
import { createNoise } from './noise.js';
import { MAT } from './heightfield.js';
import { edt } from '../shore-map.js';
import { smooth, sdEllipse, sdPolygon } from './shapes.js';

// Биомы и ландшафтные зоны по полю высот (сетка та же, 2 м).
//
// У клетки не один биом, а веса биомов (south, north, atlantic; остаток до 1 — none, открытое море).
// База — биом острова-владельца (hf.owner, поле biome в описании карты). Поверх — области map.biomeRegions:
//   { name, biome: 'north' | { north: 0.5, atlantic: 0.5 }, shape: 'ellipse' | 'polygon',
//     x, z, a, b, rot (эллипс) | pts: [[x, z], …] (многоугольник),
//     feather — ширина мягкого края, м (вес растёт линейно от 0 до weight на полосе ±feather/2 вокруг границы),
//     jitter  — рваность границы шумом, м;  weight — вес области (0..1, по умолчанию 1);
//     islands — имена островов, на которые область действует (иначе — на все клетки в bbox);
//     auto    — имя правила, если область поставил инструмент (biome-rules.js) }
// Перекрытие областей даёт смесь: клетка получает биомы пропорционально весам, остров — остаток до 1.
// Параметры зон (влажность, порог скал, высота вершин) и палитры смешиваются по весам.
// pickBiome — выбор биома для объекта (шаг 3): рощами ~20 м с вероятностью по весам, а не по порогу —
// в переходной полосе мозаика куртин, а не стена сосен слева и кипарисов справа.
//
// Зона — по высоте, уклону, расстоянию до берега и «влажности» (шум со сдвигом по биому).

export const BIOME_IDS = ['none', 'south', 'north', 'atlantic'];
export const BIOME_NAMES = { none: 'открытое море', south: 'юг', north: 'север', atlantic: 'атлантика' };

export const ZONES = ['deep', 'seabed', 'weed', 'reefRock', 'beach', 'dune', 'meadow', 'forest', 'scrub', 'rock', 'peak', 'settle'];
export const Z = Object.fromEntries(ZONES.map((z, i) => [z, i]));
export const ZONE_NAMES = {
  deep: 'глубина', seabed: 'песчаное дно', weed: 'водоросли', reefRock: 'скальное дно', beach: 'пляж', dune: 'дюны, прибрежная трава',
  meadow: 'луг, поле', forest: 'лес', scrub: 'кустарник', rock: 'скалы', peak: 'голые вершины', settle: 'посёлок',
};

// Параметры и палитры. scrub: юг — маквис, север и атлантика — вереск и пустошь; weed: на юге — посидония.
//   moist     — сдвиг влажности (юг суше, север влажнее)
//   rockSlope — уклон, с которого начинаются скалы; peakH — высота голых вершин
export const BIOMES = {
  none: {
    moist: 0, rockSlope: 0.8, peakH: 80,
    colors: { deep: 0x30566a, seabed: 0xd8cca4, weed: 0x5f7448, reefRock: 0x6e6458, beach: 0xe6d6a8, dune: 0xb7b07a,
      meadow: 0x8daa5f, forest: 0x4e7547, scrub: 0x8c7b5c, rock: 0x8f8a80, peak: 0xa8a49c, settle: 0xa8a479 },
  },
  south: {
    moist: -0.12, rockSlope: 0.72, peakH: 95,
    colors: { deep: 0x2f7489, seabed: 0xeee2b6, weed: 0x6b8a52, reefRock: 0x8c5a40, beach: 0xf0e3ba, dune: 0xd8cc92,
      meadow: 0xb7ae60, forest: 0x6b7a3c, scrub: 0x8e8a4c, rock: 0xb8633a, peak: 0xc88c5e, settle: 0xcdbb8a },
  },
  north: {
    moist: 0.12, rockSlope: 0.85, peakH: 80,
    colors: { deep: 0x2a4d57, seabed: 0xb3ab8d, weed: 0x5a6a3c, reefRock: 0x6b6460, beach: 0xd8cfb2, dune: 0xa6ad78,
      meadow: 0x72a454, forest: 0x3d6a39, scrub: 0x7c8858, rock: 0x978884, peak: 0xb5aea8, settle: 0x8f9b6a },
  },
  atlantic: {
    moist: 0, rockSlope: 0.8, peakH: 65,
    colors: { deep: 0x33596b, seabed: 0xc6ba95, weed: 0x5e7347, reefRock: 0x6f665c, beach: 0xe5d6a9, dune: 0xb8b07a,
      meadow: 0x8caa5e, forest: 0x4d7446, scrub: 0x8a7562, rock: 0x84796a, peak: 0xa39b8c, settle: 0xa8a479 },
  },
};

const NB = BIOME_IDS.length;
const PARAMS = ['moist', 'rockSlope', 'peakH'];

// вес области в точке: 0 снаружи, weight внутри, мягкий край шириной feather с рваной границей
export function regionWeight(r, x, z, fbm) {
  let d;
  if (r.shape === 'polygon') d = sdPolygon(x, z, r.pts);
  else {
    const c = Math.cos((r.rot ?? 0) * Math.PI / 180), s = Math.sin((r.rot ?? 0) * Math.PI / 180), lx = x - r.x, lz = z - r.z;
    d = sdEllipse(lx * c + lz * s, -lx * s + lz * c, r.a, r.b);
  }
  const f = r.feather ?? 80;
  d += (r.jitter ?? 25) * fbm(x / 60 + 3.1, z / 60 - 7.7, 2);
  // линейный край: смесь занимает всю полосу feather (smoothstep сжимал её к середине)
  return (r.weight ?? 1) * Math.min(1, Math.max(0, 0.5 - d / f));
}
export function regionBox(r) {
  const pad = (r.feather ?? 80) / 2 + (r.jitter ?? 25) + 4;
  if (r.shape === 'polygon') {
    const xs = r.pts.map((p) => p[0]), zs = r.pts.map((p) => p[1]);
    return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
  }
  const m = Math.max(r.a, r.b) + pad;
  return [r.x - m, r.z - m, r.x + m, r.z + m];
}

export function classifyBiomes(hf, map, regions = map.biomeRegions ?? []) {
  const t0 = performance.now();
  const { fbm } = createNoise((map.seed ?? 1) + 101);
  const W = hf.size, N = W * W, step = hf.step, H = hf.heights, [x0, z0] = hf.bounds;
  const zone = new Uint8Array(N), moist = new Uint8Array(N);
  const bIdx = map.islands.map((isl) => Math.max(0, BIOME_IDS.indexOf(isl.biome ?? 'none')));
  const islandIdx = Object.fromEntries(map.islands.map((isl, i) => [isl.name, i]).filter(([n]) => n));

  // веса биомов: области копят вклад (cover — сумма весов), остров берёт остаток до 1
  const acc = new Float32Array(N * NB), cover = new Float32Array(N);
  for (const r of regions) {
    const share = new Float32Array(NB);
    for (const [b, v] of Object.entries(typeof r.biome === 'string' ? { [r.biome]: 1 } : r.biome)) share[BIOME_IDS.indexOf(b)] += v;
    const sum = share.reduce((a, v) => a + v, 0);
    const only = r.islands ? new Set(r.islands.map((n) => islandIdx[n])) : null;
    const box = regionBox(r);
    const i0 = Math.max(0, Math.floor((box[0] - x0) / step)), i1 = Math.min(W - 1, Math.ceil((box[2] - x0) / step));
    const j0 = Math.max(0, Math.floor((box[1] - z0) / step)), j1 = Math.min(W - 1, Math.ceil((box[3] - z0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (only && !only.has(hf.owner[k])) continue;
        const w = regionWeight(r, x0 + i * step, z0 + j * step, fbm);
        if (w <= 0) continue;
        cover[k] += w;
        for (let b = 0; b < NB; b++) acc[k * NB + b] += w * share[b] / sum;
      }
    }
  }
  const weights = new Uint8Array(N * NB), biome = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const c = cover[k], base = hf.owner[k] >= 0 ? bIdx[hf.owner[k]] : 0;
    const norm = c > 1 ? 1 / c : 1, rest = Math.max(0, 1 - c);
    let best = 0, bw = -1;
    for (let b = 0; b < NB; b++) {
      const w = acc[k * NB + b] * norm + (b === base ? rest : 0);
      weights[k * NB + b] = Math.round(w * 255);
      if (w > bw) { bw = w; best = b; }
    }
    biome[k] = best;
  }
  const P = PARAMS.map((p) => BIOME_IDS.map((b) => BIOMES[b][p]));
  const param = (k, p) => { let v = 0; for (let b = 0; b < NB; b++) v += weights[k * NB + b] * P[p][b]; return v / 255; };

  // расстояние до берега (м) по суше
  const land = new Uint8Array(N);
  for (let k = 0; k < N; k++) land[k] = H[k] > 0 ? 1 : 0;
  const toWater = edt(land, 0, W, W);

  for (let j = 0; j < W; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < W; i++) {
      const k = j * W + i, h = H[k], x = x0 + i * step;
      if (h < -18) { zone[k] = Z.deep; continue; }
      const B = { moist: param(k, 0), rockSlope: param(k, 1), peakH: param(k, 2) };
      const i0 = Math.max(0, i - 1), i1 = Math.min(W - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(W - 1, j + 1);
      const s = Math.hypot(H[j * W + i1] - H[j * W + i0], H[j1 * W + i] - H[j0 * W + i]) / ((i1 - i0 + j1 - j0) * step / 2);
      const mat = hf.material[k];
      if (h <= 0) {
        // дно: скалы рифов и круч, водоросли на средней глубине пятнами, остальное — песок
        const wv = 0.5 + 0.5 * fbm(x / 90, z / 90, 2);
        zone[k] = mat === MAT.rock || s > 0.6 ? Z.reefRock : h < -1.5 && h > -14 && wv > 0.55 && mat !== MAT.sand ? Z.weed : Z.seabed;
        continue;
      }
      // влажность: шум + сдвиг биома, у самого берега суше (ветер, соль), в низинах чуть влажнее
      const cd = (Math.sqrt(toWater[k]) - 0.5) * step;
      let m = 0.5 + 0.45 * fbm(x / 280, z / 280, 3) + B.moist - 0.2 * smooth(60, 0, cd) + 0.1 * smooth(20, 0, s * 40);
      m = Math.min(1, Math.max(0, m));
      moist[k] = m * 255;
      const n = 0.4 * fbm(x / 20, z / 20, 2);
      let zn;
      if (h < 1.5 + n || (mat === MAT.sand && h < 3)) zn = Z.beach;
      else if (mat === MAT.sand) zn = Z.dune; // песчаный остров (sandy) — дюны целиком
      else if (s > B.rockSlope + 0.1 * n) zn = Z.rock;
      else if (h > B.peakH + 10 * n) zn = Z.peak;
      else if (cd < 14 + 10 * n && h < 5) zn = Z.dune;
      // поля и луга — на ровном и невысоком, при средней влажности и пятнами (иначе равнинный остров — сплошное поле)
      else if (s < 0.18 && h < 30 && m > 0.28 && m < 0.62 && fbm(x / 90 + 7, z / 90 - 3, 2) > -0.1) zn = Z.meadow;
      else if (m > 0.52) zn = Z.forest;
      else zn = Z.scrub;
      zone[k] = zn;
    }
  }
  // площадки посёлков — свободны под постройки
  for (const st of hf.sites) {
    const r = st.r * (st.type === 'lighthouse' ? 1 : 0.85);
    const i0 = Math.max(0, Math.floor((st.x - r - x0) / step)), i1 = Math.min(W - 1, Math.ceil((st.x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((st.z - r - z0) / step)), j1 = Math.min(W - 1, Math.ceil((st.z + r - z0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (H[k] > 0.5 && Math.hypot(x0 + i * step - st.x, z0 + j * step - st.z) < r) zone[k] = Z.settle;
      }
    }
  }

  const idx = (x, z) => {
    const i = Math.min(W - 1, Math.max(0, Math.round((x - x0) / step))), j = Math.min(W - 1, Math.max(0, Math.round((z - z0) / step)));
    return j * W + i;
  };
  const zoneAt = (x, z) => ZONES[zone[idx(x, z)]];
  const biomeAt = (x, z) => BIOME_IDS[biome[idx(x, z)]]; // преобладающий: стиль построек посёлка
  const weightsAt = (x, z) => { const k = idx(x, z); return Object.fromEntries(BIOME_IDS.map((b, i) => [b, weights[k * NB + i] / 255])); };
  // биом для объекта: порог — шум рощ (~30 м, растянут почти до равномерного 0..1) с небольшой примесью
  // u (0..1, случайное число объекта) — рваные края куртин
  function pickBiome(x, z, u) {
    const k = idx(x, z);
    const g = Math.min(1, Math.max(0, 0.5 + 1.1 * fbm(x / 30 + 0.5, z / 30 + 0.5, 2)));
    let t = (0.88 * g + 0.12 * u) * 255, last = 0;
    for (let b = 0; b < NB; b++) {
      const w = weights[k * NB + b];
      if (w > 0) last = b;
      if ((t -= w) < 0) return BIOME_IDS[b];
    }
    return BIOME_IDS[last];
  }

  // цвет рельефа: зона в палитрах биомов по весам (среднее по окрестности ±4 м — мягкие границы зон),
  // дно темнеет к глубине; лёгкая пятнистость
  const pal = BIOME_IDS.map((b) => ZONES.map((zn) => new THREE.Color(BIOMES[b].colors[zn])));
  const mixed = (k, zi, out) => {
    let r = 0, g = 0, bl = 0;
    for (let b = 0; b < NB; b++) {
      const w = weights[k * NB + b];
      if (!w) continue;
      const c = pal[b][zi];
      r += w * c.r; g += w * c.g; bl += w * c.b;
    }
    return out.setRGB(r / 255, g / 255, bl / 255);
  };
  const tmp = new THREE.Color(), deep = new THREE.Color();
  function paint(x, z, h, out) {
    const k = idx(x, z), zn = ZONES[zone[k]];
    let r = 0, g = 0, bl = 0;
    for (let dj = -2; dj <= 2; dj += 2) {
      for (let di = -2; di <= 2; di += 2) {
        const kk = idx(x + di * step, z + dj * step);
        mixed(kk, zone[kk], tmp);
        r += tmp.r; g += tmp.g; bl += tmp.b;
      }
    }
    out.setRGB(r / 9, g / 9, bl / 9);
    if (h <= 0) out.lerp(mixed(k, Z.deep, deep), smooth(1.5, 16, -h));
    else {
      const patch = Math.sin(x * 0.031 + z * 0.017) * Math.sin(z * 0.027 - x * 0.012);
      out.offsetHSL(0, 0, patch * (zn === 'forest' || zn === 'meadow' ? 0.04 : 0.025));
    }
    return out;
  }

  return { biome, weights, zone, moist, regions, zoneAt, biomeAt, weightsAt, pickBiome, paint, ms: performance.now() - t0 };
}
