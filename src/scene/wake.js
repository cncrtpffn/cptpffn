import * as THREE from 'three';
import { WAKE_POINTS, WAKE_GROUP, WAKE_CAPS, WAKE_HULL } from './water-fx.js';
import { BOAT } from '../config.js';

const STERN = BOAT.length / 2 - 0.3; // от ЦТ до транца на ВЛ, м
const MIN_SPEED = 0.3; // м/с: медленнее след не пишется
// с, сглаживание скорости: от неё цвет участка (WAKE_GLSL), переход по длине ленты плавный
const SPEED_LAG = 1.0;
// м/с, порог светлой сердцевины ленты (~1.5 уз) с гистерезисом: на малом ходу лента только цветом контура
const CORE_ON = 0.8, CORE_OFF = 0.7;
// с, сглаживание сноса кормы (см. update): без него ширина дрожит от шага физики
const SWEEP_LAG = 0.3;
// м за началом следа (самое широкое место корпуса), на которых лента из полосы у борта разворачивается в обычный след:
// ширина, снос, волнистый край
export const TAIL = 3.0;
// сечений контура, по которым ищется самое широкое место корпуса
const WIDEST_PROBES = 24;

// Кильватерный след: точки у кормы через метр пути, на поворотах чаще, от новой к старой; передаётся в шейдер воды (WAKE_GLSL).
// Задним ходом след тянется от носа (dir в update).
// Когда точки кончаются, выбрасывается та, что меньше всех отходит от хорды соседей: прямые участки
// прореживаются, изгибы остаются гладкими, а хвост живёт весь свой срок.
// Точка — середина полосы, которую заметает корпус: на повороте корму заносит наружу, а корпус от кормы до
// миделя идёт внутри её следа, поэтому лента шире и смещена к внутреннему борту (на дрейфе — к наветренному).
// Светлая сердцевина — отдельные «пробеги» между переходами порога CORE_ON/CORE_OFF: у точки — расстояние вдоль
// следа до ближайшей границы своего пробега (минус — вне сердцевины) и номер круга этого конца пробега.
// Концы сердцевины — настоящие круги (caps: центр на оси следа в полуширине от границы, радиус — полуширина):
// по расстоянию вдоль следа полукруг на изгибе широкой ленты искажался бы.
// a — (x, z, одометр, доля жизни 0..1 — возраст / life), b — (полуширина ленты, м; скорость, сглаженная, см. SPEED_LAG; до границы
// сердцевины, м; номер круга конца, −1 — нет). Одометр — путь в метрах: продольная координата узора,
// кружево приклеено к воде и не скользит за лодкой.
// Волна у борта — та же лента, продлённая от кормы к носу (hull в update): перед кормой каждый кадр WAKE_HULL «живых»
// точек от носа, полуширина — корпус по контуру ватерлинии (waterline.js) плюс ширина пены буруна (bowWave.widthAt).
// Середину ленты прячет корпус, снаружи остаётся полоса вида кильватера; у носа лента кончается кругом — «подушка».
// Точки корпуса — от носа до самого широкого места; там начинается след (пишутся его точки), корму накрывает он.
// За началом лента TAIL метров разворачивается из полосы у борта в обычный след: полуширина, сдвиг на снос и доля
// корпуса плавно переходят. На повороте след от миделя накрывает корму сам — без излома у транца.
// inner — доля полуширины, занятая корпусом (WAKE_GLSL: волнистый край только у пены, дыр нет).
export function createWake() {
  const a = Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4());
  const b = Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4());
  // круги концов сердцевины (x, z, радиус): у пробега k начало — 2k, конец — 2k + 1
  const caps = Array.from({ length: WAKE_CAPS }, () => new THREE.Vector3());
  // габарит следа (minX, minZ, maxX, maxZ) с шириной ленты — шейдер воды за ним след не считает
  const box = new THREE.Vector4();
  // описанные круги групп по WAKE_GROUP сегментов (x, z, радиус²) с шириной ленты: шейдер проверяет сначала их
  const groups = Array.from({ length: WAKE_POINTS / WAKE_GROUP }, () => new THREE.Vector3());
  // x, z — середина полосы (без волны у борта) или самое широкое место корпуса (с ней: hull = true, сдвиг на снос —
  // при выгрузке, nx, nz)
  const points = []; // { x, z, odo, t0, s, psi, sweep, run, hull, nx, nz }
  // life — сколько секунд живёт участок ленты (длина следа = скорость × life); width — полуширина у кормы в долях полуширины лодки;
  // spread — на сколько полуширин у кормы лента расширяется за секунду; holes — длина ячейки кружева, м;
  // edge — толщина контура перемычек (0 — один тон); rim — ширина края ленты у кормы, пока дыры его не прорвали (в ячейках); цвета — заливка ленты и контур (панель «Кильватер»);
  // lace — дыры кружева
  // hull — волна у борта (продление ленты вдоль корпуса); segments — границы сегментов (отладка: линии на точках следа)
  const settings = { enabled: true, lace: true, hull: true, segments: false, life: 20, width: 1.1, spread: 0.12, holes: 1.0, edge: 0.1, rim: 0.15, color: '#9ad8e6', edgeColor: '#2f9cc8' };
  // доля корпуса в полуширине у точек корпуса; hullCount — сколько сегментов корпуса в начале a, b (начало следа —
  // a[hullCount]); tail — (одометр начала следа, доля корпуса там, TAIL): переход за началом в WAKE_GLSL
  const inner = new Float32Array(WAKE_HULL + 1);
  const tail = new THREE.Vector3();
  const state = { a, b, caps, box, groups, inner, tail, hullCount: 0, count: 0, settings };
  // начало следа (самое широкое место корпуса): середина (x, z), полуширина полосы, доля корпуса — последнее, что
  // было (хвост сходится к ней)
  const head = { x: 0, z: 0, hw: 0, inner: 0, valid: false };
  let odo = 0, px = null, pz = null, sm = 0, lastTime = null;
  // корма в прошлом кадре и сглаженный снос: смещение миделя поперёк хода кормы, м (плюс — влево от хода)
  let sx = null, sz = null, sweep = 0;
  // куда идём: 1 — вперёд (след от кормы), −1 — задним ходом (след от носа); меняется, когда ход больше MIN_SPEED
  let dir = 1;
  // текущий пробег сердцевины { start, end } по одометру; end = Infinity, пока идёт
  let run = null;
  const coreDist = (o, r) => (r ? Math.min(o - r.start, r.end - o) : -1);

  // ширина от скорости не зависит: след всегда чуть шире лодки, начало — полуокружность (WAKE_GLSL);
  // sweep — снос корпуса: полоса шире на его половину с каждой стороны
  function halfWidth(age, sweep) {
    return (BOAT.beam * 0.5 * settings.width + Math.abs(sweep) * 0.5) * (1 + settings.spread * age);
  }

  // точка на оси следа по одометру (за концами — продолжение крайнего сегмента) и полуширина там
  function along(n, o, out) {
    let i = 0;
    while (i < n - 2 && a[i + 1].z > o) i++;
    const A = a[i], B = a[i + 1], l = A.z - B.z || 1e-6, t = (A.z - o) / l;
    out.set(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, b[i].x + (b[i + 1].x - b[i].x) * Math.min(1, Math.max(0, t)));
    return out;
  }

  // круги концов сердцевины: центр в полуширине от границы пробега внутрь него, радиус — полуширина.
  // Пробегов в ленте до WAKE_CAPS / 2 (самые новые), у остальных шейдер скругляет по расстоянию вдоль следа
  const tmp = new THREE.Vector3();
  function placeCaps(n, runs) {
    if (n < 2) return;
    const seen = [];
    for (let i = 0; i < n; i++) {
      const r = runs[i];
      if (!r || b[i].z <= 0) continue;
      let k = seen.indexOf(r);
      if (k < 0) {
        if (seen.length >= WAKE_CAPS / 2) continue;
        k = seen.push(r) - 1;
        const ws = along(n, r.start, tmp).z;
        along(n, r.start + ws, caps[2 * k]).z = ws;
        if (r.end < Infinity) { const we = along(n, r.end, tmp).z; along(n, r.end - we, caps[2 * k + 1]).z = we; }
      }
      // ближе к началу пробега — его круг, к концу — круг конца
      b[i].w = a[i].z - r.start <= r.end - a[i].z ? 2 * k : 2 * k + 1;
    }
  }

  // контур ватерлинии в осях курса: x — вперёд от ЦТ, y — поперёк (плюс — влево)
  let lx = new Float32Array(0), ly = new Float32Array(0);
  // полуширина корпуса по борту на x: самая дальняя точка рёбер контура, что пересекают x; side — знак y
  function breadth(n, x, side) {
    let m = 0;
    for (let c = 0; c < n; c++) {
      const c1 = (c + 1) % n, x0 = lx[c], x1 = lx[c1];
      if ((x - x0) * (x - x1) > 0 || x0 === x1) continue;
      const y = (ly[c] + (ly[c1] - ly[c]) * (x - x0) / (x1 - x0)) * side;
      if (y > m) m = y;
    }
    return m;
  }

  // точки корпуса от носа до самого широкого места в a, b[0..WAKE_HULL] (одометр, сердцевина — в update), оно — в head.
  // Станции гуще к носу и к началу следа: полуширина между ними линейна, на выпуклом носу хорда иначе уходит под корпус
  function placeHull(boat, hull) {
    const rs = hull.contour, n = rs.pw.length / 3;
    if (lx.length < n) { lx = new Float32Array(n); ly = new Float32Array(n); }
    const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi), sx = -fz, sz = fx;
    let xb = -Infinity, xs = Infinity;
    for (let c = 0; c < n; c++) {
      const dx = rs.pw[c * 3] - boat.x, dz = rs.pw[c * 3 + 2] - boat.z;
      lx[c] = dx * fx + dz * fz; ly[c] = dx * sx + dz * sz;
      if (lx[c] > xb) xb = lx[c];
      if (lx[c] < xs) xs = lx[c];
    }
    const L = Math.max(xb - xs, 0.1);
    // самое широкое место — по сумме бортов (при крене профиль несимметричный)
    let x1 = (xb + xs) / 2, wMax = -1;
    for (let k = 1; k < WIDEST_PROBES; k++) {
      const xk = xb + (xs - xb) * k / WIDEST_PROBES, wk = breadth(n, xk, 1) + breadth(n, xk, -1);
      if (wk > wMax) { wMax = wk; x1 = xk; }
    }
    // у носа станция чуть внутри: на самом конце рёбра контура идут поперёк
    const x0 = xb - 0.01;
    for (let i = 0; i <= WAKE_HULL; i++) {
      const xi = x0 + (x1 - x0) * (1 - Math.cos(Math.PI * i / WAKE_HULL)) / 2;
      const hl = breadth(n, xi, 1), hr = breadth(n, xi, -1);
      const sgm = Math.min(Math.max((xb - xi) / L, 0), 1);
      // от носа до миделя полоса узкая — две толщины контура (контур в WAKE_GLSL — edge / 2 полуширины ленты:
      // w = edge·(корпус + w)); у самого форштевня корпус берём не уже 0.3 м, иначе полоса там исчезает.
      // К корме — полная ширина пены буруна
      const ins = (hl + hr) / 2, wf = hull.widthAt(sgm);
      const wn = Math.min(wf, settings.edge * Math.max(ins, 0.3) / (1 - settings.edge));
      const h = ins + wn + (wf - wn) * THREE.MathUtils.smoothstep(sgm, 0.5, 0.85);
      const cy = (hl - hr) / 2;
      a[i].set(boat.x + fx * xi + sx * cy, boat.z + fz * xi + sz * cy, 0, 0);
      b[i].set(h, 0, 0, -1);
      inner[i] = Math.min(ins / Math.max(h, 1e-3), 1);
    }
    const t = a[WAKE_HULL];
    head.x = t.x; head.z = t.y; head.hw = b[WAKE_HULL].x; head.inner = inner[WAKE_HULL]; head.valid = true;
  }

  // выбросить внутреннюю точку, меньше всех отходящую от хорды соседей (две новые и самую старую не трогаем)
  function simplify() {
    let best = -1, bestDev = Infinity;
    for (let i = 2; i < points.length - 1; i++) {
      const p = points[i - 1], q = points[i], r = points[i + 1];
      const dx = r.x - p.x, dz = r.z - p.z, l = Math.hypot(dx, dz) || 1e-6;
      const dev = Math.abs(dx * (q.z - p.z) - dz * (q.x - p.x)) / l;
      if (dev < bestDev) { bestDev = dev; best = i; }
    }
    if (best > 0) points.splice(best, 1); else points.pop();
  }

  // hull — { contour, widthAt }: контур ватерлинии и ширина пены у борта по доле длины от носа (bow-wave.js)
  function update(time, boat, hull) {
    const dt = lastTime === null ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    // задним ходом след тянется от носа: всё ниже «корма» — тот конец корпуса, что идёт последним.
    // При смене хода конец прыгает на длину корпуса — снос в этот кадр не считаем (скорость конца ложная);
    // ленту от прежнего следа до нового конца прячет корпус, одометр честно прибавляет прыжок
    const nd = boat.u < -MIN_SPEED ? -1 : boat.u > MIN_SPEED ? 1 : dir;
    if (nd !== dir) { dir = nd; sx = null; }
    // корма и направление её хода; hx, hz — курс (к носу)
    const hx = Math.sin(boat.psi), hz = -Math.cos(boat.psi);
    const kx = boat.x - dir * hx * STERN, kz = boat.z - dir * hz * STERN;
    let nx = -hz, nz = hx; // поперёк хода кормы; пока стоим — поперёк курса
    if (sx !== null && dt > 0) {
      const vx = (kx - sx) / dt, vz = (kz - sz) / dt, v = Math.hypot(vx, vz);
      if (v > MIN_SPEED) { nx = -vz / v; nz = vx / v; }
      // мидель относительно кормы поперёк её хода: STERN·sin β, β — угол между курсом и ходом кормы
      sweep += (dir * STERN * (hx * nx + hz * nz) - sweep) * (1 - Math.exp(-dt / SWEEP_LAG));
    }
    sx = kx; sz = kz;
    // середина заметаемой полосы — на полпути от кормы к миделю поперёк хода
    const x = kx + nx * sweep * 0.5, z = kz + nz * sweep * 0.5;
    if (px !== null) odo += Math.hypot(x - px, z - pz);
    px = x; pz = z;
    // волна у борта: только передним ходом, по свежему контуру ватерлинии; точки следа — в самом широком месте корпуса
    const withHull = settings.hull && hull && hull.contour.valid && dir === 1 && boat.u > MIN_SPEED && !boat.capsized;
    if (withHull) placeHull(boat, hull);
    const u = Math.abs(boat.u);
    sm += (u - sm) * (1 - Math.exp(-dt / SPEED_LAG));
    const s = sm;
    // начало и конец пробега сердцевины; на границе ставим точку, чтобы скругление легло на место
    let edgeOfRun = false;
    if (!run && s > CORE_ON) { run = { start: odo, end: Infinity }; edgeOfRun = true; }
    else if (run && s < CORE_OFF) { run.end = odo; run = null; edgeOfRun = true; }
    const last = points[0];
    // стоя на месте след не пишем; на повороте (курс ушёл на 3°) точка ставится раньше метра
    if (u > MIN_SPEED) {
      const dist = last ? odo - last.odo : Infinity;
      const turn = last ? Math.abs(Math.atan2(Math.sin(boat.psi - last.psi), Math.cos(boat.psi - last.psi))) : 0;
      if (dist > 1.0 || (dist > 0.3 && turn > 3 * Math.PI / 180) || (edgeOfRun && dist > 0.05)) {
        points.unshift(withHull
          ? { x: head.x, z: head.z, odo, t0: time, s, psi: boat.psi, sweep, run, hull: true, nx, nz }
          : { x, z, odo, t0: time, s, psi: boat.psi, sweep, run, hull: false });
      }
    }
    // доля жизни точки — по времени: у быстрого судна след сам выходит длиннее
    const lifeOf = (p) => (time - p.t0) / settings.life;
    // хвост за концом жизни выбрасываем, только если и предпоследняя точка за ним: последний сегмент
    // пересекает конец ленты, и шейдер обрезает её там, а не на точке (без скачка)
    while (points.length > 1 && lifeOf(points[points.length - 2]) >= 1) points.pop();
    while (points.length > WAKE_POINTS - 1 - WAKE_HULL) simplify();
    let n = 0;
    const runs = []; // пробег каждой точки в массиве
    tail.set(odo, 0, TAIL);
    if (withHull) {
      // одометр — путь вперёд от начала следа: рисунок стоит в воде, порядок «убывает с номером» сохраняется
      let od = odo;
      for (let i = WAKE_HULL; i >= 0; i--) {
        if (i < WAKE_HULL) od += Math.hypot(a[i].x - a[i + 1].x, a[i].y - a[i + 1].y);
        a[i].z = od; b[i].y = s; b[i].z = coreDist(od, run);
      }
      for (let i = 0; i <= WAKE_HULL; i++) runs.push(run);
      n = WAKE_HULL + 1;
      tail.y = head.inner;
    } else if (points.length && u > MIN_SPEED && odo - points[0].odo > 0.05) {
      // текущая корма (если лодка идёт, есть хвост и корма успела отойти от последней точки)
      a[0].set(x, z, odo, 0); b[0].set(halfWidth(0, sweep), s, coreDist(odo, run), -1); runs.push(run); n = 1;
    }
    state.hullCount = withHull ? WAKE_HULL : 0;
    for (const p of points) {
      // точка, только что поставленная в начале следа, совпадает с ним
      if (withHull && odo - p.odo <= 0.05) continue;
      const age = time - p.t0;
      let hw = halfWidth(age, p.sweep), x = p.x, z = p.z;
      if (p.hull) {
        // за началом: из полосы у борта в обычный след — ширина и сдвиг на снос. Мидель — на sweep поперёк хода от
        // кормы, середина заметаемой полосы — на полпути назад к корме
        const e = THREE.MathUtils.smoothstep(odo - p.odo, 0, TAIL);
        if (head.valid) hw = head.hw + (hw - head.hw) * e;
        x -= p.nx * p.sweep * 0.5 * e; z -= p.nz * p.sweep * 0.5 * e;
      }
      a[n].set(x, z, p.odo, lifeOf(p)); b[n].set(hw, p.s, coreDist(p.odo, p.run), -1);
      runs.push(p.run); n++;
    }
    state.count = n;
    placeCaps(n, runs);
    box.set(Infinity, Infinity, -Infinity, -Infinity);
    for (let i = 0; i < n; i++) {
      // волнистый край — до +28% (WAKE_GLSL), с запасом
      const r = b[i].x * 1.3 + 0.5;
      box.x = Math.min(box.x, a[i].x - r); box.y = Math.min(box.y, a[i].y - r);
      box.z = Math.max(box.z, a[i].x + r); box.w = Math.max(box.w, a[i].y + r);
    }
    for (let g = 0; g * WAKE_GROUP < n - 1; g++) {
      const i0 = g * WAKE_GROUP, i1 = Math.min(i0 + WAKE_GROUP, n - 1);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, w = 0;
      for (let i = i0; i <= i1; i++) {
        minX = Math.min(minX, a[i].x); maxX = Math.max(maxX, a[i].x);
        minZ = Math.min(minZ, a[i].y); maxZ = Math.max(maxZ, a[i].y);
        w = Math.max(w, b[i].x);
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      let r = 0;
      for (let i = i0; i <= i1; i++) r = Math.max(r, Math.hypot(a[i].x - cx, a[i].y - cz));
      r += w * 1.3 + 0.5;
      groups[g].set(cx, cz, r * r);
    }
  }

  function reset() { points.length = 0; state.count = 0; state.hullCount = 0; head.valid = false; tail.set(0, 0, TAIL); px = pz = sx = sz = lastTime = null; sm = 0; sweep = 0; run = null; dir = 1; }

  return Object.assign(state, { update, reset });
}
