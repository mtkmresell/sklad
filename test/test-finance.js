// Test: Finance — daňová evidence (finance.js, v index.html FINANCE — DAŇOVÁ EVIDENCE).
//
// Hlídá hlavně to, co by se rozbilo tiše:
// - import poznává sloupce podle názvu (Air Bank i Revolut), ne podle pořadí,
// - stejný výpis nahraný podruhé nic nezdvojí,
// - transakce leží ve vlastní kolekci finance, sklad zůstane netknutý,
// - odkaz na doklad se uloží a „Bez dokladu" pak transakci nepočítá,
// - párování se skladem do skladu nic nezapíše a nenabídne osobní kus,
// - účetní Finance vidí, ale nic nezmění; zaúčtováno píše do vlastní složky,
// - zkratky skladu ve Financích nic nedělají.

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
  check('sklad zůstal netknutý', skladPred === await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL));

  // ══════════════════════════════════════════════════════════════
  section('5) Světlý vzhled');
  const barvy = await page.evaluate(() => {
    finDetail(Object.keys(finStav.tx)[0]);
    const r = {
      telo: getComputedStyle(document.body).backgroundColor,
      app: getComputedStyle(document.getElementById('financeApp')).getPropertyValue('--accent').trim(),
      hlavicka: getComputedStyle(document.querySelector('header')).backgroundColor,
      okno: getComputedStyle(document.querySelector('#moFinDetail .modal')).backgroundColor,
      nastaveni: getComputedStyle(document.getElementById('moSettings')).getPropertyValue('--surface').trim(),
      tlacitko: getComputedStyle(document.querySelector('#moFinDetail .btn-pri')).color,
    };
    cm('moFinDetail');
    return r;
  });
  check('Finance jsou světlé: pozadí, hlavička i okno', barvy.telo === 'rgb(244, 242, 236)' && barvy.hlavicka === 'rgb(255, 255, 255)' && barvy.okno === 'rgb(255, 255, 255)', JSON.stringify(barvy));
  check('akcent je tmavě zelený a text na něm bílý', barvy.app === '#17603a' && barvy.tlacitko === 'rgb(255, 255, 255)', JSON.stringify(barvy));
  // Majitel (14. 11.): „finance mají divný font čísel" — bez lining-nums kreslí Syne skákavé (staré) číslice
  check('číslice ve Financích jsou rovné jako ve skladu (lining-nums)', await page.evaluate(() =>
    ['.fin-c', '.fin-dl-v'].every(q => /lining-nums/.test(getComputedStyle(document.querySelector('#financeApp ' + q)).fontVariantNumeric))));
  check('okna skladu (Nastavení) zůstávají tmavá', barvy.nastaveni === '#181818', barvy.nastaveni);
  check('prostředí se pamatuje pro obnovení stránky', await page.evaluate(() => localStorage.getItem('sklad_prostredi_v1') === 'finance'));
  check('po obnovení se vrátí do Financí', await page.evaluate(() => { prepniProstredi('sklad', true); const pred = document.body.classList.contains('prostredi-finance'); finSpust(); return !pred && document.body.classList.contains('prostredi-finance'); }));
  await page.waitForTimeout(250);

  // ══════════════════════════════════════════════════════════════
  section('6) Párování se skladem');
  await page.evaluate(() => {
    items = [
      { id: 'n1', name: 'Jordan 1 Low', size: '42', buyPrice: 75, buyCurrency: 'EUR', buyDate: '2026-10-10', buyWhere: 'StockX', orderNum: 'SX-777', invoiceUrl: 'https://onedrive.live.com/stockx-faktura', saleState: 'stock' },
      { id: 'n2', name: 'Jordan 1 Low', size: '43', buyPrice: 75, buyCurrency: 'EUR', buyDate: '2026-10-10', buyWhere: 'StockX', orderNum: 'SX-777', saleState: 'stock' },
      { id: 'p1', name: 'Dunk Low Panda', size: '44', buyPrice: 2000, buyDate: '2026-08-01', saleState: 'paid', sellPrice: 4500, sellCurrency: 'CZK', saleDate: '2026-10-01', payoutDate: '2026-10-03', soldWhere: 'Instagram', saleInvoiceUrl: 'https://onedrive.live.com/faktura-dunk' },
      // Tyhle se nabídnout NESMÍ: osobní kus a prodej vyplacený o dva měsíce dřív
      { id: 'o1', name: 'Osobní hodinky', personal: true, saleState: 'paid', sellPrice: 8000, sellPriceOrig: 320, sellCurrency: 'EUR', payoutDate: '2026-10-12', soldWhere: 'Hypeboost' },
      { id: 'p2', name: 'Yeezy 350', saleState: 'paid', sellPrice: 8000, sellPriceOrig: 320, sellCurrency: 'EUR', payoutDate: '2026-08-01', soldWhere: 'Hypeboost' },
    ];
    finZalozka('vse');
  });
  const itemsPred = await page.evaluate(() => JSON.stringify(items));
  f = await fin();
  const idStockx = Object.keys(f).find(k => f[k].protistrana === 'StockX');
  const idJan = Object.keys(f).find(k => f[k].protistrana === 'Jan Novák');
  const idHype = Object.keys(f).find(k => f[k].protistrana === 'Hypeboost payout');
  check('v tabulce jsou dva návrhy (StockX a Jan Novák)', await page.evaluate(() => document.querySelectorAll('#financeApp .fin-sklad.navrh').length === 2));
  check('nákup dvou kusů jedné objednávky se nabídne celý', await page.evaluate((id) => { const n = _finJistyNavrh(finStav.tx[id]); return n && n.c.ids.join() === 'n1,n2' && n.c.castka === 150; }, idStockx));
  check('osobní kus ani dva měsíce starý payout se nenabídnou', await page.evaluate((id) => _finNavrhy(finStav.tx[id]).length === 0, idHype));
  check('tlačítko Spárovat se skladem · 2', await page.evaluate(() => /· 2$/.test((document.getElementById('finParovat') || {}).textContent || '')));
  await page.click('#finParovat');
  await page.waitForTimeout(150);
  check('okno s návrhy má dva řádky', await page.evaluate(() => document.querySelectorAll('#moFinParovani .fin-par').length === 2));
  await page.click('#finParPotvrdit');
  await page.waitForTimeout(300);
  f = await fin();
  check('transakce si pamatují položky skladu', (f[idStockx].sklad || []).join() === 'n1,n2' && f[idStockx].skladTyp === 'nakup' && (f[idJan].sklad || []).join() === 'p1' && f[idJan].skladTyp === 'prodej', JSON.stringify([f[idStockx].sklad, f[idJan].sklad]));
  check('doklad se převzal z položky (nákup i prodej)', await page.evaluate((d) => {
    const a = document.querySelector('#financeApp tr[data-tx="' + d.s + '"] a.fin-dok.ok.ze-skladu'), b = document.querySelector('#financeApp tr[data-tx="' + d.j + '"] a.fin-dok.ok.ze-skladu');
    return a && /stockx-faktura/.test(a.href) && b && /faktura-dunk/.test(b.href);
  }, { s: idStockx, j: idJan }));
  check('bez dokladu zbyl jen Hypeboost', await page.evaluate(() => document.querySelector('.fin-dl-bez .fin-dl-v').textContent === '1'));
  check('odkaz na doklad je faktura-link (účetní ho otevře)', await page.evaluate((id) => document.querySelector('#financeApp tr[data-tx="' + id + '"] a.fin-dok').classList.contains('faktura-link'), idStockx));
  check('spárovaná položka se nenabídne jinému pohybu', await page.evaluate(() => _finNavrhy({ id: 't_x', castka: -150, mena: 'EUR', datum: '2026-10-11' }).length === 0));
  check('DO SKLADU SE NIC NEZAPSALO (položky i cloud beze změny)', itemsPred === await page.evaluate(() => JSON.stringify(items))
    && skladPred === await page.evaluate((m) => JSON.stringify(window.__store['users/' + m + '/sklad/data']), MAJITEL));
  await page.evaluate((id) => { finDetail(id); finOdparuj(); }, idStockx);
  await page.waitForTimeout(200);
  check('zrušit spárování', ((await fin())[idStockx].sklad || []).length === 0);
  await page.evaluate(() => finSkladHledej('sx-777'));
  check('ruční hledání ve skladu podle čísla objednávky', await page.evaluate(() => document.querySelectorAll('#finSkladVysledky .fin-kand').length >= 1));
  await page.evaluate(() => finSparuj(0, true));
  await page.waitForTimeout(200);
  check('ručně spárováno', ((await fin())[idStockx].sklad || []).length >= 1);
  await page.evaluate(() => finOtevriPolozku('p1'));
  await page.waitForTimeout(250);
  check('Otevřít položku přepne do skladu na její detail', await page.evaluate(() => !document.body.classList.contains('prostredi-finance') && document.getElementById('moDetail').classList.contains('open')));
  await page.evaluate(() => { cm('moDetail'); prepniProstredi('finance'); });

  // ══════════════════════════════════════════════════════════════
  section('7) Kategorie podle protistrany a hromadné úpravy');
  const AIRBANK2 = [
    '"Datum provedení";"Měna účtu";"Částka v měně účtu";"Název protistrany";"Referenční číslo"',
    '"06/11/2026";"CZK";"-999,00";"Nike.com";"AB010"',
    '"07/11/2026";"CZK";"-49,00";"Banka XY";"AB011"',
    '"08/11/2026";"CZK";"-49,00";"Banka XY";"AB012"',
    '"09/11/2026";"CZK";"-300,00";"Benzina";"AB013"',
    '"10/11/2026";"CZK";"-400,00";"Shell";"AB014"',
  ].join('\n');
  await page.evaluate((t) => { finOtevriImport(); finZpracujText(t, 'revolut'); }, AIRBANK2);
  check('banka se pozná z hlavičky, i když je zaškrtnutá jiná', await page.evaluate(() => finStav.importData.every(t => t.banka === 'airbank' && /^t_airbank_/.test(t.id))));
  check('náhled: 1 se samo zařadí podle protistrany', await page.evaluate(() => /1 se samo zařadí/.test(document.getElementById('finNahled').textContent)));
  await page.evaluate(() => finImportuj());
  await page.waitForTimeout(300);
  f = await fin();
  const idNike2 = Object.keys(f).find(k => f[k].protistrana === 'Nike.com' && f[k].castka === -999);
  check('nový pohyb od Nike.com dostal kategorii sám', f[idNike2].kategorie === 'Nákup zboží');
  const banky = Object.keys(f).filter(k => f[k].protistrana === 'Banka XY');
  await page.evaluate((id) => finDetail(id), banky[0]);
  check('detail nabízí zařadit i druhý pohyb téže protistrany', await page.evaluate(() => !!document.getElementById('finKatVsem') && document.getElementById('finKatVsem').checked));
  await page.click('#moFinDetail .fin-kat-volby [data-kat="Poplatky"]');
  await page.evaluate(() => finUloz());
  await page.waitForTimeout(250);
  f = await fin();
  check('kategorie se zapsala oběma pohybům protistrany', f[banky[0]].kategorie === 'Poplatky' && f[banky[1]].kategorie === 'Poplatky');
  check('a nikomu jinému', !f[Object.keys(f).find(k => f[k].protistrana === 'Benzina')].kategorie);
  await page.click('#finVybrat');
  const idBenz = Object.keys(f).find(k => f[k].protistrana === 'Benzina'), idShell = Object.keys(f).find(k => f[k].protistrana === 'Shell');
  await page.click('#financeApp tr[data-tx="' + idBenz + '"]');
  await page.click('#financeApp tr[data-tx="' + idShell + '"]');
  check('v režimu Vybrat klik řádek označí, detail neotevře', await page.evaluate(() => document.querySelectorAll('#financeApp tr.vybrano').length === 2 && !document.getElementById('moFinDetail').classList.contains('open')));
  check('lišta hromadných úprav', await page.evaluate(() => /2 vybrané/.test((document.getElementById('finHrom') || {}).textContent || '')));
  await page.fill('#finHromKat', 'Pohonné hmoty');
  await page.evaluate(() => finHromadne('kategorie'));
  await page.waitForTimeout(250);
  f = await fin();
  check('hromadně nastavená kategorie', f[idBenz].kategorie === 'Pohonné hmoty' && f[idShell].kategorie === 'Pohonné hmoty' && f[idBenz].datum === '2026-11-09');
  check('po úpravě lišta zmizí', await page.evaluate(() => !document.getElementById('finHrom')));
  await page.evaluate((d) => { finVyberRezim(); finRadek(d.a); finRadek(d.b); finHromadne('bez'); }, { a: idBenz, b: idShell });
  await page.waitForTimeout(250);
  f = await fin();
  check('hromadně „Doklad není potřeba"', f[idBenz].bezDokladu === true && f[idShell].bezDokladu === true);
  await page.evaluate((id) => { finVyberRezim(); finRadek(id); }, idShell);
  await page.click('#finHromSmazat');
  check('smazání chce potvrzení', !!(await fin())[idShell] && await page.evaluate(() => /Opravdu smazat 1/.test(document.getElementById('finHromSmazat').textContent)));
  await page.click('#finHromSmazat');
  await page.waitForTimeout(250);
  f = await fin();
  check('po potvrzení je pryč jen vybraný', !f[idShell] && !!f[idBenz]);

  // ══════════════════════════════════════════════════════════════
  section('8) Přehled roku a export');
  await page.evaluate(() => finPohled('prehled'));
  check('přehled má 12 měsíců a říjen s pěti pohyby', await page.evaluate(() => document.querySelectorAll('.fin-rok tbody tr').length === 12
    && document.querySelector('.fin-rok tr[data-mesic="9"] td:nth-child(2)').textContent === '5'));
  check('měsíc bez pohybů se nedá rozkliknout', await page.evaluate(() => document.querySelector('.fin-rok tr[data-mesic="0"]').classList.contains('prazdny')));
  check('kategorie v přehledu (Poplatky 2×)', await page.evaluate(() => { const r = document.querySelector('.fin-kategorie tr[data-kat="Poplatky"]'); return r && r.children[1].textContent === '2'; }));
  await page.click('.fin-rok tr[data-mesic="9"]');
  check('klik na měsíc otevře jeho pohyby', await page.evaluate(() => /Říjen 2026/.test(document.getElementById('finObdobi').textContent) && document.querySelectorAll('#financeApp tr[data-tx]').length === 5));
  const csv = await page.evaluate(() => _finCsv());
  const radkyCsv = csv.replace(/^﻿/, '').trim().split('\r\n');
  check('export: BOM, středníky, 5 pohybů a hlavička', csv.charCodeAt(0) === 0xFEFF && radkyCsv.length === 6 && /^Datum;Banka;Protistrana/.test(radkyCsv[0]), radkyCsv[0]);
  check('export: desetinná čárka a odkaz na doklad', /;-1200,5;CZK;/.test(csv) && /doklad-nike/.test(csv) && /není potřeba/.test(csv));

  // ══════════════════════════════════════════════════════════════
  section('9) Klávesy skladu ve Financích nic nedělají');
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  const tabPred = await page.evaluate(() => tab);
  await page.keyboard.press('n');
  await page.keyboard.press('2');
  await page.waitForTimeout(200);
  check('„n" neotevře Přidat a „2" nepřepne sekci skladu', await page.evaluate((t) => !document.querySelector('.mo.open') && tab === t, tabPred));
  await page.keyboard.press('ArrowRight');
  check('šipka posune měsíc', await page.evaluate(() => /Listopad 2026/.test(document.getElementById('finObdobi').textContent)));
  await page.keyboard.press('ArrowLeft');
  await page.evaluate((id) => finDetail(id), idJan);
  await page.keyboard.press('ArrowRight');
  check('v detailu šipka listuje pohyby', await page.evaluate((id) => document.getElementById('moFinDetail').classList.contains('open') && finStav.otevrena !== id, idJan));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape detail zavře', await page.evaluate(() => !document.getElementById('moFinDetail').classList.contains('open')));
  if (process.env.SNIMEK) {
    await page.waitForTimeout(3500);
    await page.screenshot({ path: process.env.SNIMEK + '/finance.png' });
    await page.evaluate((id) => finDetail(id), idHype); await page.waitForTimeout(250);
    await page.screenshot({ path: process.env.SNIMEK + '/finance-detail.png' });
    await page.evaluate(() => { cm('moFinDetail'); finPohled('prehled'); }); await page.waitForTimeout(250);
    await page.screenshot({ path: process.env.SNIMEK + '/finance-prehled.png' });
    await page.evaluate(() => { finPohled('pohyby'); finOtevriImport(); }); await page.waitForTimeout(250);
    await page.screenshot({ path: process.env.SNIMEK + '/finance-import.png' });
    await page.evaluate(() => cm('moFinImport'));
    await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(250);
    await page.screenshot({ path: process.env.SNIMEK + '/finance-mobil.png' });
    await page.setViewportSize({ width: 1300, height: 900 });
  }

  // ══════════════════════════════════════════════════════════════
  section('10) Zpátky na sklad');
  await page.click('#prostrediSwitch [data-kam="sklad"]');
  await page.waitForTimeout(150);
  check('zpátky na sklad, tmavé pozadí', await page.evaluate(() => !document.body.classList.contains('prostredi-finance') && getComputedStyle(document.querySelector('.main')).display !== 'none'
    && getComputedStyle(document.body).backgroundColor === 'rgb(15, 15, 15)'));
  const finPred = JSON.stringify(await fin());

  // ══════════════════════════════════════════════════════════════
  section('11) Účetní: vidí, ale jen čte');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: null } })));
  await page.waitForTimeout(150);
  check('po odhlášení se transakce z paměti smažou', await page.evaluate(() => Object.keys(finStav.tx).length === 0 && !finStav.unsub));
  await page.evaluate((d) => { localStorage.removeItem('sklad_prostredi_v1'); window.__store['users/' + d.UCETNI + '/sklad/odkaz'] = { uctujePro: d.MAJITEL }; }, { MAJITEL, UCETNI });
  await prihlas(UCETNI);
  await emit(); await emit();
  check('účetní přepínač Finance vidí', await page.evaluate(() => jeUctetni() && getComputedStyle(document.getElementById('prostrediSwitch')).display !== 'none'));
  if (process.env.SNIMEK) await page.screenshot({ path: process.env.SNIMEK + '/ucetni-hlavicka.png', clip: { x: 0, y: 0, width: 1300, height: 140 } });
  await page.click('#prostrediSwitch [data-kam="finance"]');
  await page.evaluate(() => { finStav.rok = 2026; finStav.mesic = 9; finZalozka('vse'); });
  await page.waitForTimeout(300);
  check('účetní vidí pohyby majitele', await page.evaluate(() => document.querySelectorAll('#financeApp tr[data-tx]').length === 5));
  check('nemá Import, Vybrat ani párování', await page.evaluate(() => !document.querySelector('.fin-import-btn') && !document.getElementById('finVybrat') && !document.getElementById('finParovat')));
  check('má sloupec Zaúčtováno a dlaždici Nezaúčtováno 5', await page.evaluate(() => document.querySelectorAll('#financeApp input.fin-zauc').length === 5 && document.querySelector('.fin-dl-zauc .fin-dl-v').textContent === '5'));
  await page.evaluate((id) => finDetail(id), idNike);
  check('detail je jen ke čtení, doklad jde otevřít', await page.evaluate(() => !document.getElementById('finDok') && !document.getElementById('finKat') && !document.querySelector('#moFinDetail .btn-pri')
    && !!document.querySelector('#moFinDetail a.faktura-link[href*="doklad-nike"]')));
  await page.evaluate((id) => {
    try { finUloz(); } catch (e) {} try { finSmaz(document.createElement('button')); finSmaz(document.createElement('button')); } catch (e) {}
    try { finOdparuj(); finSparuj(0); finVyberRezim(); finStav.vyber[id] = 1; finHromadne('bez'); finOtevriImport(); finOtevriParovani(); } catch (e) {}
    cm('moFinDetail');
  }, idNike);
  await page.waitForTimeout(250);
  check('žádná zapisovací funkce účetnímu nic nezmění', finPred === JSON.stringify(await fin()) && await page.evaluate(() => !document.getElementById('moFinImport') || !document.getElementById('moFinImport').classList.contains('open')));
  await page.click('#financeApp tr[data-tx="' + idNike + '"] input.fin-zauc');
  await page.waitForTimeout(250);
  const zauc = await page.evaluate((u) => window.__store['users/' + u + '/sklad/zauctovano'], UCETNI);
  check('zaúčtováno se zapíše do složky ÚČETNÍHO', !!(zauc && zauc.polozky && zauc.polozky['f:' + idNike]), JSON.stringify(zauc));
  check('a data majitele zůstala beze změny', finPred === JSON.stringify(await fin()));
  check('řádek je odškrtnutý a Nezaúčtováno kleslo na 4', await page.evaluate((id) => document.querySelector('#financeApp tr[data-tx="' + id + '"] input.fin-zauc').checked && document.querySelector('.fin-dl-zauc .fin-dl-v').textContent === '4', idNike));
  check('filtr Nezaúčtované ho schová', await page.evaluate((id) => { finFiltr('nezauc'); const r = !document.querySelector('#financeApp tr[data-tx="' + id + '"]'); finFiltr('vse'); return r; }, idNike));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: null } })));
  await page.waitForTimeout(150);
  check('po odhlášení účetního je pryč prostředí i data', await page.evaluate(() => !document.body.classList.contains('prostredi-finance') && Object.keys(finStav.tx).length === 0));

  check('žádné chyby na stránce', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failures ? '\n' + failures + ' FAIL' : '\nOK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
