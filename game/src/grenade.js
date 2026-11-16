// Thrown grenades: a frag that bounces, beeps and bursts, and a smoke that blooms
// into an opaque ball bots cannot see through. One small pool of live grenades;
// nothing is allocated per frame.
import * as THREE from 'three';
import { GRENADES } from './weapons.js';
import { PALETTE } from './palette.js';

const GRAVITY = 14;
const BOUNCE = 0.45;

export function createGrenades(scene, colliders) {
  const live = [];
  const smokeBalls = [];
  const smokeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.92, roughness: 1,
  });
  const fragMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.4 });
  const smokeShellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7 });
  const fragGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const smokeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const ballGeo = new THREE.SphereGeometry(1, 18, 14);
  const tmp = new THREE.Vector3();

  function throwGrenade(kind, origin, direction, speed) {
    const mesh = new THREE.Mesh(kind === 'frag' ? fragGeo : smokeGeo, kind === 'frag' ? fragMat : smokeShellMat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    live.push({
      kind, mesh,
      vel: direction.clone().multiplyScalar(speed),
      fuse: kind === 'frag' ? 1.6 : 1.1,
      armed: true,
    });
    return true;
  }

  // A burst of light and a ring, then gone. The game applies the damage.
  function explode(g, onDamage) {
    const def = GRENADES[g.kind];
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 14);
    light.position.copy(g.mesh.position);
    scene.add(light);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(def.radius, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }),
    );
    ring.position.copy(g.mesh.position);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    let life = 0.35;
    const tick = (dt) => {
      life -= dt;
      ring.scale.multiplyScalar(1 + dt * 6);
      ring.material.opacity = Math.max(0, life / 0.35);
      light.intensity = Math.max(0, life / 0.35) * 60;
      if (life <= 0) {
        scene.remove(light);
        scene.remove(ring);
        ring.material.dispose();
        return false;
      }
      return true;
    };
    onDamage(g.mesh.position, def.radius, def.damage);
    return tick;
  }

  const effects = [];

  function step(dt, onDamage) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.vel.y -= GRAVITY * dt;
      tmp.copy(g.mesh.position).addScaledVector(g.vel, dt);
      // Floor and wall bounce, approximated with the collider boxes.
      const p = tmp;
      let bounced = false;
      if (p.y < 0.09) {
        p.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * BOUNCE;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
        bounced = true;
      }
      for (const c of colliders) {
        if (p.x > c.min.x - 0.09 && p.x < c.max.x + 0.09 && p.y > c.min.y - 0.09 && p.y < c.max.y + 0.09 && p.z > c.min.z - 0.09 && p.z < c.max.z + 0.09) {
          // Push out along the smallest penetration and kill that velocity component.
          const dxMin = p.x - (c.min.x - 0.09);
          const dxMax = (c.max.x + 0.09) - p.x;
          const dzMin = p.z - (c.min.z - 0.09);
          const dzMax = (c.max.z + 0.09) - p.z;
          const m = Math.min(dxMin, dxMax, dzMin, dzMax);
          if (m === dxMin) { p.x = c.min.x - 0.09; g.vel.x = -Math.abs(g.vel.x) * BOUNCE; }
          else if (m === dxMax) { p.x = c.max.x + 0.09; g.vel.x = Math.abs(g.vel.x) * BOUNCE; }
          else if (m === dzMin) { p.z = c.min.z - 0.09; g.vel.z = -Math.abs(g.vel.z) * BOUNCE; }
          else { p.z = c.max.z + 0.09; g.vel.z = Math.abs(g.vel.z) * BOUNCE; }
          bounced = true;
        }
      }
      if (bounced && g.vel.lengthSq() < 0.5) g.vel.set(0, 0, 0);
      g.mesh.position.copy(p);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        scene.remove(g.mesh);
        live.splice(i, 1);
        if (g.kind === 'frag') {
          effects.push(explode(g, onDamage));
        } else {
          const ball = new THREE.Mesh(ballGeo, smokeMat.clone());
          ball.position.copy(g.mesh.position).setY(Math.max(1.2, g.mesh.position.y));
          ball.scale.setScalar(GRENADES.smoke.radius);
          scene.add(ball);
          smokeBalls.push({ mesh: ball, left: GRENADES.smoke.lifetime });
        }
      }
    }
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      if (!effects[i](dt)) effects.splice(i, 1);
    }
    for (let i = smokeBalls.length - 1; i >= 0; i -= 1) {
      const s = smokeBalls[i];
      s.left -= dt;
      s.mesh.material.opacity = Math.min(0.92, s.left / 2);
      if (s.left <= 0) {
        scene.remove(s.mesh);
        s.mesh.material.dispose();
        smokeBalls.splice(i, 1);
      }
    }
  }

  // True when the segment between a and b crosses a smoke ball.
  function blockedBySmoke(a, b) {
    for (const s of smokeBalls) {
      const c = s.mesh.position;
      const r = GRENADES.smoke.radius;
      // Closest point on segment ab to the ball centre.
      tmp.copy(b).sub(a);
      const lenSq = tmp.lengthSq() || 1;
      let t = ((c.x - a.x) * tmp.x + (c.y - a.y) * tmp.y + (c.z - a.z) * tmp.z) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + tmp.x * t - c.x;
      const dy = a.y + tmp.y * t - c.y;
      const dz = a.z + tmp.z * t - c.z;
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    return false;
  }

  function reset() {
    for (const g of live) scene.remove(g.mesh);
    live.length = 0;
    for (const s of smokeBalls) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
    }
    smokeBalls.length = 0;
    effects.length = 0;
  }

  return { throwGrenade, step, blockedBySmoke, reset, liveCount: () => live.length };
}
