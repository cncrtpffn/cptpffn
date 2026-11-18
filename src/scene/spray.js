import * as THREE from 'three';

// Брызги от носа: капли и пыль из скул при ударе носом о волну, мелкие капли на большой скорости.
// Частицы живут в общей системе (particles.js).
export function createBowSpray(particles) {
  let prevImm = null, cooldown = 0, trickle = 0;
  const bow = new THREE.Vector3(), cheek = new THREE.Vector3();
  const stats = { slams: 0, lastRate: 0 };

  function cheekAt(boatMesh, side) {
    cheek.set(side * (0.3 + Math.random() * 0.15), 0.05, -2.2 - Math.random() * 0.4);
    return boatMesh.group.localToWorld(cheek);
  }

  function emitDrop(boat, boatMesh, side, k) {
    const p = cheekAt(boatMesh, side);
    const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi);
    const sx = Math.cos(boat.psi), sz = Math.sin(boat.psi);
    const out = side * (1.2 + Math.random() * 2.2) * k;
    const fwd = boat.u * 0.8 + (Math.random() - 0.3) * 1.2;
    particles.drop.emit(p.x, p.y, p.z,
      sx * out + fx * fwd, (2.2 + Math.random() * 3.2) * k, sz * out + fz * fwd,
      0.9 + Math.random() * 0.8, 0.05 + Math.random() * 0.08);
  }

  // клуб пыли: вылетает вбок и вверх, дальше его несёт ветер
  function emitMist(boat, boatMesh, side, k) {
    const p = cheekAt(boatMesh, side);
    const sx = Math.cos(boat.psi), sz = Math.sin(boat.psi);
    const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi);
    const out = side * (0.8 + Math.random() * 1.5) * k;
    const fwd = boat.u * 0.6;
    particles.mist.emit(p.x, p.y + 0.2, p.z,
      sx * out + fx * fwd, (1.2 + Math.random() * 1.8) * k, sz * out + fz * fwd,
      1.2 + Math.random() * 1.2, 0.25 + Math.random() * 0.25, 0.6 + Math.random() * 0.6);
  }

  function update(dt, boat, waves, boatMesh) {
    if (dt <= 0) return;
    cooldown -= dt;
    const amount = particles.amount('bow');
    // удар носом: вода у форштевня быстро поднимается относительно корпуса
    boatMesh.bowWorld(bow);
    const imm = waves.heightAt(bow.x, bow.z) - bow.y;
    if (prevImm !== null && !boat.capsized) {
      const rate = (imm - prevImm) / dt;
      stats.lastRate = rate;
      if (rate > 0.9 && imm > -0.3 && boat.u > 1 && cooldown <= 0) {
        const k = THREE.MathUtils.clamp(rate * boat.u / 5, 0.2, 1);
        const n = Math.round((20 + 100 * k) * amount);
        for (let j = 0; j < n; j++) emitDrop(boat, boatMesh, Math.random() < 0.5 ? -1 : 1, 0.6 + 0.7 * k);
        const nm = Math.round((6 + 9 * k) * amount);
        for (let j = 0; j < nm; j++) emitMist(boat, boatMesh, Math.random() < 0.5 ? -1 : 1, 0.6 + 0.6 * k);
        cooldown = 0.3;
        stats.slams++;
      }
    }
    prevImm = imm;
    // мелкая пыль с подветренной скулы на ходу
    if (boat.u > 3.5 && !boat.capsized) {
      trickle += (boat.u - 3.5) * 25 * dt * amount;
      const lee = Math.sign(boat.phi) || 1;
      for (; trickle >= 1; trickle--) emitDrop(boat, boatMesh, Math.random() < 0.75 ? lee : -lee, 0.45);
    }
  }

  return { update, stats };
}
