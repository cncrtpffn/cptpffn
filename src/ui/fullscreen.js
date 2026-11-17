// Полноэкранный режим через Fullscreen API. На iPhone API для элементов нет —
// там кнопки скрыты, а без интерфейса браузера можно играть, добавив сайт на экран «Домой».
import { ICONS } from './icons.js';

const doc = document;
const el = doc.documentElement;
const enabled = () => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
const current = () => doc.fullscreenElement || doc.webkitFullscreenElement;
// уже запущено как приложение с экрана «Домой». (display-mode: fullscreen) сюда не годится:
// в Chrome он совпадает и когда само окно браузера развёрнуто на весь экран
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function enter(lockPortrait) {
  await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen());
  // на телефонах игра только в портрете; блокировка ориентации работает лишь в fullscreen (Android)
  if (lockPortrait) screen.orientation?.lock?.('portrait').catch(() => {});
}
function exit() {
  return doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen();
}

export function setupFullscreen(buttons, { lockPortrait = false } = {}) {
  if (!enabled() || standalone()) { buttons.forEach((b) => b.remove()); return; }
  const sync = () => {
    const on = !!current();
    buttons.forEach((b) => {
      b.innerHTML = on ? ICONS.fullscreenExit : ICONS.fullscreen;
      b.title = on ? 'Выйти из полноэкранного режима' : 'Полный экран';
      b.setAttribute('aria-label', b.title);
    });
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    (current() ? exit() : enter(lockPortrait)).catch(() => {});
  }));
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  sync();
}
