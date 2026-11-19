import * as THREE from 'three';
import { mat } from '../flora.js';

// Общие детали построек: коробки, крыши, окна, двери, сваи; палитры трёх стилей.
// Всё пишется в PropBatch (см. flora.js): base — матрица установки объекта, размеры — в метрах,
// СК объекта: фасад к +Z, начало — на земле в центре футпринта.

export const STYLES = ['south', 'north', 'atlantic'];

// south — Средиземноморье/Чёрное море, north — Балтика/Скандинавия, atlantic — Новая Англия
export const STYLE_PALETTES = {
  south: {
    wall: [0xefe3c8, 0xe8c79a, 0xf2d6c9, 0xf4f1e8], roof: [0xb8583b, 0xc46a45, 0xa94f36],
    trim: 0xf4f1e8, shutter: [0x4f8a5b, 0x5a8fb0, 0x6f9f8a], stone: 0xd9ccb0, wood: 0x8a5a3c,
    glass: 0x2e3d48, door: 0x6b4a30, metal: 0x3a3a3a, copper: 0x5f9a86,
  },
  north: {
    wall: [0x9e3b2c, 0xd9a441, 0xeee6d4], roof: [0x4a4f55, 0x8c3d2b, 0x5a5048],
    trim: 0xf4f1e8, shutter: [0x2f4a3a, 0x3d3a36], stone: 0x8f8c86, wood: 0x6e4a30,
    brick: 0x9c4a36, timber: 0x4a3424, plaster: 0xeee6d4,
    glass: 0x2b3a44, door: 0x3f4f3a, metal: 0x2e2e2e, copper: 0x5f9a86,
  },
  atlantic: {
    wall: [0xf4f1e8, 0xa8a49a, 0x8e9aa0, 0xe6dcc3], roof: [0x6b625a, 0x545454, 0x7a6e60],
    trim: 0xffffff, shutter: [0x2b2b2b, 0x2f4f3f], stone: 0x9a9a92, wood: 0x8a6a4c,
    glass: 0x2e3d48, door: 0x7a2e2a, metal: 0x2e2e2e, copper: 0x5f9a86,
  },
};
export const palette = (style) => STYLE_PALETTES[style] ?? STYLE_PALETTES.atlantic;
export const pick = (v, rng) => (Array.isArray(v) ? v[Math.floor(rng() * v.length)] : v);

// воспроизводимый rng по seed (тот же mulberry32, что в environment.js).
// seed сначала перемешивается: у голого mulberry32 первое число для seed 1..6 всегда > 0.5.
export function seeded(seed) {
  let a = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  a ^= a >>> 13;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
export const at = (base, ...m) => base.clone().multiply(mat(...m));

// коробка: центр по x/z, низ на y0
export function box(b, base, color, x, y0, z, w, h, d, ry = 0) {
  b.add(BOX, color, at(base, x, y0 + h / 2, z, w, h, d, 0, ry, 0));
}

// цилиндр/конус: низ на y0
export function cyl(b, base, color, x, y0, z, rTop, rBot, h, seg = 8, ry = 0) {
  b.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, at(base, x, y0 + h / 2, z, 1, 1, 1, 0, ry, 0));
}

// Геометрия из списка треугольников (тройки [x, y, z]); грани — против часовой снаружи.
export function triGeo(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  return g;
}

// Аркада на грани f: от x0 до x1, n пролётов, столбы шириной pw от y0 до yT, пяты арок на yS.
// Стенка толщиной t, лицевая плоскость на z. Пазухи над арками — треугольники (triGeo): веер от верхних углов пролёта.
export function arcade(b, f, color, { x0, x1, n, yS, yT, z, t = 0.5, pw = 0.6, y0 = 0, seg = 6 }) {
  const bw = (x1 - x0 - (n + 1) * pw) / n, r = bw / 2, zb = z - t, h = seg / 2, tris = [];
  for (let i = 0; i <= n; i++) box(b, f, color, x0 + pw / 2 + i * (bw + pw), y0, z - t / 2, pw, yT - y0, t);
  for (let i = 0; i < n; i++) {
    const cx = x0 + pw + r + i * (bw + pw);
    for (const k of [-1, 1]) { // левая и правая четверти дуги: от пяты к замку
      const arc = Array.from({ length: h + 1 }, (_, j) => { const a = (Math.PI / 2) * j / h; return [cx + k * r * Math.cos(a), yS + r * Math.sin(a)]; });
      const c = [cx + k * r, yT];
      const tri = (p0, p1, p2) => (k < 0
        ? tris.push([[...p0, z], [...p1, z], [...p2, z]], [[...p0, zb], [...p2, zb], [...p1, zb]])
        : tris.push([[...p0, z], [...p2, z], [...p1, z]], [[...p0, zb], [...p1, zb], [...p2, zb]]));
      for (let j = 0; j < h; j++) {
        tri(c, arc[j], arc[j + 1]);
        const A = [...arc[j], z], B = [...arc[j + 1], z], C = [...arc[j + 1], zb], D = [...arc[j], zb]; // свод проёма
        if (k < 0) tris.push([A, C, B], [A, D, C]); else tris.push([A, B, C], [A, C, D]);
      }
      tri(c, arc[h], [cx, yT]);
    }
  }
  b.add(triGeo(tris), color, f);
}

// Двускатная крыша: конёк вдоль X над прямоугольником w×d (стены до высоты y), подъём h.
// Скаты — доски толщиной t со свесом over; фронтоны (треугольники стен) цветом wall.
export function gable(b, base, { x = 0, z = 0, w, d, y, h, over = 0.35, t = 0.12, roof, wall, ry = 0 }) {
  const m0 = at(base, x, 0, z, 1, 1, 1, 0, ry, 0);
  const hd = d / 2, s = Math.hypot(hd, h), a = Math.atan2(h, hd);
  const S = s + over, ca = Math.cos(a), sa = Math.sin(a);
  for (const k of [1, -1]) {
    // середина ската: от конька вдоль ската на S/2, плюс полтолщины по нормали
    const cz = k * (hd / s) * S / 2 + k * sa * t / 2, cy = y + h - (h / s) * S / 2 + ca * t / 2;
    b.add(BOX, roof, m0.clone().multiply(mat(0, cy, cz, w + 2 * over, t, S, k * a, 0, 0)));
  }
  if (wall !== undefined) {
    const shape = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(hd, 0), new THREE.Vector2(0, h)]);
    const prism = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    b.add(prism, wall, m0.clone().multiply(mat(-w / 2, y, 0, 1, 1, 1, 0, Math.PI / 2, 0)));
  }
}

// Вальмовая крыша над w×d от высоты y, подъём h, свес over (конёк вдоль длинной стороны).
export function hip(b, base, { x = 0, z = 0, w, d, y, h, over = 0.35, roof, ry = 0 }) {
  const W = w / 2 + over, D = d / 2 + over;
  const long = W >= D, r = Math.abs(W - D); // половина длины конька
  const p0 = [-W, y, -D], p1 = [W, y, -D], p2 = [W, y, D], p3 = [-W, y, D];
  const ra = long ? [-r, y + h, 0] : [0, y + h, -r], rb = long ? [r, y + h, 0] : [0, y + h, r];
  const tris = long
    ? [[p3, p2, rb], [p3, rb, ra], [p1, p0, ra], [p1, ra, rb], [p2, p1, rb], [p0, p3, ra]]
    : [[p3, p2, rb], [p1, p0, ra], [p2, p1, ra], [p2, ra, rb], [p0, p3, rb], [p0, rb, ra]];
  b.add(triGeo(tris), roof, at(base, x, 0, z, 1, 1, 1, 0, ry, 0));
}

// Шатёр (пирамида) над квадратом/многоугольником: seg граней, радиус описанной окружности r.
export function spire(b, base, color, x, y0, z, r, h, seg = 4) {
  const rot = seg === 4 ? Math.PI / 4 : 0;
  b.add(new THREE.ConeGeometry(r, h, seg), color, at(base, x, y0 + h / 2, z, 1, 1, 1, 0, rot, 0));
}

// Матрица грани стены: face — '+z' | '-z' | '+x' | '-x', half — расстояние от центра до грани.
// В СК грани: X — вдоль стены (слева направо, если смотреть снаружи), Y — вверх, Z — наружу.
const FACE_RY = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };
export function faceFrame(base, face, half, cx = 0, cz = 0) {
  return at(base, cx, 0, cz, 1, 1, 1, 0, FACE_RY[face], 0).multiply(mat(0, 0, half));
}

// Окно на грани: рама чуть выступает, стекло — ещё чуть, ставни по бокам (если shutter задан).
// mullion: false — без импоста (дешёвые окна тыла и боков).
export function windowAt(b, f, x, y, { ww = 0.8, wh = 1.1, frame = 0xffffff, glass = 0x2e3d48, shutter, sill = true, mullion = true } = {}) {
  b.add(BOX, frame, f.clone().multiply(mat(x, y, 0.03, ww + 0.16, wh + 0.16, 0.06)));
  b.add(BOX, glass, f.clone().multiply(mat(x, y, 0.05, ww, wh, 0.04)));
  if (mullion) b.add(BOX, frame, f.clone().multiply(mat(x, y, 0.07, 0.05, wh, 0.02))); // импост
  if (sill) b.add(BOX, frame, f.clone().multiply(mat(x, y - wh / 2 - 0.1, 0.07, ww + 0.3, 0.06, 0.14)));
  if (shutter !== undefined) {
    for (const k of [-1, 1]) b.add(BOX, shutter, f.clone().multiply(mat(x + k * (ww / 2 + 0.08 + ww / 4), y, 0.05, ww / 2, wh + 0.1, 0.04)));
  }
}

// Ряды окон: cols по ширине стены span, по этажам с высотами levels (y центров окон).
export function windowRow(b, f, span, cols, levels, opts, skip = () => false) {
  for (let j = 0; j < levels.length; j++) {
    for (let i = 0; i < cols; i++) {
      if (skip(i, j)) continue;
      windowAt(b, f, (i + 0.5) * span / cols - span / 2, levels[j], opts);
    }
  }
}

// Дверь на грани: низ на y = 0
export function doorAt(b, f, x, { w = 1.0, h = 2.1, color = 0x6b4a30, frame = 0xffffff, y0 = 0 } = {}) {
  b.add(BOX, frame, f.clone().multiply(mat(x, y0 + h / 2 + 0.04, 0.03, w + 0.18, h + 0.1, 0.06)));
  b.add(BOX, color, f.clone().multiply(mat(x, y0 + h / 2, 0.06, w, h, 0.05)));
}

// Свая/столб: цилиндр от y0 до y1
export function pile(b, base, color, x, z, y0, y1, r = 0.15, seg = 6) {
  cyl(b, base, color, x, y0, z, r, r, y1 - y0, seg);
}

// Брус от точки p0 до p1 ([x, y, z] в СК объекта) сечением tw×th
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(), _m = new THREE.Matrix4();
export function beam(b, base, color, p0, p1, tw = 0.15, th = tw) {
  _a.set(...p0); _b.set(...p1);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return;
  const dir = _b.clone().sub(_a).normalize();
  _up.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.99) _up.set(1, 0, 0);
  // lookAt: локальная +Z — вдоль бруса
  _m.lookAt(_a, _b, _up).setPosition(_a.add(_b).multiplyScalar(0.5));
  b.add(BOX, color, base.clone().multiply(_m).multiply(mat(0, 0, 0, tw, th, len)));
}

// Светящаяся деталь (фонарь маяка, огонь на пирсе): отдельный меш с emissive, в СК батча (base уже применена).
const GLOW_MATS = new Map();
export function glow(base, geo, x, y, z, color = 0xfff3b0, emissive = 0xffd36b) {
  const key = `${color}|${emissive}`;
  if (!GLOW_MATS.has(key)) GLOW_MATS.set(key, new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.9 }));
  const m = new THREE.Mesh(geo, GLOW_MATS.get(key));
  m.applyMatrix4(at(base, x, y, z));
  m.castShadow = true;
  return m;
}
