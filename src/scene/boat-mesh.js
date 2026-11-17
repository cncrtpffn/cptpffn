import * as THREE from 'three';
import { DEG } from '../config.js';

// Локальная СК модели: нос = -Z, правый борт = +X, вверх = +Y. Начало — на ватерлинии под ЦТ.
// Физика: x (вперёд) -> -Z, y (правый борт) -> +X.

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });
const MAT = {
  hull: flat(0x4f8fb5),
  hullBottom: flat(0xc9503f),
  deck: flat(0xe8d6b0),
  wood: flat(0xa5703f),
  darkWood: flat(0x6e4a2b),
  sail: new THREE.MeshStandardMaterial({ color: 0xf7f0dc, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }),
  spar: flat(0xc8a06a),
  white: flat(0xf4f1e8),
  skin: flat(0xf1c7a0),
  shirt: flat(0xe9553b),
  hat: flat(0xf4e3b2),
  board: flat(0x5c7d8a),
};

// Станции от кормы к носу: x физики (вперёд), полуширина, глубина, высота борта.
const STATIONS = [
  { x: -2.75, b: 0.80, d: 0.20, s: 0.62 },
  { x: -2.20, b: 1.04, d: 0.36, s: 0.58 },
  { x: -1.50, b: 1.22, d: 0.46, s: 0.55 },
  { x: -0.70, b: 1.30, d: 0.52, s: 0.53 },
  { x: 0.10, b: 1.30, d: 0.52, s: 0.54 },
  { x: 0.90, b: 1.22, d: 0.50, s: 0.58 },
  { x: 1.60, b: 1.02, d: 0.42, s: 0.64 },
  { x: 2.20, b: 0.72, d: 0.30, s: 0.72 },
  { x: 2.60, b: 0.36, d: 0.16, s: 0.82 },
  { x: 2.80, b: 0.03, d: 0.05, s: 0.90 },
];
const NA = 6; // точек на четверть шпангоута

function sectionPointA(st, a, sign) {
  // a — параметр 0 (киль) .. π/2 (планширь)
  const x = sign * st.b * Math.pow(Math.sin(a), 0.78);
  const y = -st.d + (st.d + st.s) * Math.pow(1 - Math.cos(a), 1.15);
  return new THREE.Vector3(x, y, -st.x);
}

// Параметр a, при котором y(a) = yTarget (y монотонно растёт по a).
function findA(st, yTarget) {
  let lo = 0, hi = Math.PI / 2;
  if (yTarget <= -st.d) return 0;
  if (yTarget >= st.s) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (sectionPointA(st, mid, 1).y < yTarget) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Полное кольцо шпангоута: от левого планширя через киль к правому, с заданными поясами по a.
function ring(st, bands) {
  // bands: [[a0, a1, n], ...] снизу вверх; результат — массив точек от порта к правому борту
  const right = [];
  for (const [a0, a1, n] of bands) {
    for (let i = (right.length ? 1 : 0); i <= n; i++) right.push(sectionPointA(st, a0 + (a1 - a0) * i / n, 1));
  }
  const left = right.map((p) => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
  left.pop(); // киль общий
  return left.concat(right);
}

// Корпус, разрезанный по ватерлинии: подводная часть, полоса ватерлинии, надводная часть.
function buildHull() {
  const BANDS = { bottom: [0, -0.1, 4], stripe: [-0.1, 0.0, 1], top: [0.0, Infinity, 3] };
  const parts = { bottom: [], stripe: [], top: [] };
  const push = (arr, p) => arr.push(p.x, p.y, p.z);
  const quad = (arr, a, b, c, d) => { push(arr, a); push(arr, b); push(arr, c); push(arr, a); push(arr, c); push(arr, d); };
  // кольца для каждой станции: индексы точек по поясам
  const rings = STATIONS.map((st) => {
    const aB = findA(st, -0.1), aW = findA(st, 0.0);
    return ring(st, [[0, aB, 4], [aB, aW, 1], [aW, Math.PI / 2, 3]]);
  });
  const n = rings[0].length; // 2*(4+1+3)+1 = 17
  const half = (n - 1) / 2; // 8 — индекс киля
  // пояс сегмента между точками k и k+1 — по расстоянию от киля
  const bandOfSeg = (k) => {
    const d = Math.min(Math.abs(k - half), Math.abs(k + 1 - half));
    return d < 4 ? 'bottom' : d === 4 ? 'stripe' : 'top';
  };
  for (let i = 0; i < STATIONS.length - 1; i++) {
    for (let k = 0; k < n - 1; k++) {
      const arr = parts[bandOfSeg(k)];
      const p00 = rings[i][k], p01 = rings[i][k + 1], p10 = rings[i + 1][k], p11 = rings[i + 1][k + 1];
      quad(arr, p00, p10, p11, p01);
    }
  }
  // транец (нормаль назад, +Z)
  const r0 = rings[0];
  const center = new THREE.Vector3(0, 0.25, -STATIONS[0].x);
  for (let k = 0; k < n - 1; k++) {
    const arr = parts[bandOfSeg(k)];
    push(arr, center); push(arr, r0[k]); push(arr, r0[k + 1]);
  }
  const out = {};
  for (const key of Object.keys(parts)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(parts[key], 3));
    g.computeVertexNormals();
    out[key] = g;
  }
  return out;
}

function buildDeck() {
  const pos = [];
  const push = (p) => pos.push(p.x, p.y, p.z);
  const quad = (a, b, c, d) => { push(a); push(b); push(c); push(a); push(c); push(d); };
  const cockpit = (x) => (x > -2.35 && x < 0.65) ? 0.95 : (x > -2.5 && x < 0.8 ? 0.5 : 0);
  const deckPt = (st, x) => new THREE.Vector3(x, st.s + 0.08 * (1 - (x / st.b) ** 2), -st.x);
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const A = STATIONS[i], B = STATIONS[i + 1];
    const ca = cockpit(A.x), cb = cockpit(B.x);
    if (ca === 0 && cb === 0) {
      quad(deckPt(A, -A.b), deckPt(A, A.b), deckPt(B, B.b), deckPt(B, -B.b));
    } else {
      quad(deckPt(A, -A.b), deckPt(A, -Math.min(ca || cb, A.b)), deckPt(B, -Math.min(cb || ca, B.b)), deckPt(B, -B.b));
      quad(deckPt(A, Math.min(ca || cb, A.b)), deckPt(A, A.b), deckPt(B, B.b), deckPt(B, Math.min(cb || ca, B.b)));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function sheerCurve(side) {
  const pts = STATIONS.map((st) => new THREE.Vector3(side * st.b, st.s + 0.02, -st.x));
  return new THREE.CatmullRomCurve3(pts);
}

export function createBoatMesh() {
  const group = new THREE.Group();
  const add = (m, parent = group) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // корпус: подводная часть, полоса ватерлинии, надводная часть
  const hullGeo = buildHull();
  add(new THREE.Mesh(hullGeo.top, MAT.hull));
  add(new THREE.Mesh(hullGeo.bottom, MAT.hullBottom));
  add(new THREE.Mesh(hullGeo.stripe, MAT.white));
  add(new THREE.Mesh(buildDeck(), MAT.deck));
  // привальный брус
  for (const side of [-1, 1]) add(new THREE.Mesh(new THREE.TubeGeometry(sheerCurve(side), 24, 0.045, 5, false), MAT.wood));
  // киль
  add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 5.1), MAT.darkWood)).position.set(0, -0.48, 0.1);
  // кокпит: пол и комингс
  const floorY = 0.2;
  add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 3.0), MAT.wood)).position.set(0, floorY, 0.85);
  const coam = (w, h, d, x, y, z) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.darkWood)).position.set(x, y, z);
  coam(0.06, 0.55, 3.0, -0.95, floorY + 0.28, 0.85);
  coam(0.06, 0.55, 3.0, 0.95, floorY + 0.28, 0.85);
  coam(1.96, 0.55, 0.06, 0, floorY + 0.28, 2.35);
  coam(1.96, 0.3, 0.06, 0, floorY + 0.6, -0.65);
  // банки (сиденья)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 2.6), MAT.wood)).position.set(-0.78, floorY + 0.33, 0.85);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 2.6), MAT.wood)).position.set(0.78, floorY + 0.33, 0.85);
  // рубка (cuddy)
  const cabin = add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 1.3), MAT.white));
  cabin.position.set(0, 0.82, -1.3);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.15), MAT.wood)).position.set(0, 1.06, -1.3);
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8).rotateZ(Math.PI / 2), MAT.darkWood)).position.set(sx * 0.86, 0.85, -1.3);

  // мачта
  const mastZ = -2.2, deckAtMast = 0.78;
  const mastH = 7.4;
  const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, mastH, 7), MAT.spar));
  mast.position.set(0, deckAtMast + mastH / 2, mastZ);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), MAT.white)).position.set(0, deckAtMast + mastH + 0.05, mastZ);

  // гик + гафель + парус: всё крутится вокруг мачты
  const boomY = deckAtMast + 1.05;
  const rig = new THREE.Group();
  rig.position.set(0, boomY, mastZ);
  group.add(rig);
  const boomLen = 4.7;
  const boom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, boomLen, 6).rotateX(Math.PI / 2), MAT.spar), rig);
  boom.position.set(0, 0, boomLen / 2);
  const gaffLen = 3.4, gaffAngle = 38 * DEG;
  const gaff = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, gaffLen, 6).rotateX(Math.PI / 2), MAT.spar), rig);
  const gaffPivot = new THREE.Group();
  gaffPivot.add(gaff);
  gaff.position.set(0, 0, gaffLen / 2);
  gaffPivot.rotation.x = -gaffAngle;
  rig.add(gaffPivot);

  const NU = 9, NV = 11;
  const sailGeo = new THREE.PlaneGeometry(1, 1, NU - 1, NV - 1);
  const sail = add(new THREE.Mesh(sailGeo, MAT.sail), rig);
  const sailPos = sailGeo.attributes.position;
  // точки крепления (в СК rig): галс, шкотовый угол, горло, пик
  const tack = new THREE.Vector3(0, 0.05, 0.12), clew = new THREE.Vector3(), throat = new THREE.Vector3(), peak = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), p = new THREE.Vector3();

  function updateSail(luff, clewZ, camber, side, flutter, time) {
    throat.set(0, luff, 0.12);
    gaffPivot.position.set(0, luff, 0.1);
    peak.set(0, luff + Math.sin(gaffAngle) * gaffLen, 0.1 + Math.cos(gaffAngle) * gaffLen);
    clew.set(0, 0.05, clewZ);
    let k = 0;
    for (let j = 0; j < NV; j++) {
      const v = j / (NV - 1);
      for (let i = 0; i < NU; i++) {
        const u = i / (NU - 1);
        tmpA.lerpVectors(tack, clew, u);
        tmpB.lerpVectors(throat, peak, u);
        p.lerpVectors(tmpA, tmpB, v);
        const belly = Math.sin(Math.PI * u) * Math.pow(Math.sin(Math.PI * v), 0.7);
        let x = side * camber * belly;
        if (flutter > 0) {
          x += flutter * 0.12 * belly * (Math.sin(time * 19 + u * 11 + v * 5) + 0.5 * Math.sin(time * 31 + v * 9));
          x += flutter * 0.05 * Math.sin(time * 23 + u * 20) * (1 - v) * (1 - u);
        }
        sailPos.setXYZ(k++, x, p.y, p.z);
      }
    }
    sailPos.needsUpdate = true;
    sailGeo.computeBoundingSphere();
  }

  // шверт (поворотный, ось — передний верхний угол)
  const boardPivot = new THREE.Group();
  boardPivot.position.set(0, -0.1, -0.95);
  group.add(boardPivot);
  const board = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 1.45), MAT.board), boardPivot);
  board.position.set(0, -0.2, 0.72);

  // руль и румпель
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, 0.3, 2.78);
  group.add(rudderPivot);
  const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.85), MAT.wood), rudderPivot);
  blade.position.set(0, -0.42, 0.4);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.14), MAT.darkWood), rudderPivot).position.set(0, 0.2, 0.02);
  const tiller = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.7), MAT.darkWood), rudderPivot);
  tiller.position.set(0, 0.42, -0.8);

  // матрос
  const crew = new THREE.Group();
  group.add(crew);
  const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 3, 6), MAT.shirt), crew);
  body.position.y = 0.42;
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), MAT.skin), crew);
  head.position.y = 0.8;
  const hat = add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.08, 8), MAT.hat), crew);
  hat.position.y = 0.9;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 8), MAT.hat), crew).position.y = 0.98;
  const legs = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.4), MAT.darkWood), crew);
  legs.position.set(0, 0.24, -0.12);

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const eye = new THREE.Vector3();
  // мировая позиция глаз рулевого — для вида с палубы
  function eyeWorld(target) {
    eye.set(0, 0.95, 0);
    head.localToWorld(eye);
    return target ? target.copy(eye) : eye.clone();
  }
  function setCrewVisible(v) { crew.visible = v; }

  function update(boat, time) {
    group.position.set(boat.x, boat.y, boat.z);
    euler.set(boat.theta, -boat.psi, -boat.phi);
    group.rotation.copy(euler);

    const s = boat.sail;
    const reef = s.reefLevel;
    const luff = 4.9 * (1 - 0.24 * Math.min(reef, 1) - 0.2 * Math.max(0, reef - 1));
    const clewZ = 4.45 * (1 - 0.08 * Math.min(reef, 1) - 0.1 * Math.max(0, reef - 1));
    rig.rotation.y = s.boom;
    const side = s.boom < 0 ? -1 : 1; // пузо в подветренную сторону (туда, куда вынесен гик)
    const fill = s.status === 'luff' ? 0.2 : s.status === 'gybe' ? 0.4 : 1;
    const camber = 0.42 * fill * Math.min(1, boat.aw.aws / 5 + 0.2);
    updateSail(luff, clewZ, camber, side, s.flutter, time);

    boardPivot.rotation.x = boat.board * 68 * DEG;
    rudderPivot.rotation.y = boat.rudder;

    const cy = boat.crewY;
    crew.position.set(cy * 0.85, 0.5, 1.0);
    crew.rotation.z = -cy / boat.cfg.crewMaxY * 0.55;
    crew.rotation.y = -boat.rudder * 0.3;
  }

  return { group, update, eyeWorld, setCrewVisible };
}
