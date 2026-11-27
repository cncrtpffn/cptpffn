# Сохранение игры между сессиями

## Контекст
Сейчас при каждой загрузке лодка стоит на старте из `start.json` (или `map.start`), погода и время — тоже оттуда. Чтобы исследовать мир за несколько заходов, нужно запоминать состояние мира между сессиями. Прогресс обучения уже хранится (`localStorage['catboat.quests']`, `src/tutorial/progress.js`). Ещё нужны три действия: скачать сохранение в файл, загрузить его из файла и удалить прогресс.

Что решили:
- В файл идут мир, прогресс обучения и флаг авто-матроса.
- «Удалить прогресс» стирает мир и обучение. Авто-матрос и свёрнутость панелей — это настройки, их не трогаем.
- После загрузки файла и после удаления страница перезагружается.

Документы задачи: `docs/changes/save-game/plan.md` (копия этого плана) и `summary.md`. Ветка `save-game` от `tutorial-quests`: прогресс квестов есть только там.

## Формат
`localStorage['catboat.save.<mapId>']`: структура как у `start.json` плюс версия и время:
```json
{ "v": 1, "map": "demo", "at": 1764150000000,
  "timeOfDay": 0.21,
  "weather": { "preset": "Умеренный", "clouds": "Кучевые",
    "wind": { "speed": 7, "dirDeg": 0, "gusts": true, "gustStrength": 0.3, "shiftDeg": 12 },
    "sea": { "auto": true, "state": 0.3 } },
  "boat": { "x": 160, "z": -90, "headingDeg": 90, "reefs": 0, "board": 1 },
  "camera": { "mode": "orbit", "angleDeg": 45, "distance": 32 } }
```
Файл экспорта `catboat-save-<дата>.json` = `{ kind: "catboat-save", v: 1, world: <то же, что выше>, quests: <данные progress>, assist: bool }`.

## Изменения

### 1. `src/save.js` — новый модуль без three и DOM, по образцу `progress.js`
- `SAVE_KEY(mapId)`, `readSave(store, mapId)`: читает сохранение и проверяет его (версия, конечные числа, `camera.mode` из допустимых). Битые поля отбрасываются, остальное подмешивается к `start.json`.
- `mergeStart(start, saved)`: глубокое слияние `start.json` с сохранением (weather, wind, sea, boat, camera).
- `snapshot({ boat, wind, sea, panelState, followCam, mapId })` → объект формата выше. `headingDeg` из `boat.psi`, `reefs` из `boat.sail.reefTarget`, `board`. `angleDeg` камеры относительно носа: обратная формула к `FollowCamera.configure` (`azimuth − psi`; для `deck` — `deckYaw`).
- `exportBundle(store, mapId)` / `importBundle(store, json)`: сборка файла и разбор с проверкой. Разбор раскладывает данные по ключам `catboat.save.<map>`, `catboat.quests` (`PROGRESS_KEY`) и `catboat.assist`. Если в файле другая карта, пишем по её ключу и предупреждаем в тосте.
- `clearProgress(store)`: удаляет все `catboat.save.*` и `catboat.quests`.

### 2. `src/main.js`
- После `fetch('start.json')`: `START = mergeStart(START, readSave(...))`. Сохранение не применяется с `?pos`, `?quest` и новым `?nosave`. Позиция из сохранения перекрывает `MAP.start`. `startBoat` для «Вернуть лодку» остаётся стартом карты (без сохранения): кнопка по-прежнему возвращает на исходную точку. Позицию из сохранения ставим отдельной `savedBoat` в первом `placeBoat()`.
- Автосохранение раз в 5 с симвремени, а также на `visibilitychange` (hidden) и `pagehide`. Не пишем, пока идёт урок (`quests.lessonActive`): иначе запомнится телепорт урока, а остаётся последнее состояние до урока. Не пишем и с `?nosave`. Миссии сохраняются как обычное плавание.
- Действия `actions.saveDownload`, `actions.saveLoad(file)`, `actions.saveClear`. Скачивание: Blob + `<a download>`. Загрузка: скрытый `<input type=file accept=".json">`, затем `importBundle` и `location.reload()`. Удаление: `confirm()`, затем `clearProgress`, отключение автосохранения (чтобы `pagehide` не записал заново) и `location.reload()`.

### 3. Панель погоды `src/ui/weather-panel.js`
- Возвращать `state` (preset, timeOfDay, clouds) наружу: сейчас он локальный, а снимку нужны время суток, облачность и пресет. Например, `gui.state = state` или `{ gui, state }`.

### 4. UI: блок «Сохранение» на экране паузы (`index.html`, `#help .actions`)
- Кнопки «Скачать», «Загрузить…» и «Удалить прогресс» (последняя — `secondary`, с красным акцентом), строка «Сохранено: <время>». Стиль как у `#btn-logs` в `style.css`; на таче (390×844) кнопки переносятся.
- Тосты: «Сохранение скачано», «Файл не похож на сохранение», «Сохранение для другой карты».

### 5. Реестр параметров `src/params.js`
- `nosave` (flag, группа «Карта и старт»): не читать и не писать сохранение. Таблица на tools.html обновится сама.

## Проверка
- `src/debug/run-save.mjs` (`jsc -m`, по образцу `run-quests.mjs`) с хранилищем-заглушкой: круговой путь snapshot → readSave → mergeStart, битый JSON, чужая версия, NaN в полях, импорт и экспорт бандла, clearProgress не трогает `catboat.assist` и `catboat.ui.*`.
- Chrome DevTools (сервер — `python http.server` вне песочницы): отплыть, поменять ветер и время, перезагрузить. Лодка, курс, рифы, ветер, время, облака и камера должны совпасть. Проверить урок (во время урока сохранение не пишется, после перезагрузки лодка на месте до урока), «Вернуть лодку» (уходит на старт карты), скачивание и загрузку файла (с перезагрузкой), удаление (старт из `start.json`, уроки сброшены), `?nosave`, `?pos`. Тач 390×844: блок на паузе не ломает раскладку. Ошибок в консоли нет.
