# EMBERLINE — Foundry Yard

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/arifsaputra03/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/arifsaputra03/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

[Play the bounty on make.fun](https://make.fun/bounty/threejs-fps-01). Optional: earn referral rewards — [join make.fun with my referral link](https://make.fun/r/yny5gqnv).

A round-based tactical FPS in the Counter-Strike mould, built for
make.fun bounty `threejs-fps-01` — but with its own map, art, sounds and names.
No build step, no network: static files, three.js 0.187.0 vendored under
`game/vendor/three/`, every sound synthesized in the browser with WebAudio.

## The game

Five **Aegis** attackers (you + 4 bots) against five **Ember** defenders on
**Foundry Yard**, a dusk industrial map (~40×32 m): Site A is the warehouse
west, Site B the foundry east, with a mid lane, A-long and B-long flanks and
connectors between them. First to 5 rounds wins the match.

- **Rounds:** 15 s buy phase, then 100 s rounds. Win by eliminating the other
  team, by detonating the charge, or (defenders) by running the clock out
  before the plant.
- **The charge:** you carry it. Hold **E** inside a site for 4 s to plant;
  35 s fuse with accelerating beeps. Hold **E** near a planted charge for 5 s
  to defuse. If you fall, a friendly bot picks the charge up and plants it.
- **Economy:** $800 to start; kill $300, round win $3,250, round loss $1,900,
  plant/defuse $300. Buy in the buy phase (key **B**): Wasp-9 SMG $900,
  Longbow AR $2,700, Sparker frag $300, Veil smoke $200, armor $650.
- **Guns:** P-9 sidearm (free), Wasp-9 SMG, Longbow AR — each with its own
  damage, falloff, fire rate, spread and recoil. Headshots ×4. Spread grows
  while you move, so stopping to aim pays. Armor absorbs half of a hit.
- **Grenades:** frags bounce and burst; smoke blooms into a ball bots cannot
  see through.
- **Bots:** defenders hold positions around the sites and mid, sweep their
  lanes, react to what they see (reaction time, aim error, bursts) and to
  what they hear (gunfire turns them toward the sound), rotate to a planted
  site and defuse, and push the objective when the carrier falls.
- **Feel:** tracers, muzzle flash and camera shake, hit markers, a damage
  vignette, kill feed, team counts, a round timer and a buy menu — all DOM
  over the canvas. Death hands the camera to a living teammate (spectate).

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse / click | Move / aim / shoot (hold for autos) |
| Shift | Walk (half speed, steadier aim) |
| Ctrl or C | Crouch |
| Space | Jump |
| 1 / 2 / 3 | Pistol / SMG / rifle (when owned) |
| R | Reload |
| G / F | Throw frag / smoke |
| E (hold) | Plant / defuse the charge |
| B | Buy menu (buy phase; keys 1–5 buy) |
| M | Mute |

## Run it

```sh
node serve.ts            # serves game/ on http://127.0.0.1:8080
```

Play in a desktop browser. No install, no build.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the vendored `vendor/makefun-threejs.ts`.

## Screenshots

`shots.json` names four deterministic frames the game renders from its URL
(`?shot=start|play|buy|end&seed=1`): the menu, a live round, the buy menu and
the match result. The game sets `window.__emberline = { ready: true, … }`
after rendering one frame, so a screenshot driver can wait for it.

## Layout

```
game/
  index.html            the page: import map (three → vendor), HUD styles
  src/
    main.js             boot + ?shot= mode
    game.js             the match: rounds, money, plant/defuse, shooting, spectate
    world.js            Foundry Yard: map, lights, nav graph, shared box mover
    player.js           movement, crouch/jump, health
    bots.js             bot AI: routes, holds, engages, plant/defuse, hearing
    combat.js           one hitscan routine for players and bots
    weapons.js          the arsenal + view models
    grenade.js          frag + smoke physics
    bomb.js             the charge: plant, fuse, defuse
    audio.js            synthesized WebAudio effects (no assets)
    hud.js              DOM HUD: crosshair, health, money, buy menu, kill feed
    palette.js          the six-colour look plan
  vendor/three/         three.js 0.187.0 (byte-for-byte from the kit)
main.ts                 hand-in: copies game/ + screenshots/, writes dossier.json
serve.ts                local static server for development
vendor/makefun-threejs.ts  the kit's dossier library, copied unchanged
shots.json              the four screenshot frames
```

## Credits

Built for make.fun `threejs-fps-01`. Everything in `game/src/` is original;
three.js 0.187.0 and `vendor/makefun-threejs.ts` are the kit's files.
