import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

// Моряк-рулевой (references/chars/saillor_reference): 4 части — голова (лицо, шапка), тело-бушлат, две руки-сферы.
// Гладкий рендер без контура. Локальная СК: лицом к +Z, вверх +Y, начало — на сиденье под центром тела.
// Размеры сняты с развёртки (файл «sailor sitting.jpg»), от сиденья до макушки шапки ≈ 1 м.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });

// тельняшка: широкие синие и белые полосы; uv.y — высота в метрах (см. surfacePatch)
function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 4, 64);
  g.fillStyle = '#2b3a78'; g.fillRect(0, 0, 4, 30);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1 / 0.045); // период полосы 4.5 см: в вырезе видно 4–5 полос
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAT = {
  skin: smooth(0xe8b48a),
  coat: smooth(0x343e5a, { roughness: 0.9 }),
  lapel: smooth(0x3a4565, { roughness: 0.85 }),
  shirt: smooth(0xffffff, { map: stripeTexture(), roughness: 0.9 }),
  brass: smooth(0xa88a45, { metalness: 0.5, roughness: 0.45 }),
  wool: smooth(0xd8352c, { roughness: 0.95 }),
  eye: smooth(0x141414, { roughness: 0.4 }),
  trim: smooth(0xf2efe6, { roughness: 0.9 }),
};

// Тело — «сплющенная капля», не тело вращения. В анфас профиль BODY_FRONT [полуширина, y]: плечи заметно уже низа,
// самое широкое место у живота, к дну чуть сужается. Глубина задаётся долями от полуширины отдельно для переда
// и спины (K_FRONT, K_BACK): грудь полого опускается к животу, спина почти прямая. Пузо — на середине высоты.
const BODY_FRONT = new THREE.SplineCurve([
  [0.0, 0.0], [0.15, 0.0], [0.19, 0.012], [0.205, 0.05], [0.218, 0.12], [0.225, 0.22], [0.222, 0.28],
  [0.205, 0.35], [0.18, 0.405], [0.14, 0.448], [0.075, 0.472], [0.0, 0.478],
].map(([r, y]) => new THREE.Vector2(r, y))).getPoints(32);
const K_FRONT = [[0, 0.82], [0.12, 0.86], [0.24, 0.9], [0.32, 0.78], [0.4, 0.62], [0.48, 0.7]];
const K_BACK = [[0, 0.95], [0.24, 0.92], [0.48, 1.0]];
const table = (T, y) => {
  if (y <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (T[i][0] >= y) { const [y0, k0] = T[i - 1], [y1, k1] = T[i]; return k0 + (k1 - k0) * (y - y0) / (y1 - y0); }
  return T[T.length - 1][1];
};
const depthK = (y, front) => table(front ? K_FRONT : K_BACK, y);
// полуширина тела на высоте y (наружная часть профиля монотонна по y)
function bodyW(y) {
  const P = BODY_FRONT;
  for (let i = 1; i < P.length; i++) {
    if (P[i].y >= y) { const a = P[i - 1], b = P[i]; return a.x + (b.x - a.x) * (y - a.y) / Math.max(1e-6, b.y - a.y); }
  }
  return 0;
}
// сжимает тело вращения в «каплю»: z умножается на долю глубины переда или спины
function toDrop(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setZ(i, z * depthK(p.getY(i), z > 0)); }
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  geo.computeVertexNormals();
  return geo;
}
// точка на поверхности тела (угол th от середины груди, высота y) с отступом off по нормали сечения
function bodyPoint(th, y, off, out = V()) {
  const W = bodyW(y), k = depthK(y, Math.cos(th) > 0);
  const nx = Math.sin(th) * k, nz = Math.cos(th), nl = Math.hypot(nx, nz);
  return out.set(W * Math.sin(th) + off * nx / nl, y, W * k * Math.cos(th) + off * nz / nl);
}

// Накладка на поверхность тела: контур [s, y] (s — длина дуги от середины груди, y — высота) выдавливается
// на толщину t и «обтягивается» по телу с отступом off. uv лицевой грани = (s, y) в метрах.
function surfacePatch(poly, off, t) {
  const shape = new THREE.Shape(poly.map(([s, y]) => new THREE.Vector2(s, y)));
  let geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo = new TessellateModifier(0.012, 8).modify(geo);
  const p = geo.attributes.position, q = V();
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i), y = p.getY(i), w = p.getZ(i);
    const R = bodyW(y) * (1 + depthK(y, true)) / 2; // радиус дуги спереди
    bodyPoint(s / Math.max(0.05, R), y, off + w, q);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  geo.computeVertexNormals();
  return geo;
}

// точка на сфере радиуса r по направлению d
const onSphere = (d, r) => d.clone().normalize().multiplyScalar(r);

export function createSailor() {
  const group = new THREE.Group();
  const add = (mesh, parent) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // ---- тело ----
  const body = new THREE.Group();
  group.add(body);
  add(new THREE.Mesh(toDrop(new THREE.LatheGeometry(BODY_FRONT, 48, Math.PI)), MAT.coat), body); // шов развёртки — на спине
  // V-вырез с тельняшкой
  add(new THREE.Mesh(surfacePatch([[0, 0.24], [0.08, 0.465], [-0.08, 0.465]], 0.002, 0.002), MAT.shirt), body);
  // лацканы с вырезом-«ступенькой», зеркально
  const LAPEL = [[0.004, 0.24], [0.072, 0.455], [0.12, 0.44], [0.15, 0.39], [0.115, 0.375], [0.14, 0.35], [0.055, 0.215]];
  for (const sx of [1, -1]) {
    const poly = LAPEL.map(([s, y]) => [s * sx, y]);
    if (sx < 0) poly.reverse();
    add(new THREE.Mesh(surfacePatch(poly, 0.003, 0.018), MAT.lapel), body);
  }
  // воротник сзади: полоса вокруг шеи
  const collar = new THREE.LatheGeometry([[0.13, 0.425], [0.152, 0.44], [0.135, 0.468], [0.1, 0.48]].map(([r, y]) => new THREE.Vector2(r, y)), 32, 0.95, 2 * Math.PI - 1.9);
  add(new THREE.Mesh(toDrop(collar), MAT.coat), body);
  // круглый ворот тельняшки: над ним в вырезе видна кожа (шея и грудь), по краю — белая окантовка
  const arc = (r, depth, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI; return [r * Math.cos(a), 0.472 - depth * Math.sin(a)]; });
  add(new THREE.Mesh(surfacePatch(arc(0.07, 0.042), 0.0045, 0.001), MAT.skin), body);
  add(new THREE.Mesh(surfacePatch([...arc(0.082, 0.052), ...arc(0.07, 0.042).reverse()], 0.0045, 0.003), MAT.trim), body);
  // шея
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 32, 1, true), MAT.skin), body).position.y = 0.475;
  // кромка запаха двубортного бушлата от выреза вниз
  add(new THREE.Mesh(surfacePatch([[0.02, 0.012], [0.032, 0.012], [0.032, 0.205], [0.02, 0.215]], 0.002, 0.007), MAT.coat), body);
  // латунные пуговицы, два ряда
  const btnGeo = new THREE.SphereGeometry(0.016, 12, 8).scale(1, 1, 0.5);
  for (const s of [-0.045, 0.085]) {
    for (const y of [0.075, 0.15]) {
      const R = bodyW(y) * (1 + depthK(y, true)) / 2, th = s / R;
      const b = add(new THREE.Mesh(btnGeo, MAT.brass), body);
      bodyPoint(th, y, 0.004, b.position);
      b.lookAt(bodyPoint(th, y, 0.1));
    }
  }

  // ---- голова: шарнир у шеи, чтобы наклоны и повороты шли от основания; голова стоит на теле, не утоплена ----
  const head = new THREE.Group();
  head.position.y = 0.47;
  group.add(head);
  const HEAD_R = 0.197, HC = V(0, 0.18, 0); // центр шара относительно шарнира
  add(new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 40, 28), MAT.skin), head).position.copy(HC);
  // глаза-точки; моргание — scale.y
  const eyes = [-1, 1].map((sx) => {
    const d = V(0.36 * sx, 0.04, 0.93);
    const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8).scale(1, 1.15, 0.45), MAT.eye), head);
    e.position.copy(HC).add(onSphere(d, HEAD_R + 0.001));
    e.lookAt(e.position.clone().add(d));
    return e;
  });
  // шапка: купол и толстый отворот в рубчик. Шарнир — точно в центре шара, поэтому при наклоне назад
  // (угол к горизонту) шапка по-прежнему плотно охватывает голову без смещения.
  // Внутренний радиус отворота равен сечению головы на высоте его нижней кромки: CUFF_R = √(R² − CUFF_LO²).
  const hat = new THREE.Group();
  hat.position.copy(HC);
  hat.rotation.x = -0.17;
  head.add(hat);
  const CUFF_LO = 0.03, CUFF_HI = 0.16, CUFF_T = 0.028, CUFF_R = Math.sqrt(HEAD_R ** 2 - CUFF_LO ** 2);
  const domePts = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; domePts.push(new THREE.Vector2((CUFF_R + 0.012) * Math.cos(a), CUFF_HI - 0.01 + 0.15 * Math.sin(a))); }
  add(new THREE.Mesh(new THREE.LatheGeometry(domePts, 40), MAT.wool), hat);
  // профиль отворота — скруглённый валик; шов развёртки уводим назад (phiStart = π)
  const cuffPts = [];
  for (let i = 0; i <= 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * Math.PI;
    cuffPts.push(new THREE.Vector2(CUFF_R + CUFF_T * Math.cos(a) ** 0.6, (CUFF_LO + CUFF_HI) / 2 + (CUFF_HI - CUFF_LO) / 2 * Math.sin(a)));
  }
  let cuffGeo = new THREE.LatheGeometry(cuffPts, 168, Math.PI);
  {
    const p = cuffGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
      const k = 1 + (r - CUFF_R) / r * 0.9 * (0.5 + 0.5 * Math.cos(Math.atan2(x, z) * 28)) * 0.35; // 28 рубчиков, глубже на внешней стороне
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    cuffGeo.deleteAttribute('normal'); cuffGeo.deleteAttribute('uv');
    cuffGeo = mergeVertices(cuffGeo);
    cuffGeo.computeVertexNormals();
  }
  add(new THREE.Mesh(cuffGeo, MAT.wool), hat);

  // ---- руки: сферы, висят у боков ----
  const hands = [-1, 1].map((sx) => {
    const h = add(new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 16), MAT.skin), group);
    h.position.set(0.32 * sx, 0.16, 0.02);
    return h;
  });

  // ---- состояние ----
  const eye = V();
  function eyeWorld(target) {
    eye.set(0, 0.2, 0.1);
    head.localToWorld(eye);
    return target ? target.copy(eye) : eye.clone();
  }

  // ctx: { look: { yaw, pitch } (рад), blink (0 — открыты, 1 — закрыты) }
  function update(dt, ctx = {}) {
    const look = ctx.look || { yaw: 0, pitch: 0 };
    head.rotation.set(-look.pitch, look.yaw, 0, 'YXZ');
    const b = 1 - 0.88 * (ctx.blink || 0);
    for (const e of eyes) e.scale.y = b;
  }

  return { group, head, body, hands, eyes, update, eyeWorld };
}
