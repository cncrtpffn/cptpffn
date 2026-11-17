import { DEG } from '../config.js';

export function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// Истинный ветер с порывами и заходами. Направление — «откуда», компасное.
export class Wind {
  constructor(p) {
    this.baseSpeed = p.speed;
    this.baseDirDeg = p.dirDeg;
    this.gusts = p.gusts;
    this.gustStrength = p.gustStrength;
    this.shiftDeg = p.shiftDeg;
    this.time = 0;
    this.speed = p.speed;
    this.dir = p.dirDeg * DEG;
    this.gustFactor = 0;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    let g = 0, s = 0;
    if (this.gusts) {
      g = 0.5 * Math.sin(0.11 * t) + 0.3 * Math.sin(0.37 * t + 1.3)
        + 0.2 * Math.sin(0.9 * t + 2.1) + 0.12 * Math.sin(2.3 * t + 0.4);
      s = 0.6 * Math.sin(0.07 * t + 0.9) + 0.3 * Math.sin(0.23 * t + 2.2)
        + 0.15 * Math.sin(0.6 * t + 1.1);
    }
    this.gustFactor = g * this.gustStrength;
    this.speed = Math.max(0, this.baseSpeed * (1 + this.gustFactor));
    this.dir = (this.baseDirDeg + this.shiftDeg * s) * DEG;
  }

  // Вектор скорости воздуха в мировых координатах (x — восток, z — юг).
  vector() {
    const d = this.dir;
    return { x: -this.speed * Math.sin(d), z: this.speed * Math.cos(d) };
  }

  // Вымпельный ветер в связанной системе лодки.
  // Возвращает awa (рад, откуда относительно носа, >0 — с правого борта), aws, twa.
  apparent(psi, u, v) {
    const w = this.vector();
    const fwdX = Math.sin(psi), fwdZ = -Math.cos(psi);
    const stbX = Math.cos(psi), stbZ = Math.sin(psi);
    const bx = fwdX * u + stbX * v;
    const bz = fwdZ * u + stbZ * v;
    const rx = w.x - bx, rz = w.z - bz;
    const ax = rx * fwdX + rz * fwdZ;
    const ay = rx * stbX + rz * stbZ;
    const aws = Math.hypot(ax, ay);
    const awa = aws > 1e-4 ? Math.atan2(-ay, -ax) : 0;
    const twa = wrapPi(this.dir - psi);
    return { awa, aws, twa, tws: this.speed };
  }
}
