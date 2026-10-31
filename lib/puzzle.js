// Puzzle identity and solution checks shared by the API.
// A puzzle is its painted shape plus the piece counts. Shapes are compared
// after trimming to their bounding box and trying all four rotations, so the
// same board seen from another side gets the same key.

export const PIECES = {
  T: [[0,0],[0,1],[0,2],[1,1]],
  O: [[0,0],[0,1],[1,0],[1,1]],
  L: [[0,0],[1,0],[2,0],[2,1]],
  J: [[0,1],[1,1],[2,1],[2,0]],
  S: [[0,1],[0,2],[1,0],[1,1]],
  Z: [[0,0],[0,1],[1,1],[1,2]],
  I: [[0,0],[1,0],[2,0],[3,0]],
};
export const KINDS = Object.keys(PIECES);
const MAX_SIDE = 16;

// Clockwise quarter turn of cells inside an h-row box; the result is w rows by h columns.
const rot = (cells, h) => cells.map(([r, c]) => [c, h - 1 - r]);

function rotateTimes(cells, h, w, t) {
  for (let i = 0; i < t; i++) { cells = rot(cells, h); [h, w] = [w, h]; }
  return { cells, h, w };
}

function shapeHex(cells, h, w) {
  const bits = new Array(h * w).fill(0);
  for (const [r, c] of cells) bits[r * w + c] = 1;
  while (bits.length % 4) bits.push(0);
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  return hex;
}

export function hexToCells(hex, h, w) {
  const cells = [];
  for (let i = 0; i < h * w; i++) {
    const nib = parseInt(hex[i >> 2], 16);
    if ((nib >> (3 - (i & 3))) & 1) cells.push([(i / w) | 0, i % w]);
  }
  return cells;
}

export const countsKey = counts => KINDS.map(k => k + (counts[k] | 0)).join('');

export function readInput(body) {
  const W = body.W | 0, H = body.H | 0;
  if (W < 1 || H < 1 || W > MAX_SIDE || H > MAX_SIDE) throw new Error('Grid must be 1–16 squares per side.');
  if (!Array.isArray(body.on) || body.on.length !== W * H) throw new Error('Painted squares do not match the grid size.');
  const counts = {};
  for (const k of KINDS) {
    const n = body.counts?.[k] | 0;
    if (n < 0 || n > 64) throw new Error('Piece counts must be 0–64.');
    counts[k] = n;
  }
  const on = body.on.map(Boolean);
  if (!on.some(Boolean)) throw new Error('Nothing is painted.');
  return { W, H, on, counts };
}

// Returns the canonical key plus what is needed to map cells between the
// caller's grid and the canonical frame.
export function canonicalize({ W, H, on, counts }) {
  const pts = [];
  for (let i = 0; i < W * H; i++) if (on[i]) pts.push([(i / W) | 0, i % W]);
  const minR = Math.min(...pts.map(p => p[0])), minC = Math.min(...pts.map(p => p[1]));
  const h0 = Math.max(...pts.map(p => p[0])) - minR + 1, w0 = Math.max(...pts.map(p => p[1])) - minC + 1;
  const rel = pts.map(([r, c]) => [r - minR, c - minC]);
  let best = null;
  for (let t = 0; t < 4; t++) {
    const { h, w, cells } = rotateTimes(rel, h0, w0, t);
    const id = `${h}x${w}:${shapeHex(cells, h, w)}`;
    if (!best || id < best.id) best = { id, t, h, w, hex: shapeHex(cells, h, w) };
  }
  return {
    key: `${best.id}|${countsKey(counts)}`,
    shape: { h: best.h, w: best.w, hex: best.hex },
    t: best.t, minR, minC, h0, w0, W,
  };
}

export function toCanonical(frame, idx) {
  const cells = idx.map(i => [((i / frame.W) | 0) - frame.minR, (i % frame.W) - frame.minC]);
  return rotateTimes(cells, frame.h0, frame.w0, frame.t).cells;
}

export function fromCanonical(frame, cells) {
  const back = rotateTimes(cells, frame.shape.h, frame.shape.w, (4 - frame.t) % 4).cells;
  return back.map(([r, c]) => (r + frame.minR) * frame.W + (c + frame.minC));
}

const norm = cells => {
  const s = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return JSON.stringify(s.map(([r, c]) => [r - s[0][0], c - s[0][1]]));
};
const ROTATIONS = Object.fromEntries(KINDS.map(k => {
  const set = new Set();
  let cells = PIECES[k];
  for (let t = 0; t < 4; t++) { cells = cells.map(([r, c]) => [c, -r]); set.add(norm(cells)); }
  return [k, set];
}));

// Throws unless `placed` covers exactly the painted squares using the given pieces.
export function checkSolution({ W, H, on, counts }, placed) {
  if (!Array.isArray(placed)) throw new Error('Missing solution.');
  const used = new Uint8Array(W * H), left = { ...counts };
  for (const p of placed) {
    if (!KINDS.includes(p?.k) || !Array.isArray(p.idx) || p.idx.length !== 4) throw new Error('Bad piece in solution.');
    if (--left[p.k] < 0) throw new Error(`Solution uses more ${p.k} pieces than given.`);
    const cells = p.idx.map(i => {
      if (!Number.isInteger(i) || i < 0 || i >= W * H || !on[i] || used[i]) throw new Error('Solution places a piece off the area or on top of another.');
      used[i] = 1;
      return [(i / W) | 0, i % W];
    });
    if (!ROTATIONS[p.k].has(norm(cells))) throw new Error(`A ${p.k} piece has the wrong shape.`);
  }
  for (let i = 0; i < W * H; i++) if (on[i] && !used[i]) throw new Error('Solution leaves squares uncovered.');
}
