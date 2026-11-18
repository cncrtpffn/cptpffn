import { DEG, beaufort, BEAUFORT_NAMES } from '../config.js';

const $ = (id) => document.getElementById(id);
const STATUS = {
  luff: ['Парус полощет — выберите шкот', 'luff'],
  ok: ['Парус тянет', 'ok'],
  stall: ['Шкот перебран — потравите', 'stall'],
  run: ['Полный курс — тяга от сопротивления', 'ok'],
  gybe: ['Поворот фордевинд — гик идёт!', 'gybe'],
};
const CAMERA_NAMES = { orbit: 'орбита', chase: 'за кормой', top: 'сверху', deck: 'с палубы' };

export class Hud {
  constructor() {
    this.el = {
      speed: $('hud-speed'), heading: $('hud-heading'), tws: $('hud-tws'), twa: $('hud-twa'),
      aws: $('hud-aws'), awa: $('hud-awa'), heel: $('hud-heel'), leeway: $('hud-leeway'),
      beaufort: $('hud-beaufort'), roseTrue: $('rose-true'), roseApp: $('rose-app'), roseBoat: $('rose-boat'),
      rudder: $('bar-rudder'), sheet: $('bar-sheet'), board: $('bar-board'), crew: $('crew-marker'),
      lblSheet: $('lbl-sheet'), lblBoard: $('lbl-board'), reefs: [$('reef-0'), $('reef-1'), $('reef-2')],
      status: $('sail-status'), statusBox: $('sail-status').parentElement, warnings: $('warnings'),
      camera: $('hud-camera'), help: $('help'), capsize: $('capsize'), capsizeText: $('capsize-text'),
    };
    const ticks = $('rose-ticks');
    let s = '';
    for (let a = 0; a < 360; a += 10) {
      const major = a % 90 === 0;
      const r1 = major ? 48 : 52;
      const rad = a * DEG;
      s += `<line x1="${(Math.sin(rad) * r1).toFixed(1)}" y1="${(-Math.cos(rad) * r1).toFixed(1)}" x2="${(Math.sin(rad) * 56).toFixed(1)}" y2="${(-Math.cos(rad) * 56).toFixed(1)}"/>`;
    }
    ticks.innerHTML = s;
    this._tick = 0;
    // сообщение о мели держится 3 с после последнего касания: на волнении касания
    // короткие и частые, без задержки надпись мерцает
    this._agroundUntil = 0;
    this._agroundMsg = '';
  }

  showHelp(v) { this.el.help.classList.toggle('hidden', !v); }

  update({ boat, wind, cameraMode }) {
    const e = this.el;
    const aw = boat.aw;
    const headingDeg = boat.psi / DEG;
    e.roseBoat.setAttribute('transform', `rotate(${headingDeg.toFixed(1)})`);
    e.roseTrue.setAttribute('transform', `rotate(${(wind.dir / DEG).toFixed(1)})`);
    e.roseApp.setAttribute('transform', `rotate(${(headingDeg + aw.awa / DEG).toFixed(1)})`);

    e.speed.textContent = (boat.u * 1.944).toFixed(1);
    e.heading.textContent = String(Math.round(headingDeg) % 360).padStart(3, '0') + '°';
    e.tws.textContent = aw.tws.toFixed(1);
    e.twa.textContent = Math.round(Math.abs(aw.twa) / DEG) + '°' + (aw.twa > 0 ? ' пр' : ' лв');
    e.aws.textContent = aw.aws.toFixed(1);
    e.awa.textContent = Math.round(Math.abs(aw.awa) / DEG) + '°' + (aw.awa > 0 ? ' пр' : ' лв');
    const heel = boat.phi / DEG;
    e.heel.textContent = Math.abs(heel).toFixed(0) + '° ' + (heel > 0.5 ? 'пр' : heel < -0.5 ? 'лв' : '');
    e.leeway.textContent = (boat.u > 0.3 ? Math.abs(boat.leeway / DEG).toFixed(1) : '—') + '°';
    const bf = beaufort(wind.baseSpeed);
    e.beaufort.textContent = `${bf} балл${bf === 1 ? '' : bf < 5 ? 'а' : 'ов'} — ${BEAUFORT_NAMES[bf]}` + (wind.gusts ? ` · порыв ${Math.round(wind.gustFactor * 100)}%` : '');

    // органы управления
    const rud = boat.rudder / boat.cfg.rudderMax;
    e.rudder.style.left = rud >= 0 ? '50%' : `${50 + rud * 50}%`;
    e.rudder.style.width = `${Math.abs(rud) * 50}%`;
    const sail = boat.sail;
    const sheetFrac = (sail.sheet - boat.cfg.sheetMin) / (boat.cfg.sheetMax - boat.cfg.sheetMin);
    e.sheet.style.width = `${(1 - sheetFrac) * 100}%`;
    e.lblSheet.textContent = `гик ${Math.round(sail.sheet / DEG)}°`;
    e.board.style.width = `${boat.board * 100}%`;
    e.lblBoard.textContent = boat.board > 0.95 ? 'опущен' : boat.board < 0.05 ? 'поднят' : `${Math.round(boat.board * 100)}%`;
    e.crew.style.left = `${50 + (boat.crewY / boat.cfg.crewMaxY) * 45}%`;
    const rl = sail.reefTarget;
    e.reefs.forEach((c, i) => c.classList.toggle('on', i === rl));
    const st = STATUS[sail.status] || STATUS.ok;
    e.status.textContent = st[0];
    e.statusBox.className = 'ctl status ' + st[1];

    // предупреждения
    const w = [];
    const now = performance.now();
    if (boat.aground) {
      this._agroundUntil = now + 3000;
      this._agroundMsg = boat.boardAground ? 'Шверт задевает дно — поднимите шверт' : 'Мель! Отойдите от берега';
    }
    if (now < this._agroundUntil) w.push([this._agroundMsg, '']);
    if (boat.gybeFlash > 0) w.push(['Фордевинд! Гик перелетел', '']);
    if (!boat.capsized && Math.abs(heel) > 45) w.push(['Крен критический — травите шкот', '']);
    else if (!boat.capsized && Math.abs(heel) > 32) w.push(['Сильный крен', 'soft']);
    if (boat.water > 0.08 && !boat.capsized) w.push([`Вода в кокпите: ${Math.round(boat.water * 100)}%`, 'info']);
    if (sail.reefLevel !== sail.reefTarget) w.push([sail.reefTarget > sail.reefLevel ? 'Берём риф…' : 'Отдаём риф…', 'info']);
    if (this._tick++ % 3 === 0) {
      e.warnings.innerHTML = w.map(([t, c]) => `<div class="w ${c}">${t}</div>`).join('');
    }
    e.capsize.classList.toggle('hidden', !boat.capsized);
    if (boat.capsized) {
      e.capsizeText.textContent = sail.reefLevel < 2
        ? 'Слишком много парусов для такого ветра. Возьмите рифы, травите шкот в порывах и откренивайте.'
        : 'Даже с рифами надо травить шкот в порывах и держать экипаж на наветренном борту.';
    }
    e.camera.textContent = CAMERA_NAMES[cameraMode] || cameraMode;
  }
}
