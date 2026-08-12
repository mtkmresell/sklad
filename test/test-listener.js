// Test: posluchač kolekce — skutečná cesta, která na mobilu selhala
const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SEED = [];
for (let i = 0; i < 6; i++) SEED.push({ id: 's' + i, name: 'Sklad ' + i, category: 'sneakers', buyPrice: 2000,
  buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 100 + i, buyDate: '2026-01-05', tags: [] });
for (let i = 0; i < 2; i++) SEED.push({ id: 'w' + i, name: 'Čeká ' + i, category: 'pokemon', buyPrice: 1500,
  buyCurrency: 'CZK', saleState: 'waiting', sellPrice: 3000, saleDate: '2026-07-01', soldWhere: 'Vinted',
  dateAdded: 200 + i, buyDate: '2026-02-05', tags: [] });
for (let i = 0; i < 4; i++) SEED.push({ id: 'p25_' + i, name: 'Prodáno 2025 ' + i, category: 'sneakers', buyPrice: 3000,
  buyCurrency: 'CZK', saleState: 'paid', sellPrice: 5000, profit: 1500, saleDate: '2025-11-01',
  payoutDate: '2025-12-0' + (i + 1), soldWhere: 'StockX', dateAdded: 300 + i, buyDate: '2025-06-01', tags: [] });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  let ocekavameChyby = false;
  page.on('console', m => { if (m.type() === 'error' && !ocekavameChyby && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);

  // Nastartuj posluchače přesně jako po přihlášení
  async function prihlas() {
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: { uid: 'u1' } } }));
    });
    await page.waitForTimeout(200);
  }
  const emit = async () => { await page.evaluate(() => window.__emitSnapshot && window.__emitSnapshot()); await page.waitForTimeout(400); };

  // ══════════════════════════════════════════════════════════════
  section('1) První přihlášení na čistém zařízení');
  await page.evaluate((seed) => {
    localStorage.clear();
    items = [];
    window.__store['users/u1/sklad/data'] = { items: JSON.parse(JSON.stringify(seed)), savedAt: '2026-08-01T10:00:00.000Z' };
    window._fbUser = { uid: 'u1' };
  }, SEED);
  await prihlas();
  await emit();
  const prvni = await page.evaluate(() => ({ pocet: items.length, ready: _fbCloudReady, neuplne: _cloudIncomplete }));
  check('posluchač kolekce načte data ze starého formátu', prvni.pocet === 12, JSON.stringify(prvni));
  check('cloud je označený jako připravený', prvni.ready && !prvni.neuplne, JSON.stringify(prvni));

  // ══════════════════════════════════════════════════════════════
  section('2) Uložení rozdělí data a posluchač je složí zpět');
  await page.evaluate(() => fbSaveToCloud());
  await page.waitForFunction(() => !!window.__store['users/u1/sklad/sold_2025'], null, { timeout: 5000 });
  await emit();
  const poRozdeleni = await page.evaluate(() => ({
    pocet: items.length,
    dokumenty: Object.keys(window.__store).sort(),
    vHlavnim: window.__store['users/u1/sklad/data'].itemsStock.length,
  }));
  check('vznikly archivy', poRozdeleni.dokumenty.includes('users/u1/sklad/sold_2025'), JSON.stringify(poRozdeleni.dokumenty));
  check('po překreslení má aplikace pořád všech 12 položek', poRozdeleni.pocet === 12, JSON.stringify(poRozdeleni));
  check('v hlavním dokumentu je jen 8 (sklad + čeká)', poRozdeleni.vHlavnim === 8, String(poRozdeleni.vHlavnim));

  // ══════════════════════════════════════════════════════════════
  section('3) Přidání položky na druhém zařízení');
  // Druhé zařízení zapíše do úložiště a posluchač dostane snímek
  await page.evaluate(() => {
    const d = window.__store['users/u1/sklad/data'];
    const nova = { id: 'pc-nova', name: 'Přidáno na PC', category: 'sneakers', buyPrice: 4321, buyCurrency: 'CZK',
      saleState: 'stock', location: 'Doma', dateAdded: 999999, buyDate: '2026-08-10', tags: [] };
    d.itemsStock = d.itemsStock.concat([nova]);
    d.items = d.items.length ? d.items.concat([nova]) : [];
    d.savedAt = new Date(Date.now() + 60000).toISOString();
    d.splitSavedAt = d.savedAt;
  });
  await emit();
  const poPridani = await page.evaluate(() => ({
    pocet: items.length, ma: items.some(i => i.id === 'pc-nova'),
  }));
  check('přidaná položka z druhého zařízení dorazí', poPridani.ma && poPridani.pocet === 13, JSON.stringify(poPridani));

  // ══════════════════════════════════════════════════════════════
  section('4) Snímek bez archivu (situace z mobilu)');
  ocekavameChyby = true;
  await page.evaluate(() => {
    window.__zalohaArch = window.__store['users/u1/sklad/sold_2025'];
    delete window.__store['users/u1/sklad/sold_2025'];
    const d = window.__store['users/u1/sklad/data'];
    d.items = [];                                    // ostrý stav bez přechodné pojistky
    d.savedAt = new Date(Date.now() + 120000).toISOString();
    d.splitSavedAt = d.savedAt;
  });
  await emit();
  const bezArch = await page.evaluate(() => ({
    pocet: items.length, neuplne: _cloudIncomplete,
    tecka: (document.getElementById('fbStatusDot') || {}).className,
  }));
  check('aplikace si data nechá (nesmaže je)', bezArch.pocet === 13, JSON.stringify(bezArch));
  check('stav je označený jako neúplný', bezArch.neuplne, JSON.stringify(bezArch));
  check('indikátor ukazuje chybu', /fb-error/.test(bezArch.tecka || ''), bezArch.tecka);

  const pokusOUlozeni = await page.evaluate(() => new Promise(res => {
    const pred = window.__commits;
    items[0].buyPrice = 111;
    sv();
    setTimeout(() => res({ zapsal: window.__commits > pred }), 900);
  }));
  check('v neúplném stavu se do cloudu nezapisuje', !pokusOUlozeni.zapsal, JSON.stringify(pokusOUlozeni));

  // ══════════════════════════════════════════════════════════════
  section('5) Archiv dorazí — všechno se srovná');
  await page.evaluate(() => {
    window.__store['users/u1/sklad/sold_2025'] = window.__zalohaArch;
  });
  await emit();
  const srovnano = await page.evaluate(() => ({ pocet: items.length, neuplne: _cloudIncomplete }));
  check('stav se srovná sám', !srovnano.neuplne && srovnano.pocet === 13, JSON.stringify(srovnano));
  ocekavameChyby = false;

  const zaseUklada = await page.evaluate(() => new Promise(res => {
    const pred = window.__commits;
    items[0].buyPrice = 222;
    sv();
    setTimeout(() => res({ zapsal: window.__commits > pred, cena: (window.__store['users/u1/sklad/data'].itemsStock.find(i => i.id === items[0].id) || {}).buyPrice }), 900);
  }));
  check('ukládání zase funguje', zaseUklada.zapsal, JSON.stringify(zaseUklada));
  check('a zapsalo správnou hodnotu', zaseUklada.cena === 222, JSON.stringify(zaseUklada));

  // ══════════════════════════════════════════════════════════════
  section('6) Prodej položky přes posluchače');
  await page.evaluate(() => {
    const it = items.find(i => i.id === 's0');
    it.saleState = 'paid'; it.sellPrice = 6000; it.profit = 3000;
    it.saleDate = '2026-07-01'; it.payoutDate = '2026-08-05'; it.soldWhere = 'Vinted';
    sv();
  });
  await page.waitForFunction(() => !!window.__store['users/u1/sklad/sold_2026'], null, { timeout: 6000 }).catch(() => {});
  await emit();
  const poProdeji = await page.evaluate(() => ({
    pocet: items.length,
    vArchivu: ((window.__store['users/u1/sklad/sold_2026'] || {}).items || []).length,
    vHlavnim: window.__store['users/u1/sklad/data'].itemsStock.length,
    prodano: items.filter(i => i.saleState === 'paid').length,
  }));
  check('prodaná položka se přesune do archivu 2026', poProdeji.vArchivu === 1, JSON.stringify(poProdeji));
  check('počet položek se nezměnil', poProdeji.pocet === 13, JSON.stringify(poProdeji));
  check('sekce Prodáno má o jednu víc', poProdeji.prodano === 5, JSON.stringify(poProdeji));

  // ══════════════════════════════════════════════════════════════
  section('7) Našeptávač po celém kolečku');
  const naseptavac = await page.evaluate(() => {
    const c = itemCacheGet();
    return {
      klicu: Object.keys(c).length,
      maSkladovou: !!c['name:sklad 1'],
      maPridanou: !!c['name:přidáno na pc'],
      vCloudu: !!window.__store['users/u1/sklad/cache'],
    };
  });
  check('našeptávač zná i položky, které se nikdy neprodaly', naseptavac.maSkladovou, JSON.stringify(naseptavac));
  check('zná i položku přidanou na druhém zařízení', naseptavac.maPridanou, JSON.stringify(naseptavac));
  check('cache je uložená ve vlastním dokumentu', naseptavac.vCloudu, JSON.stringify(naseptavac));

  // ══════════════════════════════════════════════════════════════
  section('8) Odhlášení a přihlášení jiného účtu');
  await page.evaluate(() => {
    window._fbUser = null;
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: {} }));
  });
  await page.waitForTimeout(300);
  const poOdhlaseni = await page.evaluate(() => ({
    pocet: items.length, hashes: Object.keys(_archiveHashes).length,
    cache: _archiveCache, neuplne: _cloudIncomplete, cacheFlag: _itemCacheLoaded,
  }));
  check('po odhlášení se stav archivů zapomene',
    poOdhlaseni.hashes === 0 && poOdhlaseni.cache === null && !poOdhlaseni.cacheFlag, JSON.stringify(poOdhlaseni));
  check('neúplnost se resetuje', !poOdhlaseni.neuplne, JSON.stringify(poOdhlaseni));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
