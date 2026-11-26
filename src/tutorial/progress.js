// Прогресс обучающих квестов: что пройдено, лучшее время, число попыток. Без three и DOM.
// Хранится в localStorage['catboat.quests'] как { v: 1, done: { <id>: { best, at, tries } } }.
// Что открыто в курсе, не хранится: урок открыт, если пройден предыдущий.
// Хранилище недоступно (приватный режим) или данные битые — прогресс живёт в памяти, без ошибок.
export const PROGRESS_KEY = 'catboat.quests';
const VERSION = 1;

// storage — объект с getItem/setItem (по умолчанию localStorage); knownIds — id квестов (чужие отбрасываются);
// unlockAll — все уроки открыты и ничего не записывается (?quests=all)
export function createProgress({ storage, knownIds = null, unlockAll = false } = {}) {
  const readOnly = unlockAll;
  let store = storage;
  if (store === undefined) { try { store = globalThis.localStorage ?? null; } catch { store = null; } }
  let data = { v: VERSION, done: {} };
  try {
    const raw = store?.getItem(PROGRESS_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && d.v === VERSION && d.done && typeof d.done === 'object') {
      for (const [id, e] of Object.entries(d.done)) {
        if (knownIds && !knownIds.includes(id)) continue;
        if (e && Number.isFinite(e.best)) data.done[id] = { best: e.best, at: e.at ?? 0, tries: e.tries ?? 1 };
      }
    }
  } catch { /* битый JSON или хранилище недоступно — начинаем с нуля */ }
  const save = () => {
    if (readOnly) return;
    try { store?.setItem(PROGRESS_KEY, JSON.stringify(data)); } catch { /* хранилище недоступно */ }
  };
  const tries = {}; // попытки без прохождения — только в памяти

  return {
    isDone: (id) => !!data.done[id],
    best: (id) => data.done[id]?.best ?? null,
    entry: (id) => data.done[id] ?? null,
    // попытка начата
    started(id) { tries[id] = (tries[id] ?? 0) + 1; },
    // пройден за time секунд; true — новый рекорд
    record(id, time, now = Date.now()) {
      const e = data.done[id];
      const t = (e?.tries ?? 0) + (tries[id] || 1); // без started — одна попытка
      tries[id] = 0;
      const better = !e || time < e.best;
      data.done[id] = { best: better ? time : e.best, at: now, tries: t };
      save();
      return better;
    },
    // урок курса открыт: первый или пройден предыдущий
    unlocked(order, id) {
      const i = order.indexOf(id);
      return unlockAll || i <= 0 || !!data.done[order[i - 1]];
    },
    reset() { data = { v: VERSION, done: {} }; save(); },
    get data() { return data; },
  };
}
