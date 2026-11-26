// Ассистент («авто-матрос»): ведёт всё, кроме руля — шкот, шверт, рифы, пересадку рулевого.
// Скорость задаёт «телеграф»: 0 — стоп, 1 — средний, 2 — полный. Сбросить ход шкотом можно только
// на острых курсах: на полных парус тянет при любом шкоте.
// Без three и DOM: тестируется в jsc (src/debug/run-assist.mjs).
import { BOAT, DEG } from '../config.js';

export const TELEGRAPH = ['стоп', 'средний', 'полный'];
const ALPHA = [null, 7 * DEG, 24 * DEG]; // угол атаки грота по телеграфу; стоп — шкот потравлен до упора
const HEEL_EASE = 24 * DEG;  // выше этого крена шкот травится…
const EASE_K = 2.5;          // …на столько градусов гика за градус крена
const HEEL_PANIC = 38 * DEG; // отдать шкот: угроза заливания
const HEEL_LEAD = 0.3;       // с
const BOARD_RUN = 0.3;       // шверт на полных курсах
const RUN_TWA = 110 * DEG;   // полнее — шверт поднят
const CREW_BOOM_TWA = 150 * DEG; // полнее — борт рулевого по гику, а не по ветру (не скачет у фордевинда)
// рифы по сглаженному ветру: [взять, отдать] для 1 и 2 рифов, м/с
const REEF_AT = [[11, 10], [14, 13]];
const REEF_DELAY = 4;        // с: условие должно держаться
const HINT_TIME = 3;
export const HINT_TURN = 'Развернитесь к ветру, чтобы уменьшить скорость';

export function createAssist(cfg = BOAT) {
  const out = { rudder: 0, rudderAngle: undefined, sheet: 0, board: 0, crewPos: 0 };
  let tws = -1, reefTimer = 0, groundTimer = 0, hintTimer = 0;
  const a = {
    telegraph: 2,
    hint: '',      // подсказка вместо статуса паруса; '' — нет
    limited: false, // ход не сбросить: курс слишком полный для выбранного телеграфа
    reset() { tws = -1; reefTimer = 0; groundTimer = 0; hintTimer = 0; a.hint = ''; a.limited = false; },

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
      // крен с упреждением по скорости крена: в порыв травим раньше, чем лодка ляжет
      const heel = Math.abs(boat.phi + HEEL_LEAD * boat.phiDot);

      // шкот: угол атаки по телеграфу, травим при крене, в панике — до упора
      const alpha = ALPHA[a.telegraph];
      let target = alpha === null ? cfg.sheetMax : absAwa - alpha;
      if (heel > HEEL_EASE) target += (heel - HEEL_EASE) * EASE_K;
      if (heel > HEEL_PANIC || boat.water > 0.15) target = cfg.sheetMax;
      target = Math.max(cfg.sheetMin, Math.min(cfg.sheetMax, target));
      out.sheet = Math.max(-1, Math.min(1, (sail.sheet - target) / (2 * DEG)));
      a.limited = a.telegraph < 2 && !reachable(a.telegraph, absAwa);

      // рулевой: наветренная банка; у фордевинда — против гика
      const side = absTwa < CREW_BOOM_TWA || !sail.boom ? Math.sign(aw.twa || 1) : -Math.sign(sail.boom);
      out.crewPos = side;

      // шверт: опущен на острых, приподнят на полных; задели дно — поднять и подождать
      groundTimer = boat.boardAground ? 5 : Math.max(0, groundTimer - dt);
      const boardGoal = groundTimer > 0 ? 0 : absTwa < RUN_TWA ? 1 : BOARD_RUN;
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
      a.hint = hintTimer > 0 || a.limited ? HINT_TURN : '';
      return out;
    },
  };
  // ход сбрасывается, только если нужный гику угол меньше предельного
  const reachable = (t, absAwa) => absAwa - (ALPHA[t] ?? 0) < cfg.sheetMax;
  return a;
}
