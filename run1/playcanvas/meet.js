// meet.js: het meetinstrument van de meetproef, voor beide engines hetzelfde.
// Laad dit in <head>, vóór de engine: het vangt de WebGL-context, draw calls en de rAF-callbacks van de engine.
// De engine roept aan:
//   meet.eersteBeeld()           1x, na het eerste frame waarin het level en alle figuren staan en de besturing werkt
//   meet.cel(kolom, rij)         bij elk nieuw vakje (0-based), niet per frame
//   meet.finish()                als de held op F komt
//   meet.sprong()                als een sprong begint
//   meet.held(driehoeken, aantalFiguren)   na het laden van held.glb
// De engine leest meet.auto (?auto in de URL): dan loopt de held zelf de route van route.json.
// ponytail: wegwerp, verdwijnt na besluit 004.
(() => {
  'use strict';
  const MEETDUUR = 30000;
  const pad = location.pathname.split('/').filter(Boolean);
  const m = window.meet = {
    auto: new URLSearchParams(location.search).has('auto'),
    engine: pad.at(-1) === 'index.html' ? pad.at(-2) : pad.at(-1),
    run: pad.find((d) => /^run\d$/.test(d)) ?? '-',
    eersteBeeldMs: 0, positie: null, finishes: 0, sprongen: 0, driehoeken: 0, figuren: 0,
  };

  // Welke context maakt de engine op welk canvas?
  const contexten = new WeakMap();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && !contexten.has(this)) contexten.set(this, { type, ctx });
    return ctx;
  };

  // MSAA: een engine kan de context zonder anti-aliasing maken en zelf een multisample-buffer gebruiken
  // (PlayCanvas doet dat). Daarom telt ook elke multisample-renderbuffer mee.
  let msaaSamples = 0;
  const rsm = WebGL2RenderingContext.prototype.renderbufferStorageMultisample;
  WebGL2RenderingContext.prototype.renderbufferStorageMultisample = function (target, samples, ...rest) {
    msaaSamples = Math.max(msaaSamples, samples);
    return rsm.call(this, target, samples, ...rest);
  };

  // Draw calls tellen, engine-onafhankelijk.
  let draws = 0;
  for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const orig = WebGL2RenderingContext.prototype[f];
    WebGL2RenderingContext.prototype[f] = function () { draws++; return orig.apply(this, arguments); };
  }

  // GL-wacht: synchrone GL-aanroepen blokkeren de main thread tot de GPU-kant klaar is.
  // Dat telt mee in het werk per frame, maar wordt apart gerapporteerd, zodat rekenen en wachten te onderscheiden zijn.
  let glWacht = 0;
  let meten = false;
  for (const f of ['getParameter', 'getError', 'readPixels', 'getBufferSubData', 'clientWaitSync', 'finish']) {
    const orig = WebGL2RenderingContext.prototype[f];
    WebGL2RenderingContext.prototype[f] = function () {
      if (!meten) return orig.apply(this, arguments);
      const s = performance.now();
      const uit = orig.apply(this, arguments);
      glWacht += performance.now() - s;
      return uit;
    };
  }

  // Rekentijd per frame: de engines draaien hun frame in een rAF-callback. Alle callbacks van één frame
  // krijgen dezelfde tijdstempel, dus optellen per tijdstempel geeft het werk per frame (ook als er meer callbacks zijn).
  // meet.js telt zelf frames met de originele rAF, zodat dat niet als enginewerk meetelt.
  const raf = window.requestAnimationFrame.bind(window);
  const werk = new Map();
  const frames = [];
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    cb(t);
    if (meten) werk.set(t, (werk.get(t) ?? 0) + performance.now() - s);
  });
  const tel = (t) => { if (meten) { frames.push(t); raf(tel); } };

  // Eén vak linksonder: een statusregel, daaronder eventuele fouten (die de status en het resultaat niet wissen).
  let doos, status;
  const toon = (tekst) => {
    if (!doos) {
      doos = document.createElement('div');
      doos.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10;max-width:calc(100% - 32px);'
        + 'font:15px/1.4 system-ui,sans-serif;background:#fffffff0;color:#111;padding:8px 12px;border-radius:6px';
      status = document.createElement('div');
      doos.append(status);
      (document.body ?? document.documentElement).append(doos);
    }
    status.textContent = tekst;
    return doos;
  };
  const meldFout = (tekst) => {
    const regel = document.createElement('div');
    regel.style.color = '#a00';
    regel.textContent = `Fout: ${tekst}`;
    toon(status?.textContent ?? '').append(regel);
  };

  // Liever een melding dan een leeg scherm: een verloren meetsessie op school kost een dag.
  addEventListener('error', (e) => meldFout(e.message));
  addEventListener('unhandledrejection', (e) => meldFout(e.reason?.message ?? e.reason));
  setTimeout(() => {
    if (!m.eersteBeeldMs) {
      toon('Nog geen beeld na 60 seconden. Wacht tot 3 minuten; staat er dan nog niets, maak een foto van dit scherm en stuur hem naar Claude.');
    }
  }, 60000);

  m.cel = (kolom, rij) => { m.positie = [kolom, rij]; };
  m.finish = () => { m.finishes++; if (!m.auto) toon(`Finish gehaald (${m.finishes}x).`); };
  m.sprong = () => { m.sprongen++; };
  m.held = (driehoeken, figuren) => { m.driehoeken = driehoeken; m.figuren = figuren; };

  m.eersteBeeld = () => {
    if (m.eersteBeeldMs) return;
    m.eersteBeeldMs = performance.now();
    if (!m.auto) { toon('Zelf spelen: pijltjes of WASD, spatie = springen. Loop naar het gele vak.'); return; }
    const t0 = performance.now();
    const drawsStart = draws;
    glWacht = 0;
    meten = true;
    raf(tel);
    toon('Meten... 30 s. Niets aanraken.');
    const aftellen = setInterval(() => {
      toon(`Meten... ${Math.max(0, Math.ceil((t0 + MEETDUUR - performance.now()) / 1000))} s. Niets aanraken.`);
    }, 1000);
    setTimeout(() => { clearInterval(aftellen); meten = false; rapport(t0, draws - drawsStart); }, MEETDUUR);
  };

  function rapport(t0, drawsTijdensMeting) {
    // FPS: totaal, de eerste seconde (opwarmen) apart, en de slechtste volle seconde daarna.
    const perSeconde = Array(MEETDUUR / 1000).fill(0);
    for (const t of frames) { const s = Math.floor((t - t0) / 1000); if (s >= 0 && s < perSeconde.length) perSeconde[s]++; }
    const fpsGem = (frames.length - 1) / ((frames.at(-1) - frames[0]) / 1000);
    const perFrame = [...werk.values()];
    const gesorteerd = [...perFrame].sort((a, b) => a - b);
    const werkGem = perFrame.reduce((s, x) => s + x, 0) / perFrame.length;
    const werkP95 = gesorteerd[Math.floor(0.95 * (gesorteerd.length - 1))];

    // Download: netwerk (gecomprimeerd, 0 uit cache) en ongecomprimeerd.
    const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
    const bytes = (veld) => entries.reduce((s, e) => s + (e[veld] || 0), 0);
    const warm = entries.filter((e) => e.decodedBodySize > 100000 && e.transferSize < 1000).map((e) => e.name.split('/').pop());
    const geladen = (naam) => entries.some((e) => e.name.split('?')[0].endsWith('/' + naam));

    const canvas = document.querySelector('canvas');
    const { type = '?', ctx } = contexten.get(canvas) ?? {};
    let gpu = '?', antialias = null;
    if (ctx && type.startsWith('webgl')) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      gpu = ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER);
      antialias = Boolean(ctx.getContextAttributes()?.antialias) || msaaSamples > 0;
    }

    const r = window.meetResultaat = {
      versie: 1, engine: m.engine, run: m.run,
      laadtijdMs: Math.round(m.eersteBeeldMs),
      fpsGem: +fpsGem.toFixed(1), fpsEersteSeconde: perSeconde[0], fpsSlechtsteSeconde: Math.min(...perSeconde.slice(1)),
      // werk = main-thread per frame, inclusief GL-wacht
      werkMsGem: +werkGem.toFixed(2), werkMsP95: +(werkP95 ?? 0).toFixed(2), werkFrames: perFrame.length,
      glWachtMsGem: +(glWacht / Math.max(1, perFrame.length)).toFixed(2),
      drawcallsPerFrame: +(drawsTijdensMeting / Math.max(1, perFrame.length)).toFixed(1),
      canvasBreedte: canvas?.width, canvasHoogte: canvas?.height,
      vensterBreedte: innerWidth, vensterHoogte: innerHeight, dpr: devicePixelRatio,
      context: type, antialias, msaaSamples, gpu,
      mbNetwerk: +(bytes('transferSize') / 1e6).toFixed(2), mbOngecomprimeerd: +(bytes('decodedBodySize') / 1e6).toFixed(2),
      warm, levelGeladen: geladen('hartklop-pomp.json'), glbGeladen: geladen('held.glb'),
      finishes: m.finishes, sprongen: m.sprongen, driehoeken: m.driehoeken, figuren: m.figuren,
      ua: navigator.userAgent,
    };

    const regel = `${r.engine} ${r.run} | laden ${r.laadtijdMs} ms`
      + ` | fps ${r.fpsGem} (eerste seconde ${r.fpsEersteSeconde}, slechtste daarna ${r.fpsSlechtsteSeconde})`
      + ` | main-thread ${r.werkMsGem} ms/frame (p95 ${r.werkMsP95}, waarvan GL-wacht ${r.glWachtMsGem}) | draws ${r.drawcallsPerFrame}`
      + ` | ${r.canvasBreedte}x${r.canvasHoogte} dpr ${r.dpr} | ${r.context} aa ${r.antialias}`
      + ` | ${r.mbNetwerk} MB netwerk, ${r.mbOngecomprimeerd} MB totaal | finishes ${r.finishes}`
      + (warm.length ? ` | LET OP: uit cache: ${warm.join(', ')}` : ' | koud');
    const vak = toon('');
    const tekst = document.createElement('textarea');
    tekst.readOnly = true;
    tekst.rows = 5;
    tekst.style.cssText = 'display:block;width:min(70ch,85vw);font:13px monospace';
    tekst.value = `${regel}\n${JSON.stringify(r)}`;
    const knop = document.createElement('button');
    knop.textContent = 'Kopieer';
    knop.style.cssText = 'min-height:44px;min-width:44px;margin-top:6px;font:inherit;padding:0 16px';
    knop.onclick = async () => {
      tekst.select();
      try { await navigator.clipboard.writeText(tekst.value); knop.textContent = 'Gekopieerd'; } catch { knop.textContent = 'Geselecteerd: druk Ctrl+C'; }
    };
    vak.append(tekst, knop);
  }
})();
