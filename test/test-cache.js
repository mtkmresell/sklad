// Test: našeptávač — opravy chybných záznamů, testovací položky, správa
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(() => localStorage.setItem('sklad_v3', JSON.stringify([])));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const cache = () => page.evaluate(() => itemCacheGet());

  // Přidá/upraví položku přes skutečný formulář
  async function ulozPolozku({ id, name, sku, img, stockx, buy = 1000 }) {
    await page.evaluate(async (p) => {
      editId = p.id || null;
      if (!editId) {
        // nová položka
        openAddModal ? openAddModal() : null;
      }
      document.getElementById('fName').value = p.name;
      document.getElementById('fSku').value = p.sku || '';
      document.getElementById('fImgUrl').value = p.img || '';
      document.getElementById('fStockxUrl').value = p.stockx || '';
      document.getElementById('fBuy').value = String(p.buy);
      var q = document.getElementById('fQty'); if (q) q.value = '1';
      var bd = document.getElementById('fBuyDate'); if (bd && !bd.value) bd.value = '2026-08-01';
      await saveItem();
    }, { id, name, sku, img, stockx, buy });
    await page.waitForTimeout(400);
  }

  // ══════════════════════════════════════════════════════════════
  section('1) Oprava chybného SKU');
  await ulozPolozku({ name: 'Nike boty 1', sku: '1111123', img: 'https://img/a.jpg' });
  const poPrvnim = await cache();
  check('nová položka se zapamatuje pod SKU i názvem',
    !!poPrvnim['sku:1111123'] && !!poPrvnim['name:nike boty 1'], JSON.stringify(Object.keys(poPrvnim)));

  const id1 = await page.evaluate(() => items[items.length - 1].id);
  await ulozPolozku({ id: id1, name: 'Nike boty 1', sku: '11124', img: 'https://img/a.jpg' });
  const poOprave = await cache();
  check('chybné SKU z našeptávače zmizí', !poOprave['sku:1111123'], JSON.stringify(Object.keys(poOprave)));
  check('správné SKU tam je', !!poOprave['sku:11124'], JSON.stringify(Object.keys(poOprave)));
  check('záznam pod názvem nese opravené SKU', poOprave['name:nike boty 1'].sku === '11124', JSON.stringify(poOprave['name:nike boty 1']));

  const naseptaniStare = await page.evaluate(() => {
    document.getElementById('fName').value = ''; document.getElementById('fSku').value = '';
    autoFillFromHistory('', '1111123');
    return { jmeno: document.getElementById('fName').value };
  });
  check('staré SKU už nic nenašeptá', naseptaniStare.jmeno === '', JSON.stringify(naseptaniStare));

  // ══════════════════════════════════════════════════════════════
  section('2) Oprava názvu');
  await ulozPolozku({ id: id1, name: 'Nike Dunk Low Panda', sku: '11124', img: 'https://img/a.jpg' });
  const poPrejmenovani = await cache();
  check('starý název z našeptávače zmizí', !poPrejmenovani['name:nike boty 1'], JSON.stringify(Object.keys(poPrejmenovani)));
  check('nový název tam je', !!poPrejmenovani['name:nike dunk low panda'], JSON.stringify(Object.keys(poPrejmenovani)));
  check('SKU pořád ukazuje na správný název', poPrejmenovani['sku:11124'].name === 'Nike Dunk Low Panda', JSON.stringify(poPrejmenovani['sku:11124']));

  // ══════════════════════════════════════════════════════════════
  section('3) Změna obrázku a odkazu');
  await ulozPolozku({ id: id1, name: 'Nike Dunk Low Panda', sku: '11124',
    img: 'https://img/NOVY.jpg', stockx: 'https://stockx.com/novy-odkaz' });
  const poZmeneUrl = await cache();
  check('nový obrázek se propíše', poZmeneUrl['sku:11124'].imgUrl === 'https://img/NOVY.jpg', JSON.stringify(poZmeneUrl['sku:11124']));
  check('nový odkaz se propíše', poZmeneUrl['sku:11124'].stockxUrl === 'https://stockx.com/novy-odkaz', JSON.stringify(poZmeneUrl['sku:11124']));
  check('oba klíče nesou stejnou verzi',
    poZmeneUrl['name:nike dunk low panda'].imgUrl === 'https://img/NOVY.jpg', JSON.stringify(poZmeneUrl['name:nike dunk low panda']));

  // Vymazání odkazu ho vymaže i z našeptávače
  await ulozPolozku({ id: id1, name: 'Nike Dunk Low Panda', sku: '11124', img: 'https://img/NOVY.jpg', stockx: '' });
  const poSmazaniUrl = await cache();
  check('smazaný odkaz zmizí i z našeptávače', !poSmazaniUrl['sku:11124'].stockxUrl, JSON.stringify(poSmazaniUrl['sku:11124']));

  // ══════════════════════════════════════════════════════════════
  section('4) Testovací položky se neevidují');
  const nazvy = await page.evaluate(() => ({
    test: isTestItemName('test'),
    test1: isTestItemName('test 1'),
    test123: isTestItemName('test123'),
    testPomlcka: isTestItemName('Test-2'),
    testovaci: isTestItemName('Testovací bota'),
    testovaciBezDia: isTestItemName('testovaci polozka'),
    // Nesmí chytat skutečné názvy
    testarossa: isTestItemName('Testarossa Edition'),
    nikeTest: isTestItemName('Nike Test Pack'),
    prazdne: isTestItemName(''),
  }));
  check('pozná test, test 1, test123, Test-2, Testovací',
    nazvy.test && nazvy.test1 && nazvy.test123 && nazvy.testPomlcka && nazvy.testovaci && nazvy.testovaciBezDia, JSON.stringify(nazvy));
  check('nechytá Testarossa ani Nike Test Pack',
    !nazvy.testarossa && !nazvy.nikeTest && !nazvy.prazdne, JSON.stringify(nazvy));

  await ulozPolozku({ name: 'test 5', sku: 'RANDOM-999', img: 'https://img/test.jpg' });
  const poTestu = await cache();
  check('testovací položka se do našeptávače nezapíše',
    !poTestu['name:test 5'] && !poTestu['sku:random-999'], JSON.stringify(Object.keys(poTestu)));
  check('a přitom v aplikaci normálně existuje',
    await page.evaluate(() => items.some(i => i.name === 'test 5')));

  // Přejmenování testovací položky na skutečnou ji do našeptávače dostane
  const idTest = await page.evaluate(() => items.find(i => i.name === 'test 5').id);
  await ulozPolozku({ id: idTest, name: 'Adidas Samba OG', sku: 'RANDOM-999', img: 'https://img/test.jpg' });
  const poPrejmenovaniTestu = await cache();
  check('po přejmenování na skutečný název se zapíše',
    !!poPrejmenovaniTestu['name:adidas samba og'] && !!poPrejmenovaniTestu['sku:random-999'], JSON.stringify(Object.keys(poPrejmenovaniTestu)));

  // A opačně — přejmenování na testovací ji vyhodí
  await ulozPolozku({ id: idTest, name: 'test 6', sku: 'RANDOM-999' });
  const zpatkyNaTest = await cache();
  check('přejmenování na testovací název záznam odstraní',
    !zpatkyNaTest['name:adidas samba og'] && !zpatkyNaTest['sku:random-999'], JSON.stringify(Object.keys(zpatkyNaTest)));

  // ══════════════════════════════════════════════════════════════
  section('5) Úklid už zapsaných blbostí');
  const uklid = await page.evaluate(() => {
    var c = itemCacheGet();
    c['name:test bota'] = { name: 'test bota', sku: 'TT-1' };
    c['sku:tt-1'] = { name: 'test bota', sku: 'TT-1' };
    c['name:testovaci vec'] = { name: 'Testovaci vec' };
    c['name:nike dunk low panda'] = c['name:nike dunk low panda'] || { name: 'Nike Dunk Low Panda' };
    localStorage.setItem('sklad_item_cache_v2', JSON.stringify(c));
    var pred = Object.keys(itemCacheGet()).length;
    var pryc = purgeTestEntriesFromCache();
    var po = itemCacheGet();
    return { pred: pred, pryc: pryc, po: Object.keys(po).length,
      zbylTest: !!po['name:test bota'] || !!po['sku:tt-1'] || !!po['name:testovaci vec'],
      zbylaSkutecna: !!po['name:nike dunk low panda'] };
  });
  check('úklid odstraní všechny testovací záznamy', uklid.pryc === 3 && !uklid.zbylTest, JSON.stringify(uklid));
  check('skutečné záznamy zůstanou', uklid.zbylaSkutecna, JSON.stringify(uklid));

  // ══════════════════════════════════════════════════════════════
  section('6) Nesmaže se cizí záznam');
  await ulozPolozku({ name: 'Sdílený název', sku: 'AAA-1' });
  const idA = await page.evaluate(() => items[items.length - 1].id);
  await ulozPolozku({ name: 'Sdílený název', sku: 'BBB-2' });
  // Úprava první položky nesmí shodit klíč názvu, který drží i ta druhá
  await ulozPolozku({ id: idA, name: 'Úplně jiný název', sku: 'AAA-1' });
  const sdilene = await cache();
  check('název používaný jinou položkou zůstane', !!sdilene['name:sdílený název'], JSON.stringify(Object.keys(sdilene).filter(k => /sdílen|jiný/.test(k))));
  check('a nový název přibyl', !!sdilene['name:úplně jiný název'], JSON.stringify(Object.keys(sdilene).filter(k => /jiný/.test(k))));

  // ══════════════════════════════════════════════════════════════
  section('7) Doplnění ze záloh a smazané položky');
  const zeZaloh = await page.evaluate(() => {
    localStorage.setItem('sklad_v3_snapshots', JSON.stringify([{
      ts: '2026-01-01T00:00:00.000Z', label: 'x', count: 2,
      data: [
        { id: 'z1', name: 'Nike Mind 001 Slide', sku: 'IO0619-100', imgUrl: 'https://img/mind.jpg' },
        { id: 'z2', name: 'test stará', sku: 'JUNK-1' },
      ],
    }]));
    var n = repairItemCache();
    var c = itemCacheGet();
    return { pridano: n, ma: !!c['sku:io0619-100'], junk: !!c['sku:junk-1'] };
  });
  check('smazaná položka se vytáhne ze zálohy', zeZaloh.ma, JSON.stringify(zeZaloh));
  check('testovací ze zálohy se nevytáhne', !zeZaloh.junk, JSON.stringify(zeZaloh));

  const naseptaniObnovene = await page.evaluate(() => {
    document.getElementById('fName').value = ''; document.getElementById('fSku').value = '';
    document.getElementById('fImgUrl').value = '';
    autoFillFromHistory('', 'IO0619-100');
    return { jmeno: document.getElementById('fName').value, img: document.getElementById('fImgUrl').value };
  });
  check('a rovnou i našeptá', naseptaniObnovene.jmeno === 'Nike Mind 001 Slide' && /mind\.jpg/.test(naseptaniObnovene.img), JSON.stringify(naseptaniObnovene));

  // ══════════════════════════════════════════════════════════════
  section('8) Okno správy');
  await page.evaluate(() => openItemCacheMgr());
  await page.waitForTimeout(400);
  const okno = await page.evaluate(() => ({
    otevreno: !!document.getElementById('itemCacheMgr'),
    radku: document.querySelectorAll('#icList .ic-row').length,
    zaznamu: itemCacheRecords().length,
  }));
  check('okno správy se otevře', okno.otevreno);
  check('vypíše záznamy sloučené do jednoho řádku', okno.radku === okno.zaznamu && okno.radku > 0, JSON.stringify(okno));

  const hledani = await page.evaluate(async () => {
    document.getElementById('icSearch').value = 'IO0619';
    renderItemCacheList();
    await new Promise(r => setTimeout(r, 100));
    return { radku: document.querySelectorAll('#icList .ic-row').length,
      text: document.getElementById('icList').textContent.includes('Nike Mind 001 Slide') };
  });
  check('hledání podle SKU funguje', hledani.radku === 1 && hledani.text, JSON.stringify(hledani));

  const smazani = await page.evaluate(async () => {
    var pred = itemCacheRecords().length;
    document.querySelector('#icList .ic-row button').click();
    await new Promise(r => setTimeout(r, 200));
    var c = itemCacheGet();
    return { pred: pred, po: itemCacheRecords().length, pryc: !c['sku:io0619-100'] && !c['name:nike mind 001 slide'] };
  });
  check('smazání záznamu odstraní oba jeho klíče', smazani.pryc && smazani.po === smazani.pred - 1, JSON.stringify(smazani));

  const zavreni = await page.evaluate(() => {
    document.getElementById('itemCacheMgr').click();
    return !document.getElementById('itemCacheMgr');
  });
  check('okno se zavře kliknutím mimo', zavreni);

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
