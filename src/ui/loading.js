// Экран загрузки: текущий этап, полоса по весам этапов и список готовых этапов с мс.
// Разметка и компас — статичные, в index.html (видны ещё до загрузки модулей). Текст меняется
// только между синхронными шагами старта: после step() нужен await frame(), иначе браузер
// не успеет его отрисовать.
const $ = (id) => document.getElementById(id);

export function createLoading(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const box = $('loading'), fill = $('loading-fill'), label = $('loading-step'), log = $('loading-log');
  const done = [];
  let cur = null, t = performance.now(), passed = 0;

  // закрыть текущий этап: строка «этап … мс» в список
  function close() {
    if (!cur) return;
    const now = performance.now(), ms = now - t;
    t = now;
    done.push({ этап: cur, мс: Math.round(ms) });
    passed += weights[cur] ?? 0;
    const li = document.createElement('li');
    li.append(cur, Object.assign(document.createElement('span'), { textContent: `${Math.round(ms)} мс` }));
    log.append(li);
    fill.style.width = `${Math.min(100, (passed / total) * 100).toFixed(1)}%`;
    cur = null;
  }

  return {
    step(name) {
      close();
      cur = name;
      label.textContent = name + '…';
    },
    // отдать кадр: rAF — браузер дошёл до отрисовки, setTimeout — кадр действительно ушёл на экран
    frame: () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
    // сводка таймингов — в консоль и в лог игры; экран гаснет и удаляется
    done() {
      close();
      const sum = done.reduce((a, d) => a + d.мс, 0);
      console.table(done);
      diag.info('загрузка', `${sum} мс: ${done.map((d) => `${d.этап} ${d.мс}`).join(', ')}`);
      box.classList.add('out');
      setTimeout(() => box.remove(), 400);
    },
  };
}
