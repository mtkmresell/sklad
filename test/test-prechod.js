// Test: přechod z jednoho okna do druhého nebliká (PŘECHOD MEZI OKNY)
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Po kliku změří alfu pozadí nového okna v každém snímku, dokud nedoběhne duch
  const prechod = (klik) => page.evaluate((klik) => new Promise(res => {
    const vzorky = []; let n = 0;
    eval(klik);
    (function f() {
      const nove = document.querySelector('.mo.open');
      const a = nove ? parseFloat((getComputedStyle(nove).backgroundColor.match(/[\d.]+\)$/) || ['0'])[0]) : 0;
      vzorky.push({ a, duch: !!document.querySelector('.okno-duch'), pocetOken: document.querySelectorAll('.mo.open').length });
      if (++n < 24) requestAnimationFrame(f); else res(vzorky);
    })();
  }), klik);

  section('1) Nastavení → Tabulky velikostí');
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(500);
  const v = await prechod("document.querySelector('[data-action=opensizeTables]').click()");
  const po = v.slice(1);   // první vzorek je před doběhem změn třídy
  check('pozadí je od první chvíle ztmavené (bez blikání)', po.every(x => x.a > 0.8), JSON.stringify(po.map(x => x.a)));
  check('staré okno se rozplyne jako duch', po.some(x => x.duch));
  check('a duch pak zmizí', !v[v.length - 1].duch);
  check('otevřené je jen jedno okno', v.every(x => x.pocetOken === 1));
  check('stará okna nezůstala viset', await page.evaluate(() => !document.querySelector('.okno-duch') && !document.getElementById('moSettings').classList.contains('open')));

  section('2) Zpět do Nastavení klikem mimo okno');
  await page.waitForTimeout(500);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(600);
  check('Nastavení je zpátky', await page.evaluate(() => document.getElementById('moSettings').classList.contains('open')));
  check('pozadí je pořád ztmavené', await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('moSettings')).backgroundColor.match(/[\d.]+\)$/)[0]) > 0.8));

  section('3) Prosté zavření nic nenechá');
  await page.evaluate(() => cm('moSettings'));
  await page.waitForTimeout(300);
  check('žádný duch', await page.evaluate(() => !document.querySelector('.okno-duch')));
  check('žádné okno', await page.evaluate(() => !document.querySelector('.mo.open')));
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(100);
  check('další otevření z čisté stránky se roztmívá jako dřív', await page.evaluate(() => !document.getElementById('moSettings').classList.contains('mo-prechod')));

  section('4) Stav oken se mění hned');
  await page.evaluate(() => { cm('moSettings'); openSizeTables(); });
  check('po cm + otevření je nové okno otevřené okamžitě', await page.evaluate(() =>
    document.getElementById('moSizeTables').classList.contains('open') && !document.getElementById('moSettings').classList.contains('open')));

  section('5) Každé tlačítko pod Nástroje v Nastavení');
  // Část oken je v HTML (.mo), část se skládá za běhu a do stránky se vkládá
  // (Kurzy měn, Komisní prodej, Údaje pro doklad…) — první druh se hlídal
  // sám, druhý se dřív jen objevil bez přechodu.
  const pocet = await page.evaluate(() => document.querySelectorAll('#moSettings .tool-grid .btn-sec').length);
  check('v Nástrojích je jedenáct tlačítek', pocet === 11, String(pocet));
  for (let i = 0; i < pocet; i++) {
    await page.evaluate(() => {
      document.querySelectorAll('.mo.open, .okno-duch').forEach(m => { m.classList.remove('open'); if (m.classList.contains('okno-duch')) m.remove(); });
      ['retailersMgrOv', 'kurzyOverlay', 'komiseOverlay', 'itemCacheMgr', 'igMgrOverlay', 'sellerOv'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
      document.querySelectorAll('body > div[style*="position:fixed"]').forEach(e => e.remove());
      openSettings();
    });
    await page.waitForTimeout(450);
    const r = await page.evaluate((i) => new Promise(res => {
      const btn = document.querySelectorAll('#moSettings .tool-grid .btn-sec')[i];
      const nazev = btn.textContent.trim();
      const pred = new Set(Array.from(document.body.children));
      btn.click();
      const v = []; let k = 0;
      (function f() {
        const nove = Array.from(document.body.children).filter(e => !pred.has(e) && !e.classList.contains('okno-duch') && e.offsetWidth > 300);
        const mo = Array.from(document.querySelectorAll('.mo.open')).filter(m => m.id !== 'moSettings');
        const cil = nove[0] || mo[0];
        const a = cil ? parseFloat((getComputedStyle(cil).backgroundColor.match(/[\d.]+\)$/) || ['0'])[0]) : 0;
        const duch = document.querySelector('.okno-duch');
        // Duch musí ležet nad novým oknem, jinak ho není vidět
        const nad = !duch || !cil || (parseInt(getComputedStyle(duch).zIndex, 10) > (parseInt(getComputedStyle(cil).zIndex, 10) || 0));
        v.push({ a, duch: !!duch, je: !!cil, nad });
        if (++k < 12) requestAnimationFrame(f); else res({ nazev, v });
      })();
    }), i);
    const po = r.v.slice(1);
    check(r.nazev + ': okno se otevřelo', po.some(x => x.je));
    check(r.nazev + ': pozadí nikdy nezprůhlední', po.filter(x => x.je).every(x => x.a > 0.8), JSON.stringify(po.map(x => x.a)));
    check(r.nazev + ': Nastavení se rozplyne', po.some(x => x.duch));
    check(r.nazev + ': a je vidět nad novým oknem', po.every(x => x.nad), JSON.stringify(po.map(x => x.nad)));
  }

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
