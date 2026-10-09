// Test: co u položky chybí — oranžový roh, filtr, detail a obarvená pole v úpravě
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
const ODKAZ = 'https://onedrive.live.com/doklad';

/* Místa prodeje s typem dokladu tak, jak je má majitel: Vinted dostává
   prodejní doklad z aplikace, Pikastore fakturu vystavenou jinde a StockX
   nic — doklad si řeší sám. */
const SKUPINY = {
  platforms: ['StockX'], eshopy: ['Pikastore'], local: ['Vinted', 'Bazoš.cz'],
  platCategories: {}, platDoc: { StockX: 'nic', Pikastore: 'faktura', Vinted: 'doklad' },
};

const kus = (o) => Object.assign({ category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK',
  dateAdded: Date.now(), buyDate: datum(20), tags: [] }, o);
const sklad = (o) => kus(Object.assign({ saleState: 'stock', location: 'Doma' }, o));
const prodano = (o) => kus(Object.assign({ saleState: 'paid', sellPrice: 3000, profit: 1000,
  saleDate: datum(5), payoutDate: datum(3), invoiceUrl: ODKAZ }, o));

const SEED = [
  // ── Na skladě
  sklad({ id: 's1', name: 'Bez dokladu i cilovky' }),
  sklad({ id: 's2', name: 'Uplny kus', invoiceUrl: ODKAZ, targetPrice: 5000 }),
  // Majitel výslovně: kupní smlouva bez odkazu na soubor je pořád bez dokladu
  sklad({ id: 's3', name: 'Kupni smlouva jen cislo', dokladTyp: 'ks', dokladCislo: 'KS20260001', targetPrice: 5000 }),
  // Osobní kus doklady nepotřebuje — jen cílovou cenu
  sklad({ id: 's4', name: 'Osobni bez dokladu', personal: true, category: 'lego', targetPrice: 900 }),
  sklad({ id: 's5', name: 'Osobni bez cilovky', personal: true, category: 'lego', invoiceUrl: ODKAZ }),
  // Vrácený kus se prodávat nebude — cílovku nepotřebuje
  sklad({ id: 's6', name: 'Vraceny kus', location: 'Vráceno', invoiceUrl: ODKAZ }),
  // ── Čeká: prodejní doklad se hlídá až po vyplacení
  kus({ id: 'w1', name: 'Ceka Vinted bez dokladu', saleState: 'waiting', waitState: 'sent', sellPrice: 3000,
    saleDate: datum(2), soldWhere: 'Vinted', invoiceUrl: ODKAZ }),
  kus({ id: 'w2', name: 'Ceka bez nakupniho', saleState: 'waiting', waitState: 'sent', sellPrice: 3000,
    saleDate: datum(2), soldWhere: 'Vinted' }),
  // Balík v Čeká, jehož kus nemá nákupní doklad
  { id: 'b1', type: 'bulk', name: 'Balik Ceka', saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted',
    sellPrice: 5000, saleDate: datum(2), dateAdded: Date.now(), tags: [] },
  kus({ id: 'b1a', name: 'Kus v baliku bez dokladu', saleState: 'waiting', bulkId: 'b1' }),
  kus({ id: 'b1b', name: 'Kus v baliku s dokladem', saleState: 'waiting', bulkId: 'b1', invoiceUrl: ODKAZ }),
  // ── Prodáno
  prodano({ id: 'p1', name: 'Vinted bez dokladu', soldWhere: 'Vinted' }),
  prodano({ id: 'p2', name: 'Vinted s dokladem', soldWhere: 'Vinted', saleDocNum: '2026-001' }),
  prodano({ id: 'p3', name: 'Pikastore bez faktury', soldWhere: 'Pikastore' }),
  prodano({ id: 'p4', name: 'Pikastore s fakturou', soldWhere: 'Pikastore', saleInvoiceUrl: 'https://onedrive.live.com/fv' }),
  prodano({ id: 'p5', name: 'StockX nic', soldWhere: 'StockX' }),
  prodano({ id: 'p6', name: 'Osobni prodej Vinted', soldWhere: 'Vinted', personal: true, invoiceUrl: '' }),
  // Prodaný balík: doklad k balíku aplikace vystavit neumí, kusy se prodaly s ním
  { id: 'b2', type: 'bulk', name: 'Balik Prodano', saleState: 'paid', soldWhere: 'Vinted', sellPrice: 6000,
    profit: 2000, saleDate: datum(5), payoutDate: datum(3), dateAdded: Date.now(), tags: [] },
  kus({ id: 'b2a', name: 'Prodany kus z baliku', saleState: 'paid', bulkId: 'b2', invoiceUrl: ODKAZ,
    soldWhere: 'Vinted', saleDate: datum(5), payoutDate: datum(3) }),
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  // Jen při prvním načtení — znovunačtení stránky v sekci 3 má vidět, co se uložilo
  await ctx.addInitScript(([s, g]) => {
    if (sessionStorage.getItem('__nasazeno')) return;
    sessionStorage.setItem('__nasazeno', '1');
    localStorage.setItem('sklad_v3', JSON.stringify(s));
    localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(g));
  }, [SEED, SKUPINY]);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { viewMode = 'table'; activeProfile = 'all'; });

  const chybi = (id) => page.evaluate((id) => coChybi(items.find(i => i.id === id)).map(c => c.id), id);
  const chybiRadek = (id) => page.evaluate((id) => coChybiRadek(items.find(i => i.id === id)).map(c => c.id), id);
  // Které řádky v právě vykresleném seznamu nesou roh
  const rohy = (sekce) => page.evaluate(async (sekce) => {
    switchTab(sekce); renderItems();
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll('#itemsGrid tr')]
      .filter(tr => tr.querySelector('.chybi-roh'))
      .map(tr => tr.dataset.id || (tr.querySelector('.td-name, td:nth-child(2)') || tr).textContent.trim().slice(0, 12));
  }, sekce);
  const radky = (sekce) => page.evaluate(async (sekce) => {
    switchTab(sekce); renderItems();
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll('#itemsGrid tr[data-id]')].map(tr => tr.dataset.id);
  }, sekce);
  const stejne = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // ══════════════════════════════════════════════════════════════
  section('1) Co se rozsvítí');
  check('kus bez odkazu i cílovky: obojí', stejne(await chybi('s1'), ['nakup', 'cilovka']), JSON.stringify(await chybi('s1')));
  check('úplný kus nic', (await chybi('s2')).length === 0, JSON.stringify(await chybi('s2')));
  check('kupní smlouva jen s číslem pořád chybí (vždy odkaz)', stejne(await chybi('s3'), ['nakup']), JSON.stringify(await chybi('s3')));
  check('osobní kus bez cílovky: cílovka', stejne(await chybi('s5'), ['cilovka']), JSON.stringify(await chybi('s5')));
  check('Čeká bez nákupního dokladu: nákup', stejne(await chybi('w2'), ['nakup']), JSON.stringify(await chybi('w2')));
  check('Prodáno přes Vinted bez dokladu: prodejní doklad', stejne(await chybi('p1'), ['prodej']), JSON.stringify(await chybi('p1')));
  check('Prodáno přes Pikastore bez faktury: prodejní doklad', stejne(await chybi('p3'), ['prodej']), JSON.stringify(await chybi('p3')));

  section('2) Co se rozsvítit nesmí');
  check('osobní kus bez odkazu na doklad nesvítí', (await chybi('s4')).length === 0, JSON.stringify(await chybi('s4')));
  check('vrácený kus nechce cílovku', (await chybi('s6')).length === 0, JSON.stringify(await chybi('s6')));
  check('Čeká: prodejní doklad až po vyplacení', (await chybi('w1')).length === 0, JSON.stringify(await chybi('w1')));
  check('vystavený doklad (číslo) stačí', (await chybi('p2')).length === 0, JSON.stringify(await chybi('p2')));
  check('vložená faktura vydaná stačí', (await chybi('p4')).length === 0, JSON.stringify(await chybi('p4')));
  check('StockX (nic) doklad nehlídá', (await chybi('p5')).length === 0, JSON.stringify(await chybi('p5')));
  check('osobní prodej nehlídá ani jeden doklad', (await chybi('p6')).length === 0, JSON.stringify(await chybi('p6')));
  check('balík sám nic nehlídá — doklad k němu nejde vystavit', (await chybi('b2')).length === 0, JSON.stringify(await chybi('b2')));
  check('kus z prodaného balíku nechce vlastní prodejní doklad', (await chybi('b2a')).length === 0, JSON.stringify(await chybi('b2a')));
  check('balík přebírá, co chybí jeho kusům', stejne(await chybiRadek('b1'), ['nakup']), JSON.stringify(await chybiRadek('b1')));

  // ══════════════════════════════════════════════════════════════
  section('3) Roh v seznamech');
  let r = await rohy('stock');
  check('Na skladě: roh přesně u s1, s3, s5', stejne(r, ['s1', 's3', 's5']), JSON.stringify(r));
  const bunka = await page.evaluate(() => {
    const tr = document.querySelector('#itemsGrid tr[data-id="s1"]');
    const roh = tr.querySelector('.chybi-roh');
    const rr = roh.getBoundingClientRect(), tt = tr.getBoundingClientRect();
    return { prvni: roh.closest('td') === tr.querySelector('td'), vlevo: Math.round(rr.left - tt.left),
      nahore: Math.round(rr.top - tt.top), tip: roh.dataset.tip, text: roh.textContent };
  });
  check('roh sedí v levém horním rohu řádku', bunka.prvni && bunka.vlevo <= 1 && bunka.nahore <= 1, JSON.stringify(bunka));
  check('v řádku žádný text, jen bublina', bunka.text === '' && /nákupní doklad/.test(bunka.tip) && /cílová cena/.test(bunka.tip), JSON.stringify(bunka));
  r = await rohy('waiting');
  check('Čeká: roh u w2 a u zavřeného balíku', r.includes('w2') && !r.includes('w1') && r.some(x => /BULK/.test(x)), JSON.stringify(r));
  r = await rohy('sold');
  check('Prodáno: roh přesně u p1 a p3', stejne(r, ['p1', 'p3']), JSON.stringify(r));

  const karty = await page.evaluate(async () => {
    switchTab('stock'); setView('grid'); renderItems();
    await new Promise(r => setTimeout(r, 200));
    const out = [...document.querySelectorAll('.item-card.ma-chybi')].map(c => c.dataset.id);
    setView('table');
    return out;
  });
  check('karty: roh u stejných kusů', stejne(karty, ['s1', 's3', 's5']), JSON.stringify(karty));

  // ══════════════════════════════════════════════════════════════
  section('4) Vypínač a výběr pravidel');
  await page.evaluate(() => { switchTab('stock'); chybiZapni(false); });
  await page.waitForTimeout(200);
  r = await rohy('stock');
  check('vypnuto: žádný roh', r.length === 0, JSON.stringify(r));
  check('vypnuto: detail nic nevypisuje', await page.evaluate(() => { openDetail('s1'); const b = !!document.querySelector('#moDetail .chybi-box'); cm('moDetail'); return !b; }));
  check('tlačítko říká jen „Co chybí"', (await page.evaluate(() => document.getElementById('chybiFilterBtn').textContent.trim())).startsWith('Co chybí'));
  check('vypnutí je uložené', await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_co_chybi_v1')).zapnuto === false));
  check('a jde do cloudu se synchronizovanými nastaveními', await page.evaluate(() =>
    syncSettings().some(s => s.key === 'sklad_co_chybi_v1' && s.field === 'coChybi')));

  // Vydrží obnovení stránky — „stále zapnutá, dokud ji nevypnu"
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { viewMode = 'table'; activeProfile = 'all'; });
  r = await rohy('stock');
  check('po obnovení zůstává vypnuté', r.length === 0, JSON.stringify(r));
  await page.evaluate(() => chybiZapni(true));
  r = await rohy('stock');
  check('zapnuto zpátky', stejne(r, ['s1', 's3', 's5']), JSON.stringify(r));

  await page.evaluate(() => chybiPravidlo('cilovka', false));
  r = await rohy('stock');
  check('bez cílovky: zhasne kus, kterému chybí jen ona', stejne(r, ['s1', 's3']), JSON.stringify(r));
  const pocty = await page.evaluate(() => {
    toggleMultiFilter('chybi');
    return new Promise(res => setTimeout(() => {
      const out = [...document.querySelectorAll('#chybiFilterDrop .chybi-pravidlo')]
        .map(l => l.querySelector('.chybi-text').textContent + ' ' + l.querySelector('.chybi-pocet-r').textContent);
      toggleMultiFilter('chybi');
      res(out);
    }, 50));
  });
  check('nabídka ukazuje počty i u vypnutého pravidla', pocty.some(t => /^Cílová cena 2$/.test(t)) && pocty.some(t => /^Nákupní doklad 2$/.test(t)), JSON.stringify(pocty));
  await page.evaluate(() => chybiPravidlo('cilovka', true));

  // ══════════════════════════════════════════════════════════════
  section('5) Filtr „Jen kusy, kde něco chybí"');
  await page.evaluate(() => chybiJenPrepni(true));
  r = await radky('stock');
  check('Na skladě zůstanou jen kusy s rohem', stejne(r, ['s1', 's3', 's5']), JSON.stringify(r));
  r = await radky('sold');
  check('v Prodáno taky', stejne(r, ['p1', 'p3']), JSON.stringify(r));
  const balikyCeka = await page.evaluate(async () => {
    switchTab('waiting'); renderItems();
    await new Promise(r => setTimeout(r, 200));
    return { radky: [...document.querySelectorAll('#itemsGrid tr[data-id]')].map(tr => tr.dataset.id),
      balik: document.querySelectorAll('#itemsGrid tr.bulk-group-row').length };
  });
  check('v Čeká jen w2 a balík s kusem bez dokladu', stejne(balikyCeka.radky, ['w2']) && balikyCeka.balik === 1, JSON.stringify(balikyCeka));
  check('křížek „smazat filtry" o filtru ví', await page.evaluate(() => document.getElementById('btnClearFilters').style.display !== 'none'));
  await page.evaluate(() => clearAllFilters());
  r = await radky('stock');
  check('smazání filtrů vrátí všechno', r.length === 6, JSON.stringify(r));
  r = await rohy('stock');
  check('a označení zůstane', stejne(r, ['s1', 's3', 's5']), JSON.stringify(r));
  await page.evaluate(() => { chybiJenPrepni(true); chybiZapni(false); });
  check('vypnutí označování shodí i filtr', await page.evaluate(() => chybiJen === false));
  r = await radky('stock');
  check('a seznam je celý', r.length === 6, JSON.stringify(r));
  await page.evaluate(() => chybiZapni(true));

  // ══════════════════════════════════════════════════════════════
  section('6) Detail vypíše, co chybí');
  const detail = (id) => page.evaluate(async (id) => {
    openDetail(id);
    await new Promise(r => setTimeout(r, 150));
    const box = document.querySelector('#moDetail .chybi-box');
    const out = box ? [...box.querySelectorAll('.chybi-radek')].map(d => ({
      text: d.querySelector('span').textContent,
      tlacitko: (d.querySelector('button') || {}).textContent || '',
      pole: (d.querySelector('button') || { dataset: {} }).dataset.pole || '' })) : null;
    cm('moDetail');
    return out;
  }, id);
  let d = await detail('s1');
  check('dva řádky s tlačítkem Doplnit', d && d.length === 2 && d.every(x => x.tlacitko === 'Doplnit'), JSON.stringify(d));
  check('Doplnit míří na odkaz i cílovku', d && stejne(d.map(x => x.pole), ['fInvoiceUrl', 'fTargetPrice']), JSON.stringify(d));
  d = await detail('p1');
  check('prodejní doklad se vystaví tlačítkem, ne v úpravě', d && d.length === 1 && d[0].tlacitko === 'Vystavit', JSON.stringify(d));
  d = await detail('p3');
  check('u faktury vydané Doplnit na odkaz', d && d.length === 1 && d[0].pole === 'fSaleInvoiceUrl', JSON.stringify(d));
  d = await detail('s2');
  check('úplný kus žádný blok nemá', d === null, JSON.stringify(d));

  // ══════════════════════════════════════════════════════════════
  section('7) V úpravě se chybějící pole obarví');
  const formular = () => page.evaluate(() => ({
    pole: [...document.querySelectorAll('#moAdd .fi.chybi-pole')].map(fi => (fi.querySelector('input') || {}).id),
    souhrn: document.getElementById('fChybiSouhrn').style.display !== 'none',
    chipy: [...document.querySelectorAll('#fChybiSouhrn .chybi-chip')].filter(c => c.style.display !== 'none').map(c => c.textContent),
  }));
  await page.evaluate(async () => {
    switchTab('stock'); openDetail('s1');
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('#moDetail [data-action="chybidoplnit"][data-pole="fInvoiceUrl"]').click();
  });
  await page.waitForTimeout(500);
  let f = await formular();
  check('obarvený odkaz na fakturu i cílovka', stejne(f.pole, ['fInvoiceUrl', 'fTargetPrice']), JSON.stringify(f));
  check('nahoře je vyjmenované, co chybí', f.souhrn && f.chipy.length === 2, JSON.stringify(f));
  check('Doplnit skočí rovnou do pole', await page.evaluate(() => document.activeElement && document.activeElement.id === 'fInvoiceUrl'));
  await page.evaluate(() => {
    const el = document.getElementById('fInvoiceUrl');
    el.value = 'https://onedrive.live.com/novy';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  f = await formular();
  check('vyplněné pole zhasne', stejne(f.pole, ['fTargetPrice']) && f.chipy.length === 1, JSON.stringify(f));
  await page.evaluate(() => {
    const el = document.getElementById('fInvoiceUrl');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  f = await formular();
  check('a vymazané se zase rozsvítí', stejne(f.pole, ['fInvoiceUrl', 'fTargetPrice']), JSON.stringify(f));
  await page.evaluate(async () => {
    const el = document.getElementById('fInvoiceUrl');
    el.value = 'https://onedrive.live.com/novy';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await saveItem();
  });
  await page.waitForFunction(() => (items.find(i => i.id === 's1') || {}).invoiceUrl === 'https://onedrive.live.com/novy', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  check('po uložení chybí jen cílovka', stejne(await chybi('s1'), ['cilovka']), JSON.stringify(await chybi('s1')));
  const tip = await page.evaluate(() => { renderItems(); const s = document.querySelector('#itemsGrid tr[data-id="s1"] .chybi-roh'); return s ? s.dataset.tip : ''; });
  check('a roh to ví', tip === 'Chybí: cílová cena', tip);

  await page.evaluate(() => openAddModal());
  await page.waitForTimeout(200);
  f = await formular();
  check('nová položka nic obarveného nemá', f.pole.length === 0 && !f.souhrn, JSON.stringify(f));
  await page.evaluate(() => cm('moAdd'));
  await page.evaluate(() => openEdit('s2'));
  await page.waitForTimeout(200);
  f = await formular();
  check('úplný kus v úpravě taky ne', f.pole.length === 0 && !f.souhrn, JSON.stringify(f));
  await page.evaluate(() => { cm('moAdd'); chybiZapni(false); openEdit('s3'); });
  await page.waitForTimeout(200);
  f = await formular();
  check('vypnuté označování nebarví ani formulář', f.pole.length === 0 && !f.souhrn, JSON.stringify(f));
  await page.evaluate(() => { cm('moAdd'); chybiZapni(true); });

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await ctx.close();

  // ══════════════════════════════════════════════════════════════
  section('8) Mobil');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  const merrs = [];
  m.on('pageerror', e => merrs.push('PAGEERROR: ' + e.message));
  await mctx.addInitScript(([s, g]) => {
    localStorage.setItem('sklad_v3', JSON.stringify(s));
    localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(g));
  }, [SEED, SKUPINY]);
  await m.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(3500);
  await m.evaluate(() => { viewMode = 'table'; activeProfile = 'all'; switchTab('stock'); renderItems(); });
  await m.waitForTimeout(200);
  const nabidka = await m.evaluate(() => new Promise(res => {
    const b = document.getElementById('chybiFilterBtn');
    b.scrollIntoView({ block: 'end' });
    setTimeout(() => {
      toggleMultiFilter('chybi');
      setTimeout(() => {
        const r = document.getElementById('chybiFilterDrop').getBoundingClientRect();
        res({ horni: Math.round(r.top), dolni: Math.round(r.bottom), vyska: innerHeight });
      }, 50);
    }, 100);
  }));
  check('nabídka se vejde na obrazovku', nabidka.horni >= 0 && nabidka.dolni <= nabidka.vyska, JSON.stringify(nabidka));
  const jednoduche = await m.evaluate(async () => {
    document.body.classList.add('mobile-simple');
    renderItems();
    await new Promise(r => setTimeout(r, 100));
    const tr = document.querySelector('#itemsGrid tr[data-id="s1"]');
    const pred = getComputedStyle(tr, '::before');
    const bez = getComputedStyle(document.querySelector('#itemsGrid tr[data-id="s2"]'), '::before');
    return { roh: pred.borderTopWidth, barva: pred.borderTopColor, bez: bez.content };
  });
  check('ve zjednodušeném zobrazení kreslí roh řádek', jednoduche.roh === '11px' && /255, 140, 26/.test(jednoduche.barva) && (jednoduche.bez === 'none' || jednoduche.bez === 'normal'), JSON.stringify(jednoduche));
  check('žádné JS chyby (mobil)', merrs.length === 0, JSON.stringify(merrs.slice(0, 3)));

  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
