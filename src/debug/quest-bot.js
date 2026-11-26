// Бот для прогона уроков в jsc (src/debug/run-quests.mjs): рулевой, который идёт к цели квеста.
// Против ветра — лавировка галсами 45° с поворотом на лэйлайне; обход знака — по окружности радиуса R
// нужным бортом; остальное ведёт ассистент (или ручные формулы trim.js в прогоне).
import { DEG } from '../config.js';
import { wrapPi } from '../physics/wind.js';

const BEAT = 47 * DEG;  // курс бейдевинд к истинному ветру
const R = 9;            // радиус обхода знака, м

export function createQuestBot() {
  let tack = 0, forced = null;
  const bot = {
    // принудительный курс к ветру (рад, знак — галс) для шагов «пройти курсом», null — к цели
    force(twa) { forced = twa; },
    // курс (рад, 0 = север) к цели target ({ x, z, round? } из runner.target)
    heading(boat, wind, target) {
      if (forced !== null) return wind.dir - forced;
      if (!target) return boat.psi;
      let tx = target.x, tz = target.z;
      if (target.round) {
        // точка на окружности вокруг знака на 60° впереди: знак слева (port) — обход против часовой на карте
        const sgn = target.round === 'port' ? -1 : 1;
        const d = Math.hypot(boat.x - tx, boat.z - tz);
        const th = Math.atan2(boat.z - tz, boat.x - tx) + sgn * (d > 3 * R ? 30 : 60) * DEG;
        tx += Math.cos(th) * R; tz += Math.sin(th) * R;
      }
      const brg = Math.atan2(tx - boat.x, -(tz - boat.z));
      const off = wrapPi(brg - wind.dir); // >0 — цель справа от ветра
      if (Math.abs(off) >= BEAT) { tack = 0; return brg; }
      // лавировка: держим галс, пока цель не окажется за курсом другого галса
      if (!tack) tack = Math.sign(off) || 1;
      if (tack * off <= -BEAT + 2 * DEG) tack = -tack;
      return wind.dir + tack * BEAT;
    },
    // руль к курсу: П-регулятор с демпфированием по скорости рыскания (как отладочный автопилот)
    rudder(boat, psi) {
      const err = wrapPi(psi - boat.psi);
      return Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
    },
    reset() { tack = 0; forced = null; },
  };
  return bot;
}
