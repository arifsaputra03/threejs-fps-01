// The look plan, in one place. Foundry Yard at dusk: warm dark ground, amber
// accent, teal for the Aegis team, ember red for the Ember team.
//
// Every colour below is a named constant first and a PALETTE entry second, so
// the value lives in exactly one place and the entry documents what the
// colour is for. The same names are the CSS custom properties in index.html,
// so the page and the scene never drift apart — if a value changes here, the
// matching --custom-property in the stylesheet changes with it.
//
// Where each entry is used:
//   canvas   scene background, fog, page ground, buy-menu backdrop
//   surface  walls, containers, bot cloth, panels
//   hairline crates, trim, panel borders
//   ink      text, light metal, bot skin, crosshair
//   muted    dim concrete, smoke, secondary text
//   accent   amber: muzzle light, site markers, money, plant bar
//   aegis    player team (teal): vests, visors, scoreboard, feed names
//   ember    enemy team (ember red): vests, visors, damage vignette

// Ground and air: the warm dark the whole yard sits in.
const GROUND_HAZE = '#2f261c';
// Built surfaces: walls, containers, and the cloth of the bot bodies.
const WALL_SURFACE = '#41352a';
// Edges and trim: crates, panel borders, the lines between materials.
const CRATE_TRIM = '#5d4c3d';
// Light metal and text: the brightest neutral in the scene.
const LIGHT_METAL = '#f2ead9';
// Dim concrete and smoke: the quiet neutral behind the action.
const DIM_CONCRETE = '#9a8f7d';
// Amber: the one warm highlight — muzzle light, site markers, money.
const AMBER_ACCENT = '#f0a830';
// Player team: Aegis teal, used for vests, visors, and HUD accents.
const AEGIS_TEAL = '#3fb8a6';
// Enemy team: Ember red, used for vests, visors, and the damage vignette.
const EMBER_RED = '#e05a3a';

export const PALETTE = {
  canvas: GROUND_HAZE, // ground haze / sky
  surface: WALL_SURFACE, // walls, containers
  hairline: CRATE_TRIM, // crates, trim
  ink: LIGHT_METAL, // text, light metal
  muted: DIM_CONCRETE, // dim concrete, smoke
  accent: AMBER_ACCENT, // amber: muzzle light, site markers, money
  aegis: AEGIS_TEAL, // player team (teal)
  ember: EMBER_RED, // enemy team (ember red)
};

// Look a colour up by its palette name, e.g. shade('accent').
// Unknown names return undefined, like reading PALETTE[name] directly.
export function shade(name) {
  return PALETTE[name];
}
