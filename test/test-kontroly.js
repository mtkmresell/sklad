// Test: kontroly listingů (KONTROLY LISTINGŮ, konektor sklad_kontrola).
//
// Kontrolu e-shopu dělá Claude podle skillu a výsledek pošle konektoru.
// Konektor kusy dohledá ve skladu (skill zná SKU/název + velikost, ne id)
// a položí lísteček `pozadavek_…`; aplikace ho převezme do nastavení
// `kontroly`, ukáže okno Kontroly listingů a značky u položek.
//
//   1.–5.  konektor — dohledání kusů, co odmítne, kam zapíše
//   6.–14. aplikace — převzetí, co platí, Hotovo/Smazáno, okno, detail, účetní

const { chromium } = require('playwright');
const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : ' | ' + detail)); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

/* ══════════════════════════════════════════════════════════════════════
   Konektor
══════════════════════════════════════════════════════════════════════ */
function zabal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(zabal) } };
  const f = {};
  for (const k of Object.keys(v)) f[k] = zabal(v[k]);
  return { mapValue: { fields: f } };
}
function rozbal(v) {
  if (!v) return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(rozbal);
  if ('mapValue' in v) { const o = {}; for (const k of Object.keys(v.mapValue.fields || {})) o[k] = rozbal(v.mapValue.fields[k]); return o; }
  return v;
}
function dok(jmeno, o) {
  const f = {};
  for (const k of Object.keys(o)) f[k] = zabal(o[k]);
  return { name: jmeno, fields: f };
}

const UID = 'majitel1';
const POLOZKY = [
  { id: 's1', name: 'Nike Mind 001 Slide Solar Red', sku: 'HQ4307-600', size: '46', category: 'sneakers', saleState: 'stock', platforms: [] },
  { id: 's2', name: 'Nike Mind 001 Slide Solar Red', sku: 'HQ4307-600', size: '46', category: 'sneakers', saleState: 'stock', platforms: [] },
  { id: 's3', name: 'Air Jordan 4 Retro Black Cat (2025)', sku: 'FV5029-010', size: '42.5', category: 'sneakers', saleState: 'stock', platforms: ['Hypeboost'] },
  { id: 's4', name: 'Bez SKU Dunk Low Panda', size: '41 1/3', category: 'sneakers', saleState: 'stock', platforms: [] },
  { id: 's5', name: 'Vrácené boty', sku: 'VR-1', size: '43', category: 'sneakers', saleState: 'stock', location: 'Vráceno', platforms: [] },
  { id: 'p1', name: 'Prodané staré', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'paid', saleDate: '2026-08-01' },
  { id: 'p2', name: 'Prodané novější', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'paid', saleDate: '2026-09-01' },
  { id: 'w1', name: 'Čeká na payout', sku: 'DD1391-100', size: '42', category: 'sneakers', saleState: 'waiting', saleDate: '2026-07-01' },
];
const MISTA = { platforms: ['StockX', 'Hypeboost'], eshopy: ['Pikastore', 'Section'], local: ['Bazoš.cz', 'Vinted'] };

let nastaveniMist = MISTA;
let zapsano = [];
function odp(status, telo) {
  return { ok: status >= 200 && status < 300, status, json: async () => telo, text: async () => JSON.stringify(telo) };
}
global.fetch = async function (url, opts = {}) {
  const a = String(url);
  const metoda = (opts.method || 'GET').toUpperCase();
  if (a.includes('signInWithPassword')) return odp(200, { idToken: 'TOKEN', localId: 'ctecka1' });
  if (a.includes(':batchGet')) {
    return odp(200, JSON.parse(opts.body).documents.map(n => {
      const id = n.split('/').pop();
      if (id === 'data') {
        return { found: dok(n, { savedAt: '2026-10-01T09:00:00Z', itemsStock: POLOZKY,
          archiveYears: [], items: [], platGroups: JSON.stringify(nastaveniMist) }) };
      }
      return { missing: n };
    }));
  }
  if (metoda === 'PATCH') { zapsano.push({ url: a, telo: JSON.parse(opts.body || '{}') }); return odp(200, {}); }
  if (a.includes('/sklad')) {
    return odp(200, { documents: [{ name: 'projects/sklad-7eec9/databases/(default)/documents/users/' + UID + '/sklad/data', fields: {} }] });
  }
  return odp(404, {});
};
const ENV = { SKLAD_EMAIL: 'ctecka@sklad.local', SKLAD_HESLO: 'tajne', SKLAD_UID: UID,
  MCP_TOKEN: 'tajnytokentajnytokentajnytoken12' };

(async function () {
  const { default: worker } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));
  const nastroj = async (args) => {
    zapsano = [];
    const r = await worker.fetch(new Request('https://sklad.workers.dev/' + ENV.MCP_TOKEN + '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'sklad_kontrola', arguments: args } }) }), ENV);
    const o = await r.json();
    let data = null;
    try { data = JSON.parse(o.result.content[0].text); } catch (e) {}
    const listek = zapsano[0] ? rozbal({ mapValue: { fields: zapsano[0].telo.fields } }) : null;
    return { data, text: o.result.content[0].text, chyba: !!o.result.isError, listek };
  };

  sekce('1) Kusy se dohledají podle SKU nebo názvu a velikosti');
  let v = await nastroj({ misto: 'Hypeboost', report: 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg',
    datum: '2026-10-27', poznamka: 'Payouty: nejlevnější u 12 z 30.',
    chybi: [
      { sku: 'HQ4307-600', nazev: 'Nike Mind 001 Slide Solar Red', velikost: '46' },
      { sku: 'FV5029-010', velikost: '42,5' },                      // čárka místo tečky
      { nazev: 'Dunk Low Panda Bez SKU', velikost: '41.33' },       // jiné pořadí slov, jiný zápis zlomku
    ],
    smazat: [{ sku: 'DD1391-100', nazev: 'Dunk Low', velikost: 'EU 42' }] });
  ok('výsledek se zadá', v.data && v.data.stav === 'zadano', v.text.slice(0, 300));
  shoda('chybí: jeden kus ze skupiny, čárka i zlomek srovnané', v.listek.kontrola.chybi, ['s1', 's3', 's4']);
  /* Listing se prodal jednou, ale prodaných kusů toho modelu je víc —
     ten, co ještě čeká, je nejpravděpodobnější. */
  shoda('smazat: přednost má kus, který ještě čeká', v.listek.kontrola.smazat, ['w1']);
  shoda('místo, datum, report i poznámka jsou v lístečku',
    [v.listek.kontrola.misto, v.listek.kontrola.datum.slice(0, 10), v.listek.kontrola.report, v.listek.kontrola.poznamka],
    ['Hypeboost', '2026-10-27', 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg', 'Payouty: nejlevnější u 12 z 30.']);
  ok('a lísteček je pod pozadavek_…', /\/sklad\/pozadavek_[A-Za-z0-9_-]+$/.test(zapsano[0].url), zapsano[0].url);
  ok('do lístečku jdou jen id, ne celé záznamy', JSON.stringify(v.listek).indexOf('Solar Red') === -1);
  /* Kus, který má fajfku u místa, kde podle kontroly nevisí — skill ji
     má odškrtnout, ať to ve skladu nelže. Konektor na to upozorní. */
  ok('kus s fajfkou, kde podle kontroly nevisí, se ohlásí',
    (v.data.pozor || []).some(p => p.id === 's3' && /fajfku/.test(p.duvod)), JSON.stringify(v.data.pozor));
  ok('odpověď neslibuje, že je hotovo', /aplikace/.test(v.data.poznamka) && !/hotovo/i.test(v.data.poznamka), v.data.poznamka);

  /* Opravit a Není ve SKLADu (krok 3 lokálních kontrol, 11. 11. 2026):
     inzeráty, ne kusy — jen se očistí, nedohledávají. */
  v = await nastroj({ misto: 'Bazoš.cz', inzeratu: 47, limit: 50,
    opravit: [{ nazev: 'Nike Mind 001', odkaz: 'https://obleceni.bazos.cz/inzerat/1/', inzerat: '45, 46', sklad: '46', ids: ['s1', 'neni'] },
      { nazev: 'Zlý odkaz', odkaz: 'javascript:alert(1)', inzerat: '41', sklad: '42' }],
    neniVeSkladu: [{ nazev: 'Supreme Box Logo', odkaz: 'https://obleceni.bazos.cz/inzerat/2/', velikost: 'L' }, 'nesmysl'] });
  ok('kontrola s inzeráty se zadá', v.data && v.data.stav === 'zadano' && v.data.opravit === 2 && v.data.neni_ve_skladu === 1, v.text.slice(0, 300));
  shoda('opravit: neznámé id a javascript: odkaz pryč',
    v.listek.kontrola.opravit.map(x => [x.odkaz, x.ids.join()]),
    [['https://obleceni.bazos.cz/inzerat/1/', 's1'], ['', '']]);
  shoda('není ve skladu: nesmysl vynechán', v.listek.kontrola.neniVeSkladu.map(x => x.nazev), ['Supreme Box Logo']);
  shoda('počet a limit', [v.listek.kontrola.inzeratu, v.listek.kontrola.limit], [47, 50]);

  v = await nastroj({ misto: 'Hypeboost', smazat: [{ sku: 'DD1391-100', velikost: '42' }, 'p1'], chybi: ['s2'] });
  shoda('id ze skladu jde taky', [v.listek.kontrola.chybi, v.listek.kontrola.smazat], [['s2'], ['w1', 'p1']]);

  sekce('2) Co nedává smysl, se vrátí v nelze');
  v = await nastroj({ misto: 'Hypeboost',
    chybi: [{ sku: 'NEEXISTUJE', velikost: '40' }, 'w1', { sku: 'VR-1', velikost: '43' }, {}],
    smazat: [{ nazev: 'Ověřit — ve skladu nikdy nebylo', velikost: '44' }, 's1'] });
  ok('výsledek se uloží i tak', v.data && v.data.stav === 'zadano', v.text.slice(0, 200));
  shoda('nic z toho do lístečku nejde', [v.listek.kontrola.chybi, v.listek.kontrola.smazat], [[], []]);
  const duvody = (v.data.nelze || []).map(n => n.seznam + ': ' + n.duvod);
  ok('neznámé SKU', duvody.some(d => /chybi: na skladě takový kus/.test(d)), JSON.stringify(duvody));
  ok('kus, co není na skladě, nechybí', duvody.some(d => /chybi: kus není na skladě/.test(d)), JSON.stringify(duvody));
  ok('vrácený kus se nebere jako chybějící', duvody.filter(d => /^chybi/.test(d)).length === 4, JSON.stringify(duvody));
  ok('listing, který ve skladu nikdy nebyl, se nedohledá', duvody.some(d => /smazat: prodaný kus/.test(d)), JSON.stringify(duvody));
  ok('kus na skladě se mazat nemá', duvody.some(d => /smazat: kus není prodaný/.test(d)), JSON.stringify(duvody));

  sekce('3) Čistá kontrola se uloží taky');
  v = await nastroj({ misto: 'Section', datum: '2026-10-28' });
  ok('bez nálezů se zapíše', v.data && v.data.stav === 'zadano' && zapsano.length === 1, v.text.slice(0, 200));
  shoda('s prázdnými seznamy', [v.listek.kontrola.chybi, v.listek.kontrola.smazat], [[], []]);

  sekce('4) Místo prodeje se ověří proti nastavení');
  v = await nastroj({ misto: 'Neexistuje', chybi: ['s1'] });
  ok('neznámé místo neprojde', v.data && v.data.stav === 'nezname_misto', v.text.slice(0, 200));
  ok('a vypíše se, co v nastavení je', (v.data.mista_v_nastaveni || []).includes('Section'));
  ok('a nic se nezapíše', zapsano.length === 0);
  nastaveniMist = {};
  v = await nastroj({ misto: 'Hypeboost' });
  ok('bez nastavení míst se to řekne naplno', v.data && v.data.stav === 'nezname_mista', v.text.slice(0, 200));
  ok('a nic se nezapíše', zapsano.length === 0);
  nastaveniMist = MISTA;
  v = await nastroj({ chybi: ['s1'] });
  ok('bez místa nic', v.data && v.data.stav === 'nic' && zapsano.length === 0, v.text.slice(0, 200));

  sekce('5) Odkaz na report jen https, strop na počet');
  v = await nastroj({ misto: 'Hypeboost', report: 'javascript:alert(1)' });
  shoda('jiný odkaz než https se neuloží', v.listek.kontrola.report, '');
  ok('a řekne se to', (v.data.pozor || []).some(p => /https/.test(p.duvod)), JSON.stringify(v.data.pozor));
  v = await nastroj({ misto: 'Hypeboost', web: 'https://hypeboost.com/cs/my-sales' });
  shoda('odkaz na e-shop se uloží', v.listek.kontrola.web, 'https://hypeboost.com/cs/my-sales');
  v = await nastroj({ misto: 'Hypeboost', web: 'javascript:alert(1)' });
  shoda('a jiný než https ne', v.listek.kontrola.web, '');
  ok('i to se řekne', (v.data.pozor || []).some(p => /e-shop/.test(p.duvod)), JSON.stringify(v.data.pozor));
  v = await nastroj({ misto: 'Hypeboost', nejde: [{ sku: 'HQ4307-600', velikost: '46', duvod: 'Není v jejich katalogu' },
    { sku: 'NEEXISTUJE-1', velikost: '40', duvod: 'x' }] });
  shoda('kus, který nejde nalistovat, se dohledá i s důvodem', v.listek.kontrola.nejde, [{ id: 's1', duvod: 'Není v jejich katalogu' }]);
  ok('a co se nedohledá, je v nelze', (v.data.nelze || []).some(n => n.seznam === 'nejde'), JSON.stringify(v.data.nelze));
  const mnoho = []; for (let i = 0; i < 501; i++) mnoho.push('s1');
  v = await nastroj({ misto: 'Hypeboost', chybi: mnoho });
  ok('hromada naráz se zarazí', v.data && v.data.stav === 'moc_polozek' && zapsano.length === 0, v.text.slice(0, 160));

  /* ══════════════════════════════════════════════════════════════════
     Aplikace
  ══════════════════════════════════════════════════════════════════ */
  const DEN = 86400000;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((m) => localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(m)), MISTA);
  await ctx.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); }, [
    { id: 'a', name: 'Jordan 4 Black Cat', sku: 'FV5029-010', size: '44', category: 'sneakers', condition: 'DS', buyPrice: 5000,
      buyDate: new Date(Date.now() - 20 * DEN).toISOString().slice(0, 10), saleState: 'stock', location: 'Doma', platforms: ['Section'], tags: [] },
    { id: 'b', name: 'Mind 001 <img src=x onerror=window.__xss=1>', sku: 'HQ4307-600', size: '46', category: 'sneakers', condition: 'DS', buyPrice: 2000,
      buyDate: new Date(Date.now() - 20 * DEN).toISOString().slice(0, 10), saleState: 'stock', location: 'Doma', platforms: ['Hypeboost'], tags: [] },
    { id: 'c', name: 'Dunk Low Panda', sku: 'DD1391-100', size: '42', category: 'sneakers', condition: 'DS', buyPrice: 2000,
      buyDate: new Date(Date.now() - 40 * DEN).toISOString().slice(0, 10), saleState: 'waiting', waitState: 'sent', soldWhere: 'Vinted',
      sellPrice: 3000, location: 'Doma', platforms: [], tags: [] },
  ]);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _provedPozadavky === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    viewMode = 'table';
    window.__smazano = [];
    window._fbDb = {};
    window._fbUser = { uid: 'majitel1' };
    window._fbFns = {
      doc: function () { return { cesta: [].slice.call(arguments).join('/') }; },
      deleteDoc: function (ref) { window.__smazano.push(ref.cesta); return Promise.resolve(); },
    };
    window.__snimek = function (dokumenty) {
      return { forEach: function (cb) { dokumenty.forEach(function (d) { cb({ id: d.id, data: function () { return d.data; } }); }); } };
    };
  });
  const proved = (dokumenty) => page.evaluate((d) => { window.__smazano = []; _provedPozadavky(window.__snimek(d)); return window.__smazano.slice(); }, dokumenty);
  const ted = () => new Date().toISOString();
  const kontrola = (k, id) => ({ id: id || 'pozadavek_k' + Math.random().toString(36).slice(2, 7), data: { kdy: ted(), kontrola: k } });
  const znacky = (sekce) => page.evaluate((s) => {
    switchTab(s); renderItems();
    const out = {};
    document.querySelectorAll('#itemsGrid tr[data-id]').forEach(tr => {
      const z = [...tr.querySelectorAll('.kl-znacka')].map(e => e.className.replace('kl-znacka ', '') + ':' + e.textContent.trim());
      if (z.length) out[tr.dataset.id] = z;
    });
    return out;
  }, sekce);

  sekce('6) Lísteček s kontrolou se převezme a uklidí');
  let smaz = await proved([kontrola({ misto: 'Hypeboost', datum: new Date(Date.now() - 3 * DEN).toISOString(),
    report: 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg', chybi: ['a'], smazat: ['c'], poznamka: 'Payouty OK' }, 'pozadavek_k1')]);
  ok('lísteček se smaže', smaz.some(c => /pozadavek_k1/.test(c)), JSON.stringify(smaz));
  let ulozeno = await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_kontroly_v1') || '{}'));
  shoda('uloží se do nastavení', [ulozeno.Hypeboost.chybi, ulozeno.Hypeboost.smazat, ulozeno.Hypeboost.poznamka],
    [['a'], ['c'], 'Payouty OK']);
  ok('a je mezi synchronizovanými nastaveními',
    await page.evaluate(() => syncSettings().some(s => s.key === 'sklad_kontroly_v1' && s.field === 'kontroly' && s.keep)));
  shoda('v Na skladě má kus značku', await znacky('stock'), { a: ['kl-chybi:+ Hypeboost'] });
  shoda('v Čeká má prodaný kus značku smazat', await znacky('waiting'), { c: ['kl-smazat:✕ Hypeboost'] });
  shoda('u tlačítka v hlavičce je počet', await page.evaluate(() => document.getElementById('kontrolyPocet').textContent), '2');

  sekce('7) Fajfka chybějící listing vyřídí');
  await page.evaluate(() => { switchTab('stock'); togglePlatItem('a', 'Hypeboost'); renderItems(); });
  shoda('po zaškrtnutí značka zmizí', await znacky('stock'), {});
  await page.evaluate(() => { togglePlatItem('a', 'Hypeboost'); renderItems(); });
  shoda('po odškrtnutí se vrátí — kontrola pořád platí', await znacky('stock'), { a: ['kl-chybi:+ Hypeboost'] });

  sekce('8) Fajfka, kterou kus měl už při kontrole, nestačí');
  /* `b` má fajfku u Hypeboostu, a přitom tam podle kontroly nevisí.
     Kdyby fajfka nález vyřídila, zmizel by hned po převzetí. */
  await proved([kontrola({ misto: 'Hypeboost', datum: new Date(Date.now() - 2 * DEN).toISOString(), chybi: ['a', 'b'], smazat: ['c'] })]);
  let z = await znacky('stock');
  ok('kus s fajfkou z doby kontroly zůstane označený', !!z.b, JSON.stringify(z));
  /* Skill nejdřív odškrtne fajfku a pak pošle výsledek. Když dorazí
     v jednom snímku, provede se to v tomhle pořadí. */
  await page.evaluate(() => { togglePlatItem('b', 'Hypeboost'); togglePlatItem('b', 'Hypeboost'); });  // fajfka zpátky
  await proved([
    kontrola({ misto: 'Hypeboost', datum: new Date(Date.now() - 1 * DEN).toISOString(), chybi: ['b'] }, 'pozadavek_a_kontrola'),
    { id: 'pozadavek_b_fajfka', data: { kdy: ted(), zmeny: [{ id: 'b', platforma: 'Hypeboost', zaskrtnout: false }] } },
  ]);
  ulozeno = await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_kontroly_v1')));
  shoda('fajfka z téhož snímku se odškrtne dřív, než se kontrola převezme', ulozeno.Hypeboost.sFajfkou, []);
  await page.evaluate(() => { togglePlatItem('b', 'Hypeboost'); });
  shoda('a pak ji vyřídí obyčejné zaškrtnutí', (await znacky('stock')).b, undefined);

  sekce('9) Hotovo a Smazáno');
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), chybi: ['a'], smazat: ['c'] })]);
  await page.evaluate(() => kontrolaOdbav('Hypeboost', 'c'));
  shoda('Smazáno značku vezme', await znacky('waiting'), {});
  await page.evaluate(() => kontrolaOdbav('Hypeboost', 'a'));
  shoda('Hotovo taky', await znacky('stock'), {});
  shoda('počet u tlačítka zmizí', await page.evaluate(() => document.getElementById('kontrolyPocet').style.display), 'none');
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), smazat: ['c'] })]);
  await page.evaluate(() => { const it = items.find(i => i.id === 'c'); it.saleState = 'stock'; });
  shoda('kus vrácený na sklad se mazat nemá', await znacky('stock'), {});
  await page.evaluate(() => { const it = items.find(i => i.id === 'c'); it.saleState = 'waiting'; });

  sekce('10) Starší kontrola novější nepřepíše');
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), chybi: ['a'] })]);
  await proved([kontrola({ misto: 'Hypeboost', datum: new Date(Date.now() - 10 * DEN).toISOString(), chybi: [], smazat: ['c'] })]);
  ulozeno = await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_kontroly_v1')));
  shoda('zůstane ta novější', [ulozeno.Hypeboost.chybi, ulozeno.Hypeboost.smazat], [['a'], []]);
  smaz = await proved([{ id: 'pozadavek_stary', data: { kdy: new Date(Date.now() - 10 * DEN).toISOString(),
    kontrola: { misto: 'Section', datum: ted(), chybi: ['a'] } } }]);
  ulozeno = await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_kontroly_v1')));
  ok('týden starý lísteček se jen smaže', !ulozeno.Section && smaz.some(c => /pozadavek_stary/.test(c)), JSON.stringify(ulozeno.Section));

  sekce('11) Co přijde po síti, se nebere jak leží');
  const filtr = await page.evaluate(() => [
    _kontrolaZListecku({ kontrola: { misto: 'Neexistuje', chybi: ['a'] } }),
    _kontrolaZListecku({ kontrola: { misto: 'Hypeboost', report: 'javascript:alert(1)', chybi: ['a', 7, null, 'a', { id: 'x' }],
      smazat: 'neni pole', poznamka: 'x'.repeat(900), navic: 'zahodí se', datum: 'nesmysl' } }),
    _kontrolaZListecku({}),
  ]);
  shoda('neznámé místo neprojde', filtr[0], null);
  shoda('jen texty, bez duplicit', filtr[1].chybi, ['a']);
  shoda('rozbitý seznam je prázdný', filtr[1].smazat, []);
  shoda('javascript: se do odkazu nedostane', filtr[1].report, '');
  shoda('ani do odkazu na e-shop', await page.evaluate(() => _kontrolaZListecku({ kontrola: { misto: 'Hypeboost', web: 'javascript:alert(1)' } }).web), '');
  ok('poznámka se usekne', filtr[1].poznamka.length === 500);
  ok('nic navíc', !('navic' in filtr[1]));
  ok('nesmyslné datum se nahradí platným', !isNaN(new Date(filtr[1].datum).getTime()));
  shoda('lísteček bez kontroly není kontrola', filtr[2], null);

  sekce('12) Okno Kontroly listingů');
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(),
    report: 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg', chybi: ['a', 'b'], smazat: ['c'], poznamka: 'Payouty OK' })]);
  await proved([kontrola({ misto: 'Section', datum: new Date(Date.now() - 20 * DEN).toISOString() })]);
  await page.evaluate(() => { togglePlatItem('b', 'Hypeboost'); togglePlatItem('b', 'Hypeboost'); });
  let okno = await page.evaluate(() => {
    document.getElementById('btnKontroly').click();
    const ov = document.getElementById('kontrolyOv');
    const mista = [...ov.querySelectorAll('.kl-hlava .kl-jmeno')].map(e => e.textContent);
    const hb = [...ov.querySelectorAll('.kl-misto')].find(m => m.querySelector('.kl-jmeno').textContent === 'Hypeboost');
    const sec = [...ov.querySelectorAll('.kl-misto')].find(m => m.querySelector('.kl-jmeno').textContent === 'Section');
    return { mista, pocty: hb.querySelector('.kl-pocty').textContent, odkaz: hb.querySelector('.kl-odkaz').getAttribute('href'),
      cil: hb.querySelector('.kl-odkaz').getAttribute('target'), sec: sec.querySelector('.kl-pocty').textContent,
      stara: !!sec.querySelector('.kl-stara'), bez: (ov.querySelector('.kl-bez') || {}).textContent || '' };
  });
  shoda('místa od nejnovější kontroly', okno.mista, ['Hypeboost', 'Section']);
  ok('počty u místa', /2 chybí/.test(okno.pocty) && /1 smazat/.test(okno.pocty), okno.pocty);
  ok('odkaz na report v nové záložce', okno.odkaz === 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg' && okno.cil === '_blank', JSON.stringify(okno));
  ok('čistá kontrola je „sedí"', /sedí/.test(okno.sec), okno.sec);
  ok('a stará kontrola je obarvená', okno.stara);
  ok('místa bez kontroly jsou vyjmenovaná', /StockX/.test(okno.bez) && /Pikastore/.test(okno.bez) && !/Hypeboost/.test(okno.bez), okno.bez);
  okno = await page.evaluate(() => {
    const ov = document.getElementById('kontrolyOv');
    const hlava = [...ov.querySelectorAll('.kl-hlava')].find(h => h.textContent.indexOf('Hypeboost') !== -1);
    hlava.click();
    const kusy = [...ov.querySelectorAll('.kl-kus .kl-kus-n')].map(e => e.textContent);
    return { kusy, xss: !!window.__xss, img: !!ov.querySelector('.kl-kus img'), pozn: (ov.querySelector('.kl-poznamka') || {}).textContent };
  });
  shoda('rozkliknuté místo vypíše kusy', okno.kusy, ['Jordan 4 Black Cat', 'Mind 001 <img src=x onerror=window.__xss=1>', 'Dunk Low Panda']);
  /* Majitel 6. 11. 2026: název i SKU se kopírují klikem, jako v reportu,
     a celý seznam jedním tlačítkem. Schránka se v testu nahradí. */
  const kop = await page.evaluate(() => {
    const out = {};
    const puvodni = window.zkopiruj;
    window.zkopiruj = function (t, cb) { out.posledni = t; if (cb) cb(); };
    const ov = document.getElementById('kontrolyOv');
    const radek = [...ov.querySelectorAll('.kl-kus')].find(r => r.textContent.indexOf('Jordan 4 Black Cat') !== -1);
    radek.querySelector('.kl-kus-n').click(); out.nazev = out.posledni;
    const sku = radek.querySelector('.kl-sku'); sku.click(); out.sku = out.posledni; out.blesk = sku.classList.contains('kl-blesk');
    out.rozbaleno = !!document.querySelector('#kontrolyOv .kl-misto.rozbaleno');
    out.hromadne = ov.querySelectorAll('[data-kl="kopirovat-vse"]').length;
    out.sloupce = [...ov.querySelectorAll('.kl-sloupce')][0].textContent;
    window.zkopiruj = puvodni;
    return out;
  });
  shoda('klik na název ho zkopíruje', kop.nazev, 'Jordan 4 Black Cat');
  shoda('klik na SKU taky', kop.sku, 'FV5029-010');
  ok('a zkopírované krátce blikne', kop.blesk);
  ok('kopírování místo nezavře', kop.rozbaleno);
  shoda('u Přidat a Smazat hromadné kopírování není', kop.hromadne, 0);
  ok('sekce má hlavičku sloupců', /SKU/.test(kop.sloupce) && /Název/.test(kop.sloupce), kop.sloupce);
  /* Jen okno — tabulka vkládá název kusu odjakživa bez escapování
     (názvy píše majitel sám), to je mimo tuhle část. */
  ok('název kusu je v okně jen text', !okno.img);
  shoda('a poznámka z kontroly', okno.pozn, 'Payouty OK');
  okno = await page.evaluate(() => {
    const ov = document.getElementById('kontrolyOv');
    ov.querySelector('.kl-hotovo[data-id="c"]').click();
    const ov2 = document.getElementById('kontrolyOv');
    return { kusy: [...ov2.querySelectorAll('.kl-kus .kl-kus-n')].map(e => e.textContent), vyrizeno: (ov2.querySelector('.kl-vyrizeno') || {}).textContent };
  });
  ok('Smazáno v okně kus odebere a okno zůstane otevřené', okno.kusy.length === 2 && !okno.kusy.includes('Dunk Low Panda'), JSON.stringify(okno.kusy));
  ok('a ukáže se, kolik je vyřízeno', /1/.test(okno.vyrizeno || ''), okno.vyrizeno);
  await page.keyboard.press('Escape');
  ok('Escape okno zavře', await page.evaluate(() => !document.getElementById('kontrolyOv')));
  okno = await page.evaluate(() => { switchTab('stock'); renderItems(); document.querySelector('#itemsGrid tr[data-id="a"] .kl-znacka').click();
    const ov = document.getElementById('kontrolyOv'); return { je: !!ov, rozb: ov && (ov.querySelector('.kl-misto.rozbaleno .kl-jmeno') || {}).textContent }; });
  ok('klik na značku otevře okno rovnou u toho místa', okno.je && okno.rozb === 'Hypeboost', JSON.stringify(okno));
  await page.evaluate(() => document.getElementById('kontrolyOv').remove());

  sekce('12a) Kusy, které nalistovat nejde');
  /* Majitel 6. 11. 2026: hromadné kopírování SKU a názvů jen u nich —
     ty, co jdou, se vyřizují po jednom. */
  shoda('z lístečku se bere jen id a důvod', await page.evaluate(() => _kontrolaZListecku({ kontrola: { misto: 'Hypeboost',
    nejde: [{ id: 'a', duvod: 'Není v katalogu', navic: 1 }, { id: 'a', duvod: 'dvakrát' }, 'nesmysl', { id: 5 }] } }).nejde),
    [{ id: 'a', duvod: 'Není v katalogu' }]);
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), chybi: ['b'], nejde: [{ id: 'a', duvod: 'Není v jejich katalogu' }, { id: 'c', duvod: 'prodaný' }] })]);
  const nj = await page.evaluate(() => {
    renderItems();
    const out = { pocet: document.getElementById('kontrolyPocet').textContent };
    switchTab('stock'); renderItems();
    out.znackaA = !!document.querySelector('#itemsGrid tr[data-id="a"] .kl-znacka');
    openKontroly('Hypeboost');
    const ov = document.getElementById('kontrolyOv');
    const sekce = [...ov.querySelectorAll('.kl-sekce-blok')];
    const s = sekce.find(x => /Nejde nalistovat/.test(x.textContent));
    out.je = !!s;
    out.kusy = s ? [...s.querySelectorAll('.kl-kus-n')].map(e => e.textContent) : [];
    out.duvod = s ? (s.querySelector('.kl-duvod-nejde') || {}).textContent : '';
    out.tlacitka = s ? s.querySelectorAll('[data-kl="kopirovat-vse"]').length : 0;
    out.jinde = sekce.filter(x => x !== s).reduce((n, x) => n + x.querySelectorAll('[data-kl="kopirovat-vse"]').length, 0);
    out.cip = (ov.querySelector('.kl-pocet-chip.kl-nejde') || {}).textContent;
    const puvodni = window.zkopiruj;
    window.zkopiruj = function (t, cb) { out.posledni = t; if (cb) cb(); };
    s.querySelector('[data-co="sku"]').click(); out.vseSku = out.posledni;
    s.querySelector('[data-co="nazvy"]').click(); out.vseNazvy = out.posledni;
    window.zkopiruj = puvodni;
    ov.remove();
    return out;
  });
  ok('sekce Nejde nalistovat je vidět', nj.je, JSON.stringify(nj));
  shoda('jen kus skladem — prodaný tam není', nj.kusy, ['Jordan 4 Black Cat']);
  shoda('s důvodem od skillu', nj.duvod, 'Není v jejich katalogu');
  shoda('hromadné kopírování je jen tady', [nj.tlacitka, nj.jinde], [2, 0]);
  shoda('Kopírovat SKU', nj.vseSku, 'FV5029-010');
  ok('Kopírovat názvy dá název, velikost a SKU', /^Jordan 4 Black Cat\t[^\t]*44[^\t]*\tFV5029-010$/.test(nj.vseNazvy || ''), JSON.stringify(nj.vseNazvy));
  ok('v hlavě místa je počet', /1 nejde/.test(nj.cip || ''), nj.cip);
  shoda('do počtu u tlačítka se nepočítá', nj.pocet, '1');
  ok('a značku u kusu nedostane', !nj.znackaA);

  sekce('12b) Odkaz na e-shop, Report bez šipky, stará kontrola');
  /* Majitel 6. 11. 2026: název místa vede na e-shop (odkaz posílá skill),
     u Reportu žádná šipka, na počítači bez křížku a kontrola starší než
     pět dní má být vidět i bez otevírání okna. */
  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), report: 'https://claude.ai/artifact/x',
    web: 'https://hypeboost.com/cs/my-sales', chybi: ['a'] })]);
  await proved([kontrola({ misto: 'Section', datum: new Date(Date.now() - 5 * DEN).toISOString() })]);
  okno = await page.evaluate(() => {
    openKontroly();
    const ov = document.getElementById('kontrolyOv');
    // Odkazy se v testu neotevírají, jen se zjistí, co by udělaly
    ov.addEventListener('click', e => { if (e.target.closest('a')) e.preventDefault(); }, true);
    const misto = n => [...ov.querySelectorAll('.kl-misto')].find(m => m.querySelector('.kl-jmeno').textContent === n);
    const hb = misto('Hypeboost'), sec = misto('Section');
    const jm = hb.querySelector('.kl-jmeno');
    jm.click();
    const out = { tag: jm.tagName, href: jm.getAttribute('href'), cil: jm.getAttribute('target'),
      rozbaleno: !!document.querySelector('#kontrolyOv .kl-misto.rozbaleno'),
      report: hb.querySelector('.kl-odkaz').textContent, secTag: sec.querySelector('.kl-jmeno').tagName,
      secStara: sec.classList.contains('kl-zastarala'), hbStara: hb.classList.contains('kl-zastarala'),
      pozor: document.getElementById('btnKontroly').classList.contains('kl-pozor'),
      krizek: getComputedStyle(ov.querySelector('.kl-modal .xb')).display };
    document.querySelector('#kontrolyOv .kl-odkaz').click();
    out.poReportu = !!document.querySelector('#kontrolyOv .kl-misto.rozbaleno');
    return out;
  });
  ok('název místa je odkaz na e-shop v nové záložce', okno.tag === 'A' && okno.href === 'https://hypeboost.com/cs/my-sales' && okno.cil === '_blank', JSON.stringify(okno));
  ok('klik na název místo nerozbalí', !okno.rozbaleno);
  ok('ani klik na Report', !okno.poReportu);
  shoda('Report je bez šipky', okno.report, 'Report');
  shoda('místo bez odkazu na e-shop je jen text', okno.secTag, 'SPAN');
  ok('přesně pět dní ještě nevadí', !okno.secStara && !okno.pozor, JSON.stringify(okno));
  shoda('na počítači není křížek', okno.krizek, 'none');
  await page.evaluate(() => document.getElementById('kontrolyOv').remove());

  // Starší kontrola novější nepřepíše (sekce 10), takže pětidenní nejdřív pryč
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('sklad_kontroly_v1')); delete v.Section;
    localStorage.setItem('sklad_kontroly_v1', JSON.stringify(v)); });
  await proved([kontrola({ misto: 'Section', datum: new Date(Date.now() - 6 * DEN).toISOString() })]);
  okno = await page.evaluate(() => {
    renderItems(); openKontroly();
    const ov = document.getElementById('kontrolyOv');
    const misto = n => [...ov.querySelectorAll('.kl-misto')].find(m => m.querySelector('.kl-jmeno').textContent === n);
    const btn = document.getElementById('btnKontroly');
    const out = { sec: misto('Section').classList.contains('kl-zastarala'), upominka: !!misto('Section').querySelector('.kl-upominka'),
      hb: misto('Hypeboost').classList.contains('kl-zastarala'), pozor: btn.classList.contains('kl-pozor'), tip: btn.getAttribute('data-tip') };
    ov.remove();
    return out;
  });
  ok('šest dní bez kontroly se zvýrazní', okno.sec && okno.upominka, JSON.stringify(okno));
  ok('čerstvá kontrola ne', !okno.hb);
  ok('a tlačítko v hlavičce upozorní i se jménem místa', okno.pozor && /Section/.test(okno.tip) && !/Hypeboost/.test(okno.tip), okno.tip);
  ok('místo, které se nikdy nekontrolovalo, nevaruje', !/StockX/.test(okno.tip), okno.tip);

  await proved([kontrola({ misto: 'Hypeboost', datum: ted(), report: 'https://claude.ai/artifact/2ntTLB67p7f64Aj13JL5vg', chybi: ['a'] })]);
  shoda('kontrola bez odkazu si ten předchozí nechá',
    await page.evaluate(() => JSON.parse(localStorage.getItem('sklad_kontroly_v1')).Hypeboost.web), 'https://hypeboost.com/cs/my-sales');

  // Na telefonu se okno zavírá křížkem — klávesnici ani myš tam nemá
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  await mpage.route('**/firebasejs/**', route => route.abort());
  await mctx.addInitScript((m) => {
    localStorage.setItem('sklad_plat_groups_v1', JSON.stringify(m));
    localStorage.setItem('sklad_v3', '[]');
    localStorage.setItem('sklad_kontroly_v1', JSON.stringify({ Hypeboost: { misto: 'Hypeboost', datum: new Date().toISOString(), chybi: [], smazat: [], hotovo: [] } }));
  }, MISTA);
  await mpage.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await mpage.waitForFunction(() => typeof openKontroly === 'function', { timeout: 20000 });
  shoda('na mobilu křížek zůstává', await mpage.evaluate(() => { openKontroly();
    return getComputedStyle(document.querySelector('#kontrolyOv .kl-modal .xb')).display; }) !== 'none', true);
  await mctx.close();

  sekce('13) Detail kusu');
  let det = await page.evaluate(() => { openDetail('a'); const b = document.querySelector('#detailContent .kl-box');
    return { je: !!b, text: b && b.textContent, odkaz: b && (b.querySelector('.kl-odkaz') || {}).href }; });
  ok('v detailu je box s nálezem', det.je && /Chybí listing na Hypeboost/.test(det.text), JSON.stringify(det));
  ok('i s odkazem na report', /claude\.ai\/artifact/.test(det.odkaz || ''), det.odkaz);
  det = await page.evaluate(() => { document.querySelector('#detailContent .kl-box .kl-hotovo').click();
    return { box: !!document.querySelector('#detailContent .kl-box'), otevreno: document.getElementById('moDetail').classList.contains('open') }; });
  ok('Hotovo v detailu box odebere a detail zůstane', !det.box && det.otevreno, JSON.stringify(det));
  await page.evaluate(() => cm('moDetail'));

  sekce('14) Účetní kontroly nevidí ani neodklikává');
  const uc = await page.evaluate(() => {
    _uctetniRezim = true;
    switchTab('stock'); renderItems();
    const znacek = document.querySelectorAll('#itemsGrid .kl-znacka').length;
    openKontroly();
    const okno = !!document.getElementById('kontrolyOv');
    const pred = localStorage.getItem('sklad_kontroly_v1');
    kontrolaOdbav('Hypeboost', 'b');
    window.__smazano = [];
    _provedPozadavky(window.__snimek([{ id: 'pozadavek_u', data: { kdy: new Date().toISOString(), kontrola: { misto: 'Section', datum: new Date().toISOString(), chybi: ['a'] } } }]));
    const out = { znacek, okno, stejne: pred === localStorage.getItem('sklad_kontroly_v1'), smazano: window.__smazano.length,
      akce: UCETNI_AKCE.indexOf('kontroly') === -1 && UCETNI_AKCE.indexOf('kontrolaodbav') === -1 };
    _uctetniRezim = false;
    return out;
  });
  ok('žádné značky', uc.znacek === 0, String(uc.znacek));
  ok('okno se neotevře', !uc.okno);
  ok('odkliknout nejde a lísteček se nepřevezme', uc.stejne && uc.smazano === 0, JSON.stringify(uc));
  ok('a v povolených akcích účetního nejsou', uc.akce);

  ok('starý nástroj Chybějící listingy je pryč', await page.evaluate(() => typeof openMissingListings === 'undefined' && !document.getElementById('btnMissingList')));
  ok('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(selhalo ? '\n' + selhalo + ' z ' + (selhalo + proslo) + ' kontrol selhalo' : '\nOK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
