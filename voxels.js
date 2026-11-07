// The page's background: the README banner's voxel columns, drawn at low resolution and scaled up
// without smoothing. Each section names a scene, a function from a column to how it should look;
// scrolling blends one scene into the next, one column at a time. Columns stay put unless the
// cursor or a wave moves them, so a page nobody touches draws nothing.
(function () {
  "use strict";

  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d", { alpha: false });

  const SEAM = [20, 22, 30], DEEP = [26, 30, 40];
  const TOP = [70, 80, 100], LEFT = [52, 60, 78], RIGHT = [38, 44, 58];
  const A1 = [170, 104, 30], A2 = [224, 150, 50], A3 = [255, 196, 87];
  const pack = (r, g, b) => (255 << 24 | b << 16 | g << 8 | r) >>> 0;
  const SEAM_PX = pack(...SEAM);

  // Same block as the banner: top diamond R wide each way, a rank down the screen every RANK.
  const R = 10, RANK = 10, UNIT = 5, VOXEL = 10;
  const WAVE_SPEED = 240;
  // A seam only marks a real drop behind a column, where its top would otherwise melt into the tops
  // behind it. On smaller steps the side faces already show the edge and a line reads as a crack.
  const SEAM_STEP = 15;
  const MAX_H = 34;

  let W = 0, H = 0, pixel = 4, fb, img, cols = 0, ranks = 0;
  let dpr = 1;
  // Which column's top owns each pixel, so a dash of thread can tell if something covers it.
  let owner, dashes = [];
  // Raised height of each column in the row behind and this one, for the seams.
  let backRow, thisRow;

  const hash = (a, b) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const clamp = (t, a = 0, b = 1) => t < a ? a : t > b ? b : t;
  const mod = (x, m) => ((x % m) + m) % m;

  function noise(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const u = smooth(x - i), v = smooth(y - j);
    const p = hash(i, j), q = hash(i + 1, j), r = hash(i, j + 1), s = hash(i + 1, j + 1);
    return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
  }

  // What a scene fills in for one column.
  const blank = () => ({ h: 0, tone: 1, amber: 0, thread: 0, cross: 0, crop: 0, lr: 0, lg: 0, lb: 0 });
  const reset = o => { o.h = 0; o.tone = 1; o.amber = 0; o.thread = 0; o.cross = 0; o.crop = 0; o.lr = 0; o.lg = 0; o.lb = 0; };

  // Colored light falls off one level per block like in the game, and overlapping lamps mix.
  const LAMPS = [[1, .62, .2], [.25, .75, 1], [1, .3, .55], [.45, 1, .5]];

  const scenes = {
    // The banner itself.
    banner(a, b, s, T, o) {
      o.h = 2 + Math.round(1.1 * Math.sin(a * .31) + 1.1 * Math.sin(b * .37));
      o.thread = mod(a, 6) === 0 ? 1 : 0;
    },
    // Terrain with real height to it: no floor and no ceiling.
    deep(a, b, s, T, o) {
      const n = noise(a * .075, b * .075) * .75 + noise(a * .21 + 9, b * .21) * .25;
      const spire = hash(a * 3, b) > .975 ? 6 : 0;
      // Whole blocks only: half steps on a slope alias into a shimmer.
      o.h = Math.round(Math.pow(clamp(n * 1.3 - .12), 2.2) * 15 + spire) * 2;
      o.tone = .66 + o.h / 80;
      o.thread = mod(a, 18) === 0 ? .8 : 0;
    },
    // Fields in patches, row by row, each ripening on its own time.
    grow(a, b, s, T, o) {
      const rx = Math.floor(a / 7), ry = Math.floor(b / 7);
      o.h = 2 + Math.floor(hash(rx + 50, ry) * 3) * 2;
      o.tone = .7;
      if (hash(rx, ry) < .6 && mod(a, 2) === 0 && mod(a, 7) !== 6 && mod(b, 7) !== 6) {
        const cycle = mod(T * .3 + hash(rx, ry) * 9, 3) / 3;
        o.crop = cycle > .92 ? 0 : clamp(cycle * 1.25);
      }
    },
    // Two plots joined by one thread. Fixed in the world where its section sits, not on the screen,
    // and sized to fit whole in the room beside the text.
    link(a, b, s, T, o) {
      o.h = 1 + Math.round(noise(a * .2, b * .2) * 2);
      o.tone = .62;
      // A mesa's top reaches a few ranks above its footprint, so that much height isn't room.
      const room = Math.min(s.free, s.ranks - 6);
      const r = room >= 20 ? 2 : 1;
      const apart = Math.min(8, Math.floor((room - 4 * r) / 2));
      if (apart < 3) return;
      const rank = Math.round(s.mid + 2.4);
      const a0 = Math.round((rank + s.center) / 2), b0 = rank - a0;
      const onLine = Math.abs(a - a0) <= r;
      if (onLine && (Math.abs(b - b0 + apart) <= r || Math.abs(b - b0 - apart) <= r)) {
        o.h = 8;
        o.tone = 1;
      } else if (a === a0 && Math.abs(b - b0) < apart - r) {
        o.amber = mod(b - T * 9, 14) < 3 ? .9 : .6;
      }
    },
    // Night, lamps, and light levels you can count by the block.
    light(a, b, s, T, o) {
      o.h = 1 + Math.floor(noise(a * .1, b * .1) * 5);
      o.tone = .24;
      const cell = 10, ci = Math.floor(a / cell), cj = Math.floor(b / cell);
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          const x = i * cell + Math.floor(hash(i, j) * cell), y = j * cell + Math.floor(hash(j, i + 7) * cell);
          const d = Math.abs(a - x) + Math.abs(b - y);
          if (d > 14) continue;
          const c = LAMPS[Math.floor(hash(i + 3, j) * LAMPS.length)];
          const f = (15 - d) / 15;
          const l = f * f;
          o.lr += c[0] * l; o.lg += c[1] * l; o.lb += c[2] * l;
          if (d === 0) { o.h += 3; o.lr += c[0]; o.lg += c[1]; o.lb += c[2]; }
        }
      }
    },
    // A base layer with mods standing on it.
    layers(a, b, s, T, o) {
      const p = noise(a * .1, b * .1), q = noise(a * .1 + 40, b * .1);
      const one = p > .52, two = q > .7;
      o.h = 2 + (one ? 6 : 0) + (two ? 6 : 0);
      o.tone = one || two ? 1 : .62;
      if (two && mod(a, 3) === 0) o.thread = 1;
    },
    // Warp and weft: threads along both axes.
    threads(a, b, s, T, o) {
      o.h = 2 + (mod(a, 3) === 0 ? 1 : 0) + (mod(b, 3) === 0 ? 1 : 0);
      o.tone = .76;
      if (mod(a, 6) === 0) o.thread = mod(b + a * 2, 24) < 9 ? 1 : .5;
      if (mod(b, 6) === 0) o.cross = mod(a + b, 24) < 9 ? 1 : .5;
    },
    // F3+T: calm ground for the wave site.js sends across it when the section comes up.
    ripple(a, b, s, T, o) {
      o.h = 2 + Math.round(noise(a * .14, b * .14) * 2);
      o.tone = .7;
    },
  };
  // The two scenes where the movement is the point: crops ripening and a signal along the thread.
  const LIVING = new Set([scenes.grow, scenes.link]);

  const state = { cols: 0, ranks: 0, mid: 0, free: 0, center: 0 };
  let sceneA = scenes.banner, sceneB = null, sceneMix = 0, anchorA = null, anchorB = null;
  let rects = [];
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, on: false, lift: 0 };
  const waves = [];
  let lastT = 0;
  const oa = blank(), ob = blank(), oc = blank();

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    pixel = Math.max(1, Math.round((vw >= 1080 ? 4 : 3) * dpr));
    W = Math.ceil(vw * dpr / pixel);
    H = Math.ceil(vh * dpr / pixel);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W * pixel / dpr + "px";
    canvas.style.height = H * pixel / dpr + "px";
    img = ctx.createImageData(W, H);
    fb = new Uint32Array(img.data.buffer);
    owner = new Int32Array(W * H);
    cols = Math.ceil(W / 2 / R) + 2;
    ranks = Math.ceil(H / RANK) + Math.ceil(MAX_H * UNIT / RANK) + 4;
    state.cols = cols;
    state.ranks = H / RANK;
    backRow = new Int16Array(cols * 2 + 8);
    thisRow = new Int16Array(cols * 2 + 8);
  }

  function column(id, cx, ty, sideH, topC, leftC, rightC, seamLeft, seamRight, crop, t, tone) {
    const xl = Math.max(0, cx - R), xr = Math.min(W, cx + R);
    // Sides in one piece however tall, with the seam only along the foot.
    for (let x = xl; x < xr; x++) {
      const isLeft = x < cx;
      const y0 = ty + (R >> 1) + (isLeft ? (x - (cx - R)) >> 1 : (cx + R - 1 - x) >> 1);
      const foot = y0 + sideH;
      const yEnd = Math.min(H, foot);
      const side = isLeft ? leftC : rightC;
      for (let y = Math.max(0, y0); y < yEnd; y++) { fb[y * W + x] = side; owner[y * W + x] = 0; }
      if (foot >= 0 && foot < H) { fb[foot * W + x] = SEAM_PX; owner[foot * W + x] = 0; }
    }
    // Top diamond.
    const half = R >> 1;
    for (let row = 0; row < R; row++) {
      const y = ty + row;
      if (y < 0 || y >= H) continue;
      const span = row < half ? (row + 1) * 2 : (R - row) * 2;
      const a = Math.max(0, cx - span), b = Math.min(W, cx + span);
      for (let x = a; x < b; x++) { fb[y * W + x] = topC; owner[y * W + x] = id; }
    }
    // Top edges keep the seam color at any light, and only show where the height changes.
    for (let off = 0; off < R; off++) {
      const y = ty + half - 1 - (off >> 1);
      if (y < 0 || y >= H) continue;
      const x1 = cx - R + off, x2 = cx + R - 1 - off;
      if (seamLeft && x1 >= 0 && x1 < W) fb[y * W + x1] = SEAM_PX;
      if (seamRight && x2 >= 0 && x2 < W) fb[y * W + x2] = SEAM_PX;
    }
    if (crop > 0) drawCrop(cx, ty, crop, t * tone);
  }

  // The banner's dash across a top. Drawn after everything, and only if something in front leaves
  // nearly all of it showing: a clipped dash is just a stray triangle.
  function dash(id, cx, ty, amount, t, sign) {
    let total = 0, seen = 0;
    const half = R >> 1;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1 && seen < total * .8) return;
      const c = threadColor(amount, t);
      for (let row = 0; row < R; row++) {
        const y = ty + row;
        if (y < 0 || y >= H) continue;
        const span = row < half ? (row + 1) * 2 : (R - row) * 2;
        const a = Math.max(0, cx - span), b = Math.min(W, cx + span);
        for (let x = a; x < b; x++) {
          if (Math.abs((x - cx) / 2 + sign * (row - R / 2 + .5)) >= 1.6) continue;
          const mine = owner[y * W + x] === id;
          if (pass === 0) { total++; if (mine) seen++; } else if (mine) fb[y * W + x] = c;
        }
      }
    }
  }

  const threadCache = new Map();
  function threadColor(amount, t) {
    const key = Math.round(amount * 8) * 64 + Math.round(t * 32);
    let c = threadCache.get(key);
    if (c === undefined) {
      const k = amount * t;
      c = pack(
        DEEP[0] + (A3[0] - DEEP[0]) * k | 0,
        DEEP[1] + (A3[1] - DEEP[1]) * k | 0,
        DEEP[2] + (A3[2] - DEEP[2]) * k | 0);
      threadCache.set(key, c);
    }
    return c;
  }

  const STALKS = [[-6, 5], [-3, 3], [-3, 7], [0, 1], [0, 5], [0, 9], [3, 3], [3, 7], [6, 5]];
  function drawCrop(cx, ty, crop, t) {
    const n = Math.round(crop * 8);
    if (n === 0) return;
    const ripe = n >= 8;
    const body = shade(ripe ? A2 : A1, t), head = shade(ripe ? A3 : A2, t);
    for (const s of STALKS) {
      const x = cx + s[0];
      if (x < 0 || x >= W) continue;
      for (let i = 0; i < n; i++) {
        const y = ty + s[1] - i;
        if (y >= 0 && y < H) fb[y * W + x] = i === n - 1 ? head : body;
      }
    }
  }

  function shade(c, t) {
    return pack(DEEP[0] + (c[0] - DEEP[0]) * t | 0, DEEP[1] + (c[1] - DEEP[1]) * t | 0, DEEP[2] + (c[2] - DEEP[2]) * t | 0);
  }

  function lit(c, o, t, k) {
    // Tone first, then colored light on top of it, then the clearing around text.
    let r = c[0] * o.tone, g = c[1] * o.tone, b = c[2] * o.tone;
    if (o.amber > 0) {
      const tgt = k > .7 ? A2 : A1;
      r += (tgt[0] - r) * o.amber; g += (tgt[1] - g) * o.amber; b += (tgt[2] - b) * o.amber;
    }
    const L = 190;
    r += o.lr * L * k; g += o.lg * L * k; b += o.lb * L * k;
    r = DEEP[0] + (r - DEEP[0]) * t;
    g = DEEP[1] + (g - DEEP[1]) * t;
    b = DEEP[2] + (b - DEEP[2]) * t;
    return pack(r > 255 ? 255 : r | 0, g > 255 ? 255 : g | 0, b > 255 ? 255 : b | 0);
  }

  function clearing(x, y) {
    const floor = W < 160 ? .2 : .08;
    let best = 1e9;
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      const dx = x < q.l ? q.l - x : x > q.r ? x - q.r : 0;
      const dy = y < q.t ? q.t - y : y > q.b ? y - q.b : 0;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    // As in the banner: nearly gone behind text, full strength a little way out.
    // On a phone text fills the screen, so the clearing has to hug it or no columns would remain.
    const t = (Math.sqrt(best) - 3) / Math.min(40, W * .13);
    return t < 0 ? floor : t > 1 ? 1 : t * t * (3 - 2 * t) * (1 - floor) + floor;
  }

  // Where a section's scene is laid out: the middle rank when the section is centered on screen,
  // and the columns left free right of its text.
  function place(anchor) {
    if (!anchor) return null;
    const k = dpr / pixel;
    const left = (anchor.right * k - (W >> 1)) / R + 2, right = (W >> 1) / R - 1;
    return {
      mid: Math.floor(anchor.y * k * .35 / RANK) + H / RANK / 2,
      free: right - left,
      center: Math.round((left + right) / 2),
    };
  }

  function usePlace(p) {
    if (p) { state.mid = p.mid; state.free = p.free; state.center = p.center; }
  }

  function render(T) {
    fb.fill(SEAM_PX);
    const scroll = window.scrollY * dpr / pixel * .35;
    const base = Math.floor(scroll / RANK);
    const frac = Math.round(scroll - base * RANK);
    const top = -Math.ceil(R / RANK) - 1;
    const placeA = place(anchorA), placeB = place(anchorB);

    // Eased by time, so the rise and fall feel the same at any frame rate.
    const ease = 1 - Math.exp(-clamp(T - lastT, 0, .1) * 8);
    lastT = T;
    pointer.sx += (pointer.x - pointer.sx) * ease;
    pointer.sy += (pointer.y - pointer.sy) * ease;
    pointer.lift += ((pointer.on ? 1 : 0) - pointer.lift) * ease;
    const lifting = pointer.lift > .004;
    owner.fill(0);
    dashes.length = 0;
    let id = 0, firstRow = true;

    for (let sr = top; sr < ranks; sr++) {
      const rank = sr + base;
      const cy = sr * RANK - frac;
      const swap = backRow; backRow = thisRow; thisRow = swap;
      for (let col = -cols - ((rank & 1) === (cols & 1) ? 0 : 1); col <= cols; col += 2) {
        const a = (rank + col) / 2, b = (rank - col) / 2;
        const cx = (W >> 1) + col * R;

        reset(oa);
        usePlace(placeA);
        sceneA(a, b, state, T, oa);
        let o = oa;
        if (sceneB && sceneMix > 0) {
          // Each column turns over at its own moment, so scenes dissolve instead of cross-fading.
          const m = smooth(clamp(sceneMix * 1.6 - hash(a, b) * .6));
          if (m > 0) {
            reset(ob);
            usePlace(placeB);
            sceneB(a, b, state, T, ob);
            oc.h = oa.h + (ob.h - oa.h) * m;
            oc.tone = oa.tone + (ob.tone - oa.tone) * m;
            oc.amber = oa.amber + (ob.amber - oa.amber) * m;
            oc.thread = m < .5 ? oa.thread : ob.thread;
            oc.cross = m < .5 ? oa.cross : ob.cross;
            oc.crop = oa.crop + (ob.crop - oa.crop) * m;
            oc.lr = oa.lr + (ob.lr - oa.lr) * m;
            oc.lg = oa.lg + (ob.lg - oa.lg) * m;
            oc.lb = oa.lb + (ob.lb - oa.lb) * m;
            o = oc;
          }
        }

        let h = o.h;
        if (lifting) {
          const dx = cx - pointer.sx, dy = cy - pointer.sy;
          const dp = dx * dx + dy * dy * 1.4;
          if (dp < 4900) h += 5 * pointer.lift * Math.exp(-dp / 900);
        }
        for (let i = 0; i < waves.length; i++) {
          const w = waves[i];
          const d = Math.hypot(cx - w.x, cy - w.y) - (T - w.start) * WAVE_SPEED;
          if (d > -60 && d < 60) {
            const e = Math.exp(-d * d / 700);
            h += 6 * e;
            if (e > .85 && e * .85 > o.amber) o.amber = e * .85;
          }
        }
        if (h > MAX_H) h = MAX_H;

        // Rounded here and not in the scene, so a moving column steps by one pixel at a time.
        const raised = Math.round(h * UNIT);
        const slot = col + cols + 3;
        thisRow[slot] = raised;
        const ty = cy - raised;
        if (ty > H) continue;
        // A tall column's side can reach behind text its top is well clear of.
        let t = clearing(cx, ty + 5);
        if (raised > 15) t = Math.min(t, clearing(cx, ty + 5 + (raised >> 1)), clearing(cx, cy + 15));
        id++;
        column(id, cx, ty, VOXEL + raised,
          lit(TOP, o, t, 1), lit(LEFT, o, t, .78), lit(RIGHT, o, t, .56),
          !firstRow && raised - backRow[slot - 1] >= SEAM_STEP,
          !firstRow && raised - backRow[slot + 1] >= SEAM_STEP,
          o.crop, t, 1);
        if (o.thread > 0 || o.cross > 0) dashes.push(id, cx, ty, o.thread, o.cross, t < .3 ? t * .6 : t);
      }
      firstRow = false;
    }
    for (let i = 0; i < dashes.length; i += 6) {
      if (dashes[i + 3] > 0) dash(dashes[i], dashes[i + 1], dashes[i + 2], dashes[i + 3], dashes[i + 5], 1);
      if (dashes[i + 4] > 0) dash(dashes[i], dashes[i + 1], dashes[i + 2], dashes[i + 4], dashes[i + 5], -1);
    }
    ctx.putImageData(img, 0, 0);
    const reach = Math.hypot(W, H) + 60;
    while (waves.length && (T - waves[0].start) * WAVE_SPEED > reach) waves.shift();
    const settled = Math.abs(pointer.x - pointer.sx) + Math.abs(pointer.y - pointer.sy) < .2
      && Math.abs((pointer.on ? 1 : 0) - pointer.lift) < .004;
    return {
      busy: !settled || waves.length > 0,
      living: LIVING.has(sceneA) || (sceneMix > 0 && LIVING.has(sceneB)),
    };
  }

  window.WeftField = {
    resize,
    render,
    scene(a, b, mix, whereA, whereB) {
      sceneA = scenes[a] || scenes.banner;
      sceneB = b ? scenes[b] || null : null;
      sceneMix = mix;
      anchorA = whereA;
      anchorB = whereB;
    },
    setRects(list) {
      const k = dpr / pixel;
      rects = list.map(r => ({ l: r.left * k, r: r.right * k, t: r.top * k, b: r.bottom * k }));
    },
    pointer(x, y) {
      pointer.x = x * dpr / pixel;
      pointer.y = y * dpr / pixel;
      // Coming back in, rise where the cursor is instead of sliding over from where it left.
      if (!pointer.on && pointer.lift < .05) { pointer.sx = pointer.x; pointer.sy = pointer.y; }
      pointer.on = true;
    },
    pointerGone() { pointer.on = false; },
    wave(x, y, T) { waves.push({ x: x * dpr / pixel, y: y * dpr / pixel, start: T }); },
  };
})();
