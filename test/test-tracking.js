// Test: údaje o sledování zásilky se po doručení nedrží a nenaskočí zpět
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

const SEED = [
  // Skladová položka na cestě se zadaným sledováním (přesně scénář uživatele)
  { id:'t1', name:'Zásilka na cestě', category:'sneakers', buyPrice:3000, buyCurrency:'CZK',
    saleState:'stock', location:'Na cestě', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[],
    trackingNum:'1Z999AA10123456784', trackingCarrier:'UPS', trackingUrl:'https://www.ups.com/track?tracknum=1Z999AA10123456784' },
  // Prodaná položka se sledováním — to se zahazovat nesmí
  { id:'t2', name:'Prodaná se sledováním', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
    sellPrice:5000, saleState:'paid', saleDate:'2026-06-05', payoutDate:'2026-06-10',
    dateAdded:Date.now()-1000, buyDate:'2026-05-01', tags:[],
    trackingNum:'CP123456789CZ', trackingCarrier:'Česká pošta', trackingUrl:'https://www.postaonline.cz/x?parcelNumbers=CP123456789CZ' },
  // Další na cestě pro hromadnou změnu
  { id:'t3', name:'Hromadná A', category:'sneakers', buyPrice:1000, buyCurrency:'CZK',
    saleState:'stock', location:'Na cestě', dateAdded:Date.now()-2000, buyDate:'2026-06-01', tags:[],
    trackingNum:'GLS111', trackingCarrier:'GLS', trackingUrl:'https://gls-group.com/x?match=GLS111' },
  { id:'t4', name:'Hromadná B', category:'sneakers', buyPrice:1000, buyCurrency:'CZK',
    saleState:'stock', location:'Na cestě', dateAdded:Date.now()-3000, buyDate:'2026-06-01', tags:[],
    trackingNum:'PPL222', trackingCarrier:'PPL', trackingUrl:'https://www.ppl.cz/x?shipmentId=PPL222' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript((seed) => { localStorage.setItem('sklad_v3', JSON.stringify(seed)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Změň stav položky přes Upravit a počkej, až se uložení promítne
  async function setLocation(id, loc) {
    await page.evaluate(async (a) => {
      openEdit(a.id);
      await new Promise(r => setTimeout(r, 700));
      var f = document.getElementById('fLocation');
      f.value = a.loc;
      if (f._csSync) f._csSync();
      f.dispatchEvent(new Event('change', { bubbles: true }));
      updateWaitStateVisibility();
      await new Promise(r => setTimeout(r, 300));
    }, { id, loc });
    await page.evaluate(() => saveItem());
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(200);
      const done = await page.evaluate((a) => (items.find(x => x.id === a.id) || {}).location === a.loc, { id, loc });
      if (done) break;
    }
    await page.waitForTimeout(400);
  }
  const trk = (id) => page.evaluate((i) => {
    var it = items.find(x => x.id === i) || {};
    return { num: it.trackingNum, carrier: it.trackingCarrier, url: it.trackingUrl, loc: it.location };
  }, id);

  // ── 1) Výchozí stav: sledování je uložené
  let t = await trk('t1');
  check('výchozí: sledování je vyplněné', t.num === '1Z999AA10123456784', JSON.stringify(t));

  // ── 2) Zásilka dorazila → Doma → sledování se zahodí
  await setLocation('t1', 'Doma');
  t = await trk('t1');
  check('po přepnutí na Doma se sledování smaže',
    t.num === undefined && t.carrier === undefined && t.url === undefined, JSON.stringify(t));

  // ── 3) Následné Vráceno už staré údaje nevytáhne (jádro hlášené chyby)
  await setLocation('t1', 'Vráceno');
  t = await trk('t1');
  check('po přepnutí na Vráceno zůstane sledování prázdné',
    t.num === undefined && t.carrier === undefined && t.url === undefined, JSON.stringify(t));

  // ── 4) Pole v Upravit jsou prázdná, ne předvyplněná starým číslem
  const fields = await page.evaluate(async () => {
    openEdit('t1');
    await new Promise(r => setTimeout(r, 700));
    return {
      num: document.getElementById('fTrackNum').value,
      url: document.getElementById('fTrackUrl').value,
      visible: document.getElementById('fTrackingWrap').style.display !== 'none',
    };
  });
  check('formulář nepředvyplní staré sledovací číslo', fields.num === '' && fields.url === '', JSON.stringify(fields));
  check('sekce sledování je u Vráceno viditelná', fields.visible, JSON.stringify(fields));

  // ── 5) Nové sledování u Vráceno jde zadat a uloží se
  const reentered = await page.evaluate(async () => {
    document.getElementById('fTrackNum').value = 'NOVE12345';
    var c = document.getElementById('fTrackCarrier');
    c.value = 'DPD'; if (c._csSync) c._csSync();
    autoUpdateTrackingUrl();
    saveItem();
    await new Promise(r => setTimeout(r, 1200));
    var it = items.find(x => x.id === 't1');
    return { num: it.trackingNum, carrier: it.trackingCarrier, hasUrl: !!it.trackingUrl };
  });
  check('nové sledování u Vráceno se uloží', reentered.num === 'NOVE12345' && reentered.carrier === 'DPD' && reentered.hasUrl, JSON.stringify(reentered));

  // ── 6) Prodaná položka si sledování ponechá (sekce skrytá kvůli prodeji)
  const paidBefore = await trk('t2');
  await page.evaluate(async () => {
    openEdit('t2');
    await new Promise(r => setTimeout(r, 700));
    document.getElementById('fNote').value = 'jen drobná úprava';
  });
  await page.evaluate(() => saveItem());
  await page.waitForTimeout(1500);
  const paidAfter = await trk('t2');
  check('prodaná položka si sledování ponechá',
    paidAfter.num === paidBefore.num && paidAfter.carrier === paidBefore.carrier && paidAfter.url === paidBefore.url,
    JSON.stringify({ paidBefore, paidAfter }));

  // ── 7) Hromadná změna stavu na Doma sledování taky uklidí
  const bulk = await page.evaluate(() => {
    ['t3','t4'].forEach(function(id){
      var it = items.find(function(x){ return x.id===id; });
      it.location = 'Doma';
      if (it.saleState === 'stock' && !locNeedsTracking('Doma')) clearTracking(it);
    });
    return ['t3','t4'].map(function(id){
      var it = items.find(function(x){ return x.id===id; });
      return { id: id, num: it.trackingNum, loc: it.location };
    });
  });
  check('hromadná změna na Doma smaže sledování', bulk.every(b => b.num === undefined && b.loc === 'Doma'), JSON.stringify(bulk));

  // ── 8) Hromadná změna na stav, který sledování potřebuje, ho nemaže
  const bulkKeep = await page.evaluate(() => {
    var it = items.find(function(x){ return x.id==='t3'; });
    it.trackingNum = 'ZPET999'; it.trackingCarrier = 'GLS';
    it.location = 'Bude vráceno';
    if (it.saleState === 'stock' && !locNeedsTracking('Bude vráceno')) clearTracking(it);
    return { num: it.trackingNum, loc: it.location };
  });
  check('hromadná změna na Bude vráceno sledování zachová', bulkKeep.num === 'ZPET999', JSON.stringify(bulkKeep));

  // ── 9) Jednotkové ověření pomocníka
  const unit = await page.evaluate(() => ({
    doma: locNeedsTracking('Doma'),
    prazdno: locNeedsTracking(''),
    naceste: locNeedsTracking('Na cestě'),
    vraceno: locNeedsTracking('Vráceno'),
    budeVraceno: locNeedsTracking('Bude vráceno'),
    zruseno: locNeedsTracking('Zrušeno'),
    vlastni: locNeedsTracking('Garáž'),
  }));
  check('locNeedsTracking rozlišuje stavy správně',
    !unit.doma && !unit.prazdno && unit.naceste && unit.vraceno && unit.budeVraceno && unit.zruseno && !unit.vlastni,
    JSON.stringify(unit));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
