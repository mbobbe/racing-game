// Keyboard + touch input state. Emits a mutable state object that the game loop reads.
// Steering convention: positive steer = heading increases = car turns toward the
// driver's LEFT / world +X (camera-behind view: screen LEFT). The right key maps
// to -1 so that pressing D turns screen-right. This matches how AI steering
// feeds stepCar (aim-ahead, +err = desired heading is higher = driver's left).

import { clamp } from './util.js';

export function createInput() {
  const state = {
    throttle: 0,   // 0..1
    brake: 0,      // 0..1
    steer: 0,      // -1 (left) .. +1 (right)
    handbrake: false,
    justPressed: {}, // one-shot edge events, consumed by the game loop
  };

  const keys = new Set();
  let touchSteerL = false, touchSteerR = false, touchThrottle = false, touchBrake = false, touchHandbrake = false;
  let touchStart = null;

  function onKey(down, code) {
    const isDown = down;
    switch (code) {
      case 'KeyW': case 'ArrowUp':
        down ? keys.add('throttle') : keys.delete('throttle'); break;
      case 'KeyS': case 'ArrowDown':
        down ? keys.add('brake') : keys.delete('brake'); break;
      case 'KeyA': case 'ArrowLeft':
        down ? keys.add('left') : keys.delete('left'); break;
      case 'KeyD': case 'ArrowRight':
        down ? keys.add('right') : keys.delete('right'); break;
      case 'ShiftLeft': case 'ShiftRight':
        down ? keys.add('handbrake') : keys.delete('handbrake'); break;
      case 'KeyR':
        if (down) state.justPressed['restart'] = true; break;
      case 'KeyP': case 'Escape':
        if (down) state.justPressed['pause'] = true; break;
      case 'KeyM':
        if (down) state.justPressed['mute'] = true; break;
      case 'Space':
        if (down) state.justPressed['any'] = true; break;
      default:
        if (down) state.justPressed['any'] = true; break;
    }
    if (isDown && (code === 'Space' || code === 'Enter' || code === 'NumpadEnter')) state.justPressed['start'] = true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat === false) onKey(true, e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  }, { passive: false });

  window.addEventListener('keyup', (e) => onKey(false, e.code));

  function bindTouchButton(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); handler(true); };
    const off = (e) => { e.preventDefault(); handler(false); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  bindTouchButton('touch-left', (v) => { touchSteerL = v; });
  bindTouchButton('touch-right', (v) => { touchSteerR = v; });
  bindTouchButton('touch-throttle', (v) => { touchThrottle = v; });
  bindTouchButton('touch-brake', (v) => { touchBrake = v; });
  bindTouchButton('touch-handbrake', (v) => { touchHandbrake = v; });

  // First touch anywhere also counts as a start gesture.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      state.justPressed['any'] = true;
      state.justPressed['start'] = true;
    }
  }, { passive: true });

  function update(touchLayoutVisible) {
    const left = keys.has('left') || touchSteerL;
    const right = keys.has('right') || touchSteerR;
    state.steer = (left ? 1 : 0) - (right ? 1 : 0);
    state.throttle = (keys.has('throttle') || touchThrottle) ? 1 : 0;
    state.brake = (keys.has('brake') || touchBrake) ? 1 : 0;
    state.handbrake = keys.has('handbrake') || touchHandbrake;

    // touch device detection (once + on resize)
    if (state._touchCheck !== touchLayoutVisible) {
      state._touchCheck = touchLayoutVisible;
    }
    return state;
  }

  function consumeJustPressed() {
    const j = Object.assign({}, state.justPressed);
    state.justPressed = {};
    return j;
  }

  return { state, update, consumeJustPressed };
}
