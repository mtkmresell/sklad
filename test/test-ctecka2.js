// Čtečka skladu — stahovací část. Firestore nahrazuje podstrčený fetch,
// takže se dá ověřit, co skript posílá a jak si poradí s tím, co dostane.
//
// Zajímají nás tři věci, na kterých se dá pohořet: že se stránkuje, že se
// fotky netahají a že se dokumenty vyzvednou jedním voláním.

const path = require('path');

let selhalo = 0, proslo = 0;
function ok(popis, podminka) {
  if (podminka) { proslo++; }
  else { selhalo++; console.log('FAIL: ' + popis); }
}
function shoda(popis, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { proslo++; }
  else { selhalo++; console.log('FAIL: ' + popis + '\n  čekáno: ' + sb + '\n  dostal: ' + sa); }
}

// Zabalí hodnotu do typů, jak to dělá Firestore
function zabal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(zabal) } };
  const fields = {};
  Object.keys(v).forEach(function (k) { fields[k] = zabal(v[k]); });
  return { mapValue: { fields: fields } };
}
function zabalDoklad(jmeno, obj) {
  const fields = {};
  Object.keys(obj).forEach(function (k) { fields[k] = zabal(obj[k]); });
  return { name: jmeno, fields: fields };
}

const UID = 'uzivatel123';
const KOL = 'projects/sklad-7eec9/databases/(default)/documents/users/' + UID + '/sklad';

const naSklade = { id: 's1', name: 'Dunk Low', saleState: 'stock', buyPrice: 2400 };
const prodano = { id: 'p1', name: 'Jordan 1', saleState: 'paid', payoutDate: '2025-06-01' };

// Co si server pamatuje
const dokumenty = {
  'data': { savedAt: '2026-01-05T10:00:00Z', itemsStock: [naSklade], archiveYears: ['2025'], items: [], retailers: ['Nike'] },
  'sold_2025': { items: [prodano] },
  'cache': { 'name:dunk low': { sku: 'DD1391' } },
  'photo_s1': { data: 'data:image/jpeg;base64,' + 'A'.repeat(2000) },
  'photo_p1': { data: 'data:image/jpeg;base64,' + 'B'.repeat(2000) },
};

// Záznam toho, co skript během běhu vyžádal
let volani = [];

global.fetch = async function (url, opts) {
  const adresa = String(url);
  volani.push({ url: adresa, opts: opts || {} });

  // Výpis kolekce, schválně na dvě stránky, ať se ověří stránkování
  if (adresa.indexOf('/sklad?') !== -1 || /\/sklad$/.test(adresa.split('?')[0])) {
    const u = new URL(adresa);
    const token = u.searchParams.get('pageToken');
    const vsechny = Object.keys(dokumenty);
    const prvni = vsechny.slice(0, 3), druha = vsechny.slice(3);
    const davka = token === 'strana2' ? druha : prvni;
    return odpoved(200, {
      documents: davka.map(function (id) { return { name: KOL + '/' + id, fields: {} }; }),
      nextPageToken: token === 'strana2' ? undefined : 'strana2',
    });
  }

  // Hromadné vyzvednutí
  if (adresa.indexOf(':batchGet') !== -1) {
    const chtene = JSON.parse(opts.body).documents;
    return odpoved(200, chtene.map(function (jmeno) {
      const id = jmeno.split('/').pop();
      return dokumenty[id] ? { found: zabalDoklad(jmeno, dokumenty[id]) } : { missing: jmeno };
    }));
  }

  // CRM
  if (adresa.indexOf('/crm/main') !== -1) {
    return odpoved(200, zabalDoklad('crm/main', {
      customers: [{ id: 'c1', name: 'Petr' }],
      partners: [{ id: 'pa1', name: 'Bazar' }],
    }));
  }

  // Přihlášení
  if (adresa.indexOf('signInWithPassword') !== -1) {
    return odpoved(200, { idToken: 'TOKEN', localId: UID });
  }
  return odpoved(404, {});
};

function odpoved(status, telo) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: async function () { return telo; },
    text: async function () { return JSON.stringify(telo); },
  };
}

const N = require(path.resolve(__dirname, '..', 'nastroje', 'sklad.js'));

(async function () {
  /* ── Přihlášení ─────────────────────────────────────────────────── */
  process.env.SKLAD_EMAIL = 'test@example.com';
  process.env.SKLAD_HESLO = 'tajne';
  const prihlaseni = await N.prihlas();
  shoda('přihlášení vrátí token a uid', prihlaseni, { token: 'TOKEN', uid: UID });

  const prihlasovaci = volani.find(function (v) { return v.url.indexOf('signInWithPassword') !== -1; });
  ok('heslo jde v těle požadavku, ne v adrese', prihlasovaci.url.indexOf('tajne') === -1);
  shoda('posílá se e-mail a heslo', JSON.parse(prihlasovaci.opts.body),
    { email: 'test@example.com', password: 'tajne', returnSecureToken: true });

  /* ── Načtení kolekce ────────────────────────────────────────────── */
  volani = [];
  const nactene = await N.nactiSklad('TOKEN', UID);

  const vypisy = volani.filter(function (v) { return v.url.indexOf(':batchGet') === -1; });
  ok('kolekce se prošla na dvě stránky', vypisy.length === 2);
  ok('při výpisu se stahuje jen savedAt', vypisy[0].url.indexOf('mask.fieldPaths=savedAt') !== -1);
  ok('druhá stránka se vyžádala tokenem', vypisy[1].url.indexOf('pageToken=strana2') !== -1);

  const davky = volani.filter(function (v) { return v.url.indexOf(':batchGet') !== -1; });
  ok('dokumenty se vyzvedly jedním voláním', davky.length === 1);

  const zadane = JSON.parse(davky[0].opts.body).documents;
  ok('fotky se nevyžádaly', zadane.every(function (j) { return j.indexOf('/photo_') === -1; }));
  ok('hlavní dokument se vyžádal', zadane.some(function (j) { return /\/data$/.test(j); }));
  ok('archiv se vyžádal', zadane.some(function (j) { return /\/sold_2025$/.test(j); }));
  ok('našeptávač se vyžádal', zadane.some(function (j) { return /\/cache$/.test(j); }));

  /* ── Co z toho vylezlo ──────────────────────────────────────────── */
  ok('hlavní dokument se rozbalil', nactene.data && nactene.data.savedAt === '2026-01-05T10:00:00Z');
  shoda('nastavení se rozbalilo', nactene.data.retailers, ['Nike']);
  shoda('archiv se rozbalil', nactene.archivy['2025'].map(function (i) { return i.id; }), ['p1']);
  ok('našeptávač se rozbalil', nactene.cache && nactene.cache['name:dunk low'].sku === 'DD1391');

  const polozky = N.slozPolozky(nactene.data, nactene.archivy);
  shoda('sklad i archiv dohromady', polozky.map(function (i) { return i.id; }), ['s1', 'p1']);
  ok('čísla zůstala čísly', polozky[0].buyPrice === 2400);

  /* ── Autorizace ─────────────────────────────────────────────────── */
  ok('všechna čtení nesou token', volani.every(function (v) {
    return v.opts.headers && v.opts.headers.Authorization === 'Bearer TOKEN';
  }));

  /* ── CRM ────────────────────────────────────────────────────────── */
  const crm = await N.nactiCrm('TOKEN', UID);
  shoda('zákazníci', crm.customers, [{ id: 'c1', name: 'Petr' }]);
  shoda('partneři', crm.partners, [{ id: 'pa1', name: 'Bazar' }]);

  /* ── Čtení cizí složky (účet jen pro čtení) ─────────────────────── */
  // Čtečka má vlastní uid, ale sahá do kóje majitele. Musí se ptát na
  // jeho cestu, ne na svoji — jinak by četla svoje prázdno.
  volani = [];
  await N.nactiSklad('TOKEN', 'majitel999');
  ok('výpis míří na složku majitele', volani.some(function (v) {
    return v.url.indexOf('/users/majitel999/sklad') !== -1;
  }));
  ok('do vlastní složky se čtečka neptá', volani.every(function (v) {
    return v.url.indexOf('/users/' + UID + '/') === -1;
  }));

  volani = [];
  await N.nactiCrm('TOKEN', 'majitel999');
  ok('CRM se čte taky u majitele', volani.some(function (v) {
    return v.url.indexOf('/users/majitel999/crm/main') !== -1;
  }));

  /* ── Nic se nezapisovalo ────────────────────────────────────────── */
  const zapisy = volani.filter(function (v) {
    const m = (v.opts.method || 'GET').toUpperCase();
    return m === 'PATCH' || m === 'DELETE' || m === 'PUT'
      || (m === 'POST' && v.url.indexOf(':batchGet') === -1 && v.url.indexOf('signIn') === -1);
  });
  shoda('žádný zápisový požadavek', zapisy.map(function (v) { return v.url; }), []);

  console.log(selhalo ? selhalo + ' z ' + (proslo + selhalo) + ' kontrol selhalo' : 'OK (' + proslo + ' kontrol)');
  process.exit(selhalo ? 1 : 0);
})();
