// Лог игры без консоли браузера: перехват console.* и необработанных ошибок в кольцевой буфер,
// красный тост об ошибке и диалог «Логи» (копировать / поделиться / скачать).
// Обычный скрипт, не модуль: грузится в <head> до importmap и ловит и падения загрузки модулей
// (недоступен CDN three, синтаксическая ошибка). Наружу — window.diag.
(() => {
  const MAX_ENTRIES = 2000;
  const MAX_LEN = 4000; // обычная запись режется, ошибки — нет (в них лог шейдера и стек)
  const t0 = Date.now();
  const entries = [];
  const info = []; // шапка лога: [ключ, значение]
  const failed = []; // имена отключённых фич для тоста
  // метки ошибок, которые не про отключённую фичу: в тосте не перечисляются
  const NOT_FEATURES = ['ошибка', 'запуск', 'кадр'];
  const handled = new WeakSet(); // ошибки, о которых уже сообщили: их повторный выброс не дублировать
  let started = false; // игра запустилась (main.js убрал «Загрузка…»)
  let fatal = null;

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

  // текст ошибки со стеком: в Safari и Firefox stack без имени и сообщения
  function errorText(e) {
    if (!(e instanceof Error)) return String(e);
    const head = `${e.name}: ${e.message}`;
    const stack = e.stack || '';
    return stack.startsWith(head) || stack.includes(e.message) ? stack : `${head}\n${stack}`;
  }
  function str(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return errorText(a);
    if (a === undefined || a === null || typeof a !== 'object') return String(a);
    try { return JSON.stringify(a); } catch { return Object.prototype.toString.call(a); }
  }

  function push(level, args) {
    let text = args.map(str).join(' ');
    if (level !== 'error' && text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN)}… (+${text.length - MAX_LEN})`;
    // повтор той же строки (ошибка каждый кадр) — счётчик у прошлой записи
    const last = entries[entries.length - 1];
    if (last && last.level === level && last.text === text) { last.count++; last.lastTime = Date.now(); return; }
    entries.push({ time: Date.now(), level, text, count: 1 });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  }

  const orig = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[level] = console[level].bind(console);
    console[level] = (...args) => { push(level, args); orig[level](...args); };
  }

  // необработанные ошибки; до старта игры любая — фатальная: main.js не дошёл до первого кадра
  window.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el !== window && (el.tagName === 'SCRIPT' || el.tagName === 'LINK')) {
      const src = el.src || el.href || '(встроенный)';
      // у модуля браузер не говорит, какой из импортов упал: сам файл или, например, three с CDN
      const what = el.tagName === 'SCRIPT' ? `скрипт ${src} или один из его импортов (three с CDN?) — проверьте сеть` : `ресурс ${src}`;
      report('загрузка', `не загрузился ${what}`, { fatal: el.tagName === 'SCRIPT' && !started });
      return;
    }
    if (handled.has(e.error)) return; // уже показано через diag.fail (critical в features.js)
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
    report(started ? 'ошибка' : 'запуск', e.error ?? `${e.message}${where}`, { fatal: !started });
  }, true);
  window.addEventListener('unhandledrejection', (e) => handled.has(e.reason) || report(started ? 'ошибка' : 'запуск', e.reason, { fatal: !started }));

  // ошибка в лог с меткой фичи, без тоста; в консоль — исходным console.error (со ссылками на исходник)
  function logError(feature, err) {
    push('error', [`[${feature}] ${typeof err === 'string' ? err : errorText(err)}`]);
    orig.error(`[${feature}]`, err);
  }

  // ошибка: в лог + тост; feature — что отключилось («вода»), fatal — игра не запустится
  function report(feature, err, { fatal: isFatal = false } = {}) {
    logError(feature, err);
    if (isFatal) {
      fatal ??= { feature, text: typeof err === 'string' ? err : `${err?.name ?? 'Error'}: ${err?.message ?? err}` };
      whenBody(showFatal);
      return;
    }
    if (!failed.includes(feature)) failed.push(feature);
    whenBody(showToast);
  }

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  // --- текст лога ---
  function text() {
    const now = new Date();
    const head = [
      `Кэтбот — лог от ${now.toLocaleString('ru-RU')}`,
      `URL: ${location.href}`,
      `UA: ${navigator.userAgent}`,
      `Экран: ${screen.width}×${screen.height}, окно ${innerWidth}×${innerHeight}, DPR ${devicePixelRatio}`,
      `Тач: ${navigator.maxTouchPoints > 0 ? `да (${navigator.maxTouchPoints})` : 'нет'}, secure context: ${isSecureContext ? 'да' : 'нет'}`,
      ...info.map(([k, v]) => `${k}: ${v}`),
      `Отключено: ${failed.length ? failed.join(', ') : '—'}${fatal ? ` · ФАТАЛЬНО: ${fatal.feature}` : ''}`,
      '',
    ];
    const lines = entries.map((e) => {
      const rel = ((e.time - t0) / 1000).toFixed(2).padStart(7);
      const rep = e.count > 1 ? ` (×${e.count}, последний ${clock(new Date(e.lastTime))})` : '';
      return `${clock(new Date(e.time))} +${rel}s ${e.level.toUpperCase().padEnd(5)} ${e.text}${rep}`;
    });
    return head.concat(lines).join('\n');
  }
  const fileName = () => {
    const d = new Date();
    return `catboat-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
  };

  // --- UI ---
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const btn = (label, onClick, cls = '') => {
    const b = el('button', { type: 'button', className: cls, textContent: label });
    b.addEventListener('click', onClick);
    return b;
  };

  let toast = null;
  function showToast() {
    if (fatal) return;
    if (!toast) {
      toast = el('div', { id: 'diag-toast', role: 'alert' });
      toast.append(
        el('span', { className: 'diag-toast-text' }),
        btn('Логи', () => open()),
        btn('✕', () => { toast.remove(); toast = null; }, 'diag-toast-close'),
      );
      document.body.append(toast);
    }
    const what = failed.filter((f) => !NOT_FEATURES.includes(f));
    const title = started ? 'Произошла ошибка' : 'Ошибка при загрузке';
    toast.firstChild.textContent = what.length ? `${title}: отключено — ${what.join(', ')}` : title;
  }

  // вместо «Загрузка…» — что сломалось и кнопки; игра не запустится
  function showFatal() {
    toast?.remove(); toast = null;
    let box = document.getElementById('loading');
    if (!box) { box = el('div', { id: 'loading' }); document.body.append(box); }
    box.classList.add('diag-fatal');
    box.replaceChildren(el('div', { className: 'diag-fatal-card' },
      el('h2', { textContent: 'Игра не запустилась' }),
      el('p', { textContent: `${fatal.feature}: ${fatal.text}` }),
      el('div', { className: 'diag-actions' }, btn('Логи', () => open()), btn('Перезагрузить', () => location.reload()))));
  }

  let dialog = null, area = null, status = null;
  function setStatus(s) { status.textContent = s; }

  async function copy() {
    const t = area.value;
    try {
      await navigator.clipboard.writeText(t);
      setStatus('Скопировано в буфер обмена');
      return;
    } catch { /* нет Clipboard API (http, старый браузер) или запрещено — пробуем по-старому */ }
    area.readOnly = false; // на iOS readonly-поле не выделяется
    area.focus();
    area.setSelectionRange(0, t.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.readOnly = true;
    setStatus(ok ? 'Скопировано в буфер обмена' : 'Текст выделен — скопируйте его вручную');
  }

  async function share() {
    const t = area.value;
    const file = new File([t], fileName(), { type: 'text/plain' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Лог Кэтбота' });
      else await navigator.share({ title: 'Лог Кэтбота', text: t });
    } catch (e) {
      if (e?.name !== 'AbortError') setStatus(`Не удалось поделиться: ${e?.message ?? e}`);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([area.value], { type: 'text/plain' }));
    const a = el('a', { href: url, download: fileName() });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function build() {
    area = el('textarea', { className: 'diag-log', readOnly: true, spellcheck: false });
    status = el('span', { className: 'diag-status' });
    const shareBtn = btn('Поделиться', share);
    if (!navigator.share) shareBtn.hidden = true;
    const card = el('div', { className: 'card diag-card' },
      btn('✕', close, 'close'),
      el('h2', { textContent: 'Логи' }),
      el('p', { className: 'muted', textContent: 'Если что-то сломалось — пришлите этот текст разработчику.' }),
      area,
      el('div', { className: 'diag-actions' }, status, btn('Копировать', copy), shareBtn, btn('Скачать .txt', download)));
    dialog = el('div', { id: 'diag-dialog', className: 'overlay hidden' }, card);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    document.body.append(dialog);
  }

  // пока диалог открыт, клавиши не доходят до управления лодкой (Input слушает window)
  window.addEventListener('keydown', (e) => {
    if (!dialog || dialog.classList.contains('hidden')) return;
    if (e.code === 'Escape') close();
    e.stopPropagation();
  }, true);

  function open() {
    whenBody(() => {
      if (!dialog) build();
      area.value = text();
      setStatus('');
      dialog.classList.remove('hidden');
      area.scrollTop = area.scrollHeight;
    });
  }
  function close() { dialog?.classList.add('hidden'); }

  window.diag = {
    // ошибка фичи: в лог со стеком и в тост (fatal — экран «Игра не запустилась»)
    fail: report,
    // пометить ошибку как уже показанную и вернуть её — для throw после fail(…, {fatal: true})
    handled: (e) => { if (e && typeof e === 'object') handled.add(e); return e; },
    // ошибка только в лог, без тоста
    error: logError,
    // строка в шапку лога (GPU, версия three)
    info: (key, value) => info.push([key, value]),
    // main.js дошёл до первого кадра: дальше ошибки — не фатальные
    started: () => { started = true; },
    get failed() { return failed.slice(); },
    get fatal() { return fatal; },
    text,
    open,
    close,
  };
})();
