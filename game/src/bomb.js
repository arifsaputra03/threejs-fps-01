// The charge: carried by the player (or a friendly bot if the player falls),
// planted at a site with a 4 s channel, a 35 s fuse with accelerating beeps, and
// a 5 s defuse channel. One small mesh marks the planted charge on the floor.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 4;
const DEFUSE_TIME = 5;
const FUSE_TIME = 35;

export function createBomb(scene) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 }),
  );
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  scene.add(light);

  const state = {
    state: 'carried', // carried | planting | planted | exploded | defused
    site: 'A',
    fuseLeft: FUSE_TIME,
    plantProgress: 0,
    defuseProgress: 0,
    beepAt: 0,
    carrier: null, // 'player' or a bot fighter
  };

  return {
    state,
    reset(site, carrier) {
      state.state = 'carried';
      state.site = site;
      state.fuseLeft = FUSE_TIME;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.beepAt = 0;
      state.carrier = carrier;
      mesh.visible = false;
      light.intensity = 0;
    },
    plantAt(pos) {
      state.state = 'planted';
      state.fuseLeft = FUSE_TIME;
      state.beepAt = 0;
      mesh.position.set(pos.x, 0.13, pos.z);
      mesh.visible = true;
      light.position.set(pos.x, 0.6, pos.z);
    },
    step(dt, time, onBeep) {
      if (state.state === 'planted') {
        state.fuseLeft -= dt;
        light.intensity = 6 + Math.sin(time * 10) * 4;
        const interval = state.fuseLeft > 20 ? 1.0 : state.fuseLeft > 10 ? 0.6 : 0.35;
        if (time >= state.beepAt) {
          state.beepAt = time + interval;
          onBeep();
        }
        if (state.fuseLeft <= 0) {
          state.state = 'exploded';
          mesh.visible = false;
          light.intensity = 0;
          return 'exploded';
        }
      }
      return null;
    },
    plantProgressTick(dt) {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) {
        state.plantProgress = 0;
        return true;
      }
      return false;
    },
    defuseProgressTick(dt) {
      state.defuseProgress += dt;
      if (state.defuseProgress >= DEFUSE_TIME) {
        state.defuseProgress = 0;
        state.state = 'defused';
        mesh.visible = false;
        light.intensity = 0;
        return true;
      }
      return false;
    },
    cancelChannel() {
      state.plantProgress = 0;
      state.defuseProgress = 0;
    },
    plantTime: PLANT_TIME,
    defuseTime: DEFUSE_TIME,
  };
}
