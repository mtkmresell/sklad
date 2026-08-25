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
     https://<jméno-workeru>.<jméno-účtu>.workers.dev/<MCP_TOKEN>/mcp

   Ta prostřední část tam opravdu patří — bez ní se hostitel nepřeloží
   a Claude hlásí jen „chyba", z čehož se důvod nepozná. Adresu proto
   neskládej z hlavy: je vypsaná v Cloudflare u Workeru pod
   Settings → Domains & Routes. Tady je pro pořádek ta skutečná,
   ať se předloha nemá jak zkomolit:
     https://dawn-bush-6ac21.mtkm-resell.workers.dev/<MCP_TOKEN>/mcp

   Bez správného tokenu server odpoví 404 a nic neprozradí. Token je
   jediný zámek na veřejné adrese — kdo ho má, přečte si sklad. Zapsat
   nemůže ani s ním. Adresa sama tajná není; tajný je jen token.
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
/* ══════════════════════════════════════════════════════════════════════
   UPOZORNĚNÍ E-MAILEM

   Aplikace je stránka v prohlížeči — sama od sebe nikdy nic nespustí.
   Tenhle Worker ale běží pořád, takže se jednou denně podívá do skladu
   a když je co říct, pošle mail. Nic nezapisuje ani tady; kouká se
   stejnýma očima jako konektor.

   ── Proč to nechodí každý den ────────────────────────────────────────
   Upozornění, které chodí pořád, se po týdnu přestane číst. Proto se
   nehlásí stav („zbývá 7 dní"), ale okamžik: každá věc se ozve jen ten
   den, kdy dojde na daný práh. Inzerát tedy přijde ve zprávě třikrát za
   život — sedm dní, tři dny a den před vypršením — a jinak je ticho.

   Vedlejší přínos: nemusí se nikam pamatovat, co už se poslalo. Práh je
   dané číslo dní a to nastane samo od sebe právě jednou. Když jeden běh
   vynechá (výpadek), tenhle jeden bod se přeskočí — proto jsou prahy
   tři, ne jeden.

   ── Peníze schválně nikde ────────────────────────────────────────────
   Stejné pravidlo jako u zbytku konektoru: kurzy EUR umí správně jen
   aplikace, která si pamatuje kurz ke dni nákupu i payoutu. Ve zprávě
   jsou proto počty a jména, ne částky.

   ── Zákazníci schválně nikde ─────────────────────────────────────────
   Mail jde přes cizí službu. Jména a telefony z CRM v něm nemají co
   dělat, i když na ně konektor vidí — do zprávy se nedostanou.
══════════════════════════════════════════════════════════════════════ */

const DEN = 86400000;
const BAZOS_PLATFORMY = ['Bazoš.cz', 'Bazoš.sk', 'Bazoš.pl'];
const BAZOS_PLATNOST = 60;   // dní, než inzerát vyprší — jako v aplikaci
const BAZOS_LIMIT = 50;      // kolik inzerátů Bazoš pustí naráz

/* Ozveme se až v den vypršení, ne dopředu. Bazoš inzerát nemaže, jen
   ho odloží do archivu a odtud se nahodí znovu jedním kliknutím — takže
   předem se stejně nedá dělat nic než ho smazat a vystavit celý znovu,
   což je horší než počkat. */
const BAZOS_PRAH = 0;

/* Payout se poprvé ozve v den, kdy měly peníze podle nastavení dorazit,
   a pak jednou týdně, dokud se to nevyřeší. Kolik dní se čeká, si aplikace
   drží u každé platformy zvlášť (Nastavení → místa prodeje) — bere se to
   odtamtud, ať se ta čísla nemusí držet na dvou místech. */
const PAYOUT_OPAKOVANI = 7;

// Když platforma vlastní nastavení nemá — stejná čísla jako v aplikaci
const VYCHOZI_PAYOUT_SKUPIN = { platforms: 7, eshopy: 21, local: 3 };
const VYCHOZI_PAYOUT = 14;

const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

const PRAHA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function prazskeCasti(t) {
  const c = {};
  for (const p of PRAHA.formatToParts(new Date(t))) if (p.type !== 'literal') c[p.type] = p.value;
  return { rok: +c.year, mesic: +c.month, den: +c.day, hodina: +c.hour };
}

/* Pořadové číslo dne — UTC půlnoc odpovídajícího pražského data.

   Rozdíl dvou takových čísel je počet kalendářních dní. Kdyby se počítalo
   po hodinách, přechod na letní čas by jednou za rok den přeskočil
   a podruhé zopakoval — a s ním i práh, na kterém celé upozornění stojí. */
function prazskyDen(t) {
  const c = prazskeCasti(t);
  return Date.UTC(c.rok, c.mesic - 1, c.den);
}

// Datum prodeje je v datech ve dvou tvarech: 2026-05-10 i 10.05.2026
function denZData(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(t);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function formatDne(denCislo) {
  const d = new Date(denCislo);
  return d.getUTCDate() + '. ' + (d.getUTCMonth() + 1) + '. ' + d.getUTCFullYear();
}

// Čeština počítá po třech: 1 inzerát, 2 inzeráty, 5 inzerátů
function pocet(n, tvary) { return n + ' ' + tvary[n === 1 ? 0 : n < 5 ? 1 : 2]; }
const dnu = n => pocet(n, ['den', 'dny', 'dní']);

// Hlavička balíku není kus zboží, jen jeho obal — do počtů kusů nepatří
const jeBalik = it => it && it.type === 'bulk';

/* Rozdělení platforem do skupin i doby payoutu si drží aplikace v nastavení.
   Do cloudu jde jako text (viz syncSettings, shape 'text'), ale starší
   zápisy tam mají rovnou objekt — bere se obojí. */
function platformoveSkupiny(data) {
  const v = data && data.platGroups;
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

/* Za kolik dní se u téhle platformy čekají peníze.

   Musí to vyjít stejně jako getPayoutDays() v aplikaci — jinak by mail
   upomínal jindy, než co má uživatel nastavené, a přestal by dávat smysl.
   Odtud i drobnosti, které samy o sobě nedávají smysl: název se nečistí
   od mezer a když je platforma omylem ve dvou skupinách, platí ta
   poslední. Aplikace to dělá takhle, tak to tady musí být stejně.

   Aplikace umí ještě jednu věc navíc — když má u platformy aspoň tři
   dokončené prodeje, počítá lhůtu z jejich mediánu. Tady se schválně
   bere jen nastavení: druhá implementace statistiky by se s aplikací
   dřív nebo později rozešla a mail by upomínal proti jiným číslům,
   než jaká jsou vidět na obrazovce. */
function ocekavanyPayout(kdeProdano, skupiny) {
  const kde = kdeProdano || '';
  const vlastni = skupiny.payoutDays && skupiny.payoutDays[kde];
  if (vlastni != null && isFinite(vlastni)) return Number(vlastni);

  let skupina = null;
  for (const k of ['platforms', 'eshopy', 'local']) {
    if ((skupiny[k] || []).indexOf(kde) !== -1) skupina = k;
  }
  if (skupina) return VYCHOZI_PAYOUT_SKUPIN[skupina] || VYCHOZI_PAYOUT;
  return VYCHOZI_PAYOUT;
}

/* ── Inzeráty, které se blíží k vypršení ────────────────────────────── */
function bazosBlok(polozky, dnes) {
  const nalezy = [];
  for (const plat of BAZOS_PLATFORMY) {
    // Jeden inzerát může nést víc kusů (stejné SKU), a Bazoš i aplikace
    // je počítají jako jeden — tak je i hlásíme jednou
    const podleInzeratu = new Map();
    for (const it of polozky) {
      if (!(it.platforms || []).includes(plat)) continue;
      const kdy = it.bazosCheckedAt && it.bazosCheckedAt[plat];
      if (!kdy) continue;
      const zbyva = BAZOS_PLATNOST - Math.round((dnes - prazskyDen(kdy)) / DEN);
      if (zbyva !== BAZOS_PRAH) continue;
      const klic = (it.sku && String(it.sku).trim()) ? String(it.sku).trim() : (it.name || it.id);
      const drive = podleInzeratu.get(klic);
      if (!drive || zbyva < drive.zbyva) {
        podleInzeratu.set(klic, { zbyva, nazev: it.name || klic, plat });
      }
    }
    for (const z of podleInzeratu.values()) nalezy.push(z);
  }
  if (!nalezy.length) return null;

  nalezy.sort((a, b) => a.plat.localeCompare(b.plat, 'cs') || a.nazev.localeCompare(b.nazev, 'cs'));
  const radky = ['INZERÁTY NA BAZOŠI', '',
    '  Dnes vypršely — nahoď je znovu z archivu:', ''];
  for (const n of nalezy) radky.push('    • ' + n.nazev + '  (' + n.plat + ')');

  return {
    text: radky.join('\n'),
    predmet: pocet(nalezy.length, ['inzerát vypršel', 'inzeráty vypršely', 'inzerátů vypršelo']),
  };
}

/* ── Prodeje, které dlouho čekají na peníze ─────────────────────────── */
function payoutBlok(polozky, dnes, skupiny) {
  const nalezy = [];
  for (const it of polozky) {
    if (jeBalik(it)) continue;
    if (stavPolozky(it) !== 'waiting') continue;
    const prodano = denZData(it.saleDate);
    if (prodano === null) continue;

    const ceka = Math.round((dnes - prodano) / DEN);
    const ocekavano = ocekavanyPayout(it.soldWhere, skupiny);
    // Poprvé v den, kdy měly peníze dorazit, pak každý týden dál
    if (ceka < ocekavano) continue;
    if ((ceka - ocekavano) % PAYOUT_OPAKOVANI !== 0) continue;

    nalezy.push({ ceka, ocekavano, po: ceka - ocekavano,
      nazev: it.name || it.id, kde: it.soldWhere || '', prodano });
  }
  if (!nalezy.length) return null;

  nalezy.sort((a, b) => b.po - a.po || a.nazev.localeCompare(b.nazev, 'cs'));
  const radky = ['ČEKÁ NA PAYOUT', ''];
  for (const n of radkyPayout(nalezy)) radky.push(n);

  const nejhorsi = nalezy[0];
  return {
    text: radky.join('\n'),
    predmet: pocet(nalezy.length, ['payout čeká', 'payouty čekají', 'payoutů čeká'])
      + (nejhorsi.po > 0 ? ', nejdéle o ' + dnu(nejhorsi.po) + ' přes lhůtu' : ''),
  };
}

function radkyPayout(nalezy) {
  return nalezy.map(n => {
    const kde = n.kde || 'bez místa prodeje';
    const lhuta = n.po === 0
      ? 'lhůta ' + dnu(n.ocekavano) + ' vyprší dnes'
      : 'o ' + dnu(n.po) + ' přes lhůtu ' + n.ocekavano + ' dní';
    return '    • ' + n.nazev + '  — ' + kde + ', ' + lhuta
      + ', prodáno ' + formatDne(n.prodano);
  });
}

/* ── Souhrn za minulý měsíc (posílá se prvního) ─────────────────────── */
function mesicniBlok(polozky, cas, dnes) {
  const mesic = cas.mesic === 1 ? 12 : cas.mesic - 1;
  const rok = cas.mesic === 1 ? cas.rok - 1 : cas.rok;
  const od = Date.UTC(rok, mesic - 1, 1);
  const doKdy = Date.UTC(mesic === 12 ? rok + 1 : rok, mesic === 12 ? 0 : mesic, 1);

  let prodano = 0;
  let naSklade = 0;
  let ceka = 0;
  for (const it of polozky) {
    if (jeBalik(it)) continue;
    const stav = stavPolozky(it);
    if (stav === 'stock') naSklade++;
    else if (stav === 'waiting') ceka++;
    else if (stav === 'paid') {
      const d = denZData(it.payoutDate || it.saleDate);
      if (d !== null && d >= od && d < doKdy) prodano++;
    }
  }

  const radky = ['SOUHRN ZA ' + MESICE[mesic - 1].toUpperCase() + ' ' + rok, ''];
  // Číslo se zarovnává samo, přípona až za ním — jinak by „31 z 50"
  // a „1 z 50" pod sebou neseděly
  const pridej = (co, kolik, za) =>
    radky.push('    ' + co.padEnd(20) + String(kolik).padStart(4) + (za || ''));
  pridej('prodáno kusů', prodano);
  pridej('na skladě', naSklade);
  pridej('čeká na payout', ceka);

  // Kolik z padesáti povolených inzerátů je zabraných — tohle se špatně
  // hlídá okem a když se limit vyčerpá, další inzerát prostě nejde přidat
  for (const plat of BAZOS_PLATFORMY) {
    const klice = new Set();
    for (const it of polozky) {
      if (!(it.platforms || []).includes(plat)) continue;
      const kdy = it.bazosCheckedAt && it.bazosCheckedAt[plat];
      if (kdy && Math.round((dnes - prazskyDen(kdy)) / DEN) >= BAZOS_PLATNOST) continue;
      klice.add((it.sku && String(it.sku).trim()) ? String(it.sku).trim() : (it.name || it.id));
    }
    if (klice.size) pridej('inzeráty ' + plat, klice.size, ' z ' + BAZOS_LIMIT);
  }

  return {
    text: radky.join('\n'),
    predmet: 'souhrn za ' + MESICE[mesic - 1] + ' ' + rok,
  };
}

/* ── Složení celé zprávy ────────────────────────────────────────────── */
function sestavZpravu(polozky, ted, data) {
  const cas = prazskeCasti(ted);
  const dnes = prazskyDen(ted);
  const skupiny = platformoveSkupiny(data);

  const bloky = [
    bazosBlok(polozky, dnes),
    payoutBlok(polozky, dnes, skupiny),
    cas.den === 1 ? mesicniBlok(polozky, cas, dnes) : null,
  ].filter(Boolean);

  if (!bloky.length) return null;

  const predmet = 'Sklad: ' + bloky.map(b => b.predmet).join(' · ');
  const text = [
    'Sklad — ' + formatDne(dnes),
    '',
    bloky.map(b => b.text).join('\n\n\n'),
    '',
    '',
    '— — —',
    'Poslal konektor skladu. Částky ve zprávě schválně nejsou; kurzy EUR',
    'umí správně jen aplikace: https://mtkmresell.github.io/sklad/',
  ].join('\n');

  return { predmet, text };
}

/* ── Odeslání ───────────────────────────────────────────────────────── */
const MAIL_URL = 'https://api.resend.com/emails';

async function posliMail(env, predmet, text) {
  const r = await fetch(MAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_ODESILATEL || 'Sklad <onboarding@resend.dev>',
      to: [env.MAIL_KOMU],
      subject: predmet,
      text,
    }),
  });
  const odpoved = await r.text();
  if (!r.ok) throw new Error('odeslání selhalo (' + r.status + '): ' + odpoved.slice(0, 300));
  return odpoved;
}

const MAIL_TAJEMSTVI = ['RESEND_API_KEY', 'MAIL_KOMU'];

// Načte sklad a vrátí, co by se poslalo. Odesílá se až o patro výš, ať se
// dá totéž použít i pro náhled bez odeslání.
async function pripravUpozorneni(env) {
  const token = await prihlas(env);
  const { data, archivy } = await nactiSklad(token, env.SKLAD_UID);
  if (!data) throw new Error('v cloudu nejsou žádná data — zkontroluj SKLAD_UID');
  const polozky = slozPolozky(data, archivy);
  return { polozky, zprava: sestavZpravu(polozky, Date.now(), data) };
}

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
    const co = cesta[1];
    if (co !== 'mcp' && co !== 'nahled' && co !== 'test-mail') {
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

    /* Náhled a zkušební mail. Obojí se otevírá v prohlížeči, protože ten
       umí jen GET — a bez toho by se dalo nastavení ověřit jedině čekáním
       do rána, jestli něco přijde. */
    if (co === 'nahled' || co === 'test-mail') {
      const chybiMail = MAIL_TAJEMSTVI.filter(k => !env[k]);
      if (co === 'test-mail' && chybiMail.length) {
        return Response.json({
          stav: 'nenastaveno', chybi: chybiMail,
          rada: 'Doplň tajemství ve Workeru (Settings → Variables and Secrets) a nasaď znovu.',
        }, { status: 500 });
      }
      try {
        const { polozky, zprava } = await pripravUpozorneni(env);
        if (co === 'nahled') {
          return Response.json({
            stav: 'ok',
            polozek: polozky.length,
            poslalo_by_se: !!zprava,
            mail_nastaven: !chybiMail.length,
            chybi: chybiMail,
            predmet: zprava ? zprava.predmet : null,
            text: zprava ? zprava.text : null,
            poznamka: zprava ? 'Tohle by dnes ráno přišlo do mailu. Nic se neodeslalo.'
              : 'Dnes není co hlásit — žádný inzerát ani payout nedošel na práh. '
                + 'Ticho je správný stav; mail chodí jen když je co říct.',
          });
        }
        // Zkušební mail se posílá i v den, kdy není co hlásit — ověřuje
        // se tu cesta k poště, ne obsah
        const predmet = zprava ? zprava.predmet : 'Sklad: zkušební zpráva';
        const text = zprava ? zprava.text
          : 'Zkušební zpráva z konektoru skladu.\n\n'
            + 'Dnes není co hlásit — žádný inzerát ani payout nedošel na práh.\n'
            + 'Kdyby bylo, stálo by to tady. Cesta k poště funguje.\n';
        await posliMail(env, predmet, text);
        return Response.json({
          stav: 'odeslano', komu: env.MAIL_KOMU, predmet,
          poznamka: 'Kdyby nepřišel, mrkni do spamu a označ ho jako „není spam".',
        });
      } catch (e) {
        return Response.json({ stav: 'chyba', chyba: String(e.message || e) }, { status: 500 });
      }
    }

    if (request.method !== 'POST') {
      // Server sám od sebe nic neposílá, takže proud událostí nenabízí.
      // Odpověď je čitelná schválně — tahle adresa se zkouší v prohlížeči,
      // a prohlížeč umí jen GET.
      // Pošta má vlastní tajemství a bez nich konektor funguje dál — jen
      // nechodí ranní mail. Dřív o tom tenhle výpis mlčel a tvrdil, že je
      // nastavené všechno, takže se nedalo poznat, že upozornění neběží.
      const chybiMail = MAIL_TAJEMSTVI.filter(k => !env[k]);
      return Response.json({
        stav: 'ok',
        zprava: 'Konektor běží. Adresa i token sedí a na sklad vidí. '
          + 'Tenhle výpis znamená úspěch — vlož adresu do Clauda jako konektor.',
        upozorneni: chybiMail.length
          ? 'Ranní upozornění e-mailem zatím neběží, chybí: ' + chybiMail.join(', ')
          : 'Ranní upozornění e-mailem jsou nastavená. Zkusit je můžeš na /test-mail.',
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

  /* Denní obhlídka skladu.

     Cloudflare umí spouštět jen podle UTC, a Praha je proti němu v létě
     o dvě hodiny a v zimě o jednu. Proto jsou nastavené dva časy a tady
     se pustí jen ten, kterému zrovna vychází osmá ráno v Praze —
     přechod na letní čas se tak nemusí hlídat ručně dvakrát do roka. */
  async scheduled(event, env, ctx) {
    const hodina = prazskeCasti(Date.now()).hodina;
    if (hodina !== 8) return;

    const chybi = ['SKLAD_EMAIL', 'SKLAD_HESLO', 'SKLAD_UID'].concat(MAIL_TAJEMSTVI)
      .filter(k => !env[k]);
    if (chybi.length) {
      console.error('upozornění nejdou poslat, chybí: ' + chybi.join(', '));
      return;
    }

    try {
      const { zprava } = await pripravUpozorneni(env);
      if (!zprava) return;  // ticho je správný stav
      await posliMail(env, zprava.predmet, zprava.text);
      console.log('odesláno: ' + zprava.predmet);
    } catch (e) {
      // Spadnout potichu by znamenalo, že se o vypršelém inzerátu nikdo
      // nedozví a nikdo se to ani nedozví. Do logu Workeru to patří.
      console.error('upozornění selhala: ' + (e && e.stack || e));
    }
  },
};
