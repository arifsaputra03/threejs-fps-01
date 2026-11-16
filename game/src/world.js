// Foundry Yard: an original dusk map for EMBERLINE. Two bomb sites (A: the warehouse
// west, B: the foundry east), a mid lane, A-long and B-long flanks, and connectors.
// Aegis (the player team) attacks from the south; Ember defends from the north.
// Every box is a collider for movement and a surface a bullet stops on.
//
// The map is built in layers, in the order they are listed in createWorld:
// floor -> outer walls -> site A -> site B -> mid -> containers -> flank cover
// -> light. Each layer is one small builder so the coordinates of a layer can
// be read without the rest of the map in the way.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav waypoints: [x, z, name]. Edges are listed in EDGES as index pairs.
const WAYPOINTS = [
  [0, 13, 'aegis-spawn'],
  [0, 8, 'mid-south'],
  [0, 3, 'mid'],
  [0, -6, 'mid-north'],
  [-15, 8, 'a-long-south'],
  [-15, 0, 'a-long'],
  [-15, -8, 'site-a'],
  [-10.5, -8, 'a-door'],
  [15, 8, 'b-long-south'],
  [15, 0, 'b-long'],
  [15, -8, 'site-b'],
  [10.5, -8, 'b-door'],
  [-8, 0, 'west-connector'],
  [8, 0, 'east-connector'],
  [0, -13, 'ember-spawn'],
  [-8, -8, 'a-approach'],
  [8, -8, 'b-approach'],
  [-15, -4, 'a-long-north'],
  [15, -4, 'b-long-north'],
  [-7, 7, 'mid-west'],
  [7, 7, 'mid-east'],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 14], [3, 15], [3, 16], [15, 7], [16, 11],
  [7, 6], [11, 10], [1, 19], [1, 20], [19, 4], [20, 8], [4, 5], [5, 17],
  [17, 6], [8, 9], [9, 18], [18, 10], [2, 12], [2, 13], [12, 5], [13, 9],
  [12, 19], [13, 20], [15, 17], [16, 18], [14, 15], [14, 16], [5, 12], [9, 13],
  [19, 20],
];

// The yard's footprint: 40 m wide (x) by 32 m deep (z), walls 5 m high.
const YARD_WIDTH = 40.4;
const YARD_DEPTH = 32.4;
const WALL_HEIGHT = 5;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = buildPaletteMaterials();
  const groundMat = buildGroundMaterial();
  const colliders = [];
  const shootables = [];

  // ---- Primitive builders: a mesh, plus its collider and bullet surface. ----
  function addBox(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] ?? groundMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function addCylinder(radius, height, x, y, z, material, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Approximate the cylinder with its footprint box for collision and bullets.
    const half = radius * 0.95;
    colliders.push(new THREE.Box3(new THREE.Vector3(x - half, y - height / 2, z - half), new THREE.Vector3(x + half, y + height / 2, z + half)));
    shootables.push(mesh);
    return mesh;
  }

  function addDecal(letter, color, x, z, size = 5) {
    const tex = makeLetterTexture(letter, color);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
    return mesh;
  }

  // ---- Map layers, built in order. ----
  function buildFloor() {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(YARD_WIDTH, 0.4, YARD_DEPTH), groundMat);
    floor.position.set(0, -0.2, 0);
    floor.receiveShadow = true;
    group.add(floor);
    colliders.push(new THREE.Box3().setFromObject(floor));
  }

  function buildOuterWalls() {
    addBox(0.6, WALL_HEIGHT, YARD_DEPTH, -20.2, 2.5, 0, 'surface');
    addBox(0.6, WALL_HEIGHT, YARD_DEPTH, 20.2, 2.5, 0, 'surface');
    addBox(YARD_WIDTH, WALL_HEIGHT, 0.6, 0, 2.5, -16.2, 'surface');
    addBox(YARD_WIDTH, WALL_HEIGHT, 0.6, 0, 2.5, 16.2, 'surface');
  }

  function buildSiteA() {
    // The warehouse (west). High walls, open to the east through a door.
    addBox(0.6, 3.6, 7.5, -19.2, 1.8, -8, 'surface'); // back wall (inner face)
    addBox(7.5, 3.6, 0.6, -15.6, 1.8, -11.6, 'surface'); // north wall
    addBox(7.5, 3.6, 0.6, -15.6, 1.8, -4.4, 'surface'); // south wall
    addBox(2.2, 1.1, 1.2, -17.5, 0.55, -9.5, 'hairline'); // crates inside A
    addBox(1.2, 1.1, 2.2, -13.2, 0.55, -10.2, 'hairline');
    addBox(1.2, 2.2, 1.2, -18.2, 1.1, -5.8, 'hairline'); // tall stack, a sightline breaker
    addDecal('A', PALETTE.accent, -15, -8, 5.5);
  }

  function buildSiteB() {
    // The foundry (east). Furnace block, pipes, a low platform.
    addBox(3.4, 2.6, 3.0, 16.5, 1.3, -11.5, 'hairline'); // furnace
    addBox(1.0, 4.2, 1.0, 16.5, 2.1, -13.8, 'ember'); // chimney, glowing at dusk
    addCylinder(0.55, 3.4, 18.6, 1.7, -6.0, 'surface'); // pipe column
    addCylinder(0.55, 3.4, 18.6, 1.7, -9.5, 'surface');
    addBox(4.0, 0.5, 3.0, 12.5, 0.25, -6.0, 'surface'); // low platform (jumpable)
    addBox(1.2, 1.1, 1.2, 13.5, 0.55, -10.5, 'hairline');
    addBox(2.2, 1.1, 1.2, 17.8, 0.55, -5.2, 'hairline');
    addDecal('B', PALETTE.ember, 15, -8, 5.5);
  }

  function buildMid() {
    // A central pillar and crate cover, the fight's crossroads.
    addBox(2.0, 4.0, 2.0, 0, 2.0, -1, 'hairline');
    addBox(1.2, 1.1, 1.2, -3.2, 0.55, 2.5, 'hairline');
    addBox(1.2, 1.1, 1.2, 3.2, 0.55, 3.2, 'hairline');
    addBox(1.2, 2.2, 1.2, -4.2, 1.1, -5.0, 'hairline');
    addBox(1.2, 1.1, 1.2, 4.2, 0.55, -5.6, 'hairline');
  }

  function buildContainers() {
    // Two long steel boxes split the north lanes.
    addBox(6.0, 2.6, 2.4, -6.0, 1.3, -10.5, 'aegis');
    addBox(6.0, 2.6, 2.4, 6.0, 1.3, -10.5, 'ember');
  }

  function buildFlankCover() {
    // Crates and barrels along A-long and B-long.
    addBox(1.2, 1.1, 1.2, -17.5, 0.55, 2.0, 'hairline');
    addBox(1.2, 1.1, 1.2, -13.0, 0.55, 4.5, 'hairline');
    addBox(1.2, 2.2, 1.2, -16.0, 1.1, -2.0, 'hairline');
    addCylinder(0.45, 1.0, 17.5, 0.5, 2.0, 'muted');
    addCylinder(0.45, 1.0, 13.0, 0.5, 4.5, 'muted');
    addCylinder(0.45, 1.0, 16.0, 0.5, -2.0, 'muted');
    // Spawn cover.
    addBox(2.4, 0.9, 1.2, -3.0, 0.45, 11.5, 'hairline');
    addBox(2.4, 0.9, 1.2, 3.0, 0.45, 11.5, 'hairline');
    addBox(2.4, 0.9, 1.2, -3.0, 0.45, -11.5, 'hairline');
    addBox(2.4, 0.9, 1.2, 3.0, 0.45, -11.5, 'hairline');
  }

  function buildLighting() {
    // The map is meant to read as dusk, not night: the hemisphere does most of the work.
    const sky = new THREE.HemisphereLight(new THREE.Color('#9a7a58'), new THREE.Color(PALETTE.canvas), 1.25);
    scene.add(sky);
    const sun = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 2.6);
    sun.position.set(-18, 10, 6);
    sun.target.position.set(4, 0, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(new THREE.Color('#5a6a8a'), 0.9);
    fill.position.set(10, 12, 12);
    scene.add(fill);
    const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 20, 12);
    lampA.position.set(-15, 3.4, -8);
    scene.add(lampA);
    const lampB = new THREE.PointLight(new THREE.Color(PALETTE.ember), 22, 12);
    lampB.position.set(15, 3.2, -8);
    scene.add(lampB);
  }

  buildFloor();
  buildOuterWalls();
  buildSiteA();
  buildSiteB();
  buildMid();
  buildContainers();
  buildFlankCover();
  buildLighting();

  // ---- Nav graph (shared by bots of both teams). ----
  const navGraph = buildNavGraph();

  return {
    colliders,
    shootables,
    group,
    waypoints: navGraph.waypoints,
    adjacency: navGraph.adjacency,
    sites: {
      A: { center: new THREE.Vector3(-15, 0, -8), radius: 4.2 },
      B: { center: new THREE.Vector3(15, 0, -8), radius: 4.2 },
    },
    spawns: {
      aegis: [new THREE.Vector3(-4, 0, 13), new THREE.Vector3(-2, 0, 14), new THREE.Vector3(0, 0, 13), new THREE.Vector3(2, 0, 14), new THREE.Vector3(4, 0, 13)],
      ember: [new THREE.Vector3(-4, 0, -13), new THREE.Vector3(-2, 0, -14), new THREE.Vector3(0, 0, -13), new THREE.Vector3(2, 0, -14), new THREE.Vector3(4, 0, -13)],
    },
  };
}

function buildPaletteMaterials() {
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  return materials;
}

function buildGroundMaterial() {
  // Warm concrete with a subtle tile grid, generated once on a canvas — no assets.
  const groundTex = makeGroundTexture();
  groundTex.wrapS = THREE.RepeatWrapping;
  groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(10, 8);
  return new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0.02 });
}

function buildNavGraph() {
  const waypoints = WAYPOINTS.map(([x, z, name], id) => ({ id, pos: new THREE.Vector3(x, 0, z), name }));
  const adjacency = waypoints.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return { waypoints, adjacency };
}

// One collision implementation for players and bots: an axis-separated box mover.
// state: { pos, vel, height, radius, onGround }. Mutates pos/vel, returns onGround.
export function moveBox(state, dt, colliders) {
  const probe = new THREE.Box3();
  const R = state.radius;
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - R, y + lift, z - R);
    probe.max.set(x + R, y + height - lift, z + R);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }
  const nextX = state.pos.x + state.vel.x * dt;
  if (!overlaps(nextX, state.pos.y, state.pos.z, state.height, 0.04)) state.pos.x = nextX;
  else state.vel.x = 0;
  const nextZ = state.pos.z + state.vel.z * dt;
  if (!overlaps(state.pos.x, state.pos.y, nextZ, state.height, 0.04)) state.pos.z = nextZ;
  else state.vel.z = 0;
  state.pos.y += state.vel.y * dt;
  state.onGround = false;
  const hit = overlaps(state.pos.x, state.pos.y, state.pos.z, state.height, 0);
  if (hit && state.vel.y <= 0) {
    state.pos.y = hit.max.y;
    state.vel.y = 0;
    state.onGround = true;
  } else if (hit) {
    state.pos.y = hit.min.y - state.height;
    state.vel.y = 0;
  }
  if (state.pos.y < 0) {
    state.pos.y = 0;
    state.vel.y = 0;
    state.onGround = true;
  }
  return state.onGround;
}

// Breadth-first shortest path over the nav graph; returns waypoint ids from start to goal.
export function findPath(adjacency, start, goal) {
  if (start === goal) return [start];
  const prev = new Array(adjacency.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency[current]) {
      if (prev[next] !== -1) continue;
      prev[next] = current;
      if (next === goal) {
        const path = [goal];
        let node = goal;
        while (node !== start) {
          node = prev[node];
          path.push(node);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [start];
}

function makeGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#33291f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  // Speckle, deterministic so every run paints the same floor.
  let seed = 1234;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256), 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLetterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 134);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
