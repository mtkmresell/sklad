// Test: měna se přepíná jedním klikem (CZK ↔ EUR), bez rozbalení nabídky
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  for (const [w, h, mobil] of [[1400, 900, false], [390, 844, true]]) {
    const jm = mobil ? 'mobil' : 'počítač';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobil, isMobile: mobil });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await ctx.addInitScript(() => localStorage.setItem('sklad_v3', JSON.stringify([])));
    await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const klik = async sel => { if (mobil) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(120); };

    section('1) Formulář položky (' + jm + ')');
    await page.evaluate(() => {
      openAddModal();
      window._zmen = 0;
      document.getElementById('fBuyCurrency').addEventListener('change', () => window._zmen++);
    });
    await page.waitForTimeout(400);
    const stav = id => page.evaluate(id => {
      const s = document.getElementById(id); const wrap = s.closest('.cs-wrap');
      return { v: s.value, label: wrap.querySelector('.cs-label').textContent,
        otevreno: wrap.querySelector('.cs-drop').classList.contains('open') };
    }, id);
    const btn = '#moAdd .cs-wrap:has(#fBuyCurrency) .cs-btn';
    let s0 = await stav('fBuyCurrency');
    check('výchozí je CZK', s0.v === 'CZK' && s0.label === 'CZK', JSON.stringify(s0));
    await page.locator(btn).scrollIntoViewIfNeeded();
    await klik(btn);
    let s1 = await stav('fBuyCurrency');
    check('jeden klik přepne na EUR', s1.v === 'EUR' && s1.label === 'EUR', JSON.stringify(s1));
    check('a nabídka se neotevře', !s1.otevreno, JSON.stringify(s1));
    check('ozve se change (přepočty)', (await page.evaluate(() => window._zmen)) === 1);
    const anim = await page.evaluate(() => {
      const w = document.getElementById('fBuyCurrency').closest('.cs-wrap');
      return { pop: w.querySelector('.cs-btn').classList.contains('cs-mena-pop'),
        label: w.querySelector('.cs-label').className };
    });
    check('přepnutí má animaci', anim.pop && /cs-mena-zdola/.test(anim.label), JSON.stringify(anim));
    await page.waitForTimeout(600);
    check('po animaci nezůstane v tlačítku stará měna', await page.evaluate(() =>
      !document.getElementById('fBuyCurrency').closest('.cs-wrap').querySelector('.cs-mena-duch')));
    await klik(btn);
    let s2 = await stav('fBuyCurrency');
    check('druhý klik vrátí CZK', s2.v === 'CZK' && s2.label === 'CZK' && !s2.otevreno, JSON.stringify(s2));
    // Cílová cena funguje stejně
    const btnT = '#moAdd .cs-wrap:has(#fTargetCurrency) .cs-btn';
    await page.locator(btnT).scrollIntoViewIfNeeded();
    await klik(btnT);
    check('i u cílové ceny', (await stav('fTargetCurrency')).v === 'EUR');
    // Ostatní nabídky se rozbalují dál
    await page.evaluate(() => {
      const w = document.getElementById('fCat').closest('.cs-wrap'); w.scrollIntoView();
    });
    await klik('#moAdd .cs-wrap:has(#fCat) .cs-btn');
    check('jiná nabídka (kategorie) se pořád rozbalí', await page.evaluate(() =>
      document.getElementById('fCat').closest('.cs-wrap').querySelector('.cs-drop').classList.contains('open')));
    // Klik na měnu zavře otevřenou cizí nabídku
    await page.locator(btn).scrollIntoViewIfNeeded();
    await klik(btn);
    check('klik na měnu zavře jinou otevřenou nabídku', await page.evaluate(() =>
      !document.querySelector('.cs-drop.open')));
    await page.evaluate(() => cm('moAdd'));

    section('2) Kalkulačka marže (Kč / €) (' + jm + ')');
    const kalk = await page.evaluate(() => {
      toggleCalc(true);
      const s = document.getElementById('calcBuyCur');
      if (!s || !s._csInited) return null;
      const b = s.closest('.cs-wrap').querySelector('.cs-btn');
      b.click();
      return { v: s.value, label: s.closest('.cs-wrap').querySelector('.cs-label').textContent,
        otevreno: s.closest('.cs-wrap').querySelector('.cs-drop').classList.contains('open') };
    });
    check('v kalkulačce se přepne na €', kalk && kalk.v === 'EUR' && kalk.label === '€' && !kalk.otevreno, JSON.stringify(kalk));

    check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
