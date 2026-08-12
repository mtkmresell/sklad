// Test: postranní tlačítka myši — historie otevřených oken
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SEED = [{ id: 'i1', name: 'Bota', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: '2026-01-01', tags: [] }];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Historie se plní sledováním třídy, takže stačí okna otevírat jak to dělá aplikace
  const otevri = async (id) => {
    await page.evaluate((i) => document.getElementById(i).classList.add('open'), id);
    await page.waitForTimeout(80);
  };
  const otevrena = () => page.evaluate(() =>
    [...document.querySelectorAll('.mo.open')].map(e => e.id));
  // Skutečná událost bočního tlačítka. Cíl je uvnitř vrchního okna, tedy tam,
  // kde je typicky kurzor; varianta „mimo okno" se testuje zvlášť níž.
  const tlacitko = async (b, mimo) => {
    await page.evaluate(({ btn, ven }) => {
      const vrchni = [...document.querySelectorAll('.mo.open')].pop();
      const cil = (!ven && vrchni && vrchni.querySelector('.modal, .img-modal, .sell-modal')) || document.body;
      cil.dispatchEvent(new MouseEvent('mousedown', { button: btn, bubbles: true }));
      cil.dispatchEvent(new MouseEvent('mouseup', { button: btn, bubbles: true }));
    }, { btn: b, ven: !!mimo });
    await page.waitForTimeout(120);
  };

  // ══════════════════════════════════════════════════════════════
  section('1) Historie se plní sama při otevírání oken');
  await otevri('moSettings');
  check('okno je otevřené', (await otevrena()).includes('moSettings'), JSON.stringify(await otevrena()));

  await otevri('moImg');
  check('druhé okno se otevře nad prvním',
    (await otevrena()).length === 2, JSON.stringify(await otevrena()));

  // ══════════════════════════════════════════════════════════════
  section('2) Boční tlačítko zpět');
  await tlacitko(3);
  let stav = await otevrena();
  check('zavře vrchní okno', !stav.includes('moImg'), JSON.stringify(stav));
  check('to pod ním zůstane otevřené', stav.includes('moSettings'), JSON.stringify(stav));

  await tlacitko(3);
  stav = await otevrena();
  check('druhý stisk zavře i to spodní', stav.length === 0, JSON.stringify(stav));

  await tlacitko(3);
  check('stisk bez otevřeného okna nic nerozbije', (await otevrena()).length === 0);

  // ══════════════════════════════════════════════════════════════
  section('3) Boční tlačítko dopředu');
  await tlacitko(4);
  stav = await otevrena();
  check('vrátí naposledy zavřené okno', stav.includes('moSettings'), JSON.stringify(stav));
  await tlacitko(4);
  stav = await otevrena();
  check('a pak i to nad ním', stav.includes('moImg') && stav.length === 2, JSON.stringify(stav));
  await tlacitko(4);
  check('další stisk už nic neotevře', (await otevrena()).length === 2, JSON.stringify(await otevrena()));

  // ══════════════════════════════════════════════════════════════
  section('4) Otevření okna rukou zahodí větev dopředu');
  await tlacitko(3);
  await tlacitko(3);
  check('vše zavřeno', (await otevrena()).length === 0, JSON.stringify(await otevrena()));
  await page.evaluate(() => document.body.click());   // běžné kliknutí
  await page.waitForTimeout(80);
  await tlacitko(4);
  check('po kliknutí už dopředu nefunguje', (await otevrena()).length === 0, JSON.stringify(await otevrena()));

  // ══════════════════════════════════════════════════════════════
  section('5) Zavření oknem samotným historii nerozhodí');
  await otevri('moSettings');
  await otevri('moImg');
  await page.evaluate(() => cm('moImg'));      // zavřeno křížkem/klikem mimo
  await page.waitForTimeout(100);
  await tlacitko(3);
  stav = await otevrena();
  check('zpět zavře to, co opravdu zbylo', stav.length === 0, JSON.stringify(stav));

  // Okno zavřené a znovu otevřené je v historii jen jednou
  const historie = await page.evaluate(async () => {
    const el = document.getElementById('moSettings');
    el.classList.add('open'); await new Promise(r => setTimeout(r, 60));
    el.classList.remove('open'); await new Promise(r => setTimeout(r, 60));
    el.classList.add('open'); await new Promise(r => setTimeout(r, 60));
    return [...document.querySelectorAll('.mo.open')].map(e => e.id);
  });
  check('opakované otevření nezdvojí záznam', historie.length === 1, JSON.stringify(historie));
  await tlacitko(3);
  check('a jeden stisk ho zavře', (await otevrena()).length === 0, JSON.stringify(await otevrena()));

  // ══════════════════════════════════════════════════════════════
  section('6) Stisk mimo okno zavře jen jedno okno');
  await otevri('moSettings');
  await otevri('moImg');
  check('obě otevřená', (await otevrena()).length === 2, JSON.stringify(await otevrena()));
  await tlacitko(3, true);          // kurzor mimo okno
  stav = await otevrena();
  check('zavře se jen vrchní, ne obě', stav.length === 1 && stav.includes('moSettings'), JSON.stringify(stav));
  await tlacitko(3, true);
  check('a pak to druhé', (await otevrena()).length === 0, JSON.stringify(await otevrena()));

  // ══════════════════════════════════════════════════════════════
  section('7) Mrtvý kód je pryč');
  const mrtve = await page.evaluate(() => ({
    openPaymentDrop: typeof window.openPaymentDrop,
    renderPaymentDrop: typeof window.renderPaymentDrop,
    closePaymentDrop: typeof window.closePaymentDrop,
    onMoveToWaiting: typeof window.onMoveToWaiting,
    oc: typeof window.oc,
    changeBulkWaitState: typeof window.changeBulkWaitState,
    // ...a co zůstat muselo
    setBulkWaitState: typeof window.setBulkWaitState,
    getPaymentOpts: typeof window.getPaymentOpts,
    closeSoldWhereDrop: typeof window.closeSoldWhereDrop,
    platGroupSiblings: typeof window.platGroupSiblings,
  }));
  check('odstraněné funkce už neexistují',
    ['openPaymentDrop', 'renderPaymentDrop', 'closePaymentDrop', 'onMoveToWaiting', 'oc', 'changeBulkWaitState']
      .every(k => mrtve[k] === 'undefined'), JSON.stringify(mrtve));
  check('používané funkce zůstaly',
    ['setBulkWaitState', 'getPaymentOpts', 'closeSoldWhereDrop', 'platGroupSiblings']
      .every(k => mrtve[k] === 'function'), JSON.stringify(mrtve));

  // Vlastní platební metoda se pořád ukládá (obsluhoval to i smazaný kód)
  const platba = await page.evaluate(() => {
    const pred = getPaymentOpts().slice();
    savePaymentOpts(pred.concat(['Testovací banka']));
    const po = getPaymentOpts();
    savePaymentOpts(pred);
    return { pribylo: po.includes('Testovací banka'), obnoveno: !getPaymentOpts().includes('Testovací banka') };
  });
  check('seznam platebních metod funguje dál', platba.pribylo && platba.obnoveno, JSON.stringify(platba));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
