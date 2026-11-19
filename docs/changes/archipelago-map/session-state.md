# Состояние сессии (для продолжения работы)

Снимок на 2026-11-19, конец сессии: контекст заполнен. Здесь всё, чтобы продолжить в новой сессии без истории переписки.

## Задача
Новая карта «Архипелаг» 3×3 км для теста производительности: большая карта, много объектов.
- **В демо не подключать.** Смотрим только на стенде `/src/debug/map-viewer.html?map=archipelago`.
- Позже включим в игре get-параметром.
- Работаем итерациями, каждый шаг согласуем с пользователем:
  1. карта высот;
  2. биомы;
  3. объекты: растительность, поселения, порты.

Дока: `plan.md` (планы шагов 1 и 2), `summary.md` (итоги по шагам, решения, скриншоты), скриншоты в `img/`.

## Где остановились
- **Шаги 1–2 приняты** (WIP-коммит `7fa8263`).
- **Шаг 3 (объекты)** сделан. Пользователь перешёл к следующему: LOD построек и плотную застройку отложил.
- **Шаг 4 (карта в игре и тени вокруг камеры)** сделан, ждёт ОК.
  - В игре: `?map=archipelago`, `?pos=x,z[,курс°]`. Без `pos` старт в Соляной гавани (`map.start`).
- Итоги и цифры — `summary.md`, разделы «Шаг 3» и «Шаг 4».
- **Не закоммичено** (после `7fa8263`). Коммитить только по просьбе пользователя.
- **Отложено:** LOD построек, плотнее застройка, ускорение загрузки (2.7 с), туман для 3 км.

## Файлы
| файл | что внутри |
|---|---|
| `src/maps/archipelago.js` | описание карты: `islands` (`kind` mountain/plain, `lobes`, `biome`, `cliff`/`cliffMin`, `label`), `ridges`, `bays`/`shoals`/`reefs` (с `name`), `spits`, `biomeRegions` (2 ручные + 8 с `auto`), `biomeRules` (3 правила), `sites` (port/town/village/lighthouse, `proto`) |
| `src/scene/terrain/noise.js` | `createNoise(seed)` → `noise2`, `fbm`, `ridged`, `warp`; `mulberry32` |
| `src/scene/terrain/shapes.js` | `smooth`, `sdEllipse` (внутри ограничен −min(a, b)), `sdPolyline`, `sdPolygon`, `smin`, `polyBox` |
| `src/scene/terrain/heightfield.js` | `buildHeightfield(map)` → сетка 2 м: `heights`, `material` (`MAT`: auto, sand, rock), `owner` (индекс острова или −1), `sites` (с итоговой `h`), `sample`, `slope`, `materialAt`, `ms` |
| `src/scene/terrain/biomes.js` | `classifyBiomes(hf, map, regions)` → `weights` (Uint8 × 4: none, south, north, atlantic), `biome` (преобладающий), `zone`, `moist`, `zoneAt`, `biomeAt`, `weightsAt`, `pickBiome(x, z, u)` (рощами ~30 м), `paint`; `BIOMES` (палитры и параметры), `ZONES`, `regionWeight`, `regionBox` |
| `src/scene/terrain/biome-rules.js` | инструмент: `regionsFromRules(hf, map)` → области (эллипс или выпуклый многоугольник, с `auto`), `regionsToCode` |
| `src/scene/terrain/terrain-mesh.js` | `buildTerrain(hf, paint, { chunk: 200, step: 4, coarse: 25, deep: 15, skirt: 4 })` — чанки, индексная сетка, flatShading |
| `src/scene/terrain/settlements.js` | `buildSettlements(hf, bio, map)` → `{ group, occ, counts, sites, stats }`: города и порты (сетка улиц, площадь, общественные здания, набережная), деревни, окраины, маяки, дороги A* между поселениями острова; `occupancy(hf)` — маска занятости (1 — дорога, 2 — постройка) |
| `src/scene/terrain/vegetation.js` | `buildVegetation(hf, bio, occ, { density, cell: 300, bare })` → `{ group, update(camPos, lod), counts, protoTris, stats }`: InstancedMesh по ячейкам, LOD near/far по видам (`KINDS`), плотности `DENSITY`, деревья по биому и зоне `TREES` |
| `src/scene/structures/houses.js` | + `lighthouse-fastnet` (маяк-скала для Слезы) |
| `src/scene/terrain/world.js` | `buildWorld(map, { regions, tstep, density })` — сборка мира для игры и стенда |
| `src/maps/index.js` | реестр `MAPS` |
| `src/main.js` | `?map=` — мир, карта берега на весь мир (4096²), отражения, LOD, тень `shadowRange`; `?pos=` — старт (без него — `map.start`) |
| `src/scene/environment.js` | `fitShadow` — окно тени с квантованием по текселю; `cfg.shadowRange` — тень вокруг камеры |
| `src/debug/map-viewer.html` | режим `map=archipelago`; слои `veg`, `build`, `lod`; `?veg=` плотность; кнопка «бенч 5 с» / `?bench=сек` |

Код игры: в шаге 4 изменены `main.js` и `environment.js`. Демо без `?map` ведёт себя как раньше, кроме возврата лодки к `pos` и исправленного отрицательного `dt`.

## Стенд
- **Параметры URL:**
  - `map=archipelago`;
  - `layers=terrain,height,biome,zones,regions,depth,dist,normal,sites,grid,labels`;
  - `cam=x,z,h,pitch,yaw`;
  - `tstep=2` — шаг меша, по умолчанию 4;
  - `autoregions=1` — инструмент областей: пересчёт auto-областей и панель с кодом. Кнопка «области по правилам» в панели слоёв.
- **Отладка:** `window.__map = { env, shoreMap, camera, view, render, scene, hf, bio, terrain, settle, veg, frameInfo, runBench, bench }`. Сценарии бенча — меняем `__map.view`, затем `runBench(ms)`, ждём, пока поменяется `__map.bench`.
- **Цифры загрузки:** поле высот ~0.85–1.0 с, биомы ~0.26 с, меш ~0.1 с, карта берега ~0.27 с. Меш 0.97 млн треугольников, 225 чанков.
- **Полезные ракурсы:**
  - весь архипелаг — без `cam`;
  - Северный от фьорда — `cam=-560,-330,520,42,0`;
  - Южный — `cam=700,1250,420,38,-10`;
  - Высокий и Луговой — `cam=980,-60,380,35,20`;
  - скала Слеза — `cam=-1310,-1310,55,22,-45`;
  - граница смешения — `cam=-380,-800,600,90,0&layers=biome,regions`.

## Как проверять
- **Сервер:** `http://127.0.0.1:8080` поднят пользователем, но кэширует ES-модули: браузер подхватывал старые `houses.js` и `archipelago.js` даже с `ignoreCache`. Проверять через свой no-store сервер на 8081: скрипт `SimpleHTTPRequestHandler` с заголовком `Cache-Control: no-store`, в фоне вне песочницы.
- **Chrome DevTools MCP:** страница `pageId 1`, окно 1200×678.
  - `navigate_page` всегда с `ignoreCache: true`.
  - Консоль — `list_console_messages`. Лог «Архипелаг: …» показывает время и число треугольников.
- **Скриншоты дорогие:** именно они съели контекст этой сессии.
  - Снимать в `docs/changes/archipelago-map/img/` через `filePath`. Путь в scratchpad MCP не принимает.
  - Читать только нужные кадры, без повторов. Для промежуточных — `jpeg` с низким `quality` или `evaluate_script` с цифрами вместо картинки.
- **jsc для чистой логики:** `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m file.mjs`. Нужен полифил `globalThis.performance ??= { now: () => Date.now() }`. На three.js-модулях jsc не работает.
- **Старая карта** (стенд без `map=`) должна грузиться без ошибок: 5 островов.

## Шаг 3 — заметки
- **Порядок построения:** поселения → маска `occ` → растительность. Растительность обходит постройки и дороги.
- **Полезные ракурсы:**
  - порт Порто-Сале — `cam=370,590,130,40,180`;
  - лес Северного низко — `cam=-650,-560,45,12,70`;
  - Слеза — `cam=-1290,-1290,28,10,-45`.
- **Цифры при плотности 1:** 1069 построек, 88.5 тыс. экземпляров растительности. Кадр 2.2–2.8 мс, 60 fps. Без LOD при плотности 4 — 40 fps.

## Известные огрехи
- На общем плане частично перекрываются подписи «Коса»/«Дюны» и «Луговая губа»/«Овсы».
- Выпуклая оболочка в инструменте областей захватывает лишнее у вогнутых кусков («Вересковые высоты 2»).
- Карта берега (`maxDepth` = 4, 2048 текселей ≈ 1.5 м на 3 км) — для игры, возможно, мало. Решим при подключении в игру.
- LOD у рельефа нет.
