import * as THREE from 'three';
import { jitterColor, mat } from '../flora.js';
import {
  palette, pick, at, box, cyl, beam, gable, hip, spire, arcade, faceFrame, windowAt, windowRow, doorAt, glow,
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

// Вывеска на кронштейне у грани f: штанга на высоте y, щит поперёк стены, эмблема
function hangSign(b, f, x, y, sign) {
  box(b, f, IRON, x, y, 0.55, 0.05, 0.05, 1.1);
  beam(b, f, IRON, [x, y - 0.45, 0.02], [x, y, 0.8], 0.04, 0.04);
  box(b, f, sign, x, y - 0.6, 0.75, 0.05, 0.55, 0.7);
  box(b, f, 0xc9a24a, x, y - 0.5, 0.75, 0.07, 0.3, 0.4);
}

// Корпус городского дома: цоколь, стены по стилю, пояски, карниз, крыша, окна верхних этажей фасада, боков и тыла.
// roofKind: 'hip' | 'gableX' (конёк вдоль фасада) | 'gableZ' (фронтон на улицу) | 'flat'.
// Первый этаж фасада (+Z) — у вызывающего: возвращаются уровни окон levels и оси xs.
// clad: false — без обшивки на атлантике (каменные здания).
function body(b, base, o, rng, { W, D, floors, cols, roofKind, rise = 2, fh = 3.1, sideCols = 2, wall, shutters = true, clad = true }) {
  const s = o.style ?? 'atlantic', p = palette(s), H = 0.3 + floors * fh, trim = p.trim;
  wall = jitterColor(wall ?? (s === 'north' ? pick([p.brick, 0x8a3e2e, 0xa8584a], rng)
    : s === 'atlantic' ? pick([0xf4f1e8, 0xe6dcc3, 0x8e9aa0, 0xa8a49a], rng) : pick(p.wall, rng)), rng, 0.4);
  const roof = s === 'north' ? pick([p.roof[0], p.roof[2]], rng) : pick(p.roof, rng);
  box(b, base, p.stone, 0, 0, 0, W + 0.12, 0.3, D + 0.12);
  box(b, base, wall, 0, 0.3, 0, W, H - 0.3, D);
  if (s === 'atlantic' && clad) { siding(b, base, wall, rng, 0, 0, W, D, 0.3, H, H > 8 ? 0.45 : 0.34); corners(b, base, trim, W, D, 0.3, H); }
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
    hangSign(b, f, -W / 2 + 0.35, 3.55, sign);
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

// --- B. Общественные здания: общие детали ------------------------------------

const BELL = 0x8a6a3a, GOLD = 0xc9a24a, DARK = 0x1f1f22, CRATE = 0x9a7a52, POST = 0x8f7a62;
const FACES = ['+z', '-z', '+x', '-x'];
const FLAG = [0x2f5fa8, 0xc23b2e, 0x2f6f4a, 0x5a2f6a, 0xf4f1e8, 0xf2c14e];

// Диск в плоскости грани f (ось — по Z грани): центр (x, y), толщина t на удалении z; half — верхняя половина
function disc(b, f, color, x, y, z, r, { t = 0.04, seg = 6, half = false } = {}) {
  const g = half ? new THREE.CylinderGeometry(r, r, t, seg, 1, false, Math.PI / 2, Math.PI) : new THREE.CylinderGeometry(r, r, t, seg);
  b.add(g, color, f.clone().multiply(mat(x, y, z, 1, 1, 1, Math.PI / 2, 0, 0)));
}

// Арочное окно на грани f: прямоугольник ww×wh с центром (x, y), сверху полукруг
function archWindow(b, f, x, y, { ww = 0.8, wh = 1.4, frame = 0xffffff, glass = 0x2e3d48, sill = true, seg = 5 } = {}) {
  const top = y + wh / 2;
  box(b, f, frame, x, y - wh / 2 - 0.08, 0.03, ww + 0.16, wh + 0.08, 0.06);
  box(b, f, glass, x, y - wh / 2, 0.05, ww, wh, 0.04);
  disc(b, f, frame, x, top, 0.03, ww / 2 + 0.08, { t: 0.06, seg, half: true });
  disc(b, f, glass, x, top, 0.05, ww / 2, { seg, half: true });
  if (sill) box(b, f, frame, x, y - wh / 2 - 0.16, 0.07, ww + 0.3, 0.06, 0.14);
}

// Арочная дверь на грани f: низ на y0, прямоугольная часть высотой h
function archDoor(b, f, x, y0, w, h, color, frame) {
  doorAt(b, f, x, { w, h, y0, color, frame });
  disc(b, f, frame, x, y0 + h, 0.03, w / 2 + 0.09, { t: 0.06, half: true });
  disc(b, f, color, x, y0 + h, 0.06, w / 2, { t: 0.05, half: true });
}

// Круглое окно (окулюс) на грани f
function oculus(b, f, x, y, r, frame, glass) {
  disc(b, f, frame, x, y, 0.03, r + 0.1, { t: 0.06, seg: 10 });
  disc(b, f, glass, x, y, 0.06, r, { seg: 10 });
}

// Тёмный арочный проём звона на грани f: низ на y0
function louver(b, f, x, y0, w, h) {
  box(b, f, DARK, x, y0, 0.02, w, h, 0.04);
  disc(b, f, DARK, x, y0 + h, 0.02, w / 2, { half: true, seg: 5 });
}

// Циферблат на грани f: обод, диск, стрелки
function clockFace(b, f, x, y, r) {
  disc(b, f, IRON, x, y, 0.03, r + 0.07, { t: 0.06, seg: 12 });
  disc(b, f, 0xf4f1e8, x, y, 0.07, r, { seg: 12 });
  box(b, f, IRON, x, y, 0.1, 0.05, r * 0.8, 0.02);
  beam(b, f, IRON, [x, y, 0.1], [x + r * 0.5, y - r * 0.25, 0.1], 0.06, 0.02);
}

// Колокол: юбка-конус и маковка, низ на y
function bell(b, base, x, y, z, r = 0.3) {
  cyl(b, base, BELL, x, y, z, r * 0.55, r, r * 1.1, 8);
  b.add(new THREE.SphereGeometry(r * 0.55, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), BELL, at(base, x, y + r * 1.1, z));
}

// Крест высотой h, низ на y
function cross(b, base, color, x, y, z, h = 0.8) {
  box(b, base, color, x, y, z, 0.07, h, 0.07);
  box(b, base, color, x, y + h * 0.62, z, h * 0.5, 0.07, 0.07);
}

// Флаг на мачте от y0 высотой h, полотнище к +X. Вымышленный: поле, крыж и кайма по seed.
function roofFlag(b, base, x, y0, z, h, rng) {
  cyl(b, base, 0xf4f1e8, x, y0, z, 0.03, 0.05, h, 6);
  b.add(new THREE.SphereGeometry(0.07, 6, 4), GOLD, at(base, x, y0 + h + 0.05, z));
  const field = pick(FLAG, rng), canton = pick(FLAG.filter((c) => c !== field), rng), fw = 1.1, fh = 0.7, fx = x + 0.04 + fw / 2, fy = y0 + h - fh - 0.1;
  box(b, base, field, fx, fy, z, fw, fh, 0.02);
  box(b, base, canton, x + 0.04 + fw * 0.2, fy + fh * 0.5, z, fw * 0.4, fh * 0.45, 0.03);
  box(b, base, canton, fx, fy, z, fw, fh * 0.1, 0.03);
}

// Открытый ярус звонницы: квадрат w, стойки по углам высотой h от y, колокол, плита сверху
function belfry(b, base, x, z, y, w, h, color) {
  for (const i of [-1, 1]) for (const k of [-1, 1]) box(b, base, color, x + i * (w / 2 - 0.08), y, z + k * (w / 2 - 0.08), 0.16, h, 0.16);
  box(b, base, color, x, y + h, z, w + 0.2, 0.12, w + 0.2);
  bell(b, base, x, y + h - 0.75, z, 0.28);
}

// Столик с двумя табуретами: центр (x, z), низ на y
function cafeTable(b, base, x, y, z, wood) {
  cyl(b, base, wood, x, y + 0.72, z, 0.42, 0.42, 0.05, 8);
  cyl(b, base, IRON, x, y, z, 0.05, 0.05, 0.72, 4);
  for (const k of [-1, 1]) box(b, base, wood, x + k * 0.68, y, z, 0.34, 0.45, 0.34);
}

// Бочка с обручем, низ на y
function barrel(b, base, x, y, z) {
  cyl(b, base, BARREL, x, y, z, 0.27, 0.27, 0.8, 8);
  cyl(b, base, IRON, x, y + 0.58, z, 0.29, 0.29, 0.06, 8);
}

// --- B. Общественные здания ---------------------------------------------------

// Часовня 5×8, вход к +Z. south — белёная, звонница-стенка над фасадом, окулюс; north — деревянная,
// притвор, шатровая башенка на коньке; atlantic — белая обшивка, звонница со шпилем над входом.
function chapel(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), W = 5, D = 8, hw = W / 2, hd = D / 2, trim = p.trim;
  const { H, rise } = { south: { H: 4.4, rise: 1.6 }, north: { H: 3.6, rise: 3.6 }, atlantic: { H: 4.2, rise: 2.8 } }[s];
  const wall = jitterColor(s === 'north' ? pick([p.wall[0], 0x4a3a2e], rng) : 0xf4f1e8, rng, 0.3);
  const roof = s === 'north' ? pick([p.roof[0], 0x4a3a2e], rng) : pick(p.roof, rng);
  const f = faceFrame(base, '+z', hd);
  box(b, base, p.stone, 0, 0, 0, W + 0.12, 0.35, D + 0.12);
  box(b, base, wall, 0, 0.35, 0, W, H - 0.35, D);
  if (s === 'atlantic') siding(b, base, wall, rng, 0, 0, W, D, 0.35, H, 0.34);
  if (s !== 'south') corners(b, base, trim, W, D, 0.35, H);
  gable(b, base, { w: D, d: W, y: H, h: rise, over: 0.3, roof, wall, ry: Math.PI / 2 });
  const wo = { ww: 0.6, wh: s === 'north' ? 0.9 : 1.4, frame: trim, glass: p.glass };
  for (const face of ['+x', '-x']) for (const z of [-2.4, 0, 2.4]) {
    const fs = faceFrame(base, face, hw, 0, z);
    if (s === 'north') windowAt(b, fs, 0, 2.0, { ...wo, mullion: false }); else archWindow(b, fs, 0, 2.1, wo);
  }
  if (s === 'south') {
    archDoor(b, f, 0, 0.35, 1.2, 2.2, p.door, trim);
    oculus(b, f, 0, H + 0.55, 0.34, trim, p.glass);
    const y = H + rise - 0.7, ew = 2.4; // звонница: основание, два столба, перемычка, фронтончик
    box(b, f, wall, 0, y, 0, ew, 1.0, 0.5);
    for (const k of [-1, 1]) box(b, f, wall, k * (ew / 2 - 0.3), y + 1.0, 0, 0.6, 1.3, 0.5);
    box(b, f, wall, 0, y + 2.3, 0, ew, 0.3, 0.5);
    gable(b, f, { w: 0.5, d: ew, y: y + 2.6, h: 0.5, over: 0.06, t: 0.06, roof: trim, wall, ry: Math.PI / 2 });
    box(b, f, p.wood, 0, y + 2.05, 0, ew - 1.2, 0.1, 0.1);
    bell(b, f, 0, y + 1.5, 0, 0.32);
    cross(b, f, IRON, 0, y + 3.1, 0, 0.7);
  } else if (s === 'north') {
    const pz = hd + 0.8; // притвор
    box(b, base, wall, 0, 0, pz, 2.2, 2.4, 1.6);
    gable(b, base, { z: pz, w: 1.6, d: 2.2, y: 2.4, h: 1.1, over: 0.2, roof, wall, ry: Math.PI / 2 });
    doorAt(b, faceFrame(base, '+z', hd + 1.6), 0, { w: 0.95, h: 1.9, color: p.door, frame: trim });
    windowAt(b, f, 0, H + 1.0, { ...wo, ww: 0.5, wh: 0.7, sill: false, mullion: false });
    const tz = hd - 1.0, ty = H + rise - 1.3, tw = 1.5, th = 1.8; // башенка на коньке
    box(b, base, wall, 0, ty, tz, tw, th, tw);
    for (const face of FACES) box(b, faceFrame(base, face, tw / 2, 0, tz), DARK, 0, ty + th - 1.0, 0.01, 0.6, 0.7, 0.04);
    spire(b, base, roof, 0, ty + th, tz, 1.3, 2.4, 4);
    cross(b, base, IRON, 0, ty + th + 2.35, tz, 0.7);
  } else {
    doorAt(b, f, 0, { w: 1.2, h: 2.3, y0: 0.35, color: p.door, frame: trim });
    gable(b, f, { z: 0.12, w: 0.24, d: 1.7, y: 2.8, h: 0.45, over: 0.04, t: 0.05, roof: trim, wall: trim, ry: Math.PI / 2 });
    archWindow(b, f, 0, H + 0.7, { ...wo, ww: 0.5, wh: 0.6, sill: false });
    const tz = hd - 0.9, tw = 1.6, ty = H + rise - 1.2; // звонница: основание, открытый ярус, шпиль
    box(b, base, wall, 0, ty, tz, tw, 1.9, tw);
    box(b, base, trim, 0, ty + 1.9, tz, tw + 0.2, 0.15, tw + 0.2);
    belfry(b, base, 0, tz, ty + 2.05, 1.3, 1.1, trim);
    spire(b, base, trim, 0, ty + 3.27, tz, 0.95, 2.2, 8);
  }
}

// Церковь: неф 10×15 с апсидой; колокольня над входом (вар. 0) или справа у фасада (вар. 1).
// south — кампанила с пологим шатром, купол на барабане над алтарной частью; north — кирпич, контрфорсы,
// высокий восьмигранный шпиль с башенками по углам; atlantic — белая обшивка, звонница со шпилем, часы.
function church(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), W = 10, D = 15, zc = -0.5, hw = W / 2, side = o.variant === 1;
  const { H, rise } = { south: { H: 8, rise: 2.4 }, north: { H: 8, rise: 5.5 }, atlantic: { H: 7, rise: 4 } }[s];
  const wall = jitterColor(s === 'south' ? pick([0xefe3c8, 0xe8d9b8, p.stone], rng) : s === 'north' ? pick([p.brick, 0x8a3e2e], rng) : 0xf4f1e8, rng, 0.3);
  const roof = s === 'north' ? pick([p.roof[0], 0x3f4a4f], rng) : pick(p.roof, rng);
  const trim = s === 'north' ? p.stone : p.trim, zf = zc + D / 2, f = faceFrame(base, '+z', D / 2, 0, zc);
  box(b, base, p.stone, 0, 0, zc, W + 0.14, 0.4, D + 0.14);
  box(b, base, wall, 0, 0.4, zc, W, H - 0.4, D);
  if (s === 'atlantic') { siding(b, base, wall, rng, 0, zc, W, D, 0.4, H, 0.45); corners(b, at(base, 0, 0, zc), trim, W, D, 0.4, H, 0.2); }
  if (s === 'south') box(b, base, trim, 0, H - 0.35, zc, W + 0.3, 0.35, D + 0.3); // карниз
  gable(b, base, { z: zc, w: D, d: W, y: H, h: rise, over: 0.35, roof, wall, ry: Math.PI / 2 });
  // апсида: полуцилиндр к −Z, полуконус крыши
  const ar = 3, ah = H - 1.8, az = zc - D / 2, half = [1, false, Math.PI / 2, Math.PI];
  b.add(new THREE.CylinderGeometry(ar, ar, ah, 8, ...half), wall, at(base, 0, ah / 2, az));
  b.add(new THREE.CylinderGeometry(ar + 0.07, ar + 0.07, 0.4, 8, ...half), p.stone, at(base, 0, 0.2, az));
  b.add(new THREE.ConeGeometry(ar + 0.35, 1.6, 8, ...half), roof, at(base, 0, ah + 0.8, az));
  // окна нефа, у севера — контрфорсы между ними
  const wo = { ww: 1.0, wh: s === 'north' ? 3.2 : 2.6, frame: trim, glass: p.glass, sill: false };
  for (const face of ['+x', '-x']) for (const z of [-6.3, -3.3, -0.3, 2.7, 5.7]) {
    if (side && face === '+x' && z > 2) continue; // за колокольней
    archWindow(b, faceFrame(base, face, hw, 0, z), 0, H * 0.5, wo);
  }
  if (s === 'north') for (const k of [-1, 1]) for (const z of [-7.8, -4.8, -1.8, 1.2, 4.2]) {
    if (side && k > 0 && z > 2) continue;
    box(b, base, wall, k * (hw + 0.3), 0, z, 0.6, H - 1.6, 0.7);
    beam(b, base, p.stone, [k * (hw + 0.62), H - 1.6, z], [k * hw, H - 0.6, z], 0.76, 0.15); // слив
  }
  // фасад: при башне сбоку — портал и окулюс по центру
  if (side) {
    archDoor(b, f, 0, 0.4, 1.8, 2.8, p.door, trim);
    oculus(b, f, 0, H + rise * 0.3, 0.7, trim, p.glass);
  }
  for (const k of [-1, 1]) archWindow(b, f, k * 3.2, H * 0.5, { ...wo, ww: 0.8, wh: 2.0 });

  // колокольня
  const tw = s === 'north' ? 4 : 3.6, tx = side ? hw + 0.8 : 0, tz = side ? 4.5 : zf + tw / 2 - 0.2;
  const th = { south: 17, north: 14, atlantic: H + rise + 0.6 }[s];
  const ft = faceFrame(base, '+z', tw / 2, tx, tz);
  box(b, base, p.stone, tx, 0, tz, tw + 0.14, 0.4, tw + 0.14);
  box(b, base, wall, tx, 0.4, tz, tw, th - 0.4, tw);
  if (s === 'atlantic') { siding(b, base, wall, rng, tx, tz, tw, tw, 0.4, th, 0.45); corners(b, at(base, tx, 0, tz), trim, tw, tw, 0.4, th, 0.2); }
  if (side) archWindow(b, ft, 0, 2.4, { ...wo, ww: 0.6, wh: 1.4 });
  else archDoor(b, ft, 0, 0.4, 1.6, 2.6, p.door, trim);
  if (s !== 'atlantic') archWindow(b, ft, 0, 6.5, { ...wo, ww: 0.6, wh: 1.4 });
  if (s === 'atlantic') {
    clockFace(b, ft, 0, th - 1.1, 0.6);
    box(b, base, trim, tx, th, tz, tw + 0.3, 0.2, tw + 0.3);
    const y = th + 0.2, bw = tw - 0.8;
    box(b, base, wall, tx, y, tz, bw, 0.5, bw);
    belfry(b, base, tx, tz, y + 0.5, bw, 2.0, trim);
    spire(b, base, trim, tx, y + 2.62, tz, bw * 0.62, 6, 8);
    b.add(new THREE.SphereGeometry(0.1, 6, 4), GOLD, at(base, tx, y + 8.7, tz));
    return;
  }
  const yb = th - 3.4; // ярус звона
  box(b, base, trim, tx, yb - 0.4, tz, tw + 0.16, 0.2, tw + 0.16);
  for (const face of FACES) {
    const fr = faceFrame(base, face, tw / 2, tx, tz);
    for (const x of s === 'south' ? [-0.7, 0.7] : [0]) louver(b, fr, x, yb, s === 'south' ? 0.8 : 1.2, 2.0);
  }
  clockFace(b, ft, 0, yb - 1.4, 0.7);
  box(b, base, trim, tx, th - 0.3, tz, tw + 0.3, 0.3, tw + 0.3); // карниз
  if (s === 'north') {
    spire(b, base, roof, tx, th, tz, tw * 0.62, 9, 8);
    for (const i of [-1, 1]) for (const k of [-1, 1]) spire(b, base, roof, tx + i * (tw / 2 - 0.25), th, tz + k * (tw / 2 - 0.25), 0.35, 1.6, 4);
    b.add(new THREE.SphereGeometry(0.15, 6, 4), GOLD, at(base, tx, th + 9, tz));
    cross(b, base, GOLD, tx, th + 9.1, tz, 0.9);
    return;
  }
  // south: шатёр кампанилы и купол на барабане
  spire(b, base, roof, tx, th, tz, tw / Math.SQRT2 + 0.35, 1.6, 4);
  cross(b, base, IRON, tx, th + 1.55, tz);
  const dz = zc - D / 2 + 3.5, dy = H + rise - 1.2, dr = 2.2, apo = dr * Math.cos(Math.PI / 8);
  cyl(b, base, wall, 0, dy, dz, dr, dr, 2.2, 8, Math.PI / 8);
  cyl(b, base, trim, 0, dy + 2.2, dz, dr + 0.15, dr + 0.15, 0.2, 8, Math.PI / 8);
  for (const face of FACES) windowAt(b, faceFrame(base, face, apo, 0, dz), 0, dy + 1.4, { ww: 0.5, wh: 0.8, frame: trim, glass: p.glass, sill: false });
  b.add(new THREE.SphereGeometry(dr, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), roof, at(base, 0, dy + 2.4, dz));
  cyl(b, base, trim, 0, dy + 2.4 + dr - 0.1, dz, 0.4, 0.4, 0.7, 6);
  spire(b, base, roof, 0, dy + 3.0 + dr, dz, 0.55, 0.5, 6);
  cross(b, base, IRON, 0, dy + 3.45 + dr, dz, 0.7);
}

// Ратуша 14×10, 2 эт. south — аркада внизу, терраса с балюстрадой, башенка с часами; north — кирпич,
// ризалит со ступенчатым фронтоном и часами; atlantic — портик с колоннами и фронтоном, фонарь-купол на коньке.
// params: clock, flag.
function townHall(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 14, fh = 3.6;
  if (s === 'south') {
    const D = 7.6, bb = at(base, 0, 0, -1.2), rise = 2.2, dp = 2.4, yT = 0.3 + fh;
    const { p, f, H, wall, roof, trim, levels, opts, xs } = body(b, bb, o, rng, { W, D, floors: 2, cols: 5, fh, rise, roofKind: 'hip', sideCols: 3 });
    archDoor(b, f, 0, 0.3, 1.4, 2.4, p.door, trim);
    for (const i of [0, 1, 3, 4]) windowAt(b, f, xs[i], levels[0], opts);
    box(b, f, p.stone, 0, 0, dp / 2, W, 0.3, dp);
    arcade(b, f, wall, { x0: -W / 2, x1: W / 2, n: 5, yS: 2.5, yT, z: dp, y0: 0.3 });
    const sd = dp - 0.5; // торцы галереи: по арке от стены до лицевой аркады
    for (const k of [-1, 1]) arcade(b, at(f, k * W / 2, 0, sd / 2, 1, 1, 1, 0, k * Math.PI / 2, 0), wall,
      { x0: -sd / 2, x1: sd / 2, n: 1, yS: 2.3, yT, z: 0, pw: 0.4, y0: 0.3 });
    balcony(b, f, 0, W, yT, trim, trim, dp, { step: 0.6, t: 0.09 });
    // башенка с часами на коньке
    const tw = 2.6, tT = H + rise + 2.8, fT = faceFrame(bb, '+z', tw / 2);
    box(b, bb, wall, 0, H, 0, tw, tT - H, tw);
    for (const face of FACES) louver(b, faceFrame(bb, face, tw / 2), 0, H + rise + 1.0, 0.9, 1.0);
    if (o.clock > 0) clockFace(b, fT, 0, H + rise + 0.25, 0.55);
    box(b, bb, trim, 0, tT, 0, tw + 0.3, 0.25, tw + 0.3);
    hip(b, bb, { w: tw, d: tw, y: tT + 0.25, h: 0.9, over: 0.3, roof });
    if (o.flag > 0) roofFlag(b, bb, 0, tT + 1.1, 0, 2.6, rng);
    return;
  }
  if (s === 'north') {
    const D = 10, rise = 4.5, rw = 5, rd = 0.8;
    const { p, f, H, wall, roof, trim, levels, opts, xs } = body(b, base, o, rng, { W, D, floors: 2, cols: 6, fh, rise, roofKind: 'gableX', sideCols: 3 });
    const fr = at(f, 0, 0, rd); // ризалит
    box(b, f, p.stone, 0, 0, rd / 2, rw + 0.12, 0.3, rd + 0.12);
    box(b, f, wall, 0, 0.3, rd / 2, rw, H - 0.3, rd);
    box(b, f, trim, 0, 0.3 + fh - 0.12, rd / 2, rw + 0.08, 0.14, rd + 0.08);
    gable(b, base, { z: (D / 2 + rd) / 2, w: D / 2 + rd, d: rw, y: H, h: rise, over: 0.2, roof, wall, ry: Math.PI / 2 });
    steppedGable(b, fr, rw, H, rise, wall);
    archDoor(b, fr, 0, 0.3, 1.4, 2.4, p.door, trim);
    for (const x of [-1.5, 0, 1.5]) windowAt(b, fr, x, levels[1], opts);
    for (const x of xs) if (Math.abs(x) > rw / 2) windowAt(b, f, x, levels[0], opts);
    if (o.clock > 0) clockFace(b, at(fr, 0, 0, 0.25), 0, H + 1.6, 0.6);
    if (o.flag > 0) roofFlag(b, fr, 0, H + rise + 0.8, 0.05, 2.4, rng);
    return;
  }
  // atlantic
  const D = 9, bb = at(base, 0, 0, -0.5), rise = 3, dp = 2.6, pw = 9;
  const { p, f, H, roof, trim, levels, opts, xs } = body(b, bb, o, rng, { W, D, floors: 2, cols: 5, fh, rise, roofKind: 'gableX', sideCols: 3, wall: 0xf4f1e8 });
  doorAt(b, f, 0, { w: 1.4, h: 2.6, y0: 0.3, color: p.door, frame: trim });
  disc(b, f, p.glass, 0, 3.0, 0.05, 0.6, { half: true });
  for (const i of [0, 1, 3, 4]) windowAt(b, f, xs[i], levels[0], opts);
  box(b, f, p.stone, 0, 0, dp / 2, pw + 0.6, 0.3, dp + 0.2); // стилобат и ступень
  box(b, f, p.stone, 0, 0, dp + 0.45, 3, 0.15, 0.5);
  for (const x of [-4.2, -1.4, 1.4, 4.2]) cyl(b, f, trim, x, 0.3, dp - 0.35, 0.24, 0.28, H - 1.0, 10);
  box(b, f, trim, 0, H - 0.7, dp / 2 - 0.05, pw, 0.7, dp);
  gable(b, f, { z: 0.1, w: dp + 2.4, d: pw, y: H, h: 1.7, over: 0.2, roof, wall: trim, ry: Math.PI / 2 }); // фронтон уходит в скат
  oculus(b, at(f, 0, 0, dp + 0.05), 0, H + 0.6, 0.3, trim, p.glass);
  // фонарь-купол на коньке
  const cy = H + rise - 1.0, cw = 2.2;
  box(b, bb, trim, 0, cy, 0, cw, 2.2, cw);
  box(b, bb, trim, 0, cy + 2.2, 0, cw + 0.2, 0.15, cw + 0.2);
  if (o.clock > 0) for (const face of ['+z', '-z']) clockFace(b, faceFrame(bb, face, cw / 2), 0, cy + 1.4, 0.5);
  const ly = cy + 2.35;
  cyl(b, bb, DARK, 0, ly, 0, 0.62, 0.62, 1.2, 8);
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4; box(b, bb, trim, Math.sin(a) * 0.72, ly, Math.cos(a) * 0.72, 0.14, 1.2, 0.14); }
  cyl(b, bb, trim, 0, ly + 1.2, 0, 0.95, 0.95, 0.15, 8);
  b.add(new THREE.SphereGeometry(0.9, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), p.copper, at(bb, 0, ly + 1.35, 0));
  if (o.flag > 0) roofFlag(b, bb, 0, ly + 2.2, 0, 2.2, rng);
}

// Таможня 10×8, 2 эт., каменная у всех. south — известняк, вальмовая черепица, ставни; north — серый гранит,
// двускатная; atlantic — гранит, вальмовая сланцевая. Руст на углах, вывеска, флаг на наклонном флагштоке.
// Вар. 1 — навес вдоль фасада, под ним груз.
function customs(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 10, D = 8, fh = 3.3;
  const stone = jitterColor({ south: 0xe0d3b5, north: 0x8f8c86, atlantic: 0x9a9a92 }[s], rng, 0.3);
  const { p, f, roof, trim, levels, opts, xs } = body(b, base, o, rng, { W, D, floors: 2, cols: 5, fh, sideCols: 3, clad: false, wall: stone,
    rise: s === 'north' ? 3.4 : 2, roofKind: s === 'north' ? 'gableX' : 'hip', shutters: s === 'south' });
  archDoor(b, f, 0, 0.3, 1.3, 2.2, p.door, trim);
  box(b, f, p.stone, 0, 0, 0.4, 2.0, 0.15, 0.8);
  for (const i of [0, 1, 3, 4]) windowAt(b, f, xs[i], levels[0], opts);
  const q = new THREE.Color(stone).offsetHSL(0, 0, 0.07); // руст
  for (const k of [-1, 1]) for (let i = 0; i < 10; i++) {
    const wq = i % 2 ? 0.5 : 0.8;
    box(b, base, q, k * (W / 2 - wq / 2 + 0.03), 0.3 + i * 0.66, D / 2 - 0.22, wq, 0.58, 0.5);
  }
  const sign = pick([0x2f3f5f, 0x2f4f3f, 0x3a3a3a], rng);
  box(b, f, sign, 0, 3.66, 0.06, 4.6, 0.5, 0.08);
  for (let i = 0; i < 7; i++) box(b, f, GOLD, -1.8 + i * 0.6, 3.8, 0.11, 0.36, 0.22, 0.02);
  // наклонный флагшток над вывеской; полотнище висит под внешней половиной древка
  const fx = -1, A = [fx, 4.6, 0.05], B = [fx, 6.1, 1.5], P = (t, dy) => [fx, A[1] + (B[1] - A[1]) * t + dy, A[2] + (B[2] - A[2]) * t];
  beam(b, f, 0xf4f1e8, A, B, 0.05, 0.05);
  const field = pick(FLAG, rng), canton = pick(FLAG.filter((c) => c !== field), rng);
  beam(b, f, field, P(0.4, -0.4), P(1, -0.4), 0.02, 0.7);
  beam(b, f, canton, P(0.4, -0.22), P(0.7, -0.22), 0.03, 0.34);
  if (o.variant !== 1) return;
  porch(b, f, { x0: -W / 2 + 0.3, x1: W / 2 - 0.3, dp: 2.6, h: 2.9, y: 0.05, deck: p.stone, post: POST, roof });
  box(b, f, jitterColor(CRATE, rng), -3.2, 0.05, 1.3, 1.0, 0.8, 0.9);
  box(b, f, jitterColor(CRATE, rng), -3.1, 0.85, 1.3, 0.8, 0.6, 0.7);
  box(b, f, jitterColor(CRATE, rng), 3.1, 0.05, 1.5, 1.2, 0.7, 0.9);
  for (const [x, z] of [[2.0, 1.7], [1.4, 1.1]]) barrel(b, f, x, 0.05, z);
}

// Таверна 9×6, 2 эт.: вывеска на кронштейне, столики снаружи, бочки и фонарь у двери (светится).
// south — штукатурка, вальмовая крыша, пергола с лозой над столиками; north — фахверк; atlantic — обшивка.
// Вар. 0 — столики на земле, 1 — приподнятая терраса с перилами.
function tavern(b, base, o, rng) {
  const s = o.style ?? 'atlantic', W = 9, D = 6, fh = 3.0, bb = at(base, 0, 0, -1.2), timbered = s === 'north';
  const { p, f, roof, trim, levels, opts, xs } = body(b, bb, o, rng, { W, D, floors: 2, cols: 3, fh, sideCols: 2,
    rise: { south: 1.6, north: 3.8, atlantic: 3 }[s], roofKind: s === 'south' ? 'hip' : 'gableX', wall: timbered ? palette(s).plaster : undefined });
  const sign = pick([0x2f4f3f, 0x7a2e2a, 0x3a3a3a, 0x5a3a22], rng), terrace = o.variant === 1, dp = 2.6, ty = terrace ? 0.45 : 0;
  doorAt(b, f, xs[1], { w: 1.2, h: 2.3, y0: 0.3, color: p.door, frame: trim });
  for (const i of [0, 2]) windowAt(b, f, xs[i], levels[0], { ...opts, ww: 1.3, wh: 1.4 });
  if (timbered) { timber(b, f, W, 3, 0.3 + fh, p.timber, { door: 1 }); timber(b, at(f, 0, 0.3 + fh, 0), W, 3, fh, p.timber); }
  hangSign(b, f, -W / 2 + 0.35, s === 'south' ? 3.95 : 3.0, sign);
  for (const x of [-1.3, -1.9]) barrel(b, f, x, ty, 0.4);
  box(b, f, IRON, xs[1] + 0.95, 2.5, 0.15, 0.05, 0.05, 0.3); // фонарь у двери
  spire(b, f, IRON, xs[1] + 0.95, 2.45, 0.3, 0.2, 0.2, 4);
  const lamp = glow(f, new THREE.BoxGeometry(0.18, 0.28, 0.18), xs[1] + 0.95, 2.31, 0.3);
  const deck = s === 'south' ? p.stone : p.wood;
  if (terrace) {
    box(b, f, deck, 0, 0, dp / 2, W, ty, dp);
    rail(b, f, trim, -W / 2 + 0.1, xs[1] - 0.8, dp - 0.08, ty, { step: 0.5 });
    rail(b, f, trim, xs[1] + 0.8, W / 2 - 0.1, dp - 0.08, ty, { step: 0.5 });
    for (const k of [-1, 1]) rail(b, at(f, k * (W / 2 - 0.05), 0, 0, 1, 1, 1, 0, -Math.PI / 2, 0), trim, 0.05, dp - 0.1, 0, ty, { step: 0.5 });
    box(b, f, deck, xs[1], 0, dp + 0.25, 1.4, ty / 2, 0.5);
  }
  for (const x of [-3.0, 2.9]) cafeTable(b, f, x, ty, 1.4, p.wood);
  if (s === 'south') pergola(b, f, 0, W - 0.4, dp, 2.7, p.wood, rng);
  return { extras: [lamp] };
}

// Рыночный навес: n пролётов по 3 м, глубина 6. south — каменные столбы, черепица; north, atlantic — деревянные
// стойки с подкосами, дощатая кровля. Прилавки с ящиками товара (цвет по seed), бочки и корзины. params: bays.
const PRODUCE = [0xd9822b, 0xb8322a, 0x6f9f3a, 0xc9b48a, 0xa8b4bc, 0xe0c050];
function market(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), n = o.bays ?? 4, bw = 3, L = n * bw, D = 6, h = 3, pz = D / 2 - 0.2;
  const stone = s === 'south';
  const post = stone ? p.stone : jitterColor(POST, rng, 0.5);
  const roof = stone ? pick(p.roof, rng) : jitterColor(s === 'north' ? 0x6e5a44 : 0x8a8478, rng, 0.5);
  box(b, base, 0xb5ad9e, 0, 0, 0, L + 0.6, 0.12, D + 0.4);
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + i * bw;
    for (const k of [-1, 1]) {
      if (stone) { box(b, base, post, x, 0.12, k * pz, 0.45, h - 0.32, 0.45); box(b, base, p.trim, x, h - 0.2, k * pz, 0.6, 0.2, 0.6); continue; }
      box(b, base, post, x, 0.12, k * pz, 0.2, h - 0.12, 0.2);
      for (const j of [-1, 1]) if ((i > 0 || j > 0) && (i < n || j < 0)) beam(b, base, post, [x, h - 0.8, k * pz], [x + j * 0.7, h - 0.1, k * pz], 0.1, 0.1);
    }
    beam(b, base, post, [x, h, -pz], [x, h, pz], 0.16, 0.2); // затяжка
  }
  for (const k of [-1, 1]) box(b, base, post, 0, h - 0.11, k * pz, L + 0.3, 0.22, 0.22); // прогоны
  gable(b, base, { w: L, d: 2 * pz, y: h + 0.11, h: stone ? 1.4 : 1.2, over: 0.5, roof });
  for (let i = 0; i < n; i++) {
    const cx = -L / 2 + (i + 0.5) * bw;
    box(b, base, jitterColor(POST, rng, 0.8), cx, 0.12, 1.2, 2.2, 0.8, 0.8); // прилавок
    for (let j = 0; j < 3; j++) {
      const x = cx - 0.7 + j * 0.7;
      box(b, base, CRATE, x, 0.92, 1.2, 0.55, 0.15, 0.55);
      box(b, base, jitterColor(pick(PRODUCE, rng), rng), x, 1.07, 1.2, 0.45, 0.1, 0.45);
    }
    const bx = cx + (rng() - 0.5) * 1.6;
    if (rng() < 0.5) barrel(b, base, bx, 0.12, -1.3);
    else { cyl(b, base, 0xb59a62, bx, 0.12, -1.3, 0.32, 0.24, 0.4, 8); cyl(b, base, jitterColor(pick(PRODUCE, rng), rng), bx, 0.5, -1.3, 0.28, 0.28, 0.08, 8); }
  }
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
  // B. Общественные
  chapel: { name: 'Часовня', category: 'public', styles: true, footprint: { w: 6, d: 11.5 }, build: chapel },
  church: { name: 'Церковь', category: 'public', styles: true, variants: 2, footprint: { w: 16, d: 22.5 }, build: church },
  'town-hall': { name: 'Ратуша', category: 'public', styles: true, footprint: { w: 14.5, d: 14.5 },
    params: { clock: { min: 0, max: 1, value: 1, label: 'часы' }, flag: { min: 0, max: 1, value: 1, label: 'флаг' } }, build: townHall },
  customs: { name: 'Таможня', category: 'public', styles: true, variants: 2, footprint: { w: 10.5, d: 14 }, build: customs },
  tavern: { name: 'Таверна', category: 'public', styles: true, variants: 2, footprint: { w: 9.5, d: 10 }, build: tavern },
  market: { name: 'Рыночный навес', category: 'public', styles: true, footprint: { w: 13, d: 7 },
    params: { bays: { min: 2, max: 6, step: 1, value: 4, label: 'пролётов' } }, build: market },
};
