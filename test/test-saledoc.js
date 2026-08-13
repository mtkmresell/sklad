// Test: prodejní doklad pro koncového zákazníka
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SEED = [
  { id: 'p1', name: 'Nike Dunk Low Panda', category: 'sneakers', sku: 'DD1391-100', size: '43',
    buyPrice: 3000, buyCurrency: 'CZK', sellPrice: 5200, profit: 2000, saleState: 'paid',
    saleDate: '2026-07-15', payoutDate: '2026-07-25', soldWhere: 'Vinted', paymentMethod: 'Revolut',
    dateAdded: 1, buyDate: '2026-05-01', tags: [] },
  { id: 'p2', name: 'Jordan 1 Chicago', category: 'sneakers', sku: 'DZ5485-612', size: '44',
    buyPrice: 6000, buyCurrency: 'CZK', sellPrice: 12000, profit: 5000, saleState: 'paid',
    saleDate: '2026-08-02', payoutDate: '2026-08-10', soldWhere: 'StockX',
    dateAdded: 2, buyDate: '2026-06-01', tags: [] },
  { id: 'p3', name: 'Eurová bota', category: 'sneakers', buyPrice: 100, buyCurrency: 'EUR',
    sellPrice: 5000, sellPriceOrig: 200, sellCurrency: 'EUR', profit: 2000, saleState: 'paid',
    saleDate: '2026-08-05', payoutDate: '2026-08-12', soldWhere: 'Klekt',
    dateAdded: 3, buyDate: '2026-06-01', tags: [] },
  { id: 's1', name: 'Na skladě', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: 4, buyDate: '2026-06-01', tags: [] },
];

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

  // Zachyť obsah dokladu místo otevírání okna
  await page.evaluate(() => {
    window.__doklad = null;
    window.open = function() {
      return { document: { write: function(h) { window.__doklad = h; }, close: function() {} } };
    };
  });
  const doklad = async (id) => {
    await page.evaluate((i) => { window.__doklad = null; openSaleDocument(i); }, id);
    await page.waitForTimeout(150);
    return page.evaluate(() => window.__doklad);
  };
  const text = (h) => h.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  // ══════════════════════════════════════════════════════════════
  section('1) Číslo dokladu');
  let c1 = await page.evaluate(() => saleDocNumber(items.find(i => i.id === 'p1')));
  check('první doklad roku dostane 001', c1 === '2026-001', c1);
  let c1znovu = await page.evaluate(() => saleDocNumber(items.find(i => i.id === 'p1')));
  check('opětovné vystavení číslo nemění', c1znovu === c1, c1znovu);
  let c2 = await page.evaluate(() => saleDocNumber(items.find(i => i.id === 'p2')));
  check('další doklad pokračuje v řadě', c2 === '2026-002', c2);
  check('číslo zůstane u položky',
    await page.evaluate(() => items.find(i => i.id === 'p1').saleDocNum) === '2026-001');

  const jinyRok = await page.evaluate(() => {
    const it = { id: 'x', name: 'Loňská', saleState: 'paid', payoutDate: '2025-03-01', sellPrice: 1000 };
    items.push(it);
    const n = saleDocNumber(it);
    items = items.filter(i => i.id !== 'x');
    return n;
  });
  check('rok se bere z data payoutu a řada je po letech', jinyRok === '2025-001', jinyRok);

  // ══════════════════════════════════════════════════════════════
  section('2) Obsah dokladu');
  let h = await doklad('p1');
  let t = text(h);
  check('doklad se vygeneroval', !!h && h.length > 500, String((h || '').length));
  check('má nadpis a číslo', /Prodejní doklad/.test(t) && /2026-001/.test(t), t.slice(0, 100));
  check('obsahuje název i SKU položky', /Nike Dunk Low Panda/.test(t) && /DD1391-100/.test(t), t.slice(0, 200));
  check('obsahuje velikost a způsob platby', /43/.test(t) && /Revolut/.test(t), t.slice(0, 300));
  const datumOcek = await page.evaluate(() => fmtDate('2026-07-15'));
  check('uvádí datum prodeje', t.includes(datumOcek), 'čekáno ' + datumOcek + ' | ' + t.slice(0, 160));
  check('uvádí cenu', /5 ?200/.test(t.replace(/[  ]/g, ' ')), t.slice(0, 400));
  check('má právní větu o DPH', /není daňovým dokladem/.test(t), t.slice(-260));
  check('podpisy jsou vypnuté, dokud si je nezapneš', !/Podpis prodávajícího/.test(t), t.slice(-200));
  check('má tlačítko na tisk, které se netiskne',
    /window\.print\(\)/.test(h) && /\.noprint\{display:none;?\}/.test(h.replace(/\s/g, '')), 'ok');

  // ══════════════════════════════════════════════════════════════
  section('3) Údaje prodávajícího');
  check('bez vyplněných údajů se nespadne, jen chybí jméno', /Prodávající — |Prodávající —/.test(t) || /—/.test(t));
  await page.evaluate(() => saveSeller({ name: 'Michal Novák', address: 'Dlouhá 12\nPraha 1', ico: '12345678',
    email: 'michal@example.cz', phone: '+420 111 222 333', note: 'Zboží je použité, prodáno bez záruky.',
    legal: SELLER_LEGAL_DEFAULT, signatures: true }));
  h = await doklad('p1'); t = text(h);
  check('jméno prodávajícího je na dokladu', /Michal Novák/.test(t), t.slice(0, 200));
  check('adresa se zalomí na řádky', /Dlouhá 12<br>Praha 1/.test(h), 'ok');
  check('IČO, e-mail i telefon', /12345678/.test(t) && /michal@example\.cz/.test(t) && /420 111 222 333/.test(t), t.slice(0, 300));
  check('vlastní poznámka je nad právní větou',
    t.indexOf('Zboží je použité') < t.indexOf('není daňovým dokladem'), 'ok');
  check('zapnuté podpisy se objeví', /Podpis prodávajícího/.test(t) && /Podpis kupujícího/.test(t), t.slice(-200));

  const pravni = await page.evaluate(() => {
    saveSeller(Object.assign({}, getSeller(), { legal: 'Vlastní právní věta.' }));
    return { vychozi: SELLER_LEGAL_DEFAULT.length > 20 };
  });
  h = await doklad('p1'); t = text(h);
  check('právní větu jde přepsat', /Vlastní právní věta\./.test(t) && !/není daňovým dokladem/.test(t), t.slice(-200));
  await page.evaluate(() => saveSeller(Object.assign({}, getSeller(), { legal: SELLER_LEGAL_DEFAULT })));
  check('výchozí právní věta existuje', pravni.vychozi);

  const ulozeno = await page.evaluate(() => ({
    lokalne: JSON.parse(localStorage.getItem('sklad_seller_v1') || '{}').name,
    vBalicku: (_buildCloudPayload().seller || {}).name,
    vSeznamu: syncSettings().some(s => s.key === 'sklad_seller_v1'),
  }));
  check('údaje se synchronizují jako nastavení',
    ulozeno.lokalne === 'Michal Novák' && ulozeno.vBalicku === 'Michal Novák' && ulozeno.vSeznamu,
    JSON.stringify(ulozeno));

  // ══════════════════════════════════════════════════════════════
  section('4) Kupující z CRM');
  h = await doklad('p2'); t = text(h);
  check('bez napojeného zákazníka je kupující neuvedený', /Neuvedeno/.test(t), t.slice(0, 300));

  await page.evaluate(() => {
    const id = _crmCreateMinimal('Petra Svobodová', 'b2c');
    const c = customers.find(x => x.id === id);
    c.contacts = [{ type: 'email', value: 'petra@example.cz' }, { type: 'telefon', value: '+420 777 888 999' },
      { type: 'instagram', value: '@petra' }];
    items.find(i => i.id === 'p2').linkedCustomerId = id;
  });
  h = await doklad('p2'); t = text(h);
  check('jméno zákazníka z CRM', /Petra Svobodová/.test(t), t.slice(0, 300));
  check('e-mail i telefon zákazníka', /petra@example\.cz/.test(t) && /777 888 999/.test(t), t.slice(0, 350));
  check('instagram na doklad nepatří', !/@petra/.test(t), t.slice(0, 350));

  // Doručovací údaje ze zákazníka
  await page.evaluate(() => {
    const c = customers.find(x => x.name === 'Petra Svobodová');
    c.pickup = 'Zásilkovna Praha 7, Dělnická 12';
    c.address = 'Dlouhá 5, Praha 1, 11000';
  });
  h = await doklad('p2'); t = text(h);
  check('výdejní místo je na dokladu jako doručení', /Zásilkovna Praha 7/.test(t), t.slice(0, 400));
  check('adresa kupujícího taky', /Dlouhá 5, Praha 1/.test(t), t.slice(0, 400));

  // ══════════════════════════════════════════════════════════════
  section('5) Eurový prodej');
  h = await doklad('p3'); t = text(h);
  check('ukáže eura i korunový přepočet',
    /200 €/.test(t) && /5 ?000/.test(t.replace(/[  ]/g, ' ')), t.slice(0, 400));

  // ══════════════════════════════════════════════════════════════
  section('6) Kdy doklad nejde vystavit');
  const naSklade = await page.evaluate(() => {
    window.__doklad = null;
    let hlaska = '';
    const orig = window.showToast;
    window.showToast = function(m) { hlaska = m; };
    openSaleDocument('s1');
    window.showToast = orig;
    return { doklad: window.__doklad, hlaska: hlaska };
  });
  check('u položky na skladě se doklad nevystaví', !naSklade.doklad, String(naSklade.doklad));
  check('a řekne proč', /až k prodané/.test(naSklade.hlaska), naSklade.hlaska);

  // ══════════════════════════════════════════════════════════════
  section('7) Tlačítko v detailu a v nastavení');
  const tlacitka = await page.evaluate(async () => {
    openDetail('p1');
    await new Promise(r => setTimeout(r, 400));
    const mo = document.getElementById('moDetail');
    const btn = [...mo.querySelectorAll('button')].find(b => b.textContent.trim() === 'Doklad');
    const out = { jeVDetailu: !!btn, volani: btn ? btn.getAttribute('onclick') : null };
    cm('moDetail');
    await new Promise(r => setTimeout(r, 150));
    openDetail('s1');
    await new Promise(r => setTimeout(r, 400));
    const mo2 = document.getElementById('moDetail');
    out.uSkladove = [...mo2.querySelectorAll('button')].some(b => b.textContent.trim() === 'Doklad');
    cm('moDetail');
    return out;
  });
  check('u prodané položky je tlačítko Doklad', tlacitka.jeVDetailu, JSON.stringify(tlacitka));
  check('volá správnou položku', /openSaleDocument\('p1'\)/.test(tlacitka.volani || ''), tlacitka.volani);
  check('u položky na skladě tlačítko není', !tlacitka.uSkladove, String(tlacitka.uSkladove));

  const nastaveni = await page.evaluate(async () => {
    openSellerSettings();
    await new Promise(r => setTimeout(r, 300));
    const ov = document.getElementById('sellerOv');
    const out = { otevreno: !!ov, predvyplneno: ov ? document.getElementById('_selName').value : null };
    if (ov) {
      document.getElementById('_selName').value = 'Nové jméno';
      saveSellerFromForm();
    }
    await new Promise(r => setTimeout(r, 200));
    return Object.assign(out, { ulozeno: getSeller().name, zavreno: !document.getElementById('sellerOv') });
  });
  check('okno s údaji se otevře předvyplněné', nastaveni.otevreno && nastaveni.predvyplneno === 'Michal Novák', JSON.stringify(nastaveni));
  check('uložení funguje a okno se zavře', nastaveni.ulozeno === 'Nové jméno' && nastaveni.zavreno, JSON.stringify(nastaveni));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
