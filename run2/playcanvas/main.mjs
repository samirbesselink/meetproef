// Meetproef, PlayCanvas-kant. Laadt het level, bouwt de wereld, laadt de held en speelt.
// Botsing is eigen code op basis van het rastercel-type; geen physics-engine.
import * as pc from './playcanvas.min.mjs';

const COLS = 20, ROWS = 12;
const SNELHEID = 4, ZWAARTEKRACHT = 20, SPRONGSNELHEID = 6.93, HALF = 0.3, EPS = 0.02, MAX_SUBSTAP = 0.05;

const canvas = document.querySelector('canvas');
const app = new pc.Application(canvas, {
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { antialias: false },
});
app.graphicsDevice.maxPixelRatio = 1;
// Op keydown i.p.v. wasPressed: een korte tik (press) kan anders binnen één frame op- en neergaan
// en dan mist de vaste poll-lus 'm. Het keydown-event vangt hem altijd, ongeacht frametiming.
let sprongAangevraagd = false;
app.keyboard.on('keydown', (e) => { if (e.key === pc.KEY_SPACE) sprongAangevraagd = true; });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.resizeCanvas();
window.addEventListener('resize', () => app.resizeCanvas());
app.scene.ambientLight = new pc.Color(0.4, 0.4, 0.4);

const camera = new pc.Entity('camera');
camera.addComponent('camera', { fov: 45, nearClip: 0.1, farClip: 100, clearColor: new pc.Color(0.8, 0.8, 0.8) });
camera.camera.toneMapping = pc.TONEMAP_LINEAR;
camera.setPosition(10, 16, 17);
camera.lookAt(10, 0, 6);
app.root.addChild(camera);

const licht = new pc.Entity('licht');
licht.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), intensity: 1, castShadows: false });
licht.setRotation(new pc.Quat().setFromDirections(pc.Vec3.DOWN, new pc.Vec3(0.3, -1, -0.5).normalize()));
app.root.addChild(licht);

const maakMateriaal = (r, g, b) => {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(r, g, b);
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0;
  m.update();
  return m;
};
const vloerMat = maakMateriaal(0.85, 0.82, 0.75);
const muurMat = maakMateriaal(0.55, 0.55, 0.58);
const finishMat = maakMateriaal(0.95, 0.8, 0.2);

app.start();

// Level: rij r (0-11) = z, kolom k (0-19) = x. Nooit overtypen: altijd via fetch, de test wisselt het level om.
let grid, startCel, heldEntity;
const held = { x: 0, y: 0, z: 0, vy: 0, grounded: true, hoek: 0 };
let route = [], routeIndex = 1, laatsteKolom = null, laatsteRij = null, klaar = false, eersteBeeldGemeld = false;

const hoogteVan = (token) => (token === '1' ? 0.4 : token === '2' ? 0.8 : token === '3' ? 1.2 : 0);

function vind(token) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === token) return [c, r];
}

function voegBlok(c, r, hoogte, batchGroupId) {
  const blok = new pc.Entity('muur');
  blok.addComponent('render', { type: 'box', material: muurMat });
  blok.render.batchGroupId = batchGroupId;
  blok.setLocalScale(1, hoogte, 1);
  blok.setPosition(c + 0.5, hoogte / 2, r + 0.5);
  app.root.addChild(blok);
}

function bouwWereld() {
  const vloer = new pc.Entity('vloer');
  vloer.addComponent('render', { type: 'plane', material: vloerMat });
  vloer.setLocalScale(COLS, 1, ROWS);
  vloer.setPosition(COLS / 2, 0, ROWS / 2);
  app.root.addChild(vloer);

  const groep = app.batcher.addGroup('muren', false, 32);
  let finishCel = null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t === 'M') voegBlok(c, r, 1, groep.id);
      else if (t === '1' || t === '2' || t === '3') voegBlok(c, r, hoogteVan(t), groep.id);
      else if (t === 'F') finishCel = [c, r];
    }
  }
  if (finishCel) {
    const [fc, fr] = finishCel;
    const finish = new pc.Entity('finish');
    finish.addComponent('render', { type: 'box', material: finishMat });
    finish.setLocalScale(1, 0.05, 1);
    finish.setPosition(fc + 0.5, 0.025, fr + 0.5);
    app.root.addChild(finish);
  }
  app.batcher.generate([groep.id]);
}

function telDriehoeken(entity) {
  let totaal = 0;
  for (const r of entity.findComponents('render')) {
    for (const mi of r.meshInstances) totaal += mi.mesh.primitive[0].count / 3;
  }
  return totaal;
}

function maakFiguur(container, track, c, r) {
  const entity = container.instantiateRenderEntity();
  entity.setPosition(c + 0.5, 0, r + 0.5);
  entity.addComponent('anim');
  entity.anim.assignAnimation('Walk', track);
  app.root.addChild(entity);
  return entity;
}

async function laadHeld() {
  const vCellen = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c][0] === 'V') vCellen.push([c, r]);

  await new Promise((ok, fout) => {
    app.assets.loadFromUrl('./held.glb', 'container', (err, asset) => {
      if (err) { fout(err); return; }
      const bron = asset.resource;
      const track = (bron.animations.find((a) => a.resource.name === 'walk') ?? bron.animations[0]).resource;
      heldEntity = maakFiguur(bron, track, startCel[0], startCel[1]);
      const driehoeken = telDriehoeken(heldEntity);
      for (const [c, r] of vCellen) maakFiguur(bron, track, c, r);
      meet.held(driehoeken, 1 + vCellen.length);
      ok();
    });
  });
}

async function start() {
  const level = await (await fetch('./hartklop-pomp.json')).json();
  grid = level.kaart.map((rij) => rij.split(' '));
  startCel = vind('S');
  held.x = startCel[0] + 0.5;
  held.z = startCel[1] + 0.5;
  laatsteKolom = startCel[0];
  laatsteRij = startCel[1];
  bouwWereld();
  if (meet.auto) route = await (await fetch('./route.json')).json();
  await laadHeld();
  klaar = true;
}
start();

app.on('frameend', () => {
  if (klaar && !eersteBeeldGemeld) { eersteBeeldGemeld = true; meet.eersteBeeld(); }
});

function autoRichting() {
  while (routeIndex < route.length) {
    const [tc, tr] = route[routeIndex];
    const dx = tc + 0.5 - held.x, dz = tr + 0.5 - held.z;
    const afstand = Math.hypot(dx, dz);
    if (afstand < 0.1) { routeIndex++; continue; }
    return { x: dx / afstand, z: dz / afstand };
  }
  return { x: 0, z: 0 };
}

function toetsRichting() {
  const kb = app.keyboard;
  const x = (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT) ? 1 : 0) - (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT) ? 1 : 0);
  const z = (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN) ? 1 : 0) - (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP) ? 1 : 0);
  const len = Math.hypot(x, z);
  return len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
}

function hoogteVanCel(c, r) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS || grid[r][c] === 'M') return Infinity;
  return hoogteVan(grid[r][c]);
}
const geblokkeerd = (x, z, y) => y < hoogteVanCel(Math.floor(x), Math.floor(z)) - 0.001;

function verplaatsAs(pos, delta, overigePos, isX, y) {
  if (delta === 0) return pos;
  const doel = pos + delta;
  const teken = Math.sign(delta);
  const rand = doel + teken * HALF - teken * EPS;
  const p1 = overigePos - HALF + EPS, p2 = overigePos + HALF - EPS;
  const bezet = isX ? geblokkeerd(rand, p1, y) || geblokkeerd(rand, p2, y) : geblokkeerd(p1, rand, y) || geblokkeerd(p2, rand, y);
  return bezet ? pos : doel;
}

function naarStart() {
  held.x = startCel[0] + 0.5;
  held.z = startCel[1] + 0.5;
  held.y = 0;
  held.vy = 0;
  held.grounded = true;
  routeIndex = 1;
  laatsteKolom = startCel[0];
  laatsteRij = startCel[1];
}

function doeSubstap(dt, springen) {
  const richting = meet.auto ? autoRichting() : toetsRichting();
  if (richting.x || richting.z) held.hoek = Math.atan2(richting.x, -richting.z) * (180 / Math.PI);

  held.x = verplaatsAs(held.x, richting.x * SNELHEID * dt, held.z, true, held.y);
  held.z = verplaatsAs(held.z, richting.z * SNELHEID * dt, held.x, false, held.y);

  if (springen && held.grounded) { held.vy = SPRONGSNELHEID; held.grounded = false; meet.sprong(); }
  held.vy -= ZWAARTEKRACHT * dt;
  held.y += held.vy * dt;
  const grond = hoogteVan(grid[Math.floor(held.z)][Math.floor(held.x)]);
  if (held.y <= grond && held.vy <= 0) { held.y = grond; held.vy = 0; held.grounded = true; } else held.grounded = false;

  const c = Math.floor(held.x), r = Math.floor(held.z);
  if (c !== laatsteKolom || r !== laatsteRij) {
    laatsteKolom = c; laatsteRij = r;
    meet.cel(c, r);
    if (grid[r][c] === 'F') { meet.finish(); if (meet.auto) naarStart(); }
  }
}

app.on('update', (dt) => {
  if (!grid || !heldEntity) return;
  const springen = sprongAangevraagd;
  sprongAangevraagd = false;
  let resterend = dt, eerste = true;
  while (resterend > 0) {
    const stap = Math.min(MAX_SUBSTAP, resterend);
    doeSubstap(stap, eerste && springen);
    resterend -= stap;
    eerste = false;
  }
  heldEntity.setPosition(held.x, held.y, held.z);
  heldEntity.setEulerAngles(0, held.hoek, 0);
});
