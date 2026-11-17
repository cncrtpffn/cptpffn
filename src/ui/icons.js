// Инлайн-иконки органов управления. Цвет берут из currentColor.

const svg = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // шверт: корпус и плавник под ним
  board: svg('<path d="M2 6h20q-1.5 4-5.5 4h-9Q3.5 10 2 6z" fill="currentColor"/><path d="M8.5 10 7.5 19.5q.3 2 2.2 1.2L15.5 10" fill="currentColor" fill-opacity="0.35"/>'),
  // риф: мачта, гафельный грот, гик и риф-сезни
  reef: svg('<path d="M6 2v20"/><path d="M7 8l11-6 1 17H7z" fill="currentColor" fill-opacity="0.35"/><path d="M5 19h15"/><path d="M10 15.5v1.5M13 15.5v1.5M16 15.5v1.5" stroke-width="1.5"/>'),
  // экипаж: схематичный человек
  // погода: облачко
  weather: svg('<path d="M7 19h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 10.1 4.5 4.5 0 0 0 7 19z" fill="currentColor" fill-opacity="0.35"/>'),
  // полноэкранный режим: уголки наружу / внутрь
  fullscreen: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  fullscreenExit: svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>'),
  crew: svg('<circle cx="12" cy="4.5" r="2.5" fill="currentColor"/><path d="M12 8v7M6 10.5l6-1.5 6 1.5M12 15l-4 6.5M12 15l4 6.5"/>'),
};

export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
}
