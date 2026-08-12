// Test: cílová cena v EUR neplave s kurzem + migrace starých záznamů
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (cond || extra === undefined ? '' : ' | ' + extra));
  if (!cond) failures++;
}

// Staré záznamy (bez targetPriceEur) — přesně jak je uložila původní verze
const SEED = [
  // 300 € zadané při kurzu 24.17 → 7251 Kč; buyRateEur k datu nákupu
  { id:'old1', name:'Stará EUR položka', category:'sneakers', buyPrice:200, buyCurrency:'EUR', buyRateEur:24.17,
    saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[],
    targetPrice:7251, targetCurrency:'EUR' },
  // 250 € zadané při kurzu 25.30 (dávno) → 6325 Kč
  { id:'old2', name:'Starší EUR položka', category:'sneakers', buyPrice:100, buyCurrency:'EUR', buyRateEur:25.30,
    saleState:'stock', location:'Doma', dateAdded:Date.now()-1000, buyDate:'2025-11-01', tags:[],
    targetPrice:6325, targetCurrency:'EUR' },
  // Korunová cílovka — migrace se jí nesmí dotknout
  { id:'czk1', name:'Korunová položka', category:'sneakers', buyPrice:5000, buyCurrency:'CZK',
    saleState:'stock', location:'Doma', dateAdded:Date.now()-2000, buyDate:'2026-06-01', tags:[],
    targetPrice:9000, targetCurrency:'CZK' },
  // Bez cílovky
  { id:'none1', name:'Bez cílovky', category:'sneakers', buyPrice:1000, buyCurrency:'CZK',
    saleState:'stock', location:'Doma', dateAdded:Date.now()-3000, buyDate:'2026-06-01', tags:[] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript((seed) => { localStorage.setItem('sklad_v3', JSON.stringify(seed)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);


  // saveItem() je async (čeká na kurz ČNB), pevná pauza nestačí — počkej na skutečnou změnu
  async function saveAndWait(id, field, expectChange) {
    const before = await page.evaluate((a) => JSON.stringify(items.find(x => x.id === a.id)?.[a.field] ?? null), { id, field });
    await page.evaluate(() => saveItem());
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(200);
      const now = await page.evaluate((a) => JSON.stringify(items.find(x => x.id === a.id)?.[a.field] ?? null), { id, field });
      if (!expectChange || now !== before) break;
    }
    await page.waitForTimeout(300);
  }

  // ── 1) Migrace při startu dopočítala celá eura
  const migrated = await page.evaluate(() => {
    var g = id => items.find(x => x.id === id);
    return {
      old1: { eur: g('old1').targetPriceEur, czk: g('old1').targetPrice },
      old2: { eur: g('old2').targetPriceEur, czk: g('old2').targetPrice },
      czk1: { eur: g('czk1').targetPriceEur, czk: g('czk1').targetPrice, cur: g('czk1').targetCurrency },
      none1: { eur: g('none1').targetPriceEur, czk: g('none1').targetPrice },
    };
  });
  check('migrace: 7251 Kč → 300 € (celé číslo)', migrated.old1.eur === 300, JSON.stringify(migrated.old1));
  check('migrace: 6325 Kč při starém kurzu → 250 €', migrated.old2.eur === 250, JSON.stringify(migrated.old2));
  check('migrace: korunová částka zůstala nedotčená', migrated.old1.czk === 7251 && migrated.old2.czk === 6325, JSON.stringify(migrated));
  check('migrace: korunová cílovka se neměnila', migrated.czk1.eur == null && migrated.czk1.czk === 9000, JSON.stringify(migrated.czk1));
  check('migrace: položka bez cílovky beze změny', migrated.none1.eur == null && migrated.none1.czk == null, JSON.stringify(migrated.none1));

  // ── 2) Zobrazení už neplave s kurzem
  const stable = await page.evaluate(() => {
    var it = items.find(x => x.id === 'old1');
    var out = {};
    [24.16, 24.90, 23.40, 26.10].forEach(function(r){ eurRate = r; out[r] = targetEur(it); });
    eurRate = 24.16;
    return out;
  });
  check('zobrazení je 300 € při každém kurzu', Object.values(stable).every(v => v === 300), JSON.stringify(stable));

  // ── 3) Detail položky ukazuje 300 €
  await page.evaluate(() => { switchTab('stock'); openDetail('old1'); });
  await page.waitForTimeout(500);
  const detailTxt = await page.evaluate(() => document.body.textContent.replace(/[  ]/g, ' '));
  check('detail položky ukazuje 300 €', /Cílová cena/.test(detailTxt) && /300 €/.test(detailTxt), (detailTxt.match(/Cílová cena.{0,20}/) || [''])[0]);
  await page.evaluate(() => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); });
  await page.waitForTimeout(200);

  // ── 4) Nově zadaná cena si pamatuje eura i kurz
  const fresh = await page.evaluate(async () => {
    eurRate = 24.17;
    openAddModal();
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('fName').value = 'Nová položka';
    document.getElementById('fBuy').value = '1000';
    document.getElementById('fTargetPrice').value = '300';
    var tc = document.getElementById('fTargetCurrency');
    tc.value = 'EUR'; if (tc._csSync) tc._csSync();
    saveItem();
    await new Promise(r => setTimeout(r, 600));
    var it = items.find(x => x.name === 'Nová položka');
    return it ? { czk: it.targetPrice, eur: it.targetPriceEur, rate: it.targetRateEur, cur: it.targetCurrency, id: it.id } : null;
  });
  check('nová položka: uloženo 7251 Kč', fresh && fresh.czk === 7251, JSON.stringify(fresh));
  check('nová položka: pamatuje si 300 € a kurz 24.17', fresh && fresh.eur === 300 && fresh.rate === 24.17, JSON.stringify(fresh));

  // Po změně kurzu se pořád zobrazuje 300 €
  const freshStable = await page.evaluate((id) => {
    eurRate = 24.16;
    return targetEur(items.find(x => x.id === id));
  }, fresh.id);
  check('nová položka po změně kurzu pořád 300 €', freshStable === 300, String(freshStable));

  // ── 5) Předvyplnění v Upravit ukazuje 300, ne 300.12
  const prefill = await page.evaluate(async () => {
    eurRate = 24.16;
    openEdit('old1');
    await new Promise(r => setTimeout(r, 600));
    return { tp: document.getElementById('fTargetPrice').value, tc: document.getElementById('fTargetCurrency').value };
  });
  check('Upravit předvyplní 300 (ne 300.12)', prefill.tp === '300' && prefill.tc === 'EUR', JSON.stringify(prefill));

  // ── 6) Uložení bez zásahu částku neposune
  await saveAndWait('old1', 'targetPrice', true);
  const resaved = await page.evaluate(() => {
    var it = items.find(x => x.id === 'old1');
    return { czk: it.targetPrice, eur: it.targetPriceEur };
  });
  check('uložení beze změny cenu neposune', resaved.eur === 300 && resaved.czk === 7248, JSON.stringify(resaved));

  // ── 7) Přepnutí na Kč zahodí pamatovanou eurovou částku
  await page.evaluate(async () => {
    openEdit('old1');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('fTargetPrice').value = '9500';
    var tc = document.getElementById('fTargetCurrency');
    tc.value = 'CZK'; if (tc._csSync) tc._csSync();
  });
  await saveAndWait('old1', 'targetPrice', true);
  const toCzk = await page.evaluate(() => {
    var it = items.find(x => x.id === 'old1');
    return { czk: it.targetPrice, eur: it.targetPriceEur, rate: it.targetRateEur, cur: it.targetCurrency };
  });
  check('přepnutí na Kč: uloženo 9500 Kč', toCzk.czk === 9500 && toCzk.cur === 'CZK', JSON.stringify(toCzk));
  check('přepnutí na Kč: eurová částka zahozena', toCzk.eur == null && toCzk.rate == null, JSON.stringify(toCzk));

  // ── 8) Smazání cílové ceny nenechá viset eurovou částku
  await page.evaluate(async () => {
    openEdit('old2');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('fTargetPrice').value = '';
  });
  await saveAndWait('old2', 'targetPrice', true);
  const cleared = await page.evaluate(() => {
    var it = items.find(x => x.id === 'old2');
    return { czk: it.targetPrice, eur: it.targetPriceEur };
  });
  check('smazání cílovky vyčistí i eurovou částku', !cleared.czk && cleared.eur == null, JSON.stringify(cleared));

  // ── 9) Migrace je jednorázová (podruhé už nic nemění)
  const idempotent = await page.evaluate(() => {
    var before = items.map(i => i.targetPriceEur);
    var n = healTargetPricesEur();
    var after = items.map(i => i.targetPriceEur);
    return { n, same: JSON.stringify(before) === JSON.stringify(after) };
  });
  check('opakovaná migrace už nic nemění', idempotent.n === 0 && idempotent.same, JSON.stringify(idempotent));

  // ── 10) Analytika pořád počítá v korunách (nedotčeno)
  const analytics = await page.evaluate(() => {
    var it = items.find(x => x.targetPrice && x.targetCurrency === 'CZK');
    return it ? it.targetPrice : null;
  });
  check('korunové hodnoty pro analytiku zůstávají', analytics != null, String(analytics));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
