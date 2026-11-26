import { DEG, beaufort, BEAUFORT_NAMES } from '../config.js';

const $ = (id) => document.getElementById(id);
const STATUS = {
  luff: ['Парус полощет — выберите шкот', 'luff'],
  ok: ['Парус тянет', 'ok'],
  stall: ['Шкот перебран — потравите', 'stall'],
  run: ['Полный курс — тяга от сопротивления', 'ok'],
  gybe: ['Поворот фордевинд — гик идёт!', 'gybe'],
  down: ['Парус спущен', 'down'],
};
// HUD обновляется каждый кадр, а меняется редко: пишем в DOM только новое значение —
// каждая запись в textContent/style/атрибут заставляет браузер пересчитать стили и вёрстку
const last = new WeakMap();
function changed(el, key, v) {
  let m = last.get(el);
  if (!m) last.set(el, m = {});
  if (m[key] === v) return false;
  m[key] = v;
  return true;
}
const set = (el, prop, v) => { if (changed(el, prop, v)) el[prop] = v; };
const css = (el, prop, v) => { if (changed(el, 'style.' + prop, v)) el.style[prop] = v; };
const attr = (el, name, v) => { if (changed(el, '@' + name, v)) el.setAttribute(name, v); };

const tick = (a, r1, r2) => {
  const sx = Math.sin(a * DEG), cy = -Math.cos(a * DEG);
  return `<line x1="${(sx * r1).toFixed(1)}" y1="${(cy * r1).toFixed(1)}" x2="${(sx * r2).toFixed(1)}" y2="${(cy * r2).toFixed(1)}"/>`;
};
const cardinal = (a, r) => `<text transform="rotate(${a}) translate(0,${-r})" class="rose-label ${'nesw'[a / 90]}" dy="0.35em">${'NESW'[a / 90]}</text>`;
// большая картушка: риски через 10°, буквы на 90°, цифры через 30° (в десятках градусов, как на шлюпочном компасе).
// Та же разметка — в статичном компасе экрана загрузки (src/debug/gen-loading-anim.mjs)
export function roseTicks() {
  let s = '';
  for (let a = 0; a < 360; a += 10) {
    const major = a % 30 === 0;
    s += tick(a, a % 90 === 0 ? 47 : major ? 50 : 53, 56);
    if (major) s += a % 90 === 0 ? cardinal(a, 39) : `<text transform="rotate(${a}) translate(0,-42)" class="rose-num" dy="0.35em">${a / 10}</text>`;
  }
  return s;
}
const ROSE_K = 6.5;
const deg = (rad) => (Math.round(rad / DEG * 2) / 2).toFixed(1); // до 0.5°, чтобы атрибут не менялся каждый кадр // ед. viewBox розы на метр, как в разметке #rose

// статус паруса при ассистенте: полощет он нарочно — так сброшен ход
const ASSIST_STATUS = [['Стоп: шкот потравлен', 'down'], ['Средний ход', 'ok']];
// курс к истинному ветру: верхняя граница |twa|, ° и название, как на розе курсов в manual.html
const POINTS = [[22, 'Мёртвый угол'], [75, 'Бейдевинд'], [100, 'Галфвинд'], [165, 'Бакштаг'], [181, 'Фордевинд']];
const POINT_HYST = 3; // °: соседний курс принимается, только когда угол ушёл за границу дальше этого
function pointOfSail(a, prev) {
  let i = POINTS.findIndex(([max]) => a < max);
  if (i < 0) i = POINTS.length - 1;
  if (prev < 0) return i;
  if (i === prev + 1 && a < POINTS[prev][0] + POINT_HYST) return prev;
  if (i === prev - 1 && a > POINTS[i][0] - POINT_HYST) return prev;
  return i;
}
const CAMERA_NAMES = { orbit: 'орбита', chase: 'за кормой', top: 'сверху', deck: 'с палубы' };

export class Hud {
  constructor() {
    this.el = {
      speed: $('hud-speed'), heading: $('hud-heading'), tws: $('hud-tws'), twa: $('hud-twa'),
      aws: $('hud-aws'), awa: $('hud-awa'), heel: $('hud-heel'), leeway: $('hud-leeway'),
      beaufort: $('hud-beaufort'), roseCard: $('rose-card'), roseTrue: $('rose-true'), roseApp: $('rose-app'),
      roseBoom: $('rose-boom'), roseSheet: $('rose-sheet'), roseCe: $('rose-ce'), roseClr: $('rose-clr'), roseTend: $('rose-tend'),
      roseRudder: $('rose-rudder'), main: $('hud-main'), miniCard: $('rose-mini-card'), miniLetters: $('rose-mini-letters'), miniApp: $('rose-mini-app'),
      rudder: $('bar-rudder'), sheet: $('bar-sheet'), board: $('bar-board'), crew: $('crew-marker'),
      lblSheet: $('lbl-sheet'), lblBoard: $('lbl-board'), reefs: [$('reef-0'), $('reef-1'), $('reef-2'), $('reef-3')],
      telegraph: [$('tg-0'), $('tg-1'), $('tg-2')], pos: $('hud-pos'), posTack: $('hud-pos-tack'), posDeg: $('hud-pos-deg'),
      status: $('sail-status'), statusBox: $('sail-status').parentElement, warnings: $('warn-list'), rescue: $('btn-rescue'),
      optSheet: $('opt-sheet'), optBoard: $('opt-board'), optCrew: $('opt-crew'),
      ctlSheet: $('ctl-sheet'), ctlCrew: $('ctl-crew'), ctlReef: $('ctl-reef'),
      camera: $('hud-camera'), help: $('help'), pausedChip: $('paused-chip'), root: $('hud'), capsize: $('capsize'), capsizeText: $('capsize-text'),
    };
    $('rose-ticks').innerHTML = roseTicks();
    // мини: только риски через 45° и буквы
    // буквы — отдельной группой поверх стрелки ветра, крутятся вместе с картушкой
    let s = '';
    for (let a = 0; a < 360; a += 45) s += tick(a, a % 90 === 0 ? 44 : 46, 54);
    $('rose-mini-ticks').innerHTML = s;
    $('rose-mini-letters').innerHTML = [0, 90, 180, 270].map((a) => cardinal(a, 33)).join('');
    // сообщение о мели держится 3 с после последнего касания: на волнении касания
    // короткие и частые, без задержки надпись мерцает
    this._agroundUntil = 0;
    this._agroundMsg = '';
    this._agroundHull = false; // сел корпусом — показать кнопку «Вывести на глубину»
    this._toast = null; // [текст, класс, до какого времени] — разовое сообщение в ленте предупреждений
  }

  // короткое сообщение в ленте предупреждений на ms миллисекунд
  toast(text, cls = 'info', ms = 2500) {
    this._toast = [text, cls, performance.now() + ms];
  }

  // Роза в системе лодки (нос вверх, +x — правый борт). Углы округлены до 0.5°, координаты до 0.1 —
  // иначе атрибуты меняются каждый кадр
  _updateRose(boat) {
    const e = this.el, aw = boat.aw, sail = boat.sail, b = boat.balance;
    if (e.main.classList.contains('collapsed')) {
      const card = `rotate(${deg(-boat.psi)})`;
      attr(e.miniCard, 'transform', card);
      attr(e.miniLetters, 'transform', card);
      attr(e.miniApp, 'transform', `rotate(${deg(aw.awa)})`);
      return;
    }
    const K = ROSE_K, mast = `translate(0,${(-boat.cfg.mastX * K).toFixed(1)})`;
    attr(e.roseCard, 'transform', `rotate(${deg(-boat.psi)})`);
    // стрелки смотрят туда, куда дует ветер: хвост с наветренного борта
    attr(e.roseTrue, 'transform', `rotate(${deg(aw.twa)})`);
    attr(e.roseApp, 'transform', `rotate(${deg(aw.awa)})`);
    // гик от мачты назад; boom < 0 — левый борт (−x). Пунктир — предел шкота с того же борта
    attr(e.roseBoom, 'transform', `${mast} rotate(${deg(-sail.boom)})`);
    const side = sail.boom !== 0 ? Math.sign(sail.boom) : -sail.tackSide;
    attr(e.roseSheet, 'transform', `${mast} rotate(${deg(-side * sail.sheet)})`);
    // руль на транце, перо отклоняется так же, как гик: rudder < 0 — к левому борту
    attr(e.roseRudder, 'transform', `translate(0,19.5) rotate(${deg(-boat.rudder)})`);
    attr(e.roseCe, 'transform', `translate(${(b.ceY * K).toFixed(1)},${(-b.ce * K).toFixed(1)})`);
    attr(e.roseClr, 'transform', `translate(0,${(-b.clr * K).toFixed(1)})`);
    // тенденция: стрелка у носа к ветру (приводится) или от ветра (уваливается)
    const show = b.clrOk && Math.abs(b.tend) > 0.15;
    attr(e.roseClr, 'visibility', b.clrOk ? 'visible' : 'hidden');
    attr(e.roseTend, 'visibility', show ? 'visible' : 'hidden');
    if (show) {
      const toStb = Math.sign(b.tend) * Math.sign(aw.twa || 1) > 0;
      attr(e.roseTend, 'transform', toStb ? '' : 'scale(-1,1)');
      attr(e.roseTend, 'class', 'rose-tend ' + (b.tend > 0 ? 'luff' : 'bear'));
      attr(e.roseTend, 'opacity', (0.4 + 0.6 * Math.min(1, Math.abs(b.tend))).toFixed(1));
    }
  }

  // отметки оптимума (зелёные риски) и подсказки «пора тронуть» (мигание ряда); подсказки — только для каналов
  // в руках игрока (assist — ассистент или null, его channels — что он ведёт)
  _updateAdvice(boat, advice, assist) {
    const e = this.el, c = boat.cfg;
    // проценты до 0.5 и с отступом от краёв, чтобы риска не пряталась за скруглением полосы
    const pct = (f) => `${(Math.round(Math.max(0.02, Math.min(0.98, f)) * 200) / 2)}%`;
    css(e.optSheet, 'left', pct(1 - (advice.sheet - c.sheetMin) / (c.sheetMax - c.sheetMin)));
    css(e.optBoard, 'left', pct(advice.board));
    const y = Math.sign(advice.crewPos) * (Math.abs(advice.crewPos) === 2 ? c.crewMaxY : c.crewBenchY);
    css(e.optCrew, 'left', pct(0.5 + (y / c.crewMaxY) * 0.45));
    e.reefs.forEach((chip, i) => chip.classList.toggle('opt', i === advice.reef));
    const n = advice.need, mine = (ch) => !assist?.channels[ch];
    e.ctlSheet.classList.toggle('hint', mine('sheet') && n.sheet);
    e.ctlCrew.classList.toggle('hint', mine('crew') && n.crew);
    e.ctlReef.classList.toggle('hint', mine('reef') && n.reef);
  }

  // min — справка свёрнута в плашку, пауза остаётся
  showHelp(v, min = false) {
    this.el.help.classList.toggle('hidden', !v || min);
    this.el.pausedChip.classList.toggle('hidden', !(v && min));
    this.el.root.classList.toggle('paused-min', v && min);
  }

  // assist — ассистент, когда включён (иначе null); advice — советчик src/physics/trim.js (отметки и подсказки)
  update({ boat, wind, cameraMode, assist, advice }) {
    const e = this.el;
    const aw = boat.aw;
    const headingDeg = boat.psi / DEG;
    this._updateRose(boat);

    set(e.speed, 'textContent', (boat.u * 1.944).toFixed(1));
    set(e.heading, 'textContent', String(Math.round(headingDeg) % 360).padStart(3, '0') + '°');
    set(e.tws, 'textContent', aw.tws.toFixed(1));
    set(e.twa, 'textContent', Math.round(Math.abs(aw.twa) / DEG) + '°' + (aw.twa > 0 ? ' пр' : ' лв'));
    set(e.aws, 'textContent', aw.aws.toFixed(1));
    set(e.awa, 'textContent', Math.round(Math.abs(aw.awa) / DEG) + '°' + (aw.awa > 0 ? ' пр' : ' лв'));
    const heel = boat.phi / DEG;
    set(e.heel, 'textContent', Math.abs(heel).toFixed(0) + '° ' + (heel > 0.5 ? 'пр' : heel < -0.5 ? 'лв' : ''));
    set(e.leeway, 'textContent', (boat.u > 0.3 ? Math.abs(boat.leeway / DEG).toFixed(1) : '—') + '°');
    const bf = beaufort(wind.baseSpeed);
    set(e.beaufort, 'textContent', `${bf} балл${bf === 1 ? '' : bf < 5 ? 'а' : 'ов'} — ${BEAUFORT_NAMES[bf]}` + (wind.gusts ? ` · порыв ${Math.round(wind.gustFactor * 100)}%` : ''));

    // органы управления
    const rud = boat.rudder / boat.cfg.rudderMax;
    css(e.rudder, 'left', rud >= 0 ? '50%' : `${50 + rud * 50}%`);
    css(e.rudder, 'width', `${Math.abs(rud) * 50}%`);
    const sail = boat.sail;
    const sheetFrac = (sail.sheet - boat.cfg.sheetMin) / (boat.cfg.sheetMax - boat.cfg.sheetMin);
    css(e.sheet, 'width', `${(1 - sheetFrac) * 100}%`);
    set(e.lblSheet, 'textContent', `гик ${Math.round(sail.sheet / DEG)}°`);
    css(e.board, 'width', `${boat.board * 100}%`);
    set(e.lblBoard, 'textContent', boat.board > 0.95 ? 'опущен' : boat.board < 0.05 ? 'поднят' : `${Math.round(boat.board * 100)}%`);
    css(e.crew, 'left', `${50 + (boat.crewY / boat.cfg.crewMaxY) * 45}%`);
    const rl = sail.reefTarget;
    e.reefs.forEach((c, i) => c.classList.toggle('on', i === rl));
    if (advice) this._updateAdvice(boat, advice, assist);
    // курс к ветру: название, галс (кроме мёртвого угла) и угол
    const twaDeg = Math.abs(aw.twa) / DEG;
    this._pos = pointOfSail(twaDeg, this._pos ?? -1);
    set(e.pos, 'textContent', POINTS[this._pos][1]);
    set(e.posTack, 'textContent', this._pos ? (aw.twa > 0 ? ' · правый галс' : ' · левый галс') : '');
    set(e.posDeg, 'textContent', Math.round(twaDeg) + '°');
    let st = STATUS[sail.status] || STATUS.ok;
    if (assist?.channels.sheet) {
      const tg = assist.telegraph;
      e.telegraph.forEach((c, i) => c.classList.toggle('on', i === tg));
      if (assist.hint) st = [assist.hint, 'luff'];
      else if (tg < 2 && (sail.status === 'luff' || sail.status === 'ok')) st = ASSIST_STATUS[tg];
    }
    set(e.status, 'textContent', st[0]);
    set(e.statusBox, 'className', 'ctl status ' + st[1]);

    // предупреждения
    const w = [];
    const now = performance.now();
    if (boat.aground) {
      this._agroundUntil = now + 3000;
      this._agroundMsg = boat.boardAground ? 'Шверт задевает дно — поднимите шверт' : 'Мель! Отойдите от берега';
      this._agroundHull = !boat.boardAground;
    }
    const agr = now < this._agroundUntil;
    if (agr) w.push([this._agroundMsg, '']);
    // только шверт — поднять его может и сам игрок
    e.rescue.classList.toggle('hidden', !agr || !this._agroundHull || boat.capsized);
    if (this._toast && now < this._toast[2]) w.push(this._toast);
    if (boat.gybeFlash > 0) w.push(['Фордевинд! Гик перелетел', '']);
    if (!boat.capsized && Math.abs(heel) > 45) w.push(['Крен критический — травите шкот', '']);
    else if (!boat.capsized && Math.abs(heel) > 32) w.push(['Сильный крен', 'soft']);
    if (boat.water > 0.08 && !boat.capsized) w.push([`Вода в кокпите: ${Math.round(boat.water * 100)}%`, 'info']);
    const furlGoal = sail.reefTarget > 2 ? 1 : 0;
    if (sail.furl !== furlGoal) w.push([furlGoal ? 'Спускаем парус…' : 'Поднимаем парус…', 'info']);
    else if (sail.reefLevel !== Math.min(2, sail.reefTarget)) w.push([sail.reefTarget > sail.reefLevel ? 'Берём риф…' : 'Отдаём риф…', 'info']);
    set(e.warnings, 'innerHTML', w.map(([t, c]) => `<div class="w ${c}">${t}</div>`).join(''));
    e.capsize.classList.toggle('hidden', !boat.capsized);
    if (boat.capsized) {
      e.capsizeText.textContent = sail.reefLevel < 2
        ? 'Слишком много парусов для такого ветра. Возьмите рифы, травите шкот в порывах и откренивайте.'
        : 'Даже с рифами надо травить шкот в порывах и держать экипаж на наветренном борту.';
    }
    set(e.camera, 'textContent', CAMERA_NAMES[cameraMode] || cameraMode);
  }
}
