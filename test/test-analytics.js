// Test: panel Výkonnost nákupů respektuje filtr kategorie v analytice skladu
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

// Nákupy v aktuálním měsíci, ať spadnou do posledních 12 měsíců
const d = new Date();
const den = new Date(d.getFullYear(), d.getMonth(), 5).toISOString().slice(0, 10);

const SEED = [
  // sneakers: 2 ks za 10 000 Kč
  { id:'s1', name:'Bota A', category:'sneakers', buyPrice:6000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:den, tags:[] },
  { id:'s2', name:'Bota B', category:'sneakers', buyPrice:4000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now()-1, buyDate:den, tags:[] },
  // pokemon: 1 ks za 2 500 Kč
  { id:'p1', name:'Box A', category:'pokemon', buyPrice:2500, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now()-2, buyDate:den, tags:[] },
  // lego: 1 ks za 1 000 Kč
  { id:'l1', name:'Set A', category:'lego', buyPrice:1000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now()-3, buyDate:den, tags:[] },
  // prodaná položka — do skladové analytiky nepatří vůbec
  { id:'x1', name:'Prodaná', category:'sneakers', buyPrice:9999, buyCurrency:'CZK', sellPrice:20000, saleState:'paid', saleDate:den, payoutDate:den, dateAdded:Date.now()-4, buyDate:den, tags:[] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript((seed) => { localStorage.setItem('sklad_v3', JSON.stringify(seed)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Načti hodnoty grafu Výkonnost nákupů pro daný filtr kategorie
  async function chart(cat) {
    return page.evaluate((c) => {
      window._saFilterCat = c;
      switchTab('stock');
      stockViewMode = 'analytics';
      renderStockAnalytics();
      // Sloupce grafu nesou popisek "Měsíc rok: X Kč · N ks"
      var tips = [...document.querySelectorAll('[data-tip]')]
        .map(e => e.getAttribute('data-tip'))
        .filter(t => /Kč · \d+ ks$/.test(t));
      var total = 0, count = 0;
      tips.forEach(function(t){
        var m = t.match(/:\s*([\d\s  ]+)\s*Kč · (\d+) ks/);
        if (m) { total += parseInt(m[1].replace(/[\s  ]/g, ''), 10); count += parseInt(m[2], 10); }
      });
      var maxEl = [...document.querySelectorAll('div')].map(e => e.textContent).find(t => /^Max: /.test(t.trim()));
      return { total, count, max: maxEl ? maxEl.trim() : null };
    }, cat);
  }

  // ── 1) Bez filtru: všechny skladové nákupy (10 000 + 2 500 + 1 000)
  const all = await chart('');
  check('bez filtru: součet 13 500 Kč', all.total === 13500, JSON.stringify(all));
  check('bez filtru: 4 kusy', all.count === 4, JSON.stringify(all));

  // ── 2) Filtr sneakers → jen boty (jádro hlášené chyby)
  const sneakers = await chart('sneakers');
  check('sneakers: součet 10 000 Kč', sneakers.total === 10000, JSON.stringify(sneakers));
  check('sneakers: 2 kusy', sneakers.count === 2, JSON.stringify(sneakers));

  // ── 3) Filtr pokemon
  const pokemon = await chart('pokemon');
  check('pokemon: součet 2 500 Kč', pokemon.total === 2500, JSON.stringify(pokemon));
  check('pokemon: 1 kus', pokemon.count === 1, JSON.stringify(pokemon));

  // ── 4) Filtr lego
  const lego = await chart('lego');
  check('lego: součet 1 000 Kč', lego.total === 1000, JSON.stringify(lego));

  // ── 5) Popisek Max se mění s filtrem (nedrží hodnotu ze všech kategorií)
  check('Max se mění dle filtru', all.max !== sneakers.max && sneakers.max !== pokemon.max,
    JSON.stringify({ vse: all.max, sneakers: sneakers.max, pokemon: pokemon.max }));

  // ── 6) Prodaná položka se do skladové analytiky nezapočítává
  check('prodaná položka není v součtu', all.total === 13500 && !String(all.max).includes('9 999'), JSON.stringify(all));

  // ── 7) Nabídka kategorií k filtrování zůstává úplná i při zapnutém filtru
  const chips = await page.evaluate(() => {
    window._saFilterCat = 'lego';
    renderStockAnalytics();
    return [...document.querySelectorAll('button[onclick*="_saFilterCat"]')].map(b => b.textContent.trim());
  });
  check('filtr nabízí Vše + všechny 3 kategorie', chips.includes('Vše') && chips.length === 4, JSON.stringify(chips));

  // ── 8) Návrat na Vše dá zpět původní čísla
  const back = await chart('');
  check('návrat na Vše obnoví součet', back.total === 13500 && back.count === 4, JSON.stringify(back));

  // ── 9) Ostatní panely na filtr reagovaly už dřív — kontrola, že to platí dál
  const kpi = await page.evaluate(() => {
    window._saFilterCat = 'sneakers';
    renderStockAnalytics();
    var t = document.getElementById('itemsGrid').textContent.replace(/[  ]/g, ' ');
    return { maPolozek: /Položek na skladě/.test(t), txt: t.slice(0, 200) };
  });
  check('KPI panel se vykresluje i s filtrem', kpi.maPolozek, kpi.txt.slice(0, 80));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
