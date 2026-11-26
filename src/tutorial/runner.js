// Ход обучающего квеста: шаги, условия, время, штрафы. Без three и DOM: тестируется в jsc.
// Квест (src/tutorial/quests.js): { id, kind: 'lesson'|'mission', ru: { title, intro }, setup?, zone?, steps }.
// Шаг: { ru: { task, say }, manual?, highlight?, assist?, check: () => условие, penalty?: () => условие }.
// check и penalty — фабрики: на каждом старте шага условия создаются заново.
//
// Состояния: idle — нет квеста; approach — миссия выбрана, плывём к зоне старта; ready — в зоне, ждём «Начать»;
// active — идёт; failed — урок сорван (переворот), можно повторить шаг; done — пройден.
// Перенос лодки, ветер урока и маску ассистента делает вызывающий (main.js) по событиям и view.

export const PENALTY_SEC = 10; // штраф за касание знака в зачётном времени

export function createQuestRunner(quests) {
  const byId = new Map(quests.map((q) => [q.id, q]));
  let quest = null, state = 'idle', i = 0, cond = null, pen = null, time = 0, penalties = 0;
  let checkpoint = null, last = null, failReason = '', result = null, zoneDist = Infinity;
  const events = [];
  const emit = (type, extra = {}) => events.push({ type, quest: quest?.id, step: i, ...extra });

  const beginStep = (boat) => {
    const s = quest.steps[i];
    cond = s.check();
    pen = s.penalty ? s.penalty() : null;
    checkpoint = { x: boat.x, z: boat.z, psi: boat.psi };
    last = null;
    emit('step');
  };

  const r = {
    get quest() { return quest; },
    get state() { return state; },
    get stepIndex() { return i; },
    get step() { return quest?.steps[i] ?? null; },
    get time() { return time; },
    get penalties() { return penalties; },
    get checkpoint() { return checkpoint; },
    get result() { return result; },
    get failReason() { return failReason; },
    get zoneDist() { return zoneDist; },
    get(id) { return byId.get(id); },

    // миссия: плыть к зоне старта; урок сразу start (перенос делает вызывающий)
    select(id) {
      quest = byId.get(id); i = 0; result = null;
      state = quest.zone ? 'approach' : 'idle';
      zoneDist = Infinity;
    },
    start(id, boat) {
      quest = byId.get(id); i = 0; time = 0; penalties = 0; result = null; failReason = '';
      state = 'active';
      emit('start');
      beginStep(boat);
    },
    abort() {
      if (quest) emit('abort');
      quest = null; state = 'idle'; cond = pen = null; zoneDist = Infinity;
    },
    // повторить текущий шаг после срыва; лодку к checkpoint ставит вызывающий
    retry(boat) {
      if (!quest) return;
      state = 'active'; failReason = '';
      const cp = checkpoint;
      beginStep(boat);
      checkpoint = cp;
    },

    // ctx — как у условий (src/tutorial/conditions.js); возвращает события кадра
    update(dt, ctx) {
      events.length = 0;
      const b = ctx.boat;
      if (state === 'approach' || state === 'ready') {
        const m = ctx.mark(quest.zone.mark);
        zoneDist = Math.hypot(b.x - m.x, b.z - m.z);
        if (state === 'approach' && zoneDist < quest.zone.r) { state = 'ready'; emit('ready'); }
        else if (state === 'ready' && zoneDist > quest.zone.r * 1.5) { state = 'approach'; emit('left'); }
        return events;
      }
      if (state !== 'active') return events;
      time += dt;
      if (quest.kind === 'lesson' && b.capsized) {
        state = 'failed'; failReason = 'capsize';
        emit('fail', { reason: failReason });
        return events;
      }
      if (pen && pen.update(dt, ctx).done) { penalties++; emit('penalty'); }
      last = cond.update(dt, ctx);
      if (last.done) {
        if (++i < quest.steps.length) beginStep(b);
        else {
          state = 'done';
          result = { time, penalties, total: time + penalties * PENALTY_SEC };
          emit('done', result);
        }
      }
      return events;
    },

    // для UI: цель (знаки, точка, расстояние, пеленг 0 = север), прогресс шага
    target(boat, mark) {
      let t = null;
      if (state === 'approach' || state === 'ready') {
        const m = mark(quest.zone.mark);
        t = { marks: [quest.zone.mark], x: m.x, z: m.z, zone: quest.zone.r };
      } else if (state === 'active' && last?.target) t = last.target;
      if (!t) return null;
      const dx = t.x - boat.x, dz = t.z - boat.z;
      return { ...t, dist: Math.hypot(dx, dz), bearing: Math.atan2(dx, -dz) };
    },
    get progress() { return last?.progress ?? 0; },
  };
  return r;
}
