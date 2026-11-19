import * as THREE from 'three';
import { jitterColor } from '../flora.js';
import {
  palette, pick, at, box, cyl, beam, gable, hip, spire, faceFrame, windowAt, windowRow, doorAt, glow,
} from './kit.js';

// Жильё и общественные здания (категории A–B каталога docs/changes/structures-library/catalog.md).
// build(b, base, opts, rng) пишет в PropBatch и может вернуть { extras: [Object3D] } —
// детали, которые не ложатся в батч (светящийся фонарь), уже с применённой base.

// Фонарь маяка: светится, поэтому отдельный меш (glow), а не цвет вершин.
const lamp = (base, r, h, y) => glow(base, new THREE.CylinderGeometry(r, r, h, 8), 0, y + h / 2, 0);

// Маяк. atlantic — прежний маяк Маячного острова один в один (белая башня, красный пояс);
// north — красно-белые полосы, чёрная галерея; south — восьмигранная башня из известняка, медный купол.
function lighthouse(b, base, o = {}) {
  const style = o.style ?? 'atlantic';
  const p = palette(style);
  if (style === 'atlantic') {
    cyl(b, base, 0xf4f1e8, 0, 0, 0, 1.4, 1.9, 9, 10);
    cyl(b, base, 0xe9553b, 0, 3.5, 0, 1.62, 1.72, 2, 10);
    spire(b, base, 0xb8463a, 0, 10.6, 0, 1.5, 1.6, 8);
    return { extras: [lamp(base, 1.1, 1.6, 9)] };
  }
  if (style === 'north') {
    const H = 10, seg = 12;
    for (let i = 0; i < 5; i++) {
      const y0 = (i / 5) * H, y1 = ((i + 1) / 5) * H;
      const r0 = 2.0 - 0.6 * (y0 / H), r1 = 2.0 - 0.6 * (y1 / H);
      cyl(b, base, i % 2 ? 0xf4f1e8 : 0xc23b2e, 0, y0, 0, r1, r0, y1 - y0, seg);
    }
    cyl(b, base, p.metal, 0, H, 0, 1.9, 1.9, 0.25, seg); // галерея
    for (let i = 0; i < 12; i++) { // стойки перил
      const a = (i / 12) * Math.PI * 2;
      cyl(b, base, p.metal, Math.cos(a) * 1.8, H + 0.25, Math.sin(a) * 1.8, 0.03, 0.03, 0.8, 4);
    }
    cyl(b, base, p.metal, 0, H + 1.0, 0, 1.85, 1.85, 0.06, seg);
    cyl(b, base, p.metal, 0, H + 0.25, 0, 1.15, 1.15, 0.4, 8);
    spire(b, base, p.metal, 0, H + 2.15, 0, 1.4, 1.3, 8);
    cyl(b, base, p.metal, 0, H + 3.45, 0, 0.08, 0.12, 0.5, 6);
    // домик у подножия
    box(b, base, 0xf4f1e8, 0, 0, 2.6, 2.2, 2.2, 1.4);
    doorAt(b, faceFrame(base, '+z', 3.3), 0, { w: 0.8, h: 1.8, color: p.door, frame: p.trim });
    return { extras: [lamp(base, 1.05, 1.5, H + 0.65)] };
  }
  // south
  // восьмигранник повёрнут на π/8: к +Z смотрит грань, а не ребро
  const H = 9, seg = 8, rot = Math.PI / 8, apo = Math.cos(Math.PI / 8);
  cyl(b, base, p.stone, 0, 0, 0, 2.6, 2.8, 2.2, seg, rot); // цоколь с дверью
  cyl(b, base, p.trim, 0, 2.2, 0, 2.7, 2.7, 0.15, seg, rot);
  cyl(b, base, p.stone, 0, 2.2, 0, 1.5, 2.0, H - 2.2, seg, rot);
  cyl(b, base, p.trim, 0, H - 0.4, 0, 1.75, 1.6, 0.4, seg, rot); // карниз
  const towerR = (y) => (2.0 - 0.5 * (y - 2.2) / (H - 2.2)) * apo;
  cyl(b, base, p.stone, 0, H, 0, 1.9, 1.9, 0.2, seg); // галерея
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    cyl(b, base, p.metal, Math.cos(a) * 1.8, H + 0.2, Math.sin(a) * 1.8, 0.03, 0.03, 0.75, 4);
  }
  cyl(b, base, p.metal, 0, H + 0.92, 0, 1.85, 1.85, 0.06, 16);
  b.add(new THREE.SphereGeometry(1.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), p.copper,
    new THREE.Matrix4().copy(base).multiply(new THREE.Matrix4().makeTranslation(0, H + 1.9, 0)));
  cyl(b, base, p.copper, 0, H + 3.0, 0, 0.05, 0.1, 0.5, 6);
  doorAt(b, faceFrame(base, '+z', 2.65 * apo), 0, { w: 0.9, h: 1.85, color: p.door, frame: p.trim });
  for (const y of [4.6, 7.2]) windowAt(b, faceFrame(base, '+z', towerR(y)), 0, y, { ww: 0.38, wh: 0.75, frame: p.trim, glass: p.glass, sill: false });
  return { extras: [lamp(base, 1.1, 1.5, H + 0.4)] };
}

// --- A. Жильё: общие детали ------------------------------------------------

const SOD = 0x6f7f3e, BRICK = 0x9c4a36, BARREL = 0x7a5a3a, IRON = 0x2b2b2b, VINE = 0x5f8a3a;

// Труба: кладка w×w от y0 высотой h, оголовок
function chimney(b, base, color, x, z, y0, h, w = 0.6) {
  box(b, base, color, x, y0, z, w, h, w);
  box(b, base, new THREE.Color(color).offsetHSL(0, 0, -0.12), x, y0 + h, z, w + 0.14, 0.12, w + 0.14);
}

// Угловые доски коробки w×d от y0 до y1
function corners(b, base, color, w, d, y0, y1, t = 0.16) {
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(b, base, color, x * (w / 2 - t / 2 + 0.02), y0, z * (d / 2 - t / 2 + 0.02), t, y1 - y0, t);
}

// Обшивка внахлёст (атлантика): пояски по периметру коробки w×d от y0 до y1
function siding(b, base, color, rng, x, z, w, d, y0, y1, step = 0.34) {
  for (let y = y0 + step; y < y1 - 0.08; y += step) box(b, base, jitterColor(color, rng, 0.4).offsetHSL(0, 0, -0.05), x, y, z, w + 0.04, 0.05, d + 0.04);
}

// Перила вдоль X грани f: от x0 до x1 на удалении z от стены, низ на y
function rail(b, f, color, x0, x1, z, y, { h = 0.9, step = 0.6, t = 0.06 } = {}) {
  const w = x1 - x0, n = Math.max(1, Math.round(w / step));
  if (w <= 0) return;
  box(b, f, color, (x0 + x1) / 2, y + h - t, z, w, t * 1.4, t * 1.8);
  box(b, f, color, (x0 + x1) / 2, y + 0.1, z, w, t, t);
  for (let i = 0; i <= n; i++) box(b, f, color, x0 + i * w / n, y + 0.1, z, t, h - 0.16, t);
}

// Балкон на грани f: плита w×dp на высоте y, перила с трёх сторон
function balcony(b, f, x, w, y, slab, iron, dp = 0.8, ropt = { step: 0.3, t: 0.035 }) {
  box(b, f, slab, x, y, dp / 2, w, 0.14, dp);
  rail(b, f, iron, x - w / 2, x + w / 2, dp - 0.04, y + 0.14, ropt);
  for (const k of [-1, 1]) rail(b, at(f, x + k * (w / 2 - 0.03), 0, 0, 1, 1, 1, 0, -Math.PI / 2, 0), iron, 0.05, dp - 0.08, 0, y + 0.14, ropt);
}

// Веранда/крыльцо у грани f (X — вдоль стены, Z — наружу): настил высотой y от x0 до x1 глубиной dp,
// стойки, односкатный навес от стены (h + 0.45) к краю (h). gap — x прохода: ступень и разрыв перил.
function porch(b, f, { x0, x1, dp = 1.8, h = 2.5, y = 0.3, deck, post, roof, railing = false, gap }) {
  const w = x1 - x0, cx = (x0 + x1) / 2, n = Math.max(1, Math.round(w / 2.4));
  box(b, f, deck, cx, 0, dp / 2, w, y, dp);
  for (let i = 0; i <= n; i++) box(b, f, post, x0 + 0.1 + i * (w - 0.2) / n, y, dp - 0.12, 0.14, h - y, 0.14);
  box(b, f, post, cx, h - 0.2, dp - 0.12, w, 0.2, 0.16);
  beam(b, f, roof, [cx, h + 0.45, 0], [cx, h, dp + 0.3], w + 0.3, 0.1);
  if (railing) {
    if (gap === undefined) rail(b, f, post, x0 + 0.1, x1 - 0.1, dp - 0.12, y, { step: 0.6 });
    else { rail(b, f, post, x0 + 0.1, gap - 0.7, dp - 0.12, y, { step: 0.6 }); rail(b, f, post, gap + 0.7, x1 - 0.1, dp - 0.12, y, { step: 0.6 }); }
  }
  if (gap !== undefined && y > 0.2) box(b, f, deck, gap, 0, dp + 0.25, 1.4, y / 2, 0.5);
}

// Пергола у грани f: стойки, балки, лоза поверх
function pergola(b, f, cx, w, dp, h, wood, rng) {
  for (const k of [-1, 1]) box(b, f, wood, cx + k * (w / 2 - 0.1), 0, dp - 0.12, 0.14, h, 0.14);
  box(b, f, wood, cx, h, dp - 0.12, w + 0.3, 0.16, 0.14);
  for (let i = 0; i < 5; i++) box(b, f, wood, cx - w / 2 + (i + 0.5) * w / 5, h + 0.16, dp / 2, 0.1, 0.12, dp + 0.3);
  for (let i = 0; i < 4; i++) {
    box(b, f, jitterColor(VINE, rng, 1.5), cx + (rng() - 0.5) * w * 0.8, h + 0.26, dp * (0.2 + rng() * 0.6), 0.6 + rng() * 0.9, 0.18, 0.5 + rng() * 0.6);
  }
}

// Фахверк на грани f: стойки по границам cols осей, ригели, андреевы кресты под окнами (cross).
// door — ось с дверью: в ней только верхний ригель.
function timber(b, f, span, cols, H, color, { door = -1, cross = true } = {}) {
  const t = 0.14, bw = span / cols;
  for (let i = 0; i <= cols; i++) {
    const x = Math.max(-span / 2 + t / 2, Math.min(span / 2 - t / 2, i * bw - span / 2));
    box(b, f, color, x, 0.35, 0.04, t, H - 0.35, 0.08);
  }
  for (let i = 0; i < cols; i++) {
    const x0 = i * bw - span / 2 + t / 2, x1 = x0 + bw - t;
    for (const y of [0.85, H - 0.07]) if (i !== door || y > 2.5) box(b, f, color, (x0 + x1) / 2, y - t / 2, 0.04, bw - t, t, 0.08);
    if (cross && i !== door) {
      beam(b, f, color, [x0, 0.35, 0.04], [x1, 0.78, 0.04], 0.08, 0.1);
      beam(b, f, color, [x0, 0.78, 0.04], [x1, 0.35, 0.04], 0.08, 0.1);
    }
  }
}

// Слуховое окно на переднем скате (конёк вдоль X, полуглубина hd, стены до H, подъём rise)
function dormer(b, base, x, hd, H, rise, wall, roof, trim, glass) {
  const zf = hd - 0.6, z0 = 0.4, wy = H + rise * 0.6 / hd + 0.42, yt = wy + 0.5;
  box(b, base, wall, x, H, (zf + z0) / 2, 1.3, yt - H, zf - z0);
  gable(b, base, { x, z: (zf + z0) / 2, w: zf - z0, d: 1.3, y: yt, h: 0.55, over: 0.15, t: 0.08, roof, wall, ry: Math.PI / 2 });
  windowAt(b, faceFrame(base, '+z', zf, x, 0), 0, wy, { ww: 0.6, wh: 0.7, frame: trim, glass, sill: false });
}

// Эркер на грани f: коробка w×0.8 от y0 высотой h, окна спереди и по бокам, навес
function bayWindow(b, f, x, w, y0, h, wall, roof, opts) {
  const dp = 0.8, wy = y0 + h / 2 + 0.1, o = { ...opts, shutter: undefined };
  box(b, f, wall, x, y0, dp / 2, w, h, dp);
  beam(b, f, roof, [x, y0 + h + 0.3, 0], [x, y0 + h - 0.05, dp + 0.2], w + 0.3, 0.1);
  windowRow(b, at(f, x, 0, dp), w, Math.max(1, Math.round(w / 1.4)), [wy], o);
  for (const k of [-1, 1]) windowAt(b, at(f, x + k * w / 2, 0, dp / 2, 1, 1, 1, 0, k * Math.PI / 2, 0), 0, wy, { ...o, ww: 0.4, sill: false });
}

// Ступенчатый фронтон (север) на грани f: ширина W, от H до H + rise, n уступов
function steppedGable(b, f, W, H, rise, color, n = 5) {
  for (let i = 0; i < n; i++) box(b, f, color, 0, H + i * rise / n, 0.05, W * (1 - i / n), rise / n + 0.3, 0.4); // впереди свеса крыши (0.2)
  box(b, f, color, 0, H + rise + 0.3, 0.05, 0.2, 0.5, 0.2);
}

// Корпус городского дома: цоколь, стены по стилю, пояски, карниз, крыша, окна верхних этажей фасада, боков и тыла.
// roofKind: 'hip' | 'gableX' (конёк вдоль фасада) | 'gableZ' (фронтон на улицу) | 'flat'.
// Первый этаж фасада (+Z) — у вызывающего: возвращаются уровни окон levels и оси xs.
function body(b, base, o, rng, { W, D, floors, cols, roofKind, rise = 2, fh = 3.1, sideCols = 2, wall, shutters = true }) {
  const s = o.style ?? 'atlantic', p = palette(s), H = 0.3 + floors * fh, trim = p.trim;
  wall = jitterColor(wall ?? (s === 'north' ? pick([p.brick, 0x8a3e2e, 0xa8584a], rng)
    : s === 'atlantic' ? pick([0xf4f1e8, 0xe6dcc3, 0x8e9aa0, 0xa8a49a], rng) : pick(p.wall, rng)), rng, 0.4);
  const roof = s === 'north' ? pick([p.roof[0], p.roof[2]], rng) : pick(p.roof, rng);
  box(b, base, p.stone, 0, 0, 0, W + 0.12, 0.3, D + 0.12);
  box(b, base, wall, 0, 0.3, 0, W, H - 0.3, D);
  if (s === 'atlantic') { siding(b, base, wall, rng, 0, 0, W, D, 0.3, H, H > 8 ? 0.45 : 0.34); corners(b, base, trim, W, D, 0.3, H); }
  for (let k = 1; k < floors; k++) box(b, base, trim, 0, 0.3 + k * fh - 0.12, 0, W + 0.08, 0.14, D + 0.08); // междуэтажные пояски
  if (s === 'south' || roofKind === 'flat') box(b, base, trim, 0, H - 0.3, 0, W + 0.4, 0.3, D + 0.4); // карниз
  if (roofKind === 'hip') hip(b, base, { w: W, d: D, y: H, h: rise, over: 0.45, roof });
  else if (roofKind === 'gableX') gable(b, base, { w: W, d: D, y: H, h: rise, roof, wall });
  else if (roofKind === 'gableZ') gable(b, base, { w: D, d: W, y: H, h: rise, over: 0.2, roof, wall, ry: Math.PI / 2 });
  else box(b, base, roof, 0, H, 0, W + 0.1, 0.12, D + 0.1);
  const levels = Array.from({ length: floors }, (_, k) => 0.3 + k * fh + 1.5);
  const opts = { ww: 0.8, wh: 1.35, frame: trim, glass: p.glass, shutter: s === 'north' || !shutters ? undefined : pick(p.shutter, rng) };
  const plain = { ...opts, shutter: undefined, sill: false, mullion: false };
  const f = faceFrame(base, '+z', D / 2);
  windowRow(b, f, W, cols, levels.slice(1), opts);
  windowRow(b, faceFrame(base, '-z', D / 2), W, cols, levels, plain);
  for (const face of ['+x', '-x']) windowRow(b, faceFrame(base, face, W / 2), D, sideCols, levels, plain);
  return { s, p, H, f, wall, roof, trim, levels, opts, xs: Array.from({ length: cols }, (_, i) => (i + 0.5) * W / cols - W / 2) };
}

// --- A. Жильё ---------------------------------------------------------------

// Рыбацкая хижина. south — камень, пологая черепица; north — фалунский красный, дёрн; atlantic — серый гонт.
// По seed: труба, навес над дверью, бочка, вёсла у стены.
function hut(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), W = 3.6, D = 2.8, H = 2.2;
  const wall = jitterColor(s === 'south' ? p.stone : s === 'north' ? p.wall[0] : 0xa8a49a, rng, 0.5);
  const roof = s === 'north' ? jitterColor(SOD, rng) : pick(p.roof, rng);
  const rise = { south: 0.7, north: 1.5, atlantic: 1.3 }[s];
  box(b, base, wall, 0, 0, 0, W, H, D);
  if (s === 'atlantic') siding(b, base, wall, rng, 0, 0, W, D, 0, H, 0.28);
  if (s === 'north') corners(b, base, p.trim, W, D, 0, H, 0.12);
  if (s === 'north') gable(b, base, { w: W, d: D, y: H - 0.02, h: rise, over: 0.32, t: 0.06, roof: p.wood }); // доски под дёрном
  gable(b, base, { w: W, d: D, y: H, h: rise, over: 0.3, t: s === 'north' ? 0.24 : 0.1, roof, wall });
  const f = faceFrame(base, '+z', D / 2);
  const opts = { ww: 0.55, wh: 0.6, frame: s === 'south' ? 0xf4f1e8 : p.trim, glass: p.glass, sill: s !== 'north' };
  doorAt(b, f, -0.7, { w: 0.85, h: 1.85, color: s === 'south' ? pick(p.shutter, rng) : p.door, frame: opts.frame });
  windowAt(b, f, 0.85, 1.35, opts);
  windowAt(b, faceFrame(base, '+x', W / 2), 0, 1.35, opts);
  if (rng() < 0.65) chimney(b, base, s === 'south' ? 0xf4f1e8 : p.stone, W / 2 - 0.5, -0.45, H - 0.2, rise + 0.6, 0.5);
  if (rng() < 0.5) { // навес над дверью на кронштейнах
    beam(b, f, s === 'north' ? p.wood : roof, [-0.7, 2.15, 0], [-0.7, 1.95, 0.85], 1.3, 0.06);
    for (const k of [-1, 1]) beam(b, f, p.wood, [-0.7 + k * 0.55, 1.55, 0.02], [-0.7 + k * 0.55, 1.98, 0.75], 0.06, 0.06);
  }
  if (rng() < 0.6) {
    cyl(b, base, BARREL, -1.45, 0, D / 2 + 0.4, 0.27, 0.27, 0.75, 8);
    cyl(b, base, IRON, -1.45, 0.55, D / 2 + 0.4, 0.29, 0.29, 0.06, 8);
  }
  if (rng() < 0.6) for (const z of [-0.5, -0.1]) beam(b, base, p.wood, [W / 2 + 0.55, 0, z], [W / 2 + 0.06, 2.1, z + 0.15], 0.05, 0.12);
}

// Дом 1–1.5 эт. south — штукатурка, низкая вальмовая черепица; north — фахверк или фалунский красный, крутая крыша;
// atlantic — «Cape Cod»: симметричный фасад, центральная труба. По seed: слуховое окно, крыльцо (на юге — пергола), пристройка.
// over — подмена размеров и вариантов (дом смотрителя); side — грань −X занята (переход), там ни окна, ни пристройки.
const COTTAGE = {
  south: { W: 7, D: 5, H: 3.2, rise: 1.4 },
  north: { W: 7, D: 5, H: 3.0, rise: 3.2 },
  atlantic: { W: 8, D: 5.5, H: 2.7, rise: 2.6 },
};
function cottage(b, base, o, rng, over = {}) {
  const s = o.style ?? 'atlantic', p = palette(s);
  const { W, D, H, rise } = { ...COTTAGE[s], ...over };
  const hw = W / 2, hd = D / 2, trim = p.trim;
  // варианты решаются заранее: порядок вызовов rng не зависит от веток
  const vDormer = over.dormer ?? rng() < 0.5, vPorch = over.porch ?? rng() < 0.6, vAnnex = !over.side && rng() < 0.4;
  const timbered = s === 'north' && rng() < 0.5;
  let wall, roof = pick(p.roof, rng);
  if (s === 'south') wall = pick(p.wall, rng);
  else if (s === 'north') {
    wall = timbered ? p.plaster : pick([p.wall[0], p.wall[1]], rng);
    if (wall === p.wall[0]) roof = pick([p.roof[0], p.roof[2]], rng); // красное дерево — под тёмной кровлей
  } else wall = pick([0xa8a49a, 0xf4f1e8, 0xb5ad9e], rng);
  const wc = jitterColor(wall, rng, 0.4);
  box(b, base, p.stone, 0, 0, 0, W + 0.12, 0.35, D + 0.12); // цоколь
  box(b, base, wc, 0, 0.35, 0, W, H - 0.35, D);
  if (s === 'atlantic') siding(b, base, wall, rng, 0, 0, W, D, 0.35, H, 0.3);
  if (s !== 'south' && !timbered) corners(b, base, trim, W, D, 0.35, H);
  if (s === 'south') hip(b, base, { w: W, d: D, y: H, h: rise, over: 0.45, roof });
  else gable(b, base, { w: W, d: D, y: H, h: rise, over: 0.35, roof, wall: wc });

  // фасад: дверь и окна; на севере 4 оси по 1.75 м, дверь во второй справа
  const opts = { ww: 0.66, wh: 1.0, frame: trim, glass: p.glass, shutter: s === 'north' ? undefined : pick(p.shutter, rng) };
  const wy = 1.6, f = faceFrame(base, '+z', hd), fb = faceFrame(base, '-z', hd);
  const doorX = s === 'north' ? W / 8 : 0;
  const wins = s === 'north' ? [-3 * W / 8, -W / 8, 3 * W / 8] : s === 'atlantic' && W >= 8 ? [-3.05, -1.45, 1.45, 3.05] : [-2.1, 2.1];
  doorAt(b, f, doorX, { w: 0.95, h: 1.95, y0: 0.35, color: s === 'south' ? pick(p.shutter, rng) : p.door, frame: trim });
  for (const x of wins) windowAt(b, f, x, wy, opts);
  const plain = { ...opts, shutter: undefined, sill: false, mullion: false };
  for (const x of [-3 * W / 8, 3 * W / 8]) windowAt(b, fb, x, wy, plain);
  for (const face of ['+x', '-x']) {
    const fs = faceFrame(base, face, hw);
    if (face === '+x' || (!vAnnex && !over.side)) windowAt(b, fs, 0, wy, plain);
    if (s !== 'south') windowAt(b, fs, 0, H + rise * 0.4, { ...plain, ww: 0.55, wh: 0.75 }); // окно в фронтоне
  }
  if (timbered) {
    timber(b, f, W, 4, H, p.timber, { door: 2 });
    timber(b, fb, W, 4, H, p.timber, { cross: false });
    for (const face of ['+x', '-x']) timber(b, faceFrame(base, face, hw), D, 3, H, p.timber, { cross: false });
  }

  // труба: на юге — над задним скатом, на севере — на коньке, в Cape Cod — большая по центру
  if (s === 'south') chimney(b, base, p.trim, hw - 1.2, -0.8, H, rise + 0.4);
  else if (s === 'north') chimney(b, base, BRICK, -1.2, 0, H, rise + 0.5, 0.55);
  else chimney(b, base, BRICK, 0, 0, H, rise + 0.6, 1.0);

  if (vDormer && s !== 'south') for (const x of s === 'atlantic' ? [-1.45, 1.45] : [-W / 4]) dormer(b, base, x, hd, H, rise, wc, roof, trim, p.glass);
  if (vPorch) {
    if (s === 'south') pergola(b, f, doorX, 3.6, 2.2, 2.5, p.wood, rng);
    else porch(b, f, { x0: doorX - 1.0, x1: doorX + 1.0, dp: 1.5, h: H - 0.55, y: 0.35, deck: p.wood, post: trim, roof, gap: doorX });
  }
  if (vAnnex) { // пристройка под односкатной крышей у −X
    const aw = 2.4, ad = D - 1.4, ah = H - 0.9, ax = -hw - aw / 2, az = -0.4;
    box(b, base, wc, ax, 0, az, aw, ah, ad);
    if (s === 'atlantic') siding(b, base, wall, rng, ax, az, aw, ad, 0, ah, 0.3);
    beam(b, faceFrame(base, '-x', hw), roof, [az, ah + 0.5, 0], [az, ah - 0.05, aw + 0.25], ad + 0.4, 0.1);
    windowAt(b, faceFrame(base, '+z', ad / 2, ax, az), 0, ah * 0.55, { ...plain, ww: 0.5, wh: 0.6 });
  }
  return { wall: wc, roof, trim, H };
}

// Дом смотрителя: дом как cottage (7×6), вариант 1 — с крытым переходом к маяку у −X.
function keeperHouse(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 7, link = o.variant === 1;
  const { wall, roof, trim } = cottage(b, base, o, rng, { W, D: 6, side: link });
  if (!link) return;
  const L = 2.4, R = { south: 2.6, north: 2.0, atlantic: 1.9 }[s] ?? 1.9, x0 = -W / 2 - L - R + 0.3, px = -W / 2 - L / 2 - 0.15;
  box(b, base, wall, px, 0, 0, L + 0.6, 2.4, 1.6);
  gable(b, base, { x: px, w: L + 0.6, d: 1.6, y: 2.4, h: 0.6, over: 0.15, roof, wall });
  for (const face of ['+z', '-z']) windowAt(b, faceFrame(base, face, 0.8, px, 0), 0, 1.5, { ww: 0.5, wh: 0.6, frame: trim, glass: palette(s).glass, sill: false });
  return lighthouse(b, at(base, x0, 0, 0), { style: s });
}

// Городской дом 2 эт. south — вальмовая крыша, балкон с решёткой; north — кирпич, ступенчатый фронтон;
// atlantic — обшивка, фронтон на улицу, эркер. По seed: цвет фасада, 2–3 оси окон.
function townhouse(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 6, D = 8, cols = rng() < 0.5 ? 2 : 3;
  const rise = { south: 1.5, north: 4.2, atlantic: 3.2 }[s];
  const { p, H, f, wall, roof, trim, levels, opts, xs } = body(b, base, o, rng, { W, D, floors: 2, cols, rise, roofKind: s === 'south' ? 'hip' : 'gableZ' });
  doorAt(b, f, xs[0], { w: 1.0, h: 2.3, y0: 0.3, color: p.door, frame: trim });
  if (s === 'atlantic') {
    const x0 = xs[1] - 1.0, x1 = cols === 3 ? xs[2] + 0.7 : xs[1] + 1.0;
    bayWindow(b, f, (x0 + x1) / 2, x1 - x0, 0.3, 2.4, wall, roof, opts);
    windowAt(b, f, 0, H + 1.1, { ...opts, shutter: undefined, ww: 0.6, wh: 0.9, sill: false }); // окно в фронтоне
  } else for (const x of xs.slice(1)) windowAt(b, f, x, levels[0], opts);
  if (s === 'north') {
    steppedGable(b, f, W, H, rise, wall);
    windowAt(b, at(f, 0, 0, 0.25), 0, H + 1.2, { ...opts, ww: 0.6, wh: 0.9, sill: false });
  }
  if (s === 'south') balcony(b, f, cols === 3 ? 0 : xs[1], cols === 3 ? 4.6 : 1.8, 0.3 + 3.1, p.stone, IRON);
}

// Дом с лавкой: витрина, дверь, вывеска-фриз. south — полосатая маркиза; north — вывеска на кронштейне;
// atlantic — галерея-веранда во всю ширину. По seed: цвет вывески, маркизы, фасада.
function shophouse(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 6, D = 9;
  const sign = pick([0x2f4f3f, 0x7a2e2a, 0x2f3f5f, 0x3a3a3a, 0x8a6a2a], rng);
  const { p, f, roof, trim } = body(b, base, o, rng, { W, D, floors: 2, cols: 3, sideCols: 3,
    roofKind: s === 'atlantic' ? 'gableZ' : s === 'north' ? 'gableX' : 'hip', rise: { south: 1.5, north: 3.5, atlantic: 3 }[s] });
  // витрина справа, дверь слева
  const dx = -W / 2 + 0.95, sx = 0.75, sw = 3.6;
  doorAt(b, f, dx, { w: 1.0, h: 2.3, y0: 0.3, color: sign, frame: trim });
  box(b, f, trim, sx, 0.3, 0.04, sw + 0.24, 2.3, 0.08);
  box(b, f, sign, sx, 0.3, 0.09, sw, 0.5, 0.04); // филёнка под витриной
  box(b, f, p.glass, sx, 0.85, 0.09, sw, 1.6, 0.04);
  for (const k of [-1, 1]) box(b, f, trim, sx + k * sw / 6, 0.85, 0.12, 0.06, 1.6, 0.03);
  box(b, f, sign, 0, 2.7, 0.07, W - 0.3, 0.5, 0.1); // фриз с «буквами»
  for (let i = 0; i < 6; i++) box(b, f, 0xf2e6c4, -1.5 + i * 0.6, 2.84, 0.13, 0.36, 0.22, 0.02);
  if (s === 'south') {
    const stripe = pick([0x2f6f9f, 0xc23b2e, 0x3f7f4f], rng), n = 10, aw = W - 0.4;
    for (let i = 0; i < n; i++) {
      const x = -aw / 2 + (i + 0.5) * aw / n, c = i % 2 ? 0xf4f1e8 : stripe;
      beam(b, f, c, [x, 2.65, 0.05], [x, 2.1, 1.5], aw / n, 0.04);
      box(b, f, c, x, 1.9, 1.5, aw / n, 0.22, 0.03); // фестон
    }
  } else if (s === 'north') {
    const x = -W / 2 + 0.35;
    box(b, f, IRON, x, 3.55, 0.55, 0.05, 0.05, 1.1);
    beam(b, f, IRON, [x, 3.1, 0.02], [x, 3.55, 0.8], 0.04, 0.04);
    box(b, f, sign, x, 2.95, 0.75, 0.05, 0.55, 0.7);
    box(b, f, 0xc9a24a, x, 3.05, 0.75, 0.07, 0.3, 0.4);
  } else {
    porch(b, f, { x0: -W / 2, x1: W / 2, dp: 2.2, h: 3.1, y: 0.25, deck: p.wood, post: trim, roof, gap: dx });
    box(b, f, sign, 0, 3.15, 2.4, W * 0.7, 0.55, 0.06);
  }
}

// Доходный дом 3–4 эт. south — пилястры, карниз, вальмовая крыша; north — кирпич с поясками, слуховые окна;
// atlantic — деревянный «3-decker»: плоская крыша, веранды друг над другом.
function tenement(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 10, D = 10, fh = 3.2, floors = o.floors ?? 3;
  const { p, f, H, wall, roof, trim, levels, opts, xs } = body(b, base, o, rng, { W, D, floors, cols: 4, fh, sideCols: 2, shutters: s !== 'atlantic',
    roofKind: s === 'south' ? 'hip' : s === 'north' ? 'gableX' : 'flat', rise: s === 'north' ? 3.6 : 1.8 });
  const di = s === 'atlantic' ? 2 : 1; // подъезд
  doorAt(b, f, xs[di], { w: 1.3, h: 2.5, y0: 0.3, color: p.door, frame: trim });
  xs.forEach((x, i) => { if (i !== di) windowAt(b, f, x, levels[0], opts); });
  if (s === 'south') for (let i = 0; i <= 4; i++) {
    const x = Math.max(-W / 2 + 0.16, Math.min(W / 2 - 0.16, i * W / 4 - W / 2));
    box(b, f, trim, x, 0.3, 0.06, 0.32, H - 0.6, 0.12); // пилястры
  }
  if (s === 'north') for (const x of [-2.5, 2.5]) dormer(b, base, x, D / 2, H, 3.6, wall, roof, trim, p.glass);
  if (s === 'atlantic') { // веранды на всех этажах по правой половине фасада
    const x0 = 0.1, x1 = W / 2, dp = 1.8, cx = (x0 + x1) / 2;
    for (let k = 0; k < floors; k++) {
      const y = k === 0 ? 0.6 : 0.3 + k * fh, top = 0.3 + (k + 1) * fh - 0.15;
      box(b, f, p.wood, cx, k === 0 ? 0 : y - 0.15, dp / 2, x1 - x0, k === 0 ? 0.6 : 0.15, dp);
      for (const x of [x0 + 0.1, cx, x1 - 0.1]) box(b, f, trim, x, y, dp - 0.1, 0.16, top - y, 0.16);
      const ro = { step: 0.9, t: 0.08 };
      if (k === 0) { rail(b, f, trim, x0 + 0.2, xs[di] - 0.7, dp - 0.1, y, ro); rail(b, f, trim, xs[di] + 0.7, x1 - 0.2, dp - 0.1, y, ro); }
      else rail(b, f, trim, x0 + 0.2, x1 - 0.2, dp - 0.1, y, ro);
    }
    box(b, f, p.wood, xs[di], 0, dp + 0.25, 1.4, 0.3, 0.5); // ступень
    box(b, f, roof, cx, H - 0.15, dp / 2, x1 - x0 + 0.2, 0.15, dp + 0.2);
  }
}

// Особняк 2 эт. south — вальмовая крыша, лоджия с балюстрадой, бельведер; north — дерево, башенка со шпилем, веранда;
// atlantic — «шингл»: гонт, круглая башня, веранда вокруг фасада и бока. params: tower, veranda.
function villa(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 12, D = 9, fh = 3.2;
  const p0 = palette(s);
  const wall = s === 'south' ? pick([0xf2d6c9, 0xefe3c8, 0xf4f1e8], rng) : s === 'north' ? pick(p0.wall, rng) : 0x9a8a72;
  const rise = s === 'south' ? 2.2 : 3.8;
  const { p, f, H, wall: wc, roof, trim, levels, opts, xs } = body(b, base, o, rng, { W, D, floors: 2, cols: 5, fh, sideCols: 3,
    roofKind: s === 'south' ? 'hip' : 'gableX', rise, wall });
  if (s === 'north') corners(b, base, trim, W, D, 0.3, H);
  doorAt(b, f, 0, { w: 1.3, h: 2.5, y0: 0.3, color: p.door, frame: trim });
  for (const i of [0, 1, 3, 4]) windowAt(b, f, xs[i], levels[0], opts);
  const tower = o.tower > 0, yb = 0.3 + fh;
  if (o.veranda > 0) {
    if (s === 'south') { // лоджия: колоннада, сверху терраса с балюстрадой
      const lw = 7.2, dp = 2.4;
      box(b, f, p.stone, 0, 0, dp / 2, lw, 0.3, dp);
      for (const x of [-lw / 2 + 0.3, -lw / 6, lw / 6, lw / 2 - 0.3]) cyl(b, f, trim, x, 0.3, dp - 0.3, 0.17, 0.2, yb - 0.85, 8);
      box(b, f, trim, 0, yb - 0.55, dp / 2, lw, 0.41, dp);
      balcony(b, f, 0, lw, yb - 0.14, trim, trim, dp, { step: 0.36, t: 0.09 });
    } else if (s === 'north') {
      porch(b, f, { x0: -W / 2 + 0.2, x1: 1.6, dp: 2.2, h: 2.9, y: 0.4, deck: p.wood, post: trim, roof, railing: true, gap: 0 });
    } else { // вокруг фасада и бока +X
      porch(b, f, { x0: tower ? -W / 2 + 1.5 : -W / 2, x1: W / 2 + 2.4, dp: 2.4, h: 2.9, y: 0.4, deck: p.wood, post: trim, roof, railing: true, gap: 0 });
      porch(b, faceFrame(base, '+x', W / 2), { x0: -D / 2 + 0.05, x1: D / 2 - 1.5, dp: 2.4, h: 2.9, y: 0.4, deck: p.wood, post: trim, roof, railing: true });
    }
  }
  if (!tower) return;
  if (s === 'south') { // бельведер на коньке
    const th = rise + 2.4;
    box(b, base, wc, 0, H, 0, 3, th, 3);
    box(b, base, trim, 0, H + th - 0.25, 0, 3.4, 0.25, 3.4);
    hip(b, base, { w: 3, d: 3, y: H + th, h: 0.9, over: 0.35, roof });
    for (const face of ['+z', '-z', '+x', '-x']) windowAt(b, faceFrame(base, face, 1.5), 0, H + th - 1.2, { ...opts, shutter: undefined, ww: 0.7, wh: 1.1, sill: false });
    return;
  }
  // круглая башня на углу фасада: north — справа, восьмигранная со шпилем; atlantic — слева, конусная крыша
  const k = s === 'north' ? 1 : -1, tx = k * W / 2, tz = D / 2, r = 1.6, seg = 8, th = H + 1.6;
  cyl(b, base, wc, tx, 0, tz, r, r, th, seg, Math.PI / 8);
  cyl(b, base, trim, tx, th - 0.2, tz, r + 0.12, r + 0.12, 0.2, seg, Math.PI / 8);
  if (s === 'north') { spire(b, base, roof, tx, th, tz, r + 0.25, 3.6, 8); cyl(b, base, IRON, tx, th + 3.6, tz, 0.03, 0.05, 0.8, 4); }
  else b.add(new THREE.ConeGeometry(r + 0.3, 2.6, 12), roof, at(base, tx, th + 1.3, tz));
  const fr = at(base, tx, 0, tz, 1, 1, 1, 0, k * Math.PI / 4, 0).multiply(at(new THREE.Matrix4(), 0, 0, r * Math.cos(Math.PI / 8)));
  for (const y of [levels[0], levels[1], H + 0.8]) windowAt(b, fr, 0, y, { ...opts, shutter: undefined, ww: 0.6, wh: 1.0, sill: false });
}

export const HOUSES = {
  // A. Жильё
  hut: { name: 'Рыбацкая хижина', category: 'housing', styles: true, footprint: { w: 4.5, d: 4 }, build: hut },
  cottage: { name: 'Дом', category: 'housing', styles: true, footprint: { w: 11, d: 8 }, build: cottage },
  townhouse: { name: 'Городской дом', category: 'housing', styles: true, footprint: { w: 6.5, d: 9 }, build: townhouse },
  shophouse: { name: 'Дом с лавкой', category: 'housing', styles: true, footprint: { w: 6.5, d: 12 }, build: shophouse },
  tenement: { name: 'Доходный дом', category: 'housing', styles: true, footprint: { w: 11, d: 12.5 },
    params: { floors: { min: 3, max: 4, value: 3, label: 'этажей' } }, build: tenement },
  villa: { name: 'Особняк', category: 'housing', styles: true, footprint: { w: 15.5, d: 13 },
    params: { tower: { min: 0, max: 1, value: 1, label: 'башня' }, veranda: { min: 0, max: 1, value: 1, label: 'веранда' } }, build: villa },
  // вариант 1 уходит на −X на ≈7 м: крытый переход и маяк
  'keeper-house': { name: 'Дом смотрителя', category: 'housing', styles: true, variants: 2, footprint: { w: 8, d: 8 }, build: keeperHouse },
  lighthouse: { name: 'Маяк', category: 'housing', styles: true, footprint: { w: 4, d: 4 }, build: lighthouse },
};
