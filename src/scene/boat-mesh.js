import * as THREE from 'three';
import { DEG } from '../config.js';
import { createRig } from './boat-rigging.js';
import { createFittings } from './boat-fittings.js';
import { createSailor } from './sailor.js';

// Локальная СК модели: нос = -Z, правый борт = +X, вверх = +Y. Начало — на ватерлинии под ЦТ.
// Физика: x (вперёд) -> -Z, y (правый борт) -> +X.

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });
// корпус двусторонний: если где-то останется щель, видна внутренность, а не вода
const MAT = {
  hull: flat(0x4f8fb5, { side: THREE.DoubleSide }),
  hullBottom: flat(0xc9503f, { side: THREE.DoubleSide }),
  deck: flat(0xe8d6b0, { side: THREE.DoubleSide }),
  wood: flat(0xa5703f, { side: THREE.DoubleSide }),
  darkWood: flat(0x6e4a2b),
  sail: new THREE.MeshStandardMaterial({ color: 0xf7f0dc, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }),
  spar: flat(0xc8a06a),
  white: flat(0xf4f1e8, { side: THREE.DoubleSide }),
  metal: flat(0xa7b0b5, { metalness: 0.6, roughness: 0.4 }),
  rope: flat(0xdccfb0, { side: THREE.DoubleSide }),
  pennant: flat(0xd8392b, { side: THREE.DoubleSide, emissive: 0x5a120c }),
  brass: flat(0xc9a24a, { metalness: 0.5, roughness: 0.45 }),
  glass: flat(0x2c4a5c, { metalness: 0.2, roughness: 0.15 }),
  // ходовые огни: светятся сами (emissive), чтобы читались и днём, и ночью
  navRed: flat(0xff3a2a, { emissive: 0xc81e12, roughness: 0.3 }),
  navGreen: flat(0x3aff6a, { emissive: 0x12a83a, roughness: 0.3 }),
  navWhite: flat(0xfff8e8, { emissive: 0xd8d0b8, roughness: 0.3 }),
};

// Кетбот 6 м: обводы сняты с CatBoat 16 (references/catboat: 12a.jpg — вид сверху, sailplan.gif — профиль)
// и масштабированы ×1.2. Станции от кормы к носу: x физики (вперёд), полуширина по планширю b,
// доля ширины по ватерлинии r, глубина корпуса d; высота борта — по линии седловатости sheerAt.
// rake — смещение низа станции по x (транец чуть наклонён). Форштевень вертикальный, подзор скруглён.
const LOA = 6.0;
const sheerAt = (x) => { const u = (x + LOA / 2) / LOA; return 0.56 + 0.40 * u ** 1.9 + 0.03 * (1 - u) ** 6; };
const STATIONS = [
  // [доля длины от носа, b, r, d]
  [1.000, 1.090, 0.55, 0.03],
  [0.955, 1.157, 0.65, 0.08],
  [0.860, 1.284, 0.75, 0.17],
  [0.765, 1.362, 0.80, 0.24],
  [0.670, 1.412, 0.82, 0.27],
  [0.575, 1.412, 0.83, 0.28],
  [0.480, 1.356, 0.83, 0.28],
  [0.385, 1.242, 0.83, 0.28],
  [0.290, 1.064, 0.84, 0.28],
  [0.196, 0.800, 0.86, 0.27],
  [0.125, 0.558, 0.88, 0.25],
  [0.077, 0.366, 0.90, 0.22],
  [0.030, 0.152, 0.92, 0.17],
  [0.000, 0.000, 0.92, 0.10], // форштевень сходится в линию
].map(([f, b, r, d]) => { const x = LOA / 2 - LOA * f; return { x, b, r, d, s: sheerAt(x) }; });
STATIONS[0].rake = 0.08;
const BAND = { bottom: 4, stripe: 1, top: 4 }; // точек на пояс в полушпангоуте
const STRIPE = { lo: 0.14, hi: 0.24 }; // белая отбивка ≈ на середине высоты борта миделя

// точка в СК модели по координатам физики: x вперёд, y вверх, z на правый борт
const pt = (x, y, z) => new THREE.Vector3(z, y, -x);

// Шпангоут: плоское днище с килеватостью, скула у ватерлинии, развал бортов к планширю (как на виде с носа).
function sectionCurve(st) {
  const { b, d, s } = st, bw = b * st.r;
  const P = [[0, -d], [0.5 * bw, -0.8 * d], [0.86 * bw, -0.35 * d], [bw, 0], [bw + 0.62 * (b - bw), 0.52 * s], [b, s]];
  return new THREE.CatmullRomCurve3(P.map(([z, y]) => new THREE.Vector3(z, y, 0)), false, 'centripetal');
}
function sectionPoint(st, t, sign) {
  const c = st.curve.getPoint(t);
  const h = (c.y + st.d) / (st.d + st.s);
  return new THREE.Vector3(sign * c.x, c.y, -(st.x + (st.rake || 0) * (1 - h)));
}
for (const st of STATIONS) st.curve = sectionCurve(st);

// Параметр t, при котором y(t) = yTarget (y монотонно растёт по t).
function findT(st, yTarget) {
  let lo = 0, hi = 1;
  if (yTarget <= -st.d) return 0;
  if (yTarget >= st.s) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (st.curve.getPoint(mid).y < yTarget) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Станция в произвольном x — линейно между соседними (лежит на рёбрах корпуса).
function lerpSt(x) {
  const last = STATIONS[STATIONS.length - 1];
  if (x <= STATIONS[0].x) return { ...STATIONS[0], rake: 0 };
  if (x >= last.x) return { ...last, rake: 0 };
  const i = STATIONS.findIndex((st) => st.x > x);
  const A = STATIONS[i - 1], B = STATIONS[i], t = (x - A.x) / (B.x - A.x);
  return { x, b: A.b + (B.b - A.b) * t, d: A.d + (B.d - A.d) * t, s: A.s + (B.s - A.s) * t };
}
// высота палубы (с погибью) в точке z поперёк станции
const deckY = (st, z) => st.s + (st.b > 0 ? 0.08 * (1 - (z / st.b) ** 2) : 0);

// Полное кольцо шпангоута: от левого планширя через киль к правому, с заданными поясами по t.
function ring(st, bands) {
  // bands: [[t0, t1, n], ...] снизу вверх; результат — массив точек от порта к правому борту
  const right = [];
  for (const [t0, t1, n] of bands) {
    for (let i = (right.length ? 1 : 0); i <= n; i++) right.push(sectionPoint(st, t0 + (t1 - t0) * i / n, 1));
  }
  const left = right.map((p) => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
  left.pop(); // киль общий
  return left.concat(right);
}

const pushV = (arr, p) => arr.push(p.x, p.y, p.z);
const quad = (arr, a, b, c, d) => { pushV(arr, a); pushV(arr, b); pushV(arr, c); pushV(arr, a); pushV(arr, c); pushV(arr, d); };
// лента между двумя рядами точек одинаковой длины
const ribbon = (arr, A, B) => { for (let i = 0; i < A.length - 1; i++) quad(arr, A[i], A[i + 1], B[i + 1], B[i]); };
function toGeo(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// Корпус, разрезанный белой отбивкой на середине борта: красное днище, полоса, синий борт.
function buildHull() {
  const parts = { bottom: [], stripe: [], top: [] };
  const rings = STATIONS.map((st) => {
    const tB = findT(st, STRIPE.lo), tW = findT(st, STRIPE.hi);
    return ring(st, [[0, tB, BAND.bottom], [tB, tW, BAND.stripe], [tW, 1, BAND.top]]);
  });
  const n = rings[0].length;
  const half = (n - 1) / 2; // индекс киля
  // пояс сегмента между точками k и k+1 — по расстоянию от киля
  const bandOfSeg = (k) => {
    const d = Math.min(Math.abs(k - half), Math.abs(k + 1 - half));
    return d < BAND.bottom ? 'bottom' : d < BAND.bottom + BAND.stripe ? 'stripe' : 'top';
  };
  for (let i = 0; i < STATIONS.length - 1; i++) {
    for (let k = 0; k < n - 1; k++) {
      quad(parts[bandOfSeg(k)], rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
    }
  }
  // транец (нормаль назад, +Z): горизонтальные полосы между симметричными точками кольца,
  // каждая в цвет своего пояса — пояса на транце продолжают борта; верх повторяет погибь палубы
  const st0 = STATIONS[0], r0 = rings[0];
  for (let k = 0; k < half; k++) quad(parts[bandOfSeg(k)], r0[k], r0[k + 1], r0[n - 2 - k], r0[n - 1 - k]);
  const topC = pt(st0.x, deckY(st0, 0), 0);
  pushV(parts.top, r0[0]); pushV(parts.top, r0[n - 1]); pushV(parts.top, topC);
  const out = {};
  for (const key of Object.keys(parts)) out[key] = toGeo(parts[key]);
  return out;
}

// Киль: невысокий брус по всей длине, к корме корпус поднимается — получается скег под навесной руль.
function buildKeel() {
  const pos = [];
  const x0 = -2.92, x1 = 2.75, N = 26, K = -0.36;
  const top = (x) => -lerpSt(x).d + 0.03;
  const bot = (x) => (x > 1.2 ? K + (top(x1) - K) * ((x - 1.2) / (x1 - 1.2)) ** 1.5 : K);
  const L = [], R = [], B0 = [], B1 = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 + (x1 - x0) * i / N;
    const hw = 0.05 * Math.min(1, (x1 - x) / 0.6); // к носу сужается
    L.push(pt(x, top(x), -hw)); B0.push(pt(x, bot(x), -hw));
    R.push(pt(x, top(x), hw)); B1.push(pt(x, bot(x), hw));
  }
  ribbon(pos, L, B0); ribbon(pos, B1, R); ribbon(pos, B0, B1);
  quad(pos, L[0], B0[0], B1[0], R[0]); // торец у транца
  return toGeo(pos);
}

// Кокпит и рубка — один вырез в палубе: контур подковой, сзади кокпит, спереди рубка.
const CK = {
  x0: -2.78, x1: 1.68, // корма и нос выреза (по плану палубы CatBoat 16)
  xc: -0.70,           // переборка рубки
  side: 0.28,          // ширина бокового прохода
  r0: 0.6, p0: 2.6,    // скругление кормы кокпита
  r1: 0.8, p1: 2.2,    // лоб рубки — почти полуцилиндр в плане
  floorY: 0.14, seatH: 0.36, seatW: 0.4,
  coaming: 0.22, cabin: 0.42, crown: 0.06,
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function outlineW(x) {
  let w = lerpSt(x).b - CK.side;
  const se = (t, p) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, t), p)), 1 / p);
  if (x < CK.x0 + CK.r0) w *= se((CK.x0 + CK.r0 - x) / CK.r0, CK.p0);
  if (x > CK.x1 - CK.r1) w *= se((x - (CK.x1 - CK.r1)) / CK.r1, CK.p1);
  return Math.max(0, w);
}
// высота комингса/стенки рубки над палубой: низкий комингс плавно переходит в рубку
const wallH = (x) => CK.coaming + (CK.cabin - CK.coaming) * smooth(CK.xc - 0.6, CK.xc + 0.05, x);
// x-сетка контура: сгущается к концам, переборка — точно в сетке; шагов мало — скругления гранёные (low-poly)
const OX_N = 20;
const OX = (() => {
  const xs = [];
  for (let i = 0; i <= OX_N; i++) xs.push(CK.x0 + (CK.x1 - CK.x0) * (0.5 - 0.5 * Math.cos(Math.PI * i / OX_N)));
  xs.push(CK.xc);
  return [...new Set(xs)].sort((a, b) => a - b);
})();
// точки контура {x, z, y — палуба на кромке, top — верх стенки}
const edge = (x, side) => {
  const w = outlineW(x), st = lerpSt(x), y = deckY(st, w);
  return { x, z: side * w, y, top: y + wallH(x) };
};
// замкнутый контур: правый борт от кормы к носу, левый обратно
const LOOP = [...OX.map((x) => edge(x, 1)), ...OX.slice(1, -1).reverse().map((x) => edge(x, -1))];
// кокпит подковой: левый борт от переборки к корме, правый обратно
const OXC = OX.filter((x) => x <= CK.xc + 1e-9);
const UPATH = [...OXC.slice().reverse().map((x) => edge(x, -1)), ...OXC.slice(1).map((x) => edge(x, 1))];
// смещение контура внутрь выреза на d (в плане)
function inset(path, d, closed) {
  const n = path.length;
  return path.map((p, i) => {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    return { ...p, x: p.x + d * tz / l, z: p.z - d * tx / l };
  });
}

function buildDeck() {
  const pos = [];
  const xs = [...new Set([...STATIONS.map((s) => s.x), ...OX])].sort((a, b) => a - b);
  const inside = (x) => x > CK.x0 + 1e-9 && x < CK.x1 - 1e-9;
  // ряд палубы поперёк: борт, кромка выреза (или середина полупалубы), ДП, кромка, борт
  const rows = xs.map((x) => {
    const st = lerpSt(x);
    const w = inside(x) ? outlineW(x) : (x === CK.x0 || x === CK.x1 ? 0 : 0.5 * st.b);
    return [-st.b, -w, 0, w, st.b].map((z) => pt(x, deckY(st, z), z));
  });
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    quad(pos, A[0], B[0], B[1], A[1]);
    quad(pos, A[3], B[3], B[4], A[4]);
    if (!inside((xs[i] + xs[i + 1]) / 2)) { quad(pos, A[1], B[1], B[2], A[2]); quad(pos, A[2], B[2], B[3], A[3]); }
  }
  return toGeo(pos);
}

// Стенки комингса и рубки, обшивка кокпита, банки, пол, крыша и переборка рубки.
function buildCockpit() {
  const g = { white: [], liner: [], wood: [], roof: [] };
  const P = (p, y) => pt(p.x, y, p.z);
  // наружная белая стенка по всему контуру
  ribbon(g.white, LOOP.map((p) => P(p, p.y)), LOOP.map((p) => P(p, p.top)));
  ribbon(g.white, [P(LOOP[LOOP.length - 1], LOOP[LOOP.length - 1].y), P(LOOP[0], LOOP[0].y)],
    [P(LOOP[LOOP.length - 1], LOOP[LOOP.length - 1].top), P(LOOP[0], LOOP[0].top)]);
  // обшивка кокпита: внутренняя сторона комингса до пола
  const inner = inset(UPATH, 0.035, false);
  ribbon(g.liner, inner.map((p) => P(p, CK.floorY)), inner.map((p) => P(p, p.top)));
  // банки вдоль бортов
  const seatY = CK.floorY + CK.seatH;
  for (const side of [-1, 1]) {
    const xs = OXC.filter((x) => x > CK.x0 + 0.45 && x < CK.xc - 0.04);
    const outer = xs.map((x) => pt(x, seatY, side * (outlineW(x) - 0.035)));
    const edgeIn = xs.map((x) => pt(x, seatY, side * Math.max(0.15, outlineW(x) - CK.seatW)));
    const foot = xs.map((x) => pt(x, CK.floorY, side * Math.max(0.15, outlineW(x) - CK.seatW + 0.04)));
    ribbon(g.wood, outer, edgeIn);
    ribbon(g.liner, edgeIn, foot);
    for (const i of [0, xs.length - 1]) quad(g.liner, outer[i], edgeIn[i], foot[i], pt(xs[i], CK.floorY, side * (outlineW(xs[i]) - 0.035)));
  }
  // пол кокпита
  const shape = new THREE.Shape(inner.map((p) => new THREE.Vector2(p.z, p.x)));
  const floor = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, CK.floorY, 0);
  // крыша рубки с погибью
  const roofRow = (x) => {
    const e = edge(x, 1);
    return [-1, -0.5, 0, 0.5, 1].map((k) => pt(x, e.top + CK.crown * (1 - k * k), k * e.z));
  };
  const rx = OX.filter((x) => x >= CK.xc - 1e-9);
  for (let i = 0; i < rx.length - 1; i++) ribbon(g.roof, roofRow(rx[i]), roofRow(rx[i + 1]));
  // переборка рубки от пола до крыши
  const top = roofRow(CK.xc).map((p) => p.clone().setZ(p.z + 0.01));
  ribbon(g.white, top.map((p) => new THREE.Vector3(p.x * 0.97, CK.floorY, p.z)), top.map((p) => new THREE.Vector3(p.x * 0.97, p.y, p.z)));
  const geos = {};
  for (const k of Object.keys(g)) geos[k] = toGeo(g[k]);
  geos.floor = floor;
  return geos;
}

// Навесной руль «амбарная дверь» (14sh.jpg, deck_gear.gif): контур в СК оси руля, u — назад от оси, v — вверх от ВЛ.
// Голова поднята над транцем, чтобы румпель прошёл над кормовым комингсом.
const RUDDER = [[0, 1.0], [0.12, 1.0], [0.14, 0.62], [0.3, 0.47], [0.56, 0.27], [0.8, 0.04], [0.92, -0.14], [0.84, -0.36], [0, -0.36]];
const RUDDER_T = 0.05;
// Отсечение многоугольника полосой lo <= v <= hi (Сазерленд — Ходжман по двум прямым).
function clipBand(poly, lo, hi) {
  const clip = (pts, keep, cut) => {
    const out = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (keep(a)) out.push(a);
      if (keep(a) !== keep(b)) { const t = (cut - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, cut]); }
    });
    return out;
  };
  return clip(clip(poly, (q) => q[1] >= lo, lo), (q) => q[1] <= hi, hi);
}
// Пластина по контуру [u, v]: u -> +Z (назад), v -> +Y, толщина по X.
function plate(poly, t) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([u, v]) => new THREE.Vector2(u, v))), { depth: t, bevelEnabled: false });
  return g.rotateY(-Math.PI / 2).translate(t / 2, 0, 0);
}
// Шверт поворотный: в поднятом положении лежит в колодце под рубкой, ось — у переднего верхнего угла.
// 1.5 × 0.42 м: опущенный на 66° даёт осадку ~1.4 м; подводные контуры упрощены ради полигонов.
const BOARD = [[-0.08, 0.08], [1.36, 0.08], [1.46, -0.08], [1.38, -0.34], [-0.08, -0.34]];
const BOARD_DOWN = 66 * DEG;

function sheerCurve(side) {
  const pts = STATIONS.map((st) => new THREE.Vector3(side * st.b, st.s + 0.02, -st.x));
  return new THREE.CatmullRomCurve3(pts);
}
// Гранёная труба по замкнутой ломаной: кольца в вершинах, разнесённые по биссектрисе (без сплайна, грани совпадают со стенкой).
function polyTube(pts, r, sides) {
  const n = pts.length, up = new THREE.Vector3(0, 1, 0), rings = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const d0 = p.clone().sub(a).setY(0).normalize(), d1 = b.clone().sub(p).setY(0).normalize();
    const t = d0.clone().add(d1).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const miter = 1 / Math.max(0.5, side.dot(new THREE.Vector3().crossVectors(d1, up).normalize()));
    const ring = [];
    for (let k = 0; k <= sides; k++) {
      const ang = 2 * Math.PI * k / sides;
      ring.push(p.clone().addScaledVector(side, r * miter * Math.cos(ang)).addScaledVector(up, r * Math.sin(ang)));
    }
    rings.push(ring);
  }
  const pos = [];
  for (let i = 0; i < n; i++) ribbon(pos, rings[(i + 1) % n], rings[i]);
  return toGeo(pos);
}
// планширь комингса/рубки — замкнутая ломаная по верху стенок
const capPoints = () => inset(LOOP, 0.015, true).map((p) => pt(p.x, p.top, p.z));

// Положения рулевого. Сидит лицом к противоположному борту, чуть впереди конца румпеля (x ≈ −1.55),
// чтобы кормовая рука доставала до румпеля. side: +1 правый борт, −1 левый.
// bench — на банке у внутренней кромки (ближе к ДП); hike — на комингсе над банкой, откренка за борт.
const SEAT_X = -1.3;
// угол to + 2πk, ближайший к from; при равенстве (разворот на 180°) — тот, чей путь идёт через лицом к носу (π)
function turnTarget(from, to) {
  let best = to, bd = Infinity;
  for (let k = -2; k <= 2; k++) {
    const c = to + 2 * Math.PI * k;
    const d = Math.abs(c - from) + 1e-3 * Math.cos((c + from) / 2); // cos(середины) < 0 — середина у π
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
const SEAT_LEAN = 0.35; // откренка: наклон корпуса за борт, рад (~20°)
function seatPose(side, hike) {
  const w = outlineW(SEAT_X), e = edge(SEAT_X, side);
  const pos = hike
    ? pt(SEAT_X, e.top - 0.03, side * w)                                // на комингсе, чуть «просев» в него: пузо над банкой, спина над проходом
    : pt(SEAT_X, CK.floorY + CK.seatH, side * (w - CK.seatW + 0.12));    // на банке ближе к ДП: спина не уходит в комингс, пузо свисает за кромку
  // лицом (+Z моряка) к противоположному борту: в СК модели это −side по X
  return { pos, rotY: -side * Math.PI / 2, lean: hike ? -SEAT_LEAN : 0 };
}

export function createBoatMesh() {
  const group = new THREE.Group();
  const add = (m, parent = group) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // корпус: подводная часть, полоса ватерлинии, надводная часть
  const hullGeo = buildHull();
  add(new THREE.Mesh(hullGeo.top, MAT.hull));
  add(new THREE.Mesh(hullGeo.bottom, MAT.hullBottom));
  add(new THREE.Mesh(hullGeo.stripe, MAT.white));
  add(new THREE.Mesh(buildKeel(), MAT.hullBottom));
  add(new THREE.Mesh(buildDeck(), MAT.deck));
  // привальный брус
  for (const side of [-1, 1]) add(new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(side), 32, 0.045, 5, false), MAT.wood));

  // кокпит и рубка
  const ck = buildCockpit();
  add(new THREE.Mesh(ck.white, MAT.white));
  add(new THREE.Mesh(ck.liner, MAT.deck));
  add(new THREE.Mesh(ck.wood, MAT.wood));
  add(new THREE.Mesh(ck.floor, MAT.wood));
  add(new THREE.Mesh(ck.roof, MAT.deck));
  add(new THREE.Mesh(polyTube(capPoints(), 0.032, 5), MAT.darkWood));
  // сходной люк в переборке и сдвижной люк на крыше
  const roofAtXc = edge(CK.xc, 1).top + CK.crown;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, roofAtXc - CK.floorY - 0.32, 0.03), MAT.darkWood)).position.set(0, (roofAtXc + CK.floorY + 0.32) / 2, -CK.xc + 0.02);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.7), MAT.wood)).position.set(0, roofAtXc + 0.03, -(CK.xc + 0.38));

  // мачта, рангоут, парус и такелаж (boat-rigging.js); мачта на баке, ~0.6 м от форштевня
  const MAST_X = 2.4;
  const horseX = -2.86, horseHW = 0.55;
  const rig = createRig({
    group, add, MAT,
    mastZ: -MAST_X,
    deckAtMast: deckY(lerpSt(MAST_X), 0),
    stemHead: new THREE.Vector3(0, STATIONS[STATIONS.length - 1].s + 0.03, -(LOA / 2 - 0.02)),
    // погон гика-шкота аркой над румпелем у транца
    horse: { z: -horseX, hw: horseHW, yEnd: deckY(lerpSt(horseX), horseHW), h: 0.4 },
    coaming: new THREE.Vector3(0.25, edge(CK.x0 + 0.05, 1).top + 0.05, -(CK.x0 + 0.05)),
    coil: new THREE.Vector3(0.3, CK.floorY + 0.03, -(CK.x0 + 0.5)),
  });

  // фурнитура: иллюминаторы, поручни, утки, роульс, кранцы, бухта, пайолы (boat-fittings.js)
  createFittings({
    add, MAT, pt, lerpSt, deckY, edge, outlineW, CK, mastX: MAST_X,
    stemHead: new THREE.Vector3(0, STATIONS[STATIONS.length - 1].s + 0.03, -(LOA / 2 - 0.02)),
  });

  // шверт: ось под рубкой, опущенный уходит назад-вниз через щель в киле
  const boardPivot = new THREE.Group();
  boardPivot.position.set(0, 0.0, -1.0);
  group.add(boardPivot);
  add(new THREE.Mesh(plate(BOARD, 0.04), MAT.hullBottom), boardPivot);

  // навесной руль: ось идёт вдоль наклонного транца, перо окрашено как корпус (борт / полоса / днище)
  const st0 = STATIONS[0];
  const rudderMount = new THREE.Group();
  rudderMount.position.set(0, 0, -(st0.x + st0.rake * (1 - st0.d / (st0.d + st0.s))) + 0.03);
  rudderMount.rotation.x = Math.atan2(st0.rake, st0.d + st0.s);
  group.add(rudderMount);
  const rudderPivot = new THREE.Group();
  rudderMount.add(rudderPivot);
  for (const [lo, hi, mat] of [[0, 9, MAT.hull], [-0.1, 0, MAT.white], [-9, -0.1, MAT.hullBottom]]) {
    add(new THREE.Mesh(plate(clipBand(RUDDER, lo, hi), RUDDER_T), mat), rudderPivot);
  }
  // щёки головы руля и румпель над транцем вперёд, в кокпит
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.2), MAT.darkWood), rudderPivot).position.set(sx * (RUDDER_T / 2 + 0.01), 0.9, 0.06);
  // ось наклонена назад, поэтому в её СК румпель идёт вниз — в лодке он почти горизонтален
  const tillerCurve = new THREE.CatmullRomCurve3([[0, 0.92, 0.1], [0, 0.94, -0.2], [0, 0.88, -0.8], [0, 0.78, -1.5]].map((q) => new THREE.Vector3(...q)));
  add(new THREE.Mesh(new THREE.TubeGeometry(tillerCurve, 16, 0.028, 6, false), MAT.darkWood), rudderPivot);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), MAT.darkWood), rudderPivot).position.set(0, 0.78, -1.5);
  // удлинитель румпеля на шарнире у конца румпеля: металлическая трубка с деревянной ручкой на свободном конце.
  // Ориентация считается в кадре (update), в СК лодки; геометрия вдоль +Y от шарнира.
  const TILLER_END = new THREE.Vector3(0, 0.78, -1.5), EXT_L = 1.0;
  const ext = new THREE.Group();
  group.add(ext);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, EXT_L, 6).translate(0, EXT_L / 2, 0), MAT.metal), ext);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6).translate(0, EXT_L - 0.07, 0), MAT.darkWood), ext);
  // петли на транце (неподвижные) и штыри на пере
  for (const v of [0.08, 0.45]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.09), MAT.metal), rudderMount).position.set(0, v, -0.02);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), MAT.metal), rudderPivot).position.set(0, v - 0.05, 0);
  }

  // рулевой (sailor.js): 4 положения — на бортовой банке ближе к ДП и на комингсе с откренкой, на каждый борт
  const crew = new THREE.Group();
  group.add(crew);
  const sailor = createSailor();
  crew.add(sailor.group);

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const eye = new THREE.Vector3();
  // мировая позиция глаз рулевого — для вида с палубы
  function eyeWorld(target) {
    return sailor.eyeWorld(target || eye.clone());
  }
  function setCrewVisible(v) { crew.visible = v; }
  // мировая точка у форштевня на ватерлинии — для брызг
  function bowWorld(target) {
    target.set(0, 0.1, -(LOA / 2 - 0.1));
    return group.localToWorld(target);
  }

  function update(boat, time) {
    group.position.set(boat.x, boat.y, boat.z);
    euler.set(boat.theta, -boat.psi, -boat.phi);
    group.rotation.copy(euler);

    boardPivot.rotation.x = boat.board * BOARD_DOWN;
    if (visRudder === null) visRudder = boat.rudder;
    rudderPivot.rotation.y = visRudder;

    // рулевой: борт и откренка — из boat.crewSeat (стенд), иначе из crewY (до этапа 2 физика знает только crewY)
    let seat = boat.crewSeat;
    if (!seat) {
      const cy = boat.crewY;
      seat = { side: Math.sign(cy) || Math.sign(boat.aw.twa || boat.aw.awa || 1), hike: Math.abs(cy) > 0.6 * boat.cfg.crewMaxY };
    }
    const dt = lastTime === null ? 0 : Math.min(0.1, Math.max(0, time - lastTime));
    lastTime = time;

    // пересадка: при смене сиденья поза плавно переходит из текущей в новую.
    // Через кокпит (смена борта) — 1.4 с, лицом вперёд, пригнувшись под гиком; банка ↔ комингс — 0.5 с.
    if (!seatTo || dt <= 0) { seatTo = { ...seat }; seatU = 1; }
    else if (seat.side !== seatTo.side || seat.hike !== seatTo.hike) {
      seatFrom = { pos: crew.position.clone(), rotY: crew.rotation.y, lean: crew.rotation.x, side: handSide };
      seatCross = seat.side !== seatTo.side;
      seatTo = { ...seat };
      seatU = 0;
    }
    const sp = seatPose(seatTo.side, seatTo.hike);
    let crossDuck = 0;
    handSide = seatTo.side;
    if (seatU < 1) {
      seatU = Math.min(1, seatU + dt / (seatCross ? 1.4 : 0.5));
      const u = THREE.MathUtils.smootherstep(seatU, 0, 1);
      crew.position.lerpVectors(seatFrom.pos, sp.pos, u);
      // поворот — кратчайший, а при равных — через «лицом к носу» (rotY = π): с правого борта −π/2 → −3π/2
      const rTo = turnTarget(seatFrom.rotY, sp.rotY);
      const rY = seatFrom.rotY + (rTo - seatFrom.rotY) * u;
      crew.rotation.set(seatFrom.lean + (sp.lean - seatFrom.lean) * u, rY, 0, 'YXZ');
      if (seatCross) {
        crew.position.y -= 0.08 * Math.sin(Math.PI * u); // переходит через кокпит пониже
        crossDuck = Math.sin(Math.PI * Math.min(1, seatU * 1.15));
        if (seatU < 0.5) handSide = seatFrom.side;  // руки меняются на середине перехода
      }
      if (seatU >= 1) crew.rotation.y = sp.rotY;
    } else {
      crew.position.copy(sp.pos);
      crew.rotation.set(sp.lean, sp.rotY, 0, 'YXZ');
    }
    group.updateMatrixWorld(true);

    // манёвр: гик перешёл на другой борт. Поворот через фордевинд — пригнуться сильно и проводить гик взглядом,
    // оверштаг — слегка пригнуться и посмотреть на парус
    const bs = Math.abs(boat.sail.boom) > 0.1 ? Math.sign(boat.sail.boom) : boomSide;
    if (boomSide !== 0 && bs !== boomSide && dt > 0) {
      manT = 0;
      manGybe = !!boat.sail.gybing || Math.abs(boat.aw.awa) > Math.PI / 2;
    }
    boomSide = bs;
    let manDuck = 0, focus = null;
    if (manT >= 0) {
      manT += dt;
      const dur = manGybe ? 1.0 : 0.8;
      if (manT < dur) manDuck = (manGybe ? 0.9 : 0.35) * Math.sin(Math.PI * manT / dur);
      if (manT < (manGybe ? 1.8 : 1.3)) focus = 'sail';
      else manT = -1;
    }

    // руки: кормовая — на румпеле, передняя — держит хвост гика-шкота.
    // Лицом к противоположному борту: на правом борту корма у правого бока моряка (+X), на левом — у левого.
    const aft = handSide > 0 ? 1 : 0, fwd = 1 - aft;
    // румпель — через удлинитель (СК лодки), шарнир на конце румпеля. Рулевой всегда держится за удлинитель:
    // свободный конец смотрит вверх и назад, над кормовым «плечом» рулевого, рука держит его в точке gripS.
    // При перекладке рука сначала быстро (~0.1 с) скользит к удобной точке для нового угла руля, и только
    // потом за ней идёт видимый руль (visRudder). Физика берёт boat.rudder напрямую — управляемость не страдает.
    // Коллизии удлинителя не учитываются. Без рулевого (вид с палубы) удлинитель лежит на румпеле.
    if (crew.visible) {
      const sx = aft ? 1 : -1;
      const sTarget = extFrame(boat.rudder, sx);           // удобная точка хвата при целевом угле руля
      if (gripS === null || dt <= 0) gripS = sTarget;
      gripS += (sTarget - gripS) * Math.min(1, dt / GRIP_TAU);
      const settled = 1 - Math.min(1, Math.abs(sTarget - gripS) / 0.06);
      visRudder = dt <= 0 ? boat.rudder : visRudder + (boat.rudder - visRudder) * Math.min(1, dt * RUDDER_RATE * settled);
      extFrame(visRudder, sx);
      grip.copy(joint).addScaledVector(extDir, gripS);
      tillerHand.copy(grip);
      group.localToWorld(tillerHand);
    } else {
      visRudder = boat.rudder;
      rudderPivot.rotation.y = visRudder;
      rudderPivot.updateMatrixWorld(true);
      joint.copy(TILLER_END);
      rudderPivot.localToWorld(joint);
      group.worldToLocal(joint);
      tillerCurve.getPoint(0.55, extDir);
      rudderPivot.localToWorld(extDir);
      group.worldToLocal(extDir).sub(joint);
      extDir.y += 0.02; // лежит поверх румпеля
      extDir.normalize();
    }
    ext.position.copy(joint);
    ext.quaternion.setFromUnitVectors(Y_AXIS, extDir);
    // шкот: рука перед животом с передней стороны; когда шкот травят, рука уходит к блоку, когда выбирают — к себе
    if (dt > 0) sheetRate += ((boat.sail.sheet - lastSheet) / dt - sheetRate) * Math.min(1, dt * 6);
    lastSheet = boat.sail.sheet;
    sheetHand.set(fwd ? 0.26 : -0.26, 0.24, 0.2);
    sailor.group.localToWorld(sheetHand);
    toBlock.copy(rig.sheetBlock);
    group.localToWorld(toBlock).sub(sheetHand).normalize();
    sheetHand.addScaledVector(toBlock, THREE.MathUtils.clamp(sheetRate * 0.5, -0.1, 0.12));
    handTargets[aft] = tillerHand; handTargets[fwd] = sheetHand;
    lookCourse.set(0, 1.2, -30);
    lookSail.copy(rig.sailLook);
    lookPennant.copy(rig.pennantLook);
    group.localToWorld(lookCourse); group.localToWorld(lookSail); group.localToWorld(lookPennant);
    refUp.set(0, 1, 0).applyQuaternion(group.quaternion);
    sailor.update(dt, { hands: handTargets, lookAt, focus, refUp, duck: Math.max(crossDuck, manDuck) });

    // хвост шкота идёт через руку (СК лодки)
    sailor.hands[fwd].getWorldPosition(sheetLocal);
    rig.update(boat, time, crew.visible ? group.worldToLocal(sheetLocal) : null);
  }
  let lastTime = null, lastSheet = 0, sheetRate = 0;
  // пересадка: откуда/куда, прогресс 0..1, через кокпит ли; handSide — борт, по которому раздаются руки
  let seatFrom = null, seatTo = null, seatU = 1, seatCross = false, handSide = 1;
  // манёвр: борт гика, время с начала жеста (−1 — нет), фордевинд ли
  let boomSide = 0, manT = -1, manGybe = false;
  const lookCourse = new THREE.Vector3(), lookSail = new THREE.Vector3(), lookPennant = new THREE.Vector3();
  const lookAt = { course: lookCourse, sail: lookSail, pennant: lookPennant }, refUp = new THREE.Vector3();
  // видимый угол руля и точка хвата на удлинителе (м от шарнира)
  let visRudder = null, gripS = null;
  const GRIP_TAU = 0.035;  // с, скольжение руки по удлинителю (95 % за ~0.1 с)
  const RUDDER_RATE = 30;  // 1/с, видимый руль догоняет физический, когда рука на месте
  // ставит руль на угол a и считает шарнир и направление удлинителя (СК лодки); возвращает удобную точку хвата
  function extFrame(a, sx) {
    rudderPivot.rotation.y = a;
    rudderPivot.updateMatrixWorld(true);
    joint.copy(TILLER_END);
    rudderPivot.localToWorld(joint);
    group.worldToLocal(joint);
    sailor.group.localToWorld(aim.set(0.2 * sx, 0.36 + 0.45, -0.18)); // над плечом и чуть за спиной
    group.worldToLocal(aim);
    extDir.subVectors(aim, joint).normalize();
    sailor.group.localToWorld(shoulder.set(0.24 * sx, 0.26, 0.12));  // удобное место руки: у бока, чуть впереди
    group.worldToLocal(shoulder);
    return THREE.MathUtils.clamp(tmp.subVectors(shoulder, joint).dot(extDir), 0.08, EXT_L - 0.07);
  }
  const shoulder = new THREE.Vector3(), tmp = new THREE.Vector3(), grip = new THREE.Vector3();
  const joint = new THREE.Vector3(), extDir = new THREE.Vector3(), aim = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);
  const tillerHand = new THREE.Vector3(), sheetHand = new THREE.Vector3(), toBlock = new THREE.Vector3(), sheetLocal = new THREE.Vector3();
  const handTargets = [null, null];

  // rudderState — для стенда и отладки: видимый угол руля и точка хвата на удлинителе
  return { group, update, eyeWorld, bowWorld, setCrewVisible, sailor, rudderState: () => ({ visRudder, gripS }) };
}
