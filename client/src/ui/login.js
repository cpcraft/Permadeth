// This file only controls the overlay and hands off a JOIN to your existing network.
// Assumes your Pixi app mounts into #game and your code creates the WS connection on first JOIN.

const overlay = document.getElementById('login-overlay');
const form = document.getElementById('login-form');
const nameEl = document.getElementById('name');
const colorEl = document.getElementById('color');
const btn = document.getElementById('login-btn');
const err = document.getElementById('login-error');

function setCanvasInputEnabled(enabled) {
  // While overlay is visible, block canvas from eating clicks
  const game = document.getElementById('game');
  if (!game) return;
  // Canvas is first child of #game
  const canvas = game.querySelector('canvas');
  if (!canvas) return;

  canvas.style.pointerEvents = enabled ? 'auto' : 'none';
}

// On first paint, block the canvas (overlay visible)
requestAnimationFrame(() => setCanvasInputEnabled(false));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const name = (nameEl.value || '').trim();
  const color = (colorEl.value || '#59c2ff').trim();

  if (!name) { err.textContent = 'Enter a name'; return; }

  btn.disabled = true;

  try {
    // Let your existing client code listen for this custom DOM event
    // so we don't couple files. In main.js, listen for 'PD_JOIN' and open WS.
    const detail = { name, color };
    window.dispatchEvent(new CustomEvent('PD_JOIN', { detail }));

    // Hide overlay and re-enable canvas input
    overlay.classList.add('hidden');
    setCanvasInputEnabled(true);
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Failed to connect.';
    btn.disabled = false;
    setCanvasInputEnabled(false);
  }
});
