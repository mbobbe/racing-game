# Forest Canyon — Endless Free-Race Racer

A high-fidelity 3D racing game for the browser. You drive a purple GT supercar (GT-R style: wide body, low raked cabin, big rear wing,
round lamps, twin exhausts) through a
canyon carved through the forest while eight AI opponents race with you. Boost pads light up
on the straights; hitting one triggers a speed burst. Endless mode — no finish panel, no leaderboard.

## Quick start

[Play Forest Canyon in your browser](https://mbobbe.github.io/racing-game/).

To run the game locally, open a terminal in the repository folder and start a server with Python 3.

```bash
python3 -m http.server 8899 --bind 127.0.0.1
# then open http://127.0.0.1:8899/ in your browser
```

That's it. The vendored Three.js (`vendor/three.module.js`) is already included, so the game
works offline from the static server. No build step, no package.json, no install.

## Controls

| Input | Action |
| ----- | ------ |
| W / ↑ | Throttle |
| S / ↓ | Brake / reverse |
| A, D / ←, → | Steer |
| Shift / DRIFT button | Handbrake (drift) |
| R | Reset to track |
| P | Pause / resume |
| M | Mute / unmute |
| Esc | Pause |
| Touch | GAS + DRIFT buttons (left edge, left thumb — release GAS to brake) + L/R steering (bottom right, right thumb) |

## What's inside

- Endless free-race, 9 cars (1 player + 8 AI), live position (P1–P9), lap counter.
- Hybrid arcade + realistic weight physics: speed-sensitive steering, lateral-grip model,
  handbrake drift, canyon-wall clamp with bounce, banking/slope mesh orientation.
- Canyon loop: closed spline with banked asphalt, dirt shoulders, rock walls, forested slopes,
  valley floor, distant mountains, sun + sky, fog.
- 6 boost pads on the straights (pulsing chevrons), each granting a speed burst + FOV kick + vignette flash.
- Effects: additive sparks (wall hits), dust (drift/off-road), per-car fading skid marks,
  drift hiss + engine/wind/boost/thud synthesized in WebAudio (no audio files).
- HUD: speed (km/h), live position, lap, drift meter, 2D canvas minimap, mute/pause/restart
  buttons, title screen with 3-2-1-GO countdown.

## Project layout

```
index.html      entry point + HUD DOM + title screen
style.css       HUD, overlay, buttons, animations
js/util.js      math helpers (damp, clamp, wrapAngle, smoothing)
js/input.js     keyboard + touch state (one-shot edge events)
js/car.js       car mesh builder + hybrid drive physics (body-frame velocity split, grip model)
js/ai.js        opponent brains (spline-follow, curvature speed limits, rubber-banding)
js/track.js     world build — closed spline, banked road ribbon, canyon walls, trees/rocks,
                mountains, sky, fog, start line, boost pads (single buildWorld(scene) export)
js/effects.js   additive spark particles, dust particles, per-car fading skid-mark ribbons
js/audio.js     WebAudio-synthesized engine/wind/drift/boost/thud/beeps
js/hud.js       speed/position/lap/drift readouts + 2D canvas minimap
js/main.js      bootstrap, chase camera, state machine, game loop
vendor/three.module.js   vendored Three.js r166 (offline dependency)
```

Deliberately excluded (not part of the game): multiple tracks/track select, lap timing or a
leaderboard, day/night dynamic lighting, garage/car customization.
