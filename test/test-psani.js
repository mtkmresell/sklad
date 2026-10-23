// Test: psaní v rozbalovací nabídce.
//
// Nabídky jako Kde prodáno nebo Dopravce mají přes dvacet položek. Po otevření
// se dá psát a seznam se zúží.
//
// Testuje se obojí, co v aplikaci existuje: nabídka postavená přes
// initCustomSelect() (Dopravce) i ručně psaná (Kde prodáno). Obě vykreslují
// položky jako .cs-opt uvnitř .cs-drop, proto je obsluha jen jedna — a proto
// musí projít i test na obou.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete' && typeof initCustomSelect === 'function', { timeout: 20000 });
  await page.waitForTimeout(400);

  // Vlastní nabídka na hraní — stejná stavba jako všechny ostatní
  // Nabídka má pole, do kterého se napsané promítá (tlačítko jako od
  // initCustomSelect). bezPole = nabídka, ke které se pole najít nedá.
  const postav = (moznosti, bezPole) => page.evaluate(([m, bezPole]) => {
    document.querySelectorAll('#testDropWrap').forEach(e => e.remove());
    const wrap = document.createElement('div');
    wrap.id = 'testDropWrap';
    wrap.style.cssText = 'position:relative;';
    if (!bezPole) {
      const btn = document.createElement('div');
      btn.className = 'cs-btn';
      btn.innerHTML = '<span class="cs-label">Vybráno</span><span class="cs-arrow">▾</span>';
      wrap.appendChild(btn);
    }
    const drop = document.createElement('div');
    drop.className = 'cs-drop open';
    drop.id = 'testDrop';
    drop.innerHTML = m.map(o => '<div class="cs-opt">' + o + '</div>').join('');
    wrap.appendChild(drop);
    document.body.appendChild(wrap);
    window.__vybrano = null;
    drop.querySelectorAll('.cs-opt').forEach(o => {
      o.addEventListener('click', () => { window.__vybrano = o.textContent; });
    });
  }, [moznosti, !!bezPole]);

  const stav = () => page.evaluate(() => {
    const drop = document.getElementById('testDrop');
    const opts = Array.from(drop.querySelectorAll('.cs-opt'));
    const h = document.querySelector('#testDropWrap > .cs-psani') || drop.querySelector('.cs-hledani');
    return {
      vRadku: !!drop.querySelector('.cs-hledani'),
      poleSkryte: !!document.querySelector('#testDropWrap > .cs-btn.cs-pise'),
      videt: opts.filter(o => !o.classList.contains('cs-skryto')).map(o => o.textContent),
      najeto: (drop.querySelector('.cs-opt.cs-najeto') || {}).textContent || null,
      napsano: h ? (h.querySelector('.cs-psani-text, .cs-hledani-text') || {}).textContent : null,
      pocet: h ? (h.querySelector('.cs-psani-pocet, .cs-hledani-pocet') || {}).textContent : null,
    };
  });

  const MOZNOSTI = ['Pikastore', 'Section', 'StockX', 'Sneakerstore', 'Hypeboost', 'TheBeast', 'Purekickz', 'Zásilkovna'];

  // ══════════════════════════════════════════════════════════════
  section('1) Psaní zúží seznam');
  await postav(MOZNOSTI);
  await page.keyboard.type('sec');
  const sec = await stav();
  check('zbyla jediná možnost', sec.videt.length === 1, JSON.stringify(sec.videt));
  check('a je to Section', sec.videt[0] === 'Section', String(sec.videt[0]));
  check('je rovnou najetá', sec.najeto === 'Section', String(sec.najeto));
  check('napsané je vidět přímo v poli', (sec.napsano || '').indexOf('sec') === 0, String(sec.napsano));
  check('pole pod tím schová, co v něm bylo', sec.poleSkryte === true);
  check('a v nabídce žádný řádek s psaním není', sec.vRadku === false);
  check('počet shod je v poli taky', sec.pocet === '1×', String(sec.pocet));

  section('2) Přednost má začátek slova');
  await postav(MOZNOSTI);
  await page.keyboard.type('s');
  const s = await stav();
  // Pikastore i Sneakerstore obsahují „s", ale začínají na něj jen tři
  check('nabídne jen ty začínající na S', JSON.stringify(s.videt) === JSON.stringify(['Section', 'StockX', 'Sneakerstore']), JSON.stringify(s.videt));
  check('Pikastore mezi nimi není', s.videt.indexOf('Pikastore') === -1);

  section('3) Když nic nezačíná, hledá se uvnitř');
  await postav(MOZNOSTI);
  await page.keyboard.type('store');
  const store = await stav();
  check('najde i uprostřed slova', JSON.stringify(store.videt) === JSON.stringify(['Pikastore', 'Sneakerstore']), JSON.stringify(store.videt));

  section('4) Diakritika a velikost písmen nevadí');
  await postav(MOZNOSTI);
  await page.keyboard.type('zasilkovna');
  const zas = await stav();
  check('„zasilkovna" najde Zásilkovnu', JSON.stringify(zas.videt) === JSON.stringify(['Zásilkovna']), JSON.stringify(zas.videt));

  section('5) Když nic nesedí, seznam zůstane celý');
  await postav(MOZNOSTI);
  await page.keyboard.type('xyz');
  const nic = await stav();
  check('nezůstane prázdné okno', nic.videt.length === MOZNOSTI.length, String(nic.videt.length));
  check('ale řekne, že nic nenašel', /nenalezeno/.test(nic.pocet || ''), String(nic.pocet));

  // ══════════════════════════════════════════════════════════════
  section('6) Mazání a rušení');
  await postav(MOZNOSTI);
  // „sn" sedí jen na Sneakerstore; po smazání „n" zůstane „s" a shody jsou tři
  await page.keyboard.type('sn');
  await page.keyboard.press('Backspace');
  const zpet = await stav();
  check('Backspace rozšíří výběr zpět', zpet.videt.length > 1, JSON.stringify(zpet.videt));
  await page.keyboard.press('Escape');
  const poEsc = await stav();
  check('Escape zruší psaní', poEsc.napsano === null, String(poEsc.napsano));
  check('a pole ukáže zas svou hodnotu', poEsc.poleSkryte === false);
  check('a vrátí celý seznam', poEsc.videt.length === MOZNOSTI.length, String(poEsc.videt.length));

  section('7) Šipky a Enter');
  await postav(MOZNOSTI);
  await page.keyboard.type('s');
  await page.keyboard.press('ArrowDown');
  const poSipce = await stav();
  check('šipka posune na další shodu', poSipce.najeto === 'StockX', String(poSipce.najeto));
  await page.keyboard.press('Enter');
  const vybrano = await page.evaluate(() => window.__vybrano);
  check('Enter vybere najetou možnost', vybrano === 'StockX', String(vybrano));

  section('8) Šipky se točí dokola');
  await postav(MOZNOSTI);
  await page.keyboard.type('s');
  await page.keyboard.press('ArrowUp');
  const nahoru = await stav();
  check('nahoru z první skočí na poslední', nahoru.najeto === 'Sneakerstore', String(nahoru.najeto));

  // ══════════════════════════════════════════════════════════════
  section('9) Do psaní v poli se to neplete');
  await postav(MOZNOSTI);
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'testInput'; i.type = 'text';
    document.body.appendChild(i);
    i.focus();
  });
  await page.keyboard.type('abc');
  const doPole = await page.evaluate(() => ({
    hodnota: document.getElementById('testInput').value,
    napsano: !!document.querySelector('#testDrop .cs-hledani, #testDropWrap > .cs-psani'),
  }));
  check('text jde do pole', doPole.hodnota === 'abc', doPole.hodnota);
  check('a nabídka ho nepřebrala', doPole.napsano === false);

  section('9b) Nabídka bez pole má napsané aspoň v řádku');
  await page.evaluate(() => document.querySelectorAll('#testInput').forEach(e => e.remove()));
  await postav(MOZNOSTI, true);
  await page.keyboard.type('sec');
  const bezPole = await stav();
  check('napsané je v řádku nabídky', bezPole.vRadku === true && (bezPole.napsano || '').indexOf('sec') === 0, JSON.stringify(bezPole));
  check('a filtruje se stejně', JSON.stringify(bezPole.videt) === JSON.stringify(['Section']), JSON.stringify(bezPole.videt));
  await page.keyboard.press('Escape');

  // ══════════════════════════════════════════════════════════════
  section('10) Funguje i v opravdové nabídce aplikace');
  await page.evaluate(() => {
    document.querySelectorAll('#testDropWrap, #testInput').forEach(e => e.remove());
    document.querySelectorAll('.cs-drop.open').forEach(d => d.classList.remove('open'));
  });
  const dopravce = await page.evaluate(() => {
    const sel = document.getElementById('fTrackCarrier');
    if (!sel) return { chybi: true };
    // Dopravce bydlí v okně položky a v jeho skryté části pro sledování zásilky.
    // Obsluha psaní schválně přeskakuje nabídky, které nejsou vidět, takže
    // se okno musí opravdu otevřít — jinak by test měřil nesmysl.
    document.getElementById('moAdd').classList.add('open');
    document.getElementById('fTrackingWrap').style.display = '';
    const wrap = sel.closest('.cs-wrap');
    const btn = wrap.querySelector('.cs-btn');
    btn.click();
    return { chybi: false, otevreno: !!wrap.querySelector('.cs-drop.open'),
             pocet: wrap.querySelectorAll('.cs-opt').length };
  });
  check('dopravce je nabídka od initCustomSelect', dopravce.chybi === false, JSON.stringify(dopravce));
  check('a otevřela se', dopravce.otevreno === true, JSON.stringify(dopravce));

  if (!dopravce.chybi && dopravce.otevreno) {
    await page.keyboard.type('zas');
    const d = await page.evaluate(() => {
      const wrap = document.getElementById('fTrackCarrier').closest('.cs-wrap');
      const opts = Array.from(wrap.querySelectorAll('.cs-opt'));
      return {
        videt: opts.filter(o => !o.classList.contains('cs-skryto')).map(o => o.textContent),
        najeto: (wrap.querySelector('.cs-opt.cs-najeto') || {}).textContent || null,
      };
    });
    check('psaní zabralo i tam', d.videt.length < dopravce.pocet, JSON.stringify(d.videt));
    check('a najelo na Zásilkovnu', /Zásilkovna/i.test(d.najeto || ''), String(d.najeto));
    const vTlacitku = await page.evaluate(() => {
      const wrap = document.getElementById('fTrackCarrier').closest('.cs-wrap');
      const p = wrap.querySelector(':scope > .cs-psani');
      return { text: p ? p.querySelector('.cs-psani-text').textContent : null,
               radek: !!wrap.querySelector('.cs-hledani') };
    });
    check('napsané je v tlačítku nabídky', vTlacitku.text === 'zas' && !vTlacitku.radek, JSON.stringify(vTlacitku));
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    document.querySelectorAll('.cs-drop.open').forEach(d => d.classList.remove('open'));
    document.getElementById('moAdd').classList.remove('open');
  });

  // ══════════════════════════════════════════════════════════════
  section('11) Kde prodáno: píše se do pole, Enter vybere');
  // Majitelova výtka (23. 10. 2026): napsané se objevovalo v novém řádku
  // pod polem, ne v poli. A Enter tu nevybral nic — Kde prodáno vybírá
  // stiskem myši, ne kliknutím.
  const kde = await page.evaluate(() => {
    items.push({ id: 'kp1', name: 'Nike Mind 001', size: '46', buyPrice: 2192, buyDate: '2026-10-01', saleState: 'stock', category: 'sneakers' });
    openSellModal('kp1');
    const inp = document.getElementById('sSoldWhere');
    inp.value = '';
    inp.click();
    const drop = document.getElementById('soldWhereDrop');
    const opts = Array.from(drop.querySelectorAll('.cs-opt')).map(o => o.textContent);
    return { otevreno: drop.offsetParent !== null, opts };
  });
  check('nabídka Kde prodáno se otevřela', kde.otevreno, JSON.stringify(kde));
  const cil = kde.opts.find(o => o !== 'Vlastní…' && o.length >= 4);
  check('je v ní z čeho vybírat', !!cil, JSON.stringify(kde.opts));
  if (cil) {
    const zacatek = cil.slice(0, 3).toLowerCase();
    await page.keyboard.type(zacatek);
    const pise = await page.evaluate(() => {
      const inp = document.getElementById('sSoldWhere');
      const p = inp.parentNode.querySelector(':scope > .cs-psani');
      const r = p && p.getBoundingClientRect(), ri = inp.getBoundingClientRect();
      return {
        text: p ? p.querySelector('.cs-psani-text').textContent : null,
        hodnota: inp.value,
        skryte: inp.classList.contains('cs-pise'),
        radek: !!document.querySelector('#soldWhereDrop .cs-hledani'),
        kryje: !!r && Math.abs(r.top - ri.top) < 1 && Math.abs(r.left - ri.left) < 1 && Math.abs(r.width - ri.width) < 1,
      };
    });
    check('napsané je v poli Kde prodáno', pise.text === zacatek, JSON.stringify(pise));
    check('leží přesně přes pole', pise.kryje, JSON.stringify(pise));
    check('pod nabídkou žádný řádek navíc', pise.radek === false);
    check('hodnota pole se psaním nemění', pise.hodnota === '', JSON.stringify(pise.hodnota));
    await page.keyboard.press('Escape');
    const poEsc = await page.evaluate(() => ({
      psani: !!document.querySelector('.cs-psani'), skryte: document.getElementById('sSoldWhere').classList.contains('cs-pise'),
      hodnota: document.getElementById('sSoldWhere').value,
      nabidka: document.getElementById('soldWhereDrop').offsetParent !== null,
      okno: !!document.querySelector('.mo.open') }));
    check('Escape psaní z pole uklidí', !poEsc.psani && !poEsc.skryte && poEsc.hodnota === '', JSON.stringify(poEsc));
    // Globální Escape zavírá všechna okna; první Escape při psaní mu nesmí
    // propadnout, jinak zmizí celé okno Přesunout i s vyplněnou cenou
    check('první Escape nechá nabídku i okno otevřené', poEsc.nabidka && poEsc.okno, JSON.stringify(poEsc));

    await page.keyboard.type(zacatek);
    const ocekavam = await page.evaluate(() => (document.querySelector('#soldWhereDrop .cs-opt.cs-najeto') || {}).textContent);
    await page.keyboard.press('Enter');
    const poEnter = await page.evaluate(() => ({
      hodnota: document.getElementById('sSoldWhere').value,
      otevreno: document.getElementById('soldWhereDrop').offsetParent !== null,
      psani: !!document.querySelector('.cs-psani') }));
    check('Enter vybere najeté místo prodeje', !!ocekavam && poEnter.hodnota === ocekavam, JSON.stringify({ ocekavam, poEnter }));
    check('nabídka se zavře a psaní zmizí', !poEnter.otevreno && !poEnter.psani, JSON.stringify(poEnter));

    // Výběr myší po psaní: stisk vybere, úklid po kliknutí to nesmí vrátit
    await page.evaluate(() => { document.getElementById('sSoldWhere').value = ''; document.getElementById('sSoldWhere').click(); });
    await page.keyboard.type(zacatek);
    const prvni = await page.evaluate(() => (document.querySelector('#soldWhereDrop .cs-opt:not(.cs-skryto)') || {}).textContent);
    await page.click('#soldWhereDrop .cs-opt:not(.cs-skryto)');
    const poMysi = await page.evaluate(() => ({ hodnota: document.getElementById('sSoldWhere').value, psani: !!document.querySelector('.cs-psani') }));
    check('výběr myší po psaní platí', poMysi.hodnota === prvni && !poMysi.psani, JSON.stringify({ prvni, poMysi }));
  }

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
