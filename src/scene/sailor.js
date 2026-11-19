import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeStatic } from './merge-static.js';

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

// общий масштаб модели: геометрия ниже задана для R = 0.197, в игре моряк на 10 % крупнее
export const SAILOR_SCALE = 1.1;
// досягаемость руки от «плеча», в единицах модели (до масштаба)
export const SAILOR_REACH = 0.75;
const REACH = SAILOR_REACH;

// точка на сфере радиуса r по направлению d
const onSphere = (d, r) => d.clone().normalize().multiplyScalar(r);

// детерминированный генератор случайных чисел (mulberry32): одинаковые кадры на стенде при одном seed
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// цели взгляда: веса выбора и пауза на цели (с). side — случайный взгляд по сторонам
const LOOK_W = { course: 4, sail: 3, pennant: 1.2, side: 1.5 };
const LOOK_HOLD = { course: [2.5, 6], sail: [1.5, 4], pennant: [0.8, 1.8], side: [1.2, 3] };
const YAW_MAX = 1.5, PITCH_MIN = -0.45, PITCH_MAX = 0.9; // рад, пределы поворота головы
// реакция на крен: доля компенсации торсом и головой (голова держит горизонт сильнее), предел, рад
const COMP_TORSO = 0.45, COMP_HEAD = 0.75, COMP_MAX = 0.4;

export function createSailor({ seed = 1 } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(SAILOR_SCALE);
  const add = (mesh, parent) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // торс: тело и голова; наклоняется вокруг точки посадки, когда рука не дотягивается до цели
  const torso = new THREE.Group();
  group.add(torso);

  // ---- тело ----
  const body = new THREE.Group();
  torso.add(body);
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
  torso.add(head);
  const HEAD_R = 0.197, HC = V(0, 0.18, 0); // центр шара относительно шарнира
  add(new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 40, 28), MAT.skin), head).position.copy(HC);
  // глаза-точки; моргание — scale.y
  const eyes = [-1, 1].map((sx) => {
    const d = V(0.36 * sx, 0.04, 0.93);
    const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8).scale(1, 1.15, 0.45), MAT.eye), head);
    e.position.copy(HC).add(onSphere(d, HEAD_R + 0.001));
    e.lookAt(e.position.clone().add(d));
    e.userData.dynamic = true; // моргает (scale.y) — не сливать
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

  // ---- руки: сферы, висят у боков; hands[0] — у левого бока моряка (−X), hands[1] — у правого (+X) ----
  const HAND_R = 0.058;
  const REST = [-1, 1].map((sx) => V(0.32 * sx, 0.16, 0.02));
  const hands = REST.map((p) => {
    const h = add(new THREE.Mesh(new THREE.SphereGeometry(HAND_R, 24, 16), MAT.skin), group);
    h.position.copy(p);
    h.userData.dynamic = true;
    return h;
  });
  // «плечо» — точка на боку под линией плеч, от неё считается досягаемость руки
  const SHOULDER = [-1, 1].map((sx) => V(0.2 * sx, 0.36, 0));
  // неподвижные детали тела, головы и шапки — по одному мешу на материал (merge-static.js)
  for (const part of [body, head, hat]) mergeStatic(part);
  const vel = hands.map(() => V());
  const tgt = V(), off = V(), shTmp = V(), leanDir = new THREE.Vector2();
  const targets = [null, null], targets_ = [V(), V()];
  const LEAN_MAX = 0.55; // рад, наклон торса к недосягаемой цели

  // ---- состояние фоновой анимации ----
  const rand = rng(seed);
  const range = ([lo, hi]) => lo + (hi - lo) * rand();
  let clock = 0;
  // взгляд: текущая цель, время смены, угол «по сторонам»; сам угол головы догоняет цель пружиной
  let lookKey = 'course', lookUntil = 0, sideYaw = 0, sidePitch = 0;
  const lookAng = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
  // моргание: время следующего, фаза текущего (−1 — нет)
  let blinkAt = range([1, 3]), blinkT = -1, blinkTwice = 0; // blinkTwice: 1 — будет второе, 2 — идёт второе
  // волна: пружины смещения торса и головы по вертикали, сглаженная вертикальная скорость точки посадки
  const bob = { x: 0, v: 0, hx: 0, hv: 0 };
  const lastPos = V(), curPos = V();
  let lastVy = 0, hasPos = false;
  // крен: сглаженные углы компенсации
  const comp = { tx: 0, tz: 0, hx: 0, hz: 0 };
  // наклон к недосягаемой цели (раньше писался прямо в torso.rotation)
  const lean = { x: 0, z: 0 };
  let duckS = 0;
  const qInv = new THREE.Quaternion(), upL = V(), refL = V(), lookL = V(), WORLD_UP = V(0, 1, 0);

  // глаз для камеры с палубы — от посадки, а не от головы: повороты головы, дыхание и качка тела камеру не дёргают.
  // Наклон откренки и пересадка (поза группы) учитываются. EYE_UP поднимает глаз над центром головы (единицы модели,
  // ×1.1 ≈ 15 см), чтобы с банки крыша рубки не закрывала полкадра.
  const eye = V(), EYE_UP = 0.14;
  function eyeWorld(target) {
    eye.set(0, 0.47 + HC.y + EYE_UP, 0.12);
    group.localToWorld(eye);
    return target ? target.copy(eye) : eye.clone();
  }

  // мировая точка «плеча» руки i — чтобы снаружи выбрать, за какое место румпеля можно взяться
  function shoulderWorld(i, target = V()) {
    return torso.localToWorld(target.copy(SHOULDER[i]));
  }
  const shoulderLocal = (i, target) => target.copy(SHOULDER[i]).applyEuler(torso.rotation).add(torso.position);

  // выбор следующей цели взгляда (взвешенно, не повторяя текущую)
  function pickLook(avail) {
    const keys = Object.keys(LOOK_W).filter((k) => k !== lookKey && (k === 'side' || avail[k]));
    let sum = 0;
    for (const k of keys) sum += LOOK_W[k];
    let r = rand() * sum;
    let k = keys[keys.length - 1];
    for (const kk of keys) { r -= LOOK_W[kk]; if (r <= 0) { k = kk; break; } }
    lookKey = k;
    lookUntil = clock + range(LOOK_HOLD[k]);
    if (k === 'side') { sideYaw = (rand() < 0.5 ? -1 : 1) * range([0.5, 1.3]); sidePitch = range([-0.15, 0.15]); }
  }

  // угол на мировую точку p из шарнира головы в СК торса (без собственного поворота головы)
  function aimAt(p, out) {
    torso.updateWorldMatrix(true, false);
    lookL.copy(p);
    torso.worldToLocal(lookL).sub(head.position);
    lookL.y -= HC.y;
    out.yaw = Math.atan2(lookL.x, lookL.z);
    out.pitch = Math.atan2(lookL.y, Math.hypot(lookL.x, lookL.z));
    return out;
  }
  const aim = { yaw: 0, pitch: 0 };

  // ctx (всё необязательно):
  //   look: { yaw, pitch } — ручной поворот головы (рад), отключает автоматический взгляд; blink — ручное моргание 0..1;
  //   lookAt: { course, sail, pennant } — мировые точки, на которые моряк поглядывает (случайно, с паузами);
  //   focus — ключ из lookAt, на который смотреть сейчас (жест при манёвре);
  //   refUp — мировой «верх» лодки: торс и голова частично компенсируют его отклонение от вертикали (крен, дифферент);
  //   duck — 0..1, пригнуться (под гиком при пересадке и переброске);
  //   hands: [Vector3|null, Vector3|null] — мировые цели центров рук (null — поза покоя).
  // Цель руки ограничивается досягаемостью REACH от плеча; рука догоняет цель пружиной с критическим демпфированием.
  function update(dt, ctx = {}) {
    const step = dt > 0 ? dt : 0;
    clock += step;
    group.updateWorldMatrix(true, false);

    // ---- дыхание: период ~4 с, тело чуть растёт по высоте, голова поднимается вместе с ним ----
    const br = Math.sin(clock * (2 * Math.PI / 4.2));
    const breath = 0.012 * br;

    // ---- волна: вертикальное ускорение точки посадки раскачивает пружины торса и головы ----
    group.getWorldPosition(curPos);
    if (hasPos && step > 0) {
      const vy = (curPos.y - lastPos.y) / step;
      const ay = THREE.MathUtils.clamp((vy - lastVy) / step, -20, 20);
      lastVy += (vy - lastVy) * Math.min(1, step * 20);
      // x'' = −ω²x − 2ζωx' − a·k : тело «проседает», когда лодку подбрасывает вверх
      const Wt = 9, Wh = 6;
      bob.v += (-Wt * Wt * bob.x - 2 * 0.45 * Wt * bob.v - ay * 0.6) * step;
      bob.x = THREE.MathUtils.clamp(bob.x + bob.v * step, -0.04, 0.04);
      bob.hv += (-Wh * Wh * bob.hx - 2 * 0.35 * Wh * bob.hv - ay * 0.5) * step;
      bob.hx = THREE.MathUtils.clamp(bob.hx + bob.hv * step, -0.035, 0.035);
    }
    lastPos.copy(curPos); hasPos = true;

    // ---- крен и дифферент: торс и голова частично держат вертикаль относительно «верха» лодки ----
    let ctX = 0, ctz = 0, chx = 0, chz = 0;
    if (ctx.refUp) {
      group.getWorldQuaternion(qInv).invert();
      upL.copy(WORLD_UP).applyQuaternion(qInv);
      refL.copy(ctx.refUp).applyQuaternion(qInv);
      const dx = Math.atan2(upL.z, upL.y) - Math.atan2(refL.z, refL.y); // поворот вокруг X: +Y к +Z
      const dz = -(Math.atan2(upL.x, upL.y) - Math.atan2(refL.x, refL.y)); // вокруг Z: +Y к −X
      const cl = (v) => THREE.MathUtils.clamp(v, -COMP_MAX, COMP_MAX);
      ctX = cl(dx * COMP_TORSO); ctz = cl(dz * COMP_TORSO);
      chx = cl(dx * COMP_HEAD) - ctX; chz = cl(dz * COMP_HEAD) - ctz; // голове — остаток сверх торса
    }
    const kc = step > 0 ? Math.min(1, step * 5) : 1;
    comp.tx += (ctX - comp.tx) * kc; comp.tz += (ctz - comp.tz) * kc;
    comp.hx += (chx - comp.hx) * kc; comp.hz += (chz - comp.hz) * kc;

    // ---- пригибание: торс вперёд, тело приседает, голова вниз ----
    const duckT = THREE.MathUtils.clamp(ctx.duck || 0, 0, 1);
    duckS += (duckT - duckS) * (step > 0 ? Math.min(1, step * 12) : 1);

    // ---- цели рук в СК моряка; если какая-то дальше досягаемости — торс наклоняется к ней (не больше LEAN_MAX) ----
    let worst = 0;
    leanDir.set(0, 0);
    for (let i = 0; i < 2; i++) {
      const w = ctx.hands && ctx.hands[i];
      if (!w) { targets[i] = null; continue; }
      targets[i] = group.worldToLocal(targets_[i].copy(w));
      const ex = targets[i].distanceTo(SHOULDER[i]) - REACH;
      if (ex > worst) { worst = ex; leanDir.set(targets[i].x, targets[i].z).normalize(); }
    }
    const ang = Math.min(LEAN_MAX, Math.atan2(worst, 0.5));
    const lx = ang * leanDir.y, lz = -ang * leanDir.x; // верх торса — к цели: вокруг X к +Z, вокруг Z к −X
    const kLean = step > 0 ? Math.min(1, step * 6) : 1;
    lean.x += (lx - lean.x) * kLean;
    lean.z += (lz - lean.z) * kLean;

    torso.rotation.x = lean.x + comp.tx + 0.42 * duckS;
    torso.rotation.z = lean.z + comp.tz;
    torso.position.y = bob.x - 0.06 * duckS;
    body.scale.y = 1 + breath - 0.1 * duckS;
    body.scale.x = body.scale.z = 1 - 0.4 * breath + 0.04 * duckS;
    head.position.y = 0.47 * body.scale.y + bob.hx - bob.x * 0.5;

    // ---- взгляд ----
    let yaw, pitch;
    if (ctx.look) { yaw = ctx.look.yaw; pitch = ctx.look.pitch; }
    else {
      const avail = ctx.lookAt || {};
      if (clock >= lookUntil || (lookKey !== 'side' && !avail[lookKey])) pickLook(avail);
      const key = ctx.focus && avail[ctx.focus] ? ctx.focus : lookKey;
      if (key === 'side') { aim.yaw = sideYaw; aim.pitch = sidePitch; }
      else aimAt(avail[key], aim);
      yaw = THREE.MathUtils.clamp(aim.yaw, -YAW_MAX, YAW_MAX);
      pitch = THREE.MathUtils.clamp(aim.pitch, PITCH_MIN, PITCH_MAX);
    }
    pitch -= 0.35 * duckS; // пригнувшись, смотрит под ноги / под гик
    if (step > 0 && !ctx.look) {
      // быстрый поворот с мягкой остановкой: пружина ω = 9
      const W = 9;
      lookAng.vy += (W * W * (yaw - lookAng.yaw) - 2 * W * lookAng.vy) * step;
      lookAng.vp += (W * W * (pitch - lookAng.pitch) - 2 * W * lookAng.vp) * step;
      lookAng.yaw += lookAng.vy * step;
      lookAng.pitch += lookAng.vp * step;
    } else { lookAng.yaw = yaw; lookAng.pitch = pitch; lookAng.vy = lookAng.vp = 0; }
    // кивок дыхания и компенсация крена головой; голова поворачивается в СК торса
    head.rotation.set(-lookAng.pitch + chxBreath(br) + comp.hx, lookAng.yaw, comp.hz, 'YXZ');

    // ---- моргание: раз в 2–5 с на 0.12 с, иногда дважды подряд ----
    let blink = ctx.blink;
    if (blink === undefined) {
      blink = 0;
      if (blinkT < 0 && clock >= blinkAt) { blinkT = 0; if (!blinkTwice) blinkTwice = rand() < 0.2 ? 1 : 0; }
      if (blinkT >= 0) {
        blinkT += step;
        const u = blinkT / 0.12;
        blink = u < 1 ? Math.sin(Math.PI * u) : 0;
        if (u >= 1) {
          blinkT = -1;
          if (blinkTwice === 1) { blinkTwice = 2; blinkAt = clock + 0.08; } // второе моргание после короткой паузы
          else { blinkTwice = 0; blinkAt = clock + range([2, 5]); }
        }
      }
    }
    const b = 1 - 0.88 * blink;
    for (const e of eyes) e.scale.y = b;

    for (let i = 0; i < 2; i++) {
      if (targets[i]) {
        tgt.copy(targets[i]);
        const sh = shoulderLocal(i, shTmp);
        off.subVectors(tgt, sh);
        if (off.length() > REACH) tgt.copy(sh).addScaledVector(off.normalize(), REACH);
      } else tgt.copy(REST[i]).applyEuler(torso.rotation).add(torso.position);
      const h = hands[i].position;
      if (step <= 0) { h.copy(tgt); vel[i].set(0, 0, 0); continue; }
      // x'' = ω²(цель − x) − 2ω·x'
      const W = 18;
      off.subVectors(tgt, h).multiplyScalar(W * W).addScaledVector(vel[i], -2 * W);
      vel[i].addScaledVector(off, step);
      h.addScaledVector(vel[i], step);
    }
  }
  // дыхание: голова чуть кивает в такт (выдох — вниз)
  const chxBreath = (br) => 0.015 * br;

  return { group, torso, head, body, hands, eyes, update, eyeWorld, shoulderWorld, HAND_R };
}
