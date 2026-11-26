// Запуск: jsc -m src/debug/run-collide.mjs  (из корня проекта)
// Столкновения с буями, знаками и мостками (src/physics/obstacles.js): лодка без ветра идёт по инерции на север
import { Boat } from '../physics/boat.js';
import { Wind } from '../physics/wind.js';
import { Waves } from '../physics/waves.js';
import { createObstacles, HULL_CIRCLES } from '../physics/obstacles.js';
import { DEG } from '../config.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const dt = 1 / 120;
let fails = 0;
const check = (ok, msg) => { out(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// лодка в (0, 0) курсом на север со скоростью kn; add — расставить препятствия; секунд прогона
function run(kn, add, secs = 12, rudder = 0) {
  const wind = new Wind({ speed: 0.5, dirDeg: 180, gusts: false, gustStrength: 0, shiftDeg: 0 });
  const waves = new Waves(); waves.configure(0, 0, 3);
  const boat = new Boat(); boat.reset(0, 0, 0); boat.u = kn / 1.944;
  const obs = createObstacles(); add(obs);
  let minClear = Infinity, maxOff = 0, minZ = 0;
  for (let i = 0; i < secs / dt; i++) {
    wind.update(dt); waves.update(dt);
    boat.step(dt, { rudderAngle: rudder * DEG, sheetAngle: boat.cfg.sheetMax, board: 0 }, wind, waves, null, obs);
    minZ = Math.min(minZ, boat.z);
    for (const o of obs.list) {
      if (o.type !== 'circle') continue;
      maxOff = Math.max(maxOff, Math.hypot(o.ox, o.oz));
      for (const [s, r] of HULL_CIRCLES) {
        const cx = boat.x + Math.sin(boat.psi) * s, cz = boat.z - Math.cos(boat.psi) * s;
        minClear = Math.min(minClear, Math.hypot(cx - o.x, cz - o.z) - r - o.r);
      }
    }
  }
  return { boat, obs, minClear, maxOff, minZ };
}

out('=== Лобовой удар в тяжёлый буй (5 уз, буй в 8 м) ===');
let r = run(5, (o) => o.addCircle({ id: 'b', x: 0, z: -8, r: 0.7 }));
out(`  проникание ${(-Math.min(0, r.minClear)).toFixed(2)} м, z мин ${r.minZ.toFixed(1)}, ход ${(r.boat.u * 1.944).toFixed(2)} уз, касаний ${r.boat.contact.count}, скорость удара ${r.boat.contact.speed.toFixed(2)} м/с`);
check(r.minClear > -0.35, 'не проходит сквозь (проникание < 0.35 м)');
check(r.minZ > -8 + 2.55 + 0.45 + 0.7 - 0.4 - 3, 'лодка не за буем');
check(r.boat.contact.count >= 1 && r.boat.contact.id === 'b', 'событие касания');

out('\n=== Вскользь: буй в 1.2 м правее ДП ===');
r = run(5, (o) => o.addCircle({ id: 'b', x: 1.2, z: -8, r: 0.7 }));
out(`  курс ${(r.boat.psi / DEG).toFixed(0)}°, x ${r.boat.x.toFixed(2)}, z ${r.boat.z.toFixed(1)}, ход ${(r.boat.u * 1.944).toFixed(2)} уз`);
check(r.minClear > -0.35, 'не проходит сквозь');
check(r.boat.z < -10, 'проскальзывает мимо и идёт дальше');
check(Math.abs(r.boat.psi / DEG - 180) < 179 && r.boat.psi !== 0, 'курс изменился от удара');

out('\n=== Лёгкий гоночный знак (30 кг) по курсу ===');
r = run(5, (o) => o.addCircle({ id: 'm', kind: 'mark', x: 0.4, z: -8, r: 0.9, mass: 30 }), 20);
const m = r.obs.list[0];
out(`  макс. смещение ${r.maxOff.toFixed(2)} м, через 20 с ${Math.hypot(m.ox, m.oz).toFixed(3)} м, ход лодки ${(r.boat.u * 1.944).toFixed(2)} уз, z ${r.boat.z.toFixed(1)}`);
check(r.maxOff <= 1.5 + 1e-6, 'знак смещается не дальше 1.5 м');
check(Math.hypot(m.ox, m.oz) < 0.05, 'знак вернулся на место');
check(r.boat.z < -10, 'лодка прошла (знак отъехал или проскользнула)');

out('\n=== 8 уз в тяжёлый буй: без пролёта ===');
r = run(8, (o) => o.addCircle({ id: 'b', x: 0, z: -10, r: 0.5 }));
out(`  проникание ${(-Math.min(0, r.minClear)).toFixed(2)} м, z мин ${r.minZ.toFixed(1)}`);
check(r.minClear > -0.4, 'не проходит сквозь на 8 уз');
check(r.minZ > -10, 'центр лодки не за буем');

out('\n=== Мосток поперёк курса (20×2 м в 10 м) ===');
r = run(5, (o) => o.addBox({ id: 'p', x: 0, z: -10, rot: Math.PI / 2, len: 20, w: 2 }));
out(`  z мин ${r.minZ.toFixed(2)} (нос у мостка при −6.0), ход ${(r.boat.u * 1.944).toFixed(2)} уз, касаний ${r.boat.contact.count}`);
check(r.minZ > -6.4, 'нос не заходит в мосток больше чем на 0.4 м');
check(r.boat.contact.kind === 'pier', 'событие касания мостка');

out('\n=== Вдоль мостка в 2 м от борта: касаний нет ===');
r = run(5, (o) => o.addBox({ id: 'p', x: 3.5, z: -15, rot: 0, len: 30, w: 2 }));
check(r.boat.contact.count === 0, `касаний ${r.boat.contact.count}`);

out(fails ? `\n${fails} проверок не прошло` : '\nвсё ок');
