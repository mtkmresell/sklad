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
