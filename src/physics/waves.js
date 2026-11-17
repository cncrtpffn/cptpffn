import { G, DEG } from '../config.js';

const N = 4;
const LAMBDA_FRAC = [1, 0.55, 0.3, 0.16];
const AMP_FRAC = [0.55, 0.3, 0.18, 0.1];
const DIR_OFFSET = [0, 25, -30, 50];
const STEEPNESS = 0.62;

// Волны Герстнера. Одна функция для CPU (лодка, буи) и для шейдера (uniforms).
export class Waves {
  constructor() {
    this.time = 0;
    this.sigHeight = 0;
    this.targetHeight = 0;
    this.mainLambda = 12;
    this.targetLambda = 12;
    this.windDir = 0;
    this.dirX = new Float32Array(N);
    this.dirZ = new Float32Array(N);
    this.amp = new Float32Array(N);
    this.k = new Float32Array(N);
    this.phase = new Float32Array(N);
    this.q = new Float32Array(N);
    this.omega = new Float32Array(N);
    this._rebuild();
  }

  // Задать целевое волнение: значимая высота (м), направление ветра «откуда» (рад), скорость ветра.
  configure(sigHeight, windDir, windSpeed) {
    this.targetHeight = sigHeight;
    this.targetLambda = Math.min(40, Math.max(6, 3 + 2.2 * windSpeed));
    this.windDir = windDir;
  }

  _rebuild() {
    for (let i = 0; i < N; i++) {
      const d = this.windDir + DIR_OFFSET[i] * DEG;
      // волны бегут по ветру: вектор «куда»
      this.dirX[i] = -Math.sin(d);
      this.dirZ[i] = Math.cos(d);
      const lambda = this.mainLambda * LAMBDA_FRAC[i];
      this.k[i] = 2 * Math.PI / lambda;
      this.omega[i] = Math.sqrt(G * this.k[i]);
      this.amp[i] = 0.5 * this.sigHeight * AMP_FRAC[i];
      const ka = this.k[i] * this.amp[i];
      this.q[i] = ka > 1e-6 ? Math.min(STEEPNESS / (ka * N), 1.0) : 0;
    }
  }

  update(dt) {
    this.time += dt;
    const a = 1 - Math.exp(-dt / 3.0);
    this.sigHeight += (this.targetHeight - this.sigHeight) * a;
    const b = 1 - Math.exp(-dt / 6.0);
    this.mainLambda += (this.targetLambda - this.mainLambda) * b;
    for (let i = 0; i < N; i++) this.phase[i] += this.omega[i] * dt;
    this._rebuild();
  }

  // Смещение Герстнера в точке параметризации p.
  _disp(px, pz, out) {
    let dx = 0, dz = 0, y = 0;
    for (let i = 0; i < N; i++) {
      const th = this.k[i] * (this.dirX[i] * px + this.dirZ[i] * pz) - this.phase[i];
      const c = Math.cos(th), s = Math.sin(th);
      dx += this.q[i] * this.amp[i] * this.dirX[i] * c;
      dz += this.q[i] * this.amp[i] * this.dirZ[i] * c;
      y += this.amp[i] * s;
    }
    out.dx = dx; out.dz = dz; out.y = y;
    return out;
  }

  // Высота поверхности в мировой точке (x, z) с обратной итерацией смещения.
  heightAt(x, z) {
    const o = { dx: 0, dz: 0, y: 0 };
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      this._disp(px, pz, o);
      px = x - o.dx; pz = z - o.dz;
    }
    this._disp(px, pz, o);
    return o.y;
  }

  // Высота и уклоны поверхности.
  sample(x, z) {
    const e = 0.6;
    const h = this.heightAt(x, z);
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return { h, sx: hx / (2 * e), sz: hz / (2 * e) };
  }

  maxAmplitude() {
    let a = 0;
    for (let i = 0; i < N; i++) a += this.amp[i];
    return a;
  }
}
