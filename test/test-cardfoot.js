// Test: v kartě zákazníka je poznámka nad souhrnem a souhrn je zarovnaný u dna
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => { localStorage.setItem('sklad_v3', JSON.stringify([])); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    var mk = function(name, opts){
      var id = _crmCreateMinimal(name, 'b2c');
      Object.assign(customers.find(function(x){return x.id===id;}), opts);
    };
    mk('Alex Biolek', { status:'blacklist', rating:1, size_shoes_eu:'43', stats_orders_count:0, stats_total_spent:0,
      contacts:[{type:'facebook', value:'Alex Biolek', primary:true}], note_quick:'Flake a je to kokot' });
    mk('Bez poznámky', { status:'bezny', rating:3, size_shoes_eu:'42', stats_orders_count:2, stats_total_spent:8400,
      contacts:[{type:'instagram', value:'bezpozn', primary:true}] });
    mk('Dlouhá poznámka', { status:'vip', rating:5, size_shoes_eu:'44', stats_orders_count:9, stats_total_spent:120000,
      contacts:[{type:'email', value:'dlouha@example.com', primary:true}],
      note_quick:'Velmi dlouhá poznámka, která se přes celou kartu zalomí na několik řádků a posune obsah.' });
    switchTab('customers');
    renderCustomers();
  });
  await page.waitForTimeout(700);

  const layout = await page.evaluate(() => {
    var cards = [...document.querySelectorAll('.customer-card')];
    var r = el => el.getBoundingClientRect();
    return cards.map(function(card){
      var note = card.querySelector('.cc-note');
      var stats = card.querySelector('.cc-stats');
      return {
        name: card.querySelector('.cc-name').textContent,
        maNote: !!note,
        // poznámka musí být nad souhrnem
        poradiOk: !note || r(note).bottom <= r(stats).top + 1,
        // vzdálenost souhrnu ode dna karty
        odDna: Math.round(r(card).bottom - r(stats).bottom),
        top: Math.round(r(card).top),
        vyska: Math.round(r(card).height),
      };
    });
  });

  check('poznámka je vždy nad souhrnem', layout.every(c => c.poradiOk), JSON.stringify(layout));
  const sameRow = layout.filter(c => c.top === layout[0].top);
  check('karty testu jsou v jedné řadě', sameRow.length === 3, JSON.stringify(layout.map(c => c.top)));
  check('souhrn je u všech stejně vysoko ode dna',
    new Set(sameRow.map(c => c.odDna)).size === 1, JSON.stringify(sameRow.map(c => ({ n: c.name, odDna: c.odDna }))));
  check('karta bez poznámky má souhrn stejně jako ostatní',
    sameRow.find(c => !c.maNote).odDna === sameRow.find(c => c.maNote).odDna,
    JSON.stringify(sameRow.map(c => ({ n: c.name, note: c.maNote, odDna: c.odDna }))));
  check('poznámky se pořád zobrazují', layout.filter(c => c.maNote).length === 2, JSON.stringify(layout.map(c => c.maNote)));

  // Klik na kartu pořád otevře detail
  await page.evaluate(() => document.querySelector('.customer-card').click());
  await page.waitForTimeout(400);
  check('klik na kartu otevře detail', await page.evaluate(() => document.getElementById('customerDetailModal').classList.contains('open')));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
