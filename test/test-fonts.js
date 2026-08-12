// Test: fonty jsou vedle aplikace, nezávisle na Googlu
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const KOREN = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  // Co si stránka vyžádá zvenčí
  const cizi = [], fontZadosti = [], selhalo = [];
  page.on('request', r => {
    const u = r.url();
    if (/fonts\.googleapis|fonts\.gstatic/.test(u)) cizi.push(u);
    if (/\.woff2?(\?|$)/.test(u)) fontZadosti.push(u.split('/').pop());
  });
  page.on('requestfailed', r => { if (/\.woff2?(\?|$)/.test(r.url())) selhalo.push(r.url().split('/').pop()); });

  await page.goto('file://' + path.join(KOREN, 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // ══════════════════════════════════════════════════════════════
  section('1) Soubory fontů jsou v repozitáři');
  const soubory = fs.existsSync(path.join(KOREN, 'fonty'))
    ? fs.readdirSync(path.join(KOREN, 'fonty')).filter(f => f.endsWith('.woff2')) : [];
  check('složka fonty/ existuje a něco v ní je', soubory.length > 0, String(soubory.length));
  check('jsou tam všechny tři rodiny',
    ['Syne', 'DMSans', 'DMMono'].every(f => soubory.some(s => s.startsWith(f))), soubory.join(', '));
  check('a obě podmnožiny znaků (čeština potřebuje latin-ext)',
    soubory.some(s => s.includes('latin-ext')) && soubory.some(s => /-latin\.woff2$/.test(s)),
    soubory.filter(s => s.startsWith('Syne')).join(', '));

  // ══════════════════════════════════════════════════════════════
  section('2) Nic se netahá z Googlu');
  check('stránka nesáhla na fonts.googleapis ani gstatic', cizi.length === 0, JSON.stringify(cizi.slice(0, 3)));
  check('žádný font nespadl', selhalo.length === 0, JSON.stringify(selhalo));
  check('fonty se opravdu stahovaly lokálně', fontZadosti.length > 0, fontZadosti.length + ' souborů');

  // ══════════════════════════════════════════════════════════════
  section('3) Řezy, na kterých aplikace stojí');
  const stav = await page.evaluate(async () => {
    await document.fonts.ready;
    // Deklarované řezy — check() by u zatím nepoužitého řezu vrátil false,
    // i když je poctivě k dispozici
    const deklarovane = [...new Set([...document.fonts].map(f => f.family + '|' + f.weight + '|' + f.style))].sort();
    return {
      deklarovane,
      rodiny: [...new Set([...document.fonts].map(f => f.family))].sort(),
      nactene: [...document.fonts].filter(f => f.status === 'loaded')
        .map(f => f.family + ' ' + f.weight).sort(),
    };
  });
  const ma = (f, w, st) => stav.deklarovane.includes(f + '|' + w + '|' + (st || 'normal'));
  check('Syne 700 i 800 (velká čísla a nadpisy)', ma('Syne', '700') && ma('Syne', '800'), JSON.stringify(stav.deklarovane));
  check('DM Mono 400, 500 i kurzíva', ma('DM Mono', '400') && ma('DM Mono', '500') && ma('DM Mono', '400', 'italic'),
    JSON.stringify(stav.deklarovane.filter(d => d.startsWith('DM Mono'))));
  check('DM Sans 400, 500 i 600', ['400', '500', '600'].every(w => ma('DM Sans', w)),
    JSON.stringify(stav.deklarovane.filter(d => d.startsWith('DM Sans'))));
  check('nenačítá se nic navíc', JSON.stringify(stav.rodiny) === JSON.stringify(['DM Mono', 'DM Sans', 'Syne']),
    JSON.stringify(stav.rodiny));
  check('řezy, které stránka opravdu potřebuje, jsou načtené',
    stav.nactene.some(x => /^Syne 700/.test(x)) && stav.nactene.some(x => /^DM Sans/.test(x)),
    JSON.stringify(stav.nactene));

  // ══════════════════════════════════════════════════════════════
  section('4) Čísla se opravdu vykreslí v Syne');
  await page.evaluate(() => {
    items = [{ id: 'i1', name: 'Bota', category: 'sneakers', buyPrice: 12345, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];
    renderStats(); renderItems();
  });
  await page.waitForTimeout(600);
  const cisla = await page.evaluate(async () => {
    await document.fonts.ready;
    const st = document.querySelector('.stat-value');
    // Šířka textu v Syne vs. v náhradním fontu se musí lišit — když ne, Syne se nepoužil
    const mer = (font) => {
      const c = document.createElement('canvas').getContext('2d');
      c.font = font; return c.measureText('1 234 567 Kč').width;
    };
    return {
      rodina: st ? getComputedStyle(st).fontFamily : null,
      vSyne: mer('700 19px Syne'),
      vNahradnim: mer('700 19px sans-serif'),
    };
  });
  check('stat karta má předepsaný Syne', /Syne/.test(cisla.rodina || ''), cisla.rodina);
  check('Syne kreslí jinak než náhradní font, tedy se opravdu použil',
    Math.abs(cisla.vSyne - cisla.vNahradnim) > 1,
    cisla.vSyne.toFixed(1) + ' px vs ' + cisla.vNahradnim.toFixed(1) + ' px');

  // ══════════════════════════════════════════════════════════════
  section('5) Diakritika z latin-ext');
  const dia = await page.evaluate(async () => {
    await document.fonts.ready;
    const c = document.createElement('canvas').getContext('2d');
    c.font = '600 15px "DM Sans"';
    const a = c.measureText('Příště žluťoučký kůň').width;
    c.font = '600 15px sans-serif';
    const b = c.measureText('Příště žluťoučký kůň').width;
    return { a, b };
  });
  check('česká diakritika se kreslí v DM Sans, ne náhradou',
    Math.abs(dia.a - dia.b) > 1, dia.a.toFixed(1) + ' px vs ' + dia.b.toFixed(1) + ' px');

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
