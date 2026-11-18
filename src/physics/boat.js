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
function foilForces(u, v, area, ar, stall, delta, cd0, cc) {
  const V = Math.hypot(u, v);
  if (V < 0.03) return { fx: 0, fy: 0, cl: 0 };
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
  return { fx, fy, cl };
}

export class Boat {
  constructor(cfg = BOAT) {
    this.cfg = cfg;
    this.sail = new Sail(cfg);
    this.reset(0, 0, 90 * DEG);
  }

  reset(x, z, psi) {
    this.x = x; this.z = z; this.psi = psi;
    this.u = 0; this.v = 0; this.r = 0;
    this.phi = 0; this.phiDot = 0;
    this.theta = 0; this.thetaDot = 0;
    this.y = 0;
    this.rudder = 0;
    this.board = 1;
    this.crewY = 0; this.crewTarget = 0;
    this.water = 0;
    this.capsized = false;
    this.aground = false;
    this.boardAground = false;
    this.leeway = 0;
    this.aw = { awa: 0, aws: 0, twa: 0, tws: 0 };
    this.forces = {};
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

  // controls: { rudder: -1..1, sheet: -1..1 (+1 выбрать), board: -1..1 (+1 опустить), crew: -1|0|1 }
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
    this.crewTarget = (controls.crew || 0) * c.crewMaxY;
    const dc = this.crewTarget - this.crewY;
    const mvc = c.crewRate * dt;
    this.crewY = Math.abs(dc) <= mvc ? this.crewTarget : this.crewY + Math.sign(dc) * mvc;

    // --- ветер и парус ---
    const aw = wind.apparent(this.psi, this.u, this.v);
    this.aw = aw;
    if (controls.sheetAngle !== undefined) this.sail.sheet = Math.max(c.sheetMin, Math.min(c.sheetMax, controls.sheetAngle));
    const sf = this.sail.update(dt, aw.awa, aw.aws, this.phi, cap ? 0 : controls.sheet);
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
    const bf = foilForces(u, v, bArea, bAR, c.boardStall, 0, c.boardCd0, 1.0);
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
    const rf = foilForces(u, vr, c.rudderArea * rEff, c.rudderAR, c.rudderStall, this.rudder, 0.03, 1.0);
    const rFx = rf.fx, rFy = rf.fy;

    // --- волны под корпусом ---
    const fwdX = Math.sin(this.psi), fwdZ = -Math.cos(this.psi);
    const stbX = Math.cos(this.psi), stbZ = Math.sin(this.psi);
    const hb = waves.heightAt(this.x + fwdX * 2.0, this.z + fwdZ * 2.0);
    const hs = waves.heightAt(this.x - fwdX * 2.0, this.z - fwdZ * 2.0);
    const hp = waves.heightAt(this.x - stbX * 1.0, this.z - stbZ * 1.0);
    const hst = waves.heightAt(this.x + stbX * 1.0, this.z + stbZ * 1.0);
    const hc = waves.heightAt(this.x, this.z);
    const slopeAlong = (hb - hs) / 4.0;
    const slopeAcross = (hst - hp) / 2.0;
    const thetaWave = Math.atan(slopeAlong);
    const phiWave = -Math.atan(slopeAcross);
    this.waveTilt.phi = phiWave; this.waveTilt.theta = thetaWave; this.waveTilt.h = hc;
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
    const mDamp = -c.rollDamp * this.phiDot * (1 + 2 * Math.abs(Math.sin(this.phi)));
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
    const ddTheta = c.pitchK * (thetaWave + squat - this.theta) - c.pitchC * this.thetaDot;
    this.thetaDot += ddTheta * dt;
    this.theta += this.thetaDot * dt;
    this.y += (hc - this.y) * Math.min(1, dt / c.heaveLag);

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
  }
}
