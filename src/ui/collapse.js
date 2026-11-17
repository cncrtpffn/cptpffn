// Сворачиваемые панели HUD. Состояние запоминается в localStorage.

export const SMALL_SCREEN = '(max-width: 700px), (max-height: 500px)';

export function loadState(key) {
  try { const v = localStorage.getItem('catboat.ui.' + key); return v === null ? null : v === '1'; } catch { return null; }
}
export function saveState(key, collapsed) {
  try { localStorage.setItem('catboat.ui.' + key, collapsed ? '1' : '0'); } catch { /* приватный режим */ }
}

export function makeCollapsible(panel, { key, title, defaultCollapsed = matchMedia(SMALL_SCREEN).matches }) {
  const btn = document.createElement('button');
  btn.className = 'collapse-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  panel.appendChild(btn);
  const set = (c) => {
    panel.classList.toggle('collapsed', c);
    btn.setAttribute('aria-expanded', String(!c));
  };
  const saved = loadState(key);
  set(saved === null ? defaultCollapsed : saved);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = !panel.classList.contains('collapsed');
    set(c);
    saveState(key, c);
  });
  return { set };
}
