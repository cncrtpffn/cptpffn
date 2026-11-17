// Клавиатура: непрерывные оси и одиночные события.
export class Input {
  constructor() {
    this.keys = new Set();
    this.crew = 0;
    this.handlers = {};
    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  _emit(name, arg) { (this.handlers[name] || []).forEach((f) => f(arg)); }

  _down(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (!e.repeat) {
      switch (e.code) {
        case 'KeyR': this._emit('reef', +1); break;
        case 'KeyF': this._emit('reef', -1); break;
        case 'KeyZ': this.crew = -1; break;
        case 'KeyX': this.crew = 0; break;
        case 'KeyC': this.crew = 1; break;
        case 'KeyV': this._emit('camera'); break;
        case 'KeyH': this._emit('help'); break;
        case 'Escape': this._emit('escape'); break;
        case 'Enter': this._emit('righten'); break;
        case 'Space': this._emit('pause'); e.preventDefault(); break;
      }
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
  }

  has(...codes) { return codes.some((c) => this.keys.has(c)); }

  get controls() {
    const k = this;
    let rudder = 0, sheet = 0, board = 0;
    if (k.has('ArrowLeft', 'KeyA')) rudder -= 1;
    if (k.has('ArrowRight', 'KeyD')) rudder += 1;
    if (k.has('ArrowUp', 'KeyW')) sheet += 1;
    if (k.has('ArrowDown', 'KeyS')) sheet -= 1;
    if (k.has('KeyQ')) board -= 1;
    if (k.has('KeyE')) board += 1;
    return { rudder, sheet, board, crew: this.crew };
  }
}
