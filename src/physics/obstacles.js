// Препятствия на воде: буи и знаки (круги), мостки и причалы (прямоугольники). Без three и DOM:
// тестируется в jsc (src/debug/run-collide.mjs).
// Корпус лодки — цепочка кругов по ДП. Удар — импульс в точке контакта (с рысканием от рычага) и
// выталкивание. Лёгкий знак (mass конечна) отъезжает сам и возвращается на якорной пружине,
// тяжёлый буй и мостки неподвижны.

// круги корпуса: [смещение от ЦТ к носу, м; радиус, м] — длина 6, ширина 2.8
export const HULL_CIRCLES = [[2.55, 0.45], [1.6, 1.0], [0.3, 1.35], [-0.9, 1.3], [-2.2, 1.0]];
const RESTITUTION = 0.3;
const FRICTION = 0.2;      // трение вдоль поверхности (доля нормального импульса)
const PUSH_MAX = 0.3;      // выталкивание за шаг, м (как у мели)
const ANCHOR_W = 1.6;      // рад/с: якорная пружина лёгкого знака (возврат за ~3 с)
const ANCHOR_ZETA = 0.8;
const ANCHOR_MAX = 1.5;    // м: дальше якорь не пускает
const REACH = 4;           // м: дальше от ЦТ лодки корпус не достаёт (3 + запас)
const CONTACT_GAP = 0.5;   // с: новое касание того же объекта — не раньше

export function createObstacles(cell = 32) {
  const grid = new Map(), list = [];
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  const insert = (o, x0, z0, x1, z1) => {
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(o);
      }
    }
  };
  const light = [];
  let stamp = 0;

  const obs = {
    list,
    // буй или знак: mass — кг (Infinity — неподвижен); у лёгкого смещение ox, oz от якоря
    addCircle({ id, kind = 'buoy', x, z, r, mass = Infinity }) {
      const o = { type: 'circle', id, kind, x0: x, z0: z, x, z, r, mass, ox: 0, oz: 0, vx: 0, vz: 0, lastHit: -1, mark: 0 };
      list.push(o);
      // лёгкий знак может отъехать на ANCHOR_MAX — в сетку с запасом
      const pad = r + (Number.isFinite(mass) ? ANCHOR_MAX : 0);
      insert(o, x - pad, z - pad, x + pad, z + pad);
      if (Number.isFinite(mass)) light.push(o);
      return o;
    },
    // прямоугольник: центр (x, z), rot — поворот как у построек (+Z объекта → (sin rot, cos rot)), len — вдоль, w — поперёк
    addBox({ id, kind = 'pier', x, z, rot, len, w }) {
      const ax = Math.sin(rot), az = Math.cos(rot);
      const o = { type: 'box', id, kind, x, z, ax, az, hl: len / 2, hw: w / 2, mass: Infinity, lastHit: -1, mark: 0 };
      list.push(o);
      const ex = Math.abs(ax) * o.hl + Math.abs(az) * o.hw, ez = Math.abs(az) * o.hl + Math.abs(ax) * o.hw;
      insert(o, x - ex, z - ez, x + ex, z + ez);
      return o;
    },
    // объекты, которые могут касаться круга (x, z, rad) — без повторов
    near(x, z, rad, out = []) {
      out.length = 0;
      stamp++;
      for (let i = Math.floor((x - rad) / cell); i <= Math.floor((x + rad) / cell); i++) {
        for (let j = Math.floor((z - rad) / cell); j <= Math.floor((z + rad) / cell); j++) {
          const c = grid.get(key(i, j));
          if (c) for (const o of c) if (o.mark !== stamp) { o.mark = stamp; out.push(o); }
        }
      }
      return out;
    },
    // лёгкие знаки: якорная пружина и вязкость воды
    step(dt) {
      const k = ANCHOR_W * ANCHOR_W, c = 2 * ANCHOR_ZETA * ANCHOR_W;
      for (const o of light) {
        if (!o.ox && !o.oz && !o.vx && !o.vz) continue;
        o.vx += (-k * o.ox - c * o.vx) * dt; o.vz += (-k * o.oz - c * o.vz) * dt;
        o.ox += o.vx * dt; o.oz += o.vz * dt;
        clampAnchor(o);
        if (Math.abs(o.ox) + Math.abs(o.oz) < 1e-4 && Math.abs(o.vx) + Math.abs(o.vz) < 1e-3) o.ox = o.oz = o.vx = o.vz = 0;
        o.x = o.x0 + o.ox; o.z = o.z0 + o.oz;
      }
    },
    // столкновения лодки за шаг; возвращает новое касание { id, kind, speed } или null
    collide(boat, dt, time) {
      obs.step(dt);
      const near = obs.near(boat.x, boat.z, REACH, _near);
      if (!near.length) return null;
      let event = null;
      for (const o of near) {
        const hit = deepest(boat, o);
        if (!hit) continue;
        const vn = respond(boat, o, hit);
        if (time - o.lastHit > CONTACT_GAP && (event === null || -vn > event.speed)) event = { id: o.id, kind: o.kind, speed: Math.max(0, -vn) };
        o.lastHit = time;
      }
      return event;
    },
  };
  return obs;
}
const _near = [];

function clampAnchor(o) {
  const d = Math.hypot(o.ox, o.oz);
  if (d <= ANCHOR_MAX) return false;
  const nx = o.ox / d, nz = o.oz / d;
  o.ox = nx * ANCHOR_MAX; o.oz = nz * ANCHOR_MAX;
  const vn = o.vx * nx + o.vz * nz;
  if (vn > 0) { o.vx -= vn * nx; o.vz -= vn * nz; }
  return true;
}

// самое глубокое касание корпуса с объектом: точка контакта (мир), нормаль от объекта к лодке, глубина
const _hit = { px: 0, pz: 0, nx: 0, nz: 0, pen: 0 };
function deepest(boat, o) {
  const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi);
  let best = 0;
  for (const [s, r] of HULL_CIRCLES) {
    const cx = boat.x + fx * s, cz = boat.z + fz * s;
    let nx, nz, d, qx, qz;
    if (o.type === 'circle') {
      nx = cx - o.x; nz = cz - o.z; d = Math.hypot(nx, nz);
      if (d >= r + o.r) continue;
      if (d < 1e-6) { nx = -fx; nz = -fz; d = 1e-6; } // в центре — назад по ДП
      nx /= d; nz /= d;
      const pen = r + o.r - d;
      if (pen <= best) continue;
      best = pen; qx = o.x + nx * o.r; qz = o.z + nz * o.r;
    } else {
      // ближайшая точка прямоугольника к центру круга
      const dx = cx - o.x, dz = cz - o.z;
      const la = dx * o.ax + dz * o.az, lb = dx * o.az - dz * o.ax; // вдоль и поперёк (b = (az, −ax))
      const ca = Math.max(-o.hl, Math.min(o.hl, la)), cb = Math.max(-o.hw, Math.min(o.hw, lb));
      let pen;
      if (ca === la && cb === lb) {
        // центр внутри: выходим через ближнюю сторону
        const ea = o.hl - Math.abs(la), eb = o.hw - Math.abs(lb);
        if (ea < eb) { const sg = Math.sign(la) || 1; nx = o.ax * sg; nz = o.az * sg; pen = r + ea; qx = o.x + o.ax * o.hl * sg + o.az * lb; qz = o.z + o.az * o.hl * sg - o.ax * lb; }
        else { const sg = Math.sign(lb) || 1; nx = o.az * sg; nz = -o.ax * sg; pen = r + eb; qx = o.x + o.ax * la + o.az * o.hw * sg; qz = o.z + o.az * la - o.ax * o.hw * sg; }
      } else {
        qx = o.x + o.ax * ca + o.az * cb; qz = o.z + o.az * ca - o.ax * cb;
        nx = cx - qx; nz = cz - qz; d = Math.hypot(nx, nz);
        if (d >= r) continue;
        nx /= d; nz /= d; pen = r - d;
      }
      if (pen <= best) continue;
      best = pen;
    }
    _hit.px = qx; _hit.pz = qz; _hit.nx = nx; _hit.nz = nz; _hit.pen = best;
  }
  return best > 0 ? _hit : null;
}

// импульс и выталкивание; возвращает скорость сближения в точке контакта (< 0 — шли навстречу)
function respond(boat, o, h) {
  const c = boat.cfg, m = c.mass, I = c.Izz;
  const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi), sx = Math.cos(boat.psi), sz = Math.sin(boat.psi);
  // точка контакта и нормаль в осях лодки: s — к носу, y — к правому борту
  const rx = h.px - boat.x, rz = h.pz - boat.z;
  const s = rx * fx + rz * fz, y = rx * sx + rz * sz;
  const ns = h.nx * fx + h.nz * fz, ny = h.nx * sx + h.nz * sz;
  // скорость точки лодки (r > 0 — вправо: нос к правому борту, правый борт назад) минус скорость знака
  let up = boat.u - boat.r * y, vp = boat.v + boat.r * s;
  const lightObj = Number.isFinite(o.mass);
  if (lightObj) { up -= o.vx * fx + o.vz * fz; vp -= o.vx * sx + o.vz * sz; }
  const vn = up * ns + vp * ny;
  const arm = s * ny - y * ns; // рычаг нормальной силы по рысканию
  const invObj = lightObj ? 1 / o.mass : 0;
  if (vn < 0) {
    const jn = -(1 + RESTITUTION) * vn / (1 / m + arm * arm / I + invObj);
    // трение вдоль поверхности, не больше FRICTION·jn
    const ts = -ny, ty = ns, vt = up * ts + vp * ty, armT = s * ty - y * ts;
    const jt = Math.max(-FRICTION * jn, Math.min(FRICTION * jn, -vt / (1 / m + armT * armT / I + invObj)));
    const js = jn * ns + jt * ts, jy = jn * ny + jt * ty;
    boat.u += js / m; boat.v += jy / m;
    boat.r += (s * jy - y * js) / I;
    if (lightObj) {
      // знаку — обратный импульс (в мировых осях)
      const wx = js * fx + jy * sx, wz = js * fz + jy * sz;
      o.vx -= wx / o.mass; o.vz -= wz / o.mass;
    }
  }
  // выталкивание: лёгкий знак отъезжает (пока пускает якорь), остальное — лодка
  let pen = Math.min(h.pen, PUSH_MAX);
  if (lightObj) {
    const share = m / (m + o.mass);
    o.ox -= h.nx * pen * share; o.oz -= h.nz * pen * share;
    const ox = o.ox, oz = o.oz;
    const clamped = clampAnchor(o);
    // не пустил якорь — недоехавшее доталкивает лодка
    pen = pen * (1 - share) + (clamped ? Math.hypot(ox - o.ox, oz - o.oz) : 0);
    o.x = o.x0 + o.ox; o.z = o.z0 + o.oz;
  }
  boat.x += h.nx * pen; boat.z += h.nz * pen;
  return vn;
}
