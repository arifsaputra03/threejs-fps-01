// The arsenal: three guns and two grenades, each with its own numbers and view
// model. A headshot multiplies damage by 4; damage falls off past 25 m; spread
// grows with movement, so stopping to aim pays. Prices are the buy menu's.
//
// The numbers live in the WEAPONS / GRENADES tables at the top; the helpers
// below (falloff, spread, recoil) are the only places those numbers are read,
// so tuning a gun means editing one row, not hunting through the code.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P-9 Sidearm', key: '1', price: 0, auto: false,
    damage: 26, headMult: 4, falloffStart: 18, falloffMin: 0.6,
    fireGap: 0.16, reloadTime: 1.4, magSize: 12, reserve: 48,
    spreadStill: 0.003, spreadMove: 0.016, recoil: 0.006, range: 60,
  },
  smg: {
    id: 'smg', name: 'Wasp-9 SMG', key: '2', price: 900, auto: true,
    damage: 22, headMult: 4, falloffStart: 14, falloffMin: 0.45,
    fireGap: 0.085, reloadTime: 1.7, magSize: 24, reserve: 96,
    spreadStill: 0.006, spreadMove: 0.03, recoil: 0.008, range: 50,
  },
  rifle: {
    id: 'rifle', name: 'Longbow AR', key: '3', price: 2700, auto: true,
    damage: 34, headMult: 4, falloffStart: 25, falloffMin: 0.7,
    fireGap: 0.11, reloadTime: 2.1, magSize: 25, reserve: 75,
    spreadStill: 0.0018, spreadMove: 0.026, recoil: 0.011, range: 90,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Sparker frag', key: 'G', price: 300, radius: 6, damage: 90 },
  smoke: { id: 'smoke', name: 'Veil smoke', key: 'F', price: 200, radius: 4.5, lifetime: 14 },
};

// ---- Ballistics helpers: falloff, spread and the headshot multiplier. ----

// Damage falls off linearly past falloffStart, bottoming out at falloffMin
// (a 60 m slide from full damage to the floor).
function falloffFactor(def, distance) {
  if (distance <= def.falloffStart) return 1;
  return Math.max(def.falloffMin, 1 - (distance - def.falloffStart) / 60);
}

function damageFor(def, distance, part) {
  return def.damage * falloffFactor(def, distance) * (part === 'head' ? def.headMult : 1);
}

// Spread interpolates between the still and moving values with ground speed;
// full movement spread is reached at 5.2 m/s.
function spreadFor(def, speed) {
  return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
}

// ---- View models: a long barrel for the rifle, a short one for the SMG, a
// compact slide for the pistol. One group per weapon, swapped on switch. ----
const VIEW_MODEL_DIMS = {
  pistol: { receiver: [0.07, 0.09, 0.24], barrel: [0.04, 0.04, 0.14], stock: [0.06, 0.07, 0.1], y: -0.22, z: -0.62 },
  smg: { receiver: [0.08, 0.09, 0.34], barrel: [0.04, 0.04, 0.22], stock: [0.07, 0.07, 0.14], y: -0.22, z: -0.64 },
  rifle: { receiver: [0.09, 0.1, 0.44], barrel: [0.045, 0.045, 0.42], stock: [0.075, 0.08, 0.22], y: -0.22, z: -0.66 },
};

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6a5a48'), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.2 });
  const model = new THREE.Group();
  const dims = VIEW_MODEL_DIMS[def.id];
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(...dims.receiver), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...dims.barrel), grip);
  barrel.position.set(0, 0.025, -dims.receiver[2] / 2 - dims.barrel[2] / 2 + 0.04);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(...dims.stock), grip);
  stock.position.set(0, -0.02, dims.receiver[2] / 2 + dims.stock[2] / 2 - 0.04);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.07, -0.05);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, dims.y, dims.z);
  model.scale.setScalar(0.85);
  return model;
}

export function createWeaponSystem(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  // Per-weapon ammo lives here; buying refills the reserve.
  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.magSize, reserve: def.reserve };

  let currentId = 'pistol';
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  models.pistol.visible = true;

  function def() {
    return WEAPONS[currentId];
  }

  // Recoil kick decays back to zero; the view model dips and the muzzle
  // flash spins while it is lit, and a reload tilts the gun down.
  function updateViewModel(dt) {
    const model = models[currentId];
    model.position.z = -0.64 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) finishReload();
    }
  }

  function finishReload() {
    const need = def().magSize - ammo[currentId].mag;
    const take = Math.min(need, ammo[currentId].reserve);
    ammo[currentId].mag += take;
    ammo[currentId].reserve -= take;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    updateViewModel(dt);
  }

  return {
    state,
    def,
    ammo,
    currentId() {
      return currentId;
    },
    step,
    ready() {
      return ammo[currentId].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (ammo[currentId].mag <= 0) return false;
      ammo[currentId].mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || ammo[currentId].mag === d.magSize || ammo[currentId].reserve === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    spread(speed) {
      return spreadFor(def(), speed);
    },
    damageAt(distance, part) {
      return damageFor(def(), distance, part);
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === currentId) return false;
      models[currentId].visible = false;
      currentId = id;
      models[currentId].visible = true;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    refillAll() {
      for (const d of Object.values(WEAPONS)) {
        ammo[d.id].mag = d.magSize;
        ammo[d.id].reserve = d.reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    buyReserve(id) {
      ammo[id].reserve = WEAPONS[id].reserve;
      if (ammo[id].mag === 0) ammo[id].mag = WEAPONS[id].magSize;
    },
  };
}
