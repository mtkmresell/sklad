// Test: bezpečné vkládání do HTML (v index.html BEZPEČNÉ VKLÁDÁNÍ DO HTML).
//
// Název položky, SKU, poznámka, „Od koho", číslo objednávky, sledovací číslo
// i odkazy jsou text od člověka nebo z importu. Kdyby se do stránky vložily
// neošetřené, název s HTML by spustil cizí skript v přihlášené aplikaci
// (OWASP: Injection / XSS). Tady se zlá data proženou všemi hlavními pohledy
// a nic se nesmí spustit ani vložit jako prvek.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }
const M = 'majitel1';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);
  const dnes = new Date().toISOString().slice(0, 10);
  await page.evaluate((d) => {
    const ZLO = (n) => '<img src="x" onerror="window.__xss=(window.__xss||\'\')+\'' + n + ';\'">';
    const kus = (id, extra) => Object.assign({ id, name: 'Dunk ' + ZLO('name'), sku: 'SK' + ZLO('sku'), size: '42' + ZLO('size'), category: 'sneakers',
      buyPrice: 1000, buyDate: d.dnes, buyWhere: 'Nike' + ZLO('where'), from: 'Pepa' + ZLO('from'), orderNum: 'OBJ' + ZLO('obj'), note: 'pozn' + ZLO('note'),
      invoiceUrl: 'javascript:window.__xss=\'href;\'', stockxUrl: 'javascript:window.__xss=\'stockx;\'', saleState: 'stock', platforms: [] }, extra || {});
    localStorage.clear(); window.__store = {}; window.__xss = '';
    window.__store['users/' + d.M + '/sklad/data'] = { savedAt: new Date().toISOString(), items: [
      kus('a1'),
      kus('a2', { saleState: 'waiting', waitState: 'sent', sellPrice: 2000, saleDate: d.dnes, soldWhere: 'Vinted', trackingCarrier: 'DPD',
        trackingNum: "123');window.__xss='trk;';('", trackingUrl: "javascript:window.__xss='trkurl;'", location: 'Na cestě' }),
      kus('a3', { saleState: 'paid', sellPrice: 2000, saleDate: d.dnes, payoutDate: d.dnes, soldWhere: 'Vinted', saleInvoiceUrl: 'javascript:window.__xss=\'sale;\'' }),
    ] };
    window._fbUser = { uid: d.M, email: 'm@test.cz' };
    document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: { uid: d.M } } }));
  }, { M, dnes });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__emitSnapshot && window.__emitSnapshot());
  await page.waitForTimeout(500);
  check('položky se načetly', await page.evaluate(() => items.length === 3));

  const projdi = async (jmeno) => {
    await page.waitForTimeout(250);
    const r = await page.evaluate(async () => {
      // klikni na všechny odkazy a prvky s inline onclick, které nesou sledovací číslo
      document.querySelectorAll('a[href^="javascript"]').forEach(a => { try { a.click(); } catch (e) {} });
      document.querySelectorAll('[onclick*="zkopiruj"]').forEach(a => { try { a.onclick && a.onclick(new MouseEvent('click')); } catch (e) {} });
      await new Promise(r => setTimeout(r, 150));
      return { xss: window.__xss, img: document.querySelectorAll('img[src="x"]').length, js: document.querySelectorAll('a[href^="javascript"]').length };
    });
    check(jmeno + ': nic se nespustilo, žádný vložený prvek ani javascript: odkaz', r.xss === '' && r.img === 0 && r.js === 0, JSON.stringify(r));
  };

  section('1) Seznamy');
  for (const t of ['stock', 'waiting', 'sold']) {
    for (const v of ['table', 'cards']) {
      await page.evaluate((d) => { switchTab(d.t); if (typeof setView === 'function') setView(d.v); renderItems(); }, { t, v });
      await projdi(t + ' / ' + v);
    }
  }
  check('název je v tabulce vidět jako text', await page.evaluate(() => { switchTab('stock'); setView('table'); renderItems(); return /<img src="x"/.test(document.getElementById('itemsGrid').textContent); }));

  // Oprava z 14. 11.: prázdná velikost má značku „×“, ne vypsané „<span…“ (ošetřilo se i HTML z convertSize)
  check('kus bez velikosti: v tabulce není vidět kus HTML jako text', await page.evaluate(() => {
    items.push({ id: 'b1', name: 'Bez velikosti', category: 'pokemon', buyPrice: 100, buyDate: items[0].buyDate, saleState: 'stock', platforms: [] });
    switchTab('stock'); setView('table'); renderItems();
    const r = !/<span|&lt;span/.test(document.getElementById('itemsGrid').textContent);
    items.pop(); renderItems(); return r;
  }));

  section('2) Detail položky');
  for (const id of ['a1', 'a2', 'a3']) {
    await page.evaluate((i) => openDetail(i), id);
    await projdi('detail ' + id);
    await page.evaluate(() => cm('moDetail'));
  }

  section('3) Hledání a analytika');
  await page.evaluate(() => { if (typeof openGlobalSearch === 'function') { openGlobalSearch(); const i = document.querySelector('#globalSearchInput, .gs-input, #gsInput'); if (i) { i.value = 'Dunk'; i.dispatchEvent(new Event('input', { bubbles: true })); } } });
  await projdi('hledání napříč sekcemi');
  await page.evaluate(() => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); const g = document.getElementById('globalSearchOv') || document.querySelector('.gs-ov'); if (g) g.remove(); });
  await page.evaluate(() => { try { if (typeof openUcetnictvi === 'function') { openUcetnictvi(); ucZalozka('prodeje'); ucZalozka('nakupy'); } } catch (e) {} });
  await projdi('okno Účetnictví');
  await page.evaluate(() => { try { zavriUcetnictvi(); } catch (e) {} });

  section('3b) Zákazníci, wishlist, analytika, hromadná okna, hlášky');
  await page.evaluate(() => {
    const Z = (n) => '<img src="x" onerror="window.__xss=(window.__xss||\'\')+\'' + n + ';\'">';
    const osoba = (id, typ) => ({ id, type: typ, name: 'Karel ' + Z('cname'), instagram: 'ig' + Z('ig'), ig: 'ig' + Z('ig'), phone: '777' + Z('tel'), email: 'a@b.cz' + Z('mail'),
      note_quick: 'q' + Z('nq'), note_special: 's' + Z('ns'), note: 'n' + Z('cnote'), pickup: 'Z-BOX ' + Z('pickup'), pickup_url: "javascript:window.__xss='pickupurl;'",
      address: 'Ulice ' + Z('adr'), city: 'Brno' + Z('city'), delivery: 'Zásilkovna' + Z('deliv'), tags_likes: ['Nike' + Z('like')], tags_dislikes: ['Puma' + Z('dislike')],
      sizes: '42' + Z('csize'), discord: 'd' + Z('discord'), company: 'Firma' + Z('firma'), ico: '123' + Z('ico'), created: new Date().toISOString() });
    customers = [osoba('c1', 'b2c')]; partners = [osoba('p1', 'b2b')];
    items.forEach((it, i) => {
      it.linkedCustomerId = 'c1'; it.fromPartnerId = 'p1'; it.brand = 'Nike' + Z('brand'); it.tags = ['štítek' + Z('tag')]; it.location = 'Doma' + Z('loc');
      it.saleRef = 'REF' + Z('ref'); it.paymentMethod = 'Převod' + Z('pay'); it.demandSource = 'ig'; it.condition = 'DS' + Z('cond');
      if (it.saleState !== 'stock') it.soldWhere = 'Vinted' + Z('sold');
    });
    wishItems = [{ id: 'w1', name: 'Chci ' + Z('wname'), sku: 'W' + Z('wsku'), size: '43' + Z('wsize'), note: 'pozn' + Z('wnote'), maxPrice: 1000, price: 1000,
      url: "javascript:window.__xss='wurl;'", link: "javascript:window.__xss='wurl;'", category: 'sneakers', priority: 'high' + Z('wprio'), customer: 'Karel' + Z('wcust'), created: new Date().toISOString() }];
  });
  const kroky = [
    ['zákazníci — seznam', () => { switchTab('customers'); }],
    ['zákazníci — detail', () => { openCustomerDetail('c1'); }],
    ['partneři — seznam', () => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); crmSwitchMode('b2b'); }],
    ['partneři — detail', () => { openCustomerDetail('p1'); }],
    ['zákazníci — analytika', () => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); try { crmSwitchMode('analytics'); } catch (e) {} }],
    ['wishlist', () => { switchTab('wishlist'); renderWishlist(); }],
    ['analytika skladu', () => { switchTab('stock'); stockViewMode = 'analytics'; renderItems(); }],
    ['analytika prodejů', () => { stockViewMode = 'table'; switchTab('sold'); soldViewMode = 'analytics'; renderSoldView(); }],
    ['cashflow', () => { soldViewMode = 'table'; switchTab('waiting'); try { openPayoutCalendar(); } catch (e) {} }],
    ['úprava položky', () => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); document.querySelectorAll('body > div[style*="position:fixed"]').forEach(d => { if (d.id !== 'sklad-tip') d.remove(); }); switchTab('stock'); openEdit('a1'); }],
    ['okno Přesunout / prodat', () => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); try { openSellModal('a1'); } catch (e) {} }],
    ['hromadný výběr a jeho okna', () => {
      document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open'));
      setView('table'); renderItems(); if (!bulkMode) toggleBulkMode();
      bulkSelected.add('a1'); try { updateBulkBar(); } catch (e) {}
      ['bulkchangeloc', 'bulktags', 'bulkprofile', 'bulkprodat'].forEach(a => { const b = document.querySelector('#bulkBar [data-action="' + a + '"]'); if (b) b.click(); });
    }],
    ['hlášky', () => { showToast('Smazáno: ' + items[0].name); showToast(customers[0].name, 'err'); }],
  ];
  for (const [jmeno, fn] of kroky) {
    const chyba = await page.evaluate((f) => { try { (0, eval)('(' + f + ')')(); return ''; } catch (e) { return String(e); } }, fn.toString());
    if (chyba) console.log('   (krok „' + jmeno + '" hodil: ' + chyba.slice(0, 120) + ')');
    await projdi(jmeno);
  }
  check('hláška ukáže název jako text', await page.evaluate(() => Array.from(document.querySelectorAll('.toast, [class*="toast"]')).some(t => /<img src="x"/.test(t.textContent))));
  check('cizí skripty se nenačítají (jen Firebase), knihovny pro Excel jsou v repozitáři', await page.evaluate(() =>
    Array.from(document.scripts).every(s => !s.src || /^file:|^https:\/\/www\.gstatic\.com\/firebasejs\//.test(s.src)))
    && fs.existsSync(path.resolve(__dirname, '..', 'knihovny', 'xlsx.full.min.js')) && fs.existsSync(path.resolve(__dirname, '..', 'knihovny', 'exceljs.min.js')));
  check('knihovny nejsou v .assetsignore', !/knihovny/.test(fs.readFileSync(path.resolve(__dirname, '..', '.assetsignore'), 'utf8')));

  section('4) Pomocné funkce a hlavičky');
  const f = await page.evaluate(() => ({
    js: _odkazHtml('javascript:alert(1)'), data: _odkazHtml('data:text/html,x'), ok: _odkazHtml('https://a.cz/x?a=1&b="2"'), bez: _odkazHtml('www.onedrive.com/abc'),
    txt: _jsText("12'3\\\"<>&`\n4"), esc: escHtml('<b a="1">'),
  }));
  check('javascript: a data: odkaz se nepustí', f.js === '#' && f.data === '#', JSON.stringify(f));
  check('běžný odkaz projde a uvozovky se ošetří', f.ok === 'https://a.cz/x?a=1&amp;b=&quot;2&quot;', f.ok);
  check('adresa bez https:// dostane https://', f.bez === 'https://www.onedrive.com/abc', f.bez);
  check('text do onclick přijde o uvozovky a zpětná lomítka', f.txt === '1234', f.txt);
  const koren = path.resolve(__dirname, '..');
  const hl = fs.existsSync(path.join(koren, '_headers')) ? fs.readFileSync(path.join(koren, '_headers'), 'utf8') : '';
  check('web posílá bezpečnostní hlavičky (_headers)', /X-Content-Type-Options: nosniff/.test(hl) && /X-Frame-Options: DENY/.test(hl) && /Referrer-Policy/.test(hl));
  check('_headers není v .assetsignore (jinak by se nepoužil)', !/^_headers$/m.test(fs.readFileSync(path.join(koren, '.assetsignore'), 'utf8')));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAIL' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
