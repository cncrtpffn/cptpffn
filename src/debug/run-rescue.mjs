// Запуск: jsc -m src/debug/run-rescue.mjs  (из корня проекта)
// Снятие с мели (Boat.rescue): прямой берег x = 0 (суша x < 0), склон 0.4 м на метр.
// Лодка сидит на берегу носом в сушу; после rescue — 15 с со «стоп» ассистента или потравленным шкотом
import { Boat } from '../physics/boat.js';
import { createAssist } from '../physics/assist.js';
import { Wind } from '../physics/wind.js';
import { Waves } from '../physics/waves.js';
import { DEG } from '../config.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const shore = { info: (x) => ({ dist: x, depth: Math.min(4, Math.max(0, x * 0.4)), nx: 1, nz: 0 }) };
const dt = 1 / 120;
out('wind  режим    до: x  aground   после: x    psi  aground за 15 с  мин. x');
for (const dirDeg of [0, 90, 270]) {
  for (const mode of ['ручной', 'ассист']) {
    const wind = new Wind({ speed: 8, dirDeg, gusts: false });
    const waves = new Waves();
    const boat = new Boat();
    const ast = createAssist();
    boat.reset(3, 0, 270 * DEG); // нос в берег (−x)
    for (let i = 0; i < 240; i++) boat.step(dt, { rudder: 0, sheet: 0, board: 0 }, wind, waves, shore);
    const before = `${boat.x.toFixed(1).padStart(6)}  ${String(boat.aground).padEnd(5)}`;
    const ok = boat.rescue(shore);
    if (mode === 'ассист') { ast.reset(); ast.telegraph = 0; }
    const after = `${boat.x.toFixed(1).padStart(8)}  ${(boat.psi / DEG).toFixed(0).padStart(5)}`;
    let hits = 0, minX = Infinity;
    for (let i = 0; i < 15 / dt; i++) {
      const c = mode === 'ассист' ? ast.controls(dt, boat, wind, { rudder: 0 }) : { rudder: 0, sheet: 0, board: 0 };
      boat.step(dt, c, wind, waves, shore);
      if (boat.aground) hits++;
      minX = Math.min(minX, boat.x);
    }
    out(`${String(dirDeg).padStart(4)}  ${mode}  ${before}  ${ok ? after : '   нет точки'}  ${String(hits).padStart(14)}  ${minX.toFixed(1).padStart(6)}`);
  }
}
