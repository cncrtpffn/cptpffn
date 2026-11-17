import * as THREE from 'three';

const MAX = 400;
const GRAVITY = 9.81;

// Брызги: low-poly капли из скул при ударе носом о волну и на большой скорости.
export function createSpray() {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.5, flatShading: true, emissive: 0x5a7a8a, emissiveIntensity: 0.35 }),
    MAX,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;

  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const life = new Float32Array(MAX), maxLife = new Float32Array(MAX), size = new Float32Array(MAX);
  let alive = 0;
  let prevImm = null, cooldown = 0, trickle = 0;
  const bow = new THREE.Vector3(), cheek = new THREE.Vector3(), m = new THREE.Matrix4();
  const stats = { alive: 0, slams: 0, lastRate: 0 };

  function emit(boat, boatMesh, side, k) {
    if (alive >= MAX) return;
    const i = alive++;
    cheek.set(side * (0.3 + Math.random() * 0.15), 0.05, -2.2 - Math.random() * 0.4);
    boatMesh.group.localToWorld(cheek);
    const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi);
    const sx = Math.cos(boat.psi), sz = Math.sin(boat.psi);
    const out = side * (1.2 + Math.random() * 2.2) * k;
    const fwd = boat.u * 0.8 + (Math.random() - 0.3) * 1.2;
    px[i] = cheek.x; py[i] = cheek.y; pz[i] = cheek.z;
    vx[i] = sx * out + fx * fwd;
    vz[i] = sz * out + fz * fwd;
    vy[i] = (2.2 + Math.random() * 3.2) * k;
    maxLife[i] = life[i] = 0.9 + Math.random() * 0.8;
    size[i] = 0.05 + Math.random() * 0.08;
  }

  function update(dt, boat, waves, wind, boatMesh) {
    if (dt <= 0) return;
    cooldown -= dt;
    // удар носом: вода у форштевня быстро поднимается относительно корпуса
    boatMesh.bowWorld(bow);
    const imm = waves.heightAt(bow.x, bow.z) - bow.y;
    if (prevImm !== null && !boat.capsized) {
      const rate = (imm - prevImm) / dt;
      stats.lastRate = rate;
      if (rate > 0.9 && imm > -0.3 && boat.u > 1 && cooldown <= 0) {
        const k = THREE.MathUtils.clamp(rate * boat.u / 5, 0.2, 1);
        const n = Math.round(20 + 100 * k);
        for (let j = 0; j < n; j++) emit(boat, boatMesh, Math.random() < 0.5 ? -1 : 1, 0.6 + 0.7 * k);
        cooldown = 0.3;
        stats.slams++;
      }
    }
    prevImm = imm;
    // мелкая пыль с подветренной скулы на ходу
    if (boat.u > 3.5 && !boat.capsized) {
      trickle += (boat.u - 3.5) * 25 * dt;
      const lee = Math.sign(boat.phi) || 1;
      for (; trickle >= 1; trickle--) emit(boat, boatMesh, Math.random() < 0.75 ? lee : -lee, 0.45);
    }

    const w = wind.vector();
    const drag = Math.exp(-0.9 * dt);
    let j = 0;
    for (let i = 0; i < alive; i++) {
      life[i] -= dt;
      vy[i] -= GRAVITY * dt;
      vx[i] = w.x + (vx[i] - w.x) * drag;
      vz[i] = w.z + (vz[i] - w.z) * drag;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (life[i] <= 0 || (vy[i] < 0 && py[i] < waves.heightAt(px[i], pz[i]) - 0.05)) continue;
      if (j !== i) {
        px[j] = px[i]; py[j] = py[i]; pz[j] = pz[i];
        vx[j] = vx[i]; vy[j] = vy[i]; vz[j] = vz[i];
        life[j] = life[i]; maxLife[j] = maxLife[i]; size[j] = size[i];
      }
      const sc = size[j] * Math.sqrt(life[j] / maxLife[j]);
      m.makeScale(sc, sc, sc).setPosition(px[j], py[j], pz[j]);
      mesh.setMatrixAt(j, m);
      j++;
    }
    alive = j;
    mesh.count = alive;
    mesh.instanceMatrix.needsUpdate = true;
    stats.alive = alive;
  }

  return { mesh, update, stats };
}
