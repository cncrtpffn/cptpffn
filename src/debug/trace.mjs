// Трасса физики под автопилотом: ветер 7 м/с без порывов, курс 60° к ветру, 40 с.
// Раз в секунду строка: скорости u/v, дрейф, крен, курс и ошибка курса, руль, вымпельный угол, гик,
// силы паруса, шверта, корпуса и руля, момент рыскания, режим паруса. Для разбора, как лодка выходит на режим.
// Запуск: jsc -m src/debug/trace.mjs  (из корня проекта; tws/twa — константы ниже)
import { Boat } from '../physics/boat.js';
import { Wind } from '../physics/wind.js';
import { Waves } from '../physics/waves.js';
import { DEG } from '../config.js';
import { wrapPi } from '../physics/wind.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const tws = 7, twa = 60, dt = 1/120;
const wind = new Wind({ speed: tws, dirDeg: 0, gusts: false, gustStrength: 0, shiftDeg: 0 });
const waves = new Waves();
const boat = new Boat();
const psi0 = ((-twa * DEG) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
boat.reset(0, 0, psi0);
const f = (x, d = 2) => x.toFixed(d).padStart(7);
out('   t      u      v   beta   heel    psi    err    rud   awa   boom  sailfx  sailfy   bFy    hFy    rFy   myaw   st');
for (let i = 0; i <= 120 * 40; i++) {
  wind.update(dt); waves.update(dt);
  const err = wrapPi(psi0 - boat.psi);
  const rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
  const sheetAngle = Math.abs(boat.aw.awa) - 24 * DEG;
  boat.step(dt, { rudderAngle, sheetAngle, crew: 1, board: 0 }, wind, waves, null);
  if (i % 120 === 0) {
    const F = boat.forces;
    out(`${f(i*dt,0)}${f(boat.u)}${f(boat.v)}${f(boat.leeway/DEG,1)}${f(boat.phi/DEG,1)}${f(boat.psi/DEG,1)}${f(err/DEG,1)}${f(boat.rudder/DEG,1)}${f(boat.aw.awa/DEG,1)}${f(boat.sail.boom/DEG,1)}${f(F.sail.fx,0)}${f(F.sail.fy,0)}${f(F.bFy,0)}${f(F.hFy,0)}${f(F.rFy,0)}${f(F.sail.mYaw,0)}  ${boat.sail.status}`);
  }
}
