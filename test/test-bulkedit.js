// Test: zásahy do hotového bulk prodeje.
//
// Balík je hlavička (type:'bulk') plus kusy, které na ni odkazují přes bulkId.
// Prodej sedí na hlavičce, kus si nese jen otisk. Testuje se, že se ten otisk
// dá celý sundat a že souhrn hlavičky pak sedí na to, co v balíku zbylo.
//
// Chyby, které tohle hlídá a které tu byly:
//   — vrácení na sklad nechávalo na kusu sledování zásilky a referenci prodeje
//   — vyjmutí kusu přepočítalo zisk bez vedlejších nákladů
//   — a neopravilo totalBuyPrice, takže hlavička ukazovala starou nákupní
//     cenu s novým ziskem
//   — cena zadaná v eurech se uložila jako koruny

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

// Balík: tři kusy po 1000 Kč, prodáno za 5000, vedlejší náklady 200.
// Zisk musí být 5000 − 3000 − 200 = 1800.
const SEED = () => ({
  bulk: {
    id: 'bulk_1', type: 'bulk', name: 'Balík Pokémon', saleState: 'paid', waitState: 'completed',
    sellPrice: 5000, sellCurrency: 'CZK', extraCosts: 200, totalBuyPrice: 3000,
    profit: 1800, roi: 60, profitRateEur: 25,
    saleDate: '01.05.2026', payoutDate: '2026-05-10', soldWhere: 'Bazoš.sk', saleRef: 'REF-1',
    trackingNum: 'Z123', trackingCarrier: 'Zásilkovna', trackingUrl: 'https://tracking.packeta.com/?id=Z123',
    itemIds: ['k1', 'k2', 'k3'], itemPrices: { k1: 1700, k2: 1700, k3: 1600 }, dateAdded: '2026-05-01',
  },
  kusy: ['k1', 'k2', 'k3'].map((id, i) => ({
    id, name: 'Kus ' + (i + 1), category: 'pokemon', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'paid', waitState: 'completed', bulkId: 'bulk_1', sellPrice: 0,
    saleDate: '2026-05-01', payoutDate: '2026-05-10', soldWhere: 'Bazoš.sk', saleRef: 'REF-1',
    trackingNum: 'Z123', trackingCarrier: 'Zásilkovna', trackingUrl: 'https://tracking.packeta.com/?id=Z123',
    sellCurrency: 'CZK', actualSell: 0, profitRateEur: 25,
    buyDate: '2026-03-01', location: 'Doma', dateAdded: 1000 + i, tags: [],
  })),
});

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete' && typeof rozpustBulk === 'function', { timeout: 20000 });

  const nasad = (s) => page.evaluate((d) => {
    localStorage.clear();
    items = [d.bulk].concat(d.kusy).map(x => JSON.parse(JSON.stringify(x)));
    // Potvrzovací okno v testu rovnou odklikneme
    window.makeConfirmOverlay = function (msg, btn, color, cb) { window.__lastConfirm = msg; cb(); };
  }, s);

  // ══════════════════════════════════════════════════════════════
  section('1) Rozpuštění balíku vrátí kusy a uklidí po prodeji');
  await nasad(SEED());
  const roz = await page.evaluate(() => {
    rozpustBulk('bulk_1');
    const k = items.find(i => i.id === 'k1');
    return {
      hlavicka: !!items.find(i => i.id === 'bulk_1'),
      pocet: items.length,
      stav: k.saleState, bulkId: k.bulkId,
      zbytky: ['saleDate', 'payoutDate', 'saleRef', 'trackingNum', 'trackingCarrier', 'trackingUrl',
        'sellCurrency', 'actualSell'].filter(f => k[f] !== undefined && k[f] !== null && k[f] !== ''),
      nakup: k.buyPrice, nakupDatum: k.buyDate,
    };
  });
  check('hlavička zmizela', roz.hlavicka === false);
  check('zbyly jen tři kusy', roz.pocet === 3, String(roz.pocet));
  check('kus je zpátky na skladě', roz.stav === 'stock' && roz.bulkId === null, JSON.stringify(roz));
  check('po prodeji nezbyla ani stopa', roz.zbytky.length === 0, 'zbylo: ' + roz.zbytky.join(', '));
  check('nákupní data zůstala', roz.nakup === 1000 && roz.nakupDatum === '2026-03-01', JSON.stringify(roz));

  // ══════════════════════════════════════════════════════════════
  section('2) Smazání i s kusy');
  await nasad(SEED());
  const sm = await page.evaluate(() => {
    smazBulkVcetneKusu('bulk_1');
    return { zbylo: items.length, hlaska: window.__lastConfirm };
  });
  check('nezbylo nic', sm.zbylo === 0, String(sm.zbylo));
  check('a potvrzení varovalo, že to je nevratné', /nedá vrátit/i.test(sm.hlaska || ''), sm.hlaska);

  // ══════════════════════════════════════════════════════════════
  section('3) Vyjmutí kusu přepočítá souhrn');
  await nasad(SEED());
  const vyj = await page.evaluate(() => {
    vyjmiZBulku('k3');
    const b = items.find(i => i.id === 'bulk_1');
    const k = items.find(i => i.id === 'k3');
    return {
      kusNaSklade: k.saleState === 'stock' && k.bulkId === null,
      zbytky: ['saleDate', 'saleRef', 'trackingNum', 'trackingUrl'].filter(f => k[f] !== undefined && k[f] !== null && k[f] !== ''),
      itemIds: b.itemIds,
      totalBuy: b.totalBuyPrice,
      profit: b.profit,
      roi: b.roi,
      sell: b.sellPrice,
      cenyKusu: Object.keys(b.itemPrices),
    };
  });
  check('vyjmutý kus je na skladě a čistý', vyj.kusNaSklade && vyj.zbytky.length === 0, JSON.stringify(vyj.zbytky));
  check('itemIds se zkrátilo', JSON.stringify(vyj.itemIds) === '["k1","k2"]', JSON.stringify(vyj.itemIds));
  check('cena za vyjmutý kus se zapomněla', JSON.stringify(vyj.cenyKusu) === '["k1","k2"]', JSON.stringify(vyj.cenyKusu));
  check('nákupní cena hlavičky se opravila na 2000', vyj.totalBuy === 2000, String(vyj.totalBuy));
  check('prodejní cena zůstala 5000', vyj.sell === 5000, String(vyj.sell));
  // 5000 − 2000 − 200 = 2800; dřív se vedlejší náklady zapomínaly a vyšlo 3000
  check('zisk počítá i s vedlejšími náklady', vyj.profit === 2800, String(vyj.profit) + ' (má být 2800)');
  check('ROI sedí na nový základ', vyj.roi === 140, String(vyj.roi));

  section('4) Vyjmutí posledního kusu balík zruší');
  await nasad(SEED());
  const posl = await page.evaluate(() => {
    vyjmiZBulku('k1'); vyjmiZBulku('k2'); vyjmiZBulku('k3');
    return { hlavicka: !!items.find(i => i.id === 'bulk_1'), pocet: items.length };
  });
  check('hlavička zanikla', posl.hlavicka === false);
  check('kusy zůstaly', posl.pocet === 3, String(posl.pocet));

  // ══════════════════════════════════════════════════════════════
  section('5) Smazání kusu zvenčí souhrn taky opraví');
  await nasad(SEED());
  const smaz = await page.evaluate(() => {
    _cleanBulkOnDelete('k3');
    items = items.filter(i => i.id !== 'k3');
    const b = items.find(i => i.id === 'bulk_1');
    return { totalBuy: b.totalBuyPrice, profit: b.profit, itemIds: b.itemIds };
  });
  check('nákupní cena sedí i po smazání kusu', smaz.totalBuy === 2000, String(smaz.totalBuy));
  check('zisk sedí i po smazání kusu', smaz.profit === 2800, String(smaz.profit));
  check('itemIds sedí', JSON.stringify(smaz.itemIds) === '["k1","k2"]', JSON.stringify(smaz.itemIds));

  // ══════════════════════════════════════════════════════════════
  section('6) Šipka a křížek nedělají totéž');
  await nasad(SEED());
  const dveAkce = await page.evaluate(() => {
    returnBulkToStock('bulk_1');
    const poRozpusteni = items.length;
    return { poRozpusteni };
  });
  await nasad(SEED());
  const poSmazani = await page.evaluate(() => { delBulk('bulk_1'); return items.length; });
  check('šipka kusy zachová', dveAkce.poRozpusteni === 3, String(dveAkce.poRozpusteni));
  check('křížek je smaže', poSmazani === 0, String(poSmazani));

  // ══════════════════════════════════════════════════════════════
  section('7) Editace zaplaceného balíku');
  await nasad(SEED());
  await page.evaluate(() => { openBulkEditModal('bulk_1'); });
  await page.waitForTimeout(300);
  const form = await page.evaluate(() => ({
    maPayout: !!document.querySelector('#_bePay'),
    maStavy: !!document.querySelector('[data-ws]'),
    payoutHodnota: (document.querySelector('#_bePay') || {}).value,
    cena: (document.querySelector('#_beP') || {}).value,
  }));
  check('nabízí datum payoutu', form.maPayout === true);
  check('a ne stavy čekání', form.maStavy === false);
  check('datum payoutu je předvyplněné', form.payoutHodnota === '2026-05-10', String(form.payoutHodnota));
  check('cena je předvyplněná', String(form.cena) === '5000', String(form.cena));

  const ulozeno = await page.evaluate(() => {
    document.querySelector('#_beP').value = '6000';
    document.querySelector('#_bePay').value = '2026-06-01';
    document.querySelector('#_beSave').click();
    const b = items.find(i => i.id === 'bulk_1');
    return { sell: b.sellPrice, payout: b.payoutDate, profit: b.profit, totalBuy: b.totalBuyPrice };
  });
  check('nová cena se uložila', ulozeno.sell === 6000, String(ulozeno.sell));
  check('nové datum payoutu se uložilo', ulozeno.payout === '2026-06-01', String(ulozeno.payout));
  // 6000 − 3000 − 200 = 2800
  check('zisk po editaci počítá s vedlejšími náklady', ulozeno.profit === 2800, String(ulozeno.profit) + ' (má být 2800)');
  check('nákupní cena zůstala 3000', ulozeno.totalBuy === 3000, String(ulozeno.totalBuy));

  section('8) Editace u čekajícího balíku nabízí stavy');
  await page.evaluate(() => {
    document.querySelectorAll('[style*="position:fixed"]').forEach(e => e.remove());
    const b = items.find(i => i.id === 'bulk_1');
    b.saleState = 'waiting'; b.waitState = 'sending'; delete b.payoutDate;
    openBulkEditModal('bulk_1');
  });
  await page.waitForTimeout(300);
  const cekaForm = await page.evaluate(() => ({
    maStavy: !!document.querySelector('[data-ws]'),
    maPayout: !!document.querySelector('#_bePay'),
  }));
  check('čekající balík má stavy', cekaForm.maStavy === true);
  check('a nemá datum payoutu', cekaForm.maPayout === false);

  // ══════════════════════════════════════════════════════════════
  section('9) Cena v eurech se uloží jako koruny');
  await page.evaluate(() => {
    document.querySelectorAll('[style*="position:fixed"]').forEach(e => e.remove());
  });
  await nasad(SEED());
  const euro = await page.evaluate(() => {
    openBulkEditModal('bulk_1');
    document.querySelector('#_beP').value = '200';
    document.querySelector('#_beC').value = 'EUR';
    document.querySelector('#_beSave').click();
    const b = items.find(i => i.id === 'bulk_1');
    return { sell: b.sellPrice, orig: b.sellPriceOrig, mena: b.sellCurrency, kurz: b.profitRateEur };
  });
  // 200 € × uložený kurz 25 = 5000 Kč; dřív se uložilo 200 jako by to byly koruny
  check('eura se přepočítala uloženým kurzem', euro.sell === 5000, String(euro.sell) + ' (má být 5000)');
  check('původní eurová částka se pamatuje', euro.orig === 200, String(euro.orig));
  check('měna se uložila', euro.mena === 'EUR', String(euro.mena));
  check('kurz se nepřepsal dnešním', euro.kurz === 25, String(euro.kurz));

  // ══════════════════════════════════════════════════════════════
  section('10) Balík v Prodáno má akce a řádky uvnitř jdou rozkliknout');
  await page.evaluate(() => {
    document.querySelectorAll('[style*="position:fixed"]').forEach(e => e.remove());
  });
  await nasad(SEED());
  await page.evaluate(() => {
    expandedBulks.add('bulk_1');
    switchTab('sold');
  });
  await page.waitForTimeout(600);

  const vProdano = await page.evaluate(() => {
    const radek = document.querySelector('.bulk-group-row');
    const akce = document.getElementById('bact_bulk_1');
    const deti = Array.from(document.querySelectorAll('.bulk-child-row'));
    const tlacitka = akce ? Array.from(akce.querySelectorAll('button')).map(b => (b.getAttribute('onclick') || '')) : [];
    return {
      maRadek: !!radek,
      maAkce: !!akce,
      upravit: tlacitka.some(o => o.includes('openBulkEditModal')),
      rozpustit: tlacitka.some(o => o.includes('rozpustBulk')),
      smazat: tlacitka.some(o => o.includes('smazBulkVcetneKusu')),
      pocetDeti: deti.length,
      detiKlikaci: deti.every(r => r.getAttribute('data-action') === 'detail' && !!r.getAttribute('data-id')),
      detiMajiVyjmout: deti.every(r => (r.innerHTML || '').includes('vyjmiZBulku')),
    };
  });
  check('balík se v Prodáno vykreslil', vProdano.maRadek === true, JSON.stringify(vProdano));
  check('má blok akcí', vProdano.maAkce === true);
  check('nabízí Upravit', vProdano.upravit === true);
  check('nabízí rozpuštění', vProdano.rozpustit === true);
  check('nabízí smazání i s kusy', vProdano.smazat === true);
  check('rozbalily se všechny tři kusy', vProdano.pocetDeti === 3, String(vProdano.pocetDeti));
  check('řádky kusů vedou na detail', vProdano.detiKlikaci === true);
  check('a mají tlačítko na vyjmutí', vProdano.detiMajiVyjmout === true);

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
