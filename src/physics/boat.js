import { BOAT, G, RHO_WATER, DEG } from '../config.js';
import { Sail } from './sail.js';
import { wrapPi } from './wind.js';

// Коэффициент подъёмной силы крыла малого удлинения: линейный участок,
// плато после срыва и плавное падение (у коротких крыльев срыв мягкий).
function foilCl(beta, ar, stall) {
  const slope = 2 * Math.PI / (1 + 2 / ar);
  const a = Math.abs(beta);
  const clStall = slope * stall;
  if (a <= stall) return slope * beta;
  const plateau = stall + 10 * DEG;
  if (a <= plateau) return Math.sign(beta) * clStall;
  // пластина: за плато подъёмная сила спадает как cos и обращается в ноль при 90°,
  // при обратном потоке (>90°) меняет знак
  const t = (a - plateau) / (Math.PI / 2 - plateau);
  return Math.sign(beta) * clStall * Math.cos(t * Math.PI / 2);
}

// Силы на крыле (шверт/руль) в связанной СК. u, v — локальная скорость воды относительно
// крыла (скорость лодки в точке крыла), delta — поворот хорды (руль), cd0 — профильное сопротивление.
// out — куда записать { fx, fy, cl } (шаг физики 120 Гц — без новых объектов).
function foilForces(u, v, area, ar, stall, delta, cd0, cc, out) {
  const V = Math.hypot(u, v);
  if (V < 0.03) { out.fx = 0; out.fy = 0; out.cl = 0; return out; }
  const beta = wrapPi(Math.atan2(v, u) + delta);
  const q = 0.5 * RHO_WATER * V * V * area;
  const cl = foilCl(beta, ar, stall);
  const L = q * cl;
  const D = q * (cd0 + cl * cl / (Math.PI * ar * 0.9));
  const sb = Math.sin(beta);
  const N = q * cc * sb * Math.abs(sb);
  // подъёмная ⟂ потоку, сопротивление вдоль потока, поперечная сила ⟂ хорде
  const fx = L * (v / V) - D * (u / V) - N * Math.sin(delta);
  const fy = L * (-u / V) - D * (v / V) - N * Math.cos(delta);
  out.fx = fx; out.fy = fy; out.cl = cl;
  return out;
}

// положения рулевого слева направо: откренка L, банка L, банка R, откренка R
export const CREW_POSITIONS = [-2, -1, 1, 2];
// следующее положение: 'left' / 'right' — шаг по цепочке, 'swap' — на другой борт в то же положение
export function crewMove(pos, action) {
  if (action === 'swap') return -pos;
  const i = CREW_POSITIONS.indexOf(pos) + (action === 'left' ? -1 : 1);
  return CREW_POSITIONS[Math.max(0, Math.min(CREW_POSITIONS.length - 1, i))];
}

export class Boat {
  constructor(cfg = BOAT) {
    this.cfg = cfg;
    this.sail = new Sail(cfg);
    this._bf = { fx: 0, fy: 0, cl: 0 }; this._rf = { fx: 0, fy: 0, cl: 0 }; this._rf0 = { fx: 0, fy: 0, cl: 0 }; // скретч для foilForces
    this.reset(0, 0, 90 * DEG);
  }

  reset(x, z, psi) {
    this.x = x; this.z = z; this.psi = psi;
    this.u = 0; this.v = 0; this.r = 0;
    this.phi = 0; this.phiDot = 0;
    this.theta = 0; this.thetaDot = 0;
    this.y = 0; this.yDot = 0;
    this._wavePrev = { h: 0, theta: 0, phi: 0, ok: false }; // плоскость воды прошлого шага: её скорость — упреждение качки
    this.rudder = 0;
    this.board = 1;
    this.crewY = 0; this.crewTarget = 0;
    this.crewPos = 0; // 0 — выберется наветренная банка на первом шаге
    this.crewSeat = { side: 1, hike: false }; // для модели: борт и откренка
    this.maneuver = { count: 0, type: null }; this.awaSide = 0;
    this.water = 0;
    this.capsized = false;
    this.aground = false;
    this.boardAground = false;
    this.leeway = 0;
    this.aw = { awa: 0, aws: 0, twa: 0, tws: 0 };
    this.forces = {};
    // баланс для HUD (м от ЦТ): ЦП с выносом по гику, ЦБС, тенденция (>0 — приводится)
    this.balance = { ce: 0, ceY: 0, clr: 0, clrOk: false, tend: 0 };
    this._clrS = null; this._tendS = 0;
    this.waveTilt = { phi: 0, theta: 0, h: 0 };
    this.gybeFlash = 0;
    this.sail.sheet = this.cfg.sheetMax;
    this.sail.boom = 0;
    this.sail.gybing = false;
  }

  righten(windDir) {
    this.capsized = false;
    this.phi = 0; this.phiDot = 0;
    this.u = 0; this.v = 0; this.r = 0;
    this.water = 0;
    this.psi = windDir;
    this.sail.sheet = this.cfg.sheetMax;
    this.sail.boom = 0;
    this.sail.gybing = false;
  }

  get speed() { return Math.hypot(this.u, this.v); }
  get totalMass() {
    return this.cfg.mass * (1 + this.cfg.swampMassFrac * this.water) + this.cfg.crewMass;
  }

  // Восстанавливающее плечо (м) по крену относительно поверхности воды.
  gz(phi) {
    const c = this.cfg;
    const a = Math.abs(phi);
    const raw = c.gm * Math.sin(a) * (1 - (a / c.avs) * (a / c.avs));
    return Math.sign(phi) * raw * (1 - c.swampGzLoss * this.water);
  }

  // controls: { rudder: -1..1, sheet: -1..1 (+1 выбрать), board: -1..1 (+1 опустить),
  //             crewPos: −2|−1|1|2 — необязательно, задать положение рулевого (иначе остаётся this.crewPos) }
  // shore — карта берега с info(x, z) → { dist, depth, nx, nz } (shore-map.js); null — без мели
  step(dt, controls, wind, waves, shore) {
    const c = this.cfg;
    const cap = this.capsized;

    // --- органы управления ---
    if (!cap) {
      if (controls.rudderAngle !== undefined) {
        this.rudder = Math.max(-c.rudderMax, Math.min(c.rudderMax, controls.rudderAngle));
      } else if (controls.rudder) {
        this.rudder = Math.max(-c.rudderMax, Math.min(c.rudderMax, this.rudder + controls.rudder * c.rudderRate * dt));
      } else {
        const back = c.rudderReturnRate * dt;
        if (Math.abs(this.rudder) <= back) this.rudder = 0;
        else this.rudder -= Math.sign(this.rudder) * back;
      }
      if (controls.board) this.board = Math.max(0, Math.min(1, this.board + controls.board * c.boardRate * dt));
    }
    // --- ветер и парус ---
    const aw = wind.apparent(this.psi, this.u, this.v, this.aw);

    // рулевой: 4 положения (CREW_POSITIONS), знак — борт (+ правый), |2| — откренка. 0 — ещё не выбрано: наветренная банка
    if (controls.crewPos) this.crewPos = controls.crewPos;
    if (!this.crewPos) this.crewPos = Math.sign(this.aw.twa || 1);
    this.crewSeat.side = Math.sign(this.crewPos);
    this.crewSeat.hike = Math.abs(this.crewPos) === 2;
    this.crewTarget = this.crewSeat.side * (this.crewSeat.hike ? c.crewMaxY : c.crewBenchY);
    const dc = this.crewTarget - this.crewY;
    const mvc = c.crewRate * dt;
    this.crewY = Math.abs(dc) <= mvc ? this.crewTarget : this.crewY + Math.sign(dc) * mvc;

    if (controls.sheetAngle !== undefined) this.sail.sheet = Math.max(c.sheetMin, Math.min(c.sheetMax, controls.sheetAngle));
    const wasGybing = this.sail.gybing;
    const sf = this.sail.update(dt, aw.awa, aw.aws, this.phi, cap ? 0 : controls.sheet);
    // события манёвров для анимации: maneuver.count растёт на каждом повороте.
    // Фордевинд — начало переброски гика; оверштаг — вымпельный ветер сменил борт носом (|awa| < 90°)
    if (!wasGybing && this.sail.gybing) { this.maneuver.count++; this.maneuver.type = 'gybe'; }
    if (Math.abs(aw.awa) > 3 * DEG && Math.abs(aw.awa) < Math.PI / 2) {
      const s = Math.sign(aw.awa);
      if (this.awaSide && s !== this.awaSide) { this.maneuver.count++; this.maneuver.type = 'tack'; }
      this.awaSide = s;
    }
    const gybeImp = this.sail.takeGybeImpulse();
    if (gybeImp) this.gybeFlash = 1.5;
    this.gybeFlash = Math.max(0, this.gybeFlash - dt);

    // --- гидродинамика ---
    const u = this.u, v = this.v, r = this.r;
    const V = Math.hypot(u, v);
    const beta = V > 0.05 ? Math.atan2(v, u) : 0;
    this.leeway = beta;
    const qw = 0.5 * RHO_WATER * V * V;

    // шверт
    const ext = this.board;
    const bArea = c.boardArea * ext;
    const bAR = c.boardAR * Math.max(0.25, ext);
    const bf = foilForces(u, v, bArea, bAR, c.boardStall, 0, c.boardCd0, 1.0, this._bf);
    const bFx = bf.fx, bFy = bf.fy;
    const bX = c.boardXUp + (c.boardX - c.boardXUp) * ext;

    // корпус: продольное сопротивление с «горбом» у корпусной скорости
    const fr = Math.abs(u) / c.hullSpeed;
    const R = (c.resistC1 + c.resistCw * Math.pow(fr, c.resistN)) * u * Math.abs(u) * (1 + 0.5 * this.water);
    // корпус: боковая сила
    const sb = Math.sin(beta);
    const hFy = -qw * c.hullLatArea * (c.hullLatClSlope * 0.5 * Math.sin(2 * beta) + c.hullLatCd * sb * Math.abs(sb));
    // корпус при скольжении обтекается косо: дополнительное сопротивление вдоль ДП
    const hFx = -qw * c.hullLatArea * 0.6 * sb * sb * Math.sign(u || 1);

    // руль: местная скорость с учётом вращения, эффективность падает при крене
    const vr = v + r * c.rudderX;
    const rEff = Math.max(0.1, Math.cos(this.phi));
    const rf = foilForces(u, vr, c.rudderArea * rEff, c.rudderAR, c.rudderStall, this.rudder, 0.03, 1.0, this._rf);
    const rFx = rf.fx, rFy = rf.fy;

    // --- волны под корпусом ---
    const fwdX = Math.sin(this.psi), fwdZ = -Math.cos(this.psi);
    const stbX = Math.cos(this.psi), stbZ = Math.sin(this.psi);
    // плоскость воды под корпусом — МНК по точкам ватерлинии: пять вдоль ДП и две по бортам.
    // Корпус усредняет волны короче себя, высота и уклоны не дёргаются от коротких компонент
    const L = c.waveSpanX, B = c.waveSpanY;
    let hSum = 0, hMom = 0;
    for (let i = -2; i <= 2; i++) {
      const s = i * L / 2;
      const h = waves.heightAt(this.x + fwdX * s, this.z + fwdZ * s);
      hSum += h; hMom += s * h;
    }
    const hp = waves.heightAt(this.x - stbX * B, this.z - stbZ * B);
    const hst = waves.heightAt(this.x + stbX * B, this.z + stbZ * B);
    const hc = (hSum + hp + hst) / 7;
    const slopeAlong = hMom / (2.5 * L * L); // Σs² = 2.5·L²
    const slopeAcross = (hst - hp) / (2 * B);
    const thetaWave = Math.atan(slopeAlong);
    const phiWave = -Math.atan(slopeAcross);
    this.waveTilt.phi = phiWave; this.waveTilt.theta = thetaWave; this.waveTilt.h = hc;
    // скорость плоскости воды (разность шагов; после сброса — ноль)
    const wp = this._wavePrev;
    if (!wp.ok) { wp.h = hc; wp.theta = thetaWave; wp.phi = phiWave; wp.ok = true; }
    const hcDot = (hc - wp.h) / dt, thetaWaveDot = (thetaWave - wp.theta) / dt, phiWaveDot = (phiWave - wp.phi) / dt;
    wp.h = hc; wp.theta = thetaWave; wp.phi = phiWave;
    const m = this.totalMass;
    const surfFx = -m * G * slopeAlong * 0.6;
    const surfFy = -m * G * slopeAcross * 0.3;
    const waveMz = -600 * slopeAcross * u;

    // --- суммы ---
    const sailFx = cap ? 0 : sf.fx, sailFy = cap ? 0 : sf.fy;
    const Fx = sailFx + bFx - R + hFx + rFx + surfFx;
    const Fy = sailFy + bFy + hFy + rFy + surfFy;
    const Mz = (cap ? 0 : sf.mYaw) + bX * bFy + c.hullLatX * hFy + c.rudderX * rFy
      - c.yawDampLin * r * V - c.yawDampQuad * r * Math.abs(r) + waveMz;

    const mu = m * 1.08, mv = m * 1.55;
    const du = Fx / mu + v * r;
    const dv = Fy / mv - u * r;
    const dr = Mz / c.Izz;

    // --- крен ---
    const mSail = cap ? 0 : sf.mHeel;
    const mHydro = -(bFy * c.boardDepth * ext + hFy * 0.25);
    const mCrew = c.crewMass * G * this.crewY * Math.cos(this.phi);
    const mRight = -m * G * this.gz(this.phi - phiWave);
    // демпфирование — относительно воды: на волне корпус тянет за её креном, а не только назад к нулю
    const mDamp = -c.rollDamp * (this.phiDot - phiWaveDot) * (1 + 2 * Math.abs(Math.sin(this.phi)));
    let ddPhi = (mSail + mHydro + mCrew + mRight + mDamp) / c.Ixx;
    if (gybeImp && !cap) this.phiDot += gybeImp / c.Ixx;
    if (gybeImp && !cap) this.r += gybeImp / c.Izz * 0.4;

    // --- интегрирование ---
    if (!cap) {
      this.u += du * dt;
      this.v += dv * dt;
      this.r += dr * dt;
      this.phiDot += ddPhi * dt;
      this.phi += this.phiDot * dt;
      if (Math.abs(this.phi) > c.avs || (this.water > 0.9 && Math.abs(this.phi) > 70 * DEG)) {
        this.capsized = true;
        this.phiDot = 0;
        this.water = 1;
      }
    } else {
      // лежим на борту: всё гаснет, крен держится около 95°
      const target = Math.sign(this.phi || 1) * 95 * DEG;
      this.phi += (target + phiWave * 0.3 - this.phi) * Math.min(1, dt * 1.5);
      this.u *= Math.exp(-dt * 1.5); this.v *= Math.exp(-dt * 1.5); this.r *= Math.exp(-dt * 2);
    }
    this.psi += this.r * dt;
    this.psi = ((this.psi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const vx = fwdX * this.u + stbX * this.v;
    const vz = fwdZ * this.u + stbZ * this.v;
    this.x += vx * dt;
    this.z += vz * dt;

    // дифферент и вертикальная качка
    const squat = -0.6 * DEG * fr * fr;
    // пружина и демпфер к плоскости воды и к её скорости: без упреждения по скорости лодка отставала бы
    // от волны на ~40° по фазе на частоте встречи
    const ddTheta = c.pitchK * (thetaWave + squat - this.theta) + c.pitchC * (thetaWaveDot - this.thetaDot);
    this.thetaDot += ddTheta * dt;
    this.theta += this.thetaDot * dt;
    this.yDot += (c.heaveK * (hc - this.y) + c.heaveC * (hcDot - this.yDot)) * dt;
    this.y += this.yDot * dt;

    // заливание
    if (!cap) {
      const a = Math.abs(this.phi);
      if (a > c.swampStart) this.water = Math.min(1, this.water + c.swampRate * (a - c.swampStart) / (40 * DEG) * dt);
      else if (a < 25 * DEG) this.water = Math.max(0, this.water - c.bailRate * dt);
    }

    // мель: нос, корма и середина (там шверт) по карте берега
    this.aground = false;
    this.boardAground = false;
    if (shore) {
      const half = c.length / 2 - 0.3;
      const boardDraft = c.hullDraft + this.board * (c.boardDraft - c.hullDraft);
      // заглубление точки, м по горизонтали; подводный склон ~0.4 м на метр — отсюда ×2.5
      const pen = (s, draft) => Math.max(c.shoreClearance - s.dist, (draft - s.depth) * 2.5);
      let px = 0, pz = 0, nx = 0, nz = 0, hullHit = false;
      for (const k of [1, -1, 0]) {
        const s = shore.info(this.x + fwdX * half * k, this.z + fwdZ * half * k);
        const p = pen(s, k === 0 ? boardDraft : c.hullDraft);
        if (p <= 0) continue;
        px += s.nx * p; pz += s.nz * p; nx += s.nx; nz += s.nz;
        if (k !== 0 || pen(s, c.hullDraft) > 0) hullHit = true;
      }
      if (px || pz) {
        // выталкиваем плавно, не больше 0.3 м за шаг
        const pl = Math.hypot(px, pz), m = Math.min(1, 0.3 / pl);
        this.x += px * m; this.z += pz * m;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          // гасим составляющую в сторону берега
          const bu = fwdX * nx + fwdZ * nz, bv = stbX * nx + stbZ * nz;
          this.u -= vn * bu * 1.2; this.v -= vn * bv * 1.2;
        }
        this.u *= 0.9; this.v *= 0.9;
        this.aground = true;
        // задевает только шверт — с поднятым прошли бы
        this.boardAground = !hullHit;
      }
    }

    this.forces = { sail: sf, bFx, bFy, hFy, rFy, rFx, R, surfFx, Fx, du, mSail, mRight, mCrew, mHydro };
    this._updateBalance(dt, sf, bX, bFy, hFy, u, vr, rEff);
  }

  // Только для показа: физику не меняет. Руль берём в ДП (только сила от дрейфа):
  // так ЦБС — центр подводной части, а тенденция — куда пойдёт лодка, если отпустить руль.
  // ЦБС по силам шумит на малом ходу и при слабых боковых силах — там подмешиваем оценку по площадям.
  _updateBalance(dt, sf, bX, bFy, hFy, u, vr, rEff) {
    const c = this.cfg, b = this.balance;
    const rFy0 = foilForces(u, vr, c.rudderArea * rEff, c.rudderAR, c.rudderStall, 0, 0.03, 1.0, this._rf0).fy;
    const aB = c.boardArea * this.board;
    const clrG = (bX * aB + c.hullLatX * c.hullLatArea) / (aB + c.hullLatArea);
    const sumF = bFy + hFy + rFy0;
    const w = Math.min(1, Math.max(0, (u - 0.3) / 1.0)) * Math.min(1, Math.abs(sumF) / 300);
    const clrF = w > 0 ? (bX * bFy + c.hullLatX * hFy + c.rudderX * rFy0) / sumF : clrG;
    const clr = Math.min(c.boardX, Math.max(c.rudderX, clrG + (clrF - clrG) * w));
    const k = 1 - Math.exp(-dt / 0.4);
    this._clrS = this._clrS === null ? clr : this._clrS + (clr - this._clrS) * k;
    b.clr = this._clrS;
    b.clrOk = u > 0.3 && !this.capsized;
    const d = c.mastX - c.ceX, boom = this.sail.boom;
    b.ce = c.mastX - d * Math.cos(boom);
    b.ceY = d * Math.sin(boom);
    const m = this.capsized ? 0 : (sf.mYaw + bX * bFy + c.hullLatX * hFy + c.rudderX * rFy0) * Math.sign(this.aw.twa || 1);
    this._tendS += (m - this._tendS) * k;
    b.tend = Math.tanh(this._tendS / 1500); // ≈ 4° руля на ±0.76
  }
}
