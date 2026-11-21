# 03 — Страница tools + реестр URL-параметров

## Контекст
Пункт 3 беклога (`docs/backlog/03-tools-page.md`). Стенды (`src/debug/*.html`), jsc-скрипты, URL-параметры
игры и консольные хелперы разбросаны по README и коду. Нужна одна страница `tools.html` в корне со всеми
инструментами: что это, зачем, ссылки с готовыми параметрами.

Ответы на вопросы:
1. Ссылки из игры нет — только `/tools.html` и README.
2. **Реестр параметров делаем сразу**: `src/params.js` с описаниями, по нему разбирает параметры `main.js` и
   строится таблица на странице.
3. Превью-картинок нет.
4. Язык — русский.

## Шаги

### 0. Документы задачи
`docs/changes/tools-page/plan.md` — копия этого плана; `summary.md` дописываю после каждого шага.

### 1. Реестр `src/params.js` (только данные, без three — чтобы tools.html грузил его без importmap)
```js
// URL-параметры игры. Добавил параметр — допиши сюда, тогда он появится и в tools.html.
export const GAME_PARAMS = [
  { name: 'map', kind: 'str', values: 'demo | archipelago', desc: 'карта (src/maps/index.js), без параметра — демо' },
  { name: 'pos', kind: 'list', example: '120,-40,90', desc: 'старт лодки: x,z[,курс°]' },
  { name: 'veg', kind: 'num', example: '0.5', desc: 'плотность растительности, 1 — по умолчанию' },
  { name: 'dpr', kind: 'num', ... }, { name: 'perf', kind: 'flag', ... }, { name: 'touch', kind: 'flag', ... },
  { name: 't' }, { name: 'auto' }, { name: 'twa', default: 60 }, { name: 'wind' }, { name: 'winddir' },
  { name: 'cam', values: 'orbit | chase | top | deck' }, { name: 'camaz' }, { name: 'campolar' },
  { name: 'camdist' }, { name: 'campitch' }, { name: 'reefs' }, { name: 'board', values: '0..1' },
  { name: 'tod', values: '0..1' }, { name: 'clouds', values: 'Ясно | Кучевые | …' }, { name: 'log', kind: 'flag' },
];
// разбор: только заданные параметры; num → parseFloat, list → массив чисел, flag → true, str → строка
export function readParams(search = location.search) { … return { wind: 9, perf: true, … }; }
```
Поля записи: `name, kind (num|flag|str|list), desc, example?, values?, default?, group` (группы для
таблицы: «Карта и старт», «Ветер и лодка», «Камера», «Сцена», «Отладка»). Список значений `clouds` и
`cam` пишу строкой, чтобы не тянуть clouds.js/camera.js в реестр.

### 2. `main.js` и `touch.js` читают через реестр
- `main.js`: `const P = readParams();` вместо `params.get/has`. Пример:
  `if ('wind' in P) wind.baseSpeed = P.wind;`, `if (P.pos) { const [x, z, h] = P.pos; … }`,
  `const camPitch = (P.campitch ?? 0) * DEG`, `const autoTwa = (P.twa ?? 60) * DEG`,
  `const debugAuto = P.auto || 't' in P`. `reefs` — `Math.trunc`. Поведение не меняется.
- `src/ui/touch.js` `isTouchDevice()`: `readParams().touch`.
- Самопроверка в `readParams` не нужна; неизвестные параметры просто игнорируются (как сейчас).
- Стенды (`src/debug/*.html`) свои параметры разбирают сами и в реестр не переводятся — их параметры
  описаны на карточках вручную (их мало, и они живут в одном файле со стендом).

### 3. `tools.html` в корне
- Подключает Nunito и токены цвета. В `style.css` у `html, body` стоит `overflow: hidden` под канвас игры, поэтому
  `style.css` не подключаю: копирую нужные переменные (`--ink`, `--ink-soft`, `--card`, `--card-border`,
  `--accent`) в `<style>` страницы, фон тот же голубой `#9fd3ec`. Карточки на CSS grid, на 390 px — в одну колонку.
- Разделы:
  1. **Стенды** — 4 карточки (карта, библиотека объектов, лодка, моряк): что это и когда пригодится, ссылка,
     2–4 примера ссылок с параметрами (`src/debug/map-viewer.html?map=demo&layers=depth`,
     `props-viewer.html?cat=…&views=turn`, `boat-viewer.html?views=crew&live=1`, `sailor-viewer.html?views=hero` и т. п. —
     значения сверю с кодом стенда), список параметров одной строкой.
  2. **Игра с параметрами** — готовые ссылки (`?perf=1`, `?touch=1`, `?t=30&twa=60&cam=chase`,
     `?tod=0.9&clouds=Кучевые`, `?map=archipelago` — только как ссылка на просмотр, архипелаг не трогаем) и
     **таблица из `GAME_PARAMS`**: `<script type="module">import { GAME_PARAMS } from './src/params.js'`,
     строки сгруппированы по `group`, колонки: параметр, значения/пример (кликабельная ссылка `index.html?name=example`), описание.
  3. **Консоль** — `window.__sim` (что внутри), `polar(10)`, `runCase({ tws: 12, twa: 60, reefs: 1 })`.
  4. **CLI** — `python3 -m http.server`, команды jsc для `run-polar.mjs` и `trace.mjs` (с кнопкой «копировать»
     не заморачиваюсь — блок `<pre>`).
- `<noscript>`/фолбэк не нужен: страница локальная, под тем же сервером.

### 4. Мелочи
- `src/debug/trace.mjs` — шапка-комментарий: что выводит (трасса физики под автопилотом, tws=7, twa=60,
  40 с), как запустить.
- `README.md`: в «Отладка физики» — ссылка на `tools.html` и правило «новый URL-параметр игры — в
  `src/params.js`»; в «Структура» — строки `tools.html` и `src/params.js`.
- `docs/backlog/README.md` / `03-tools-page.md` — отметить решения и что пункт сделан.

## Файлы
Новые: `tools.html`, `src/params.js`, `docs/changes/tools-page/{plan,summary}.md`.
Правки: `src/main.js` (разбор параметров), `src/ui/touch.js`, `src/debug/trace.mjs`, `README.md`, беклог.

## Проверка
- `jsc` на `src/params.js`: `readParams('?wind=9&perf&pos=1,2,90&cam=chase')` → ожидаемый объект
  (передаю строку, `location` не трогаю).
- Сервер `python3 -m http.server` вне песочницы, headless Chrome:
  - `/tools.html` — скриншоты на 1280 и 390 px, нет горизонтальной прокрутки, таблица параметров заполнена
    (столько же строк, сколько записей в `GAME_PARAMS`), в консоли нет ошибок;
  - все ссылки со страницы открываются без ошибок в консоли (стенды и игра);
  - игра с `?t=30&twa=60&wind=9&cam=chase&reefs=1&board=0&tod=0.9&pos=…` — сравнить скриншот и
    `__sim.boat`/`__sim.wind`/`__sim.followCam` с main (до правки) — должны совпасть; отдельно `?touch=1`
    (тач-управление видно) и `?perf=1` (счётчик видно).
