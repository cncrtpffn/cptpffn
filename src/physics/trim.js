// Оптимальная настройка лодки — общий источник правды для ассистента (assist.js) и подсказок HUD.
// Константы целей шкота, шверта и борта рулевого живут здесь; ассистент превращает цели в оси,
// HUD рисует по ним отметки на индикаторах и мигает контролом, который пора тронуть.
// Без three и DOM: тестируется в jsc.
import { BOAT, DEG } from '../config.js';

export const ALPHA = [null, 7 * DEG, 24 * DEG]; // угол атаки грота по телеграфу; полный ход (24°) — оптимум
export const HEEL_EASE = 24 * DEG;  // выше этого крена шкот травится…
export const EASE_K = 2.5;          // …на столько градусов гика за градус крена
export const HEEL_LEAD = 0.3;       // с: крен с упреждением по скорости крена
export const BOARD_RUN = 0.3;       // шверт на полных курсах
export const RUN_TWA = 110 * DEG;   // полнее — шверт поднят
export const CREW_BOOM_TWA = 150 * DEG; // полнее — борт рулевого по гику, а не по ветру (не скачет у фордевинда)

const HEEL_OK = 18 * DEG;    // выше — пора на откренку
const HIKE_OFF = 12 * DEG;   // ниже — с откренки можно вернуться на банку
const HEEL_TAU = 0.5;        // с, сглаживание крена для подсказок
const WIND_TAU = 8;          // с, сглаживание ветра для рифов
const REEF_HYST = 1;         // м/с: риф отдавать, когда ветер ниже порога на столько
const HOLD = 2;              // с: подсказка держится после того, как условие ушло (не мигать на волне)

// курс к истинному ветру: верхняя граница |twa|, ° и название, как на розе курсов в manual.html.
// Индексы: 0 мёртвый угол, 1 бейдевинд, 2 галфвинд, 3 бакштаг, 4 фордевинд (HUD и условия уроков)
export const POINTS = [[22, 'Мёртвый угол'], [75, 'Бейдевинд'], [100, 'Галфвинд'], [165, 'Бакштаг'], [181, 'Фордевинд']];
const POINT_HYST = 3; // °: соседний курс принимается, только когда угол ушёл за границу дальше этого
// a — |twa|, °; prev — прошлый индекс (−1 — нет)
export function pointOfSail(a, prev) {
  let i = POINTS.findIndex(([max]) => a < max);
  if (i < 0) i = POINTS.length - 1;
  if (prev < 0) return i;
  if (i === prev + 1 && a < POINTS[prev][0] + POINT_HYST) return prev;
  if (i === prev - 1 && a > POINTS[i][0] - POINT_HYST) return prev;
  return i;
}

// крен с упреждением: в порыв реагируем раньше, чем лодка ляжет
export const heelLead = (boat) => Math.abs(boat.phi + HEEL_LEAD * boat.phiDot);

// наветренный борт рулевого: ±1; у фордевинда — против гика
export function crewSide(boat) {
  const twa = boat.aw.twa, boom = boat.sail.boom;
  return Math.abs(twa) < CREW_BOOM_TWA || !boom ? Math.sign(twa || 1) : -Math.sign(boom);
}

// цель угла гика: |awa| − α, травить при крене. Без clamp — его делает вызывающий
export function sheetTarget(absAwa, heel, alpha = ALPHA[2]) {
  let t = absAwa - alpha;
  if (heel > HEEL_EASE) t += (heel - HEEL_EASE) * EASE_K;
  return t;
}

export const boardTarget = (absTwa) => (absTwa < RUN_TWA ? 1 : BOARD_RUN);

// Советчик для HUD: update(dt, boat, wind) раз в кадр → цели и что мигать.
// Рифы — по профилю порогов (BOAT.reefTws.safe — расчёт по бейдевинду, src/debug/run-reef-table.mjs)
export function createTrimAdvisor(cfg = BOAT, profile = 'safe') {
  const limits = cfg.reefTws[profile];
  let heel = -1, tws = -1, hike = false, reef = 0;
  const hold = { ok: 0, ease: 0 };
  const out = { sheet: 0, board: 1, crewPos: 1, reef: 0, need: { crew: false, sheet: false, reef: false } };
  return {
    reset() { heel = -1; tws = -1; hike = false; reef = 0; hold.ok = hold.ease = 0; },
    update(dt, boat, wind) {
      const aw = boat.aw, sail = boat.sail;
      const k = (tau) => Math.min(1, dt / tau);
      const h = heelLead(boat);
      heel = heel < 0 ? h : heel + (h - heel) * k(HEEL_TAU);
      tws = tws < 0 ? wind.speed : tws + (wind.speed - tws) * k(WIND_TAU);

      // экипаж: наветренная банка, при крене — откренка (с гистерезисом)
      hike = hike ? heel > HIKE_OFF : heel > HEEL_OK;
      const side = crewSide(boat);
      out.crewPos = side * (hike ? 2 : 1);
      out.sheet = Math.max(cfg.sheetMin, Math.min(cfg.sheetMax, sheetTarget(Math.abs(aw.awa), heel)));
      out.board = boat.boardAground ? 0 : boardTarget(Math.abs(aw.twa));

      // рифы: сколько ступеней нужно на бейдевинде при таком ветре, от курса не зависит. Больше 2 не советуем
      let want = 0;
      while (want < 2 && tws > limits[want]) want++;
      if (want < reef && tws > limits[want] - REEF_HYST) want = reef;
      reef = want;
      out.reef = reef;

      // что мигать: сначала откренка, если она ещё не стоит; уже откренились — травить шкот.
      // Держим только условие по крену (волна), действие игрока гасит подсказку сразу
      hold.ok = heel > HEEL_OK ? HOLD : Math.max(0, hold.ok - dt);
      hold.ease = heel > HEEL_EASE ? HOLD : Math.max(0, hold.ease - dt);
      const hiked = boat.crewPos === side * 2, live = !boat.capsized;
      out.need.crew = live && hold.ok > 0 && !hiked;
      out.need.sheet = live && hold.ease > 0 && hiked;
      out.need.reef = live && sail.reefTarget < reef;
      return out;
    },
  };
}
