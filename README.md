# City.RA — checkpoint prototype

A 2D real-time strategy game for the browser, written in plain HTML5, CSS and JavaScript on Canvas. No build step, no libraries, no external art: every sprite, texture and sound is generated in code.

## Run it

**Easiest — `CityRA.html`.** One self-contained file with every script built in. Save it anywhere and double-click it. No server, no folder structure needed.

The options below are for working on the source code.

**Option A — any static server (recommended)**

```
cd cityra
python3 -m http.server 8000
# open http://localhost:8000/play.html
```

**Option B — double-click** `play.html` after extracting the whole zip. It loads the scripts from the `js` folder beside it, so it shows a blank page if opened on its own or from inside the zip viewer. Saves use `localStorage`.

`index.html` is the same page without the `<!doctype>` wrapper (that is the form the hosted artifact uses). Fonts load from Google Fonts when online and fall back to system condensed fonts offline.

## What is in this checkpoint

| Area | Working now |
|---|---|
| Maps | Procedural generator, 6 theatre types (continental, coastal, river valley, archipelago, desert, highlands), 8 sizes up to 1024×1024, 4 seasons. Rivers, lakes, coasts, beaches, wetlands, forests, mountains, farmland. Strategic zoom-out for huge maps |
| Real Earth | Pick any region of the world map: click to centre a preset (55 km skirmish up to the whole planet) or **drag a box** for a custom region of any shape. Real coastlines (~5.5 km), matching climate zones and major mountain ranges, **real country borders** (Natural Earth, 185 countries, drawn on the ground, in the strategic view and on the minimap, with country labels) and **~3,000 real cities** placed at their true positions and sized by population. A scale bar and a hover readout show country, latitude/longitude, city population and radiation. Click the preview to choose where your base deploys; rival bases are placed in other countries when possible |
| Scale | Every map has a real-world scale (km per tile) shown in the setup screen and on a scale bar: 1 tile is about 100 m on a local-war map, 1 km on a national map and 80 km on a whole-world map. City footprints follow population and scale, and nuclear blast radii follow physical laws in real kilometres |
| Strategic strikes | Research the Strategic missile programme to build silos and missile defence batteries. Nine missile types with real ranges in km: cruise (1,500), short-range ballistic (600), cluster (900), thermobaric (700), ballistic (4,500), hypersonic glider (3,500, nearly impossible to intercept), tactical nuke (10 kt, 800 km), strategic nuke (300 kt, 7,000 km) and thermonuclear ICBM (1.5 Mt, 16,000 km). The launch cursor shows range and blast rings. Batteries try to intercept. Impacts level blocks, start fires, shake the screen and wreck your reputation if civilians are hit. The AI uses them too, including nukes on harder settings |
| Nuclear weapons | Needs the Nuclear programme (and ICBMs for the megaton missile). Fireball, 20 psi, 5 psi, 1 psi and thermal radii scale with yield (Y^0.4, Y^1/3, Y^0.42) and the map scale; shock fronts arrive after the flash, aircraft in the blast radius are destroyed, trees are flattened, a mushroom cloud rises. Every other faction turns on the aggressor |
| Casualties | Every figure is a whole number of people, with killed and injured counted separately. Real cities carry their real population (Frankfurt about 650,000), so tolls are in real numbers. Nuclear deaths are worked out building by building from distance to ground zero (blast, burns, collapse, glass injuries); conventional missiles are capped by the real lethal footprint of the warhead, so a cruise missile kills tens, not thousands. Deaths from fallout, collapsing buildings, combat crossfire and untreated wounds are tracked by cause, shown on the end screen, in the Civil affairs table and in strike reports. Hospitals help the injured recover |
| Fallout | Each detonation leaves a radioactive plume stretching downwind that decays over time, drawn as an overlay and on the minimap. Radiation sickens infantry and civilians, harms vehicle crews, empties settlements, spoils farms, triggers Geiger-counter warnings and evacuation. Enough nuclear use causes a nuclear winter that cuts food production worldwide |
| Sandbox | Instant construction, training, research, upgrades and missile arming, no prerequisites, unlimited resources, build anywhere |
| World | Cities, towns and villages on street grids with zoned buildings (housing, shops, hospital, schools, university, police, fire, city hall, bank, factories, warehouses, water plant, substations, bus depot), highways with bridges, a railway with a running train, airport, harbour, power station and power lines, fuel stations, checkpoints, comms towers, oil derricks, ruins |
| Rendering | Grid-free blended terrain with hillshading and texture noise in cached chunks, decals (craters, scorch), day/night with building, vehicle and fire lighting, weather (rain, thunderstorm, fog, snow, sandstorm), fog of war, minimap with radar rule |
| Civilians | Population, housing, jobs, utilities (power, water), services, happiness, economy, taxes; pedestrians and traffic on roads with intersection yielding; fire engines, ambulances, police, buses, construction crews, trade convoys, tractors; injured civilians, casualties, evacuation, refugee shelters, self-rebuilding |
| Military | 4 factions with doctrines and unique units; 34 unit types (infantry, vehicles, aircraft, ships); 25 structures; power grid; construction queues; upgrades; repair and sell; research tree (10 techs) |
| Combat | Weapon/armour tables, projectiles (bullets, shells, rockets, homing missiles, artillery arcs, bombs, torpedoes), splash, suppression, cover, morale and retreat, veterancy, ammunition and resupply, ECM flares, radar-guided SAMs, stealth and submarines, transports, capture, demolition, destructible bridges, wrecks that block roads, fire spread |
| Economy | Credits, power, fuel, materials, food, water, metal, supplies; ore harvesting, mines, farms, pumps, depots, logistics conversion, storage caps, shortages with real effects |
| AI and diplomacy | Base-building AI with doctrine plans, production mixes, research, scouting, capture, defence and attack waves, air strikes, naval patrols. Stances (war, ceasefire, neutral, alliance), opinion, trade agreements, sanctions, AI-initiated offers |
| Modes | 5-mission campaign, skirmish, conquest, survival, defensive, peacekeeping, urban evacuation, resource competition, reconstruction, sandbox |
| Interface | Resource bar with rates, build sidebar with queues, selection and command panel, settlement panel with evacuation/aid/trade/rebuild, diplomacy and civil-affairs windows, objectives, ticker, pause and 4 speeds, save/load (3 slots + autosave + text export), rebindable keys, touch controls |

### Not in this checkpoint yet
- A scenario/map editor UI (the map format and `MapGen.blank()` are ready for it).
- Hand-made art and recorded audio (the replacement hooks below are ready).
- Unit and building sizes stay fixed in tiles whatever the map scale, so on planetary maps only strategic play makes sense.
- Pathfinding is per-unit tile A* with smoothing; very large battles (300+ units moving at once) can queue paths for a moment.

## Controls

| Action | Input |
|---|---|
| Select / box-select / add | Left-click / drag / Shift |
| Context order (move, attack, board, capture, repair, harvest, aid, clear) | Right-click |
| Force fire, including ground | Ctrl + right-click |
| Queue waypoints | Shift + right-click |
| Attack-move · stop · guard · patrol · fire at | A · S · G · Q · T |
| Scatter · formation · retreat · unload · aircraft home | X · F · R · U · B |
| Groups | Ctrl+1–9 assign, 1–9 select, double-tap to jump |
| Camera | Arrows, screen edge, middle- or right-drag, wheel zoom, minimap |
| Pause · speed | P · = and - |

All of these can be rebound in Settings.

## Architecture

Plain scripts loaded in order, all sharing the `G` state object:

```
js/core.js     constants, math, seeded RNG + noise, spatial grid, pools, heap, event bus, base64
js/data.js     factions, weapons, warheads, units, buildings, civilian buildings, research  ← tuning
js/sprites.js  procedural sprite atlas + art replacement hooks
js/earthdata.js  embedded land mask (0.05°)
js/geodata.js  embedded country raster (0.1°, Natural Earth) and real cities (GeoNames)
js/earth.js    Earth lookups (land, climate, countries, cities), world picker with drag-to-select regions
js/map.js      world generator (terrain, rivers, real or generated towns, roads, rail, resources, borders)
js/strike.js   missiles, interception, nuclear blasts, mushroom clouds, radioactive fallout
js/path.js     A* pathfinding, smoothing, request queue, connectivity
js/fx.js       particles, lights, decals
js/world.js    entities, visibility, combat, projectiles, aircraft, abilities, orders
js/civ.js      settlements, population, services, traffic, emergency services, evacuation
js/eco.js      factions, resources, power, production, research, upgrades
js/ai.js       faction AI and diplomacy
js/render.js   terrain chunks, entities, fog, lighting, weather, minimap
js/audio.js    synthesised WebAudio sound
js/game.js     clock, weather, modes, objectives, main loop, save/load
js/ui.js       input, camera, panels, windows, menu
```

The simulation runs at a fixed 30 Hz step independent of frame rate; `Game.sim(dt)` can be called headlessly for testing.

### Adding content
- **A unit**: add an entry to `UNITS` in `data.js` (stats, weapons, cost, producer category). Add a `case` to the right `draw*` function in `sprites.js`, or supply art (below). It appears in the sidebar automatically.
- **A building**: add to `BLDS` and to `BUILD_ORDER_UI`, then a `case` in `drawMil`.
- **A civilian building**: add to `CIVB`; give `layoutTown()` in `map.js` a reason to place it.
- **A weapon**: add to `WEAPONS`; warhead multipliers live in `WH`.
- **A mode**: add to `MODES` and a `case` in `Modes.setup` / `Modes.tick` in `game.js`.

### Replacing placeholder art and sound
Before the game boots (top of the inline script in `index.html`):

```js
SPR.overrides['unit:mbt']   = 'assets/mbt.png';    // top-down, nose pointing right
SPR.overrides['bld:power']  = 'assets/power.png';  // footprint w×32 by h×32 px
SPR.overrides['civ:house']  = 'assets/house.png';
Sound.files['cannon']       = 'assets/cannon.ogg';
```

Any key without an override keeps its procedural version, so art can be swapped in one asset at a time.
