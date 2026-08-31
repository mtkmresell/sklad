// Test: stav Reklamace u čekajících prodejů.
//
// Když se balík po cestě ztratí, prodej pořád běží — peníze jednou
// dorazí, jen od dopravce místo od kupujícího. Reklamace je proto
// obyčejné „čeká na payout", jen jinak označené: dá se vyplatit
// i vrátit na sklad úplně stejně.
//
// Hlídá se hlavně to, že se do toho stavu nedá dostat omylem. Běžné
// přepínání jede sending → sent → payout → vyplaceno; reklamace je
// výjimka, ne krok v řadě, a nastavuje se jen ručně v úpravě položky.

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
  await page.route('**/firebasejs/**', route => route.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.readyState === 'complete' && typeof waitStateBtn === 'function'
      && typeof changeWaitState === 'function' && !!document.getElementById('itemsGrid'),
    { timeout: 20000 });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════
  section('1) Kde se dá reklamace zvolit');
  const volby = await page.evaluate(() => {
    const dej = (id) => {
      const s = document.getElementById(id);
      return s ? [...s.options].map(o => o.value) : null;
    };
    return { uprava: dej('fWaitState'), prodej: dej('sWaitState'), hromadny: dej('bsWaitState'),
             filtr: dej('filterWaitState') };
  });
  check('v úpravě položky ano', (volby.uprava || []).includes('reklamace'), JSON.stringify(volby.uprava));
  // Při zadávání prodeje se balík ještě neztratil — tam ta volba nedává smysl
  check('při zadávání prodeje ne', !(volby.prodej || []).includes('reklamace'), JSON.stringify(volby.prodej));
  check('ani u hromadného prodeje', !(volby.hromadny || []).includes('reklamace'), JSON.stringify(volby.hromadny));
  check('ve filtru ano, ať se dají najít', (volby.filtr || []).includes('reklamace'), JSON.stringify(volby.filtr));

  // ══════════════════════════════════════════════════════════════
  section('2) Běžné přepínání do reklamace nespadne');
  const cyklus = await page.evaluate(() => {
    const tlacitka = (ws) => waitStateBtn({ id: 'x', waitState: ws });
    return {
      sending: tlacitka('sending'),
      sent: tlacitka('sent'),
      payout: tlacitka('payout'),
      reklamace: tlacitka('reklamace'),
    };
  });
  check('z „odesílám" se jde na odesláno', /data-state="sent"/.test(cyklus.sending));
  check('z „odesláno" na payout', /data-state="payout"/.test(cyklus.sent));
  check('nikde se nenabízí přepnutí do reklamace',
    !/data-state="reklamace"/.test(Object.values(cyklus).join(' ')),
    'do reklamace se smí jen ručně přes úpravu položky');

  section('3) V reklamaci jde vyplatit i vrátit na sklad');
  check('má tlačítko vyplaceno', /data-action="markpaid"/.test(cyklus.reklamace), cyklus.reklamace);
  check('i vrácení na sklad', /data-action="returnstock-wait"/.test(cyklus.reklamace), cyklus.reklamace);
  check('vypadá stejně jako payout',
    cyklus.reklamace === cyklus.payout, 'je to payout, jen jinak označený');

  // ══════════════════════════════════════════════════════════════
  section('4) Vyplacení funguje stejně jako u payoutu');
  const vyplaceni = await page.evaluate(() => {
    localStorage.clear();
    items = [{ id: 'r1', name: 'Ztracena bota', saleState: 'waiting', waitState: 'reklamace',
      sellPrice: 3000, saleDate: '2026-08-01', soldWhere: 'Zásilkovna', tags: [] }];
    changeWaitState('r1', 'completed');
    const it = items[0];
    return { stav: it.saleState, ws: it.waitState, maPayoutDate: !!it.payoutDate };
  });
  check('položka se překlopí na prodáno', vyplaceni.stav === 'paid', vyplaceni.stav);
  check('a doplní se datum vyplacení', vyplaceni.maPayoutDate === true);

  section('5) Vrácení na sklad funguje taky');
  const vraceni = await page.evaluate(() => {
    items = [{ id: 'r2', name: 'Nalezena bota', saleState: 'waiting', waitState: 'reklamace',
      sellPrice: 3000, saleDate: '2026-08-01', tags: [] }];
    const it = items[0];
    it.saleState = 'stock'; it.waitState = null; it.sellPrice = null;
    onReturnToStock(it);
    return { stav: it.saleState, ws: it.waitState };
  });
  check('vrátí se na sklad', vraceni.stav === 'stock', vraceni.stav);
  check('a stav reklamace zmizí', !vraceni.ws, String(vraceni.ws));

  /* ══════════════════════════════════════════════════════════════
     Ztracený balík se řeší týdny. Kdyby se ta doba počítala do toho,
     jak rychle daná platforma platí, vypadalo by to, že platí mizerně —
     a přitom za zdržení nemůže ona, ale dopravce. */
  section('5b) Vyplacená reklamace nekazí statistiku platformy');
  const rychlost = await page.evaluate(() => {
    localStorage.clear();
    const den = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    items = [
      // tři poctivé payouty po sedmi dnech
      { id: 'p1', saleState: 'paid', soldWhere: 'StockX', saleDate: den(40), payoutDate: den(33), tags: [] },
      { id: 'p2', saleState: 'paid', soldWhere: 'StockX', saleDate: den(30), payoutDate: den(23), tags: [] },
      { id: 'p3', saleState: 'paid', soldWhere: 'StockX', saleDate: den(20), payoutDate: den(13), tags: [] },
      // reklamace vyplacená po sto dnech — nesmí se do mediánu započítat
      { id: 'r1', saleState: 'paid', soldWhere: 'StockX', saleDate: den(120), payoutDate: den(20),
        zReklamace: 1, tags: [] },
    ];
    const s = payoutSpeedStats()['StockX'];
    return { median: s && s.median, n: s && s.n, max: s && s.max };
  });
  check('reklamace se nezapočítá', rychlost.n === 3, 'vzorků: ' + rychlost.n);
  check('medián zůstává sedm dní', rychlost.median === 7, String(rychlost.median));
  check('a nejdelší payout není ta reklamace', rychlost.max === 7, String(rychlost.max));

  /* Značka se musí nasadit v okamžiku vyplacení — potom už to nejde
     poznat, protože waitState přejde na 'completed'. Cest k vyplacení
     je několik a stačí zapomenout na jednu. */
  section('5c) Značka se nasadí ve všech cestách vyplacení');
  const znacky = await page.evaluate(() => {
    localStorage.clear();
    const out = {};

    // a) tlačítko ✓ Vyplaceno u čekajícího prodeje
    items = [{ id: 'a', saleState: 'waiting', waitState: 'reklamace', saleDate: '2026-08-01', tags: [] }];
    changeWaitState('a', 'completed');
    out.tlacitko = !!items[0].zReklamace;

    // b) běžný payout se značkou zůstat nesmí
    items = [{ id: 'b', saleState: 'waiting', waitState: 'payout', saleDate: '2026-08-01', tags: [] }];
    changeWaitState('b', 'completed');
    out.bezneNeznaci = !items[0].zReklamace;

    // c) přímé nastavení pomocníkem
    var kus = { waitState: 'reklamace' };
    markReklamacePayout(kus);
    out.pomocnik = !!kus.zReklamace;
    return out;
  });
  check('tlačítko vyplaceno značku nasadí', znacky.tlacitko === true);
  check('běžný payout ji nenasadí', znacky.bezneNeznaci === true, 'jinak by se vyřadily i poctivé prodeje');
  check('pomocník funguje samostatně', znacky.pomocnik === true);

  /* Cest k vyplacení je několik — tlačítko u čekajícího, potvrzovací
     okno s datem, a u balíku zvlášť hlavička a zvlášť kusy. Stačí
     zapomenout na jednu a reklamace se v ní ztratí bez povšimnutí,
     protože se to pozná až za měsíce na pokřiveném mediánu.

     Kontroluje se proto blízkost: před každým nastavením 'completed'
     musí značkovač být, ne jen někde v souboru. */
  const pokryti = require('fs').readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const mista = [];
  const re = /waitState\s*=\s*'completed'/g;
  let m;
  while ((m = re.exec(pokryti)) !== null) {
    const pred = pokryti.slice(Math.max(0, m.index - 250), m.index);
    mista.push({ pozice: m.index, maZnacku: /markReklamacePayout\(/.test(pred) });
  }
  check('cest k vyplacení je víc než jedna', mista.length >= 4, 'nalezeno: ' + mista.length);
  check('před každou je značkovač',
    mista.every(x => x.maZnacku),
    'bez značky: ' + mista.filter(x => !x.maZnacku).map(x => x.pozice).join(', '));

  // ══════════════════════════════════════════════════════════════
  section('6) Jak je reklamace vidět');
  const odznak = await page.evaluate(() => waitStateBadge({ id: 'x', waitState: 'reklamace' }));
  check('má vlastní odznak', /Reklamace/.test(odznak), odznak);
  check('a vlastní barvu', /wsb-reklamace/.test(odznak), odznak);

  /* Sledovací číslo je to hlavní, co se u reklamace dopravci předkládá —
     schovat ho zrovna v tomhle stavu by bylo proti smyslu. */
  section('7) Sledování zásilky u reklamace nezmizí');
  const tracking = await page.evaluate(() => {
    const modal = document.querySelector('#moAdd .modal');
    modal.classList.remove('modal-stock', 'modal-paid');
    modal.classList.add('modal-waiting');
    const fws = document.getElementById('fWaitState');
    const tw = document.getElementById('fTrackingWrap');
    const vidno = () => tw.style.display !== 'none';
    fws.value = 'sent';       updateWaitStateVisibility(); const uOdeslano = vidno();
    fws.value = 'reklamace';  updateWaitStateVisibility(); const uReklamace = vidno();
    fws.value = 'payout';     updateWaitStateVisibility(); const uPayoutu = vidno();
    return { uOdeslano, uReklamace, uPayoutu };
  });
  check('u odesláno je vidět', tracking.uOdeslano === true);
  check('u reklamace taky', tracking.uReklamace === true, 'číslo se dopravci předkládá');
  check('u payoutu ne, tam už dojelo', tracking.uPayoutu === false);

  // ══════════════════════════════════════════════════════════════
  section('8) Filtr reklamaci najde');
  const filtr = await page.evaluate(() => {
    localStorage.clear();
    items = [
      { id: 'f1', name: 'V reklamaci', saleState: 'waiting', waitState: 'reklamace', sellPrice: 1000, saleDate: '2026-08-01', tags: [] },
      { id: 'f2', name: 'Normalni', saleState: 'waiting', waitState: 'payout', sellPrice: 1000, saleDate: '2026-08-01', tags: [] },
    ];
    const sel = document.getElementById('filterWaitState');
    sel.value = 'reklamace';
    switchTab('waiting');
    renderItems();
    const html = document.getElementById('itemsGrid').innerHTML;
    sel.value = '';
    return { maReklamaci: /V reklamaci/.test(html), maNormalni: /Normalni/.test(html) };
  });
  check('filtr ukáže jen reklamace', filtr.maReklamaci === true && filtr.maNormalni === false,
    JSON.stringify(filtr));

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
