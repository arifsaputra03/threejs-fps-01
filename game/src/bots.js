// Bot fighters: one module owns their bodies, their routes and their decisions.
// Defenders (Ember) hold positions around the sites and react to what they see and
// hear; attackers (Aegis) follow routes to the objective site, and one of them
// carries the charge when the player is down. A bot is a fighter object, the same
// shape the player has, so the same combat and damage code serves both.
//
// Each frame a living bot runs the same decision pipeline, in this order:
//   1. sense — throttle the line-of-sight scan, pick the nearest visible enemy
//   2. objective duty — a planted charge (defuse) or a carried charge (plant)
//      overrides whatever route the bot was on
//   3. move — follow the route, hold a position, or strafe while engaging
//   4. channel — planting and defusing are timed channels, broken by damage
//   5. shoot — bursts after the reaction delay, with distance-based aim error
//   6. integrate — move the body through the shared box collider
import * as THREE from 'three';
import { findPath } from './world.js';
import { PALETTE } from './palette.js';

const BOT_NAMES = {
  aegis: ['Vex', 'Mira', 'Hale', 'Juno'],
  ember: ['Rook', 'Sable', 'Onyx', 'Dagger', 'Wraith'],
};
const HOLD_SPOTS = {
  // Defender hold waypoints by index into world.waypoints.
  ember: [6, 7, 10, 11, 3], // site A, A door, site B, B door, mid north
};
// Reaction time bounds and the line-of-sight scan interval — the bot's
// human-ness lives in these three numbers.
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.65;
const LOS_INTERVAL = 0.12;
// How far a bot can spot an enemy, and how close before field of view stops
// mattering (a bot always notices someone right next to it).
const SPOT_RANGE = 55;
const FOV_CLOSE_RANGE = 6;
// Plant/defuse channel durations, in seconds.
const PLANT_SECONDS = 4;
const DEFUSE_SECONDS = 5;
// Burst size and the pause between bursts, in seconds.
const BURST_MIN = 3;
const BURST_SPREAD = 3;
const BURST_PAUSE = 0.12;
// The charge-carrier and the defuse-rotating defenders head for waypoint 6
// (site A) or 10 (site B); the matching map entries live in world.js.
const SITE_WAYPOINTS = { A: 6, B: 10 };

const bodyGeo = new THREE.BoxGeometry(0.5, 0.72, 0.3);
const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.2);
const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
const visorGeo = new THREE.BoxGeometry(0.2, 0.06, 0.05);

export function createBots(scene, world, combat, random) {
  const fighters = [];
  const hitMeshes = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  // ---- Bodies: a low-poly soldier with a team-coloured vest and visor. ----
  function buildBotBody(fighter) {
    const teamColor = fighter.team === 'aegis' ? PALETTE.aegis : PALETTE.ember;
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85 });
    const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.5 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
    const legL = new THREE.Mesh(legGeo, cloth);
    legL.position.set(-0.13, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, cloth);
    legR.position.set(0.13, 0.31, 0);
    const torso = new THREE.Mesh(bodyGeo, cloth);
    torso.position.y = 1.0;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.34), teamMat);
    vest.position.y = 1.05;
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.53;
    const visor = new THREE.Mesh(visorGeo, teamMat);
    visor.position.set(0, 1.53, 0.15);
    const gun = new THREE.Mesh(gunGeo, cloth);
    gun.position.set(0.22, 1.05, -0.25);
    group.add(legL, legR, torso, vest, head, visor, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    torso.userData.fighter = fighter;
    torso.userData.part = 'torso';
    head.userData.fighter = fighter;
    head.userData.part = 'head';
    fighter.torsoMesh = torso;
    fighter.headMesh = head;
    fighter.group = group;
    fighter.visor = visor;
    scene.add(group);
    hitMeshes.push(torso, head);
    return group;
  }

  function createFighter(team, name, spawn, weaponId, speed) {
    const fighter = {
      id: `${team}-${name}`,
      name,
      team,
      isPlayer: false,
      pos: spawn.clone(),
      vel: new THREE.Vector3(),
      yaw: team === 'aegis' ? 0 : Math.PI, // attackers face north to the sites, defenders south to mid
      pitch: 0,
      height: 1.72,
      radius: 0.34,
      onGround: true,
      health: 100,
      armor: 0,
      alive: true,
      weaponId,
      speed,
      state: 'move',
      path: [],
      pathIndex: 0,
      holdUntil: 0,
      holdWaypoint: -1,
      target: null,
      targetVisible: false,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      losAt: 0,
      aimError: 0.02 + random() * 0.02,
      reaction: REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN),
      lastSeen: new THREE.Vector3(),
      investigate: null,
      plantProgress: 0,
      defuseProgress: 0,
      isCarrier: false,
      fall: 0,
      strafeDir: 1,
      strafeAt: 0,
    };
    buildBotBody(fighter);
    fighters.push(fighter);
    return fighter;
  }

  // ---- Navigation helpers. ----
  function nearestWaypoint(pos) {
    let best = 0;
    let bestDist = Infinity;
    for (const wp of world.waypoints) {
      const d = (wp.pos.x - pos.x) ** 2 + (wp.pos.z - pos.z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = wp.id;
      }
    }
    return best;
  }

  function assignPath(fighter, goalWaypoint) {
    const start = nearestWaypoint(fighter.pos);
    fighter.path = findPath(world.adjacency, start, goalWaypoint);
    fighter.pathIndex = 0;
    fighter.state = 'move';
  }

  function eyePos(fighter, out) {
    return out.set(fighter.pos.x, fighter.pos.y + 1.5, fighter.pos.z);
  }

  function chestPos(fighter, out) {
    return out.set(fighter.pos.x, fighter.pos.y + 1.15, fighter.pos.z);
  }

  function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ---- Round setup: defenders take hold spots, attackers take routes. ----
  function spawnRound(objectiveSite, round) {
    clear();
    const rifleRound = round >= 2;
    // Defenders: one hold spot each, spread across both sites and mid.
    const emberSpawns = world.spawns.ember;
    BOT_NAMES.ember.forEach((name, i) => {
      const weaponId = rifleRound && i % 3 !== 2 ? 'rifle' : 'smg';
      const bot = createFighter('ember', name, emberSpawns[i % emberSpawns.length], weaponId, 3.4 + random() * 0.5);
      bot.holdWaypoint = HOLD_SPOTS.ember[i % HOLD_SPOTS.ember.length];
      bot.state = 'move';
      assignPath(bot, bot.holdWaypoint);
    });
    // Attackers: routes to the objective site.
    const siteWp = objectiveSite === 'A' ? 6 : 10;
    const longWp = objectiveSite === 'A' ? 4 : 8;
    const routes = [siteWp, longWp, 2, 12];
    const aegisSpawns = world.spawns.aegis;
    BOT_NAMES.aegis.forEach((name, i) => {
      const weaponId = rifleRound && i % 3 !== 1 ? 'rifle' : 'smg';
      const bot = createFighter('aegis', name, aegisSpawns[i % aegisSpawns.length], weaponId, 3.6 + random() * 0.5);
      bot.objectiveSite = objectiveSite;
      assignPath(bot, routes[i % routes.length]);
      if (i === 0) bot.isCarrier = true; // first friendly carries the charge if the player falls
    });
    return fighters;
  }

  // ---- Hearing: a shot turns nearby enemies toward the sound; a holding
  // defender steps out to investigate after a beat. ----
  function hearShot(pos, shooterTeam) {
    for (const bot of fighters) {
      if (!bot.alive || bot.team === shooterTeam) continue;
      const d2 = (bot.pos.x - pos.x) ** 2 + (bot.pos.z - pos.z) ** 2;
      if (d2 < 25 * 25 && bot.state !== 'engage') {
        tmpA.set(pos.x - bot.pos.x, 0, pos.z - bot.pos.z);
        bot.yaw = Math.atan2(-tmpA.x, -tmpA.z);
        if (bot.team === 'ember' && bot.state === 'hold') {
          bot.investigate = nearestWaypoint(pos);
        }
      }
    }
  }

  function clear() {
    for (const bot of fighters) {
      scene.remove(bot.group);
      const torsoIndex = hitMeshes.indexOf(bot.torsoMesh);
      if (torsoIndex !== -1) hitMeshes.splice(torsoIndex, 1);
      const headIndex = hitMeshes.indexOf(bot.headMesh);
      if (headIndex !== -1) hitMeshes.splice(headIndex, 1);
    }
    fighters.length = 0;
  }

  // ---- Step 1, senses: throttled, staggered line-of-sight scan. ----
  // Returns nothing; sets bot.target / bot.targetVisible / bot.lastSeen, and
  // starts the reaction timer the first frame a target is spotted.
  function scanForEnemies(bot, time, ctx, rnd) {
    if (time < bot.losAt) return;
    bot.losAt = time + LOS_INTERVAL * (0.7 + rnd() * 0.6);
    bot.targetVisible = false;
    bot.target = null;
    const enemies = bot.team === 'ember'
      ? [ctx.player, ...fighters.filter((f) => f.team === 'aegis' && f.alive)]
      : [ctx.player, ...fighters.filter((f) => f.team === 'ember' && f.alive)];
    // Nearest visible enemy wins.
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const isPlayerTarget = enemy === ctx.player;
      const targetPos = isPlayerTarget ? tmpB.set(enemy.pos.x, enemy.pos.y + enemy.eye * 0.7, enemy.pos.z) : chestPos(enemy, tmpB);
      eyePos(bot, tmpA);
      const dist = tmpA.distanceTo(targetPos);
      if (dist > SPOT_RANGE) continue;
      // Field of view: only what is in front of the bot, unless very close.
      tmpDir.copy(targetPos).sub(tmpA).normalize();
      const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (dist > FOV_CLOSE_RANGE && tmpDir.dot(forward) < 0.25) continue;
      if (ctx.smokeBlocked(tmpA, targetPos)) continue;
      const hit = combat.shoot(tmpA, tmpDir, 0, rnd, ctx.shootables, bot);
      if (hit && hit.target === enemy) {
        if (dist < bestDist) {
          bestDist = dist;
          bot.target = enemy;
          bot.targetVisible = true;
          bot.lastSeen.copy(targetPos);
          if (!bot.engaging) {
            bot.engaging = true;
            bot.reactAt = time + bot.reaction;
          }
        }
      }
    }
    if (!bot.targetVisible) bot.engaging = false;
  }

  // ---- Step 2, objective duties: the bomb overrides the route. ----
  function siteWaypointFor(site) {
    return SITE_WAYPOINTS[site] ?? 6;
  }

  function chooseObjectiveDuty(bot, ctx) {
    const { bomb, player } = ctx;
    if (bomb.state === 'planted' && bot.team === 'ember') {
      // Defenders rotate to the planted site and defuse.
      const siteWp = siteWaypointFor(bomb.site);
      if (bot.state !== 'defuse' && bot.state !== 'engage') {
        if (nearestWaypoint(bot.pos) !== siteWp) {
          assignPath(bot, siteWp);
        } else {
          // At the site: start the defuse channel (arriving bots land in
          // 'hold', so this must not depend on the move state).
          bot.state = 'defuse';
          bot.defuseProgress = 0;
        }
      }
    }
    if (bomb.state === 'carried' && bot.isCarrier && bot.team === 'aegis' && !player.alive) {
      const siteWp = siteWaypointFor(bomb.site);
      if (bot.state !== 'plant' && bot.state !== 'engage') {
        if (nearestWaypoint(bot.pos) !== siteWp) assignPath(bot, siteWp);
      }
    }
  }

  // ---- Step 3, movement: route following, holding, or strafing in a fight. ----
  function followRoute(bot, dt, time, ctx, rnd) {
    const goal = world.waypoints[bot.path[bot.pathIndex]];
    tmpA.set(goal.pos.x - bot.pos.x, 0, goal.pos.z - bot.pos.z);
    const dist = tmpA.length();
    if (dist < 0.6) {
      arriveAtWaypoint(bot, goal, time, ctx, rnd);
      return;
    }
    tmpA.normalize();
    const desiredYaw = Math.atan2(-tmpA.x, -tmpA.z);
    bot.yaw += shortestAngle(bot.yaw, desiredYaw) * Math.min(1, dt * 8);
    const speed = bot.targetVisible ? bot.speed * 0.45 : bot.speed;
    bot.vel.set(tmpA.x * speed, 0, tmpA.z * speed);
  }

  function arriveAtWaypoint(bot, goal, time, ctx, rnd) {
    bot.pathIndex += 1;
    if (bot.pathIndex < bot.path.length) return;
    bot.path = [];
    if (bot.team === 'ember' && bot.holdWaypoint === goal.id) {
      bot.state = 'hold';
      bot.holdUntil = time + 3 + rnd() * 4;
    } else if (bot.team === 'aegis' && bot.isCarrier && !ctx.player.alive && ctx.bomb.state === 'carried' && (goal.id === 6 || goal.id === 10)) {
      bot.state = 'plant';
      bot.plantProgress = 0;
    } else {
      bot.state = 'hold';
      bot.holdUntil = time + 1.5 + rnd() * 2;
    }
  }

  function holdPosition(bot, dt, time, ctx, rnd) {
    bot.vel.set(0, 0, 0);
    // Scan the lane in a slow sweep.
    bot.yaw += Math.sin(time * 0.5 + bot.holdWaypoint) * dt * 0.35;
    if (time < bot.holdUntil) return;
    if (bot.investigate !== null) {
      assignPath(bot, bot.investigate);
      bot.investigate = null;
    } else if (bot.team === 'ember') {
      bot.state = 'hold';
      bot.holdUntil = time + 3 + rnd() * 4;
    } else {
      // Attackers push on toward the site.
      assignPath(bot, siteWaypointFor(ctx.bomb.site));
    }
  }

  // The strafe direction flips on a timer so the movement reads as dodging
  // rather than orbiting: a new sideways choice every 0.6–1.5 seconds.
  function updateStrafeDirection(bot, time, rnd) {
    if (time <= bot.strafeAt) return;
    bot.strafeDir = rnd() > 0.5 ? 1 : -1;
    bot.strafeAt = time + 0.6 + rnd() * 0.9;
  }

  function strafeWhileEngaging(bot, dt, time, rnd) {
    // Strafe slowly while shooting; keep the target in the sights.
    updateStrafeDirection(bot, time, rnd);
    const toTarget = tmpA.copy(bot.lastSeen).sub(bot.pos);
    toTarget.y = 0;
    const dist = toTarget.length();
    const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
    bot.yaw += shortestAngle(bot.yaw, desiredYaw) * Math.min(1, dt * 10);
    const strafe = new THREE.Vector3(Math.cos(bot.yaw), 0, -Math.sin(bot.yaw)).multiplyScalar(bot.strafeDir * 1.2);
    bot.vel.copy(strafe);
    // Close the distance when the target is far away, strafe only when near.
    if (dist > 22) bot.vel.addScaledVector(toTarget.normalize(), 1.2);
  }

  // A bot fights on the move while it can see its target, even mid-route:
  // the 'engage' state and plain line of sight both count as engaging, so a
  // bot that spots an enemy while walking to a hold spot strafes at once
  // instead of finishing its route first.
  function isEngaging(bot) {
    return bot.state === 'engage' || bot.targetVisible;
  }

  function moveBot(bot, dt, time, ctx, rnd) {
    if (bot.state === 'move' && bot.path.length > 0) {
      followRoute(bot, dt, time, ctx, rnd);
    } else if (bot.state === 'hold') {
      holdPosition(bot, dt, time, ctx, rnd);
    } else if (isEngaging(bot)) {
      strafeWhileEngaging(bot, dt, time, rnd);
    }
  }

  // ---- Step 4, channels: planting and defusing are timed and stationary. ----
  function advanceChannel(bot, dt, ctx) {
    if (bot.state === 'plant') {
      bot.vel.set(0, 0, 0);
      bot.plantProgress += dt;
      if (bot.plantProgress >= PLANT_SECONDS) {
        bot.state = 'hold';
        ctx.onPlanted(bot);
      }
    }
    if (bot.state === 'defuse') {
      bot.vel.set(0, 0, 0);
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= DEFUSE_SECONDS) {
        bot.state = 'hold';
        ctx.onDefused(bot);
      }
    }
  }

  // ---- Step 5, shooting: bursts after the reaction delay, with aim error. ----
  function fireBurst(bot, time, ctx, rnd, onDamage) {
    if (!bot.targetVisible || !bot.target || time < bot.reactAt) return;
    if (bot.burstLeft <= 0 && time >= bot.nextShotAt) {
      bot.burstLeft = BURST_MIN + Math.floor(rnd() * BURST_SPREAD);
      bot.nextShotAt = time + BURST_PAUSE;
    }
    if (bot.burstLeft <= 0 || time < bot.nextShotAt) return;
    bot.burstLeft -= 1;
    bot.nextShotAt = time + (bot.weaponId === 'smg' ? 0.09 : 0.12);
    eyePos(bot, tmpA);
    const target = bot.target;
    const aimAt = target === ctx.player
      ? tmpB.set(target.pos.x, target.pos.y + target.eye * 0.75, target.pos.z)
      : chestPos(target, tmpB);
    // Aim error grows with distance and with the target's speed.
    const dist = tmpA.distanceTo(aimAt);
    const targetSpeed = target === ctx.player ? Math.hypot(target.vel.x, target.vel.z) : 3;
    const err = bot.aimError * (1 + dist / 30) * (1 + targetSpeed / 8);
    tmpDir.copy(aimAt).sub(tmpA).normalize();
    tmpDir.x += (rnd() * 2 - 1) * err;
    tmpDir.y += (rnd() * 2 - 1) * err;
    tmpDir.z += (rnd() * 2 - 1) * err;
    tmpDir.normalize();
    const hit = combat.shoot(tmpA, tmpDir, 0, rnd, ctx.shootables, bot);
    const end = hit ? hit.point : tmpB.copy(tmpA).addScaledVector(tmpDir, 60);
    ctx.onBotShot(bot, tmpA, end);
    if (hit && hit.target === target) {
      const base = bot.weaponId === 'rifle' ? 34 : bot.weaponId === 'smg' ? 22 : 26;
      const dmg = base * (hit.part === 'head' ? 4 : 1) * Math.max(0.5, 1 - dist / 90);
      onDamage(target, dmg, hit.part, bot);
    }
  }

  // ---- Step 6, integration: gravity keeps bots on the ground; they never jump. ----
  function integrateMotion(bot, dt, ctx) {
    bot.vel.y = 0;
    const mover = {
      pos: bot.pos, vel: bot.vel, height: bot.height, radius: bot.radius, onGround: bot.onGround,
    };
    mover.vel.y = bot.pos.y > 0 ? -20 : 0;
    const { moveBox } = ctx;
    moveBox(mover, dt, world.colliders);
    bot.onGround = mover.onGround;
    bot.group.position.copy(bot.pos);
    bot.group.rotation.y = bot.yaw;
  }

  function stepBot(bot, dt, ctx, rnd) {
    if (!bot.alive) {
      // Fall over and stay down until the round resets.
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.1;
      }
      return;
    }
    scanForEnemies(bot, ctx.time, ctx, rnd);
    chooseObjectiveDuty(bot, ctx);
    moveBot(bot, dt, ctx.time, ctx, rnd);
    advanceChannel(bot, dt, ctx);
    fireBurst(bot, ctx.time, ctx, rnd, ctx.onDamage);
    integrateMotion(bot, dt, ctx);
  }

  function step(dt, ctx) {
    const { time, player, bomb, onDamage, onKill, random: rnd } = ctx;
    for (const bot of fighters) {
      stepBot(bot, dt, ctx, rnd);
    }
  }

  return {
    fighters,
    hitMeshes,
    spawnRound,
    step,
    hearShot,
    clear,
    aliveCount(team) {
      return fighters.filter((f) => f.team === team && f.alive).length;
    },
    carrier() {
      return fighters.find((f) => f.isCarrier && f.alive) ?? null;
    },
  };
}
