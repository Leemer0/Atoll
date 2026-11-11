# Kessler Atoll

An original browser RTS: up to eight Builders (Humans, Aliens, Robots) fortify pockets of a
sunset island while one player-controlled Titan hunts them. Builders taken by the Titan return
as husks on its side.

- `src/00-head.html` – page head, CSS, HUD markup
- `src/01-core.js` – data tables (factions, structures, Titans) and the island generator
- `src/02-sim.js` – authoritative 30 Hz simulation (pathfinding, economy, combat, bots)
- `src/03-net.js` – host-authoritative multiplayer over a room channel
- `src/04-render.js` – three.js r128 presentation, fog of war, minimap
- `src/05-ui.js` – input, HUD, screens, developer panel

`./build.sh` concatenates the sources into a single `index.html`.
Open the dev panel in game with the backquote key.
