// The player body: acceleration, friction, gravity, crouch and jump, moved by the
// shared axis-separated box mover in world.js so bots collide exactly the same way.
import * as THREE from 'three';
import { moveBox } from './world.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const body = {
    position: spawn.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    radius: RADIUS,
    health: 100,
    armor: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();
  // The shared box mover works on { pos, vel, height, radius, onGround }; the
  // body keeps its own names, so this adapter shares the position/velocity
  // vectors by reference and syncs height and onGround around each call.
  const mover = { pos: body.position, vel: body.velocity, height: STAND_HEIGHT, radius: RADIUS, onGround: true };

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching) {
      // Stand up only when the space above is free.
      const probe = new THREE.Box3(
        new THREE.Vector3(body.position.x - RADIUS, body.position.y, body.position.z - RADIUS),
        new THREE.Vector3(body.position.x + RADIUS, body.position.y + STAND_HEIGHT, body.position.z + RADIUS),
      );
      if (!colliders.some((c) => probe.intersectsBox(c))) {
        body.crouching = false;
        body.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = body.crouching ? CROUCH_SPEED
      : (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? WALK_SPEED * 0.5 : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;
    body.velocity.y = Math.max(-30, body.velocity.y);
    mover.height = body.height;
    body.onGround = moveBox(mover, dt, colliders);
  }

  return {
    state: body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    reset(spawnPoint) {
      body.position.copy(spawnPoint);
      body.velocity.set(0, 0, 0);
      body.yaw = 0;
      body.pitch = 0;
      body.health = 100;
      body.armor = 0;
      body.alive = true;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
      body.crouching = false;
    },
  };
}
