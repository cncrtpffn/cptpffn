// UI обучающих квестов: меню «Обучение» (курс и миссии), карточка текущего квеста, итог и срыв урока.
// Логика квеста — src/tutorial/runner.js, связка с игрой — main.js (обработчики h).
// Карточка обновляется каждый кадр — пишем в DOM только изменившееся (как в hud.js).
import { makeCollapsible } from './collapse.js';

const $ = (id) => document.getElementById(id);
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
const show = (el, v) => { if (changed(el, 'hidden', v)) el.classList.toggle('hidden', !v); };

export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 5) * 5} м` : `${(m / 1000).toFixed(1)} км`);
const COMPASS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const compass = (rad) => COMPASS[Math.round(((rad / Math.PI * 180) % 360 + 360) % 360 / 45) % 8];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// lessons, missions — из src/tutorial/quests.js; progress — src/tutorial/progress.js;
// h — { start(id), route(id), begin(), abort(), retry(), menu(), closed() }
export function createQuestUi({ lessons, missions, progress, h }) {
  const course = lessons.map((q) => q.id);
  const el = {
    menu: $('quests'), course: $('q-course'), missions: $('q-missions'),
    hintCourse: $('q-hint-course'), hintMissions: $('q-hint-missions'),
    card: $('quest-card'), kind: $('qc-kind'), title: $('qc-title'), time: $('qc-time'), steps: $('qc-steps'),
    task: $('qc-task'), fill: $('qc-progress'), say: $('qc-say'), manual: $('qc-manual'), begin: $('qc-begin'), exit: $('qc-exit'),
    result: $('quest-result'), rBadge: $('qr-badge'), rTitle: $('qr-title'), rText: $('qr-text'), rActions: $('qr-actions'),
  };
  let tab = 'course', boatPos = null, markPos = null;
  makeCollapsible(el.card, { key: 'quest', title: 'Карточка урока', defaultCollapsed: false });

  // --- меню ---
  const renderMenu = () => {
    el.course.innerHTML = lessons.map((q, i) => {
      const open = progress.unlocked(course, q.id), done = progress.isDone(q.id), best = progress.best(q.id);
      return `<li class="q-item ${done ? 'done' : ''} ${open ? '' : 'locked'}">
        <span class="q-num">${done ? '✓' : open ? i + 1 : '🔒'}</span>
        <span class="q-text"><b>${esc(q.ru.title)}</b><small>${esc(q.ru.intro)}</small>${best !== null ? `<small class="q-best">Лучшее время ${fmtTime(best)}</small>` : ''}</span>
        <button data-start="${q.id}" ${open ? '' : 'disabled'}>${done ? 'Повторить' : 'Начать'}</button></li>`;
    }).join('');
    el.missions.innerHTML = missions.map((q) => {
      const done = progress.isDone(q.id), best = progress.best(q.id);
      let where = '';
      if (boatPos && markPos) {
        const m = markPos(q.zone.mark), dx = m.x - boatPos.x, dz = m.z - boatPos.z;
        where = `<small class="q-where">До старта ${fmtDist(Math.hypot(dx, dz))}, на ${compass(Math.atan2(dx, -dz))}</small>`;
      }
      return `<li class="q-item ${done ? 'done' : ''}">
        <span class="q-num">${done ? '✓' : '⚑'}</span>
        <span class="q-text"><b>${esc(q.ru.title)}</b><small>${esc(q.ru.intro)}</small>${where}${best !== null ? `<small class="q-best">Рекорд ${fmtTime(best)}</small>` : ''}</span>
        <button data-route="${q.id}">Проложить курс</button></li>`;
    }).join('');
  };
  const setTab = (t) => {
    tab = t;
    el.menu.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    el.course.classList.toggle('hidden', t !== 'course'); el.hintCourse.classList.toggle('hidden', t !== 'course');
    el.missions.classList.toggle('hidden', t !== 'missions'); el.hintMissions.classList.toggle('hidden', t !== 'missions');
  };
  el.menu.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  el.menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (e.target === el.menu || b?.id === 'btn-quests-close') { ui.closeMenu(); return; }
    if (!b) return;
    if (b.dataset.start) { ui.closeMenu(); h.start(b.dataset.start); }
    else if (b.dataset.route) { ui.closeMenu(); h.route(b.dataset.route); }
    else if (b.id === 'btn-quests-reset' && confirm('Сбросить прогресс обучения? Пройденные уроки снова закроются.')) { progress.reset(); renderMenu(); }
  });

  // --- карточка ---
  el.begin.addEventListener('click', () => h.begin());
  el.exit.addEventListener('click', () => h.abort());
  el.manual.addEventListener('click', (e) => e.stopPropagation());

  // --- итог / срыв ---
  const dialog = (badge, title, text, buttons) => {
    el.rBadge.textContent = badge; el.rTitle.textContent = title; el.rText.innerHTML = text;
    el.rActions.innerHTML = '';
    for (const [label, fn, cls] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { el.result.classList.add('hidden'); fn(); });
      el.rActions.append(b);
    }
    el.result.classList.remove('hidden');
  };

  const ui = {
    get menuOpen() { return !el.menu.classList.contains('hidden'); },
    get dialogOpen() { return !el.result.classList.contains('hidden'); },
    // boat, mark — чтобы показать расстояние до зон миссий
    openMenu(boat, mark) {
      boatPos = boat ? { x: boat.x, z: boat.z } : null; markPos = mark;
      renderMenu();
      setTab(tab);
      el.menu.classList.remove('hidden');
    },
    closeMenu() { el.menu.classList.add('hidden'); h.closed(); },

    // карточка по состоянию runner'а; target — runner.target(...)
    update(runner, target) {
      const q = runner.quest, st = runner.state;
      const visible = !!q && st !== 'idle';
      show(el.card, visible);
      if (!visible) return;
      const lesson = q.kind === 'lesson';
      set(el.kind, 'textContent', lesson ? `Урок ${course.indexOf(q.id) + 1}` : 'Миссия');
      set(el.title, 'textContent', q.ru.title);
      const active = st === 'active' || st === 'failed';
      set(el.time, 'textContent', active ? fmtTime(runner.time) + (runner.penalties ? ` +${runner.penalties}✕` : '') : '');
      const n = q.steps.length, i = Math.min(runner.stepIndex, n - 1);
      set(el.steps, 'innerHTML', active || st === 'done' ? q.steps.map((_, k) => `<i class="${k < runner.stepIndex || st === 'done' ? 'ok' : k === i ? 'now' : ''}"></i>`).join('') : '');
      const step = q.steps[i];
      let task, say, manual = step?.manual;
      if (st === 'approach') { task = `Доберитесь до зоны старта${target ? ` — ${fmtDist(target.dist)}` : ''}`; say = q.ru.intro; manual = null; }
      else if (st === 'ready') { task = 'Вы в зоне старта'; say = q.ru.intro; manual = null; }
      else { task = step.ru.task; say = step.ru.say ?? ''; }
      if (active && target && !target.zone) task += ` · ${fmtDist(target.dist)}`;
      set(el.task, 'textContent', task);
      set(el.say, 'textContent', say);
      show(el.say, !!say);
      css(el.fill, 'width', `${Math.round((active ? runner.progress : 0) * 100)}%`);
      show(el.fill.parentElement, active);
      show(el.manual, !!manual);
      if (manual) set(el.manual, 'href', `manual.html${manual}`);
      show(el.begin, st === 'ready');
      set(el.exit, 'textContent', st === 'approach' || st === 'ready' ? 'Отменить' : 'Выйти');
    },

    // итог: result — runner.result, record — новый рекорд, nextId — следующий урок курса (или null)
    showResult(q, result, record, nextId) {
      const t = fmtTime(result.total);
      const pen = result.penalties ? ` (с учётом штрафа за касание знаков: ${result.penalties} × 10 с)` : '';
      const lesson = q.kind === 'lesson';
      const buttons = [['Меню', () => h.menu(), 'secondary'], ['Повторить', () => h.start(q.id), 'secondary']];
      if (nextId) buttons.push(['Следующий урок', () => h.start(nextId)]);
      else buttons.push(['Продолжить', () => h.abort()]);
      dialog(lesson ? 'Урок пройден' : 'Миссия выполнена', q.ru.title,
        `Время: <b>${t}</b>${pen}.${record ? ' <b>Новый рекорд!</b>' : ''}${lesson && !nextId ? '<br>Это был последний урок курса.' : ''}`, buttons);
    },
    showFail(q) {
      dialog('Урок прерван', 'Лодка перевернулась',
        'Ничего страшного: повторите шаг с того же места. В свежий ветер травите шкот в порывах и откренивайте.',
        [['Выйти из урока', () => h.abort(), 'secondary'], ['Повторить шаг', () => h.retry()]]);
    },
    hideDialog() { el.result.classList.add('hidden'); },
  };
  return ui;
}
