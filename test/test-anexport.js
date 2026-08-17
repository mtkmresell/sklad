// Test: export dat pro analýzu — co v něm je, co v něm být nesmí
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const FOTKA = 'data:image/jpeg;base64,' + 'A'.repeat(4000);

const POLOZKY = [
  { id: 'e1', name: 'Nike Dunk', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
    targetPrice: 3500, saleState: 'stock', buyDate: '2026-01-05', buyWhere: 'Nike', imgUrl: FOTKA },
  { id: 'e2', name: 'Jordan 1', category: 'sneakers', buyPrice: 3000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 7000, profit: 3500, saleDate: '2026-03-01', payoutDate: '2026-03-08',
    soldWhere: 'StockX', buyWhere: 'Footshop', linkedCustomerId: 'c1', demandSource: 'instagram' },
  { id: 'e3', name: 'Yeezy', category: 'sneakers', buyPrice: 4000, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 9000, profit: 4200, saleDate: '2026-04-01', payoutDate: '2026-04-08',
    soldWhere: 'StockX', buyWhere: 'Footshop' },
  { id: 'e4', name: 'Čeká na payout', category: 'pokemon', buyPrice: 1000, buyCurrency: 'CZK',
    saleState: 'waiting', sellPrice: 1800, profit: 700, saleDate: '2026-08-01', soldWhere: 'StockX' },
  // Odkazovaný obrázek (StockX) je jen adresa — ten se vyhazovat nemá
  { id: 'e5', name: 'S odkazem', category: 'sneakers', buyPrice: 900, buyCurrency: 'CZK',
    saleState: 'stock', buyDate: '2026-05-01', imgUrl: 'https://images.stockx.com/foo.jpg' },
];

const CRM = {
  customers: [{ id: 'c1', name: 'Anna Nováková', status: 'vip', size_shoes_eu: '42',
    pickup: 'Zásilkovna Praha 7', contacts: [] }],
  partners: [{ id: 'p1', name: 'Dan Resell', status: 'aktivni', contacts: [] }],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(d => {
    localStorage.setItem('sklad_v3', JSON.stringify(d.items));
    localStorage.setItem('sklad_crm', JSON.stringify(d.crm));
  }, { items: POLOZKY, crm: CRM });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const d = await page.evaluate(() => analyticsExportData());

  // ══════════════════════════════════════════════════════════════
  section('1) Obsah exportu');
  check('má verzi a datum', d.verze === 1 && /^\d{4}-\d{2}-\d{2}T/.test(d.vytvoreno), JSON.stringify({ v: d.verze, t: d.vytvoreno }));
  check('všechny položky jsou uvnitř', d.polozky.length === 5, String(d.polozky.length));
  check('zákazníci jsou uvnitř (záloha je nemá)', d.zakaznici.length === 1 && d.zakaznici[0].name === 'Anna Nováková', JSON.stringify(d.zakaznici));
  check('partneři taky', d.partneri.length === 1 && d.partneri[0].name === 'Dan Resell', JSON.stringify(d.partneri));
  check('je uložený kurz', typeof d.kurzEur === 'number' && d.kurzEur > 0, String(d.kurzEur));
  check('je uložený profil', typeof d.profil === 'string', String(d.profil));

  // ══════════════════════════════════════════════════════════════
  section('2) Fotky se nevyvážejí');
  const cely = JSON.stringify(d);
  const sFotkou = d.polozky.find(p => p.id === 'e1');
  const sOdkazem = d.polozky.find(p => p.id === 'e5');
  check('base64 fotka v exportu není', !/data:image/.test(cely), cely.slice(0, 120));
  check('ale je poznat, že položka fotku má', sFotkou.maFotku === 1, JSON.stringify(sFotkou.maFotku));
  check('odkazovaný obrázek zůstává', sOdkazem.imgUrl === 'https://images.stockx.com/foo.jpg', String(sOdkazem.imgUrl));
  check('export je díky tomu malý', cely.length < 12000, cely.length + ' znaků');

  // ══════════════════════════════════════════════════════════════
  section('3) Souhrn sedí s daty');
  check('na skladě 2', d.souhrn.naSklade === 2, JSON.stringify(d.souhrn));
  check('čeká na payout 1', d.souhrn.cekaNaPayout === 1, JSON.stringify(d.souhrn));
  check('prodáno 2', d.souhrn.prodano === 2, JSON.stringify(d.souhrn));
  check('zákazníků 1, partnerů 1',
    d.souhrn.zakazniku === 1 && d.souhrn.partneru === 1, JSON.stringify(d.souhrn));

  // ══════════════════════════════════════════════════════════════
  section('4) Číselníky pro pochopení dat');
  check('zdroje poptávky jsou vysvětlené',
    d.ciselniky.zdrojePoptavky.some(z => z.id === 'instagram'), JSON.stringify(d.ciselniky.zdrojePoptavky));
  check('cenová pásma taky', d.ciselniky.cenovaPasma.length === 5, JSON.stringify(d.ciselniky.cenovaPasma));
  check('poslední pásmo je otevřené (null místo Infinity)',
    d.ciselniky.cenovaPasma[4].do === null, JSON.stringify(d.ciselniky.cenovaPasma[4]));
  check('je tam limit identifikované osoby', typeof d.ciselniky.limitIdentifikovaneOsoby === 'number',
    JSON.stringify(d.ciselniky.limitIdentifikovaneOsoby));

  // ══════════════════════════════════════════════════════════════
  section('5) Metriky se počítají, ne opisují');
  // StockX: 7 a 7 dní → medián 7
  check('rychlost payoutu je spočítaná z historie',
    d.metriky.rychlostPayoutu.StockX && d.metriky.rychlostPayoutu.StockX.median === 7,
    JSON.stringify(d.metriky.rychlostPayoutu));
  check('cashflow eviduje čekající kus',
    d.metriky.cashflow && d.metriky.cashflow.pocet === 1, JSON.stringify(d.metriky.cashflow));
  check('cashflow nenese kopie položek',
    !JSON.stringify(d.metriky.cashflow).includes('"name"'), JSON.stringify(d.metriky.cashflow).slice(0, 200));
  check('limit má tvar předpovědi',
    d.metriky.limitIdentifikovaneOsoby && 'net' in d.metriky.limitIdentifikovaneOsoby,
    JSON.stringify(d.metriky.limitIdentifikovaneOsoby));

  // ══════════════════════════════════════════════════════════════
  section('6) Je to platný JSON a jde stáhnout');
  const kolo = await page.evaluate(() => {
    const t = JSON.stringify(analyticsExportData(), null, 2);
    try { JSON.parse(t); return { ok: true, delka: t.length }; }
    catch (e) { return { ok: false, chyba: e.message }; }
  });
  check('serializace projde tam i zpět', kolo.ok, JSON.stringify(kolo));

  const stazeni = await page.evaluate(async () => {
    let jmeno = null;
    const p = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { jmeno = this.download; };
    try { doAnalyticsExport(); } finally { HTMLAnchorElement.prototype.click = p; }
    return jmeno;
  });
  check('soubor má datum v názvu', /^sklad_analytika_\d{4}-\d{2}-\d{2}\.json$/.test(stazeni || ''), String(stazeni));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
