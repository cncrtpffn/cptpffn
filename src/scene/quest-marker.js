import * as THREE from 'three';

// Подсветка цели обучающего квеста: пульсирующее кольцо на воде и луч над знаком (виден издалека),
// у ворот — оба знака и стрелка направления прохода, у зоны старта миссии — круг радиуса зоны.
// update(dt, target, pos, waves): target — из runner.target (null — спрятать), pos(id) → { x, z } знака сейчас.
const COLOR = 0xffc93c;
const SLOTS = 2;

export function createQuestMarker(scene) {
  const group = new THREE.Group();
  group.name = 'quest-marker';
  scene.add(group);
  const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 8, 1, true).translate(0, 0.5, 0);
  const mat = (opacity) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const ring = new THREE.Mesh(ringGeo, mat(0.8)), beam = new THREE.Mesh(beamGeo, mat(0.35));
    ring.renderOrder = beam.renderOrder = 2;
    group.add(ring, beam);
    slots.push({ ring, beam });
  }
  // стрелка прохода ворот: плоский треугольник на воде
  const arrowShape = new THREE.Shape([new THREE.Vector2(0, -4), new THREE.Vector2(2.4, 1.5), new THREE.Vector2(0, 0.4), new THREE.Vector2(-2.4, 1.5)]);
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).rotateX(Math.PI / 2), mat(0.75));
  arrow.renderOrder = 2;
  group.add(arrow);
  // круг зоны старта миссии
  const zone = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), mat(0.6));
  zone.renderOrder = 2;
  group.add(zone);
  group.visible = false;
  let t = 0;

  const update = (dt, target, pos, waves) => {
    group.visible = !!target;
    if (!target) return;
    t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const ids = target.marks ?? [];
    slots.forEach((s, i) => {
      const p = ids[i] !== undefined ? pos(ids[i]) : null;
      s.ring.visible = s.beam.visible = !!p && !target.zone;
      if (!s.ring.visible) return;
      const h = waves.sample(p.x, p.z).h;
      s.ring.position.set(p.x, h + 0.08, p.z);
      s.ring.scale.setScalar(3 + pulse * 1.2);
      s.ring.material.opacity = 0.85 - pulse * 0.45;
      s.beam.position.set(p.x, h + 3.2, p.z);
      s.beam.scale.set(1, 30, 1);
    });
    arrow.visible = !!target.gate;
    if (arrow.visible) {
      const a = pos(target.gate[0]), b = pos(target.gate[1]);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      // направление прохода: a слева — вектор (ez, −ex)
      arrow.position.set(mx, waves.sample(mx, mz).h + 0.1, mz);
      arrow.rotation.y = Math.atan2(-(b.z - a.z), -(a.x - b.x));
      arrow.material.opacity = 0.5 + pulse * 0.35;
    }
    zone.visible = !!target.zone;
    if (zone.visible) {
      zone.position.set(target.x, waves.sample(target.x, target.z).h + 0.1, target.z);
      zone.scale.setScalar(target.zone);
      zone.material.opacity = 0.35 + pulse * 0.3;
      // зона: луч над её буем
      const s = slots[0];
      s.beam.visible = true;
      s.beam.position.set(target.x, zone.position.y + 3.2, target.z);
      s.beam.scale.set(1, 30, 1);
    }
  };
  return { group, update };
}
