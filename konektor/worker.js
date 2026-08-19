/* ══════════════════════════════════════════════════════════════════════
   KONEKTOR SKLADU — MCP server pro Cloudflare Worker

   K čemu to je: aby šlo na sklad vidět i v běžném chatu na claude.ai,
   na mobilu a na desktopu — tedy tam, kde není kde spustit program.
   Claude se sem připojuje z Anthropicu, ne z tvého zařízení, takže tenhle
   soubor musí běžet na veřejné adrese.

   ── JEN ČTENÍ ────────────────────────────────────────────────────────
   Stejné pravidlo jako u nastroje/sklad.js: nic nezapisuje ani nemaže.
   Do Firestore chodí výhradně čtecí volání a účet, pod kterým se hlásí,
   má zápis zakázaný přímo pravidly na serveru (viz nastroje/PRAVIDLA.md).
   Testy hlídají, že sem zápisový kód nepřibude.

   ── Nasazení bez terminálu ───────────────────────────────────────────
   Celý server je schválně v jednom souboru bez jediné knihovny, aby se
   dal vložit do editoru v Cloudflare a nasadit z prohlížeče.
   Postup je v konektor/README.md.

   ── Tajemství, která se nastaví v Cloudflare ─────────────────────────
     SKLAD_EMAIL   e-mail účtu jen pro čtení
     SKLAD_HESLO   jeho heslo
     SKLAD_UID     UID majitele — čí data se čtou
     MCP_TOKEN     dlouhý náhodný klíč, který je součástí adresy

   Adresa konektoru pak je:
     https://<jméno-workeru>.workers.dev/<MCP_TOKEN>/mcp

   Bez správného tokenu server odpoví 404 a nic neprozradí. Token je
   jediný zámek na veřejné adrese — kdo ho má, přečte si sklad. Zapsat
   nemůže ani s ním.
══════════════════════════════════════════════════════════════════════ */

const PROJEKT = 'sklad-7eec9';
const API_KEY = 'AIzaSyDS1e4Y3LfglhKsLryxJZYqrfMSCZ9evnU';
const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY;
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJEKT + '/databases/(default)/documents';

// Nejvyšší podporovaná revize protokolu. Když si klient řekne o jinou,
// odpoví se mu jeho vlastní — novější revize spolu zpětně vycházejí.
const VERZE_PROTOKOLU = '2026-07-28';

/* ── Rozbalení hodnot z Firestore ───────────────────────────────────── */
function rozbal(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(rozbal);
  if ('mapValue' in v) return rozbalPole(v.mapValue.fields || {});
  return null;
}
function rozbalPole(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = rozbal(fields[k]);
  return out;
}

/* ── Čtení z cloudu ─────────────────────────────────────────────────── */
async function prihlas(env) {
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SKLAD_EMAIL, password: env.SKLAD_HESLO, returnSecureToken: true }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error('přihlášení selhalo: ' + ((t.error && t.error.message) || r.status));
  return t.idToken;
}

// Dvě kola: nejdřív jen jména dokumentů (bez fotek), pak jedno hromadné
// čtení — dorazí ze stejného okamžiku, takže se archivy nerozejdou
// s hlavním dokumentem.
async function nactiSklad(token, uid) {
  const jmena = [];
  let stranka = null;
  do {
    const u = new URL(FS_BASE + '/users/' + uid + '/sklad');
    u.searchParams.set('pageSize', '300');
    u.searchParams.set('mask.fieldPaths', 'savedAt');
    if (stranka) u.searchParams.set('pageToken', stranka);
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 404) break;
    if (!r.ok) throw new Error('čtení kolekce selhalo: ' + r.status);
    const j = await r.json();
    for (const d of j.documents || []) jmena.push(d.name);
    stranka = j.nextPageToken;
  } while (stranka);

  const chtene = jmena.filter(n => !/\/photo_[^/]*$/.test(n));
  if (!chtene.length) return { data: null, archivy: {} };

  const r = await fetch(FS_BASE + ':batchGet', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: chtene }),
  });
  if (!r.ok) throw new Error('hromadné čtení selhalo: ' + r.status);
  const davka = await r.json();

  let data = null;
  const archivy = {};
  for (const radek of davka || []) {
    if (!radek.found) continue;
    const id = radek.found.name.split('/').pop();
    const obsah = rozbalPole(radek.found.fields || {});
    if (id === 'data') data = obsah;
    else if (id.startsWith('sold_')) archivy[id.slice(5)] = obsah.items || [];
  }
  return { data, archivy };
}

async function nactiCrm(token, uid) {
  const r = await fetch(FS_BASE + '/users/' + uid + '/crm/main', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return { customers: [], partners: [] };
  if (!r.ok) throw new Error('čtení CRM selhalo: ' + r.status);
  const d = rozbalPole((await r.json()).fields || {});
  return { customers: d.customers || [], partners: d.partners || [] };
}

/* ── Skládání a úprava ──────────────────────────────────────────────── */
function slozPolozky(data, archivy) {
  if (!data) return [];
  const hlavni = Array.isArray(data.itemsStock) ? data.itemsStock : [];
  const roky = Array.isArray(data.archiveYears) ? data.archiveYears : [];
  const zArchivu = roky.reduce((a, r) => a.concat(archivy[r] || []), []);
  if (!hlavni.length && !zArchivu.length && Array.isArray(data.items)) return data.items;
  return hlavni.concat(zArchivu);
}

const jeOsobni = it => !!(it && it.personal);

// Fotka v položce by odpověď nafoukla o megabajty
function bezFotek(it) {
  const kopie = {};
  for (const k of Object.keys(it)) {
    if (k === 'imgUrl' && /^data:/.test(it[k] || '')) continue;
    if (k.charAt(0) === '_') continue;
    kopie[k] = it[k];
  }
  if ((it.imgUrl && /^data:/.test(it.imgUrl)) || it.hasPhoto) kopie.maFotku = 1;
  return kopie;
}

function stavPolozky(it) { return it.saleState || 'stock'; }

function filtruj(seznam, a) {
  let out = seznam.map(bezFotek);
  if (a.stav && a.stav !== 'vse') out = out.filter(i => stavPolozky(i) === a.stav);
  if (a.profil === 'osobni') out = out.filter(jeOsobni);
  if (a.profil === 'podnikani') out = out.filter(i => !jeOsobni(i));
  if (a.kategorie) {
    const k = String(a.kategorie).toLowerCase();
    out = out.filter(i => String(i.category || '').toLowerCase().includes(k));
  }
  if (a.platforma) {
    const p = String(a.platforma).toLowerCase();
    out = out.filter(i => (i.platforms || []).some(x => String(x).toLowerCase().includes(p)));
  }
  if (a.hledat) {
    const q = String(a.hledat).toLowerCase();
    out = out.filter(i =>
      String(i.name || '').toLowerCase().includes(q) ||
      String(i.sku || '').toLowerCase().includes(q) ||
      (i.tags || []).some(t => String(t).toLowerCase().includes(q)));
  }
  if (a.rok) {
    out = out.filter(i => String(i.payoutDate || i.saleDate || '').slice(0, 4) === String(a.rok));
  }
  return out;
}

// Odpověď musí zůstat v rozumné velikosti — celý sklad má přes 600 kB
const VYCHOZI_LIMIT = 60;
const STROP_ZNAKU = 180000;

function orizni(seznam, a) {
  const celkem = seznam.length;
  let out = seznam;
  if (a.pole && a.pole.length) {
    out = out.map(i => {
      const k = {};
      for (const p of a.pole) if (i[p] !== undefined) k[p] = i[p];
      return k;
    });
  }
  const limit = a.limit === 0 ? celkem : (a.limit || VYCHOZI_LIMIT);
  out = out.slice(0, limit);
  let text = JSON.stringify({ celkem, vraceno: out.length, polozky: out }, null, 1);
  // Kdyby i po limitu byla odpověď obrovská, ubírej dál
  while (text.length > STROP_ZNAKU && out.length > 1) {
    out = out.slice(0, Math.floor(out.length / 2));
    text = JSON.stringify({ celkem, vraceno: out.length, polozky: out }, null, 1);
  }
  const zprava = { celkem, vraceno: out.length, polozky: out };
  if (out.length < celkem) {
    zprava.poznamka = 'Vráceno prvních ' + out.length + ' z ' + celkem
      + '. Zuž dotaz filtry, nebo si přes "pole" vyžádej jen sloupce, které potřebuješ.';
  }
  return zprava;
}

/* ── Souhrn ─────────────────────────────────────────────────────────── */
function souhrn(polozky, crm, data) {
  const p = polozky.map(bezFotek);
  const podleRoku = {};
  p.filter(i => stavPolozky(i) === 'paid').forEach(i => {
    const r = String(i.payoutDate || i.saleDate || '').slice(0, 4) || 'bez data';
    podleRoku[r] = (podleRoku[r] || 0) + 1;
  });
  const kategorie = {};
  p.filter(i => stavPolozky(i) === 'stock').forEach(i => {
    const k = i.category || 'bez kategorie';
    kategorie[k] = (kategorie[k] || 0) + 1;
  });
  return {
    naSklade: p.filter(i => stavPolozky(i) === 'stock').length,
    cekaNaPayout: p.filter(i => stavPolozky(i) === 'waiting').length,
    prodano: p.filter(i => stavPolozky(i) === 'paid').length,
    celkem: p.length,
    osobni: p.filter(jeOsobni).length,
    podnikani: p.filter(i => !jeOsobni(i)).length,
    zakazniku: (crm.customers || []).length,
    partneru: (crm.partners || []).length,
    prodejePoLetech: podleRoku,
    naSkladePodleKategorii: kategorie,
    naposledyUlozeno: (data && data.savedAt) || null,
    poznamka: 'Částky se schválně nesčítají — kurzy EUR umí správně jen aplikace. '
      + 'Na výpočty si vyžádej řádky přes sklad_polozky a spočítej je z nich.',
  };
}

/* ── Definice nástrojů ──────────────────────────────────────────────── */
const SPOLECNE_FILTRY = {
  profil: { type: 'string', enum: ['podnikani', 'osobni', 'vse'], description: 'Profil. Výchozí vse.' },
  kategorie: { type: 'string', description: 'Část názvu kategorie, např. "sneakers", "pokemon", "lego".' },
  hledat: { type: 'string', description: 'Hledaný text v názvu, SKU nebo štítcích.' },
  platforma: { type: 'string', description: 'Část názvu platformy, např. "Bazoš", "Vinted".' },
  pole: {
    type: 'array', items: { type: 'string' },
    description: 'Které sloupce vrátit, např. ["name","sku","buyPrice"]. Bez toho se vrací vše. '
      + 'Zužuje odpověď — použij, když stačí pár sloupců.',
  },
  limit: { type: 'number', description: 'Kolik položek vrátit. Výchozí 60, 0 znamená bez omezení.' },
};

const NASTROJE = [
  {
    name: 'sklad_souhrn',
    description: 'Přehled skladu v číslech — kolik je na skladě, čeká na payout a je prodáno, '
      + 'rozpad na osobní a podnikání, prodeje po letech, sklad po kategoriích, počty zákazníků. '
      + 'Začni tímhle, když nevíš, na co se ptát. Nevrací jednotlivé položky.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sklad_polozky',
    description: 'Vrátí položky skladu jako řádky. Tímhle se odpovídá na většinu otázek — '
      + 'co leží nejdéle, kolik stálo zboží v kategorii, co je vystavené na Bazoši. '
      + 'Ceny jsou v Kč, pokud u položky není uvedená měna. Fotky se nevracejí.',
    inputSchema: {
      type: 'object',
      properties: {
        stav: {
          type: 'string', enum: ['stock', 'waiting', 'paid', 'vse'],
          description: 'stock = na skladě, waiting = čeká na payout, paid = prodáno. Výchozí stock.',
        },
        ...SPOLECNE_FILTRY,
      },
    },
  },
  {
    name: 'sklad_prodeje',
    description: 'Prodané položky, volitelně za jeden rok. Rok se bere podle data payoutu. '
      + 'Zisk si dopočítej z buyPrice, sellPrice a extraCosts na řádcích.',
    inputSchema: {
      type: 'object',
      properties: {
        rok: { type: 'string', description: 'Např. "2026". Bez toho všechny roky.' },
        ...SPOLECNE_FILTRY,
      },
    },
  },
  {
    name: 'sklad_zakaznici',
    description: 'Zákazníci a obchodní partneři z CRM. Obsahuje osobní údaje jiných lidí — '
      + 'jména, telefony, adresy. Vytahuj jen to, co je k odpovědi potřeba, a nevypisuj '
      + 'celé kontakty, když stačí souhrn.',
    inputSchema: {
      type: 'object',
      properties: {
        hledat: { type: 'string', description: 'Hledaný text ve jméně.' },
        limit: { type: 'number', description: 'Kolik vrátit. Výchozí 60.' },
      },
    },
  },
];

/* ── Provedení nástroje ─────────────────────────────────────────────── */
async function spustNastroj(jmeno, args, env) {
  const token = await prihlas(env);
  const uid = env.SKLAD_UID;
  args = args || {};

  if (jmeno === 'sklad_zakaznici') {
    const crm = await nactiCrm(token, uid);
    let z = crm.customers || [], p = crm.partners || [];
    if (args.hledat) {
      const q = String(args.hledat).toLowerCase();
      const shoda = x => JSON.stringify(x).toLowerCase().includes(q);
      z = z.filter(shoda); p = p.filter(shoda);
    }
    const limit = args.limit === 0 ? Infinity : (args.limit || VYCHOZI_LIMIT);
    return { zakazniku: z.length, partneru: p.length, zakaznici: z.slice(0, limit), partneri: p.slice(0, limit) };
  }

  const { data, archivy } = await nactiSklad(token, uid);
  if (!data) throw new Error('V cloudu nejsou žádná data — sedí SKLAD_UID?');
  const polozky = slozPolozky(data, archivy);

  if (jmeno === 'sklad_souhrn') {
    const crm = await nactiCrm(token, uid);
    return souhrn(polozky, crm, data);
  }
  if (jmeno === 'sklad_polozky') {
    return orizni(filtruj(polozky, { ...args, stav: args.stav || 'stock' }), args);
  }
  if (jmeno === 'sklad_prodeje') {
    return orizni(filtruj(polozky, { ...args, stav: 'paid' }), args);
  }
  throw new Error('neznámý nástroj: ' + jmeno);
}

/* ── JSON-RPC ───────────────────────────────────────────────────────── */
function vysledek(id, result) { return { jsonrpc: '2.0', id, result }; }
function chyba(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function zpracujZpravu(zprava, env) {
  const { id, method, params } = zprava;

  if (method === 'initialize') {
    // Ozvi se verzí, kterou si klient vyžádal, pokud jí rozumíme
    const chce = (params && params.protocolVersion) || VERZE_PROTOKOLU;
    return vysledek(id, {
      protocolVersion: chce,
      capabilities: { tools: {} },
      serverInfo: { name: 'sklad', title: 'SKLAD — evidence skladu', version: '1.0.0' },
      instructions: 'Data ze skladu pro reselling (tenisky, Pokémon karty, LEGO). Jen čtení. '
        + 'Ceny jsou v Kč, pokud u položky není uvedená měna. Kurzy EUR si aplikace pamatuje '
        + 'ke dni nákupu i payoutu — nikdy nepřepočítávej zpětně dnešním kurzem.',
    });
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) {
    return null;   // oznámení se nepotvrzují
  }
  if (method === 'ping') return vysledek(id, {});
  if (method === 'tools/list') return vysledek(id, { tools: NASTROJE });
  if (method === 'tools/call') {
    const jmeno = params && params.name;
    try {
      const data = await spustNastroj(jmeno, params && params.arguments, env);
      return vysledek(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
    } catch (e) {
      // Chyba nástroje patří do výsledku, ne do protokolu — model ji má vidět
      return vysledek(id, { content: [{ type: 'text', text: 'Chyba: ' + (e.message || e) }], isError: true });
    }
  }
  if (method === 'resources/list') return vysledek(id, { resources: [] });
  if (method === 'prompts/list') return vysledek(id, { prompts: [] });
  return chyba(id, -32601, 'neznámá metoda: ' + method);
}

/* ── Vstupní bod ────────────────────────────────────────────────────── */
// Porovnání odolné vůči měření času — ať se token nedá uhodnout po znacích
function shodujeSe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let rozdil = 0;
  for (let i = 0; i < a.length; i++) rozdil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdil === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cesta = url.pathname.replace(/^\/+|\/+$/g, '').split('/');

    // Bez platného tokenu se server tváří, že tu nic není
    if (!env.MCP_TOKEN || !shodujeSe(cesta[0] || '', env.MCP_TOKEN)) {
      return new Response('Not found', { status: 404 });
    }
    if (cesta[1] !== 'mcp') {
      return new Response('Not found', { status: 404 });
    }
    // Chybějící tajemství se hlásí dřív než cokoli jiného — je to
    // nejčastější důvod, proč se konektor nepřipojí, a z prohlížeče
    // to jinak není poznat
    const chybi = ['SKLAD_EMAIL', 'SKLAD_HESLO', 'SKLAD_UID'].filter(k => !env[k]);
    if (chybi.length) {
      return Response.json({
        stav: 'nenastaveno',
        chybi,
        rada: 'Doplň tajemství ve Workeru (Settings → Variables and Secrets) a nasaď znovu.',
      }, { status: 500 });
    }

    if (request.method !== 'POST') {
      // Server sám od sebe nic neposílá, takže proud událostí nenabízí.
      // Odpověď je čitelná schválně — tahle adresa se zkouší v prohlížeči,
      // a prohlížeč umí jen GET.
      return Response.json({
        stav: 'ok',
        zprava: 'Konektor běží. Adresa je správná a tajemství jsou nastavená. '
          + 'Tenhle výpis znamená úspěch — vlož adresu do Clauda jako konektor.',
        poznamka: 'Data se čtou přes POST, proto prohlížeč nic dalšího neukáže.',
      }, { status: 405, headers: { Allow: 'POST' } });
    }

    let telo;
    try {
      telo = await request.json();
    } catch {
      return Response.json(chyba(null, -32700, 'Tělo požadavku není platný JSON.'), { status: 400 });
    }

    // Klient smí poslat i dávku zpráv najednou
    if (Array.isArray(telo)) {
      const odpovedi = [];
      for (const z of telo) {
        const o = await zpracujZpravu(z, env);
        if (o) odpovedi.push(o);
      }
      if (!odpovedi.length) return new Response(null, { status: 202 });
      return Response.json(odpovedi);
    }

    const odpoved = await zpracujZpravu(telo, env);
    if (!odpoved) return new Response(null, { status: 202 });
    return Response.json(odpoved);
  },
};
