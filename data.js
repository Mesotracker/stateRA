'use strict';
/* =====================================================================
   CITY.RA — data.js
   All game definitions: factions, weapons, warheads, units, military
   buildings, civilian buildings, research. Tuning lives here.
   Ranges are in tiles, speeds in px/s, times in seconds.
   ===================================================================== */

const ARMOR = { none: 0, light: 1, heavy: 2, air: 3, naval: 4, bld: 5 };
// Warhead multipliers vs [none, light, heavy, air, naval, building]
const WH = {
  small:   [1.0, 0.3, 0.08, 0.45, 0.1, 0.1],
  sniper:  [1.0, 0.1, 0.02, 0, 0.02, 0.02],
  ap_lt:   [0.7, 1.0, 0.35, 0.8, 0.5, 0.35],
  ap:      [0.35, 0.9, 1.0, 0, 0.8, 0.7],
  at:      [0.3, 1.0, 1.2, 0.6, 0.9, 0.6],
  he:      [1.0, 0.8, 0.45, 0, 0.6, 1.0],
  aa:      [0, 0, 0, 1.0, 0, 0],
  torp:    [0, 0, 0, 0, 1.2, 0.4],
  demo:    [0.5, 0.8, 0.8, 0, 0.6, 1.4],
};

/* tg: g = ground & surface, a = air, s = submerged */
const WEAPONS = {
  rifle:      { name: 'Service rifle', dmg: 7, rel: 1.0, rng: 4.5, proj: 'bullet', spd: 1000, wh: 'small', supp: 4, tg: 'g', snd: 'rifle' },
  carbine:    { name: 'Suppressed carbine', dmg: 11, rel: 0.6, rng: 4.5, proj: 'bullet', spd: 1000, wh: 'small', supp: 4, tg: 'g', snd: 'rifle' },
  pulserifle: { name: 'Autonomous pulse carbine', dmg: 13, rel: 0.45, rng: 5.5, proj: 'bullet', spd: 1300, wh: 'ap_lt', supp: 8, tg: 'ga', snd: 'mg' },
  mechgun:    { name: 'Twin rotary cannon', dmg: 22, rel: 0.35, rng: 6.2, proj: 'shell', spd: 1050, wh: 'ap_lt', supp: 12, tg: 'ga', snd: 'auto' },
  dronebomb:  { name: 'Shaped-charge warhead', dmg: 240, rel: 1.0, rng: 1.2, proj: 'shell', spd: 900, wh: 'at', splash: 38, supp: 25, tg: 'g', snd: 'bomb' },
  pistol:     { name: 'Sidearm', dmg: 3, rel: 1.2, rng: 3, proj: 'bullet', spd: 900, wh: 'small', supp: 1, tg: 'g', snd: 'rifle' },
  mg:         { name: 'General-purpose MG', dmg: 4, rel: 0.17, rng: 5, proj: 'bullet', spd: 1100, wh: 'small', supp: 10, tg: 'g', snd: 'mg' },
  hmg:        { name: 'Heavy MG', dmg: 7, rel: 0.24, rng: 5.2, proj: 'bullet', spd: 1100, wh: 'ap_lt', supp: 9, tg: 'g', snd: 'mg' },
  sniper:     { name: 'Marksman rifle', dmg: 55, rel: 2.8, rng: 8.5, proj: 'bullet', spd: 1600, wh: 'sniper', supp: 20, tg: 'g', snd: 'sniper' },
  atrocket:   { name: 'Lance AT rocket', dmg: 55, rel: 2.6, rng: 5.5, proj: 'rocket', spd: 360, wh: 'at', supp: 6, tg: 'g', snd: 'rocket' },
  manpad:     { name: 'Kestrel SAM', dmg: 48, rel: 3.0, rng: 7.5, proj: 'missile', spd: 420, wh: 'aa', tg: 'a', snd: 'missile', homing: true },
  autocannon: { name: '30mm autocannon', dmg: 13, rel: 0.45, rng: 5.5, proj: 'shell', spd: 900, wh: 'ap_lt', supp: 8, tg: 'ga', snd: 'auto' },
  cannon:     { name: '120mm cannon', dmg: 40, rel: 2.2, rng: 6, proj: 'shell', spd: 900, wh: 'ap', supp: 10, tg: 'g', snd: 'cannon' },
  hcannon:    { name: '140mm cannon', dmg: 68, rel: 3.0, rng: 6.5, proj: 'shell', spd: 900, wh: 'ap', supp: 14, tg: 'g', snd: 'cannon' },
  artillery:  { name: '155mm howitzer', dmg: 75, rel: 5.0, rng: 15, min: 4, proj: 'arc', spd: 260, wh: 'he', splash: 50, supp: 25, tg: 'g', snd: 'artillery', spread: 30 },
  mlrs:       { name: 'Tempest rocket salvo', dmg: 30, rel: 10, rng: 13, min: 4, proj: 'arcrocket', spd: 300, wh: 'he', splash: 38, supp: 20, tg: 'g', snd: 'salvo', burst: 6, bgap: 0.15, spread: 44 },
  aam:        { name: 'Viper air-to-air missile', dmg: 62, rel: 1.8, rng: 8, proj: 'missile', spd: 620, wh: 'aa', tg: 'a', snd: 'missile', homing: true },
  agm:        { name: 'Hammer guided missile', dmg: 75, rel: 1.4, rng: 6.5, proj: 'missile', spd: 520, wh: 'at', tg: 'g', snd: 'missile', homing: true },
  bomb:       { name: 'Gravity bomb', dmg: 130, rel: 0.35, rng: 1.6, proj: 'bomb', spd: 0, wh: 'he', splash: 66, supp: 30, tg: 'g', snd: 'bomb' },
  hrockets:   { name: 'Hydra rockets', dmg: 24, rel: 0.5, rng: 6, proj: 'rocket', spd: 420, wh: 'at', splash: 14, tg: 'g', snd: 'rocket' },
  chaingun:   { name: '25mm chain gun', dmg: 7, rel: 0.12, rng: 5.5, proj: 'bullet', spd: 1200, wh: 'ap_lt', supp: 9, tg: 'g', snd: 'mg' },
  navalgun:   { name: '127mm naval gun', dmg: 48, rel: 2.5, rng: 11, proj: 'shell', spd: 700, wh: 'he', splash: 40, tg: 'g', snd: 'cannon' },
  torpedo:    { name: 'Mako torpedo', dmg: 130, rel: 4, rng: 8, proj: 'torp', spd: 160, wh: 'torp', tg: 'gs', naval: true, snd: 'torp', homing: true },
  depth:      { name: 'Depth charges', dmg: 90, rel: 3.5, rng: 3.5, proj: 'torp', spd: 120, wh: 'torp', tg: 's', snd: 'torp', homing: true },
  flak:       { name: 'Flak cannon', dmg: 15, rel: 0.4, rng: 7.5, proj: 'shell', spd: 1000, wh: 'aa', tg: 'a', snd: 'auto', flak: true },
  patrolgun:  { name: '20mm deck gun', dmg: 11, rel: 0.4, rng: 6, proj: 'shell', spd: 900, wh: 'ap_lt', tg: 'ga', snd: 'auto' },
  turretgun:  { name: 'Turret cannon', dmg: 42, rel: 2.0, rng: 7, proj: 'shell', spd: 900, wh: 'ap', tg: 'g', snd: 'cannon' },
  bunkermg:   { name: 'Bunker MG', dmg: 6, rel: 0.2, rng: 6, proj: 'bullet', spd: 1100, wh: 'small', supp: 10, tg: 'g', snd: 'mg' },
  towergun:   { name: 'Tower rifle', dmg: 9, rel: 0.9, rng: 6.5, proj: 'bullet', spd: 1100, wh: 'small', supp: 4, tg: 'g', snd: 'rifle' },
  sam:        { name: 'Bastion SAM', dmg: 72, rel: 2.4, rng: 11, proj: 'missile', spd: 650, wh: 'aa', tg: 'a', snd: 'missile', homing: true },
  coastal:    { name: 'Coastal gun', dmg: 95, rel: 4.5, rng: 16, proj: 'arc', spd: 420, wh: 'he', splash: 42, tg: 'g', snd: 'artillery', spread: 22 },
};

/* ---------------- factions ---------------- */
const FACTIONS = {
  meridian: {
    name: 'Meridian Federation', short: 'MER', color: '#5b8fe0', dark: '#1f3a66', light: '#b9d1f5',
    doctrine: 'Combined arms built around air superiority and fast research.',
    traits: ['Aircraft cost 15% less', 'Aircraft +10% durability', 'Research 30% faster'],
    mod: { cost: { air: 0.85 }, hp: { air: 1.1 }, research: 1.3 }, unique: 'stratos', arch: 'modern', humane: 0.6, aggr: 0.5,
  },
  steppe: {
    name: 'Iron Steppe Directorate', short: 'ISD', color: '#d0503f', dark: '#5e1f18', light: '#f0b7ac',
    doctrine: 'Massed armour and long-range artillery. Grinds forward.',
    traits: ['Vehicles cost 10% less', 'Vehicles +12% durability', 'Artillery range +15%'],
    mod: { cost: { veh: 0.9 }, hp: { veh: 1.12 }, artRange: 1.15 }, unique: 'mammoth', arch: 'brutal', humane: 0.2, aggr: 0.8,
  },
  league: {
    name: 'Coastal League', short: 'CLG', color: '#33b3a4', dark: '#124a44', light: '#a8e6de',
    doctrine: 'Naval power, mobility and trade wealth.',
    traits: ['Ships cost 20% less', 'Ships and wheeled vehicles faster', 'Trade income +50%'],
    mod: { cost: { sea: 0.8 }, speed: { sea: 1.15, wheel: 1.1 }, trade: 1.5 }, unique: 'wavecutter', arch: 'harbor', humane: 0.8, aggr: 0.4,
  },
  highland: {
    name: 'Highland Free Corps', short: 'HFC', color: '#d6ad3c', dark: '#5a4613', light: '#f2dda0',
    doctrine: 'Irregular infantry, camouflage and civilian support.',
    traits: ['Infantry cost 20% less', 'Infantry +10% durability, +1 sight', 'Reputation losses halved'],
    mod: { cost: { inf: 0.8 }, hp: { inf: 1.1 }, sight: { inf: 1 }, rep: 0.5 }, unique: 'ghost', arch: 'timber', humane: 1, aggr: 0.55,
  },
};
const FACTION_KEYS = Object.keys(FACTIONS);

/* ---------------- units ----------------
   cat: inf | veh | air | sea      mc: movement class
   cost: c credits, m metal, f fuel, s supplies */
const UNITS = {
  // ---- infantry (barracks)
  rifle:    { name: 'Riflemen', cat: 'inf', hp: 60, armor: 'none', spd: 30, sight: 6, w: ['rifle'], ammo: 60, cost: { c: 100, s: 5 }, time: 5, mc: 'foot', r: 5, key: 'Q' },
  mg:       { name: 'Machine-gun team', cat: 'inf', hp: 70, armor: 'none', spd: 25, sight: 6, w: ['mg'], ammo: 220, cost: { c: 180, s: 10 }, time: 7, mc: 'foot', r: 5 },
  sniper:   { name: 'Sniper', cat: 'inf', hp: 50, armor: 'none', spd: 30, sight: 9.5, w: ['sniper'], ammo: 20, cost: { c: 350, s: 8 }, time: 10, mc: 'foot', r: 5, camo: true },
  engineer: { name: 'Engineer', cat: 'inf', hp: 55, armor: 'none', spd: 30, sight: 5, w: ['pistol'], ammo: 30, cost: { c: 300 }, time: 8, mc: 'foot', r: 5, ab: { capture: 1, repair: 1 } },
  medic:    { name: 'Field medic', cat: 'inf', hp: 60, armor: 'none', spd: 32, sight: 6, w: [], ammo: 0, cost: { c: 200, s: 10 }, time: 7, mc: 'foot', r: 5, ab: { heal: 8 } },
  recon:    { name: 'Recon squad', cat: 'inf', hp: 55, armor: 'none', spd: 40, sight: 11, w: ['rifle'], ammo: 60, cost: { c: 180 }, time: 6, mc: 'foot', r: 5, ab: { detect: 1 } },
  at:       { name: 'Anti-tank team', cat: 'inf', hp: 65, armor: 'none', spd: 26, sight: 6, w: ['atrocket'], ammo: 12, cost: { c: 260, m: 5, s: 8 }, time: 8, mc: 'foot', r: 5 },
  aa:       { name: 'Anti-air team', cat: 'inf', hp: 65, armor: 'none', spd: 26, sight: 7, w: ['manpad'], ammo: 10, cost: { c: 280, m: 5, s: 8 }, time: 8, mc: 'foot', r: 5 },
  spec:     { name: 'Special forces', cat: 'inf', hp: 95, armor: 'none', spd: 36, sight: 8, w: ['carbine'], ammo: 80, cost: { c: 500, s: 15 }, time: 12, mc: 'foot', r: 5, ab: { demo: 1, detect: 1 }, tech: 'specops' },
  exo:      { name: 'Armoured infantry', cat: 'inf', hp: 170, armor: 'light', spd: 24, sight: 6, w: ['hmg'], ammo: 200, cost: { c: 450, m: 20, s: 10 }, time: 12, mc: 'foot', r: 6, tech: 'specops' },
  robosoldier:{ name: 'Robot soldier', cat: 'inf', hp: 220, armor: 'light', spd: 38, sight: 8, w: ['pulserifle'], ammo: 180, cost: { c: 420, m: 25, s: 8 }, time: 9, mc: 'foot', r: 5, ab: { detect: 1, fearless: 1 }, tech: 'robotics' },
  ghost:    { name: 'Ghost commandos', cat: 'inf', hp: 110, armor: 'none', spd: 38, sight: 9, w: ['carbine'], ammo: 90, cost: { c: 600, s: 15 }, time: 14, mc: 'foot', r: 5, ab: { demo: 1, stealth: 1, detect: 1 }, faction: 'highland', tech: 'specops' },
  // ---- ground vehicles (factory)
  harvester:{ name: 'Ore collector', cat: 'veh', hp: 650, armor: 'heavy', spd: 40, sight: 5, w: [], ammo: 0, cost: { c: 1100, m: 40 }, time: 15, mc: 'track', r: 13, ab: { harvest: 500 } },
  jeep:     { name: 'Patrol jeep', cat: 'veh', hp: 190, armor: 'light', spd: 95, sight: 8, w: ['mg'], ammo: 300, cost: { c: 300, m: 5, f: 5 }, time: 6, mc: 'wheel', r: 9 },
  scout:    { name: 'Recon vehicle', cat: 'veh', hp: 230, armor: 'light', spd: 88, sight: 12, w: ['hmg'], ammo: 260, cost: { c: 450, m: 10, f: 5 }, time: 8, mc: 'wheel', r: 10, ab: { detect: 1 } },
  apc:      { name: 'Armoured personnel carrier', cat: 'veh', hp: 400, armor: 'light', spd: 72, sight: 7, w: ['mg'], ammo: 300, cost: { c: 600, m: 15, f: 8 }, time: 9, mc: 'wheel', r: 11, ab: { carry: 5, carryInf: 1 } },
  ifv:      { name: 'Infantry fighting vehicle', cat: 'veh', hp: 460, armor: 'light', spd: 62, sight: 7, w: ['autocannon'], ammo: 120, cost: { c: 800, m: 25, f: 8 }, time: 11, mc: 'track', r: 11, ab: { carry: 3, carryInf: 1 } },
  mbt:      { name: 'Main battle tank', cat: 'veh', hp: 720, armor: 'heavy', spd: 52, sight: 7, w: ['cannon', 'mg'], ammo: 40, cost: { c: 950, m: 40, f: 10 }, time: 14, mc: 'track', r: 13 },
  heavy:    { name: 'Heavy tank', cat: 'veh', hp: 1250, armor: 'heavy', spd: 36, sight: 7, w: ['hcannon', 'hmg'], ammo: 36, cost: { c: 1600, m: 80, f: 14 }, time: 20, mc: 'track', r: 15, tech: 'heavyarmor' },
  spg:      { name: 'Self-propelled artillery', cat: 'veh', hp: 400, armor: 'light', spd: 40, sight: 7, w: ['artillery'], ammo: 24, cost: { c: 1100, m: 35, f: 10 }, time: 15, mc: 'track', r: 13, req: ['radar'] },
  mlrs:     { name: 'Rocket artillery', cat: 'veh', hp: 330, armor: 'light', spd: 52, sight: 7, w: ['mlrs'], ammo: 4, cost: { c: 1200, m: 30, f: 10 }, time: 15, mc: 'wheel', r: 12, req: ['radar'] },
  aatruck:  { name: 'Mobile flak', cat: 'veh', hp: 360, armor: 'light', spd: 64, sight: 9, w: ['flak'], ammo: 200, cost: { c: 800, m: 20, f: 8 }, time: 10, mc: 'wheel', r: 11 },
  engveh:   { name: 'Engineering vehicle', cat: 'veh', hp: 650, armor: 'heavy', spd: 44, sight: 6, w: [], ammo: 0, cost: { c: 700, m: 30, f: 8 }, time: 12, mc: 'track', r: 13, ab: { repair: 2.5, clear: 1 } },
  recovery: { name: 'Recovery truck', cat: 'veh', hp: 420, armor: 'light', spd: 62, sight: 6, w: [], ammo: 0, cost: { c: 600, m: 15, f: 6 }, time: 10, mc: 'wheel', r: 11, ab: { fix: 18, clear: 1 } },
  supply:   { name: 'Supply truck', cat: 'veh', hp: 320, armor: 'light', spd: 70, sight: 6, w: [], ammo: 0, cost: { c: 500, f: 6 }, time: 8, mc: 'wheel', r: 11, ab: { resupply: 1, aid: 1 } },
  mammoth:  { name: 'Mammoth siege tank', cat: 'veh', hp: 2100, armor: 'heavy', spd: 27, sight: 8, w: ['hcannon', 'manpad'], ammo: 60, cost: { c: 2400, m: 120, f: 20 }, time: 28, mc: 'track', r: 18, faction: 'steppe', tech: 'heavyarmor', twin: true },
  mech:     { name: 'Assault combat mech', cat: 'veh', hp: 1050, armor: 'heavy', spd: 58, sight: 9, w: ['mechgun', 'atrocket'], ammo: 90, cost: { c: 1350, m: 55, f: 10 }, time: 16, mc: 'track', r: 13, ab: { fearless: 1, detect: 1 }, tech: 'robotics' },
  wavecutter:{ name: 'Wavecutter hovercraft', cat: 'veh', hp: 440, armor: 'light', spd: 100, sight: 8, w: ['autocannon'], ammo: 140, cost: { c: 900, m: 25, f: 12 }, time: 12, mc: 'hover', r: 13, faction: 'league', ab: { carry: 4, carryInf: 1 } },
  // ---- aircraft (airfield)
  recondrone:{ name: 'Recon quad-drone', cat: 'air', hp: 140, armor: 'air', spd: 185, sight: 16, w: [], ammo: 0, cost: { c: 320, m: 5, f: 4 }, time: 6, mc: 'air', r: 9, ab: { detect: 1, stealth: 1, fearless: 1 }, tech: 'drones' },
  kamikaze: { name: 'Loitering munition drone', cat: 'air', hp: 110, armor: 'air', spd: 215, sight: 10, w: ['dronebomb'], ammo: 1, cost: { c: 380, m: 10, f: 5, s: 10 }, time: 7, mc: 'air', r: 9, ab: { kamikaze: 1, fearless: 1 }, tech: 'drones' },
  ucav:     { name: 'Reaper strike UCAV', cat: 'air', hp: 380, armor: 'air', spd: 210, sight: 13, w: ['agm', 'pulserifle'], ammo: 8, cost: { c: 1250, m: 25, f: 18 }, time: 14, mc: 'air', plane: true, r: 14, ab: { stealth: 1, detect: 1, fearless: 1 }, tech: 'drones' },
  fighter:  { name: 'Interceptor', cat: 'air', hp: 300, armor: 'air', spd: 270, sight: 10, w: ['aam'], ammo: 4, cost: { c: 1200, m: 20, f: 25 }, time: 14, mc: 'air', plane: true, r: 14 },
  bomber:   { name: 'Strategic bomber', cat: 'air', hp: 650, armor: 'air', spd: 170, sight: 9, w: ['bomb'], ammo: 8, cost: { c: 2200, m: 40, f: 45 }, time: 22, mc: 'air', plane: true, r: 22, tech: 'strategic' },
  gunship:  { name: 'Attack helicopter', cat: 'air', hp: 460, armor: 'air', spd: 130, sight: 9, w: ['hrockets', 'chaingun'], ammo: 16, cost: { c: 1400, m: 25, f: 20 }, time: 16, mc: 'air', r: 14 },
  thelo:    { name: 'Transport helicopter', cat: 'air', hp: 520, armor: 'air', spd: 125, sight: 8, w: [], ammo: 0, cost: { c: 900, m: 15, f: 15 }, time: 12, mc: 'air', r: 16, ab: { carry: 6, carryInf: 1 } },
  reconplane:{ name: 'Recon aircraft', cat: 'air', hp: 220, armor: 'air', spd: 235, sight: 16, w: [], ammo: 0, cost: { c: 700, f: 12 }, time: 10, mc: 'air', plane: true, r: 14, ab: { detect: 1 } },
  cas:      { name: 'Close-air-support jet', cat: 'air', hp: 520, armor: 'air', spd: 190, sight: 9, w: ['agm', 'chaingun'], ammo: 6, cost: { c: 1600, m: 30, f: 30 }, time: 18, mc: 'air', plane: true, r: 16 },
  stratos:  { name: 'Stratos heavy gunship', cat: 'air', hp: 950, armor: 'air', spd: 110, sight: 10, w: ['hrockets', 'chaingun', 'aam'], ammo: 28, cost: { c: 2600, m: 60, f: 35 }, time: 26, mc: 'air', r: 20, faction: 'meridian', tech: 'heavyarmor' },
  // ---- naval (shipyard)
  patrol:   { name: 'Patrol boat', cat: 'sea', hp: 320, armor: 'naval', spd: 95, sight: 9, w: ['patrolgun', 'depth'], ammo: 200, cost: { c: 500, m: 10, f: 8 }, time: 9, mc: 'naval', r: 12, ab: { sonar: 1 } },
  destroyer:{ name: 'Destroyer', cat: 'sea', hp: 1250, armor: 'naval', spd: 58, sight: 11, w: ['navalgun', 'flak', 'depth'], ammo: 60, cost: { c: 1800, m: 80, f: 20 }, time: 22, mc: 'naval', r: 22, ab: { sonar: 1 } },
  tship:    { name: 'Transport ship', cat: 'sea', hp: 750, armor: 'naval', spd: 55, sight: 7, w: [], ammo: 0, cost: { c: 900, m: 30, f: 10 }, time: 14, mc: 'naval', r: 20, ab: { carry: 8 } },
  lcraft:   { name: 'Landing craft', cat: 'sea', hp: 420, armor: 'naval', spd: 66, sight: 7, w: [], ammo: 0, cost: { c: 600, m: 15, f: 8 }, time: 10, mc: 'beach', r: 15, ab: { carry: 4 } },
  sub:      { name: 'Attack submarine', cat: 'sea', hp: 620, armor: 'naval', spd: 55, sight: 8, w: ['torpedo'], ammo: 12, cost: { c: 1500, m: 60, f: 15 }, time: 20, mc: 'naval', r: 15, ab: { submerge: 1 }, tech: 'silent' },
  nsupply:  { name: 'Naval supply vessel', cat: 'sea', hp: 520, armor: 'naval', spd: 60, sight: 7, w: [], ammo: 0, cost: { c: 700, m: 20, f: 8 }, time: 12, mc: 'naval', r: 16, ab: { resupply: 1, fix: 14 } },
};
for (const k in UNITS) UNITS[k].key = k;
const PRODUCER = { inf: 'barracks', veh: 'factory', air: 'hangar', sea: 'shipyard' };

/* ---------------- military buildings ----------------
   pw: + produces / - consumes power. cost: c credits, mat materials */
const BLDS = {
  hq:        { name: 'Headquarters', w: 3, h: 3, hp: 3200, pw: 15, cost: { c: 3000, mat: 200 }, time: 45, cat: 'base', sight: 9, req: ['factory'], buildRadius: 12, up: { name: 'Fortified command centre', cost: { c: 2000, mat: 200 }, time: 30 } },
  power:     { name: 'Power plant', w: 2, h: 2, hp: 800, pw: 100, cost: { c: 300, mat: 20 }, time: 9, cat: 'base', up: { name: 'Advanced power plant', cost: { c: 450, mat: 30 }, time: 15 } },
  refinery:  { name: 'Ore refinery', w: 3, h: 2, hp: 1100, pw: -30, cost: { c: 1500, mat: 40 }, time: 18, cat: 'eco', req: ['power'], up: { name: 'Refinery: centrifuge line', cost: { c: 800, mat: 40 }, time: 20 } },
  barracks:  { name: 'Barracks', w: 2, h: 2, hp: 850, pw: -20, cost: { c: 400, mat: 20 }, time: 10, cat: 'base', req: ['power'], prod: 'inf', up: { name: 'Training academy', cost: { c: 600, mat: 30 }, time: 18 } },
  factory:   { name: 'Vehicle factory', w: 3, h: 3, hp: 1500, pw: -30, cost: { c: 1600, mat: 60 }, time: 20, cat: 'base', req: ['refinery'], prod: 'veh', up: { name: 'Assembly line II', cost: { c: 900, mat: 50 }, time: 22 } },
  hangar:    { name: 'Airfield', w: 3, h: 3, hp: 1250, pw: -40, cost: { c: 1800, mat: 60 }, time: 22, cat: 'base', req: ['radar'], prod: 'air', docks: 4 },
  shipyard:  { name: 'Shipyard', w: 3, h: 3, hp: 1500, pw: -30, cost: { c: 1400, mat: 60 }, time: 20, cat: 'base', req: ['barracks'], prod: 'sea', coast: true },
  radar:     { name: 'Radar station', w: 2, h: 2, hp: 900, pw: -40, cost: { c: 900, mat: 30 }, time: 14, cat: 'base', req: ['refinery'], sight: 10, up: { name: 'Long-range radar', cost: { c: 700, mat: 20 }, time: 16 } },
  lab:       { name: 'Research laboratory', w: 2, h: 2, hp: 900, pw: -60, cost: { c: 1500, mat: 50 }, time: 20, cat: 'base', req: ['radar'] },
  fueldepot: { name: 'Fuel storage', w: 2, h: 2, hp: 700, pw: -10, cost: { c: 600, mat: 25 }, time: 10, cat: 'eco', req: ['power'], store: { fuel: 1500 }, make: { fuel: 0.4 }, volatile: 140 },
  depot:     { name: 'Supply depot', w: 2, h: 2, hp: 900, pw: -10, cost: { c: 600, mat: 25 }, time: 10, cat: 'eco', req: ['barracks'], store: { supplies: 1000 }, make: { supplies: 0.7 }, eat: { food: 0.15, metal: 0.08 }, supplyR: 5 },
  ammo:      { name: 'Ammunition warehouse', w: 2, h: 2, hp: 700, pw: -5, cost: { c: 500, mat: 20 }, time: 9, cat: 'eco', req: ['depot'], supplyR: 7, volatile: 220 },
  repair:    { name: 'Repair facility', w: 3, h: 2, hp: 1000, pw: -30, cost: { c: 1000, mat: 40 }, time: 14, cat: 'base', req: ['factory'], fixR: 3.5 },
  medical:   { name: 'Medical tent', w: 2, h: 2, hp: 500, pw: -10, cost: { c: 400, mat: 10 }, time: 8, cat: 'base', req: ['barracks'], healR: 4 },
  mine:      { name: 'Metal mine', w: 2, h: 2, hp: 800, pw: -25, cost: { c: 800, mat: 30 }, time: 12, cat: 'eco', req: ['power'], make: { metal: 1.2 }, store: { metal: 400 }, needs: 'metal' },
  farm:      { name: 'Military farm', w: 3, h: 3, hp: 450, pw: -5, cost: { c: 300, mat: 10 }, time: 8, cat: 'eco', req: ['power'], make: { food: 1.0 }, store: { food: 300 } },
  pump:      { name: 'Water pump', w: 2, h: 2, hp: 500, pw: -15, cost: { c: 350, mat: 15 }, time: 8, cat: 'eco', req: ['power'], make: { water: 1.2 }, store: { water: 300 }, nearWater: true },
  logistics: { name: 'Logistics centre', w: 3, h: 2, hp: 1000, pw: -20, cost: { c: 1200, mat: 30 }, time: 15, cat: 'eco', req: ['depot'], store: { materials: 1000 }, convert: 1 },
  shelter:   { name: 'Refugee shelter', w: 2, h: 2, hp: 900, pw: -10, cost: { c: 500, mat: 30 }, time: 10, cat: 'eco', req: ['barracks'], refuge: 250 },
  wall:      { name: 'Wall section', w: 1, h: 1, hp: 650, pw: 0, cost: { c: 30, mat: 4 }, time: 1.2, cat: 'def', req: ['barracks'], repeat: true, wall: true },
  trench:    { name: 'Trench', w: 1, h: 1, hp: 350, pw: 0, cost: { c: 20, mat: 1 }, time: 1, cat: 'def', req: ['barracks'], repeat: true, walk: true, cover: 0.55 },
  bunker:    { name: 'MG bunker', w: 2, h: 2, hp: 1300, pw: 0, cost: { c: 600, mat: 40 }, time: 10, cat: 'def', req: ['barracks'], w_: ['bunkermg'], sight: 7 },
  tower:     { name: 'Watchtower', w: 1, h: 1, hp: 500, pw: 0, cost: { c: 250, mat: 10 }, time: 6, cat: 'def', req: ['barracks'], w_: ['towergun'], sight: 12 },
  turret:    { name: 'Gun turret', w: 1, h: 1, hp: 1000, pw: -25, cost: { c: 800, mat: 30 }, time: 12, cat: 'def', req: ['factory'], w_: ['turretgun'], sight: 8, needPower: true, up: { name: 'Heavy turret', cost: { c: 600, mat: 20 }, time: 14 } },
  sam:       { name: 'SAM site', w: 2, h: 2, hp: 820, pw: -40, cost: { c: 900, mat: 30 }, time: 12, cat: 'def', req: ['radar'], w_: ['sam'], sight: 10, needPower: true },
  abm:       { name: 'Missile defence battery', w: 2, h: 2, hp: 1000, pw: -50, cost: { c: 1800, mat: 60 }, time: 24, cat: 'def', req: ['radar'], tech: 'missiles', abm: 22, sight: 12, needPower: true },
  silo:      { name: 'Strategic missile silo', w: 2, h: 2, hp: 1800, pw: -60, cost: { c: 3500, mat: 150 }, time: 40, cat: 'def', req: ['lab'], tech: 'missiles', silo: true, sight: 6 },
  coastal:   { name: 'Coastal battery', w: 2, h: 2, hp: 1400, pw: -30, cost: { c: 1400, mat: 50 }, time: 16, cat: 'def', req: ['radar'], w_: ['coastal'], sight: 10, needPower: true, nearWater: true },
};
for (const k in BLDS) BLDS[k].key = k;
const BUILD_ORDER_UI = {
  base: ['power', 'barracks', 'refinery', 'factory', 'radar', 'hangar', 'shipyard', 'lab', 'repair', 'medical', 'hq'],
  eco: ['fueldepot', 'depot', 'ammo', 'mine', 'farm', 'pump', 'logistics', 'shelter'],
  def: ['wall', 'trench', 'bunker', 'tower', 'turret', 'sam', 'coastal', 'abm', 'silo'],
};

/* ---------------- civilian buildings ----------------
   res residents, jobs, svc services provided, out = economic output per s */
const CIVB = {
  house:       { name: 'House', w: 1, h: 1, hp: 300, res: 6, jobs: 0, zone: 'res' },
  apartment:   { name: 'Apartment block', w: 2, h: 2, hp: 1000, res: 48, jobs: 0, zone: 'res' },
  shop:        { name: 'Shop', w: 1, h: 1, hp: 320, jobs: 4, out: { credits: 0.05 }, zone: 'com' },
  supermarket: { name: 'Supermarket', w: 2, h: 2, hp: 750, jobs: 14, out: { credits: 0.1 }, svc: { food: 1 }, zone: 'com' },
  restaurant:  { name: 'Restaurant', w: 1, h: 1, hp: 320, jobs: 6, out: { credits: 0.06 }, zone: 'com' },
  market:      { name: 'Market hall', w: 2, h: 1, hp: 500, jobs: 10, out: { credits: 0.12 }, svc: { trade: 1 }, zone: 'com' },
  bank:        { name: 'Bank', w: 2, h: 1, hp: 950, jobs: 10, out: { credits: 0.22 }, zone: 'com' },
  hospital:    { name: 'Hospital', w: 3, h: 2, hp: 1500, jobs: 32, svc: { health: 3 }, cap: 'heal', zone: 'pub', shelter: 120 },
  clinic:      { name: 'Clinic', w: 1, h: 1, hp: 420, jobs: 6, svc: { health: 1 }, zone: 'pub' },
  school:      { name: 'School', w: 2, h: 2, hp: 850, jobs: 12, svc: { edu: 1 }, zone: 'pub', shelter: 150 },
  university:  { name: 'University', w: 3, h: 3, hp: 1700, jobs: 44, svc: { edu: 3 }, out: { credits: 0.1 }, zone: 'pub' },
  police:      { name: 'Police station', w: 2, h: 1, hp: 750, jobs: 12, svc: { police: 1 }, zone: 'pub' },
  fire:        { name: 'Fire station', w: 2, h: 2, hp: 850, jobs: 14, svc: { fire: 1 }, zone: 'pub' },
  cityhall:    { name: 'City hall', w: 2, h: 2, hp: 1600, jobs: 22, svc: { gov: 1 }, zone: 'pub', shelter: 200 },
  farmhouse:   { name: 'Farmstead', w: 1, h: 1, hp: 320, res: 5, jobs: 5, out: { food: 0.35 }, zone: 'farm' },
  factory:     { name: 'Factory', w: 3, h: 2, hp: 1500, jobs: 55, out: { materials: 0.25, credits: 0.08 }, zone: 'ind' },
  warehouse:   { name: 'Warehouse', w: 2, h: 2, hp: 950, jobs: 8, out: { credits: 0.04 }, zone: 'ind' },
  construction:{ name: 'Construction site', w: 2, h: 2, hp: 450, jobs: 16, svc: { build: 1 }, zone: 'ind' },
  waterplant:  { name: 'Water treatment plant', w: 2, h: 2, hp: 950, jobs: 9, svc: { water: 1 }, zone: 'util' },
  substation:  { name: 'Electrical substation', w: 2, h: 2, hp: 720, jobs: 2, svc: { power: 1 }, zone: 'util' },
  powerstation:{ name: 'Power station', w: 3, h: 2, hp: 1700, jobs: 26, svc: { grid: 1 }, cap: 'power', zone: 'util' },
  transit:     { name: 'Bus depot', w: 2, h: 1, hp: 650, jobs: 10, svc: { transit: 1 }, zone: 'pub' },
  station:     { name: 'Rail station', w: 3, h: 1, hp: 900, jobs: 12, svc: { transit: 1 }, zone: 'pub' },
  fuelstation: { name: 'Fuel station', w: 1, h: 1, hp: 300, jobs: 3, out: { credits: 0.04 }, cap: 'fuel', volatile: 90, zone: 'com' },
  commtower:   { name: 'Communications tower', w: 1, h: 1, hp: 520, jobs: 1, cap: 'sight', zone: 'util' },
  checkpoint:  { name: 'Checkpoint', w: 1, h: 1, hp: 420, jobs: 2, zone: 'util' },
  derrick:     { name: 'Oil derrick', w: 1, h: 1, hp: 650, jobs: 3, cap: 'oil', zone: 'ind' },
  airport:     { name: 'Airport terminal', w: 4, h: 2, hp: 2000, jobs: 40, out: { credits: 0.2 }, cap: 'airport', zone: 'pub' },
  port:        { name: 'Harbour', w: 3, h: 2, hp: 1600, jobs: 30, out: { credits: 0.15, food: 0.2 }, cap: 'port', zone: 'ind' },
  ruin:        { name: 'Abandoned building', w: 1, h: 1, hp: 200, jobs: 0, zone: 'res', ruin: true },
};
for (const k in CIVB) CIVB[k].key = k;
const CAPTURE_INFO = {
  heal: 'Heals nearby units of the controlling faction',
  power: 'Feeds +120 power to the controlling faction',
  fuel: 'Provides +0.4 fuel/s',
  sight: 'Reveals a wide area around the tower',
  oil: 'Pumps +1.5 fuel/s and +1 credit/s',
  airport: 'Adds +3 credits/s and reveals the airfield',
  port: 'Adds +2 credits/s trade income',
};

/* ---------------- research ---------------- */
const TECH = {
  drones:     { name: 'Remote drone warfare', desc: 'Unlocks Recon quad-drones, Loitering munition kamikaze drones, and Reaper strike UCAVs at the Airfield.', cost: 1100, time: 32 },
  robotics:   { name: 'Autonomous combat robotics', desc: 'Unlocks fearless Robot soldiers at the Barracks and heavy Assault combat mechs at the Vehicle factory.', cost: 1600, time: 42 },
  composite:  { name: 'Composite armour', desc: 'Ground vehicles +20% durability.', cost: 1500, time: 45 },
  ecm:        { name: 'Electronic countermeasures', desc: 'Aircraft spoof 35% of incoming missiles with flares and jamming.', cost: 1200, time: 40 },
  radarguide: { name: 'Radar-guided interception', desc: 'AA weapons and SAM sites +30% range.', cost: 1000, time: 35 },
  veteran:    { name: 'Veteran training', desc: 'New infantry start at veteran rank.', cost: 1200, time: 40 },
  logistics2: { name: 'Advanced logistics', desc: 'Resupply twice as fast, vehicle fuel use -30%.', cost: 1000, time: 35 },
  heavyarmor: { name: 'Heavy armour programme', desc: 'Unlocks heavy tanks and your faction\'s signature unit.', cost: 2000, time: 55 },
  strategic:  { name: 'Strategic bombing', desc: 'Unlocks the strategic bomber.', cost: 2000, time: 50 },
  silent:     { name: 'Silent running', desc: 'Unlocks the attack submarine.', cost: 1800, time: 45 },
  specops:    { name: 'Special operations', desc: 'Unlocks special forces, armoured infantry and faction commandos.', cost: 1500, time: 40 },
  missiles:   { name: 'Strategic missile programme', desc: 'Unlocks missile silos and defence batteries, and cruise, short-range ballistic, cluster, thermobaric and ballistic missiles.', cost: 2500, time: 60 },
  hypersonic: { name: 'Hypersonic glide vehicles', desc: 'Unlocks the hypersonic glider, nearly impossible to intercept.', cost: 3200, time: 75, req: ['missiles'] },
  nuclear:    { name: 'Nuclear programme', desc: 'Unlocks tactical (10 kt) and strategic (300 kt) nuclear missiles. Using them has permanent diplomatic consequences and leaves radioactive fallout.', cost: 6000, time: 120, req: ['missiles'] },
  icbm:       { name: 'Thermonuclear ICBMs', desc: 'Unlocks the 1.5 megaton intercontinental missile (16,000 km range).', cost: 5000, time: 100, req: ['nuclear'] },
  civeng:     { name: 'Civil engineering', desc: 'Engineers repair twice as fast; rebuilding civilian structures earns more reputation.', cost: 800, time: 30 },
};

const RES_KEYS = ['credits', 'fuel', 'materials', 'food', 'water', 'metal', 'supplies'];
const RES_LABEL = { credits: 'Credits', fuel: 'Fuel', materials: 'Materials', food: 'Food', water: 'Water', metal: 'Metal', supplies: 'Supplies', power: 'Power' };
const RES_SHORT = { c: 'credits', m: 'metal', f: 'fuel', s: 'supplies', mat: 'materials' };

const TOWN_NAMES = ['Halden', 'Vessmark', 'Orlov Crossing', 'Brightwater', 'Kessel', 'Marrow Bay', 'Tarnby', 'Elmsgate', 'Corvane', 'Dunmere', 'Ashford', 'Pelling', 'Rovna', 'Sable Point', 'Westerholm', 'Ilsk', 'Greywick', 'Novagrad', 'Lindqvist', 'Harrowfield', 'Saltmere', 'Kaprun', 'Belvoir', 'Otterby'];

/* strategic missiles fired from silos.
   rangeKm: maximum range in real kilometres (the map scale decides how many tiles that is)
   kmps: game-time speed in km per second (flight time = 6 s + range / kmps)
   splash: conventional blast radius in pixels (gameplay scale); nuclear weapons use yieldKt and are scaled in real km */
const MISSILES = {
  cruise:    { name: 'Longbow cruise missile', short: 'Cruise', cost: { credits: 1500, fuel: 60, supplies: 40 }, time: 55, dmg: 700, splash: 100, flight: 'cruise', rangeKm: 1500, kmps: 22, hitChance: 0.72, leth: 0.05, tech: 'missiles',
               desc: 'Flies low and fast on a weaving path. Moderate blast. Easier to intercept.' },
  srbm:      { name: 'Falcon short-range ballistic missile', short: 'SRBM', cost: { credits: 2200, fuel: 90, supplies: 50 }, time: 75, dmg: 1100, splash: 130, flight: 'ballistic', rangeKm: 600, kmps: 14, hitChance: 0.55, leth: 0.055, tech: 'missiles',
               desc: 'Theatre ballistic missile, 600 km. Fast and steep, hard to catch before the final seconds.' },
  cluster:   { name: 'Hailstorm cluster missile', short: 'Cluster', cost: { credits: 2000, fuel: 70, supplies: 90 }, time: 70, dmg: 260, splash: 38, spread: 230, bomblets: 26, flight: 'cruise', rangeKm: 900, kmps: 20, hitChance: 0.65, leth: 0.061, tech: 'missiles',
               desc: 'Scatters 26 submunitions over a wide area. Shreds infantry, vehicles and soft structures.' },
  thermo:    { name: 'Vulcan thermobaric missile', short: 'Thermobaric', cost: { credits: 2600, fuel: 80, supplies: 80 }, time: 80, dmg: 1500, splash: 150, flight: 'cruise', rangeKm: 700, kmps: 20, hitChance: 0.7, leth: 0.09, tech: 'missiles', fuelAir: true,
               desc: 'Fuel-air blast: huge overpressure that flattens buildings and kills everything in the open. Starts firestorms.' },
  ballistic: { name: 'Trident ballistic missile', short: 'Ballistic', cost: { credits: 4500, fuel: 150, metal: 100 }, time: 150, dmg: 1700, splash: 190, flight: 'ballistic', rangeKm: 4500, kmps: 60, hitChance: 0.5, leth: 0.065, tech: 'missiles',
               desc: 'Arcs high above the theatre, 4,500 km. Massive conventional blast that levels city blocks.' },
  hyper:     { name: 'Spectre hypersonic glider', short: 'Hypersonic', cost: { credits: 7000, fuel: 160, metal: 160 }, time: 170, dmg: 1400, splash: 150, flight: 'hyper', rangeKm: 3500, kmps: 90, hitChance: 0.2, leth: 0.05, tech: 'hypersonic',
               desc: 'Boost-glide vehicle that skips along the top of the atmosphere. Defences rarely catch it.' },
  tacnuke:   { name: 'Ember tactical nuclear missile', short: 'Tactical nuke', cost: { credits: 9000, fuel: 120, metal: 220, supplies: 80 }, time: 200, dmg: 0, nuke: true, yieldKt: 10, flight: 'ballistic', rangeKm: 800, kmps: 16, hitChance: 0.5, tech: 'nuclear',
               desc: '10 kiloton warhead, 800 km. A battlefield weapon: destroys a city district and leaves a fallout plume.' },
  nuke:      { name: 'Sunfall strategic nuclear missile', short: 'Strategic nuke', cost: { credits: 16000, fuel: 220, metal: 380, supplies: 120 }, time: 300, dmg: 0, nuke: true, yieldKt: 300, flight: 'ballistic', rangeKm: 7000, kmps: 75, hitChance: 0.45, tech: 'nuclear',
               desc: '300 kiloton warhead, 7,000 km. Destroys the core of a major city. Heavy fallout.' },
  icbm:      { name: 'Colossus thermonuclear ICBM', short: 'ICBM (1.5 Mt)', cost: { credits: 28000, fuel: 350, metal: 600, supplies: 200 }, time: 420, dmg: 0, nuke: true, yieldKt: 1500, flight: 'ballistic', rangeKm: 16000, kmps: 190, hitChance: 0.38, tech: 'icbm',
               desc: '1.5 megaton warhead, intercontinental range. Obliterates an entire metropolis; fallout spreads for hundreds of kilometres.' },
};
