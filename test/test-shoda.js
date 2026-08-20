// Shoda čtečky a konektoru.
//
// nastroje/sklad.js a konektor/worker.js čtou stejná data dvakrát. Je to
// schválně — konektor se vkládá do prohlížeče jako jeden soubor bez knihoven,
// takže nemůže nic importovat. Cena za to je, že se ty dvě kopie můžou
// rozejít, a to by se poznalo až tím, že by AI odpovídala jinak podle toho,
// odkud se ptá.
//
// Tenhle test je proti tomu pojistka: obě cesty dostanou tatáž data a jejich
// výstupy se porovnají. Nekontroluje se kód, ale co z něj vypadne.

const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail ? '\n  ' + detail : '')); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  ok(popis, sa === sb, sa === sb ? '' : 'čtečka:  ' + sa + '\n  konektor: ' + sb);
}

/* ── Data, která dostanou obě strany ────────────────────────────────── */
const UID = 'majitel1';
const KOL = 'projects/sklad-7eec9/databases/(default)/documents/users/' + UID + '/sklad';

const NA_SKLADE = [
  { id: 's1', name: 'Dunk Low Panda', sku: 'DD1391', category: 'sneakers', buyPrice: 2400, saleState: 'stock', platforms: ['Bazoš.cz'], imgUrl: 'data:image/jpeg;base64,AAAA' },
  { id: 's2', name: 'Pikachu VMAX', category: 'pokemon', buyPrice: 850, saleState: 'stock', personal: true, tags: ['karty'] },
  { id: 's3', name: 'LEGO Titanic', category: 'lego', buyPrice: 3200, saleState: 'stock', hasPhoto: 1 },
  { id: 's4', name: 'Jordan 4 Bred', category: 'sneakers', buyPrice: 5000, saleState: 'stock', imgUrl: 'https://images.stockx.com/j4.jpg' },
];
const CEKA = [{ id: 'w1', name: 'Yeezy Slide', category: 'sneakers', buyPrice: 1800, saleState: 'waiting' }];
const PRODANO_2025 = [{ id: 'p1', name: 'Jordan 1 Chicago', category: 'sneakers', buyPrice: 5200, sellPrice: 8900, saleState: 'paid', payoutDate: '2025-06-01' }];
const PRODANO_2026 = [{ id: 'p2', name: 'Dunk High Panda', category: 'sneakers', buyPrice: 2600, sellPrice: 4100, saleState: 'paid', payoutDate: '2026-02-11', personal: true }];

const DOKUMENTY = {
  data: {
    savedAt: '2026-08-01T09:30:00Z',
    itemsStock: NA_SKLADE.concat(CEKA),
    archiveYears: ['2025', '2026'],
    items: [],
    retailers: ['Nike', 'Adidas'],
  },
  sold_2025: { items: PRODANO_2025 },
  sold_2026: { items: PRODANO_2026 },
  cache: { 'name:dunk low panda': { sku: 'DD1391' } },
  photo_s1: { data: 'data:image/jpeg;base64,' + 'A'.repeat(4000) },
  photo_s3: { data: 'data:image/jpeg;base64,' + 'B'.repeat(4000) },
};
const CRM = {
  customers: [{ id: 'c1', name: 'Petr Novák', phone: '777123456' }, { id: 'c2', name: 'Jana Malá' }],
  partners: [{ id: 'pa1', name: 'Bazar Brno' }],
};

/* ── Falešný Firestore pro obě strany ───────────────────────────────── */
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
function dok(jmeno, o) {
  const f = {};
  for (const k of Object.keys(o)) f[k] = zabal(o[k]);
  return { name: jmeno, fields: f };
}
function odp(status, telo) {
  return { ok: status >= 200 && status < 300, status, json: async () => telo, text: async () => JSON.stringify(telo) };
}

let fotkySteceny = false;
global.fetch = async function (url, opts = {}) {
  const a = String(url);
  if (a.includes('signInWithPassword')) return odp(200, { idToken: 'TOKEN', localId: 'ctecka1' });
  if (a.includes(':batchGet')) {
    const chtene = JSON.parse(opts.body).documents;
    if (chtene.some(n => n.includes('/photo_'))) fotkySteceny = true;
    return odp(200, chtene.map(n => {
      const id = n.split('/').pop();
      return DOKUMENTY[id] ? { found: dok(n, DOKUMENTY[id]) } : { missing: n };
    }));
  }
  if (a.includes('/crm/main')) return odp(200, dok('crm/main', CRM));
  if (a.includes('/sklad')) {
    return odp(200, { documents: Object.keys(DOKUMENTY).map(id => ({ name: KOL + '/' + id, fields: {} })) });
  }
  return odp(404, {});
};

const ENV = { SKLAD_EMAIL: 'ctecka@sklad.local', SKLAD_HESLO: 'tajne', SKLAD_UID: UID, MCP_TOKEN: 'tokentokentokentokentokentoken12' };

(async function () {
  const ctecka = require(path.resolve(__dirname, '..', 'nastroje', 'sklad.js'));
  const { default: konektor } = await import(path.resolve(__dirname, '..', 'konektor', 'worker.js'));

  const U = 'https://x.workers.dev/' + ENV.MCP_TOKEN + '/mcp';
  const nastroj = async (name, args) => {
    const r = await konektor.fetch(new Request(U, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }),
    }), ENV);
    return JSON.parse((await r.json()).result.content[0].text);
  };

  // Čtečka: stáhni a slož
  const token = await ctecka.prihlas();
  const nactene = await ctecka.nactiSklad(token.token, UID);
  const polozkyC = ctecka.slozPolozky(nactene.data, nactene.archivy);

  /* ── Skládání položek ─────────────────────────────────────────────── */
  const vseK = await nastroj('sklad_polozky', { stav: 'vse', profil: 'vse', limit: 0 });
  shoda('stejný počet položek celkem', polozkyC.length, vseK.celkem);
  shoda('stejné položky ve stejném pořadí',
    polozkyC.map(i => i.id), vseK.polozky.map(i => i.id));

  /* ── Fotky ────────────────────────────────────────────────────────── */
  ok('ani jedna strana netahá fotky', fotkySteceny === false);
  const sFotkouC = ctecka.bezFotek(polozkyC.find(i => i.id === 's1'));
  const sFotkouK = vseK.polozky.find(i => i.id === 's1');
  shoda('base64 fotka se vyhodí stejně', sFotkouC.imgUrl, sFotkouK.imgUrl);
  shoda('značka o fotce je stejná', sFotkouC.maFotku, sFotkouK.maFotku);
  const znackaC = ctecka.bezFotek(polozkyC.find(i => i.id === 's3')).maFotku;
  const znackaK = vseK.polozky.find(i => i.id === 's3').maFotku;
  shoda('hasPhoto z cloudu se převádí stejně', znackaC, znackaK);
  const odkazC = ctecka.bezFotek(polozkyC.find(i => i.id === 's4'));
  const odkazK = vseK.polozky.find(i => i.id === 's4');
  shoda('odkazovaný obrázek zůstává oběma', odkazC.imgUrl, odkazK.imgUrl);
  shoda('a značku nepřidá ani jedna', odkazC.maFotku, odkazK.maFotku);

  /* ── Filtr stavů ──────────────────────────────────────────────────── */
  for (const [stav, popis] of [['stock', 'na skladě'], ['waiting', 'čeká'], ['paid', 'prodáno']]) {
    const c = ctecka.uprav(polozkyC.filter(i => (i.saleState || 'stock') === stav), { profil: 'vse' }).map(i => i.id);
    const k = (await nastroj('sklad_polozky', { stav, profil: 'vse', limit: 0 })).polozky.map(i => i.id);
    shoda('stejný výběr — ' + popis, c, k);
  }

  /* ── Filtr profilů ────────────────────────────────────────────────── */
  for (const profil of ['podnikani', 'osobni', 'vse']) {
    const c = ctecka.uprav(polozkyC, { profil }).map(i => i.id);
    const k = (await nastroj('sklad_polozky', { stav: 'vse', profil, limit: 0 })).polozky.map(i => i.id);
    shoda('stejný profil — ' + profil, c, k);
  }

  /* ── Výběr sloupců ────────────────────────────────────────────────── */
  const poleC = ctecka.uprav(polozkyC.filter(i => (i.saleState || 'stock') === 'stock'),
    { profil: 'vse', pole: ['name', 'sku', 'buyPrice'] });
  const poleK = (await nastroj('sklad_polozky', { stav: 'stock', profil: 'vse', pole: ['name', 'sku', 'buyPrice'], limit: 0 })).polozky;
  shoda('stejné sloupce i jejich hodnoty', poleC, poleK);

  /* ── Prodeje po letech ────────────────────────────────────────────── */
  for (const rok of ['2025', '2026']) {
    const c = polozkyC.filter(i => i.saleState === 'paid'
      && String(i.payoutDate || i.saleDate || '').slice(0, 4) === rok).map(i => i.id);
    const k = (await nastroj('sklad_prodeje', { rok, profil: 'vse', limit: 0 })).polozky.map(i => i.id);
    shoda('stejné prodeje za ' + rok, c, k);
  }

  /* ── Souhrn ───────────────────────────────────────────────────────── */
  const crmC = await ctecka.nactiCrm(token.token, UID);
  const textC = ctecka.vypisSouhrn(polozkyC.map(ctecka.bezFotek), crmC, nactene.data);
  const souhrnK = await nastroj('sklad_souhrn', {});
  const cislo = (popis) => {
    const m = textC.match(new RegExp(popis + '\\s+(\\d+)'));
    return m ? Number(m[1]) : null;
  };
  shoda('souhrn — na skladě', cislo('na skladě'), souhrnK.naSklade);
  shoda('souhrn — čeká na payout', cislo('čeká na payout'), souhrnK.cekaNaPayout);
  shoda('souhrn — prodáno', cislo('prodáno'), souhrnK.prodano);
  shoda('souhrn — celkem', cislo('položek celkem'), souhrnK.celkem);
  shoda('souhrn — osobní', cislo('z toho osobní'), souhrnK.osobni);
  shoda('souhrn — podnikání', cislo('podnikání'), souhrnK.podnikani);
  shoda('souhrn — zákazníci', cislo('zákazníci'), souhrnK.zakazniku);
  shoda('souhrn — partneři', cislo('partneři'), souhrnK.partneru);

  /* ── Zákazníci ────────────────────────────────────────────────────── */
  const crmK = await nastroj('sklad_zakaznici', { limit: 0 });
  shoda('stejní zákazníci', crmC.customers, crmK.zakaznici);
  shoda('stejní partneři', crmC.partners, crmK.partneri);

  /* ── Ani jedna strana nepočítá částky ─────────────────────────────── */
  ok('čtečka na kurzy upozorňuje', /kurz/i.test(textC));
  ok('konektor na kurzy upozorňuje', /kurz/i.test(souhrnK.poznamka || ''));
  ok('souhrn čtečky nesčítá koruny', !/Kč/.test(textC));
  ok('souhrn konektoru nenese žádnou sumu',
    !Object.keys(souhrnK).some(k => /suma|celkovaCena|zisk|obrat/i.test(k)));

  console.log(selhalo ? selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : 'OK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})().catch(e => { console.log('ERROR: ' + (e && e.stack || e)); process.exit(1); });
