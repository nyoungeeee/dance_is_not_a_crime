// Source-image coordinates. Use separated figures so their neighbours stay still.
const regions = {
  back: [[248,27,76,117],[377,59,59,115],[553,81,69,130],[630,42,70,112],[696,104,96,114],[461,118,75,97],[786,30,80,107],[943,25,64,114]],
  front: [[174,266,71,73],[180,406,91,71],[994,308,74,93],[988,406,74,71]]
};
// Bounds include every glyph stroke and black padding, while stopping before adjacent glyphs.
const textRegions = [[289,325,74,96],[365,325,74,96],[454,325,74,96],[529,325,72,96],[605,325,73,96],[694,325,76,96],[773,325,69,96],[845,325,77,96]];
const states = new Map();
function attachFigures() {
  for (const [crop, state] of states) if (!crop.isConnected) {
    clearState(state);
    states.delete(crop);
  }
  document.querySelectorAll('.towel-crop').forEach(crop => {
    if (states.has(crop)) return;
    const side = crop.classList.contains('back') ? 'back' : 'front';
    const layer = document.createElement('span');
    layer.className = 'skeleton-layer';
    layer.setAttribute('aria-hidden', 'true');
    const makePiece = ([x,y,width,height]) => {
      const slot = document.createElement('span');
      slot.className = 'skeleton-slot';
      Object.assign(slot.style, {
        left:`${x / 1206 * 100}%`, top:`${y / 508 * 100}%`,
        width:`${width / 1206 * 100}%`, height:`${height / 508 * 100}%`
      });
      const piece = document.createElement('span');
      piece.className = 'skeleton-piece';
      Object.assign(piece.style, {
        backgroundImage:'url("/assets/slogan.png")',
        backgroundSize:`${1206 / width * 100}% ${508 / height * 100}%`,
        backgroundPosition:`${x / (1206 - width) * 100}% ${y / (508 - height) * 100}%`
      });
      slot.append(piece);
      layer.append(slot);
      return piece;
    };
    const pieces = regions[side].map(makePiece);
    const textPieces = side === 'front' ? textRegions.map(makePiece) : [];
    states.set(crop, {pieces, textPieces, active:null, activeText:null, previous:null, previousText:null, timer:null, textTimer:null});
    crop.append(layer);
  });
}
function clearState(state) {
  clearTimeout(state.timer);
  state.active?.classList.remove('skeleton-hop','skeleton-sway');
  state.active = null;
  clearTimeout(state.textTimer);
  state.activeText?.classList.remove('skeleton-hop');
  state.activeText = null;
}
export function clearSkeletons() {
  for (const state of states.values()) clearState(state);
}
export function jumpSkeletons(bpm) {
  const duration = Math.min(380, Math.max(220, 60000 / bpm * .6));
  for (const [crop, state] of states) {
    clearState(state);
    const bounds = crop.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight || bounds.width === 0) continue;
    const candidates = state.pieces.filter(piece => piece !== state.previous);
    state.active = candidates[Math.floor(Math.random() * candidates.length)];
    state.previous = state.active;
    state.active.style.setProperty('--skeleton-duration', `${duration}ms`);
    state.active.classList.add(Math.random() < .7 ? 'skeleton-hop' : 'skeleton-sway');
    state.timer = setTimeout(() => clearState(state), duration);
    if (state.textPieces.length) {
      const letters = state.textPieces.filter(piece => piece !== state.previousText);
      state.activeText = letters[Math.floor(Math.random() * letters.length)];
      state.previousText = state.activeText;
      state.activeText.style.setProperty('--skeleton-duration', `${duration}ms`);
      state.activeText.classList.add('skeleton-hop');
    }
  }
}
attachFigures();
// The design dialog is inserted on demand; it uses the same one-figure-per-side rule.
new MutationObserver(attachFigures).observe(document.body, {childList:true,subtree:true});
