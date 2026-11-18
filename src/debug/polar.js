// Прогон установившегося режима: автопилот держит заданный угол к ветру,
// шкот настраивается на оптимальный угол атаки. Без Three.js — чистая физика.
import { Boat } from '../physics/boat.js';
import { Wind } from '../physics/wind.js';
import { Waves } from '../physics/waves.js';
import { DEG } from '../config.js';
import { wrapPi } from '../physics/wind.js';

export function runCase(opts) {
  const {
    tws = 7, twa = 45, duration = 90, dt = 1 / 120, reefs = 0, board = 1,
    hike = true, alpha = 24, sea = 0, gusts = false, sheet,
  } = opts;
  const wind = new Wind({ speed: tws, dirDeg: 0, gusts, gustStrength: 0.3, shiftDeg: 12 });
  const waves = new Waves();
  waves.configure(sea, 0, tws);
  const boat = new Boat();
  const psi0 = ((-twa * DEG) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  boat.reset(0, 0, psi0);
  boat.board = board;
  boat.sail.setReef(reefs);
  const steps = Math.round(duration / dt);
  let maxHeel = 0, capsizedAt = -1;
  const avgWindow = Math.round(15 / dt);
  let sumU = 0, sumV = 0, sumHeel = 0, sumLee = 0, n = 0;
  for (let i = 0; i < steps; i++) {
    wind.update(dt); waves.update(dt);
    const err = wrapPi(psi0 - boat.psi);
    const rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
    const absAwa = Math.abs(boat.aw.awa);
    const sheetAngle = sheet !== undefined ? sheet * DEG : absAwa - alpha * DEG;
    const crewPos = (hike ? 2 : 1) * Math.sign(boat.aw.twa || 1); // откренка или банка на наветренном борту
    boat.step(dt, { rudderAngle, sheetAngle, crewPos, board: 0 }, wind, waves, null);
    maxHeel = Math.max(maxHeel, Math.abs(boat.phi));
    if (boat.capsized && capsizedAt < 0) { capsizedAt = i * dt; break; }
    if (i >= steps - avgWindow) { sumU += boat.u; sumV += boat.v; sumHeel += Math.abs(boat.phi); sumLee += Math.abs(boat.leeway); n++; }
  }
  const u = n ? sumU / n : 0;
  const vv = n ? sumV / n : 0;
  const heel = n ? sumHeel / n : 0;
  const lee = n ? sumLee / n : 0;
  return {
    tws, twa, speedKn: u * 1.944, vmgKn: (u * Math.cos(twa * DEG) - Math.abs(vv) * Math.sin(twa * DEG)) * 1.944,
    heelDeg: heel / DEG, maxHeelDeg: maxHeel / DEG, leewayDeg: lee / DEG,
    awaDeg: boat.aw.awa / DEG, boomDeg: boat.sail.boom / DEG, status: boat.sail.status,
    capsizedAt, rudderDeg: boat.rudder / DEG, water: boat.water,
  };
}

export function polar(tws = 7, extra = {}) {
  const rows = [];
  for (const twa of [30, 35, 40, 45, 50, 60, 75, 90, 110, 135, 150, 165, 180]) {
    rows.push(runCase({ tws, twa, ...extra }));
  }
  return rows;
}

export function formatRows(rows) {
  const f = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : String(x)).padStart(7);
  const lines = ['   twa  speed    vmg   heel maxHl leeway    awa   boom  rudd  st   caps'];
  for (const r of rows) {
    lines.push(`${f(r.twa, 0)}${f(r.speedKn)}${f(r.vmgKn)}${f(r.heelDeg)}${f(r.maxHeelDeg)}${f(r.leewayDeg)}${f(r.awaDeg)}${f(r.boomDeg)}${f(r.rudderDeg)}  ${r.status.padEnd(5)}${r.capsizedAt >= 0 ? f(r.capsizedAt) : '      -'}`);
  }
  return lines.join('\n');
}

if (typeof window !== 'undefined') {
  window.polar = (tws, extra) => console.log(formatRows(polar(tws, extra)));
  window.runCase = runCase;
}
