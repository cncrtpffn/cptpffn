import * as THREE from 'three';
import { jitterColor } from '../flora.js';
import { pick, at, box, cyl, beam, triGeo, arcade } from './kit.js';
import { STREET } from './street.js';

// Дороги (категория F каталога docs/changes/structures-library/catalog.md): ленты по контрольным точкам.
// opts.points — [[x, y, z], …] в СК base, y — высота земли под осью; через точки идёт кривая Catmull-Rom,
// поперечник всегда горизонтален. Без points строится демо-отрезок для стенда (DEMO) — на плоском полу,
// с подсыпкой земли там, где объекту нужен перепад (лестница, подпорная стенка).

const DIRT = 0x9a8466, RUT = 0x6f5e48, GRASS = 0x7f9a4a, WORN = 0x8f9a5a, EARTH = 0x8a7a5e, TURF = 0x8fae6a;
const WOOD = 0x8f7a62, PILE = 0x5c4a3a, IRON = 0x2b2b2b, WATER = 0x6fa8c0, PEBBLE = 0x8f8c86;
const STONE = { south: 0xd9ccb0, north: 0x8f8c86, atlantic: 0x9a9a92 };
const COBBLE = { south: 0xd8cdb4, north: 0x8e8e8a, atlantic: 0x8e8e8a };

const DEMO = {
  path: [[0, 0, -8], [1.5, 0, -3], [-1.5, 0, 3], [0, 0, 8]],
  road: [[0, 0, -10], [2, 0, -3], [-2, 0, 4], [0, 0, 10]],
  stairs: [[0, 0, 5], [0.6, 2, 0], [0, 4, -5]], // подъём от зрителя (+Z) к −Z
  wall: [[-3, 0, 0], [3, 0, 0]],
};

// --- лента: кадры, полосы, стенки ------------------------------------------

// Кадры вдоль кривой с шагом ≈step: p — точка оси, s — горизонталь вправо, t — касательная, u — длина дуги
export function roadFrames(points, step = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
  const L = curve.getLength(), n = Math.max(1, Math.ceil(L / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, p = curve.getPointAt(u), t = curve.getTangentAt(u), h = Math.hypot(t.x, t.z) || 1;
    return { p: [p.x, p.y, p.z], s: [-t.z / h, 0, t.x / h], t: [t.x, t.y, t.z], u: u * L };
  });
}
const off = (f, x, dy = 0) => [f.p[0] + f.s[0] * x, f.p[1] + dy, f.p[2] + f.s[2] * x];
const yaw = (f) => Math.atan2(f.t[0], f.t[2]);
const frameAt = (F, u) => F[Math.max(0, Math.min(F.length - 1, Math.round(u / F.at(-1).u * (F.length - 1))))];
const fn = (v) => (typeof v === 'function' ? v : () => v);

// Треугольник/четырёхугольник с обходом, при котором нормаль смотрит по dir
function tri(tris, a, b, c, dir) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  tris.push(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0 ? [a, b, c] : [a, c, b]);
}
const quad = (tris, a, b, c, d, dir = [0, 1, 0]) => { tri(tris, a, b, c, dir); tri(tris, a, c, d, dir); };

// Полоса между смещениями x0..x1 от оси на высоте dy; x0, x1 — числа или (i) => число (неровный край).
// fj — разброс цвета по граням (камни, неровный грунт)
function strip(b, base, F, x0, x1, dy, color, rng, fj = 0.6) {
  const X0 = fn(x0), X1 = fn(x1), tris = [];
  for (let i = 0; i < F.length - 1; i++) quad(tris, off(F[i], X0(i), dy), off(F[i], X1(i), dy), off(F[i + 1], X1(i + 1), dy), off(F[i + 1], X0(i + 1), dy));
  b.add(triGeo(tris), color, base, rng, fj);
}

// Вертикальная стенка вдоль ленты на смещении x от y0 до y1 над осью (числа или (i) => число);
// k — сторона, куда смотрит лицо (±1 по s)
function side(b, base, F, x, y0, y1, color, k, rng) {
  const Y0 = fn(y0), Y1 = fn(y1), tris = [];
  for (let i = 0; i < F.length - 1; i++) {
    const f = F[i], g = F[i + 1];
    quad(tris, off(f, x, Y0(i)), off(g, x, Y0(i + 1)), off(g, x, Y1(i + 1)), off(f, x, Y1(i)), [f.s[0] * k, 0, f.s[2] * k]);
  }
  b.add(triGeo(tris), color, base, rng, 0.4);
}

// Плита вдоль ленты: верх на высоте y от x0 до x1 и обе боковые грани до земли (бордюр, тротуар, насыпь)
function slab(b, base, F, x0, x1, y, color, rng, fj = 0.6) {
  strip(b, base, F, x0, x1, y, color, rng, fj);
  side(b, base, F, x0, 0, y, color, -1, rng);
  side(b, base, F, x1, 0, y, color, 1, rng);
}

// Кладка вдоль ленты: ряды блоков длиной bl со сдвигом через ряд, от высоты y0 до y1 над осью,
// толщиной t, ось кладки на смещении x; lean — отступ ряда назад (−s) на метр высоты
function masonry(b, base, F, { x, y0, y1, t, color, rng, bl = 1.2, rh = 0.5, lean = 0 }) {
  const L = F.at(-1).u, rows = Math.max(1, Math.round((y1 - y0) / rh)), h = (y1 - y0) / rows;
  for (let r = 0; r < rows; r++) {
    const y = y0 + (r + 0.5) * h, xr = x - lean * (y - y0);
    for (let u = -(r % 2) * bl / 2; u < L; u += bl) {
      const fa = frameAt(F, Math.max(0, u)), fb = frameAt(F, Math.min(L, u + bl));
      if (fa === fb) continue;
      beam(b, base, jitterColor(color, rng, 0.7), off(fa, xr, y), off(fb, xr, y), t, h - 0.02);
    }
  }
}

// --- F. Дороги -------------------------------------------------------------

// Тропа 1.2 м: грунт с неровным краем, вытоптанная трава по бокам, камешки
function path(b, base, o, rng) {
  const F = roadFrames(o.points ?? DEMO.path, 0.8), w = 0.6;
  const e = F.map(() => [w + (rng() - 0.5) * 0.25, w + (rng() - 0.5) * 0.25]);
  strip(b, base, F, (i) => -e[i][0] - 0.25, (i) => e[i][1] + 0.25, 0.02, WORN, rng, 1);
  strip(b, base, F, (i) => -e[i][0], (i) => e[i][1], 0.04, jitterColor(DIRT, rng, 0.5), rng, 1);
  for (let i = 1; i < F.length - 1; i += 2) {
    if (rng() < 0.5) continue;
    const q = off(F[i], (rng() < 0.5 ? -1 : 1) * (w + 0.15 + rng() * 0.2));
    box(b, base, jitterColor(PEBBLE, rng), q[0], q[1], q[2], 0.2 + rng() * 0.15, 0.1, 0.18, rng() * 3);
  }
}

// Грунтовая дорога 3.5 м: обочины, колеи, трава между колеями, лужи в колеях
function roadDirt(b, base, o, rng) {
  const F = roadFrames(o.points ?? DEMO.road, 1), hw = 1.75;
  const e = F.map(() => [hw + (rng() - 0.5) * 0.3, hw + (rng() - 0.5) * 0.3]);
  strip(b, base, F, (i) => -e[i][0] - 0.35, (i) => e[i][1] + 0.35, 0.02, WORN, rng, 1);
  strip(b, base, F, (i) => -e[i][0], (i) => e[i][1], 0.04, jitterColor(DIRT, rng, 0.5), rng, 0.8);
  for (const k of [-1, 1]) strip(b, base, F, k * 0.8 - 0.18, k * 0.8 + 0.18, 0.06, RUT, rng, 0.5);
  strip(b, base, F, -0.32, 0.32, 0.07, GRASS, rng, 1.2);
  for (let i = 2; i < F.length - 2; i += 3) {
    if (rng() < 0.6) continue;
    const f = F[i], q = off(f, (rng() < 0.5 ? -1 : 1) * 0.8, 0.065);
    box(b, base, WATER, q[0], q[1], q[2], 0.42, 0.01, 0.8 + rng() * 0.8, yaw(f));
  }
}

// Мощёная улица 5 м: брусчатка рядами (5 полос по ширине), водостоки у краёв.
// Вар. 0 — края из крупного камня; 1 — бордюр и тротуары по 1.4 м из плит
function roadCobble(b, base, o, rng) {
  const s = o.style ?? 'atlantic', hw = 2.5, c = COBBLE[s], F = roadFrames(o.points ?? DEMO.road, 0.5);
  for (let j = 0; j < 5; j++) strip(b, base, F, -hw + j, -hw + j + 1, 0.05, jitterColor(c, rng, 0.3), rng, 1.6);
  const gutter = new THREE.Color(c).offsetHSL(0, 0, -0.12);
  for (const k of [-1, 1]) strip(b, base, F, k * (hw - 0.45), k * (hw - 0.15), 0.06, gutter, rng, 0.6);
  if (o.variant !== 1) {
    for (const k of [-1, 1]) strip(b, base, F, k * hw, k * (hw + 0.35), 0.06, new THREE.Color(c).offsetHSL(0, 0, -0.06), rng, 1.4);
    return;
  }
  const curb = STONE[s], walk = new THREE.Color(c).offsetHSL(0, 0, 0.06), Fw = roadFrames(o.points ?? DEMO.road, 1.0);
  for (const k of [-1, 1]) {
    slab(b, base, F, k < 0 ? -hw - 0.25 : hw, k < 0 ? -hw : hw + 0.25, 0.16, curb, rng, 0.3);
    slab(b, base, Fw, k < 0 ? -hw - 1.65 : hw + 0.25, k < 0 ? -hw - 0.25 : hw + 1.65, 0.15, walk, rng, 1.0);
  }
}

// Лестница по склону 2 м: ступени по 16 см подъёма вдоль кривой, каменные щёки по бокам.
// Вар. 1 — чугунные перила по щёкам. Демо — с земляной насыпью и площадкой наверху.
function stairsSlope(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 2, stone = STONE[s], F = roadFrames(o.points ?? DEMO.stairs, 0.25);
  const L = F.at(-1).u, y0 = F[0].p[1], y1 = F.at(-1).p[1], n = Math.max(1, Math.round((y1 - y0) / 0.16));
  const rise = (y1 - y0) / n, run = L / n, slope = (u) => y0 + (y1 - y0) * u / L;
  if (!o.points) { // насыпь под лестницей и площадка наверху
    const Fb = roadFrames(DEMO.stairs, 1);
    strip(b, base, Fb, -W / 2 - 2.5, W / 2 + 2.5, -0.06, TURF, rng, 0.5);
    for (const k of [-1, 1]) side(b, base, Fb, k * (W / 2 + 2.5), (i) => -Fb[i].p[1], -0.06, EARTH, k, rng); // до пола
    const f = F.at(-1), q = off(f, 0);
    box(b, base, EARTH, q[0] + f.t[0] * 2, 0, q[2] + f.t[2] * 2, W + 5, y1 - 0.06, 4, yaw(f));
    box(b, base, TURF, q[0] + f.t[0] * 2, y1 - 0.06, q[2] + f.t[2] * 2, W + 5, 0.02, 4, yaw(f));
  }
  for (let i = 0; i < n; i++) {
    const f = frameAt(F, (i + 0.5) * run), top = y0 + (i + 1) * rise;
    box(b, base, jitterColor(stone, rng, 0.5), f.p[0], top - rise - 0.3, f.p[2], W, rise + 0.3, run + 0.05, yaw(f));
  }
  // щёки — по линии носков ступеней, через 1 м
  const Fc = roadFrames(o.points ?? DEMO.stairs, 1), cheek = new THREE.Color(stone).offsetHSL(0, 0, -0.06);
  const at1 = (f, x) => { const q = off(f, x); q[1] = slope(f.u) - 0.15; return q; };
  for (let i = 0; i < Fc.length - 1; i++) for (const k of [-1, 1]) beam(b, base, cheek, at1(Fc[i], k * (W / 2 + 0.15)), at1(Fc[i + 1], k * (W / 2 + 0.15)), 0.3, 1.1);
  if (o.variant !== 1) return;
  const Fr = roadFrames(o.points ?? DEMO.stairs, 1.5);
  for (const k of [-1, 1]) {
    const x = k * (W / 2 + 0.15), top = (f) => [f.p[0] + f.s[0] * x, slope(f.u) + 0.4 + 0.9, f.p[2] + f.s[2] * x];
    Fr.forEach((f, i) => {
      cyl(b, base, IRON, f.p[0] + f.s[0] * x, slope(f.u) + 0.4, f.p[2] + f.s[2] * x, 0.025, 0.025, 0.9, 4);
      if (i) beam(b, base, IRON, top(Fr[i - 1]), top(f), 0.06, 0.04);
    });
  }
}

// Деревянный мостик 2.5 м по прямой от первой точки к последней: каменные устои, прогоны, настил,
// при пролёте > 5 м — средняя опора, сходни на концах. Вар. 0 — колесоотбойные брусья, 1 — перила.
function bridgeWood(b, base, o, rng) {
  const pts = o.points ?? [[0, 0, -4.5], [0, 0, 4.5]], a = pts[0], c = pts.at(-1);
  const L = Math.hypot(c[0] - a[0], c[2] - a[2]) - 2.4, W = 2.5, y = 0.6;
  const m = at(base, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, 1, 1, 1, 0, Math.atan2(c[0] - a[0], c[2] - a[2]), 0);
  if (!o.points) { // ручей
    box(b, m, WATER, 0, 0, 0, 14, 0.03, L - 1.8);
    for (let i = 0; i < 6; i++) box(b, m, jitterColor(PEBBLE, rng), (rng() - 0.5) * 12, 0, (rng() < 0.5 ? -1 : 1) * (L / 2 - 0.9), 0.4 + rng() * 0.4, 0.25, 0.4, rng() * 3);
  }
  for (const k of [-1, 1]) {
    box(b, m, jitterColor(PEBBLE, rng, 0.5), 0, -0.4, k * (L / 2 - 0.3), W + 0.4, 0.75, 0.9);
    beam(b, m, jitterColor(WOOD, rng, 0.6), [0, y + 0.03, k * L / 2], [0, 0.02, k * (L / 2 + 1.2)], W - 0.2, 0.08); // сходни
  }
  for (const x of [-0.9, 0, 0.9]) box(b, m, PILE, x, y - 0.27, 0, 0.18, 0.24, L);
  for (let z = -L / 2 + 0.15; z < L / 2; z += 0.3) box(b, m, jitterColor(WOOD, rng, 0.8), 0, y - 0.03, z, W, 0.06, 0.26);
  if (L > 5) {
    for (const x of [-1.05, 1.05]) cyl(b, m, PILE, x, -1, 0, 0.13, 0.13, y - 0.27 + 1, 6);
    box(b, m, PILE, 0, y - 0.45, 0, W + 0.3, 0.18, 0.24);
  }
  for (const k of [-1, 1]) {
    const x = k * (W / 2 - 0.08);
    if (o.variant !== 1) { box(b, m, PILE, x, y + 0.03, 0, 0.16, 0.16, L); continue; }
    const np = Math.max(2, Math.round(L / 2));
    for (let i = 0; i <= np; i++) box(b, m, WOOD, x, y + 0.03, -L / 2 + 0.1 + i * (L - 0.2) / np, 0.12, 1.0, 0.12);
    box(b, m, WOOD, x, y + 0.98, 0, 0.1, 0.1, L);
    box(b, m, WOOD, x, y + 0.5, 0, 0.06, 0.08, L);
  }
}

// Каменный мост 4 м: 1–3 арки (params.arches), парапеты с плитами, мостовая, волнорезы у быков,
// пандусы до земли на обоих концах. Ось — по прямой от первой точки к последней.
function bridgeStone(b, base, o, rng) {
  const s = o.style ?? 'atlantic', stone = jitterColor(STONE[s], rng, 0.3), n = o.arches ?? 1, W = 4, span = 3.2, pw = 1.0, yT = 2.4;
  const Lb = n * span + (n + 1) * pw, pts = o.points ?? [[0, 0, -(Lb / 2 + 4)], [0, 0, Lb / 2 + 4]], a = pts[0], c = pts.at(-1);
  const rl = Math.max(2, (Math.hypot(c[0] - a[0], c[2] - a[2]) - Lb) / 2);
  const m = at(base, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, 1, 1, 1, 0, Math.atan2(c[0] - a[0], c[2] - a[2]), 0);
  if (!o.points) box(b, m, WATER, 0, 0, 0, 16, 0.03, Lb - 1.2);
  // тело моста — аркада во всю ширину: X грани — вдоль моста, стенка толщиной W
  arcade(b, at(m, -W / 2, 0, 0, 1, 1, 1, 0, -Math.PI / 2, 0), stone, { x0: -Lb / 2, x1: Lb / 2, n, yS: 0.6, yT, z: 0, t: W, pw, y0: -1 });
  for (let i = 1; i < n; i++) { // волнорезы
    const z = -Lb / 2 + i * (span + pw) + pw / 2;
    for (const k of [-1, 1]) box(b, m, stone, k * W / 2, -1, z, 0.7, 2.2, 0.7, Math.PI / 4);
  }
  const cap = new THREE.Color(stone).offsetHSL(0, 0, 0.06);
  box(b, m, jitterColor(COBBLE[s], rng, 0.3), 0, yT, 0, W - 0.8, 0.05, Lb);
  for (const k of [-1, 1]) {
    box(b, m, stone, k * (W / 2 - 0.2), yT, 0, 0.4, 0.75, Lb);
    box(b, m, cap, k * (W / 2 - 0.2), yT + 0.75, 0, 0.5, 0.1, Lb);
    // пандус: клин с откосами-стенками и парапетом по уклону
    const z0 = k * Lb / 2, z1 = k * (Lb / 2 + rl), tris = [], hw = W / 2;
    quad(tris, [-hw, yT, z0], [hw, yT, z0], [hw, 0, z1], [-hw, 0, z1]);
    for (const j of [-1, 1]) tri(tris, [j * hw, 0, z0], [j * hw, yT, z0], [j * hw, 0, z1], [j, 0, 0]);
    b.add(triGeo(tris), stone, m, rng, 0.3);
    for (const j of [-1, 1]) beam(b, m, cap, [j * (hw - 0.2), yT + 0.45, z0], [j * (hw - 0.2), 0.45, z1 - k * 0.3], 0.4, 0.9);
  }
}

// Подпорная стенка: кладка с наклоном лица назад, ряды по 0.5 м, плиты сверху, дренажные отверстия.
// Лицо — к +s (у демо — к +Z), засыпка — за стенкой. params.height. Демо — с террасой земли за стенкой.
function retainingWall(b, base, o, rng) {
  const s = o.style ?? 'atlantic', h = o.height ?? 2, t = 0.6, lean = 0.08, stone = STONE[s];
  const F = roadFrames(o.points ?? DEMO.wall, 0.25), L = F.at(-1).u;
  if (!o.points) {
    strip(b, base, F, -t - 4, -t / 2, h, TURF, rng, 0.4);
    side(b, base, F, -t - 4, 0, h, EARTH, -1, rng);
  }
  masonry(b, base, F, { x: -t / 2, y0: 0, y1: h, t, color: stone, rng, lean });
  const xt = -t / 2 - lean * h, Fc = roadFrames(o.points ?? DEMO.wall, 1.5);
  for (let i = 0; i < Fc.length - 1; i++) beam(b, base, jitterColor(new THREE.Color(stone).offsetHSL(0, 0, 0.07), rng, 0.4), off(Fc[i], xt, h + 0.08), off(Fc[i + 1], xt, h + 0.08), t + 0.2, 0.16);
  for (let u = 1; u < L - 0.5; u += 2) {
    const f = frameAt(F, u), q = off(f, -0.02, 0.45);
    box(b, base, 0x2a2a2a, q[0], q[1], q[2], 0.12, 0.12, 0.12, yaw(f));
  }
}

// Площадь 16×16: мощение квадратами с узором из колец, бордюр, по углам фонари, скамьи к центру.
// Вар. 0 — фонтан в центре, 1 — памятник, 2 — пусто.
function plaza(b, base, o, rng) {
  const s = o.style ?? 'atlantic', S = 16, N = 16, c = COBBLE[s], y = 0.06;
  const ring = new THREE.Color(c).offsetHSL(0, 0, s === 'south' ? -0.12 : 0.1), A = [], B = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = -S / 2 + i * S / N, z0 = -S / 2 + j * S / N, x1 = x0 + S / N, z1 = z0 + S / N;
    const r = Math.max(Math.abs(i - N / 2 + 0.5), Math.abs(j - N / 2 + 0.5)) - 0.5;
    quad(r % 4 === 1 ? B : A, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
  }
  b.add(triGeo(A), c, base, rng, 1.4);
  b.add(triGeo(B), ring, base, rng, 0.8);
  for (const k of [-1, 1]) {
    box(b, base, STONE[s], 0, 0, k * (S / 2 + 0.2), S + 0.8, 0.12, 0.4);
    box(b, base, STONE[s], k * (S / 2 + 0.2), 0, 0, 0.4, 0.12, S);
  }
  if (o.variant === 0 || o.variant === undefined) STREET.fountain.build(b, at(base, 0, y, 0), { style: s }, rng);
  else if (o.variant === 1) STREET.monument.build(b, at(base, 0, y, 0), { style: s, variant: rng() < 0.5 ? 0 : 1 }, rng);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    STREET.bench.build(b, at(base, Math.sin(a) * 4.6, y, Math.cos(a) * 4.6, 1, 1, 1, 0, a + Math.PI, 0), { variant: 0 }, rng);
  }
  const extras = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) extras.push(...STREET['street-lamp'].build(b, at(base, x * 7, y, z * 7), { variant: 0 }, rng).extras);
  return { extras };
}

// road: true — объект принимает opts.points (лента по точкам); без них строится демо-отрезок
export const ROADS = {
  path: { name: 'Тропа', category: 'roads', road: true, footprint: { w: 5, d: 16 }, build: path },
  'road-dirt': { name: 'Грунтовая дорога', category: 'roads', road: true, footprint: { w: 8, d: 20 }, build: roadDirt },
  'road-cobble': { name: 'Мощёная улица', category: 'roads', road: true, styles: true, variants: 2, footprint: { w: 10, d: 20 }, build: roadCobble },
  'stairs-slope': { name: 'Лестница по склону', category: 'roads', road: true, styles: true, variants: 2, footprint: { w: 7, d: 14 }, build: stairsSlope },
  'bridge-wood': { name: 'Деревянный мостик', category: 'roads', road: true, variants: 2, footprint: { w: 3, d: 11.5 }, build: bridgeWood },
  'bridge-stone': { name: 'Каменный мост', category: 'roads', road: true, styles: true, footprint: { w: 5, d: 14 },
    params: { arches: { min: 1, max: 3, step: 1, value: 1, label: 'арок' } }, build: bridgeStone },
  'retaining-wall': { name: 'Подпорная стенка', category: 'roads', road: true, styles: true, footprint: { w: 6.5, d: 5 },
    params: { height: { min: 1, max: 4, step: 0.5, value: 2, label: 'высота' } }, build: retainingWall },
  plaza: { name: 'Площадь', category: 'roads', styles: true, variants: 3, footprint: { w: 17, d: 17 }, build: plaza },
};
