// Экранное управление для тачскринов: аналоговые слайдеры руля и шкота + кнопки.
// Слайдер работает как джойстик: точка касания — центр, отклонение пальца задаёт
// скорость перекладки (как удержание клавиши, только плавно). Под ручкой — индикатор текущего
// положения руля и шкота (как бары органов управления на десктопе).

import { ICONS } from './icons.js';
import { readParams } from '../params.js';

const DEADZONE = 0.08;

const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* указатель уже отпущен */ } };

export function isTouchDevice() {
  if (readParams().touch) return true;
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

const shape = (v) => {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * Math.pow((Math.min(a, 1) - DEADZONE) / (1 - DEADZONE), 1.5);
};

function slider(root, vertical, onAxis) {
  const track = root.querySelector('.t-track');
  const knob = root.querySelector('.t-knob');
  let id = null, x0 = 0, y0 = 0;
  const range = () => (vertical ? track.clientHeight : track.clientWidth) / 2 - 18;
  const release = () => {
    id = null;
    knob.style.transform = '';
    root.classList.remove('active');
    onAxis(0);
  };
  track.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    capture(track, id);
    root.classList.add('active');
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const r = range();
    const d = Math.max(-r, Math.min(r, vertical ? e.clientY - y0 : e.clientX - x0));
    knob.style.transform = vertical ? `translateY(${d}px)` : `translateX(${d}px)`;
    // вверх по экрану = выбрать шкот (+1)
    onAxis(shape(vertical ? -d / r : d / r));
  });
  track.addEventListener('pointerup', (e) => { if (e.pointerId === id) release(); });
  track.addEventListener('pointercancel', (e) => { if (e.pointerId === id) release(); });
}

// кнопка, действующая пока её держат
function hold(btn, onDown, onUp) {
  btn.addEventListener('pointerdown', (e) => { capture(btn, e.pointerId); btn.classList.add('down'); onDown(); e.preventDefault(); });
  const up = () => { btn.classList.remove('down'); onUp(); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
}

export function createTouchControls(input) {
  if (!isTouchDevice()) return null;
  document.body.classList.add('touch');

  const ui = document.createElement('div');
  ui.id = 'touch-ui';
  ui.innerHTML = `
    <div class="t-left">
      <div class="t-panel t-btns">
        <div class="t-sec" style="--n:2"><span class="t-ico" role="img" aria-label="Шверт" title="Шверт">${ICONS.board}</span><div class="t-row"><button data-board="-1">▲</button><button data-board="1">▼</button></div></div>
        <div class="t-sec" style="--n:2"><span class="t-ico" role="img" aria-label="Рифы" title="Рифы">${ICONS.reef}</span><div class="t-row"><button data-reef="1">+</button><button data-reef="-1">−</button></div></div>
        <div class="t-sec" style="--n:3"><span class="t-ico" role="img" aria-label="Экипаж" title="Экипаж">${ICONS.crew}</span><div class="t-row"><button data-crew="left" aria-label="на шаг к левому борту">◀</button><button data-crew="swap" aria-label="на другой борт">⇄</button><button data-crew="right" aria-label="на шаг к правому борту">▶</button></div></div>
      </div>
      <div class="t-slider h" id="t-rudder"><div class="t-track"><div class="t-ind centered"><div class="t-fill"></div><div class="t-mid"></div></div><div class="t-knob"></div></div><span class="t-label">руль</span></div>
    </div>
    <div class="t-right">
      <div class="t-slider v" id="t-sheet"><div class="t-track"><div class="t-ind"><div class="t-fill"></div></div><div class="t-knob"></div></div><span class="t-label">шкот</span></div>
    </div>`;
  document.body.appendChild(ui);
  ui.querySelectorAll('.t-btns button').forEach((b) => b.classList.add('ui-btn'));

  slider(ui.querySelector('#t-rudder'), false, (v) => { input.touch.rudder = v; });
  slider(ui.querySelector('#t-sheet'), true, (v) => { input.touch.sheet = v; });

  ui.querySelectorAll('[data-board]').forEach((b) => hold(b, () => { input.touch.board = +b.dataset.board; }, () => { input.touch.board = 0; }));
  ui.querySelectorAll('[data-reef]').forEach((b) => b.addEventListener('click', () => input.trigger('reef', +b.dataset.reef)));
  ui.querySelectorAll('[data-crew]').forEach((b) => b.addEventListener('click', () => input.trigger('crew', b.dataset.crew)));

  // индикаторы: руль — от середины в сторону перекладки, шкот — снизу вверх, сколько выбран
  const rudFill = ui.querySelector('#t-rudder .t-fill').style, sheetFill = ui.querySelector('#t-sheet .t-fill').style;
  let lastRud = NaN, lastSheet = NaN;
  const update = (boat) => {
    const rud = Math.round(boat.rudder / boat.cfg.rudderMax * 200) / 2;
    if (rud !== lastRud) {
      lastRud = rud;
      rudFill.left = `${50 + Math.min(rud, 0)}%`;
      rudFill.width = `${Math.abs(rud)}%`;
    }
    const sheet = Math.round((boat.cfg.sheetMax - boat.sail.sheet) / (boat.cfg.sheetMax - boat.cfg.sheetMin) * 200) / 2;
    if (sheet !== lastSheet) { lastSheet = sheet; sheetFill.height = `${sheet}%`; }
  };
  return { el: ui, update };
}
