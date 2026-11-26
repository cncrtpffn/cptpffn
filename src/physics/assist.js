// Ассистент («авто-матрос»): ведёт всё, кроме руля — шкот, шверт, рифы, пересадку рулевого.
// Скорость задаёт «телеграф»: 0 — стоп, 1 — средний, 2 — полный. Сбросить ход шкотом можно только
// на острых курсах: на полных парус тянет при любом шкоте.
// Без three и DOM: тестируется в jsc (src/debug/run-assist.mjs).
import { BOAT, DEG } from '../config.js';
import { ALPHA, heelLead, crewSide, sheetTarget, boardTarget } from './trim.js';

export const TELEGRAPH = ['стоп', 'средний', 'полный'];
// цели шкота, шверта и борта — src/physics/trim.js; ALPHA[0] = null — стоп, шкот потравлен до упора
const HEEL_PANIC = 38 * DEG; // отдать шкот: угроза заливания
const REEF_DELAY = 4;        // с: условие должно держаться
const HINT_TIME = 3;
export const HINT_TURN = 'Развернитесь к ветру, чтобы уменьшить скорость';

export function createAssist(cfg = BOAT) {
  const REEF_AT = cfg.reefTws.fast; // рифы по сглаженному ветру
  const out = { rudder: 0, rudderAngle: undefined, sheet: 0, board: 0, crewPos: 0 };
  let tws = -1, reefTimer = 0, groundTimer = 0, hintTimer = 0;
  const a = {
    telegraph: 2,
    hint: '',      // подсказка вместо статуса паруса; '' — нет
    limited: false, // ход не сбросить: курс слишком полный для выбранного телеграфа
    locked: false,  // полный курс: выбранный ход не держится или ниже не сбавить — телеграф не действует
    reset() { tws = -1; reefTimer = 0; groundTimer = 0; hintTimer = 0; a.hint = ''; a.limited = false; a.locked = false; },

    // ±1 — ход больше / меньше. Сбавить на полном курсе нельзя — подсказка
    request(d, boat) {
      const t = Math.max(0, Math.min(2, a.telegraph + d));
      if (t === a.telegraph) return;
      if (d < 0 && !reachable(t, Math.abs(boat.aw.awa))) { hintTimer = HINT_TIME; return; }
      a.telegraph = t;
    },

    // оси органов управления на шаг физики; base — ввод игрока (руль)
    controls(dt, boat, wind, base) {
      out.rudder = base.rudder || 0;
      out.rudderAngle = base.rudderAngle;
      const sail = boat.sail, aw = boat.aw;
      const absAwa = Math.abs(aw.awa), absTwa = Math.abs(aw.twa);
      const heel = heelLead(boat);

      // шкот: угол атаки по телеграфу, травим при крене, в панике — до упора
      const alpha = ALPHA[a.telegraph];
      let target = alpha === null ? cfg.sheetMax : sheetTarget(absAwa, heel, alpha);
      if (heel > HEEL_PANIC || boat.water > 0.15) target = cfg.sheetMax;
      target = Math.max(cfg.sheetMin, Math.min(cfg.sheetMax, target));
      out.sheet = Math.max(-1, Math.min(1, (sail.sheet - target) / (2 * DEG)));
      a.limited = a.telegraph < 2 && !reachable(a.telegraph, absAwa);
      a.locked = a.limited || (a.telegraph > 0 && !reachable(a.telegraph - 1, absAwa));

      // рулевой: наветренная банка; у фордевинда — против гика
      out.crewPos = crewSide(boat);

      // шверт: опущен на острых, приподнят на полных; задели дно — поднять и подождать
      groundTimer = boat.boardAground ? 5 : Math.max(0, groundTimer - dt);
      const boardGoal = groundTimer > 0 ? 0 : boardTarget(absTwa);
      out.board = Math.max(-1, Math.min(1, (boardGoal - boat.board) / 0.05));

      // рифы: по ветру, сглаженному за ~8 с, с гистерезисом и задержкой. Парус не спускаем
      tws = tws < 0 ? wind.speed : tws + (wind.speed - tws) * Math.min(1, dt / 8);
      const cur = Math.min(2, sail.reefTarget);
      let want = cur;
      if (cur < 2 && tws > REEF_AT[cur][0]) want = cur + 1;
      else if (cur > 0 && tws < REEF_AT[cur - 1][1]) want = cur - 1;
      if (sail.reefTarget > 2) want = 2;
      reefTimer = want !== sail.reefTarget ? reefTimer + dt : 0;
      if (reefTimer > (sail.reefTarget > 2 ? 0 : REEF_DELAY)) { sail.reef(want - sail.reefTarget); reefTimer = 0; }

      hintTimer = Math.max(0, hintTimer - dt);
      // на полном курсе подсказка висит всё время, пока ход не сбавить
      a.hint = hintTimer > 0 || a.locked ? HINT_TURN : '';
      return out;
    },
  };
  // ход сбрасывается, только если нужный гику угол меньше предельного
  const reachable = (t, absAwa) => absAwa - (ALPHA[t] ?? 0) < cfg.sheetMax;
  return a;
}
