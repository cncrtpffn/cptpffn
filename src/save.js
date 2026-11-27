// Сохранение мира между сессиями: время суток, погода, лодка, камера — та же структура, что start.json.
// Хранится в localStorage['catboat.save.<карта>'] как { v: 1, map, at, timeOfDay, weather, boat, camera }.
// Файл сохранения — мир + прогресс обучения (catboat.quests) + авто-матрос (catboat.assist).
// Без three и DOM: грузится в jsc (src/debug/run-save.mjs). store — объект с getItem/setItem/removeItem.
import { PROGRESS_KEY } from './tutorial/progress.js';

const VERSION = 1;
const PREFIX = 'catboat.save.';
export const ASSIST_KEY = 'catboat.assist';
export const saveKey = (mapId) => PREFIX + mapId;
const CAM_MODES = ['orbit', 'chase', 'top', 'deck'];
const RAD = 180 / Math.PI;

const num = (v) => (Number.isFinite(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const str = (v) => (typeof v === 'string' && v ? v : undefined);
// объект без undefined-полей; пустой — undefined
const pick = (o) => {
  const r = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return Object.keys(r).length ? r : undefined;
};
const wrap360 = (a) => ((a % 360) + 360) % 360;

// проверка сохранения мира: битые и лишние поля отбрасываются, null — сохранение негодно целиком
export function cleanWorld(d) {
  if (!d || typeof d !== 'object' || d.v !== VERSION) return null;
  const w = d.weather ?? {}, wi = w.wind ?? {}, s = w.sea ?? {}, b = d.boat ?? {}, c = d.camera ?? {};
  const boat = pick({ x: num(b.x), z: num(b.z), headingDeg: num(b.headingDeg), reefs: num(b.reefs), board: num(b.board) });
  // без координат лодки сохранение бессмысленно
  if (boat?.x === undefined || boat?.z === undefined) return null;
  return pick({
    v: VERSION, map: str(d.map), at: num(d.at),
    timeOfDay: num(d.timeOfDay) === undefined ? undefined : Math.min(1, Math.max(0, d.timeOfDay)),
    weather: pick({
      preset: str(w.preset), clouds: str(w.clouds),
      wind: pick({ speed: num(wi.speed), dirDeg: num(wi.dirDeg), gusts: bool(wi.gusts), gustStrength: num(wi.gustStrength), shiftDeg: num(wi.shiftDeg) }),
      sea: pick({ auto: bool(s.auto), state: num(s.state) }),
    }),
    boat,
    camera: pick({ mode: CAM_MODES.includes(c.mode) ? c.mode : undefined, angleDeg: num(c.angleDeg), distance: num(c.distance) }),
  });
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export function readSave(store, mapId) {
  try { return cleanWorld(parse(store?.getItem(saveKey(mapId)))); } catch { return null; }
}

// start.json + сохранение: вложенные объекты сливаются поле за полем
export function mergeStart(start, saved) {
  if (!saved) return start;
  const w = start.weather ?? {}, sw = saved.weather ?? {};
  return {
    ...start,
    ...(saved.timeOfDay !== undefined && { timeOfDay: saved.timeOfDay }),
    weather: { ...w, ...sw, wind: { ...w.wind, ...sw.wind }, sea: { ...w.sea, ...sw.sea } },
    camera: { ...start.camera, ...saved.camera },
  };
}

// снимок мира. scene — { timeOfDay, clouds, preset } (состояние панели погоды); cam — FollowCamera
export function snapshot({ mapId, boat, wind, sea, scene, cam, now = Date.now() }) {
  const r = (v, k = 100) => Math.round(v * k) / k;
  return {
    v: VERSION, map: mapId, at: now,
    timeOfDay: scene.timeOfDay,
    weather: {
      preset: scene.preset, clouds: scene.clouds,
      wind: { speed: wind.baseSpeed, dirDeg: wind.baseDirDeg, gusts: wind.gusts, gustStrength: wind.gustStrength, shiftDeg: wind.shiftDeg },
      sea: { auto: sea.auto, state: r(sea.state) },
    },
    boat: { x: r(boat.x), z: r(boat.z), headingDeg: r(wrap360(boat.psi * RAD), 10), reefs: boat.sail.reefTarget, board: r(boat.board) },
    // угол камеры от носа по часовой — обратное к FollowCamera.configure
    camera: { mode: cam.mode, angleDeg: r(wrap360((cam.mode === 'deck' ? cam.deckYaw || 0 : cam.azimuth - boat.psi) * RAD), 10), distance: r(cam.distance, 10) },
  };
}

export function writeSave(store, world) {
  try { store?.setItem(saveKey(world.map), JSON.stringify(world)); return true; } catch { return false; }
}

// файл сохранения: мир текущей карты, прогресс обучения, авто-матрос
export function exportBundle(store, mapId) {
  const get = (k) => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  return {
    kind: 'catboat-save', v: VERSION, at: Date.now(),
    world: readSave(store, mapId),
    quests: parse(get(PROGRESS_KEY)),
    assist: get(ASSIST_KEY) === '1',
  };
}

// разбор файла и запись в хранилище. Возвращает { ok, error?, map? }; map — карта мира из файла
export function importBundle(store, text) {
  const d = typeof text === 'string' ? parse(text) : text;
  if (!d || d.kind !== 'catboat-save') return { ok: false, error: 'not-save' };
  if (d.v !== VERSION) return { ok: false, error: 'version' };
  const world = d.world == null ? null : cleanWorld(d.world);
  if (d.world != null && (!world || !world.map)) return { ok: false, error: 'broken' };
  // прогресс проверит createProgress при загрузке (чужие id и битые записи отбрасываются); здесь — только форма
  const quests = d.quests && d.quests.done && typeof d.quests.done === 'object' ? d.quests : null;
  try {
    clearProgress(store);
    if (world) store.setItem(saveKey(world.map), JSON.stringify(world));
    if (quests) store.setItem(PROGRESS_KEY, JSON.stringify(quests));
    if (typeof d.assist === 'boolean') store.setItem(ASSIST_KEY, d.assist ? '1' : '0');
  } catch { return { ok: false, error: 'storage' }; }
  return { ok: true, map: world?.map ?? null };
}

// удалить прогресс: миры всех карт и обучение; настройки (авто-матрос, панели) остаются
export function clearProgress(store) {
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) keys.push(store.key(i));
    for (const k of keys) if (k === PROGRESS_KEY || k.startsWith(PREFIX)) store.removeItem(k);
  } catch { /* хранилище недоступно */ }
}
