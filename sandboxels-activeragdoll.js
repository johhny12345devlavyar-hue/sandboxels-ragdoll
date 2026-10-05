// Active Ragdoll mod for Sandboxels  (v8)
//
// "Ragdolls" menu: Human (clothed, smart), Player, Fighter, Zombie and Big ragdolls, each also in Red / Blue / Green
// team versions. Different team colours fight each other (human vs human, zombie vs zombie, big vs big...).
//
//   Player:       Left/Right = walk (swim), Up = jump / swim up, Down = punch (dive when swimming), E = eat, Tab = switch player
//   Drag tool:    pick ragdolls up and throw / slam them.  (Or hold G and click-drag with any element selected.)
//   Revive tool:  Tools menu. Brush over a dead (or hurt) ragdoll to bring it back, regrow limbs and heal it.
//   Settings:     click the "Ragdolls" button in the bottom-left corner of the page for a settings menu.
//
// Highlights
//   * Per-limb health. Broken bones are visible (purple limb + a white bone). One broken leg = limp, two = crawl.
//   * Pain and fear meters drive animations: flinching, clutching wounds, hunching, writhing, cowering, fleeing.
//   * Death animations: beaten ones crawl away, choking turns them blue, burning ones run around, drowning thrash...
//   * Swimming: they float, detect when fully submerged (then no external forces) and swim with real strokes.
//   * Fighting: jabs, crosses, kicks, smashes, blocking, dodging, stamina, combos. Big ones grab people and throw them.
//   * They crouch, grab food into a ball, lift it to their head and eat it.
//   * Every body cell is a real pixel, so sand, water, fire, acid, gas, electricity and explosions interact with them.
//
// If you paste this into the console, reload the page first if an older version is already loaded.

(function () {
  "use strict";
  if (window.__activeRagdollLoaded) {
    console.warn("[Active Ragdoll] already loaded - reload the page before loading a new version.");
    return;
  }
  window.__activeRagdollLoaded = true;

  // ---------- Tunables (cell units, ~30 ticks per second). Most of these are also in the Settings menu. ----------
  const DEFAULTS = {
    gravity: 0.2,          // normal gravity (standing, walking, jumping up)
    fallGravity: 0.5,      // gravity while FALLING (airborne and moving down)
    drag: 0.985, maxSpeed: 2.0, iterations: 5, friction: 0.5,
    maxFall: 8.0,          // terminal falling speed (cells/tick)
    bodyDensity: 820,      // lower = floats higher in liquids (water is ~1000)
    stride: 2.0, walkRate: 0.22, jump: 1.3, hop: 1.0,
    burnTemp: 120, burnTicks: 40, maxRagdolls: 40, maxFragments: 80, fragLife: 2400,
    grabRange: 8, footGrip: 0.1, stepLift: 2.6, stumbleChance: 0.004,
    canFall: false,        // false = he staggers and catches himself with his legs after knocks
    safeImpact: 3.2,       // impact speed (cells/tick) below which nothing happens (~10 cell drop)
    stunImpact: 4.5,       // impact speed (~20 cell drop) that knocks him flat; he lies there, then gets back up
    smashImpact: 7.2,      // impact speed (~50 cell drop) that smashes him (instant death)
    impactDamage: 110,     // damage to the limb that hits at top speed; scales with speed squared
    crushTicks: 60,        // ticks under a deep pile of sand etc. before being crushed
    breath: 600,           // ticks he can stay under liquid before drowning
    freezeTemp: -30, freezeTicks: 90,
    shockKO: 25, shockDeath: 140, koTicks: 240,   // electricity: ticks of shock to knock out / kill; KO duration
    severFrac: 0.4,        // fraction of a limb's pixels destroyed before the limb comes off
    sight: 60,             // how far (cells) the AI can see other ragdolls
    hungerRate: 0.004,     // hunger per tick (100 = starving, ~14 minutes)
    starve: true,          // starve to death when hunger stays at 100
    deathAnims: true,      // dying takes a moment: crawling, choking, thrashing...
    fearEnabled: true,     // fear makes them flee, cower and tremble
    teamsFight: true,      // different team colours attack each other
    friendlyFire: false,   // allied team members can hurt each other
    throwPower: 1.0,       // how hard big ragdolls throw people
    painRate: 1.0,         // how much damage hurts (pain meter)
    showMarker: false,     // yellow arrow over the player ragdoll
  };
  const CFG = Object.assign({}, DEFAULTS);
  const SETTINGS_KEY = "activeRagdollSettings";
  try {   // saved settings from the Settings menu
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved) for (const k in saved) if (k in DEFAULTS && typeof saved[k] === typeof DEFAULTS[k]) CFG[k] = saved[k];
  } catch (e) { /* no storage: fine */ }

  const HEAD = 0, NECK = 1, HIP = 2, ELBL = 3, HANDL = 4, ELBR = 5, HANDR = 6,
        KNEEL = 7, FOOTL = 8, KNEER = 9, FOOTR = 10;
  const LEG = 7.0, STAND = 6.9;
  const CONS = [   // [a, b, restLength, minOnly]
    [HEAD, NECK, 2], [NECK, HIP, 4.5],
    [NECK, ELBL, 3], [ELBL, HANDL, 3], [NECK, ELBR, 3], [ELBR, HANDR, 3],
    [HIP, KNEEL, 3.5], [KNEEL, FOOTL, 3.5], [HIP, KNEER, 3.5], [KNEER, FOOTR, 3.5],
    [FOOTL, FOOTR, 1.2, true], [HEAD, HIP, 3.5, true],
  ];
  // Body parts. Each part owns its own pixels; order matters (earlier parts claim shared joint cells).
  const PART_DEFS = [
    { id: "head", kind: "disc", a: HEAD },
    { id: "torso", a: NECK, b: HIP, len: 4.5 },
    { id: "neck", a: HEAD, b: NECK, len: 2 },
    { id: "armL1", a: NECK, b: ELBL, len: 3, kids: ["armL2"] }, { id: "armL2", a: ELBL, b: HANDL, len: 3 },
    { id: "armR1", a: NECK, b: ELBR, len: 3, kids: ["armR2"] }, { id: "armR2", a: ELBR, b: HANDR, len: 3 },
    { id: "legL1", a: HIP, b: KNEEL, len: 3.5, kids: ["legL2"] }, { id: "legL2", a: KNEEL, b: FOOTL, len: 3.5 },
    { id: "legR1", a: HIP, b: KNEER, len: 3.5, kids: ["legR2"] }, { id: "legR2", a: KNEER, b: FOOTR, len: 3.5 },
  ];
  // Limb health: head, torso, both arms, both legs each have their own health
  const LIMBS = ["head", "torso", "armL", "armR", "legL", "legR"];
  const POINT_LIMB = ["head", "torso", "torso", "armL", "armL", "armR", "armR", "legL", "legL", "legR", "legR"];
  const PART_LIMB = { head: "head", neck: "head", torso: "torso", armL1: "armL", armL2: "armL", armR1: "armR", armR2: "armR",
                      legL1: "legL", legL2: "legL", legR1: "legR", legR2: "legR" };
  const LIMB_BASE = { head: 40, torso: 90, armL: 35, armR: 35, legL: 50, legR: 50 };
  const SHARE = { head: 0.15, torso: 0.35, armL: 0.125, armR: 0.125, legL: 0.125, legR: 0.125 };   // spread for whole-body damage
  const LIMB_POINT = { head: HEAD, torso: NECK, armL: ELBL, armR: ELBR, legL: KNEEL, legR: KNEER };  // where a limb "is" (for clutching wounds)

  // ---------- Attacks ----------
  // dmg = multiplier on the attacker's damage, reach = multiplier on its reach, dur = animation ticks, hit = tick the blow lands,
  // cost = stamina, kb = knockback multiplier, zone = where it tends to land, limb = what does the hitting
  const ATTACKS = {
    jab:   { dmg: 0.8, reach: 0.9,  dur: 12, hit: 5,  cost: 6,  kb: 0.6, zone: "upper", limb: "arm" },
    cross: { dmg: 1.3, reach: 1.0,  dur: 16, hit: 8,  cost: 10, kb: 1.0, zone: "upper", limb: "arm" },
    kick:  { dmg: 1.5, reach: 1.15, dur: 20, hit: 10, cost: 14, kb: 1.2, zone: "lower", limb: "leg" },
    smash: { dmg: 2.4, reach: 1.1,  dur: 30, hit: 16, cost: 22, kb: 2.0, zone: "any",   limb: "arm" },
    claw:  { dmg: 1.0, reach: 0.9,  dur: 18, hit: 9,  cost: 4,  kb: 0.4, zone: "any",   limb: "arm" },
  };

  // ---------- Ragdoll types and teams ----------
  const SKIN = [[255, 224, 189], [241, 194, 125], [224, 172, 105], [198, 134, 66], [141, 85, 36], [100, 65, 40]];
  const HAIR = [[30, 25, 20], [90, 60, 30], [160, 110, 50], [220, 190, 110], [160, 50, 30], [120, 120, 120]];
  const SHIRT = [[200, 60, 60], [60, 120, 200], [70, 170, 90], [220, 180, 50], [160, 90, 180], [230, 230, 230], [70, 70, 75], [230, 130, 40]];
  const PANTS = [[50, 70, 110], [40, 40, 50], [90, 80, 60], [70, 50, 40], [60, 60, 65]];
  const TEAM_RGB = { red: [205, 55, 50], blue: [55, 115, 225], green: [60, 175, 85] };
  const BONE = [245, 240, 225], BRUISE = [135, 65, 165];
  const TYPES = {
    ragdoll:         { label: "Human", sc: 1,   hp: 60,  mass: 1,   speed: 1.0,  team: "human",  ai: "wander",  dmg: 5,  kb: 0.3,  reach: 6,  cool: 50, ko: 0.05, courage: 30,   dodge: 0.25, block: 0.25, rgb: null,
                       moves: ["jab", "jab", "cross"],
                       desc: "Clothed, smart human. Eats, avoids danger, swims, fights back if cornered and runs from zombies." },
    ragdoll_player:  { label: "Player", sc: 1,   hp: 100, mass: 1,   speed: 1.1,  team: "human",  ai: "player",  dmg: 10, kb: 0.5,  reach: 7,  cool: 28, ko: 0.1,  courage: 100,  dodge: 0, block: 0, rgb: [44, 111, 187],
                       moves: ["jab", "cross"],
                       desc: "You control this one: Left/Right walk, Up jump/swim, Down punch, E eat, Tab switches player." },
    ragdoll_fighter: { label: "Fighter", sc: 1,  hp: 110, mass: 1.1, speed: 1.15, team: "human",  ai: "fighter", dmg: 12, kb: 0.55, reach: 7,  cool: 32, ko: 0.15, courage: 75,   dodge: 0.5, block: 0.45, rgb: [192, 57, 43],
                       moves: ["jab", "cross", "kick", "jab"],
                       desc: "Hunts zombies, fights with jabs, crosses and kicks, blocks and dodges. Flees when badly hurt or scared." },
    ragdoll_zombie:  { label: "Zombie", sc: 1,   hp: 90,  mass: 1,   speed: 0.55, team: "zombie", ai: "zombie",  dmg: 7,  kb: 0.25, reach: 6,  cool: 60, ko: 0.03, courage: 9999, dodge: 0, block: 0, rgb: [84, 140, 70], burnRes: 1.4, undead: true,
                       moves: ["claw"],
                       desc: "Slow and tough, never scared, doesn't breathe. Chases the living. Bites can turn people into zombies." },
    ragdoll_big:     { label: "Big", sc: 1.6,   hp: 260, mass: 2.4, speed: 0.8,  team: "human",  ai: "guard",   dmg: 24, kb: 1.0,  reach: 11, cool: 55, ko: 0.35, courage: 90,   dodge: 0.15, block: 0.3, rgb: [142, 68, 173], burnRes: 1.6,
                       moves: ["smash", "smash", "cross"],
                       desc: "Huge and heavy. Smashes people, and picks them up and throws them." },
  };
  const TEAMS = ["red", "blue", "green"];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgbStr = (c) => "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  const rgbHex = (c) => "#" + [0, 1, 2].map(i => ("0" + (c[i] | 0).toString(16)).slice(-2)).join("");
  const pick = (a) => a[(Math.random() * a.length) | 0].slice();
  const PALETTE = [[34, 34, 34], [214, 137, 16], [46, 139, 87], [120, 120, 130], [160, 82, 45], [90, 60, 120]];
  let paletteIdx = 0;
  function baseColor(T, col) {
    if (col && col !== "none") { const t = TEAM_RGB[col]; return T.ai === "zombie" ? mixc(T.rgb, t, 0.55) : t.slice(); }
    return (T.rgb || PALETTE[paletteIdx++ % PALETTE.length]).slice();
  }
  function makeOutfit(T, col) {
    if (T.ai === "zombie") {
      return { skin: [125, 160, 105], hair: [40, 45, 35], shirt: mixc(pick(SHIRT), [90, 120, 80], 0.6),
               pants: mixc(pick(PANTS), [40, 50, 35], 0.5), shoes: [35, 30, 25], sleeves: Math.random() < 0.5 };
    }
    const shirt = col !== "none" ? TEAM_RGB[col].slice() : (T.rgb ? T.rgb.slice() : pick(SHIRT));
    return { skin: pick(SKIN), hair: pick(HAIR), shirt: shirt, pants: pick(PANTS), shoes: [45, 35, 30], sleeves: Math.random() < 0.5 };
  }
  const SPAWNS = {};   // element name -> { type, col, hex, desc }
  for (const t of Object.keys(TYPES)) SPAWNS[t] = { type: t, col: "none", hex: rgbHex(TYPES[t].rgb || [200, 170, 140]), desc: TYPES[t].desc };
  for (const t of Object.keys(TYPES)) for (const c of TEAMS) {
    SPAWNS[t + "_" + c] = { type: t, col: c, hex: rgbHex(baseColor(TYPES[t], c)),
      desc: c[0].toUpperCase() + c.slice(1) + " team " + TYPES[t].label.toLowerCase() + ". Different team colours fight each other." };
  }

  // ---------- Element name tables (names that don't exist in your version are simply ignored) ----------
  const BLAST = { explosion: 1, n_explosion: 1 };
  const ELECTRIC = { electric: 1, lightning: 1 };
  const SLIPPERY = { ice: 1, packed_ice: 1 };
  const STICKY = { mud: 1, glue: 1, honey: 1, slime: 1, tar: 1, caramel: 1, molasses: 1 };
  const ACID = { acid: 1, acid_gas: 1 };
  const POISON = { poison: 1, cyanide: 1 };
  const TOXIC_GAS = { poison_gas: 1, chlorine: 1, acid_gas: 1, ammonia: 0.8, carbon_dioxide: 0.5, smoke: 0.35, methane: 0.3, steam: 0.25, fumes: 0.5 };
  const RADIO = { radiation: 1, uranium: 0.15, plutonium: 0.25, polonium: 0.3 };
  const HAZ = { fire: 1, lava: 1, magma: 1, plasma: 1, acid: 1, acid_gas: 1, poison: 1, poison_gas: 1, chlorine: 1,
                electric: 1, lightning: 1, explosion: 1, n_explosion: 1, radiation: 1 };
  const FOODVAL = { bread: 25, toast: 22, cheese: 30, meat: 35, cooked_meat: 45, rotten_meat: 20, egg: 20, cooked_egg: 25, fish: 30, cooked_fish: 35,
                    apple: 15, honey: 18, chocolate: 20, candy: 12, cookie: 22, cake: 30, pizza: 35, butter: 15, jelly: 12 };
  const BADFOOD = { rotten_meat: 1 };
  const DEATH_COLOR = {
    burn: [45, 32, 28], crush: [130, 45, 45], drown: [95, 115, 150], fall: [150, 40, 40], crash: [150, 40, 40], smash: [150, 40, 40],
    shock: [55, 50, 35], acid: [120, 170, 80], freeze: [170, 205, 230], poison: [110, 130, 60], bleed: [170, 90, 90],
    choke: [70, 100, 200], suffocate: [90, 95, 190], starve: [160, 160, 140], radiation: [110, 170, 100], scald: [190, 85, 65],
    concussion: [130, 110, 110], internal: [140, 100, 100],
  };
  const NO_TURN = { burn: 1, gib: 1, acid: 1, fall: 1, crash: 1, smash: 1, crush: 1, freeze: 1, decap: 1, radiation: 1, starve: 1 };   // can't rise as a zombie
  // How things die. dur = how long the death throes last; anim = what he does. No entry (or dur 0) = instant.
  const DYING = {
    punch: { dur: 240, anim: "crawl" }, bite: { dur: 240, anim: "crawl" }, crash: { dur: 200, anim: "crawl" }, fall: { dur: 200, anim: "crawl" },
    concussion: { dur: 200, anim: "crawl" }, internal: { dur: 200, anim: "crawl" }, explosion: { dur: 120, anim: "crawl" },
    bleed: { dur: 300, anim: "crawl" }, starve: { dur: 300, anim: "crawl" }, radiation: { dur: 240, anim: "crawl" },
    choke: { dur: 100, anim: "collapse" }, burn: { dur: 100, anim: "panic" }, drown: { dur: 100, anim: "thrash" },
    suffocate: { dur: 100, anim: "thrash" }, scald: { dur: 90, anim: "thrash" }, acid: { dur: 70, anim: "thrash" },
    poison: { dur: 160, anim: "convulse" }, decap: { dur: 70, anim: "headless" },
  };

  const RD = [];          // ragdolls
  const FRAGS = [];       // severed pieces
  const BYID = new Map(); // id -> ragdoll or fragment
  let nextId = 1;
  let controlled = null;
  let grab = null;
  let gHeld = false;      // hold G + click-drag to grab (works with any element selected)
  let eatReq = false;     // player pressed E
  let lastSpawnTime = 0;
  const keys = {};
  window.activeRagdolls = RD;   // handy for poking around in the console

  // ---------- World queries ----------
  function pixelAt(cx, cy) { const col = pixelMap[cx]; return col ? col[cy] : undefined; }
  function solidAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy > height) return true;   // side walls + floor
    if (cy < 0) return false;                               // open sky
    const p = pixelAt(cx, cy);
    if (!p) return false;
    if (p.element === "ragdoll_body") return false;         // ragdolls ignore ragdoll bodies
    const e = elements[p.element];
    return !!e && e.state === "solid";
  }
  function liquidAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy < 0 || cy > height) return false;
    const p = pixelAt(cx, cy);
    if (!p) return false;
    const e = elements[p.element];
    return (e && e.state === "liquid") ? p : false;         // returns the liquid pixel so callers can read its density
  }
  // Liquid at a body point. His own pixel sits in that very cell (it pushed the liquid aside), so look at the cells around it:
  // if most of the free cells nearby are liquid, the point is under liquid.
  function wetAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy < 0 || cy > height) return false;
    const here = liquidAt(x, y);
    if (here) return here;
    const own = pixelAt(cx, cy);
    if (!own || own.element !== "ragdoll_body") return false;
    let liq = 0, other = 0, found = false;
    for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
      const p = pixelMap[gx][gy];
      if (p && p.element === "ragdoll_body") continue;
      const l = p ? liquidAt(gx + 0.5, gy + 0.5) : false;
      if (l) { liq++; found = l; } else other++;
    }
    return (liq >= 4 && liq >= other * 1.4) ? found : false;
  }
  function hazardPixel(p) {
    return !!p && p.element !== "ragdoll_body" && (HAZ[p.element] || p.temp >= CFG.burnTemp);
  }
  function displaceable(p) {   // liquids and gases get pushed out of the way by a body
    if (!p || p.element === "ragdoll_body") return false;
    const e = elements[p.element];
    return !!e && (e.state === "liquid" || e.state === "gas");
  }
  // Push a liquid/gas pixel into the first free cell from the candidates; if there is no room it is squeezed out of existence
  function relocate(p, cands) {
    for (const c of cands) {
      const x = c[0], y = c[1];
      if (x < 0 || x > width || y < 0 || y > height) continue;
      if (pixelMap[x][y]) continue;
      pixelMap[x][y] = p; p.x = x; p.y = y;
      return true;
    }
    // no free cell next to us: the liquid rises to the first free cell above (the surface), so water isn't lost
    const bx = p.x, by = p.y;
    for (let dxx = 0; dxx <= 6; dxx++) for (const sx of (dxx ? [-1, 1] : [1])) {
      const x = bx + dxx * sx;
      if (x < 0 || x > width) continue;
      for (let y = by - 1; y >= Math.max(0, by - 60); y--) {
        const o = pixelMap[x][y];
        if (o) { const e = elements[o.element]; if (e && (e.state === "liquid" || o.element === "ragdoll_body")) continue; break; }
        pixelMap[x][y] = p; p.x = x; p.y = y; return true;
      }
    }
    const i = currentPixels.indexOf(p);
    if (i >= 0) currentPixels.splice(i, 1);
    return false;
  }
  function ringCells(x, y) {
    const out = [];
    for (let r = 1; r <= 2; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([x + dx, y + dy]);
    }
    for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = out[i]; out[i] = out[j]; out[j] = t; }   // random order
    return out;
  }

  // ---------- Body pixels: persistent, they just HOP to their new cells every tick ----------
  function removePixel(px) {
    if (!px) return;
    const col = pixelMap[px.x];
    if (col && col[px.y] === px) deletePixel(px.x, px.y);
    else { const i = currentPixels.indexOf(px); if (i >= 0) currentPixels.splice(i, 1); }   // it was lifted off the grid mid-move
  }
  function unstamp(o) {
    for (const part of o.parts) { for (const px of part.pix) removePixel(px); part.pix = []; part.cd = []; }
  }
  // The cells a part wants to occupy this tick, in a stable order (so per-pixel damage travels with the limb)
  function partCells(o, part) {
    const P = o.p, S = o.sc, out = [];
    if (part.kind === "disc") {   // the head is a cube
      const h = P[part.a], n = Math.max(3, Math.round(3 * S));
      const x0 = Math.round(h.x - n / 2), y0 = Math.round(h.y - n / 2);
      for (let cy = y0; cy < y0 + n; cy++) for (let cx = x0; cx < x0 + n; cx++) out.push([cx, cy]);
      return out;
    }
    const a = P[part.a], b = P[part.b];
    let x0 = Math.floor(a.x), y0 = Math.floor(a.y);
    const x1 = Math.floor(b.x), y1 = Math.floor(b.y);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 120; guard++) {
      out.push([x0, y0]);
      if (S >= 1.4) out.push([x0 + 1, y0]);   // big ragdolls get thicker limbs
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }
  // Clothes: head (skin + hair), shirt on torso and upper arms, skin hands, trousers and shoes
  function outfitColor(o, part, k, n) {
    const f = o.outfit, id = part.id;
    if (id === "head") {
      const px = part.pix[k], h = o.p[part.a];
      return (px && px.y + 0.5 < h.y - 0.45 * o.sc) ? f.hair : f.skin;
    }
    if (id === "neck") return f.skin;
    if (id === "torso") return f.shirt;
    if (id[0] === "a") {   // arms
      if (id[4] === "1") return f.shirt;
      return (k >= n - 1) ? f.skin : (f.sleeves ? f.shirt : f.skin);
    }
    if (id[4] === "2") return (k >= n - 2) ? f.shoes : f.pants;   // lower leg ends in shoes
    return f.pants;
  }
  function pixelColor(o, part, k) {
    const n = part.pix.length;
    let c = o.base;
    const limb = PART_LIMB[part.id];
    if (o.lh && limb && !o.dead) {
      if (o.broken[limb]) c = (n >= 3 && k === Math.floor(n * 0.45)) ? BONE : mixc(c, BRUISE, 0.55);   // a broken bone you can see
      else if (o.lh[limb] < o.lmax[limb] * 0.6) c = mixc(c, BRUISE, 0.25 * (1 - o.lh[limb] / o.lmax[limb]));   // bruising
    }
    const cd = part.cd[k];
    if (cd > 0.02) c = mixc(c, [35, 10, 10], Math.min(1, cd * 0.9));
    if (o.tints) for (const t of o.tints) c = mixc(c, t[0], t[1]);
    return rgbStr(c);
  }
  function stamp(o) {
    o.sg = (o.sg || 0) + 1;
    const claimed = new Set();
    // 1. target cells per part; grow/shrink each part's pixel list to match
    for (const part of o.parts) {
      if (part.gone) continue;
      const tgt = [];
      for (const c of partCells(o, part)) {
        const x = c[0], y = c[1];
        if (x < 0 || x > width || y < 0 || y > height) continue;
        const key = y * (width + 1) + x;
        if (claimed.has(key)) continue;
        claimed.add(key); tgt.push(c);
      }
      part.tgt = tgt;
      while (part.pix.length > tgt.length) { removePixel(part.pix.pop()); part.cd.pop(); }
      while (part.pix.length < tgt.length) { part.pix.push(undefined); part.cd.push(0); }   // undefined = needs creating
    }
    // 2. check our pixels are still ours. Pixels erased / dissolved / voided / turned into something else become holes
    //    (so limbs can come off). If almost everything vanished at once the player hit undo or clear: remove the ragdoll.
    let live = 0, vanished = 0;
    for (const part of o.parts) {
      if (part.gone) continue;
      for (let k = 0; k < part.pix.length; k++) {
        const px = part.pix[k];
        if (!px) continue;
        live++;
        const col = pixelMap[px.x];
        if (!col || col[px.y] !== px) { vanished++; part.pix[k] = null; part.cd[k] = 1; if (o.blood !== undefined) o.bleedRate = Math.min(1.2, (o.bleedRate || 0) + 0.01); }
        else if (px.element !== "ragdoll_body") { vanished++; part.pix[k] = null; part.cd[k] = 1; }   // e.g. burned into ash: that pixel is lost
      }
    }
    if (o.age > 3 && live >= 6 && vanished >= Math.max(8, live * 0.6)) o.kill = true;
    // 3. lightning-fast move: lift every moving pixel off the grid, then drop each onto its new cell
    const moving = [];
    for (const part of o.parts) {
      if (part.gone) continue;
      for (let k = 0; k < part.pix.length; k++) {
        const px = part.pix[k];
        if (!px) continue;
        const t = part.tgt[k];
        if (px.x !== t[0] || px.y !== t[1]) { pixelMap[px.x][px.y] = undefined; moving.push([px, t, part, k]); }
      }
    }
    for (const m of moving) {
      const px = m[0], t = m[1], col = pixelMap[t[0]];
      const occ = col[t[1]];
      if (!occ) { col[t[1]] = px; px.x = t[0]; px.y = t[1]; }
      else if (displaceable(occ)) {   // liquid/gas in the way: push it into the cell we just left (a swap), or any free neighbour
        col[t[1]] = undefined;
        relocate(occ, [[px.x, px.y]].concat(ringCells(t[0], t[1])));
        col[t[1]] = px; px.x = t[0]; px.y = t[1];
      } else {   // something solid is in the way: go back if the old cell is still free, otherwise drop it and re-create later
        const oc = pixelMap[px.x];
        if (!oc[px.y]) oc[px.y] = px; else { removePixel(px); m[2].pix[m[3]] = undefined; }
      }
    }
    // 4. create any pixels that are missing (new body, limb grew a cell, previously blocked)
    for (const part of o.parts) {
      if (part.gone) continue;
      for (let k = 0; k < part.pix.length; k++) {
        if (part.pix[k] !== undefined) continue;
        const t = part.tgt[k], occ = pixelMap[t[0]][t[1]];
        if (occ) {
          if (!displaceable(occ)) continue;
          pixelMap[t[0]][t[1]] = undefined;
          relocate(occ, ringCells(t[0], t[1]));
        }
        createPixel("ragdoll_body", t[0], t[1]);
        const px = pixelMap[t[0]][t[1]];
        if (px) { px.rd = o.id; part.pix[k] = px; }
      }
    }
    // 5. stamp ownership + colour
    for (const part of o.parts) {
      if (part.gone) continue;
      for (let k = 0; k < part.pix.length; k++) {
        const px = part.pix[k];
        if (!px) continue;
        px.sg = o.sg;
        const c = pixelColor(o, part, k);
        if (px.color !== c) px.color = c;
      }
    }
  }
  function removeRagdoll(r) {
    if (r.eat) endEat(r);
    if (r.carry) releaseCarry(r, false);
    unstamp(r);
    BYID.delete(r.id);
    const i = RD.indexOf(r);
    if (i >= 0) RD.splice(i, 1);
    if (grab && grab.r === r) grab = null;
    if (controlled === r) controlled = nextPlayer(null);
  }
  function removeFragment(f) {
    unstamp(f);
    BYID.delete(f.id);
    const i = FRAGS.indexOf(f);
    if (i >= 0) FRAGS.splice(i, 1);
  }
  function nextPlayer(from) {
    const players = RD.filter(q => q.ai === "player" && !q.dead);
    if (!players.length) return null;
    const i = players.indexOf(from);
    return players[(i + 1) % players.length];
  }
  const isDown = (o) => o.dead || !!o.dying;

  // ---------- Per-pixel damage + dismemberment ----------
  function destroyPixel(o, part, k) {
    const px = part.pix[k];
    if (!px) return;
    const x = px.x, y = px.y;
    removePixel(px);
    part.pix[k] = null; part.cd[k] = 1;
    if (o.blood !== undefined && !o.dead) o.bleedRate = Math.min(1.2, (o.bleedRate || 0) + 0.01);
    if (elements.blood && Math.random() < 0.5 && !pixelAt(x, y)) createPixel("blood", x, y);
  }
  // Damage the pixels near (x, y); strongest at the centre. amt of 1 destroys a pixel outright.
  function hurtAt(o, x, y, amt, rad) {
    amt /= Math.sqrt(o.T ? o.T.mass : 1);
    for (const part of o.parts) {
      if (part.gone) continue;
      for (let k = 0; k < part.pix.length; k++) {
        const px = part.pix[k];
        if (!px) continue;
        const d = Math.hypot(px.x + 0.5 - x, px.y + 0.5 - y);
        if (d > rad) continue;
        part.cd[k] += amt * (1 - d / (rad + 0.01));
        if (part.cd[k] >= 1) destroyPixel(o, part, k);
      }
    }
  }
  function clonePt(q) { return { x: q.x, y: q.y, px: q.px + (Math.random() - 0.5) * 0.3, py: q.py + (Math.random() - 0.5) * 0.3, ground: false }; }
  function spawnFragment(r, pts, fparts, cons) {
    const f = { frag: true, owner: r.id, id: nextId++, p: pts, parts: fparts, cons: cons, sc: r.sc, age: 0, sg: 0, kill: false,
                base: r.base, tints: r.tints ? r.tints.slice() : [], life: CFG.fragLife };
    FRAGS.push(f); BYID.set(f.id, f);
    for (const part of f.parts) for (const px of part.pix) if (px) px.rd = f.id;
    if (FRAGS.length > CFG.maxFragments) removeFragment(FRAGS[0]);
    return f;
  }
  function stump(r, idx) {
    r.stumps = r.stumps || [];
    r.stumps.push(idx);
  }
  // A limb comes off: its pixels (with their damage) move to a new physical piece
  function sever(r, id) {
    const root = r.partMap[id];
    if (!root || root.gone) return;
    if (id === "head" || id === "neck") { decapitate(r); return; }
    const S = r.sc, P = r.p;
    const group = [root].concat(root.kids.map(k => r.partMap[k]).filter(q => q && !q.gone));
    const pts = [], idx = new Map(), fparts = [], cons = [];
    const addPt = (i) => { if (!idx.has(i)) { idx.set(i, pts.length); pts.push(clonePt(P[i])); } return idx.get(i); };
    for (const part of group) {
      const ia = addPt(part.a), ib = addPt(part.b);
      cons.push([ia, ib, part.len * S]);
      fparts.push({ id: part.id, kind: "line", a: ia, b: ib, len: part.len, kids: [], pix: part.pix, cd: part.cd, gone: false });
      part.pix = []; part.cd = []; part.gone = true;
      P[part.b].gone = true; P[part.b].pin = part.a;
    }
    spawnFragment(r, pts, fparts, cons);
    stump(r, root.a);
    const limb = PART_LIMB[id];
    if (!r.dead) {
      r.stumpBleed = (r.stumpBleed || 0) + 0.06;                 // a stump keeps bleeding
      r.lh[limb] = 0; r.broken[limb] = true;
      r.pain = Math.min(100, r.pain + 40); r.fear = Math.min(100, r.fear + 40);
      r.stun = Math.max(r.stun, 30);
    }
  }
  function decapitate(r) {
    const head = r.partMap.head, neck = r.partMap.neck, P = r.p;
    if (head.gone) return;
    const fp = { id: "head", kind: "disc", a: 0, len: 0, kids: [], pix: head.pix, cd: head.cd, gone: false };
    head.pix = []; head.cd = []; head.gone = true;
    for (const px of neck.pix) removePixel(px);
    neck.pix = []; neck.cd = []; neck.gone = true;
    P[HEAD].gone = true; P[HEAD].pin = NECK;
    spawnFragment(r, [clonePt(P[HEAD])], [fp], []);
    stump(r, NECK);
    if (!r.dead) { r.stumpBleed = (r.stumpBleed || 0) + 0.12; die(r, "decap"); }
  }
  function checkSever(r) {
    let todo = null;
    for (const part of r.parts) {
      if (part.gone) continue;
      const total = part.pix.length;
      if (total < 3) continue;
      let holes = 0;
      for (let k = 0; k < total; k++) if (part.pix[k] === null) holes++;
      if (holes >= Math.max(2, Math.ceil(total * CFG.severFrac))) (todo = todo || []).push(part.id);
    }
    if (!todo) return;
    for (const id of todo) {
      const part = r.partMap[id];
      if (part.gone) continue;
      if (id === "torso") { if (!r.dead) smash(r, "smash"); }   // the middle of him is gone: he collapses
      else sever(r, id);
    }
  }

  // ---------- Creation ----------
  function makeParts() {
    return PART_DEFS.map(d => ({ id: d.id, kind: d.kind || "line", a: d.a, b: d.b, len: d.len || 0, kids: d.kids || [], pix: [], cd: [], gone: false }));
  }
  function resetVitals(r, T) {
    const hs = T.hp / 100;
    r.lh = {}; r.lmax = {}; r.broken = {}; r.mend = {};
    for (const l of LIMBS) { r.lmax[l] = LIMB_BASE[l] * hs; r.lh[l] = r.lmax[l]; r.broken[l] = false; }
  }
  function spawn(cx, cy, name) {
    const sp = SPAWNS[name] || SPAWNS.ragdoll, T = TYPES[sp.type], S = T.sc;
    const x = cx + 0.5, y = cy - 3 * S;
    const off = [[0, -6.5], [0, -4.5], [0, 0], [-0.7, -1.5], [-0.9, 1.5], [0.7, -1.5], [0.9, 1.5],
                 [-0.5, 3.5], [-0.9, 7], [0.5, 3.5], [0.9, 7]];
    const r = {
      id: nextId++, type: sp.type, T: T, sc: S, team: T.team, col: sp.col, ai: T.ai, base: baseColor(T, sp.col),
      p: off.map(o => ({ x: x + o[0] * S, y: y + o[1] * S, px: x + o[0] * S, py: y + o[1] * S, ground: false })),
      parts: makeParts(), cons: CONS.map(c => [c[0], c[1], c[2] * S, c[3]]), tints: [], sg: 0,
      ph: 0, spd: 0, face: 1, stun: 0, rec: 1, heat: 0, cold: 0, dead: false, dying: null, ko: false, cause: null,
      age: 0, jc: 0, hop: 0, atk: 0, atkDur: 0, atkType: null, atkSide: 1, cool: 0, target: null, block: 0, dodge: 0, combo: 0, comboT: 0, iframes: 0,
      dir: 0, aiDir: 0, aiT: 0, thinkT: (Math.random() * 5) | 0, chkX: x, chk: 0,
      shock: 0, zap: 0, breath: CFG.breath, inf: 0, turn: 0, melt: 0, flash: 0, grudge: 0, grudgeT: 0,
      blood: 100, bleedRate: 0, stumpBleed: 0, lung: 0, sufc: 0, rad: 0, tox: 0, scald: 0,
      hunger: Math.random() * 40, crouch: 0, eat: null, eatCool: 0, impPaid: {}, impWin: 0,
      pain: 0, fear: 0, flinch: 0, painLimb: "torso", stam: 100, cour: (Math.random() - 0.5) * 20, seen: {}, cower: 0,
      swimPh: 0, sub: { n: 0, frac: 0, head: false, hip: false, full: false }, carry: null, heldBy: 0, holdIdx: NECK, thrownT: 0, thrownDmg: 0, thrower: 0,
    };
    resetVitals(r, T);
    r.partMap = {};
    for (const part of r.parts) r.partMap[part.id] = part;
    RD.push(r); BYID.set(r.id, r);
    if (RD.length > CFG.maxRagdolls) removeRagdoll(RD[0]);
    if (T.ai === "player") controlled = r;
    return r;
  }

  // ---------- Health: per-limb damage, pain, broken bones, death ----------
  function splat(r, n) {
    if (!elements.blood) return;
    for (let i = 0; i < n; i++) {
      const q = r.p[(Math.random() * r.p.length) | 0];
      const gx = Math.floor(q.x) + ((Math.random() * 5) | 0) - 2, gy = Math.floor(q.y) + ((Math.random() * 5) | 0) - 2;
      if (gx >= 0 && gx <= width && gy >= 0 && gy <= height && !pixelAt(gx, gy)) createPixel("blood", gx, gy);
    }
  }
  // The actual moment of death
  function finalizeDeath(r, cause) {
    if (r.dead) return;
    if (r.eat) endEat(r);
    if (r.carry) releaseCarry(r, false);
    r.dead = true; r.dying = null; r.cause = cause; r.stun = 0; r.ko = false; r.atk = 0; r.dir = 0; r.block = 0;
    if (cause === "acid") r.melt = 100;
    if (cause === "fall" || cause === "crash" || cause === "crush" || cause === "smash" || cause === "gib") splat(r, cause === "gib" ? 18 : 10);
    if (cause === "punch" || cause === "bite" || cause === "decap" || cause === "concussion" || cause === "internal") splat(r, 3);
    if (r.team === "human" && (cause === "bite" || (r.inf > 0 && !NO_TURN[cause]))) r.turn = 150;   // may rise again
  }
  // Death usually takes a moment: he plays a death animation first (crawling away, choking, thrashing...)
  function die(r, cause) {
    if (r.dead) return;
    const spec = DYING[cause];
    if (r.dying) { if (!spec) finalizeDeath(r, cause); return; }   // already dying: only instant causes cut it short
    if (spec && CFG.deathAnims) {
      if (r.eat) endEat(r);
      if (r.carry) releaseCarry(r, false);
      r.dying = { cause: cause, t: 0, dur: spec.dur, anim: spec.anim, dir: Math.random() < 0.5 ? -1 : 1 };
      if (r.lastFrom && spec.anim === "crawl") r.dying.dir = -(Math.sign(r.lastFrom - r.p[HIP].x) || 1);   // crawl away from whoever did it
      r.stun = 0; r.ko = false; r.atk = 0; r.block = 0; r.fear = 100;
      return;
    }
    finalizeDeath(r, cause);
  }
  function limbAt(r, x, y) {   // which limb is nearest to (x, y)?
    let best = "torso", bd = Infinity;
    for (let i = 0; i < r.p.length; i++) {
      const q = r.p[i];
      if (q.gone) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = POINT_LIMB[i]; }
    }
    return best;
  }
  function addPain(r, amt, limb) {
    if (!(amt > 0)) return;
    const a = amt * CFG.painRate / Math.sqrt(r.T.mass);
    r.pain = Math.min(100, r.pain + a);
    if (limb) r.painLimb = limb;
    if (a >= 8) r.flinch = 8;
    r.fear = Math.min(100, r.fear + a * 0.5);
  }
  function breakLimb(r, limb) {
    if (r.broken[limb]) return;
    r.broken[limb] = true; r.mend[limb] = 0;
    r.flash = 8;
    addPain(r, 30, limb);
    if (limb === "legL" || limb === "legR") r.stun = Math.max(r.stun, 40);   // legs give way
    if (limb === "armL" || limb === "armR") r.atk = 0;
    splat(r, 2);
  }
  // Hurt one limb. Head or torso at 0 = dead; an arm or leg at 0 = broken (hangs limp, unusable).
  function hurtLimb(r, limb, amt, cause) {
    if (r.dead || amt <= 0) return;
    r.lh[limb] -= amt; r.lastCause = cause;
    if (amt >= 1.5) r.flash = 6;
    if (amt >= 0.5) addPain(r, amt, limb);
    if (r.lh[limb] > 0) return;
    r.lh[limb] = 0;
    const fallish = cause === "fall" || cause === "crash";
    if (limb === "head") die(r, fallish ? "concussion" : cause);
    else if (limb === "torso") die(r, fallish ? "internal" : cause);
    else breakLimb(r, limb);
  }
  function damageAll(r, amt, cause) {
    for (const l of LIMBS) hurtLimb(r, l, amt * SHARE[l], cause);
  }
  const WOUND = { punch: 0.004, bite: 0.008, crash: 0.003, fall: 0.002, explosion: 0.006 };
  // x, y (optional): where on the body it hurts, so the damage lands on that limb and those pixels
  function damage(r, amt, cause, x, y) {
    if (r.dead || amt <= 0) return;
    if (x === undefined) { damageAll(r, amt, cause); return; }
    hurtAt(r, x, y, amt * 0.05, 2.4 * r.sc);
    r.bleedRate = Math.min(1.2, (r.bleedRate || 0) + amt * (WOUND[cause] || 0));
    hurtLimb(r, limbAt(r, x, y), amt, cause);
  }
  // Smashed to bits: he dies, every bone breaks, and he is left a broken heap
  function smash(r, cause) {
    if (r.dead) return;
    for (const l of LIMBS) if (l !== "head" && l !== "torso") { r.lh[l] = 0; r.broken[l] = true; }
    finalizeDeath(r, cause || "smash");
    splat(r, 8);
  }
  function gib(r) {   // blown apart: every limb comes off as its own piece
    finalizeDeath(r, "gib");
    for (const id of ["armL1", "armR1", "legL1", "legR1"]) sever(r, id);
    decapitate(r);
  }
  function vitality(r) { return Math.min(r.lh.head / r.lmax.head, r.lh.torso / r.lmax.torso, r.blood / 100); }
  function armOk(r, side) { return !r.broken[side < 0 ? "armL" : "armR"] && !r.p[side < 0 ? HANDL : HANDR].gone; }
  function legBad(r, side) {
    const P = r.p;
    return !!r.broken[side < 0 ? "legL" : "legR"] || P[side < 0 ? KNEEL : KNEER].gone || P[side < 0 ? FOOTL : FOOTR].gone;
  }
  function knockOut(r, ticks) {
    if (r.dead || r.dying) return;
    r.ko = true; r.stun = Math.max(r.stun, ticks); r.stag = 0; r.atk = 0; r.block = 0;
    if (r.eat) endEat(r);
    if (r.carry) releaseCarry(r, false);
  }
  function becomeZombie(r, col) {
    const Z = TYPES.ragdoll_zombie;
    if (col !== undefined) r.col = col;
    r.type = "ragdoll_zombie"; r.T = Z; r.team = "zombie"; r.ai = "zombie";
    r.dead = false; r.dying = null; r.cause = null; r.turn = 0; r.inf = 0; r.heat = 0; r.cold = 0; r.crush = 0;
    r.breath = CFG.breath; r.shock = 0; r.ko = false; r.melt = 0; r.frozen = false;
    r.blood = 100; r.bleedRate = 0; r.lung = 0; r.sufc = 0; r.rad = 0; r.tox = 0; r.scald = 0; r.hunger = 0; r.pain = 0; r.fear = 0;
    for (const l of LIMBS) { r.lh[l] = Math.max(r.lh[l], r.lmax[l] * 0.7); }
    r.base = baseColor(Z, r.col);
    r.stun = Math.max(r.stun, 30); r.grudge = 0; r.grudgeT = 0;
    if (controlled === r) controlled = nextPlayer(r);
  }
  // Brings a ragdoll back: heals everything, mends bones, regrows limbs
  function reviveRagdoll(r) {
    for (let i = FRAGS.length - 1; i >= 0; i--) if (FRAGS[i].owner === r.id) removeFragment(FRAGS[i]);
    for (const part of r.parts) part.gone = false;
    for (const q of r.p) { q.gone = false; q.pin = 0; }
    r.stumps = []; r.stumpBleed = 0; r.bleedRate = 0;
    resetVitals(r, r.T);
    r.dead = false; r.dying = null; r.cause = null; r.turn = 0; r.inf = 0; r.melt = 0; r.frozen = false; r.kill = false;
    r.blood = 100; r.lung = 0; r.sufc = 0; r.rad = 0; r.tox = 0; r.scald = 0; r.heat = 0; r.cold = 0; r.burn = 0; r.shock = 0; r.zap = 0;
    r.breath = CFG.breath; r.pain = 0; r.fear = 0; r.hunger = Math.min(r.hunger, 30); r.crush = 0; r.faint = false;
    r.ko = false; r.stun = 40; r.rec = 0; r.atk = 0; r.block = 0; r.crouch = 0; r.stag = 0;
    r.base = baseColor(r.T, r.col);
  }
  function zonePoint(b, zone) {   // where a melee hit lands
    const P = b.p, z = Math.random();
    const torso = { x: (P[NECK].x + P[HIP].x) / 2, y: (P[NECK].y + P[HIP].y) / 2 };
    const leg = () => { const i = Math.random() < 0.5 ? KNEEL : KNEER; return P[i].gone ? torso : P[i]; };
    const arm = () => { const i = Math.random() < 0.5 ? ELBL : ELBR; return P[i].gone ? torso : P[i]; };
    if (zone === "lower") return z < 0.7 ? leg() : torso;
    if (zone === "upper") return z < 0.35 ? (P[HEAD].gone ? torso : P[HEAD]) : z < 0.8 ? torso : arm();
    if (z < 0.25) return P[HEAD].gone ? torso : P[HEAD];
    if (z < 0.6) return torso;
    return z < 0.8 ? arm() : leg();
  }
  // ---------- Fighting ----------
  function strike(a, b, A) {
    const T = a.T, dir = Math.sign(b.p[HIP].x - a.p[HIP].x) || a.face;
    if (b.iframes > 0) return;
    let dmg = T.dmg * A.dmg * (0.8 + Math.random() * 0.4) * (1 + 0.15 * a.combo) * (a.stam < 15 ? 0.7 : 1);
    let kb = T.kb * A.kb / b.T.mass;
    const blocked = b.block > 0 && b.face === -dir && !isDown(b);
    if (blocked) {                                   // a block soaks most of it
      dmg *= 0.25; kb *= 0.4; b.stam = Math.max(0, b.stam - 10);
      for (const q of b.p) { q.px -= dir * kb; }
      b.grudge = a.id; b.grudgeT = 300; b.lastFrom = a.p[HIP].x;
      if (dmg > 0.5) addPain(b, dmg, "armL");
      a.combo = 0;
      return;
    }
    for (const q of b.p) { q.px -= dir * kb; q.py += 0.1; }
    b.stag = 18; b.stagDir = dir; b.iframes = 8; b.lastFrom = a.p[HIP].x;
    b.grudge = a.id; b.grudgeT = 300;
    if (b.eat) endEat(b);
    if (b.carry) releaseCarry(b, false);
    b.fear = Math.min(100, b.fear + 10 + dmg * 0.5);
    const z = zonePoint(b, A.zone), headHit = z === b.p[HEAD];
    const cause = a.team === "zombie" ? "bite" : "punch";
    damage(b, dmg, cause, z.x, z.y);
    a.combo = Math.min(4, a.combo + 1); a.comboT = 45;
    if (!b.dead) {
      if (dmg > b.lmax.torso * 0.18) { b.stun = Math.max(b.stun, 25); b.stag = 0; }   // a heavy blow knocks him down
      if (Math.random() < (T.ko || 0.1) * (headHit ? 2 : 1) * A.kb / b.T.mass) knockOut(b, 90 + ((Math.random() * 90) | 0));
    }
    if (a.team === "zombie" && b.team === "human" && !isDown(b) && !b.inf && Math.random() < 0.4) { b.inf = 300; b.infCol = a.col; }   // infected
    if (Math.random() < 0.3) splat(b, 1);
  }
  function pickAttack(r) {
    const moves = r.T.moves;
    let t = moves[(Math.random() * moves.length) | 0];
    if (r.combo >= 2 && moves.indexOf("cross") >= 0) t = "cross";                 // finish the combo
    if (ATTACKS[t].limb === "leg" && (legBad(r, -1) || legBad(r, 1) || r.stam < 20)) t = moves[0];
    return t;
  }
  function startAttack(r, type, target) {
    const A = ATTACKS[type], T = r.T;
    if (!A) return false;
    if (A.limb === "arm" && !(armOk(r, -1) || armOk(r, 1))) return false;
    r.atk = A.dur; r.atkDur = A.dur; r.atkType = type; r.target = target || null;
    r.atkSide = (type === "cross" ? -1 : 1) * (r.face >= 0 ? 1 : -1);
    r.stam = Math.max(0, r.stam - A.cost);
    r.cool = Math.round(T.cool * (r.stam < 20 ? 1.6 : 1) * (r.combo >= 1 ? 0.6 : 1));
    return true;
  }
  function attackStep(r) {
    const A = ATTACKS[r.atkType];
    if (!A) { r.atk = 0; return; }
    const P = r.p, H = P[HIP], N = P[NECK], S = r.sc, T = r.T;
    const elapsed = r.atkDur - r.atk;
    r.atk--;
    const tgt = r.target && !isDown(r.target) ? r.target : null;
    const dir = tgt ? (Math.sign(tgt.p[HIP].x - H.x) || r.face) : r.face;
    r.face = dir;
    const tp = tgt ? tgt.p[NECK] : { x: N.x + dir * T.reach * 0.8 * S, y: N.y - 0.5 * S };
    const wind = elapsed < A.hit, striking = elapsed >= A.hit && elapsed < A.hit + 5;
    if (r.atkType === "smash") {   // overhead smash with both fists
      if (!armOk(r, -1) && !armOk(r, 1)) { r.atk = 0; return; }
      for (const side of [-1, 1]) {
        if (!armOk(r, side)) continue;
        const hand = P[side < 0 ? HANDL : HANDR], elb = P[side < 0 ? ELBL : ELBR];
        if (wind) { pull(hand, N.x - dir * 0.4 * S + side * 0.5 * S, N.y - 4.2 * S, 0.4); pull(elb, N.x + side * 1.0 * S, N.y - 2.0 * S, 0.3); pull(N, H.x - dir * 0.8 * S, H.y - 4.4 * S, 0.2); }
        else if (striking) { pull(hand, tp.x, tp.y + 1.5 * S, 0.65); pull(elb, (N.x + tp.x) / 2, (N.y + tp.y) / 2, 0.45); pull(N, H.x + dir * 1.4 * S, H.y - 4.0 * S, 0.3); }
      }
    } else if (A.limb === "arm") {
      let side = r.atkSide;
      if (!armOk(r, side)) side = -side;
      if (!armOk(r, side)) { r.atk = 0; return; }
      const hand = P[side > 0 ? HANDR : HANDL], elb = P[side > 0 ? ELBR : ELBL];
      if (wind) { pull(hand, N.x - dir * 1.2 * S, N.y + 1.5 * S, 0.4); pull(elb, N.x - dir * 1.0 * S, N.y + 2.5 * S, 0.3); pull(N, H.x - dir * 0.5 * S, H.y - 4.4 * S, 0.2); }
      else if (striking) { pull(hand, tp.x, tp.y, 0.6); pull(elb, (N.x + tp.x) / 2, (N.y + tp.y) / 2, 0.45); pull(N, H.x + dir * 1.0 * S, H.y - 4.3 * S, 0.3); }
      else pull(hand, N.x + dir * 1.0 * S, N.y + 3 * S, 0.3);
    } else {                          // kick
      const side = dir > 0 ? 1 : -1;
      if (legBad(r, side)) { r.atk = 0; return; }
      const foot = P[side > 0 ? FOOTR : FOOTL], knee = P[side > 0 ? KNEER : KNEEL];
      if (wind) { pull(foot, H.x - dir * 0.5 * S, H.y + 3.2 * S, 0.35); pull(knee, H.x + dir * 1.2 * S, H.y + 2.0 * S, 0.3); pull(N, H.x - dir * 0.8 * S, H.y - 4.4 * S, 0.25); }
      else if (striking) { pull(foot, H.x + dir * A.reach * T.reach * S * 0.9, H.y + 0.6 * S, 0.6); pull(knee, H.x + dir * 1.5 * S, H.y + 1.2 * S, 0.4); }
    }
    if (elapsed === A.hit && tgt &&
        Math.abs(tgt.p[HIP].x - H.x) <= T.reach * S * A.reach * 1.4 && Math.abs(tgt.p[HIP].y - H.y) <= 9 * S) strike(r, tgt, A);
  }
  // ---------- Grabbing and throwing (big ragdolls) ----------
  function startCarry(r, target) {
    if (r.carry || !target || target.heldBy || target.carry) return false;
    const side = (target.p[HIP].x >= r.p[HIP].x) ? 1 : -1;
    const hand = armOk(r, side) ? (side > 0 ? HANDR : HANDL) : (armOk(r, -side) ? (side > 0 ? HANDL : HANDR) : -1);
    if (hand < 0) return false;
    r.carry = { target: target, t: 0, state: "reach", hand: hand, side: side };
    r.face = side; r.stam = Math.max(0, r.stam - 20); r.cool = r.T.cool;
    return true;
  }
  function releaseCarry(r, thrown) {
    const C = r.carry;
    if (!C) return;
    const t = C.target;
    r.carry = null;
    if (t && t.heldBy === r.id) {
      t.heldBy = 0;
      if (thrown && !t.dead) {   // let go with a big swing
        const p = CFG.throwPower;
        for (const q of t.p) { q.px -= C.side * 1.9 * p; q.py += 1.2 * p; }
        t.thrownT = 50; t.thrownDmg = 16 * (r.T.dmg / 24) * p; t.thrower = r.id;
        t.stun = Math.max(t.stun, 20); t.fear = 100; addPain(t, 10, "torso");
      }
    }
  }
  function carryStep(r) {
    const C = r.carry, P = r.p, H = P[HIP], N = P[NECK], S = r.sc, t = C.target;
    if (!t || isDown(t) || r.stun > 0 || isDown(r) || !armOk(r, C.side) && !armOk(r, -C.side)) { releaseCarry(r, false); return; }
    C.t++;
    const hand = P[C.hand], elb = P[C.hand === HANDR ? ELBR : ELBL];
    if (C.state === "reach") {
      pull(hand, t.p[NECK].x, t.p[NECK].y, 0.5); pull(elb, (N.x + t.p[NECK].x) / 2, (N.y + t.p[NECK].y) / 2, 0.4);
      if (C.t >= 10) {
        if (Math.hypot(hand.x - t.p[NECK].x, hand.y - t.p[NECK].y) < 4.5 * S && !t.heldBy) {
          t.heldBy = r.id; t.holdIdx = NECK; t.stun = Math.max(t.stun, 30);
          if (t.eat) endEat(t);
          if (t.carry) releaseCarry(t, false);
          t.fear = 100; C.state = "lift"; C.t = 0;
        } else { releaseCarry(r, false); return; }
      }
    } else if (C.state === "lift") {
      pull(hand, H.x + C.side * 0.6 * S, H.y - 6.8 * S, 0.3); pull(elb, H.x + C.side * 1.2 * S, H.y - 3.6 * S, 0.3);
      pull(N, H.x - C.side * 0.6 * S, H.y - 4.4 * S, 0.2);
      t.stun = Math.max(t.stun, 15);
      if (C.t >= 26) { C.state = "throw"; C.t = 0; }
    } else {   // throw: swing the arm forward and let go
      pull(hand, H.x + C.side * 7 * S, H.y - 5.5 * S, 0.55); pull(elb, H.x + C.side * 3 * S, H.y - 4.5 * S, 0.45);
      pull(N, H.x + C.side * 1.6 * S, H.y - 4.1 * S, 0.3);
      if (C.t >= 7) { releaseCarry(r, true); }
    }
  }

  // ---------- Physics ----------
  function nudge(p, dx, dy, f) { p.x += dx; p.y += dy; p.px += dx * f; p.py += dy * f; }
  function pull(p, tx, ty, k, f) { nudge(p, (tx - p.x) * k, (ty - p.y) * k, f === undefined ? 0.6 : f); }
  function unstick(p) {
    for (let k = 1; k <= 8; k++) { if (!solidAt(p.x, p.y - k)) { p.y -= k; p.py = p.y; return; } }
  }
  // Moves a point with gravity; records how hard it hit something (p.imp = impact speed, p.impVert = it was a vertical hit)
  function integrate(p, g, drag) {
    let vx = (p.x - p.px) * drag, vy = (p.y - p.py) * drag + g;
    const sp = Math.hypot(vx, vy), lim = vy > 0 ? CFG.maxFall : CFG.maxSpeed;
    if (sp > lim) { const s = lim / sp; vx *= s; vy *= s; }
    p.px = p.x; p.py = p.y;
    if (solidAt(p.x, p.y)) unstick(p);
    let nx = p.x, ny = p.y, bx = false;
    let n = Math.max(1, Math.ceil(Math.abs(vx) / 0.9));
    for (let i = 0; i < n; i++) { const t = nx + vx / n; if (solidAt(t, ny)) { bx = true; break; } nx = t; }
    n = Math.max(1, Math.ceil(Math.abs(vy) / 0.9));
    let hitY = false;
    for (let i = 0; i < n; i++) { const t = ny + vy / n; if (solidAt(nx, t)) { hitY = true; break; } ny = t; }
    if (hitY) {
      nx = p.x + (nx - p.x) * (p.fric === undefined ? CFG.friction : p.fric);
      if (solidAt(nx, ny)) nx = p.x;
    }
    let imp = 0, vert = false;
    if (bx) imp = Math.abs(vx);
    if (hitY && Math.abs(vy) > imp) { imp = Math.abs(vy); vert = true; }
    p.imp = imp; p.impVert = vert;
    p.x = nx; p.y = ny;
  }
  function collide(p) {
    if (!solidAt(p.x, p.y)) return;
    if (!solidAt(p.x, p.sy)) p.y = p.sy;
    else if (!solidAt(p.sx, p.y)) p.x = p.sx;
    else { p.x = p.sx; p.y = p.sy; }
  }
  function solveConstraints(P, cons, pin, iters) {
    for (const p of P) { p.sx = p.x; p.sy = p.y; }
    for (let it = 0; it < iters; it++) {
      for (const c of cons) {
        const A = P[c[0]], B = P[c[1]], len = c[2];
        if (A.gone || B.gone) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1e-4;
        if (c[3] && d >= len) continue;
        const diff = (d - len) / d;
        let wa = 0.5, wb = 0.5;
        if (c[0] === pin) { wa = 0; wb = 1; } else if (c[1] === pin) { wa = 1; wb = 0; }
        A.x += dx * diff * wa; A.y += dy * diff * wa;
        B.x -= dx * diff * wb; B.y -= dy * diff * wb;
      }
      for (const p of P) { if (!p.gone) collide(p); }
    }
  }
  // How much of him is under liquid?
  function submersion(r) {
    const P = r.p;
    let n = 0, live = 0;
    for (const q of P) { if (q.gone) continue; live++; if (wetAt(q.x, q.y)) n++; }
    const frac = live ? n / live : 0;
    return { n: n, frac: frac, head: !!wetAt(P[HEAD].x, P[HEAD].y), hip: !!wetAt(P[HIP].x, P[HIP].y), full: frac >= 0.9 };
  }

  // ---------- Flailing (falling = gentle flail, electric shock = insane flail) ----------
  function flailPull(q, anchor, tx, ty, k) {
    const dx = (tx - q.x) * k, dy = (ty - q.y) * k;
    nudge(q, dx, dy, 0.6);
    nudge(anchor, -dx * 0.1, -dy * 0.1, 0.6);   // tiny equal-and-opposite reaction: flailing is internal, not an external force
  }
  function flailLimbs(r, inten) {
    if (inten < 0.02) return;
    const P = r.p, H = P[HIP], N = P[NECK], S = r.sc;
    if (!r.fl) {
      const rnd = (a, b) => a + Math.random() * (b - a);
      r.fl = { t: 0, ph: [0, 1, 2, 3].map(() => rnd(0, 6.283)), ph2: [0, 1, 2, 3].map(() => rnd(0, 6.283)),
               fr: [0, 1, 2, 3].map(() => rnd(0.8, 1.3)) };
    }
    const lo = Math.min(1, inten), hi = Math.max(0, inten - 1);   // 0..1 = fall flail, above 1 = shock flail
    const f = r.fl;
    f.t += 0.15 + 0.1 * lo + 0.35 * hi;
    const A = 0.25 + 0.45 * lo + 1.2 * hi;        // swing amplitude (radians)
    const k = 0.06 + 0.14 * lo + 0.3 * hi;        // how hard the limbs are driven
    const limbs = [
      { mid: ELBL,  end: HANDL, anc: N, base: -Math.PI / 2 - 1.0, len: 3 * S,   i: 0, a: A, lb: "armL" },
      { mid: ELBR,  end: HANDR, anc: N, base: -Math.PI / 2 + 1.0, len: 3 * S,   i: 1, a: A, lb: "armR" },
      { mid: KNEEL, end: FOOTL, anc: H, base: Math.PI / 2 + 0.3,  len: 3.5 * S, i: 2, a: A * 0.8, lb: "legL" },
      { mid: KNEER, end: FOOTR, anc: H, base: Math.PI / 2 - 0.3,  len: 3.5 * S, i: 3, a: A * 0.8, lb: "legR" },
    ];
    for (const L of limbs) {
      if (P[L.mid].gone || r.broken[L.lb]) continue;   // broken limbs just hang
      const th = L.base + Math.sin(f.t * f.fr[L.i] + f.ph[L.i]) * L.a;
      const bend = Math.sin(f.t * f.fr[L.i] * 1.3 + f.ph2[L.i]) * 0.9 * Math.min(1, inten);
      const mx = L.anc.x + Math.cos(th) * L.len, my = L.anc.y + Math.sin(th) * L.len;
      const ex = mx + Math.cos(th + bend) * L.len, ey = my + Math.sin(th + bend) * L.len;
      flailPull(P[L.mid], L.anc, mx, my, k);
      if (!P[L.end].gone) flailPull(P[L.end], L.anc, ex, ey, k);
    }
  }

  // ---------- Weight of loose material piled on top ----------
  function applyWeight(P, S) {
    let worst = 0;
    for (const idx of [HEAD, NECK, HIP]) {
      const q = P[idx], cx = Math.floor(q.x), cy = Math.floor(q.y);
      let load = 0, gap = 0;
      for (let k = 1; k <= 16 * S; k++) {
        const gy = cy - k;
        if (gy < 0 || cx < 0 || cx > width) break;
        const px = pixelAt(cx, gy);
        if (!px) { if (++gap > 2) break; continue; }
        gap = 0;
        if (px.element === "ragdoll_body") continue;
        const e = elements[px.element];
        if (e && e.state === "solid" && e.behavior && e.behavior !== behaviors.WALL) load++; else break;
      }
      if (load) { q.py -= Math.min(load, 8) * 0.015; if (load > worst) worst = load; }
    }
    return Math.min(worst, 8);
  }

  // ---------- Eating: crouch, grab food with both hands into a ball, lift it to the head, eat it ----------
  const BALL_SLOTS = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [-1, 1], [0, -1], [1, -1]];
  function foodValueOf(p) {
    if (!p || p.element === "ragdoll_body" || p.carried) return 0;
    if (FOODVAL[p.element] !== undefined) return FOODVAL[p.element];
    const e = elements[p.element];
    return (e && e.category === "food") ? 15 : 0;
  }
  function findFood(r, range) {
    const H = r.p[HIP], S = r.sc, hx = Math.floor(H.x), hy = Math.floor(H.y), vr = Math.ceil(8 * S);
    let best = null, bd = Infinity;
    for (let dx = -range; dx <= range; dx++) {
      const gx = hx + dx;
      if (gx < 0 || gx > width) continue;
      for (let dy = -vr; dy <= vr; dy++) {
        const gy = hy + dy;
        if (gy < 0 || gy > height) continue;
        const p = pixelAt(gx, gy);
        if (p && foodValueOf(p) > 0) { const d = Math.abs(dx) + Math.abs(dy) * 0.5; if (d < bd) { bd = d; best = p; } }
      }
    }
    return best;
  }
  function nearestFoodTo(fx, fy, rad) {
    let best = null, bd = Infinity;
    for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
      const gx = Math.floor(fx) + dx, gy = Math.floor(fy) + dy;
      if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
      const p = pixelAt(gx, gy);
      if (p && foodValueOf(p) > 0) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = p; } }
    }
    return best;
  }
  function canEat(r) {
    return !isDown(r) && !r.eat && !r.carry && r.eatCool <= 0 && r.stun <= 0 && armOk(r, -1) && armOk(r, 1) &&
           !legBad(r, -1) && !legBad(r, 1) && (r.air || 0) < 3 && r.sub.frac < 0.3 && !(grab && grab.r === r) && !r.heldBy;
  }
  function beginEat(r, food) {
    r.eat = { state: "crouch", t: 0, fx: food.x + 0.5, fy: food.y + 0.5, bx: food.x + 0.5, by: food.y + 0.5, carried: [], want: 6, g: 0, bite: 0, noMore: false };
  }
  function endEat(r) {
    const E = r.eat;
    if (E) for (const px of E.carried) if (px) px.carried = 0;
    r.eat = null; r.eatCool = 250;
  }
  function stepPixelToward(px, tx, ty) {
    if (px.x === tx && px.y === ty) return;
    const sx = Math.sign(tx - px.x), sy = Math.sign(ty - px.y);
    for (const t of [[sx, sy], [sx, 0], [0, sy]]) {
      if (!t[0] && !t[1]) continue;
      const nx = px.x + t[0], ny = px.y + t[1];
      if (nx < 0 || nx > width || ny < 0 || ny > height) continue;
      if (!pixelMap[nx][ny]) { pixelMap[px.x][px.y] = undefined; pixelMap[nx][ny] = px; px.x = nx; px.y = ny; return; }
    }
  }
  function moveCarried(E) {
    for (let i = 0; i < E.carried.length; i++) {
      const px = E.carried[i], s = BALL_SLOTS[i % BALL_SLOTS.length];
      const tx = Math.floor(E.bx) + s[0], ty = Math.floor(E.by) + s[1];
      stepPixelToward(px, tx, ty); stepPixelToward(px, tx, ty);   // two steps a tick: the ball keeps up with the hands
    }
  }
  function eatPixel(r, px) {
    const val = foodValueOf({ element: px.element });
    px.carried = 0;
    removePixel(px);
    r.hunger = Math.max(0, r.hunger - (val || 15) * 0.5);
    r.blood = Math.min(100, r.blood + 2);
    r.pain = Math.max(0, r.pain - 3);
    for (const l of LIMBS) if (!r.broken[l]) r.lh[l] = Math.min(r.lmax[l], r.lh[l] + r.lmax[l] * 0.02);
    if (BADFOOD[px.element]) r.tox += 30;
  }
  function eatStep(r) {
    const E = r.eat, P = r.p, S = r.sc, N = P[NECK], HD = P[HEAD];
    E.t++;
    if (isDown(r) || r.stun > 0 || (grab && grab.r === r) || r.heldBy || !armOk(r, -1) || !armOk(r, 1) || (r.air || 0) >= 3 || E.t > 400) { endEat(r); return; }
    E.carried = E.carried.filter(px => pixelMap[px.x] && pixelMap[px.x][px.y] === px && px.element !== "ragdoll_body");
    const hands = (tx, ty) => {   // both hands cup the food between them
      pull(P[HANDL], tx - 0.7 * S, ty, 0.4); pull(P[HANDR], tx + 0.7 * S, ty, 0.4);
      pull(P[ELBL], (N.x + tx) / 2 - S, (N.y + ty) / 2, 0.25); pull(P[ELBR], (N.x + tx) / 2 + S, (N.y + ty) / 2, 0.25);
    };
    if (E.state === "crouch") {
      r.crouch = Math.min(1, r.crouch + 0.07);
      hands(E.fx, E.fy);
      if (r.crouch >= 0.95) E.state = "gather";
    } else if (E.state === "gather") {
      hands(E.bx, E.by);
      if (E.t % 3 === 0 && E.carried.length < E.want && !E.noMore) {
        const p = nearestFoodTo(E.fx, E.fy, 5);
        if (p) { p.carried = r.id; E.carried.push(p); } else E.noMore = true;   // grouping the food together
      }
      moveCarried(E);
      if (E.carried.length >= E.want || (E.noMore && E.carried.length > 0)) { E.state = "lift"; E.g = 0; }
      else if (E.noMore) endEat(r);
    } else if (E.state === "lift") {
      E.g = Math.min(1, E.g + 0.04);
      const mx = HD.x + r.face * S, my = HD.y + S;
      E.bx = E.fx + (mx - E.fx) * E.g; E.by = E.fy + (my - E.fy) * E.g;
      r.crouch = Math.max(0, r.crouch - 0.05);
      hands(E.bx, E.by); moveCarried(E);
      if (E.g >= 1) E.state = "eat";
    } else if (E.state === "eat") {
      E.bx = HD.x + r.face * S; E.by = HD.y + S;
      hands(E.bx, E.by); moveCarried(E);
      pull(HD, HD.x, HD.y + 0.6 * S, 0.1);   // chewing
      if (++E.bite % 8 === 0) { const px = E.carried.pop(); if (px) eatPixel(r, px); }
      if (!E.carried.length) endEat(r);
    }
  }

  // ---------- Intelligence ----------
  // Different team colours fight each other; otherwise the old rules apply (zombies vs the living, fighters/guards vs zombies)
  function isEnemy(a, b) {
    if (a === b || isDown(b)) return false;
    if (a.col !== "none" && b.col !== "none") {
      if (a.col === b.col) return CFG.friendlyFire && a.grudge === b.id && a.grudgeT > 0;
      return CFG.teamsFight;
    }
    if (a.ai === "zombie") return b.team !== "zombie";
    if (a.ai === "fighter" || a.ai === "guard") return b.team === "zombie" || (a.grudge === b.id && a.grudgeT > 0);
    if (a.grudge === b.id && a.grudgeT > 0 && a.fear < courageOf(a)) return true;   // a cornered human fights back
    return false;
  }
  function isThreat(a, b) {
    return (b.team === "zombie" && a.team !== "zombie") || (a.grudge === b.id && a.grudgeT > 0 && b.T.dmg > 0);
  }
  function courageOf(r) { return r.T.courage * (0.5 + 0.5 * vitality(r)) + r.cour; }
  // What lies ahead if I keep walking in direction dir?
  function lookAhead(r, dir) {
    const S = r.sc, FL = r.p[FOOTL], FR = r.p[FOOTR], H = r.p[HIP];
    const fy = Math.max(FL.y, FR.y), fx = H.x, rowFoot = Math.floor(fy);
    const reachX = Math.ceil(6 * S);
    for (let dx = 2; dx <= reachX; dx++) {
      const gx = Math.floor(fx + dir * dx);
      if (gx < 0 || gx > width) return "wall";
      for (let k = -Math.ceil(8 * S); k <= 1; k++) {
        const gy = rowFoot + k;
        if (gy < 0 || gy > height) continue;
        if (hazardPixel(pixelAt(gx, gy))) return "hazard";
      }
    }
    const ox = fx + dir * 2.5 * Math.max(1, S * 0.8);
    let hgt = 0;
    while (hgt < 14 * S && solidAt(ox, fy - 0.3 - hgt)) hgt++;
    if (hgt >= 1) return hgt <= 3 * S ? "step" : hgt <= 5.5 * S ? "jump" : "wall";
    const gx2 = fx + dir * 4 * S;
    let ground = false, wet = false, gk = 0;
    for (let k = 0; k < 14 * S; k++) {
      const yy = fy + 0.7 + k;
      if (liquidAt(gx2, yy)) wet = true;
      if (solidAt(gx2, yy)) { ground = true; gk = k; break; }
    }
    if (!ground || gk > 6 * S) return "cliff";     // a drop of more than ~6 cells is a cliff
    if (wet) return "water";
    return null;
  }
  function think(r) {
    const T = r.T, S = r.sc, H = r.p[HIP], HD = r.p[HEAD];
    r.wantJump = false; r.wantAttack = false; r.wantGrab = false; r.run = 1; r.target = null;
    if (r.grudgeT > 0) r.grudgeT -= 5;
    const swimmingNow = r.sub.frac >= 0.3;
    if (swimmingNow && !T.undead) r.wantJump = r.sub.head || r.breath < CFG.breath * 0.8;     // smart: head back above the water

    // What can I see? Enemies, threats and friends; and how scary is it all?
    let enemy = null, ed = Infinity, threat = null, td = Infinity, friend = null, fd = Infinity;
    const mine = T.dmg * Math.sqrt(T.mass) + 5;
    for (const o of RD) {
      if (o === r) continue;
      const dist = Math.hypot(o.p[HIP].x - H.x, o.p[HIP].y - H.y);
      if (dist > CFG.sight * Math.max(1, S * 0.8)) continue;
      if (o.dead) {   // seeing a dead friend is frightening (once)
        if (o.team === r.team && !r.seen[o.id] && dist < 18) { r.seen[o.id] = 1; r.fear = Math.min(100, r.fear + 25); }
        continue;
      }
      if (o.dying) continue;
      if (isEnemy(r, o) && dist < ed) { ed = dist; enemy = o; }
      if (isThreat(r, o) && dist < td) { td = dist; threat = o; }
      if (!isEnemy(r, o) && !isThreat(r, o) && (o.ai === "fighter" || o.ai === "guard" || o.ai === "player") && o.fear < 40 && dist < fd) { fd = dist; friend = o; }
      if ((isEnemy(r, o) || isThreat(r, o)) && !T.undead && CFG.fearEnabled) {
        const power = o.T.dmg * Math.sqrt(o.T.mass);
        r.fear = Math.min(100, r.fear + Math.min(8, (power / mine) * 20 / (dist + 5)));
      }
    }
    const vit = vitality(r);
    const scared = CFG.fearEnabled && !T.undead && r.fear > courageOf(r);
    const hurt = vit < 0.3 || r.pain > 80;
    let mode = "wander", dir = r.dir;
    const danger = threat || enemy;
    if (r.dodge > 0) mode = "dodge";
    else if (scared && (danger || r.fearSrc !== undefined)) mode = "flee";
    else if (enemy && (r.ai === "zombie" || !hurt)) mode = "chase";
    else if (threat && (r.ai === "wander" || hurt)) mode = "flee";
    if (mode !== "wander" && r.eat) endEat(r);

    // Fighting reactions: block or dodge an incoming blow
    if (enemy && enemy.atk > 0 && enemy.target === r && ed < enemy.T.reach * enemy.sc * 1.8 && r.block <= 0 && r.dodge <= 0 && !T.undead) {
      if ((armOk(r, -1) || armOk(r, 1)) && r.stam > 15 && Math.random() < T.block) r.block = 16;
      else if (Math.random() < T.dodge) { r.dodge = 10; r.dodgeDir = -(Math.sign(enemy.p[HIP].x - H.x) || 1); mode = "dodge"; }
    }

    if (mode === "dodge") {
      dir = r.dodgeDir; r.run = 1.5;
    } else if (mode === "chase") {
      const dx = enemy.p[HIP].x - H.x, dy = enemy.p[HIP].y - H.y, reach = T.reach * S;
      dir = Math.abs(dx) > reach * 0.7 ? Math.sign(dx) : (Math.random() < 0.15 ? -Math.sign(dx) : 0);   // keep distance, sometimes back off
      if (Math.abs(dx) <= reach * 1.2 && Math.abs(dy) <= 8 * S) {
        r.wantAttack = true; r.target = enemy; r.face = Math.sign(dx) || r.face;
        if (r.ai === "guard" && enemy.T.mass < T.mass * 0.8 && Math.abs(dx) <= reach * 0.8 && r.stam > 30 && Math.random() < 0.3) r.wantGrab = true;   // pick him up
      }
      if (dy < -4 * S && Math.abs(dx) < reach * 1.5) r.wantJump = true;   // target above me: jump
      r.run = r.ai === "zombie" ? 1 : (r.stam > 25 ? 1.25 : 0.9);
    } else if (mode === "flee") {
      const src = danger ? danger.p[HIP].x : r.fearSrc;
      let away = -(Math.sign(src - H.x) || 1);
      if (friend && danger && Math.abs(friend.p[HIP].x - H.x) > 3 && Math.sign(friend.p[HIP].x - H.x) === away) away = Math.sign(friend.p[HIP].x - H.x);   // run toward a protector
      dir = away; r.run = 1.4;
      if (r.fear > 95 && (r.age % 40) < 6) dir = -dir;                                                           // panicked, erratic
      if (r.fear > 85 && td < 14 && Math.random() < 0.05 && r.cower <= 0) r.cower = 60;                          // cornered: cower
    } else if (r.eat) {
      dir = 0;                                                            // busy eating
    } else {
      let hungry = null;
      if (r.hunger > 35 && !T.undead && canEat(r) && (r.age + r.id * 7) % 4 === 0) hungry = findFood(r, 30);
      if (hungry) {                                                       // walk to the food, then crouch and eat it
        const dx = hungry.x + 0.5 - H.x, dy = hungry.y + 0.5 - H.y;
        if (Math.abs(dx) <= 3 * S && Math.abs(dy) <= 7 * S) { beginEat(r, hungry); dir = 0; }
        else dir = Math.sign(dx);
      } else {
        if (--r.aiT <= 0) {
          r.aiDir = [-1, -1, 0, 1, 1][(Math.random() * 5) | 0]; r.aiT = 12 + ((Math.random() * 30) | 0);
          if (friend && fd > 28 && Math.random() < 0.5) r.aiDir = Math.sign(friend.p[HIP].x - H.x);                // stay with the group
        }
        dir = r.aiDir;
      }
    }

    // Look where I'm going
    if (dir !== 0) {
      const la = lookAhead(r, dir);
      if (la === "jump") r.wantJump = true;
      else if (la === "hazard" || la === "water" || la === "wall" || la === "cliff") {
        const dumb = r.ai === "zombie" && (la === "cliff" || la === "water");   // zombies shuffle into anything
        const swimmer = la === "water" && swimmingNow;
        if (!dumb && !swimmer) {
          if (mode === "wander") { dir = -dir; r.aiDir = dir; }
          else { dir = 0; if (la === "wall" && mode === "flee") r.wantJump = true; }
        }
      }
    }
    // Stuck while trying to move? Try jumping, or turn around if just wandering
    if (dir !== 0 && ++r.chk >= 8) {
      if (Math.abs(H.x - r.chkX) < 0.6) { if (mode === "wander") { dir = -dir; r.aiDir = dir; } else r.wantJump = true; }
      r.chkX = H.x; r.chk = 0;
    }
    r.dir = dir;
  }

  // ---------- Per-ragdoll simulation ----------
  function scanEnv(P) {
    let maxT = -273, minT = 999, acid = false, poison = false;
    const pt = [], ac = [];
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      let t = -273, a = false;
      const cx = Math.floor(q.x), cy = Math.floor(q.y);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const gx = cx + ox, gy = cy + oy;
        if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
        const px = pixelAt(gx, gy);
        if (!px || px.element === "ragdoll_body") continue;
        if (px.temp > t) t = px.temp;
        if (px.temp < minT) minT = px.temp;
        if (ACID[px.element]) a = true;
        if (POISON[px.element]) poison = true;
      }
      pt.push(t); ac.push(a);
      if (t > maxT) maxT = t;
      if (a) acid = true;
    }
    return { maxT: maxT, minT: minT, acid: acid, poison: poison, pt: pt, ac: ac };
  }
  function sumNear(q, rad, table) {   // total of table[element] over the cells within rad of point q
    let sum = 0;
    const cx = Math.floor(q.x), cy = Math.floor(q.y);
    for (let ox = -rad; ox <= rad; ox++) for (let oy = -rad; oy <= rad; oy++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
      const px = pixelAt(gx, gy);
      if (px && table[px.element]) sum += table[px.element];
    }
    return sum;
  }
  function buriedAround(q) {   // how many of the 9 cells around the head are solid material?
    let n = 0;
    const cx = Math.floor(q.x), cy = Math.floor(q.y);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const px = pixelAt(cx + ox, cy + oy);
      if (!px || px.element === "ragdoll_body") continue;
      const e = elements[px.element];
      if (e && e.state === "solid") n++;
    }
    return n;
  }
  function zapNear(H, HD) {
    return sumNear(H, 3, ELECTRIC) > 0 || sumNear(HD, 3, ELECTRIC) > 0;
  }
  // Status colours laid over the clothes: blue when he can't breathe, pale from blood loss, green when infected...
  function updateTints(r) {
    const t = [];
    if (r.dead) {
      const dc = DEATH_COLOR[r.cause];
      t.push(dc ? [dc, r.cause === "burn" ? 0.75 : 0.55] : [[119, 119, 119], 0.3]);
    } else {
      if (r.inf > 0) t.push([[90, 200, 60], 0.3]);
      if (r.blood < 60) t.push([[225, 225, 225], (60 - r.blood) / 120]);
      const blue = Math.max(r.lung / 100, (CFG.breath - r.breath) / CFG.breath * 0.9, r.sufc / 150);
      if (blue > 0.05) t.push([[55, 95, 220], Math.min(0.85, blue * 0.9)]);   // turning blue
      if (r.ko) t.push([[255, 255, 255], 0.45]);
      if (r.heat > 8) t.push([[40, 30, 25], Math.min(0.5, r.heat / 80)]);       // scorched
    }
    if (r.flash > 0) t.push([[255, 60, 60], 0.7]);
    if (r.zap > 0 && (r.age & 1)) t.push([[255, 255, 140], 0.9]);
    r.tints = t;
  }

  function step(r) {
    const P = r.p, H = P[HIP], N = P[NECK], HD = P[HEAD], FL = P[FOOTL], FR = P[FOOTR];
    const S = r.sc, T = r.T;
    r.age++;
    if (r.flash > 0) r.flash--;
    if (r.eatCool > 0) r.eatCool--;
    if (r.iframes > 0) r.iframes--;
    if (r.comboT > 0 && --r.comboT === 0) r.combo = 0;
    if (r.flinch > 0) r.flinch--;
    if (r.cower > 0) r.cower--;
    if (r.dodge > 0) r.dodge--;
    if (r.block > 0) r.block--;
    if (r.stam < 100) r.stam = Math.min(100, r.stam + 0.35);
    if (r.pain > 0) r.pain = Math.max(0, r.pain - 0.12);
    r.fear = Math.max(0, r.fear - 0.35);

    if (r.dead) {
      if (r.cause === "acid" && --r.melt <= 0) r.kill = true;                 // dissolves away
      if (r.turn > 0 && --r.turn === 0) becomeZombie(r, r.infCol);            // rises as a zombie
    } else if (r.inf > 0 && --r.inf === 0) becomeZombie(r, r.infCol);         // infection finally takes hold

    // ---- Death throes: play out the animation, then really die ----
    const dy = r.dying;
    if (dy) {
      dy.t++;
      if (dy.anim === "panic" && dy.t % 25 === 0) dy.dir = -dy.dir;
      if (dy.anim === "headless" && dy.t % 20 === 0) dy.dir = Math.random() < 0.5 ? -1 : 1;
      if (dy.t >= dy.dur) finalizeDeath(r, dy.cause);
    }

    // ---- Environment: heat, cold, acid, poison, gas, drowning (pixel damage applies even to corpses) ----
    const env = scanEnv(P);
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      if (q.gone) continue;
      if (env.pt[i] >= CFG.burnTemp) {   // charring, pixel by pixel, and the limb itself burns
        const hot = env.pt[i] > 800;
        hurtAt(r, q.x, q.y, hot ? 0.05 : 0.014, 1.8 * S);
        hurtLimb(r, POINT_LIMB[i], (hot ? 0.8 : 0.2) / Math.sqrt(T.mass), "burn");
      }
      if (env.ac[i]) { hurtAt(r, q.x, q.y, 0.02, 2 * S); hurtLimb(r, POINT_LIMB[i], 0.5 / Math.sqrt(T.mass), "acid"); }   // acid eats pixels and limbs
    }
    r.sub = submersion(r);
    if (!r.dead) {
      if (env.maxT >= CFG.burnTemp) r.heat += (env.maxT > 800 ? 4 : env.maxT > 400 ? 2 : 1); else if (r.heat > 0) r.heat -= 0.5;
      if (r.heat > 8) { r.burn = 90; r.fear = Math.min(100, r.fear + 3); }     // on fire: panic
      if (r.sub.hip && env.maxT < 400) { r.heat = Math.max(0, r.heat - 2); r.burn = 0; }   // water puts him out
      if (r.heat >= CFG.burnTicks * (T.burnRes || 1)) die(r, "burn");
      // scalding: hot (but not burning) surroundings slowly cook him
      if (env.maxT >= 60 && env.maxT < CFG.burnTemp) r.scald++; else if (r.scald > 0) r.scald -= 0.5;
      if (r.scald >= 250) die(r, "scald");
      if (env.minT <= CFG.freezeTemp) r.cold++; else if (r.cold > 0) r.cold--;
      if (r.cold >= CFG.freezeTicks) { r.frozen = true; die(r, "freeze"); }
      // poison: liquid poison or rotten food builds up a toxin level
      if (env.poison) r.tox += 0.5;
      if (r.tox > 0) r.tox = Math.max(0, r.tox - 0.05);
      if (r.tox >= 40 && Math.random() < 0.01 && r.stag <= 0) { r.stag = 12; r.stagDir = Math.random() < 0.5 ? -1 : 1; }   // sick: staggers
      if (r.tox >= 100) die(r, "poison");
      if (!T.undead) {
        // choking on bad gas: the lungs fill up; he clutches his throat, coughs and turns blue; eventually he chokes to death
        const gas = sumNear(HD, 2, TOXIC_GAS);
        if (gas > 0) r.lung += Math.min(3, gas * 0.5); else if (r.lung > 0) r.lung = Math.max(0, r.lung - 0.6);
        if (r.lung >= 30 && r.age % 25 === 0 && r.stun <= 0) { r.stag = 10; r.stagDir = Math.random() < 0.5 ? -1 : 1; r.flash = 3; }
        if (r.lung >= 100) die(r, "choke");
        // buried alive: head surrounded by solid material
        if (buriedAround(HD) >= 6) r.sufc++; else if (r.sufc > 0) r.sufc = Math.max(0, r.sufc - 3);
        if (r.sufc >= 150) die(r, "suffocate");
        // drowning
        if (r.sub.head) r.breath--; else r.breath = Math.min(CFG.breath, r.breath + 4);
        if (r.breath <= 0) die(r, "drown");
      }
      // radiation sickness
      const dose = sumNear(H, 2, RADIO);
      if (dose > 0) r.rad += Math.min(2, dose * 0.5); else if (r.rad > 0) r.rad = Math.max(0, r.rad - 0.05);
      if (r.rad >= 100) die(r, "radiation");
      // hunger
      r.hunger = Math.min(150, r.hunger + CFG.hungerRate);
      if (CFG.starve && !T.undead && r.hunger >= 100) { r.lh.torso -= 0.01 * r.lmax.torso / 90; if (r.lh.torso <= 0) { r.lh.torso = 0; die(r, "starve"); } }
      // bleeding: wounds, destroyed pixels and stumps drain the blood; low blood weakens, then faints, then kills
      const loss = ((r.bleedRate || 0) + (r.stumpBleed || 0)) / Math.sqrt(T.mass);
      if (loss > 0.0005) {
        r.blood -= loss;
        r.bleedRate *= 0.997; r.stumpBleed *= 0.9995;        // wounds clot slowly; stumps hardly at all
        if (elements.blood && Math.random() < Math.min(0.6, loss * 3)) {
          const src = r.stumps && r.stumps.length && Math.random() < 0.5 ? P[r.stumps[(Math.random() * r.stumps.length) | 0]] : P[(Math.random() * P.length) | 0];
          const gx = Math.floor(src.x) + ((Math.random() * 3) | 0) - 1, gy = Math.floor(src.y) + ((Math.random() * 3) | 0) - 1;
          if (gx >= 0 && gx <= width && gy >= 0 && gy <= height && !pixelAt(gx, gy)) createPixel("blood", gx, gy);
        }
      } else if (r.blood < 100 && r.hunger < 70) r.blood = Math.min(100, r.blood + 0.003);
      if (r.blood < 15 && !r.faint) { r.faint = true; knockOut(r, 200); } else if (r.blood > 40) r.faint = false;
      if (r.blood <= 0) die(r, "bleed");
      // slow healing: bruises fade and broken bones mend while he is fed and not bleeding
      if (r.hunger < 70 && r.blood > 50 && !(loss > 0.0005)) {
        for (const l of LIMBS) {
          if (r.p[POINT_LIMB.indexOf(l)].gone) continue;
          if (r.broken[l]) { r.mend[l] = (r.mend[l] || 0) + 1; if (r.mend[l] > 1800) { r.broken[l] = false; r.lh[l] = r.lmax[l] * 0.5; } }
          else if (r.lh[l] < r.lmax[l]) r.lh[l] = Math.min(r.lmax[l], r.lh[l] + r.lmax[l] / 6000);
        }
      }
    }
    // A burning ragdoll sets fire to things around him (even for a while after dying)
    if (r.burn > 0) {
      r.burn--;
      if (elements.fire && Math.random() < 0.2) {
        const q = P[(Math.random() * P.length) | 0];
        const gx = Math.floor(q.x) + ((Math.random() * 3) | 0) - 1, gy = Math.floor(q.y) - ((Math.random() * 2) | 0);
        if (gx >= 0 && gx <= width && gy >= 0 && gy <= height && !pixelAt(gx, gy)) createPixel("fire", gx, gy);
      }
    }

    // ---- Electricity: insane flailing, can knock him out or kill him ----
    if (!r.dead) {
      if (zapNear(H, HD)) {
        r.shock++; r.zap = 30; r.stun = Math.max(r.stun, 20);
        if (r.eat) endEat(r);
        if (r.carry) releaseCarry(r, false);
        damageAll(r, 0.3 / Math.sqrt(T.mass), "shock");
        if (!r.ko && r.shock >= CFG.shockKO * Math.sqrt(T.mass)) knockOut(r, CFG.koTicks);
        if (r.shock >= CFG.shockDeath * Math.sqrt(T.mass)) die(r, "shock");
      } else if (r.shock > 0) r.shock = Math.max(0, r.shock - 0.4);
    }
    if (r.zap > 0) {
      r.zap--;
      for (const q of P) { q.px += (Math.random() - 0.5) * 0.6; q.py += (Math.random() - 0.5) * 0.6; }
    }

    // ---- Explosions: knock back, hurt, blast pixels away (which can take limbs off) ----
    {
      let ax = 0, ay = 0, n = 0, bxs = 0, bys = 0;
      const cx = Math.floor(H.x), cy = Math.floor(H.y);
      for (let ox = -6; ox <= 6; ox++) for (let oy = -6; oy <= 6; oy++) {
        const gx = cx + ox, gy = cy + oy;
        if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
        const px = pixelAt(gx, gy);
        if (px && BLAST[px.element]) { ax -= ox; ay -= oy; bxs += gx + 0.5; bys += gy + 0.5; n++; }
      }
      if (n) {
        const m = Math.hypot(ax, ay) || 1;
        const s = Math.min(1.2, 0.3 + m * 0.02) / Math.sqrt(T.mass);
        for (const q of P) { q.px -= ax / m * s; q.py -= ay / m * s - 0.1; }
        hurtAt(r, bxs / n, bys / n, Math.min(3, n * 0.06), 7 * S);
        if (r.eat) endEat(r);
        if (r.carry) releaseCarry(r, false);
        r.fearSrc = bxs / n; r.fear = Math.min(100, r.fear + 50);
        if (!r.dead) {
          damageAll(r, Math.min(120, n * 0.8) / Math.sqrt(T.mass), "explosion");
          if (!r.dead && n >= 30 * T.mass) gib(r);
        }
        if (CFG.canFall) r.stun = Math.max(r.stun, 45);
        else { r.stag = 25; r.stagDir = Math.sign(ax) || r.face; }
      }
    }

    // ---- Who is holding me? (mouse grab or a big ragdoll) ----
    const mouseHeld = !!(grab && grab.r === r);
    if (mouseHeld && P[grab.idx].gone) grab = null;
    let holder = null, pinIdx = -1;
    if (r.heldBy) {
      holder = BYID.get(r.heldBy);
      if (holder && !isDown(holder) && holder.carry && holder.carry.target === r && holder.carry.state !== "reach") {
        pinIdx = r.holdIdx;
        const hh = holder.p[holder.carry.hand], q = P[pinIdx];
        q.x = hh.x; q.y = hh.y; q.px = hh.px; q.py = hh.py;
      } else { r.heldBy = 0; holder = null; }
    }
    const held = (grab && grab.r === r) || pinIdx >= 0;
    const heldIdx = (grab && grab.r === r) ? grab.idx : pinIdx;

    // ---- Locomotion state ----
    const nBad = (legBad(r, -1) ? 1 : 0) + (legBad(r, 1) ? 1 : 0);
    const anim = dy ? dy.anim : null;
    const crawling = nBad >= 2 || anim === "crawl";             // two broken legs: crawl
    const limp = nBad === 1 && !crawling && anim !== "panic" && anim !== "headless";   // one broken leg: limp
    const limpDown = anim === "thrash" || anim === "convulse" || anim === "collapse";
    const down = crawling || limpDown;                           // can't stand

    // ---- Input / AI ----
    let d = 0, jump = false, run = 1, dive = false;
    if (!r.dead && !held) {
      if (dy) {
        d = (anim === "crawl" || anim === "panic" || anim === "headless") ? dy.dir : 0;
        if (anim === "panic") run = 1.6;
        if (anim === "headless") run = 0.6;
        if (anim === "crawl" && nBad < 2 && !armOk(r, -1) && !armOk(r, 1)) d = 0;
      } else if (r.ai === "player") {
        if (r === controlled && !r.eat && !r.carry) {
          if (keys.ArrowLeft) d -= 1;
          if (keys.ArrowRight) d += 1;
          jump = !!keys.ArrowUp;
          const swimmingNow = r.sub.frac >= 0.25;
          if (swimmingNow) dive = !!keys.ArrowDown;
          if (eatReq) { eatReq = false; const f = canEat(r) ? findFood(r, 14) : null; if (f) beginEat(r, f); }
          else if (keys.ArrowDown && !swimmingNow && r.cool <= 0 && r.atk <= 0 && r.stun <= 0) {
            let best = null, bd = Infinity;
            for (const o of RD) {
              if (o === r || isDown(o)) continue;
              const dx = o.p[HIP].x - H.x, dyy = o.p[HIP].y - H.y;
              if (Math.sign(dx) !== r.face && Math.abs(dx) > 2) continue;
              if (Math.abs(dx) <= T.reach * S && Math.abs(dyy) <= 8 * S && Math.abs(dx) < bd) { bd = Math.abs(dx); best = o; }
            }
            startAttack(r, r.combo % 2 === 0 ? "jab" : "cross", best);
          }
        }
      } else if (r.stun <= 0) {
        if (--r.thinkT <= 0) { r.thinkT = 5; think(r); }
        d = r.dir; jump = r.wantJump; run = r.run || 1;
        if (r.dodge > 0) { d = r.dodgeDir; run = 1.5; }
        if (r.wantAttack && r.target && !isDown(r.target) && r.cool <= 0 && r.atk <= 0 && !r.carry && !r.block) {
          if (r.wantGrab) { if (!startCarry(r, r.target)) startAttack(r, pickAttack(r), r.target); }
          else startAttack(r, pickAttack(r), r.target);
        }
      }
    }
    if (r.eat || r.carry || r.block > 0) { if (!r.dead) d = r.dodge > 0 ? d : 0; jump = false; }
    if (r.cower > 0 && !r.dead) { d = 0; jump = false; }
    if (r.stag > 0 && !r.dead && !held) {   // staggering: quick catch-steps (smart ones step away from fire, cliffs and water)
      r.stag--;
      if (r.ai !== "zombie" && r.stagDir !== 0) {
        const la = lookAhead(r, r.stagDir);
        if (la === "hazard" || la === "cliff" || la === "water") r.stagDir = -r.stagDir;
      }
      d = r.stagDir;
    }
    if (d !== 0) r.face = d;
    if (held) r.stun = Math.max(r.stun, 15);                           // hang limp while held

    // ---- Stun / recovery ----
    if (r.stun > 0) { r.stun--; r.rec = 0; if (r.stun <= 0) { r.stun = 0; r.ko = false; } } else r.rec = Math.min(1, r.rec + 0.03);
    if (r.stun > 0) { r.atk = 0; r.block = 0; }
    if (r.cool > 0) r.cool--;

    // ---- Pain: writhing in agony ----
    if (!r.dead && !dy && r.pain >= 85 && r.stun <= 0 && !held) { r.stun = 40; r.stag = 0; r.fear = Math.min(100, r.fear + 20); }

    // ---- Airborne? ----
    let touching = false;
    for (const q of P) if (q.ground) { touching = true; break; }
    r.air = touching ? 0 : (r.air || 0) + 1;
    const airborne = r.air >= 3;
    if (r.airTop === undefined || !airborne) r.airTop = H.y;
    else if (H.y < r.airTop) r.airTop = H.y;
    const swimming = !r.dead && (r.sub.frac >= 0.25 || (r.swimOn && r.sub.n >= 1));
    r.swimOn = swimming;

    r.load = (r.dead || airborne) ? 0 : applyWeight(P, S);
    if (!r.dead) {
      if (r.load >= 7 * T.mass) r.crush = (r.crush || 0) + 1; else if (r.crush > 0) r.crush -= 2;
      if (r.crush > CFG.crushTicks) die(r, "crush");
    }
    const weak = Math.max(0.4, Math.min(1, r.blood / 50)) * (r.hunger > 100 ? 0.7 : 1) * (1 - Math.min(0.4, r.pain / 200));   // blood loss, starvation and pain weaken him
    const str = (r.dead || down) ? 0 : (r.stun > 0 ? 0.03 : r.rec) * Math.max(CFG.canFall ? 0.1 : 0.45, 1 - r.load * 0.1) * weak;

    const anyGround = FL.ground || FR.ground;
    r.slip = false; r.sticky = false;
    for (const f of [FL, FR]) {
      if (!f.ground) continue;
      const gp = pixelAt(Math.floor(f.x), Math.floor(f.y + 0.7));
      if (gp && SLIPPERY[gp.element]) r.slip = true;
      if (gp && STICKY[gp.element]) r.sticky = true;
    }
    if (r.jc > 0) r.jc--;
    if (r.hop > 0) r.hop--;
    const wantCrouch = Math.max(r.eat ? 1 : 0, r.cower > 0 ? 0.7 : 0, r.pain >= 50 ? 0.3 : 0, r.lung >= 25 ? 0.5 : 0);
    if (!r.eat) r.crouch += (wantCrouch - r.crouch) * 0.1; else r.crouch += 0;   // (eating drives the crouch itself)

    // Random stumble while walking
    if (!r.dead && !dy && !held && d !== 0 && anyGround && r.stun <= 0 && r.rec >= 1 && Math.random() < CFG.stumbleChance * (1 + r.pain / 50)) {
      for (const i of [HEAD, NECK, ELBL, HANDL, ELBR, HANDR]) P[i].px -= d * 0.5;
      if (CFG.canFall) r.stun = 28; else { r.stag = 30; r.stagDir = d; }
    }

    // ---- Swimming: float, then swim with real strokes. Fully submerged and awake = no external forces at all ----
    r.supported = false;
    if (swimming && !down && r.stun <= 0 && !held) {
      const ph = r.swimPh = r.swimPh + 0.22 + 0.1 * Math.abs(d), horiz = d !== 0, sd = d || r.face;
      const lead = horiz ? 1 : 0;
      pull(N, H.x + (horiz ? d * 4.2 * S : 0), H.y + (horiz ? -0.8 * S : -4.5 * S), 0.14);   // prone while swimming, upright when treading water
      pull(HD, N.x + (horiz ? d * 1.8 * S : 0), N.y + (horiz ? -0.5 * S : -2 * S), 0.18);
      for (const side of [-1, 1]) {
        if (!armOk(r, side)) continue;
        const a = ph + (side < 0 ? 0 : Math.PI), hand = P[side < 0 ? HANDL : HANDR], elb = P[side < 0 ? ELBL : ELBR];
        const hx = N.x + sd * (1.2 + 2.6 * Math.sin(a)) * S * (lead ? 1 : 0.5), hy = N.y + (horiz ? 1.0 : 1.8) * S + 1.6 * S * Math.cos(a);
        pull(hand, hx, hy, 0.22); pull(elb, (N.x + hx) / 2, (N.y + hy) / 2 + 0.5 * S, 0.2);
      }
      for (let i = 0; i < 2; i++) {   // flutter kick
        if (legBad(r, i === 0 ? -1 : 1)) continue;
        const a2 = ph * 1.6 + (i ? Math.PI : 0), foot = i === 0 ? FL : FR, knee = P[i === 0 ? KNEEL : KNEER];
        const fx = H.x - (horiz ? d * 3.3 * S : 0) + (i ? 0.5 : -0.5) * S, fy = H.y + (horiz ? 0.9 * S * Math.sin(a2) : 3.4 * S + 0.9 * S * Math.sin(a2));
        pull(foot, fx, fy, 0.2); pull(knee, (H.x + fx) / 2, (H.y + fy) / 2, 0.2);
      }
      const thrust = 0.035 * (T.speed || 1) * (1 - r.pain / 250) * (r.stam > 10 ? 1 : 0.5);
      if (horiz) for (const q of P) q.px -= d * thrust * (0.7 + 0.3 * Math.sin(ph * 2));
      if (jump) for (const q of P) q.py += 0.06;            // swim up
      else if (dive) for (const q of P) q.py -= 0.05;       // dive
      else if (r.sub.head) for (const q of P) q.py += 0.045;   // tread water: keep the head above the surface
      r.stam = Math.max(0, r.stam - 0.08);
    } else if (str > 0.001 && !airborne && !swimming) {
      // ---- Balance, walking, jumping (only while on the ground) ----
      const face = r.face, cr = r.crouch;
      const spdTarget = d * (T.speed || 1) * run * (r.stam > 20 || run <= 1 ? 1 : 0.8) * (limp ? 0.4 : 1) * (1 - r.pain / 250);
      r.spd += (spdTarget - r.spd) * 0.15;                     // accelerate and slow down smoothly
      const aspd = Math.abs(r.spd), moving = d !== 0 || aspd > 0.08, sdir = d !== 0 ? Math.sign(d) : Math.sign(r.spd) || face;
      if (moving && anyGround) r.ph += CFG.walkRate * Math.max(0.35, aspd) * (r.stag > 0 ? 1.8 : 1);
      const running = aspd > 1.15;
      const stride = CFG.stride * S * (0.6 + 0.45 * Math.min(1.5, aspd));
      const bob = moving && !limp ? Math.abs(Math.sin(r.ph)) * (running ? 0.6 : 0.3) * S : 0;   // the body rises and dips with each step
      const sway = moving ? Math.sin(r.ph) * 0.35 * S : 0;                                       // torso sway
      const lean = (running ? 1.4 : 0.7) * S * sdir * (moving ? 1 : 0) + face * cr * 1.2 * S + (limp ? (legBad(r, -1) ? 1 : -1) * 1.3 * S : 0);
      pull(N, H.x + lean + sway * 0.4, H.y - 4.5 * S * (1 - 0.1 * cr), 0.45 * str);
      pull(HD, N.x + (running ? sdir * 0.5 * S : 0), N.y - 2 * S, 0.4 * str);

      for (const side of [-1, 1]) {   // arms (a broken arm just hangs)
        if (!armOk(r, side)) continue;
        if (r.eat || r.carry || r.block > 0 || r.atk > 0) continue;   // other actions drive the hands
        const el = P[side < 0 ? ELBL : ELBR], hand = P[side < 0 ? HANDL : HANDR];
        if (r.ai === "zombie") {      // zombie pose: arms stretched out in front
          pull(el, N.x + face * 1.8 * S, N.y + 0.8 * S, 0.25 * str);
          pull(hand, N.x + face * 4.6 * S, N.y + (0.4 + side * 0.4) * S, 0.25 * str);
        } else if (running) {         // running: arms bent and pumping
          const sw = Math.sin(r.ph + (side < 0 ? 0 : Math.PI)) * 2.0 * sdir * S;
          pull(el, N.x + side * 0.4 * S + sw * 0.5, N.y + 2.2 * S, 0.25 * str);
          pull(hand, N.x + side * 0.6 * S + sw, N.y + 3.2 * S - Math.abs(sw) * 0.4, 0.25 * str);
        } else {
          const sw = moving ? Math.sin(r.ph + (side < 0 ? 0 : Math.PI)) * 1.6 * sdir * Math.min(1, aspd + 0.3) * S : 0;
          pull(el, N.x + side * 0.6 * S + sw * 0.5, N.y + 2.8 * S, 0.2 * str);
          pull(hand, N.x + side * 0.9 * S + sw, N.y + 5.3 * S - Math.abs(sw) * 0.3, 0.2 * str);
        }
      }

      // Legs: stance feet push the hip, swing feet lift and step; plant feet to catch a lean (capture point)
      const cap = Math.max(-2.5 * S, Math.min(2.5 * S, (H.x - H.px) * 5 + (N.x - H.x) * 0.6));
      let supportSum = 0, supportN = 0;
      for (let i = 0; i < 2; i++) {
        const foot = i === 0 ? FL : FR, knee = P[i === 0 ? KNEEL : KNEER], bad = legBad(r, i === 0 ? -1 : 1);
        if (bad) {   // broken leg: it just hangs, bent, off the ground
          pull(foot, H.x - sdir * 0.8 * S + (i === 0 ? -0.3 : 0.3) * S, H.y + LEG * S * 0.6, 0.3 * str);
          pull(knee, H.x + sdir * 0.9 * S, H.y + LEG * S * 0.3, 0.3 * str);
          continue;
        }
        const phi = r.ph + i * Math.PI, cs = Math.cos(phi);
        const swing = !limp && moving && cs > 0;
        const off = limp ? 0.1 * S * Math.sin(r.ph) : (moving ? sdir * stride * Math.sin(phi) : (i === 0 ? -0.9 : 0.9) * S + cap);
        const err = off - (foot.x - H.x);
        if (swing) {
          nudge(foot, err * 0.35 * str, 0, 0.6);
          pull(foot, foot.x, H.y + LEG * S * 0.95 - CFG.stepLift * S * (running ? 1.3 : 1) * cs, 0.4 * str);
        } else if (foot.ground) {
          nudge(H, -err * 0.18 * str * (r.slip ? 0.15 : r.sticky ? 0.5 : 1), 0, 0.6);
          if (!moving || limp) nudge(foot, err * 0.12 * str, 0, 0.6);
          supportSum += foot.y - STAND * S * (1 - 0.35 * cr) * (limp ? 0.88 : 1) + bob; supportN++;   // crouching / limping lowers the hips
        } else nudge(foot, err * 0.15 * str, 0, 0.6);
        pull(knee, (H.x + foot.x) / 2 + face * (0.35 + 1.1 * cr) * S, (H.y + foot.y) / 2, 0.3 * str);
      }
      if (supportN > 0) {
        const tgt = supportSum / supportN, deficit = H.y - tgt;
        pull(H, H.x, tgt, (deficit > 0.6 * S ? 0.85 : 0.6) * str, 0.8);
        r.supported = true;
        if (cr < 0.1 && !limp && deficit > 1.0 * S && str > 0.5) {   // stuck low after a landing? small spring-up hop
          r.low = (r.low || 0) + 1;
          if (r.low > 10) { for (const q of P) q.py += 0.6; r.low = 0; }
        } else r.low = 0;
      }
      // limping: hobble along on the good leg with a little hop every step
      if (limp && d !== 0 && anyGround) {
        r.hobT = (r.hobT || 0) + 1;
        if (r.hobT % 22 === 0) for (const q of P) { q.py += 0.55; q.px -= d * 0.5; }
      }

      if (jump && !limp) {
        if (anyGround && r.jc <= 0) { for (const q of P) q.py += CFG.jump * Math.sqrt(S) * (r.sticky ? 0.6 : 1); r.jc = 20; }
      }
      if (moving && anyGround && r.hop <= 0 && !limp) {   // hop up small ledges
        const fy = Math.max(FL.y, FR.y);
        const fx = (sdir > 0 ? Math.max(FL.x, FR.x) : Math.min(FL.x, FR.x)) + sdir * 1.3 * S;
        if (solidAt(fx, fy - 0.4) && !solidAt(fx, fy - 3.2 * S) && !solidAt(H.x + sdir * 1.3 * S, H.y - 1)) {
          for (const q of P) q.py += CFG.hop * Math.sqrt(S) * (r.sticky ? 0.6 : 1);
          r.hop = 15;
        }
      }
    }

    // ---- Crawling: two broken (or missing) legs, or crawling away while dying ----
    if (!r.dead && crawling && !held && r.stun <= 0 && d !== 0 && (armOk(r, -1) || armOk(r, 1)) && !airborne && !swimming) {
      r.crawlT = (r.crawlT || 0) + 1;
      const lead = Math.sin(r.crawlT * 0.4) > 0;
      for (const side of [-1, 1]) {
        if (!armOk(r, side)) continue;
        const hand = P[side < 0 ? HANDL : HANDR], reach = ((side < 0) === lead) ? 4.5 : 1.0;
        pull(hand, H.x + d * reach * S, Math.max(H.y, Math.max(FL.y, FR.y) - 1.5 * S), 0.25);
      }
      if (r.crawlT % 12 === 0) for (const q of P) q.px -= d * 0.45 * (T.speed || 1) * (anim === "crawl" ? 0.8 : 1);   // drag the body forward
    }

    // ---- Falling = gentle flail; shock, thrashing and convulsions = violent flail (even on the ground) ----
    if (!r.dead) {
      if (r.zap > 0) flailLimbs(r, 2.2);
      else if (anim === "thrash") flailLimbs(r, 1.7);
      else if (anim === "convulse") flailLimbs(r, 1.3);
      else if (anim === "collapse") flailLimbs(r, 0.6);
      else if (r.pain >= 85 && r.stun > 0) flailLimbs(r, 0.9);     // writhing in agony
      else if (airborne && !swimming) {
        const sp = Math.hypot(H.x - H.px, H.y - H.py), drop = Math.max(0, H.y - r.airTop);
        flailLimbs(r, Math.max(0, Math.min(1, (sp - 0.6) * 0.35 + drop * 0.01)));
      }
    }
    if (!r.dead && (anim === "convulse" || anim === "thrash")) for (const q of P) { q.px += (Math.random() - 0.5) * 0.35; q.py += (Math.random() - 0.5) * 0.35; }

    // ---- Pain, fear and choking animations ----
    if (!r.dead && !dy && !held && r.stun <= 0) {
      const free = !(r.eat || r.carry || r.atk > 0);
      if (r.flinch > 0) {   // recoil from a hit
        pull(HD, N.x - r.face * 1.0 * S, N.y - 1.4 * S, 0.35);
        if (free) { if (armOk(r, -1)) pull(P[HANDL], N.x - 1.2 * S, N.y + 0.5 * S, 0.3); if (armOk(r, 1)) pull(P[HANDR], N.x + 1.2 * S, N.y + 0.5 * S, 0.3); }
      }
      if (r.lung >= 25 && free && !T.undead) {   // choking: clutches his throat
        const th = { x: HD.x, y: HD.y + 1.6 * S };
        if (armOk(r, -1)) pull(P[HANDL], th.x - 0.6 * S, th.y, 0.35);
        if (armOk(r, 1)) pull(P[HANDR], th.x + 0.6 * S, th.y, 0.35);
        pull(HD, N.x + r.face * 0.6 * S, N.y - 1.5 * S, 0.2);
        if (r.age % 6 === 0) for (const q of P) { q.px += (Math.random() - 0.5) * 0.2; }   // coughing fits
      } else if (r.cower > 0 && free) {          // cowering: arms over the head, trembling
        for (const side of [-1, 1]) if (armOk(r, side)) pull(P[side < 0 ? HANDL : HANDR], HD.x + side * 0.9 * S, HD.y - 0.4 * S, 0.35);
        for (const q of P) { q.px += (Math.random() - 0.5) * 0.12; q.py += (Math.random() - 0.5) * 0.06; }
      } else if (r.pain >= 35 && free) {         // clutching the wound
        const li = LIMB_POINT[r.painLimb], target = P[li].gone ? N : P[li];
        const side = (r.painLimb === "armL") ? 1 : (r.painLimb === "armR") ? -1 : (target.x > H.x ? 1 : -1);
        for (const sd of (r.painLimb === "torso" || r.painLimb === "head") ? [-1, 1] : [side]) if (armOk(r, sd)) pull(P[sd < 0 ? HANDL : HANDR], target.x, target.y, 0.3);
      }
      if (r.fear > 55 && !T.undead && r.cower <= 0) for (const q of P) { q.px += (Math.random() - 0.5) * 0.05; }   // trembling
      if (r.block > 0 && !r.carry) for (const side of [-1, 1]) {   // guard up
        if (armOk(r, side)) { pull(P[side < 0 ? HANDL : HANDR], HD.x + r.face * 1.3 * S, HD.y + (0.2 + side * 0.4) * S, 0.4); pull(P[side < 0 ? ELBL : ELBR], N.x + r.face * 0.8 * S, N.y + 1.6 * S, 0.3); }
      }
    }
    // A broken limb sticks out at an angle
    if (!r.dead) for (const [limb, mid, a, b] of [["armL", ELBL, NECK, HANDL], ["armR", ELBR, NECK, HANDR], ["legL", KNEEL, HIP, FOOTL], ["legR", KNEER, HIP, FOOTR]]) {
      if (!r.broken[limb] || P[mid].gone) continue;
      const A = P[a], B = P[b], dxl = B.x - A.x, dyl = B.y - A.y, ln = Math.hypot(dxl, dyl) || 1;
      const kx = -dyl / ln * 1.6 * S * (limb.endsWith("L") ? -1 : 1), ky = dxl / ln * 1.6 * S * (limb.endsWith("L") ? -1 : 1);
      pull(P[mid], (A.x + B.x) / 2 + kx, (A.y + B.y) / 2 + ky, 0.1);
    }

    // ---- Eating, melee and throwing ----
    if (r.eat) eatStep(r);
    if (r.carry) carryStep(r);
    if (r.atk > 0 && !r.dead) attackStep(r);

    // ---- Thrown through the air: hits whoever is in the way ----
    if (r.thrownT > 0) {
      r.thrownT--;
      for (const o of RD) {
        if (o === r || isDown(o) || o.id === r.thrower) continue;
        if (Math.hypot(o.p[HIP].x - H.x, o.p[HIP].y - H.y) < 4 * Math.max(S, o.sc)) {
          damage(o, 8, "punch", o.p[NECK].x, o.p[NECK].y); o.stag = 20; o.stagDir = Math.sign(o.p[HIP].x - H.x) || 1; o.fear = Math.min(100, o.fear + 25);
          r.thrownT = 0; break;
        }
      }
    }

    // ---- Mouse grab: the held point follows the cursor ----
    if (mouseHeld && grab) {
      const q = P[grab.idx];
      let tx = grab.mx, ty = grab.my;
      if (!grab.moved && typeof mousePos !== "undefined" && mousePos &&
          mousePos.x >= 0 && mousePos.x <= width + 1 && mousePos.y >= 0 && mousePos.y <= height + 1) {
        tx = mousePos.x + 0.5; ty = mousePos.y + 0.5;
      }
      let dx = tx - q.x, dyy = ty - q.y;
      const m = Math.hypot(dx, dyy), capm = 6.0;
      if (m > capm) { dx *= capm / m; dyy *= capm / m; }
      nudge(q, dx, dyy, 1);
      grab.vx = (grab.vx || 0) * 0.5 + dx * 0.5;   // remember cursor speed so letting go can fling him
      grab.vy = (grab.vy || 0) * 0.5 + dyy * 0.5;
    }

    // ---- Integrate, solve, probe ground ----
    const hvx = H.x - H.px;
    for (const q of P) {   // severed points just ride along with the stump
      if (q.gone) { const a = P[q.pin]; q.x = a.x; q.y = a.y; q.px = a.px; q.py = a.py; q.imp = 0; }
    }
    if (r.frozen && touching) {
      for (const q of P) { q.px = q.x; q.py = q.y; q.imp = 0; }   // frozen solid: a statue
    } else {
      const awake = !r.dead && !dy && r.stun <= 0 && !r.ko;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (q.gone) continue;
        if (i === heldIdx) { q.px = q.x; q.py = q.y; q.imp = 0; continue; }
        const foot = (q === FL || q === FR);
        q.fric = (foot && str > 0.3 && q.ground)
          ? (r.slip ? 0.97 : r.sticky ? 0.02 : CFG.footGrip)
          : (r.slip && q.ground ? 0.9 : CFG.friction);
        const lq = wetAt(q.x, q.y);
        let gm = 1, dr = CFG.drag, g = CFG.gravity;
        if (lq) {
          // Buoyancy: he floats. Fully submerged and awake there are no external forces at all (neutral); otherwise he bobs up.
          const dens = (elements[lq.element] && elements[lq.element].density) || 1000;
          const buoy = Math.max(-1.5, 1 - dens / CFG.bodyDensity);
          gm = (r.sub.full && awake) ? buoy * 0.35 : buoy;      // awake and fully under: he only drifts up slowly, so he can dive and swim
          dr = 0.88;
        } else if (swimming || r.sub.n >= 1) gm = 0.35;                   // the part above the surface is held up by the rest of him
        else if (r.supported && !foot) gm = 1 - 0.85 * str;               // legs carry his weight while standing
        if (!lq && !swimming && r.sub.n < 1 && airborne && !held && q.y > q.py) g = CFG.fallGravity;   // strong gravity only while falling
        integrate(q, g * gm, dr);
      }
      solveConstraints(P, r.cons, held ? heldIdx : -1, held ? 12 : CFG.iterations);
    }
    for (const q of P) q.ground = !q.gone && solidAt(q.x, q.y + 0.7);

    // ---- Impacts: damage depends on how FAST each point hit something, and only the limb that hit takes it ----
    if (r.impWin > 0 && --r.impWin === 0) r.impPaid = {};
    if (r.age > 5) {   // (a ragdoll that is being dragged around can still be slammed into things)
      let maxImp = 0, vertical = false;
      const per = {};
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        if (q.gone || !(q.imp > CFG.safeImpact)) continue;
        const f = Math.min(1.3, (q.imp - CFG.safeImpact) / (CFG.maxFall - CFG.safeImpact));
        hurtAt(r, q.x, q.y, f * f * 0.9, 2.2 * S);   // the part that hit gets bruised / broken
        const limb = POINT_LIMB[i];
        const dmg = CFG.impactDamage * f * f / Math.pow(T.mass, 0.7);
        if (!(per[limb] > dmg)) per[limb] = dmg;
        if (q.imp > maxImp) { maxImp = q.imp; vertical = q.impVert; }
      }
      // A thrown ragdoll hits hard even when the throw wasn't fast enough to hurt by speed alone
      if (r.thrownT > 0) {
        let landed = 0;
        for (const q of P) if (!q.gone && q.imp > landed) landed = q.imp;
        if (landed > 0.8 && !r.dead) {
          for (const limb of ["torso", "legL", "legR"]) per[limb] = Math.max(per[limb] || 0, r.thrownDmg * (limb === "torso" ? 1 : 0.6));
          maxImp = Math.max(maxImp, CFG.safeImpact + 0.01); vertical = true;
          r.thrownT = 0; r.stun = Math.max(r.stun, 40);
        }
      }
      if (maxImp > CFG.safeImpact) {
        if (!r.dead) {
          const cause = vertical ? "fall" : "crash";
          // One crash = one hit per limb: tumbling after a landing doesn't stack, only the worst impact in a short window counts
          for (const limb in per) {
            const extra = Math.max(0, per[limb] - (r.impPaid[limb] || 0));
            r.impPaid[limb] = Math.max(r.impPaid[limb] || 0, per[limb]); r.impWin = 20;
            if (extra <= 0) continue;
            hurtLimb(r, limb, extra, cause);
            if (limb === "legL" || limb === "legR") hurtLimb(r, "torso", extra * 0.2, cause);   // a hard landing shakes the spine too
          }
          if (!r.dead && maxImp >= CFG.smashImpact * Math.sqrt(T.mass)) smash(r, "smash");
          if (!r.dead) {
            if (maxImp >= CFG.stunImpact) { r.stun = Math.max(r.stun, Math.min(100, 15 + (maxImp - CFG.stunImpact) * 40)); r.stag = 0; if (r.eat) endEat(r); }
            else if (CFG.canFall) r.stun = Math.max(r.stun, 20);
            else { r.stag = 20; r.stagDir = Math.sign(hvx) || r.face; }
          }
        } else if (maxImp >= CFG.smashImpact) {
          // corpses get smashed too: broken limbs come off
          for (const limb of ["armL", "armR", "legL", "legR"]) if (per[limb] > 30) sever(r, limb + "1");
        }
      }
    }

    // ---- Dismemberment, then draw ----
    checkSever(r);
    updateTints(r);
    stamp(r);
  }

  function stepFrag(f) {
    f.age++;
    if (f.age > f.life) f.kill = true;
    for (const q of f.p) {
      q.fric = CFG.friction;
      const lq = wetAt(q.x, q.y);
      if (lq) integrate(q, CFG.gravity * Math.max(-1.5, 1 - ((elements[lq.element] && elements[lq.element].density) || 1000) / CFG.bodyDensity), 0.9);   // pieces float too
      else integrate(q, q.y > q.py ? CFG.fallGravity : CFG.gravity, 0.99);
    }
    if (f.cons.length) solveConstraints(f.p, f.cons, -1, 3);
    stamp(f);
  }

  // ---------- Elements ----------
  elements.ragdoll_body = {
    color: "#222222", behavior: behaviors.WALL, category: "special", state: "solid",
    hidden: true, excludeRandom: true, desc: "Part of a ragdoll.",
    tick: function (pixel) {
      // Body pixels only survive while their ragdoll (or severed piece) keeps claiming them every tick
      const owner = pixel.rd ? BYID.get(pixel.rd) : null;
      if (!owner || owner.sg !== pixel.sg) deletePixel(pixel.x, pixel.y);
    },
  };
  function spawnTick(name) {
    return function (pixel) {
      const x = pixel.x, y = pixel.y;
      deletePixel(x, y);
      if (Date.now() - lastSpawnTime >= 250) {   // (pixelTicks resets on undo/clear, so don't use it)
        lastSpawnTime = Date.now();
        spawn(x, y, name);
      }
    };
  }
  for (const name of Object.keys(SPAWNS)) {
    elements[name] = {
      color: SPAWNS[name].hex, behavior: behaviors.WALL, category: "ragdolls", state: "solid",
      excludeRandom: true, desc: SPAWNS[name].desc, tick: spawnTick(name),
    };
  }
  elements.ragdoll_grab = {
    color: "#ffd400", category: "tools", excludeRandom: true,
    desc: "Click and drag a ragdoll to pick it up and throw it.",
    tool: function (pixel) {
      if (grab || !pixel || !pixel.rd) return;
      const r = BYID.get(pixel.rd);
      if (!r || r.frag) return;
      const mx = pixel.x + 0.5, my = pixel.y + 0.5;
      let bi = -1, bd = Infinity;
      for (let i = 0; i < r.p.length; i++) {
        if (r.p[i].gone) continue;
        const dd = Math.hypot(r.p[i].x - mx, r.p[i].y - my);
        if (dd < bd) { bd = dd; bi = i; }
      }
      if (bi < 0) return;
      grab = { r: r, idx: bi, mx: mx, my: my, src: "tool", moved: false };
      console.log("[Active Ragdoll] grabbed via tool, point", bi);
    },
  };
  elements.ragdoll_revive = {
    color: "#7dffb0", category: "tools", excludeRandom: true,
    desc: "Brush over a ragdoll (dead or hurt) to revive and fully heal it. Missing limbs grow back.",
    tool: function (pixel) {
      if (!pixel || !pixel.rd) return;
      const o = BYID.get(pixel.rd);
      if (!o) return;
      const r = o.frag ? BYID.get(o.owner) : o;
      if (!r || r.frag) return;
      const now = Date.now();
      if (r.revT && now - r.revT < 200) return;
      r.revT = now;
      reviveRagdoll(r);
    },
  };
  const ALL = Object.keys(SPAWNS).concat(["ragdoll_body", "ragdoll_grab", "ragdoll_revive"]);
  for (const n of ALL) {   // colors the game needs when elements are added after startup
    const e = elements[n];
    if (!e.colorObject && typeof hexToRGB === "function") e.colorObject = [hexToRGB(e.color)];
  }
  // Make the game's regular Drag tool pick up ragdolls (it keeps working normally on everything else)
  if (elements.drag && typeof elements.drag.tool === "function" && !elements.drag.__ragdollWrapped) {
    const origDrag = elements.drag.tool;
    elements.drag.tool = function (pixel) {
      if (pixel && pixel.element === "ragdoll_body") { elements.ragdoll_grab.tool(pixel); return; }
      return origDrag.apply(this, arguments);
    };
    elements.drag.__ragdollWrapped = true;
    elements.ragdoll_grab.hidden = true;
  }

  // ---------- Hooks ----------
  if (typeof runEveryTick !== "function") { console.error("[Active Ragdoll] runEveryTick not available in this version."); return; }
  runEveryTick(function () {
    if (grab && grab.src === "tool" && typeof mouseIsDown !== "undefined" && !mouseIsDown) release();
    for (const r of RD) step(r);
    for (const f of FRAGS) stepFrag(f);
    for (let i = RD.length - 1; i >= 0; i--) if (RD[i].kill) removeRagdoll(RD[i]);
    for (let i = FRAGS.length - 1; i >= 0; i--) if (FRAGS[i].kill) removeFragment(FRAGS[i]);
  });
  if (typeof renderPostPixel === "function") {
    renderPostPixel(function (ctx) {
      if (!CFG.showMarker || !controlled || controlled.dead) return;
      const ps = pixelSize, h = controlled.p[HEAD];
      const cx = Math.floor(h.x), cy = Math.floor(h.y) - 4;
      ctx.fillStyle = "#ffd400";
      for (const o of [[-1, 0], [0, 0], [1, 0], [0, 1]]) ctx.fillRect((cx + o[0]) * ps, (cy + o[1]) * ps, ps, ps);
    });
  }
  if (typeof runAfterReset === "function") {
    runAfterReset(function () { RD.length = 0; FRAGS.length = 0; BYID.clear(); controlled = null; grab = null; });
  }

  // Make sure the buttons exist (console loads happen after the game built its menus)
  const ensureButtons = function () {
    const names = Object.keys(SPAWNS).concat(["ragdoll_revive"]);
    if (!(elements.drag && elements.drag.__ragdollWrapped)) names.push("ragdoll_grab");
    for (const n of names) {
      if (document.getElementById("elementButton-" + n) || typeof createElementButton !== "function") continue;
      try { createElementButton(n); } catch (e) { /* maybe the "ragdolls" category doesn't exist yet */ }
      if (!document.getElementById("elementButton-" + n) && elements[n].category === "ragdolls") {
        elements[n].category = "special";   // fall back to the Special menu
        try { createElementButton(n); } catch (e) { console.warn("[Active Ragdoll] couldn't create button for " + n, e); }
      }
    }
  };
  if (document.querySelector('[id^="elementButton-"]')) ensureButtons();
  else if (typeof runAfterLoad === "function") runAfterLoad(ensureButtons);
  else ensureButtons();

  // ---------- Keyboard ----------
  function typing() {
    const t = document.activeElement && document.activeElement.tagName;
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
  }
  window.addEventListener("keydown", function (e) {
    if (typing() || !RD.length) return;
    if (e.key === "g" || e.key === "G") gHeld = true;
    if (e.key === "e" || e.key === "E") eatReq = true;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      keys[e.key] = true; e.preventDefault();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const nxt = nextPlayer(controlled);
      if (nxt) controlled = nxt;
    }
  });
  window.addEventListener("keyup", function (e) { keys[e.key] = false; if (e.key === "g" || e.key === "G") gHeld = false; });
  window.addEventListener("blur", function () { for (const k in keys) keys[k] = false; gHeld = false; });

  // ---------- Mouse grab (Drag tool, or hold G and click-drag) ----------
  function gameCanvas() { return document.getElementById("game") || document.querySelector("canvas"); }
  function toCell(e, c) {
    c = c || gameCanvas();
    const rect = c.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * (width + 1), y: (e.clientY - rect.top) / rect.height * (height + 1) };
  }
  window.addEventListener("pointerdown", function (e) {
    const toolOn = (typeof currentElement !== "undefined" && (currentElement === "ragdoll_grab" || currentElement === "drag"));
    if (!toolOn && !gHeld) return;
    const c = (e.target && e.target.tagName === "CANVAS") ? e.target : gameCanvas();
    if (!c) return;
    const m = toCell(e, c);
    let best = null, bd = CFG.grabRange, nearest = Infinity;
    for (const r of RD) {
      for (let i = 0; i < r.p.length; i++) {
        if (r.p[i].gone) continue;
        const dd = Math.hypot(r.p[i].x - m.x, r.p[i].y - m.y);
        if (dd < nearest) nearest = dd;
        if (dd < bd) { bd = dd; best = { r: r, idx: i }; }
      }
    }
    if (best) {
      grab = { r: best.r, idx: best.idx, mx: m.x, my: m.y };
      if (!toolOn) { e.preventDefault(); e.stopImmediatePropagation(); }   // G-key mode only: don't also paint
      console.log("[Active Ragdoll] grabbed ragdoll point", best.idx);
    } else {
      console.log("[Active Ragdoll] grab click found no ragdoll in range. mouse cell:", m.x.toFixed(1), m.y.toFixed(1),
        "nearest ragdoll point:", isFinite(nearest) ? nearest.toFixed(1) + " cells away" : "none spawned");
    }
  }, true);
  window.addEventListener("pointermove", function (e) {
    if (!grab) return;
    const m = toCell(e);
    grab.mx = m.x; grab.my = m.y; grab.moved = true;
  });
  const release = function () {
    if (!grab) return;
    const fx = Math.max(-2, Math.min(2, (grab.vx || 0) * 0.8)), fy = Math.max(-2, Math.min(2, (grab.vy || 0) * 0.8));
    for (const q of grab.r.p) { q.px -= fx; q.py -= fy; }
    if (CFG.canFall) grab.r.stun = 25; else { grab.r.stun = 0; grab.r.rec = 1; }
    grab = null;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  // ---------- Settings menu ----------
  const SCHEMA = [
    { sec: "Physics", items: [
      { k: "gravity", label: "Gravity (ground)", min: 0.05, max: 1, step: 0.01 },
      { k: "fallGravity", label: "Falling gravity", min: 0.1, max: 2, step: 0.01 },
      { k: "maxFall", label: "Terminal fall speed", min: 2, max: 16, step: 0.5 },
      { k: "bodyDensity", label: "Body density (lower floats higher)", min: 400, max: 1500, step: 10 },
      { k: "friction", label: "Ground friction", min: 0.05, max: 1, step: 0.01 },
      { k: "canFall", label: "Hard hits knock them down", type: "bool" } ] },
    { sec: "Damage", items: [
      { k: "safeImpact", label: "Safe impact speed", min: 0.5, max: 8, step: 0.1 },
      { k: "stunImpact", label: "Knock-down impact speed", min: 1, max: 10, step: 0.1 },
      { k: "smashImpact", label: "Smash impact speed", min: 3, max: 14, step: 0.1 },
      { k: "impactDamage", label: "Impact damage", min: 10, max: 400, step: 5 },
      { k: "severFrac", label: "Limb loss threshold", min: 0.1, max: 1, step: 0.05 },
      { k: "painRate", label: "Pain sensitivity", min: 0, max: 3, step: 0.1 } ] },
    { sec: "Life", items: [
      { k: "hungerRate", label: "Hunger rate", min: 0, max: 0.05, step: 0.001 },
      { k: "starve", label: "Starvation kills", type: "bool" },
      { k: "breath", label: "Breath (ticks underwater)", min: 100, max: 3000, step: 50 },
      { k: "deathAnims", label: "Death animations", type: "bool" } ] },
    { sec: "Behaviour", items: [
      { k: "sight", label: "Sight range", min: 10, max: 200, step: 5 },
      { k: "stumbleChance", label: "Stumble chance", min: 0, max: 0.05, step: 0.001 },
      { k: "fearEnabled", label: "Fear", type: "bool" },
      { k: "teamsFight", label: "Different teams fight", type: "bool" },
      { k: "friendlyFire", label: "Friendly fire", type: "bool" },
      { k: "throwPower", label: "Throw power (big ragdolls)", min: 0, max: 3, step: 0.1 } ] },
    { sec: "Look", items: [
      { k: "showMarker", label: "Marker over the player", type: "bool" } ] },
  ];
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CFG)); } catch (e) { /* ignore */ } }
  function buildSettings() {
    if (typeof document === "undefined" || !document.body || !document.createElement) return;
    const btn = document.createElement("button");
    btn.textContent = "Ragdolls";
    btn.title = "Ragdoll settings";
    btn.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;padding:6px 10px;background:#222;color:#eee;border:1px solid #666;border-radius:6px;cursor:pointer;font:12px sans-serif;opacity:.85";
    const panel = document.createElement("div");
    panel.style.cssText = "position:fixed;left:8px;bottom:44px;z-index:99999;width:290px;max-height:70vh;overflow:auto;background:rgba(25,25,28,.96);color:#eee;border:1px solid #666;border-radius:8px;padding:10px;font:12px sans-serif;display:none";
    const mk = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt !== undefined) e.textContent = txt; return e; };
    const refreshers = [];
    for (const sec of SCHEMA) {
      panel.appendChild(mk("div", "margin:8px 0 4px;font-weight:bold;color:#ffd400", sec.sec));
      for (const it of sec.items) {
        const row = mk("div", "display:flex;align-items:center;gap:6px;margin:3px 0");
        const lab = mk("span", "flex:1", it.label);
        row.appendChild(lab);
        if (it.type === "bool") {
          const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!CFG[it.k];
          cb.onchange = () => { CFG[it.k] = cb.checked; saveSettings(); };
          refreshers.push(() => { cb.checked = !!CFG[it.k]; });
          row.appendChild(cb);
        } else {
          const val = mk("span", "width:42px;text-align:right;color:#9cf", String(CFG[it.k]));
          const sl = document.createElement("input"); sl.type = "range"; sl.min = it.min; sl.max = it.max; sl.step = it.step; sl.value = CFG[it.k];
          sl.style.cssText = "width:100px";
          sl.oninput = () => { CFG[it.k] = parseFloat(sl.value); val.textContent = sl.value; saveSettings(); };
          refreshers.push(() => { sl.value = CFG[it.k]; val.textContent = String(CFG[it.k]); });
          row.appendChild(sl); row.appendChild(val);
        }
        panel.appendChild(row);
      }
    }
    panel.appendChild(mk("div", "margin:10px 0 4px;font-weight:bold;color:#ffd400", "Actions"));
    const acts = mk("div", "display:flex;flex-wrap:wrap;gap:4px");
    const act = (label, fn) => { const b = mk("button", "padding:4px 8px;background:#333;color:#eee;border:1px solid #666;border-radius:4px;cursor:pointer;font:11px sans-serif", label); b.onclick = fn; acts.appendChild(b); };
    act("Revive all", () => { for (const r of RD) reviveRagdoll(r); });
    act("Heal all", () => { for (const r of RD) if (!r.dead) { resetVitals(r, r.T); r.pain = 0; r.blood = 100; r.bleedRate = 0; r.stumpBleed = 0; } });
    act("Kill all", () => { for (const r of RD) if (!r.dead) finalizeDeath(r, "smash"); });
    act("Remove all", () => { for (const r of RD.slice()) removeRagdoll(r); for (const f of FRAGS.slice()) removeFragment(f); });
    act("Feed all", () => { for (const r of RD) r.hunger = 0; });
    act("Reset settings", () => { Object.assign(CFG, DEFAULTS); saveSettings(); for (const f of refreshers) f(); });
    panel.appendChild(acts);
    btn.onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; };
    document.body.appendChild(panel);
    document.body.appendChild(btn);
  }
  try { buildSettings(); } catch (e) { console.warn("[Active Ragdoll] couldn't build the settings menu", e); }
  window.activeRagdollSettings = CFG;   // (CFG is live: change values here too)
})();