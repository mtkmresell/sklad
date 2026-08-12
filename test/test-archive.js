// Test: rozdělení cloudu na hlavní dokument + roční archivy
const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }

// 20 položek: 8 na skladě, 3 čekají, 5 prodaných 2025, 4 prodané 2024
const SEED = [];
for (let i = 0; i < 8; i++) SEED.push({ id: 's' + i, name: 'Sklad ' + i, category: 'sneakers', buyPrice: 2000 + i * 10,
  buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 1000 + i, buyDate: '2026-01-05', tags: [] });
for (let i = 0; i < 3; i++) SEED.push({ id: 'w' + i, name: 'Čeká ' + i, category: 'pokemon', buyPrice: 1500,
  buyCurrency: 'CZK', saleState: 'waiting', sellPrice: 3000, saleDate: '2026-07-01', soldWhere: 'Vinted',
  dateAdded: 2000 + i, buyDate: '2026-02-05', tags: [] });
for (let i = 0; i < 5; i++) SEED.push({ id: 'p25_' + i, name: 'Prodáno 2025 ' + i, category: 'sneakers', buyPrice: 3000,
  buyCurrency: 'CZK', saleState: 'paid', sellPrice: 5000, profit: 1500, saleDate: '2025-11-1' + i,
  payoutDate: '2025-12-0' + (i + 1), soldWhere: 'StockX', dateAdded: 3000 + i, buyDate: '2025-06-01', tags: [] });
for (let i = 0; i < 4; i++) SEED.push({ id: 'p24_' + i, name: 'Prodáno 2024 ' + i, category: 'lego', buyPrice: 1000,
  buyCurrency: 'CZK', saleState: 'paid', sellPrice: 2200, profit: 900, saleDate: '2024-08-1' + i,
  payoutDate: '2024-09-0' + (i + 1), soldWhere: 'Vinted', dateAdded: 4000 + i, buyDate: '2024-03-01', tags: [] });

const D = 'users/u1/sklad/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  let ocekavameChyby = false;   // úseky, kde výpadek sítě vyvoláváme schválně
  page.on('console', m => { if (m.type() === 'error' && !ocekavameChyby && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);

  const store = () => page.evaluate(() => Object.keys(window.__store).sort());
  const main = () => page.evaluate(() => window.__store['users/u1/sklad/data']);
  const arch = (y) => page.evaluate((yy) => window.__store['users/u1/sklad/sold_' + yy], y);
  const ids = (a) => (a || []).map(x => x.id).sort();
  // Souhrn pro porovnání „před a po" — musí sedět do posledního čísla
  const summary = () => page.evaluate(() => ({
    pocet: items.length,
    sklad: items.filter(i => i.saleState === 'stock').length,
    ceka: items.filter(i => i.saleState === 'waiting').length,
    prodano: items.filter(i => i.saleState === 'paid').length,
    zisk: items.reduce((s, i) => s + (+i.profit || 0), 0),
    trzby: items.reduce((s, i) => s + (+i.sellPrice || 0), 0),
    nakup: items.reduce((s, i) => s + (+i.buyPrice || 0), 0),
    idy: items.map(i => i.id).sort().join(','),
  }));
  async function save() {
    const before = await page.evaluate(() => window.__commits);
    await page.evaluate(() => fbSaveToCloud());
    await page.waitForFunction((b) => window.__commits > b || window.__failWrites, before, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  // ══════════════════════════════════════════════════════════════════
  section('1) Přechod ze starého formátu');
  // Cloud obsahuje starý dokument — jeden seznam items, žádné archivy
  await page.evaluate((seed) => {
    window.__store['users/u1/sklad/data'] = { items: JSON.parse(JSON.stringify(seed)), savedAt: '2026-08-01T10:00:00.000Z' };
  }, SEED);

  const legacyLoad = await page.evaluate(() => {
    var c = _collectCloud(window.__snapshot());
    var merged = _mergeCloudItems(c.data, c.archiveItems);
    var r = window.__load();
    return { archivy: c.archiveItems, delka: merged.length, polozek: r.pocet };
  });
  check('starý formát: archivy se nehledají', Array.isArray(legacyLoad.archivy) && legacyLoad.archivy.length === 0, JSON.stringify(legacyLoad.archivy));
  check('starý formát: načte se všech 20 položek', legacyLoad.polozek === 20, String(legacyLoad.polozek));

  const pred = await summary();
  await save();
  check('první uložení proběhlo v jedné dávce', (await page.evaluate(() => window.__commits)) === 1);
  check('vznikly dokumenty data + sold_2024 + sold_2025 (+ cache našeptávače)',
    JSON.stringify(await store()) === JSON.stringify([D + 'cache', D + 'data', D + 'sold_2024', D + 'sold_2025']), JSON.stringify(await store()));

  const m1 = await main();
  check('hlavní dokument nese jen sklad a čekající (11)', m1.itemsStock.length === 11, String(m1.itemsStock.length));
  check('hlavní dokument zná roky archivů', JSON.stringify(m1.archiveYears) === JSON.stringify(['2024', '2025']), JSON.stringify(m1.archiveYears));
  check('hlavní dokument nenese zbytečná razítka', !('archiveStamps' in m1), JSON.stringify(Object.keys(m1)));
  check('archiv 2024 má 4 položky', (await arch('2024')).items.length === 4);
  check('archiv 2025 má 5 položek', (await arch('2025')).items.length === 5);
  check('do archivu jdou jen vyplacené', (await arch('2025')).items.every(i => i.saleState === 'paid'));
  check('archiv je zařazený podle roku payoutu', (await arch('2024')).items.every(i => i.payoutDate.startsWith('2024')));
  check('kompletní seznam se v hlavním dokumentu už nezdvojuje', (m1.items || []).length === 0, String((m1.items || []).length));
  check('žádná položka se neztratila ani nezdvojila',
    JSON.stringify(ids(m1.itemsStock.concat((await arch('2024')).items, (await arch('2025')).items))) === JSON.stringify(SEED.map(i => i.id).sort()));
  const velikosti = await page.evaluate(() => {
    const bez = new Blob([JSON.stringify(_buildCloudPayload())]).size;
    CLOUD_LEGACY_MIRROR = true;
    const s = new Blob([JSON.stringify(_buildCloudPayload())]).size;
    CLOUD_LEGACY_MIRROR = false;
    return { bez: bez, sPojistkou: s };
  });
  check('vypnutá pojistka hlavní dokument opravdu zmenšila',
    velikosti.bez < velikosti.sPojistkou * 0.75, velikosti.sPojistkou + ' B → ' + velikosti.bez + ' B');

  // ══════════════════════════════════════════════════════════════════
  section('2) Načtení na čistém zařízení');
  const cistelZarizeni = await page.evaluate(() => {
    window.__resetDevice();
    items = []; localStorage.removeItem('sklad_v3'); localStorage.removeItem('sklad_v3_savedAt');
    window.__reads = [];
    var r = window.__load();
    return { ok: r.ok, pocet: r.pocet, cteni: window.__reads.slice() };
  });
  check('čisté zařízení načte všech 20 položek', cistelZarizeni.pocet === 20, String(cistelZarizeni.pocet));
  check('archivy dorazily v jednom snímku (žádné dotahování dokumentů)',
    cistelZarizeni.cteni.length === 0, JSON.stringify(cistelZarizeni.cteni));
  const po = await summary();
  check('čísla sedí do posledního (počty, zisk, tržby, nákup, ID)',
    JSON.stringify(pred) === JSON.stringify(po), JSON.stringify({ pred, po }));

  // Druhé načtení téhož stavu už archivy netahá
  const znovu = await page.evaluate(() => {
    window.__reads = [];
    var c = _collectCloud(window.__snapshot());
    return { pocet: c.archiveItems.length, cteni: window.__reads.slice() };
  });
  check('archivy jsou vždy k dispozici bez dalších čtení', znovu.pocet === 9 && znovu.cteni.length === 0, JSON.stringify(znovu));

  // ══════════════════════════════════════════════════════════════════
  section('3) Prodej položky — přesun do archivu');
  const a2024pred = await arch('2024');
  await page.evaluate(() => {
    var it = items.find(i => i.id === 's0');
    it.saleState = 'paid'; it.sellPrice = 4000; it.profit = 1900;
    it.saleDate = '2026-07-20'; it.payoutDate = '2026-08-05'; it.soldWhere = 'StockX';
  });
  await save();
  const m2 = await main();
  check('vznikl archiv 2026', (await store()).includes(D + 'sold_2026'), JSON.stringify(await store()));
  check('prodaná položka zmizela z hlavního dokumentu', !m2.itemsStock.some(i => i.id === 's0'), String(m2.itemsStock.length));
  check('prodaná položka je v archivu 2026', (await arch('2026')).items.map(i => i.id).join() === 's0');
  check('hlavní dokument má o položku míň (10)', m2.itemsStock.length === 10, String(m2.itemsStock.length));
  check('roky archivů jsou doplněné', JSON.stringify(m2.archiveYears) === JSON.stringify(['2024', '2025', '2026']), JSON.stringify(m2.archiveYears));
  check('přepsal se jen změněný rok', JSON.stringify(await page.evaluate(() => window.__lastBatch)) ===
    JSON.stringify(['set ' + D + 'sold_2026', 'set ' + D + 'data']), JSON.stringify(await page.evaluate(() => window.__lastBatch)));
  check('staré archivy zůstaly beze změny',
    JSON.stringify(await arch('2024')) === JSON.stringify(a2024pred), 'archiv 2024 se nezměnil');

  // ══════════════════════════════════════════════════════════════════
  section('4) Vrácení prodeje zpět na sklad');
  await page.evaluate(() => {
    var it = items.find(i => i.id === 's0');
    it.saleState = 'stock'; delete it.sellPrice; delete it.profit; delete it.saleDate; delete it.payoutDate; delete it.soldWhere;
    it.location = 'Doma';
  });
  await save();
  const m3 = await main();
  check('archiv 2026 se po vyprázdnění smazal', !(await store()).includes(D + 'sold_2026'), JSON.stringify(await store()));
  check('položka je zpátky v hlavním dokumentu', m3.itemsStock.some(i => i.id === 's0') && m3.itemsStock.length === 11, String(m3.itemsStock.length));
  check('rok 2026 zmizel ze seznamu roků', JSON.stringify(m3.archiveYears) === JSON.stringify(['2024', '2025']), JSON.stringify(m3.archiveYears));
  check('smazání proběhlo ve stejné dávce jako zápis', (await page.evaluate(() => window.__lastBatch)).includes('del ' + D + 'sold_2026'),
    JSON.stringify(await page.evaluate(() => window.__lastBatch)));
  check('počet položek pořád sedí', (await summary()).pocet === 20);

  // ══════════════════════════════════════════════════════════════════
  section('5) Oprava data payoutu přes hranici roku');
  await page.evaluate(() => { items.find(i => i.id === 'p25_0').payoutDate = '2026-01-04'; });
  await save();
  check('položka se přesunula do archivu 2026', (await arch('2026')).items.map(i => i.id).join() === 'p25_0');
  check('z archivu 2025 zmizela', !(await arch('2025')).items.some(i => i.id === 'p25_0') && (await arch('2025')).items.length === 4);
  const davka5 = await page.evaluate(() => window.__lastBatch);
  check('oba dotčené roky se zapsaly v jedné dávce',
    davka5.includes('set ' + D + 'sold_2025') && davka5.includes('set ' + D + 'sold_2026'), JSON.stringify(davka5));
  check('celkový počet se nezměnil', (await summary()).pocet === 20);

  // Zpátky na původní rok
  await page.evaluate(() => { items.find(i => i.id === 'p25_0').payoutDate = '2025-12-01'; });
  await save();
  check('vrácení data vrátí položku do 2025', (await arch('2025')).items.length === 5 && !(await store()).includes(D + 'sold_2026'));

  // ══════════════════════════════════════════════════════════════════
  section('6) Položka bez použitelného data');
  await page.evaluate(() => { items.push({ id: 'nodate', name: 'Bez data', category: 'sneakers', buyPrice: 500,
    buyCurrency: 'CZK', saleState: 'paid', sellPrice: 900, profit: 300, dateAdded: 9999, buyDate: '2026-01-01', tags: [] }); });
  await save();
  const m4 = await main();
  check('bez data payoutu i prodeje zůstane v hlavním dokumentu', m4.itemsStock.some(i => i.id === 'nodate'), JSON.stringify(m4.archiveYears));
  check('nevznikl archiv s nesmyslným rokem', (await store()).every(p => /sold_20(24|25)$/.test(p) || !/sold_/.test(p)), JSON.stringify(await store()));
  await page.evaluate(() => { items = items.filter(i => i.id !== 'nodate'); });
  await save();

  // ══════════════════════════════════════════════════════════════════
  section('7) Souběh dvou zařízení');
  // Zařízení B: čerstvý stav, načte cloud, změní položku na skladě a uloží
  const dvezar = await page.evaluate(() => new Promise(res => {
    window.__resetDevice();
    window.__load();
    items.find(i => i.id === 's1').buyPrice = 12345;
    window.__reads = [];
    fbSaveToCloud();
    setTimeout(function() {
      res({ davka: window.__lastBatch.slice(), cteni: window.__reads.slice(), pocet: items.length });
    }, 400);
  }));
  check('druhé zařízení nepřepisuje archivy, které nezměnilo',
    dvezar.davka.filter(o => /sold_/.test(o)).length === 0, JSON.stringify(dvezar.davka));
  check('druhé zařízení má pořád všech 20 položek', dvezar.pocet === 20, String(dvezar.pocet));

  // Zařízení A si změnu stáhne — a archivy znovu nečte, protože se nezměnily
  const zarA = await page.evaluate(() => {
    window.__reads = [];
    var r = window.__load();
    return { cena: (items.find(i => i.id === 's1') || {}).buyPrice, pocet: r.pocet, cteni: window.__reads.filter(p => /sold_/.test(p)) };
  });
  check('první zařízení vidí změnu z druhého', zarA.cena === 12345 && zarA.pocet === 20, JSON.stringify(zarA));
  check('nezměněné archivy se kvůli cizí změně netahají', zarA.cteni.length === 0, JSON.stringify(zarA.cteni));

  // Změna v archivu z druhého zařízení se ale propíše
  const archZmena = await page.evaluate(() => new Promise(res => {
    window.__resetDevice();
    window.__load();
    items.find(i => i.id === 'p24_0').profit = 777;
    fbSaveToCloud();
    setTimeout(function() {
      window.__resetDevice();          // ...a první zařízení (jiná paměť) si to načte
      var r = window.__load();
      res({ zisk: (items.find(i => i.id === 'p24_0') || {}).profit, pocet: r.pocet, zapsano: window.__lastBatch.slice() });
    }, 400);
  }));
  check('změna v archivu se zapíše i načte', archZmena.zisk === 777 && archZmena.pocet === 20, JSON.stringify(archZmena));
  check('zapsal se jen dotčený rok', archZmena.zapsano.filter(o => /sold_/.test(o)).join() === 'set ' + D + 'sold_2024', JSON.stringify(archZmena.zapsano));

  // ══════════════════════════════════════════════════════════════════
  section('8) Výpadek sítě uprostřed ukládání');
  ocekavameChyby = true;
  const pred8 = await main();
  const arch8 = await arch('2025');
  const vypadek = await page.evaluate(() => new Promise(res => {
    window.__failWrites = true;
    items.find(i => i.id === 'p25_1').profit = 99999;
    items.find(i => i.id === 's2').buyPrice = 88888;
    fbSaveToCloud();
    setTimeout(function() { window.__failWrites = false; res({ commits: window.__commits }); }, 400);
  }));
  const po8 = await main();
  check('neúspěšné uložení nezapsalo vůbec nic', JSON.stringify(po8) === JSON.stringify(pred8), 'savedAt ' + po8.savedAt + ' vs ' + pred8.savedAt);
  check('archiv zůstal nedotčený', JSON.stringify(await arch('2025')) === JSON.stringify(arch8));
  await save();
  const davka8 = await page.evaluate(() => window.__lastBatch);
  check('otisky se nezapamatovaly — další pokus zapíše archiv znovu',
    davka8.includes('set ' + D + 'sold_2025'), JSON.stringify(davka8));
  const po8b = await main();
  check('po obnovení sítě se zapíše všechno najednou',
    po8b.itemsStock.find(i => i.id === 's2').buyPrice === 88888 &&
    (await arch('2025')).items.find(i => i.id === 'p25_1').profit === 99999, 'ok');
  check('rozdělení po výpadku pořád obsahuje všech 20 položek',
    po8b.itemsStock.length + (await arch('2024')).items.length + (await arch('2025')).items.length === 20,
    String(po8b.itemsStock.length));

  // ══════════════════════════════════════════════════════════════════
  section('9) Archivy nedostupné — lokální data zůstanou');
  const nedostupne = await page.evaluate(() => {
    window.__resetDevice();
    var zaloha = window.__store['users/u1/sklad/sold_2024'];
    delete window.__store['users/u1/sklad/sold_2024'];     // archiv ve snímku chybí
    var c = _collectCloud(window.__snapshot());
    var m = _mergeCloudItems(c.data, c.archiveItems);
    window.__store['users/u1/sklad/sold_2024'] = zaloha;
    return { archivy: c.archiveItems, chybi: c.missing, merge: m ? m.length : null };
  });
  check('chybějící archiv vrátí null (ne půlku dat)', nedostupne.archivy === null && nedostupne.chybi.join() === '2024', JSON.stringify(nedostupne));
  check('bez zrcadla se při chybějícím archivu nesmí použít nic', nedostupne.merge === null, String(nedostupne.merge));

  // Dokument ze starší verze aplikace (kompletní seznam) se pořád načte celý
  const staraVerze = await page.evaluate(() => {
    const c = _collectCloud(window.__snapshot());
    const d = Object.assign({}, c.data);
    d.items = c.data.itemsStock.concat(window.__store['users/u1/sklad/sold_2024'].items,
      window.__store['users/u1/sklad/sold_2025'].items);
    delete d.archiveYears; delete d.itemsStock;      // jako by to zapsala stará verze
    return { delka: (_mergeCloudItems(d, []) || []).length };
  });
  check('dokument ze starší verze aplikace se načte celý', staraVerze.delka === 20, JSON.stringify(staraVerze));

  // Bez pojistky (vypnuté zrcadlo) se raději nedělá nic
  const bezPojistky = await page.evaluate(() => {
    var data = Object.assign({}, window.__store['users/u1/sklad/data'], { items: [] });
    return { merge: _mergeCloudItems(data, null) };
  });
  check('bez kompletního seznamu se při výpadku archivů nic nepřepíše', bezPojistky.merge === null, JSON.stringify(bezPojistky));

  const puvodniPocet = await page.evaluate(() => items.length);
  const neprepsano = await page.evaluate(() => {
    var data = Object.assign({}, window.__doc('data'), { items: [] });
    return { vysledek: _applyCloudData(data, null), pocet: items.length };
  });
  check('_applyCloudData s nedostupnými archivy nesmaže lokální data',
    neprepsano.vysledek === false && neprepsano.pocet === puvodniPocet, JSON.stringify(neprepsano));
  ocekavameChyby = false;

  // ══════════════════════════════════════════════════════════════════
  section('10) Nesouhlas rozdělení a kompletního seznamu');
  // Kontrola proti kompletnímu seznamu platí, když ho dokument nese
  // (starší verze aplikace nebo zapnutá přechodná pojistka)
  const nesoulad = await page.evaluate(() => {
    var data = JSON.parse(JSON.stringify(window.__doc('data')));
    var vse = data.itemsStock.concat(window.__store['users/u1/sklad/sold_2024'].items,
      window.__store['users/u1/sklad/sold_2025'].items);
    data.items = vse;                               // dokument nese i kompletní seznam
    data.itemsStock = data.itemsStock.slice(1);     // ...a rozdělení mu neodpovídá
    var out = _mergeCloudItems(data, window.__store['users/u1/sklad/sold_2024'].items
      .concat(window.__store['users/u1/sklad/sold_2025'].items));
    return { delka: out.length, jeLegacy: out.length === vse.length };
  });
  check('při nesouladu se použije kompletní seznam', nesoulad.jeLegacy && nesoulad.delka === 20, JSON.stringify(nesoulad));

  const cizi = await page.evaluate(() => {
    var data = JSON.parse(JSON.stringify(window.__doc('data')));
    data.items = data.itemsStock.concat(window.__store['users/u1/sklad/sold_2024'].items,
      window.__store['users/u1/sklad/sold_2025'].items);
    data.savedAt = '2027-01-01T00:00:00.000Z';   // hlavní dokument přepsal někdo jiný
    return _mergeCloudItems(data, []).length;
  });
  check('rozdělení od jiného zapisovatele se ignoruje', cizi === 20, String(cizi));

  // ══════════════════════════════════════════════════════════════════
  section('11) Ruční nahrání a stažení');
  const pred11 = await summary();
  await page.evaluate(() => { window.__resetDevice(); });
  await page.evaluate(() => fbForceUploadToCloud());
  await page.waitForTimeout(500);
  const rucni = await page.evaluate(() => window.__lastBatch.slice());
  check('ruční nahrání přepíše i všechny archivy',
    rucni.filter(o => /sold_/.test(o)).length === 2 && rucni.includes('set ' + D + 'data'), JSON.stringify(rucni));
  const stazeni = await page.evaluate(() => new Promise(res => {
    items = []; window.__resetDevice();
    fbForceLoadFromCloud();
    setTimeout(() => res({ pocet: items.length }), 700);
  }));
  check('ruční stažení složí kompletní sklad', stazeni.pocet === 20, String(stazeni.pocet));
  check('čísla po ručním kolečku sedí do posledního',
    JSON.stringify(await summary()) === JSON.stringify(pred11), JSON.stringify({ pred11, po: await summary() }));

  // ══════════════════════════════════════════════════════════════════
  section('12) Cache našeptávače ve vlastním dokumentu');
  const cache = await page.evaluate(() => new Promise(res => {
    itemCacheSet('Adidas Gazelle Bold', { sku: 'AB-123', stockxUrl: 'https://x/y', imgUrl: 'https://img/1.jpg' });
    fbSaveItemCache();
    setTimeout(function() {
      res({
        maDoc: !!window.__store['users/u1/sklad/cache'],
        vHlavnim: 'itemCache' in window.__store['users/u1/sklad/data'],
        obsah: Object.keys(JSON.parse(window.__store['users/u1/sklad/cache'].cache)).length,
      });
    }, 300);
  }));
  check('cache má vlastní dokument', cache.maDoc, JSON.stringify(cache));
  check('cache už nezabírá místo v hlavním dokumentu', !cache.vHlavnim, JSON.stringify(cache));
  check('cache obsahuje zapsaný záznam (klíč podle SKU i názvu)', cache.obsah >= 2, String(cache.obsah));

  const cacheLoad = await page.evaluate(() => {
    localStorage.removeItem('sklad_item_cache_v2');
    _itemCacheLoaded = false;
    _applyItemCacheDoc(window.__doc('cache'), undefined);
    return { klicu: Object.keys(itemCacheGet()).length, ma: !!itemCacheGet()['sku:ab-123'] };
  });
  check('cache se z vlastního dokumentu načte zpět', cacheLoad.ma && cacheLoad.klicu >= 2, JSON.stringify(cacheLoad));

  const cacheMigr = await page.evaluate(() => new Promise(res => {
    delete window.__store['users/u1/sklad/cache'];
    localStorage.removeItem('sklad_item_cache_v2');
    _itemCacheLoaded = false;
    _applyItemCacheDoc(undefined, JSON.stringify({ 'name:stará položka': { name: 'Stará položka', sku: 'OLD-1' } }));
    setTimeout(function() {
      res({ lokalne: !!itemCacheGet()['name:stará položka'], presunuto: !!window.__store['users/u1/sklad/cache'] });
    }, 300);
  }));
  check('cache ze starého formátu se načte i přesune do vlastního dokumentu',
    cacheMigr.lokalne && cacheMigr.presunuto, JSON.stringify(cacheMigr));

  const cacheBezneUlozeni = await page.evaluate(() => new Promise(res => {
    fbSaveToCloud();
    setTimeout(function() { res({ cachePrezila: !!window.__store['users/u1/sklad/cache'] }); }, 400);
  }));
  check('běžné uložení skladu cache nesmaže', cacheBezneUlozeni.cachePrezila, JSON.stringify(cacheBezneUlozeni));

  // ══════════════════════════════════════════════════════════════════
  section('13) Velikost dokumentu');
  const velikost = await page.evaluate(() => {
    var bezZrcadla = new Blob([JSON.stringify(_buildCloudPayload())]).size;
    CLOUD_LEGACY_MIRROR = true;
    var sZrcadlem = new Blob([JSON.stringify(_buildCloudPayload())]).size;
    CLOUD_LEGACY_MIRROR = false;
    return { sZrcadlem: sZrcadlem, bezZrcadla: bezZrcadla, polozek: items.length };
  });
  check('výchozí stav je bez přechodné pojistky a je menší', velikost.bezZrcadla < velikost.sZrcadlem,
    velikost.sZrcadlem + ' B → ' + velikost.bezZrcadla + ' B');

  // ══════════════════════════════════════════════════════════════════
  section('14) Vypnutá pojistka (cílový stav)');
  const cilovy = await page.evaluate(() => new Promise(res => {
    window.__resetDevice();
    fbSaveToCloud();
    setTimeout(function() {
      var d = window.__doc('data');
      var pocetVCloudu = d.items.length;
      items = []; window.__resetDevice();
      var r = window.__load();
      res({ mirrorPrazdny: pocetVCloudu === 0, nacteno: r.pocet, ok: r.ok, hlavni: d.itemsStock.length });
    }, 400);
  }));
  check('s vypnutou pojistkou je kompletní seznam prázdný', cilovy.mirrorPrazdny, JSON.stringify(cilovy));
  check('i tak se načte všech 20 položek', cilovy.nacteno === 20, JSON.stringify(cilovy));
  const poCilovem = await summary();

  // ══════════════════════════════════════════════════════════════════
  section('15) Přísná pravidla Firestore (archivy zakázané)');
  ocekavameChyby = true;
  const prisna = await page.evaluate(() => new Promise(res => {
    // Vyčisti a nastav pravidla tak, že projde jen dokument „data"
    Object.keys(window.__store).forEach(k => { if (/sold_/.test(k)) delete window.__store[k]; });
    window.__resetDevice(); _archivesBlocked = false;
    var puvodni = window._fbFns.writeBatch;
    window._fbFns.writeBatch = function() {
      var b = puvodni();
      var origSet = b.set, zakazano = false;
      b.set = function(ref, d) { if (/sold_/.test(ref.path)) zakazano = true; origSet(ref, d); };
      b.delete = function(ref) { if (/sold_/.test(ref.path)) zakazano = true; };
      var origCommit = b.commit;
      b.commit = function() {
        if (zakazano) { var e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return Promise.reject(e); }
        return origCommit();
      };
      return b;
    };
    fbSaveToCloud();
    setTimeout(function() {
      var d = window.__store['users/u1/sklad/data'];
      var prvni = { blokovano: _archivesBlocked, polozek: (d.items || []).length,
        maRozdeleni: 'archiveYears' in d || 'itemsStock' in d,
        archivy: Object.keys(window.__store).filter(k => /sold_/.test(k)).length };
      // Druhé uložení už dávku vůbec nezkouší
      items.find(i => i.id === 's3').buyPrice = 4242;
      fbSaveToCloud();
      setTimeout(function() {
        var d2 = window.__store['users/u1/sklad/data'];
        window._fbFns.writeBatch = puvodni;
        res({ prvni: prvni, druhe: { polozek: (d2.items || []).length,
          cena: (d2.items || []).find(i => i.id === 's3').buyPrice } });
      }, 400);
    }, 500);
  }));
  check('při zákazu archivů se přepne na starý způsob', prisna.prvni.blokovano, JSON.stringify(prisna.prvni));
  check('data se i tak uloží kompletní (20 položek)', prisna.prvni.polozek === 20, JSON.stringify(prisna.prvni));
  check('v dokumentu nezůstanou stopy po rozdělení', !prisna.prvni.maRozdeleni, JSON.stringify(prisna.prvni));
  check('nevznikl žádný archiv', prisna.prvni.archivy === 0, JSON.stringify(prisna.prvni));
  check('další uložení funguje normálně dál', prisna.druhe.polozek === 20 && prisna.druhe.cena === 4242, JSON.stringify(prisna.druhe));

  // Načtení takového dokumentu je zase „starý formát"
  const prisnaNacteni = await page.evaluate(() => {
    items = []; window.__resetDevice();
    return { pocet: window.__load().pocet };
  });
  check('starý formát se načte zpátky celý', prisnaNacteni.pocet === 20, JSON.stringify(prisnaNacteni));
  ocekavameChyby = false;

  // Po povolení pravidel se rozdělení zase samo obnoví
  await page.evaluate(() => { _archivesBlocked = false; });
  await save();
  check('po povolení pravidel se rozdělení samo obnoví',
    (await store()).includes(D + 'sold_2025') && (await main()).itemsStock.length === 11, JSON.stringify(await store()));

  // ══════════════════════════════════════════════════════════════════
  section('16) Mobil s nedotaženým archivem NESMÍ přepsat cloud');
  ocekavameChyby = true;
  // Přesně situace, kterou nahlásil uživatel: na PC přibyly položky, mobil
  // archiv nedostal a jeho vlastní uložení pak novější data přepsalo.
  const mobil = await page.evaluate(() => new Promise(res => {
    // 1) PC uloží kompletní stav včetně nové položky
    window.__resetDevice(); window.__load();
    items.push({ id: 'nova', name: 'Nová z PC', category: 'sneakers', buyPrice: 999, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: 99999, buyDate: '2026-08-01', tags: [] });
    fbSaveToCloud();
    setTimeout(function() {
      const vCloudu = window.__doc('data').items.length;
      // 2) Mobil: má starší lokální data a archiv mu ve snímku chybí
      const zaloha = window.__store['users/u1/sklad/sold_2025'];
      delete window.__store['users/u1/sklad/sold_2025'];
      window.__resetDevice();
      items = items.filter(i => i.id !== 'nova');        // mobil o nové položce neví
      const bezMirroru = Object.assign({}, window.__doc('data'), { items: [] });
      window.__store['users/u1/sklad/data'] = bezMirroru; // ostrý stav bez přechodné pojistky
      const r = window.__load();
      // 3) Uživatel na mobilu něco upraví → pokus o uložení
      items[0].buyPrice = 1;
      const commitsPred = window.__commits;
      fbSaveToCloud();
      setTimeout(function() {
        window.__store['users/u1/sklad/sold_2025'] = zaloha;
        res({
          vCloudu: vCloudu, neuplne: r.neuplne, nacteno: r.ok,
          mobilPocet: items.length,
          zapsal: window.__commits > commitsPred,
          cloudPolozek: (window.__doc('data').itemsStock || []).length,
        });
      }, 400);
    }, 400);
  }));
  check('mobil pozná, že cloud není celý', mobil.neuplne, JSON.stringify(mobil));
  check('mobil nepřepíše lokální data neúplným stavem', !mobil.nacteno, JSON.stringify(mobil));
  check('mobil NEULOŽÍ svá stará data do cloudu', !mobil.zapsal, JSON.stringify(mobil));
  check('nová položka z PC v cloudu zůstala', mobil.cloudPolozek === 12, JSON.stringify(mobil));

  // Jakmile archiv dorazí, všechno se srovná samo
  const dorovnani = await page.evaluate(() => {
    window.__resetDevice();
    const r = window.__load();
    return { neuplne: r.neuplne, pocet: r.pocet, maNovou: items.some(i => i.id === 'nova') };
  });
  check('po dorazení archivu se stav srovná sám', !dorovnani.neuplne && dorovnani.maNovou, JSON.stringify(dorovnani));
  check('a ukládání zase funguje', await (async () => {
    const c = await page.evaluate(() => window.__commits);
    await save();
    return (await page.evaluate(() => window.__commits)) > c;
  })());
  ocekavameChyby = false;
  await page.evaluate(() => { items = items.filter(i => i.id !== 'nova'); });
  await save();

  // ══════════════════════════════════════════════════════════════════
  section('17) Našeptávač si pamatuje i nikdy neprodané položky');
  const naseptavac = await page.evaluate(() => {
    localStorage.removeItem('sklad_item_cache_v2');
    localStorage.removeItem('sklad_item_cache_repair_v1');
    // Položka na skladě, která se nikdy neprodala
    items.push({ id: 'never', name: 'Nike Mind 001 Slide Triple Black', sku: 'IO0619-100',
      category: 'sneakers', buyPrice: 1500, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma',
      stockxUrl: 'https://stockx.com/nike-mind-001', imgUrl: 'https://img/mind.jpg',
      dateAdded: 77777, buyDate: '2026-05-01', tags: [] });
    const pridano = repairItemCache();
    const c = itemCacheGet();
    return {
      pridano: pridano,
      podleSku: c['sku:io0619-100'] || null,
      podleNazvu: c['name:nike mind 001 slide triple black'] || null,
      maSkladem: !!c['name:sklad 1'],
      maProdane: !!c['name:prodáno 2024 0'],
    };
  });
  check('do našeptávače se dostane i položka na skladě', !!naseptavac.podleSku, JSON.stringify(naseptavac.podleSku));
  check('najde se podle SKU i podle názvu', !!naseptavac.podleNazvu && naseptavac.podleSku.sku === 'IO0619-100', JSON.stringify(naseptavac));
  check('nese obrázek i odkaz', naseptavac.podleSku.imgUrl === 'https://img/mind.jpg' && !!naseptavac.podleSku.stockxUrl, JSON.stringify(naseptavac.podleSku));
  check('pamatuje si skladové i prodané', naseptavac.maSkladem && naseptavac.maProdane, JSON.stringify(naseptavac));

  // Smazání položky ze skladu o záznam v našeptávači nepřipraví
  const poSmazani = await page.evaluate(() => {
    items = items.filter(i => i.id !== 'never');
    const c = itemCacheGet();
    return { porad: !!c['sku:io0619-100'], vyplneno: (function() {
      const f = autoFillFromHistory('', 'IO0619-100');
      return f !== false;
    })() };
  });
  check('po smazání položky záznam v našeptávači zůstane', poSmazani.porad, JSON.stringify(poSmazani));

  // Oprava umí sáhnout i do automatických záloh (položky smazané dřív)
  const zeZaloh = await page.evaluate(() => {
    localStorage.removeItem('sklad_item_cache_v2');
    localStorage.setItem('sklad_v3_snapshots', JSON.stringify([{
      ts: '2026-01-01T00:00:00.000Z', label: 'test', count: 1,
      data: [{ id: 'davno', name: 'Dávno smazaná bota', sku: 'OLD-999', imgUrl: 'https://img/old.jpg' }],
    }]));
    repairItemCache();
    return { ma: !!itemCacheGet()['sku:old-999'], jmeno: (itemCacheGet()['sku:old-999'] || {}).name };
  });
  check('oprava vytáhne položky i z automatických záloh', zeZaloh.ma && zeZaloh.jmeno === 'Dávno smazaná bota', JSON.stringify(zeZaloh));

  // Cache dorazí ve stejném snímku jako data — bez zvláštního čtení
  const cacheZeSnimku = await page.evaluate(() => {
    window.__reads = [];
    localStorage.removeItem('sklad_item_cache_v2');
    _itemCacheLoaded = false;
    const c = _collectCloud(window.__snapshot());
    _applyItemCacheDoc(c.cache, c.data.itemCache);
    return { klicu: Object.keys(itemCacheGet()).length, cteni: window.__reads.length };
  });
  check('našeptávač se načte ze snímku bez dalšího čtení',
    cacheZeSnimku.klicu > 0 && cacheZeSnimku.cteni === 0, JSON.stringify(cacheZeSnimku));

  // ══════════════════════════════════════════════════════════════════
  section('18) Smazání účtu');
  const smazani = await page.evaluate(() => new Promise(res => {
    window.__store['users/u1/crm/main'] = { customers: [] };
    deleteAccount();
    setTimeout(function() {
      var btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Smazat účet');
      btns[btns.length - 1].click();
      setTimeout(function() { res({ zbylo: Object.keys(window.__store) }); }, 400);
    }, 300);
  }));
  check('smazání účtu odstraní hlavní dokument, archivy, cache i CRM',
    smazani.zbylo.length === 0, JSON.stringify(smazani.zbylo));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
