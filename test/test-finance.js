// Test: Finance — daňová evidence (finance.js, v index.html FINANCE — DAŇOVÁ EVIDENCE).
//
// Hlídá hlavně to, co by se rozbilo tiše:
// - import poznává sloupce podle názvu (Air Bank i Revolut), ne podle pořadí,
// - stejný výpis nahraný podruhé nic nezdvojí,
// - transakce leží ve vlastní kolekci finance, sklad zůstane netknutý,
// - odkaz na doklad se uloží a „Bez dokladu" pak transakci nepočítá,
// - účetní přepínač Finance nevidí (zatím jen majitel).

const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const MAJITEL = 'majitel1';
const UCETNI = 'uctetni1';

// Air Bank: středník, uvozovky, datum DD/MM/RRRR, desetinná čárka, sloupce schválně přeházené
const AIRBANK = [
  '"Směr úhrady";"Datum provedení";"Typ úhrady";"Měna účtu";"Částka v měně účtu";"Název protistrany";"Číslo účtu protistrany";"Variabilní symbol";"Zpráva pro příjemce";"Referenční číslo"',
  '"Příchozí";"03/10/2026";"Příchozí úhrada";"CZK";"4 500,00";"Jan Novák";"123456789/0800";"";"Dunk Low";"AB001"',
  '"Odchozí";"05/10/2026";"Platba kartou";"CZK";"-2 399,00";"Nike.com";"";"";"";"AB002"',
  '"Odchozí";"28/10/2026";"Odchozí úhrada";"CZK";"-1 200,50";"Zásilkovna s.r.o.";"2000123456/2010";"20261028";"Poštovné říjen";"AB003"',
].join('\r\n');
// Revolut Business: čárka, ISO data, State — nedokončené se neberou
const REVOLUT = [
  'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Orig currency,Orig amount,Payment currency,Amount,Total amount,Fee,Balance',
  '2026-10-10,2026-10-11,rv-1,CARD_PAYMENT,COMPLETED,StockX,,,EUR,-150.00,EUR,-150.00,-150.00,0,500',
  '2026-10-12,2026-10-12,rv-2,TRANSFER,COMPLETED,Hypeboost payout,Payout 4411,,EUR,320.00,EUR,320.00,320.00,0,820',
  '2026-10-13,,rv-3,TRANSFER,PENDING,Čeká,,,EUR,10.00,EUR,10.00,10.00,0,830',
].join('\n');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);

  const prihlas = async (uid) => {
    await page.evaluate((u) => {
      window._fbUser = { uid: u, email: u + '@test.cz' };
      document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: { uid: u } } }));
    }, uid);
    await page.waitForTimeout(300);
  };
  const emit = async () => { await page.evaluate(() => window.__emitSnapshot && window.__emitSnapshot()); await page.waitForTimeout(300); };
  const fin = () => page.evaluate((m) => {
    const pre = 'users/' + m + '/finance/', out = {};
    for (const k of Object.keys(window.__store)) if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = window.__store[k];
    return out;
  }, MAJITEL);

  // ══════════════════════════════════════════════════════════════
  section('1) Přepínač prostředí');
  await page.evaluate((d) => {
    localStorage.clear(); items = []; window.__store = {};
    window.__store['users/' + d.MAJITEL + '/sklad/data'] = { items: [], savedAt: '2026-08-02T10:00:00.000Z' };
  }, { MAJITEL });
  await prihlas(MAJITEL);
  await emit();
  const skladPred = await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL);
  check('finance.js se načetl', await page.evaluate(() => typeof prepniProstredi === 'function' && typeof finSpust === 'function'));
  check('majitel vidí přepínač Sklad | Finance', await page.evaluate(() => getComputedStyle(document.getElementById('prostrediSwitch')).display !== 'none'));
  await page.click('#prostrediSwitch [data-kam="finance"]');
  await page.waitForTimeout(200);
  check('po přepnutí je vidět Finance a ne sklad', await page.evaluate(() =>
    document.body.classList.contains('prostredi-finance') && getComputedStyle(document.getElementById('financeApp')).display !== 'none'
    && getComputedStyle(document.querySelector('.main')).display === 'none' && getComputedStyle(document.querySelector('.header-tabs')).display === 'none'));
  check('prázdný stav radí, jak začít', await page.evaluate(() => /Importovat výpis/.test(document.getElementById('financeApp').textContent)));

  // ══════════════════════════════════════════════════════════════
  section('2) Rozpoznání výpisů');
  const ab = await page.evaluate((t) => _finNactiTransakce(t, 'airbank'), AIRBANK);
  check('Air Bank: tři pohyby', ab.tx && ab.tx.length === 3, JSON.stringify(ab).slice(0, 300));
  const t1 = ab.tx && ab.tx[0];
  check('datum DD/MM/RRRR → ISO, částka s mezerou a čárkou', t1 && t1.datum === '2026-10-03' && t1.castka === 4500 && t1.mena === 'CZK', JSON.stringify(t1));
  check('protistrana, účet, zpráva', t1 && t1.protistrana === 'Jan Novák' && t1.ucet === '123456789/0800' && t1.zprava === 'Dunk Low');
  check('výdaj je záporný a VS se drží', ab.tx && ab.tx[2].castka === -1200.5 && ab.tx[2].vs === '20261028');
  const rv = await page.evaluate((t) => _finNactiTransakce(t, 'revolut'), REVOLUT);
  check('Revolut: dva dokončené, čekající vynechán', rv.tx && rv.tx.length === 2 && rv.vynechano === 1, JSON.stringify(rv).slice(0, 300));
  check('Revolut: EUR, protistrana z Description, datum dokončení', rv.tx && rv.tx[0].mena === 'EUR' && rv.tx[0].castka === -150 && rv.tx[0].protistrana === 'StockX' && rv.tx[0].datum === '2026-10-11');
  const spatne = await page.evaluate(() => _finNactiTransakce('Neco;Jineho\n1;2', 'airbank'));
  check('neznámý soubor se odmítne a řekne proč', !!spatne.chyba && /datem|částkou/.test(spatne.chyba));

  // ══════════════════════════════════════════════════════════════
  section('3) Import do cloudu');
  await page.click('.fin-import-btn');
  await page.waitForTimeout(150);
  check('okno importu', await page.evaluate(() => document.getElementById('moFinImport').classList.contains('open')));
  await page.evaluate((t) => finZpracujText(t, 'airbank'), AIRBANK);
  check('náhled ukáže 3 nové', await page.evaluate(() => /3<\/b> nových/.test(document.getElementById('finNahled').innerHTML)));
  await page.click('#finImportuj');
  await page.waitForTimeout(300);
  let f = await fin();
  check('v kolekci finance jsou 3 transakce', Object.keys(f).filter(k => k.startsWith('t_airbank_')).length === 3, Object.keys(f).join(','));
  check('import přeskočil na měsíc výpisu (Říjen 2026)', await page.evaluate(() => /Říjen 2026/.test(document.getElementById('finObdobi').textContent)));
  check('tabulka ukazuje 3 řádky', await page.evaluate(() => document.querySelectorAll('#financeApp tr[data-tx]').length === 3));
  // Podruhé týž výpis
  await page.evaluate(() => finOtevriImport());
  await page.evaluate((t) => finZpracujText(t, 'airbank'), AIRBANK);
  check('podruhé: 0 nových, 3 už tu jsou', await page.evaluate(() => /0<\/b> nových pohybů · 3 už tu je/.test(document.getElementById('finNahled').innerHTML) && document.getElementById('finImportuj').disabled));
  await page.evaluate(() => cm('moFinImport'));
  await page.evaluate((t) => { finOtevriImport(); finZpracujText(t, 'revolut'); finImportuj(); }, REVOLUT);
  await page.waitForTimeout(300);
  f = await fin();
  check('Revolut přibyl zvlášť', Object.keys(f).filter(k => k.startsWith('t_revolut_')).length === 2);
  check('Dohromady ukáže obě banky', await page.evaluate(() => { finZalozka('vse'); return document.querySelectorAll('#financeApp tr[data-tx]').length === 5 && !!document.querySelector('.fin-banka.b-revolut'); }));
  check('záložka Revolut jen jeho', await page.evaluate(() => { finZalozka('revolut'); const n = document.querySelectorAll('#financeApp tr[data-tx]').length; finZalozka('vse'); return n === 2; }));
  check('souhrn po měnách (CZK i EUR)', await page.evaluate(() => /Příjmy CZK/.test(document.getElementById('financeApp').textContent) && /Příjmy EUR/.test(document.getElementById('financeApp').textContent)));
  check('bez dokladu: 5', await page.evaluate(() => document.querySelector('.fin-dl-bez .fin-dl-v').textContent === '5'));

  // ══════════════════════════════════════════════════════════════
  section('4) Doklad k transakci');
  const idNike = Object.keys(f).find(k => f[k].protistrana === 'Nike.com');
  await page.click('#financeApp tr[data-tx="' + idNike + '"]');
  await page.waitForTimeout(150);
  check('detail transakce', await page.evaluate(() => document.getElementById('moFinDetail').classList.contains('open') && /Nike\.com/.test(document.getElementById('moFinDetail').textContent)));
  await page.fill('#finDok', 'nesmysl');
  await page.evaluate(() => finUloz());
  check('neplatný odkaz se neuloží', (await fin())[idNike].dokladUrl === undefined);
  await page.fill('#finDok', 'https://onedrive.live.com/doklad-nike');
  await page.fill('#finKat', 'Nákup zboží');
  await page.evaluate(() => finUloz());
  await page.waitForTimeout(250);
  f = await fin();
  check('odkaz a kategorie uložené', f[idNike].dokladUrl === 'https://onedrive.live.com/doklad-nike' && f[idNike].kategorie === 'Nákup zboží');
  check('import nepřepsal ručně doplněné (pořád jedna transakce)', Object.keys(f).length === 5);
  check('bez dokladu: 4', await page.evaluate(() => document.querySelector('.fin-dl-bez .fin-dl-v').textContent === '4'));
  check('řádek má fajfku dokladu', await page.evaluate((id) => !!document.querySelector('#financeApp tr[data-tx="' + id + '"] .fin-dok.ok'), idNike));
  check('filtr Bez dokladu ji schová', await page.evaluate((id) => { finFiltr('bezdokladu'); const r = !document.querySelector('#financeApp tr[data-tx="' + id + '"]') && document.querySelectorAll('#financeApp tr[data-tx]').length === 4; finFiltr('vse'); return r; }, idNike));
  check('hledání podle protistrany', await page.evaluate(() => { finHledej('zasilkovna'); const n = document.querySelectorAll('#financeApp tr[data-tx]').length; finHledej(''); return n === 1; }));
  await page.evaluate(() => { cm('moFinDetail'); });
  const idPost = Object.keys(f).find(k => f[k].protistrana === 'Zásilkovna s.r.o.');
  await page.evaluate((id) => { finDetail(id); document.getElementById('finBezDok').checked = true; finUloz(); }, idPost);
  await page.waitForTimeout(200);
  check('„Doklad není potřeba" ji vyřadí z chybějících', await page.evaluate(() => document.querySelector('.fin-dl-bez .fin-dl-v').textContent === '3'));
  if (process.env.SNIMEK) { await page.screenshot({ path: process.env.SNIMEK + '/finance.png' }); await page.evaluate((id) => finDetail(id), idNike); await page.waitForTimeout(200); await page.screenshot({ path: process.env.SNIMEK + '/finance-detail.png' }); await page.evaluate(() => cm('moFinDetail')); }
  check('sklad zůstal netknutý', skladPred === await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL));

  // ══════════════════════════════════════════════════════════════
  section('5) Zpátky na sklad a účetní');
  await page.click('#prostrediSwitch [data-kam="sklad"]');
  await page.waitForTimeout(150);
  check('zpátky na sklad', await page.evaluate(() => !document.body.classList.contains('prostredi-finance') && getComputedStyle(document.querySelector('.main')).display !== 'none'));
  await page.evaluate((d) => { window.__store['users/' + d.UCETNI + '/sklad/odkaz'] = { uctujePro: d.MAJITEL }; }, { MAJITEL, UCETNI });
  await prihlas(UCETNI);
  await emit(); await emit();
  check('účetní přepínač Finance nevidí', await page.evaluate(() => jeUctetni() && getComputedStyle(document.getElementById('prostrediSwitch')).display === 'none'));
  check('a Finance ani přímým voláním', await page.evaluate(() => { prepniProstredi('finance'); return !document.body.classList.contains('prostredi-finance'); }));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: null } })));
  await page.waitForTimeout(150);
  check('po odhlášení se transakce z paměti smažou', await page.evaluate(() => Object.keys(finStav.tx).length === 0 && !finStav.unsub));

  check('žádné chyby na stránce', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failures ? '\n' + failures + ' FAIL' : '\nOK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
