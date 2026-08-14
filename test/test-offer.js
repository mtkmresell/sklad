// Test: Offer Builder — filtry, výběr, ceny a výsledný text nabídky
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }
const norm = s => (s || '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');

const POLOZKY = [
  { id: 'o1', name: 'Nike Dunk Low Panda', brand: 'Nike', size: 'EU 42 / US 8.5', category: 'sneakers',
    buyPrice: 2000, buyCurrency: 'CZK', targetPrice: 3500, saleState: 'stock', buyDate: '2026-01-05' },
  { id: 'o2', name: 'Jordan 1 Chicago', brand: 'Jordan', size: 'EU 44 / US 10', category: 'sneakers',
    buyPrice: 5000, buyCurrency: 'CZK', targetPrice: 9000, saleState: 'stock', buyDate: '2026-01-06' },
  { id: 'o3', name: 'Pokémon ETB Obsidian', brand: 'Pokémon', category: 'pokemon',
    buyPrice: 1200, buyCurrency: 'CZK', targetPrice: 1900, saleState: 'stock', buyDate: '2026-02-01' },
  // Bez cílové ceny — musí jít nabídnout taky, ale řadí se dozadu
  { id: 'o4', name: 'LEGO bez ceny', brand: 'LEGO', category: 'jine',
    buyPrice: 800, buyCurrency: 'CZK', saleState: 'stock', buyDate: '2026-02-02' },
  // Nesmí se nabízet: prodané, čekající a položka uvnitř balíku
  { id: 'o5', name: 'Už prodané', brand: 'Nike', category: 'sneakers', buyPrice: 900, buyCurrency: 'CZK',
    targetPrice: 2000, saleState: 'paid', sellPrice: 2000, saleDate: '2026-03-01', soldWhere: 'StockX' },
  { id: 'o6', name: 'Čeká na payout', brand: 'Nike', category: 'sneakers', buyPrice: 900, buyCurrency: 'CZK',
    targetPrice: 2000, saleState: 'waiting', sellPrice: 2000, saleDate: '2026-03-02', soldWhere: 'StockX' },
  { id: 'o7', name: 'Kus v balíku', brand: 'Nike', category: 'sneakers', buyPrice: 500, buyCurrency: 'CZK',
    targetPrice: 1000, saleState: 'stock', bulkId: 'b1', buyDate: '2026-02-03' },
];

const CRM = {
  customers: [
    { id: 'c-anna', name: 'Anna Nováková', status: 'vip', size_shoes_eu: '42',
      tags_likes: ['Nike'], pickup: 'Zásilkovna Praha 7, Dělnická 12', contacts: [] },
    { id: 'c-bez', name: 'Bez výdejního místa', status: 'bezny', contacts: [] },
  ],
  partners: [],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(d => {
    localStorage.setItem('sklad_v3', JSON.stringify(d.items));
    localStorage.setItem('sklad_crm', JSON.stringify(d.crm));
  }, { items: POLOZKY, crm: CRM });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Nabízí se jen to, co je na skladě');
  const otevreno = await page.evaluate(async () => {
    openOfferBuilder();
    await new Promise(r => setTimeout(r, 400));
    const karty = [...document.querySelectorAll('#obResults .ob-card')].map(el => el.id.replace('ob-item-', ''));
    return { karty, otevrene: document.getElementById('moOfferBuilder').classList.contains('open') };
  });
  check('okno se otevře', otevreno.otevrene, String(otevreno.otevrene));
  check('rovnou se vypíše sklad (bez klikání na Filtrovat)', otevreno.karty.length === 4, JSON.stringify(otevreno.karty));
  check('prodané se nenabízí', !otevreno.karty.includes('o5'), JSON.stringify(otevreno.karty));
  check('čekající se nenabízí', !otevreno.karty.includes('o6'), JSON.stringify(otevreno.karty));
  check('kus uvnitř balíku se nenabízí', !otevreno.karty.includes('o7'), JSON.stringify(otevreno.karty));
  check('kus bez cílové ceny se nabízí taky', otevreno.karty.includes('o4'), JSON.stringify(otevreno.karty));
  check('kusy bez ceny jsou až za těmi s cenou',
    otevreno.karty.indexOf('o4') === otevreno.karty.length - 1, JSON.stringify(otevreno.karty));

  // ══════════════════════════════════════════════════════════════
  section('2) Na kartách je cílová cena, ne nákupní');
  const ceny = await page.evaluate(() => {
    const val = id => document.querySelector('#ob-item-' + id + ' .ob-price').value;
    return {
      o1: val('o1'), o2: val('o2'), o4: val('o4'),
      // všechna čísla, která jsou v okně vidět (text karet i hodnoty v polích)
      cisla: [...document.querySelectorAll('#obResults .ob-card')].flatMap(el => [
        ...el.textContent.replace(/[   ]/g, '').match(/\d+/g) || [],
        ...[...el.querySelectorAll('.ob-price')].map(i => i.value).filter(Boolean),
      ]),
    };
  });
  check('u Dunku svítí cílová cena 3500', ceny.o1 === '3500', JSON.stringify(ceny.o1));
  check('u Jordanu 9000', ceny.o2 === '9000', JSON.stringify(ceny.o2));
  check('kus bez ceny má pole prázdné', ceny.o4 === '', JSON.stringify(ceny.o4));
  // Nákupní ceny jsou 2000 / 5000 / 1200 / 800 — v nabídce nesmí být ani jedna
  const nakupni = ['2000', '5000', '1200', '800'].filter(n => ceny.cisla.includes(n));
  check('žádná nákupní cena není v okně vidět', nakupni.length === 0,
    'uniklo: ' + JSON.stringify(nakupni) + ' | vidět: ' + JSON.stringify(ceny.cisla));

  // ══════════════════════════════════════════════════════════════
  section('3) Filtry');
  const filtry = await page.evaluate(async () => {
    const out = {};
    const karty = () => [...document.querySelectorAll('#obResults .ob-card')].map(el => el.id.replace('ob-item-', ''));
    document.getElementById('obFilterSize').value = '42';
    offerBuilderSearch(); out.velikost = karty();
    document.getElementById('obFilterSize').value = '';
    document.getElementById('obFilterBudget').value = '2000';
    offerBuilderSearch(); out.cena = karty();
    document.getElementById('obFilterBudget').value = '';
    document.getElementById('obFilterBrand').value = 'Nike, Jordan';
    offerBuilderSearch(); out.znacka = karty();
    document.getElementById('obFilterBrand').value = '';
    _obFiltrCat = 'pokemon'; offerBuilderSearch(); out.kategorie = karty();
    _obFiltrCat = ''; offerBuilderSearch(); out.zpet = karty();
    return out;
  });
  check('velikost 42 najde jen Dunk', filtry.velikost.length === 1 && filtry.velikost[0] === 'o1', JSON.stringify(filtry.velikost));
  check('cena do 2000 filtruje podle cílové ceny',
    filtry.cena.includes('o3') && !filtry.cena.includes('o1'), JSON.stringify(filtry.cena));
  check('značka bere víc hodnot oddělených čárkou',
    filtry.znacka.length === 2 && filtry.znacka.includes('o1') && filtry.znacka.includes('o2'), JSON.stringify(filtry.znacka));
  check('kategorie filtruje (Pokémon)', filtry.kategorie.length === 1 && filtry.kategorie[0] === 'o3', JSON.stringify(filtry.kategorie));
  check('zrušení filtrů vrátí vše', filtry.zpet.length === 4, JSON.stringify(filtry.zpet));

  const katFiltr = await page.evaluate(() => document.getElementById('obCatFilter').textContent.replace(/\s+/g, ' '));
  check('přepínač kategorií se nabízí i s počty', /Vše 4/.test(norm(katFiltr)) && /Sneakers 2/i.test(norm(katFiltr)), norm(katFiltr));

  // ══════════════════════════════════════════════════════════════
  section('4) Výběr a souhrn');
  const vyber = await page.evaluate(async () => {
    offerBuilderToggle('o1');
    offerBuilderToggle('o3');
    return {
      oznacene: [...document.querySelectorAll('#obResults .ob-card.on')].map(el => el.id.replace('ob-item-', '')),
      souhrn: document.getElementById('obSummary').textContent.replace(/\s+/g, ' '),
      btn: document.getElementById('obCopyBtn').textContent,
      vypnuto: document.getElementById('obCopyBtn').disabled,
    };
  });
  check('vybrané kusy se zvýrazní', vyber.oznacene.length === 2, JSON.stringify(vyber.oznacene));
  check('souhrn sečte kusy i cenu', /2 ks/.test(norm(vyber.souhrn)) && /5 400 Kč/.test(norm(vyber.souhrn)), norm(vyber.souhrn));
  check('tlačítko ukazuje počet', /\(2\)/.test(vyber.btn), vyber.btn);
  check('a je aktivní', !vyber.vypnuto, String(vyber.vypnuto));

  const prazdnyVyber = await page.evaluate(() => {
    offerBuilderToggle('o1'); offerBuilderToggle('o3');
    return { btn: document.getElementById('obCopyBtn').disabled, souhrn: document.getElementById('obSummary').textContent };
  });
  check('bez výběru se kopírovat nedá', prazdnyVyber.btn, String(prazdnyVyber.btn));
  check('a okno napoví, co dělat', /Klikni/.test(prazdnyVyber.souhrn), prazdnyVyber.souhrn);

  const vseNic = await page.evaluate(() => {
    obSelectAll();
    const po = _obSelected.size;
    obSelectAll();
    return { po, poDruhem: _obSelected.size, popis: document.getElementById('obSelectAllBtn').textContent };
  });
  check('„Vybrat vše" označí všechny', vseNic.po === 4, JSON.stringify(vseNic));
  check('druhé kliknutí výběr zruší', vseNic.poDruhem === 0, JSON.stringify(vseNic));

  // ══════════════════════════════════════════════════════════════
  section('5) Přepsání ceny v nabídce');
  const prepis = await page.evaluate(async () => {
    offerBuilderToggle('o1');
    obSetPrice('o1', '3200');
    const souhrn = document.getElementById('obSummary').textContent.replace(/\s+/g, ' ');
    const vPolozce = items.find(x => x.id === 'o1').targetPrice;
    return { souhrn, vPolozce, vNabidce: obCena(items.find(x => x.id === 'o1')) };
  });
  check('přepsaná cena se projeví v souhrnu', /3 200 Kč/.test(norm(prepis.souhrn)), norm(prepis.souhrn));
  check('do položky se ale nezapíše', prepis.vPolozce === 3500, JSON.stringify(prepis));

  // ══════════════════════════════════════════════════════════════
  section('6) Text nabídky');
  const text = await page.evaluate(() => {
    offerBuilderToggle('o3');
    offerBuilderToggle('o4');
    return offerBuilderText();
  });
  check('nabídka má ceny u položek', /Nike Dunk Low Panda .*— 3 200 Kč/.test(norm(text)), norm(text));
  check('u kusu bez ceny je „cena dohodou"', /cena dohodou/.test(text), norm(text));
  check('je tam značka a velikost', /\(Nike, EU 42\)/.test(norm(text)), norm(text));
  check('a součet na konci', /Celkem 3 ks · 5 100 Kč/.test(norm(text)), norm(text));
  check('nákupní ceny v textu nejsou', !/2 000|1 200|800/.test(norm(text)), norm(text));

  // ══════════════════════════════════════════════════════════════
  section('7) Zákazník — předvyplnění a výdejní místo');
  const zakaznik = await page.evaluate(async () => {
    openOfferBuilder('c-anna');
    await new Promise(r => setTimeout(r, 400));
    const stav = {
      jmeno: document.getElementById('obCustomerSearch').value,
      velikost: document.getElementById('obFilterSize').value,
      znacka: document.getElementById('obFilterBrand').value,
      info: document.getElementById('obCustomerInfo').textContent.replace(/\s+/g, ' '),
      pickupVidet: document.getElementById('obPickupWrap').style.display !== 'none',
      pickupPopis: document.getElementById('obPickupLabel').textContent,
      karty: [...document.querySelectorAll('#obResults .ob-card')].map(el => el.id.replace('ob-item-', '')),
    };
    offerBuilderToggle('o1');
    stav.bezPickup = offerBuilderText();
    document.getElementById('obPickup').checked = true;
    stav.sPickup = offerBuilderText();
    return stav;
  });
  check('jméno zákazníka se doplní', zakaznik.jmeno === 'Anna Nováková', zakaznik.jmeno);
  check('velikost se předvyplní z karty', zakaznik.velikost === '42', zakaznik.velikost);
  check('oblíbená značka taky', /Nike/.test(zakaznik.znacka), zakaznik.znacka);
  check('filtry se rovnou použijí', zakaznik.karty.length === 1 && zakaznik.karty[0] === 'o1', JSON.stringify(zakaznik.karty));
  check('v panelu je vidět velikost i co má rád', /Boty EU: 42/.test(zakaznik.info) && /Nike/.test(zakaznik.info), zakaznik.info);
  check('nabídne se přiložit výdejní místo', zakaznik.pickupVidet, String(zakaznik.pickupVidet));
  check('a je vidět které', /Zásilkovna Praha 7/.test(zakaznik.pickupPopis), zakaznik.pickupPopis);
  check('nabídka je adresovaná', /^Nabídka pro Anna Nováková/.test(zakaznik.bezPickup), zakaznik.bezPickup.slice(0, 60));
  check('bez zaškrtnutí výdejní místo v textu není', !/Zásilkovna/.test(zakaznik.bezPickup), zakaznik.bezPickup);
  check('po zaškrtnutí se přidá', /Posílat na Zásilkovna Praha 7/.test(zakaznik.sPickup), zakaznik.sPickup);

  const bezMista = await page.evaluate(async () => {
    openOfferBuilder('c-bez');
    await new Promise(r => setTimeout(r, 350));
    return document.getElementById('obPickupWrap').style.display;
  });
  check('u zákazníka bez výdejního místa se volba neukazuje', bezMista === 'none', bezMista);

  // ══════════════════════════════════════════════════════════════
  section('8) Kopírování do schránky');
  const schranka = await page.evaluate(async () => {
    openOfferBuilder();
    await new Promise(r => setTimeout(r, 350));
    offerBuilderToggle('o2');
    offerBuilderCopy();
    await new Promise(r => setTimeout(r, 250));
    return await navigator.clipboard.readText();
  });
  check('do schránky se dostane text nabídky', /Jordan 1 Chicago/.test(schranka), schranka.slice(0, 120));
  check('i s cenou', /9 000 Kč/.test(norm(schranka)), norm(schranka));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
