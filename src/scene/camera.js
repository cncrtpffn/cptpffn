import * as THREE from 'three';

const MODES = ['orbit', 'chase', 'top', 'deck'];

export class FollowCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 'orbit';
    this.azimuth = Math.PI * 0.75;   // мировой азимут камеры относительно лодки
    this.polar = 1.15;               // от вертикали
    this.distance = 16;
    this.pos = new THREE.Vector3(0, 8, 14);
    this.look = new THREE.Vector3();
    // скретч для update — без новых векторов каждый кадр
    this._target = new THREE.Vector3(); this._desired = new THREE.Vector3(); this._lookAt = new THREE.Vector3();
    // активные указатели: один — вращение, два — щипок (зум)
    this._ptrs = new Map();
    this._span = 0;
    const span = () => { const [a, b] = [...this._ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    dom.addEventListener('pointerdown', (e) => {
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 2) this._span = span();
      try { dom.setPointerCapture(e.pointerId); } catch { /* указатель уже отпущен */ }
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this._ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this._ptrs.size >= 2) {
        const s = span();
        if (this._span > 0 && s > 0) this.distance = THREE.MathUtils.clamp(this.distance * this._span / s, 5, 70);
        this._span = s;
        return;
      }
      if (this.mode === 'deck') this.deckYaw = (this.deckYaw || 0) - dx * 0.006;
      else this.azimuth -= dx * 0.006;
      this.polar = THREE.MathUtils.clamp(this.polar + dy * 0.004, 0.2, 1.5);
      if (this.mode === 'chase') this.mode = 'orbit';
    });
    const up = (e) => { this._ptrs.delete(e.pointerId); this._span = this._ptrs.size === 2 ? span() : 0; };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => {
      this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.0012), 5, 70);
    }, { passive: true });
  }

  // стартовая настройка (start.json → camera): mode — тип, angleDeg — угол от носа по часовой
  // (90 — правый борт, 180 — за кормой; на палубе — куда смотрит рулевой), distance — зум, м
  configure({ mode, angleDeg, distance } = {}, psi = 0) {
    if (MODES.includes(mode)) {
      this.mode = mode;
      if (mode === 'deck') { this.polar = 1.45; this.deckYaw = 0; }
    }
    if (Number.isFinite(angleDeg)) {
      const a = THREE.MathUtils.degToRad(angleDeg);
      if (this.mode === 'deck') this.deckYaw = a;
      else this.azimuth = psi + a;
    }
    if (Number.isFinite(distance)) this.distance = THREE.MathUtils.clamp(distance, 5, 70);
  }

  nextMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    if (this.mode === 'deck') { this.polar = 1.45; this.deckYaw = 0; }
    if (this.mode === 'orbit') { this.polar = 1.15; this.distance = 16; }
    return this.mode;
  }

  update(dt, boat, boatMesh) {
    const target = this._target.set(boat.x, boat.y + 1.2, boat.z);
    const desired = this._desired;
    const lookAt = this._lookAt.copy(target);
    let k = 1 - Math.exp(-dt * 5);
    if (this.mode === 'top') {
      desired.set(boat.x, 30 + this.distance * 1.5, boat.z + 0.01);
      lookAt.set(boat.x, 0, boat.z);
      k = 1 - Math.exp(-dt * 3);
    } else if (this.mode === 'deck') {
      // камера у румпеля, в связанной СК лодки
      const fwdX = Math.sin(boat.psi), fwdZ = -Math.cos(boat.psi);
      const stbX = Math.cos(boat.psi), stbZ = Math.sin(boat.psi);
      // глазами рулевого: позиция головы матроса, сам матрос скрыт
      if (boatMesh) boatMesh.eyeWorld(desired); else desired.set(boat.x - fwdX * 1.0, boat.y + 1.5, boat.z - fwdZ * 1.0);
      const a = boat.psi + (this.deckYaw || 0); // взгляд относительно носа
      lookAt.set(desired.x + Math.sin(a) * 10, desired.y - 0.3 + (1.15 - this.polar) * 10, desired.z - Math.cos(a) * 10);
      k = 1 - Math.exp(-dt * 14);
    } else {
      if (this.mode === 'chase') {
        const behind = boat.psi + Math.PI;
        let d = behind - this.azimuth;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.azimuth += d * (1 - Math.exp(-dt * 1.2));
      }
      const r = this.distance;
      desired.set(
        target.x + Math.sin(this.azimuth) * Math.sin(this.polar) * r,
        target.y + Math.cos(this.polar) * r,
        target.z - Math.cos(this.azimuth) * Math.sin(this.polar) * r,
      );
      const minY = boat.y + 1.2;
      if (desired.y < minY) desired.y = minY;
    }
    if (boatMesh) boatMesh.setCrewVisible(this.mode !== 'deck');
    this.pos.lerp(desired, k);
    this.look.lerp(lookAt, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
