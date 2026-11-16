// One hitscan routine for the player and the bots, so a bullet behaves the same
// whoever fires it. Reuses one raycaster and one direction vector: no allocations
// in the hot path. A fighter's hitboxes carry userData { fighter, part }.
import * as THREE from 'three';

export function createCombat(world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const direction = new THREE.Vector3();

  // origin: Vector3, dir: normalized Vector3, spread: radians of random cone.
  // shootables: the world's static meshes plus every living fighter's hitboxes.
  // skipFighter: the shooter, so a fighter never hits its own hitboxes.
  // Dead fighters are skipped too, so corpses never block a bullet.
  // Returns null on a clean miss of everything, else { point, distance, target, part }.
  function shoot(origin, dir, spread, random, shootables, skipFighter = null) {
    direction.copy(dir);
    if (spread > 0) {
      direction.x += (random() * 2 - 1) * spread;
      direction.y += (random() * 2 - 1) * spread;
      direction.z += (random() * 2 - 1) * spread;
      direction.normalize();
    }
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(shootables, false);
    for (const hit of hits) {
      const data = hit.object.userData;
      if (skipFighter && data.fighter === skipFighter) continue;
      if (data.fighter && !data.fighter.alive) continue;
      return {
        point: hit.point,
        distance: hit.distance,
        target: data.fighter ?? null,
        part: data.part ?? 'body',
      };
    }
    return null;
  }

  return { shoot };
}
