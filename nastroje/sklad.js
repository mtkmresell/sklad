#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   ČTEČKA SKLADU — data z cloudu do konzole

   K čemu to je: aby se dala data přečíst bez otevírání aplikace
   v prohlížeči. Vypíše JSON na výstup, takže se to dá rovnou předat
   dál — AI pomocníkovi, jinému skriptu, čemukoli.

   ── JEN ČTENÍ ────────────────────────────────────────────────────────
   Skript nic nezapisuje ani nemaže. Používá výhradně čtecí volání
   Firestore (`:runQuery` se tu nepoužívá vůbec, zápisové `:commit`
   a `PATCH` taky ne). Není to zakázané pravidly na serveru — přihlášený
   účet právo zápisu má — ale v tomhle souboru pro zápis prostě není kód.
   Kdyby se sem někdy zápis přidával, patří to udělat vědomě a se stejnou
   pojistkou proti přepsání novějších dat, jakou má aplikace.

   ── Přihlášení ───────────────────────────────────────────────────────
   Berou se z proměnných prostředí, aby se heslo nikdy neocitlo
   v repozitáři:

     SKLAD_EMAIL=...  SKLAD_HESLO=...
     SKLAD_UID=...    čí data číst; bez toho svoje

   Přihlásit se dá dvojím způsobem. Buď běžným účtem — pak skript vidí
   totéž co aplikace. Nebo účtem zřízeným jen pro čtení, který má právo
   číst cizí kóji a nesmí zapisovat; ten potřebuje SKLAD_UID, protože
   jinak by koukal do své vlastní prázdné. Které je které a co smí,
   rozhodují pravidla Firestore — návod je v nastroje/PRAVIDLA.md.

   ── Použití ──────────────────────────────────────────────────────────
     node nastroje/sklad.js kdojsem           pod kým jsem a co čtu
     node nastroje/sklad.js souhrn            přehled v řeči, ne JSON
     node nastroje/sklad.js sklad             položky na skladě
     node nastroje/sklad.js ceka              čeká na payout
     node nastroje/sklad.js prodano [rok]     prodané (volitelně jeden rok)
     node nastroje/sklad.js zakaznici         CRM — zákazníci a partneři
     node nastroje/sklad.js nastaveni         uložená nastavení aplikace
     node nastroje/sklad.js vse               všechno najednou

   Přepínače:
     --profil=podnikani|osobni|vse   výchozí je vse
     --pole=name,sku,buyPrice        jen vyjmenované sloupce
     --limit=50                      jen prvních N položek

   Metriky se tu schválně nepočítají. Aplikace umí u kurzů EUR věci,
   které by se tu musely psát podruhé a začaly by se rozcházet — tenhle
   skript proto vrací řádky tak, jak jsou uložené, a dopočítání nechává
   na tom, kdo se ptá.
══════════════════════════════════════════════════════════════════════ */

'use strict';

// Stejný projekt jako v index.html. Tyhle údaje jsou veřejné záměrně —
// nejsou to hesla, jen adresa projektu. Přístup hlídá přihlášení.
const PROJEKT = 'sklad-7eec9';
const API_KEY = 'AIzaSyDS1e4Y3LfglhKsLryxJZYqrfMSCZ9evnU';

const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY;
const FS_BASE  = 'https://firestore.googleapis.com/v1/projects/' + PROJEKT + '/databases/(default)/documents';

/* ── Firestore posílá hodnoty zabalené v typech ─────────────────────────
   {"stringValue":"Nike"} místo "Nike". Tohle je rozbalí zpátky. */
function rozbal(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue'      in v) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('bytesValue'     in v) return '(binární data)';
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(rozbal);
  if ('mapValue'       in v) return rozbalPole(v.mapValue.fields || {});
  return null;
}
function rozbalPole(fields) {
  const out = {};
  Object.keys(fields).forEach(function(k) { out[k] = rozbal(fields[k]); });
  return out;
}

function konec(zprava) {
  process.stderr.write(zprava + '\n');
  process.exit(1);
}

async function prihlas() {
  const email = process.env.SKLAD_EMAIL;
  const heslo = process.env.SKLAD_HESLO;
  if (!email || !heslo) {
    konec('Chybí přihlašovací údaje.\n'
      + 'Nastav proměnné prostředí SKLAD_EMAIL a SKLAD_HESLO.\n'
      + 'Návod je v nastroje/README.md.');
  }

  const odpoved = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: heslo, returnSecureToken: true }),
  });
  const telo = await odpoved.json();

  if (!odpoved.ok) {
    const kod = (telo.error && telo.error.message) || 'neznámá chyba';
    // Google vrací kódy anglicky a dost úsečně — přeložíme ty časté
    const preklad = {
      'INVALID_LOGIN_CREDENTIALS': 'Nesprávný e-mail nebo heslo.',
      'INVALID_PASSWORD': 'Nesprávné heslo.',
      'EMAIL_NOT_FOUND': 'Takový e-mail v aplikaci není.',
      'USER_DISABLED': 'Účet je zablokovaný.',
      'TOO_MANY_ATTEMPTS_TRY_LATER': 'Příliš mnoho pokusů, zkus to za chvíli.',
    };
    konec('Přihlášení selhalo: ' + (preklad[kod] || kod));
  }
  return { token: telo.idToken, uid: telo.localId };
}

async function ziskej(cesta, token, parametry) {
  const url = new URL(FS_BASE + cesta);
  Object.keys(parametry || {}).forEach(function(k) {
    const v = parametry[k];
    if (Array.isArray(v)) v.forEach(function(x) { url.searchParams.append(k, x); });
    else url.searchParams.set(k, v);
  });
  const odpoved = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (odpoved.status === 404) return null;
  if (!odpoved.ok) {
    const t = await odpoved.text();
    konec('Čtení z cloudu selhalo (' + odpoved.status + '): ' + t.slice(0, 300));
  }
  return odpoved.json();
}

/* ── Načtení celé kolekce sklad ─────────────────────────────────────────
   Dvě kola schválně. Nejdřív se zjistí, jaké dokumenty existují, ale
   stáhne se z nich jen savedAt — díky tomu se přes drát nepotáhnou fotky,
   které bývají největší a k ničemu tu nejsou. Teprve pak se jedním
   voláním vyzvednou dokumenty, které nás zajímají, takže dorazí ze
   stejného okamžiku a nemůžou se rozejít. */
async function nactiSklad(token, uid) {
  const kolekce = '/users/' + uid + '/sklad';

  let jmena = [];
  let stranka = null;
  do {
    const parametry = { pageSize: 300, 'mask.fieldPaths': 'savedAt' };
    if (stranka) parametry.pageToken = stranka;
    const seznam = await ziskej(kolekce, token, parametry);
    if (!seznam) break;
    (seznam.documents || []).forEach(function(d) { jmena.push(d.name); });
    stranka = seznam.nextPageToken;
  } while (stranka);

  // Fotky ven — každá má kolem 65 kB a pro čtení dat nemají cenu
  const chtene = jmena.filter(function(n) { return !/\/photo_[^/]*$/.test(n); });
  if (!chtene.length) return { data: null, archivy: {}, cache: null };

  const odpoved = await fetch(FS_BASE + ':batchGet', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: chtene }),
  });
  if (!odpoved.ok) {
    const t = await odpoved.text();
    konec('Čtení z cloudu selhalo (' + odpoved.status + '): ' + t.slice(0, 300));
  }
  const davka = await odpoved.json();

  let data = null; const archivy = {}; let cache = null;
  (davka || []).forEach(function(radek) {
    if (!radek.found) return;
    const id = radek.found.name.split('/').pop();
    const obsah = rozbalPole(radek.found.fields || {});
    if (id === 'data') data = obsah;
    else if (id.indexOf('sold_') === 0) archivy[id.slice(5)] = obsah.items || [];
    else if (id === 'cache') cache = obsah;
  });
  return { data: data, archivy: archivy, cache: cache };
}

async function nactiCrm(token, uid) {
  const doklad = await ziskej('/users/' + uid + '/crm/main', token);
  if (!doklad) return { customers: [], partners: [] };
  const d = rozbalPole(doklad.fields || {});
  return { customers: d.customers || [], partners: d.partners || [] };
}

/* Složí kompletní seznam z hlavního dokumentu a ročních archivů — stejně,
   jako to dělá aplikace ve `_mergeCloudItems`. Starší dokumenty mívaly
   celý seznam v poli items, novější ho mají rozdělený. */
function slozPolozky(data, archivy) {
  if (!data) return [];
  const hlavni = Array.isArray(data.itemsStock) ? data.itemsStock : [];
  const roky = Array.isArray(data.archiveYears) ? data.archiveYears : [];
  const zArchivu = roky.reduce(function(acc, r) { return acc.concat(archivy[r] || []); }, []);
  if (!hlavni.length && !zArchivu.length && Array.isArray(data.items)) return data.items;
  return hlavni.concat(zArchivu);
}

/* ── Úprava výstupu ──────────────────────────────────────────────────── */

// Položka bez pole personal je podnikání — stejná úvaha jako v aplikaci
function jeOsobni(it) { return !!(it && it.personal); }

function profilFiltr(seznam, profil) {
  if (profil === 'osobni')    return seznam.filter(jeOsobni);
  if (profil === 'podnikani') return seznam.filter(function(it) { return !jeOsobni(it); });
  return seznam;
}

// Fotka uložená přímo v položce by výstup nafoukla o megabajty
function bezFotek(it) {
  const kopie = {};
  Object.keys(it).forEach(function(k) {
    if (k === 'imgUrl' && /^data:/.test(it[k] || '')) return;
    if (k.charAt(0) === '_') return;
    kopie[k] = it[k];
  });
  if (it.imgUrl && /^data:/.test(it.imgUrl)) kopie.maFotku = 1;
  if (it.hasPhoto) kopie.maFotku = 1;
  return kopie;
}

function jenPole(it, pole) {
  if (!pole || !pole.length) return it;
  const kopie = {};
  pole.forEach(function(k) { if (it[k] !== undefined) kopie[k] = it[k]; });
  return kopie;
}

function uprav(seznam, volby) {
  let out = seznam.map(bezFotek);
  out = profilFiltr(out, volby.profil);
  if (volby.pole) out = out.map(function(it) { return jenPole(it, volby.pole); });
  if (volby.limit) out = out.slice(0, volby.limit);
  return out;
}

/* ── Souhrn v řeči ───────────────────────────────────────────────────── */
function vypisSouhrn(polozky, crm, data) {
  const naSklade = polozky.filter(function(it) { return !it.saleState || it.saleState === 'stock'; });
  const ceka     = polozky.filter(function(it) { return it.saleState === 'waiting'; });
  const prodano  = polozky.filter(function(it) { return it.saleState === 'paid'; });

  const podleRoku = {};
  prodano.forEach(function(it) {
    const r = String(it.payoutDate || it.saleDate || '').slice(0, 4) || 'bez data';
    podleRoku[r] = (podleRoku[r] || 0) + 1;
  });

  const radky = [];
  radky.push('SKLAD — stav k ' + new Date().toLocaleString('cs-CZ'));
  radky.push('');
  radky.push('  na skladě        ' + naSklade.length);
  radky.push('  čeká na payout   ' + ceka.length);
  radky.push('  prodáno          ' + prodano.length);
  radky.push('  položek celkem   ' + polozky.length);
  radky.push('');
  radky.push('  z toho osobní    ' + polozky.filter(jeOsobni).length);
  radky.push('  podnikání        ' + polozky.filter(function(it) { return !jeOsobni(it); }).length);
  radky.push('');
  radky.push('  zákazníci        ' + (crm.customers || []).length);
  radky.push('  partneři         ' + (crm.partners || []).length);
  if (Object.keys(podleRoku).length) {
    radky.push('');
    radky.push('  prodeje po letech');
    Object.keys(podleRoku).sort().forEach(function(r) {
      radky.push('    ' + r + '  ' + podleRoku[r]);
    });
  }
  if (data && data.savedAt) {
    radky.push('');
    radky.push('  naposledy uloženo ' + new Date(data.savedAt).toLocaleString('cs-CZ'));
  }
  radky.push('');
  radky.push('  (částky se tu schválně nesčítají — kurzy EUR umí správně jen aplikace,');
  radky.push('   na počítání použij `vse` a spočítej to z řádků)');
  return radky.join('\n');
}

/* ── Nastavení, která nejsou položky ani CRM ─────────────────────────── */
function nastaveniZDat(data) {
  if (!data) return {};
  const out = {};
  Object.keys(data).forEach(function(k) {
    if (k === 'items' || k === 'itemsStock') return;   // ty jsou ve výpisu položek
    out[k] = data[k];
  });
  return out;
}

/* ── Spuštění ────────────────────────────────────────────────────────── */
async function main() {
  const args = process.argv.slice(2);
  const prikaz = args.find(function(a) { return a.charAt(0) !== '-'; }) || 'souhrn';
  const rok = args.filter(function(a) { return /^\d{4}$/.test(a); })[0] || null;

  const prepinac = function(jmeno) {
    const nalez = args.find(function(a) { return a.indexOf('--' + jmeno + '=') === 0; });
    return nalez ? nalez.split('=').slice(1).join('=') : null;
  };
  const volby = {
    profil: prepinac('profil') || 'vse',
    pole: prepinac('pole') ? prepinac('pole').split(',').map(function(s) { return s.trim(); }) : null,
    limit: prepinac('limit') ? parseInt(prepinac('limit'), 10) : null,
  };

  const { token, uid } = await prihlas();

  /* Čí data se čtou. Běžně svoje, ale účet jen pro čtení má vlastní uid
     a sahá do kóje majitele — bez tohohle by koukal do své prázdné.
     Komu čtení patří, rozhodují pravidla Firestore, ne tenhle řádek. */
  const cilovyUid = process.env.SKLAD_UID || uid;

  // Vypíše, pod kým je skript přihlášený — potřeba při psaní pravidel
  if (prikaz === 'kdojsem') {
    process.stdout.write('přihlášen jako   ' + uid + '\n'
      + 'čte data účtu    ' + cilovyUid + (cilovyUid === uid ? '  (svoje)' : '  (cizí — přes SKLAD_UID)') + '\n');
    return;
  }

  const { data, archivy, cache } = await nactiSklad(token, cilovyUid);
  if (!data) konec('V cloudu nejsou žádná data — hlavní dokument chybí.');

  const polozky = slozPolozky(data, archivy);
  const vystup = function(x) { process.stdout.write(JSON.stringify(x, null, 2) + '\n'); };

  switch (prikaz) {
    case 'souhrn': {
      const crm = await nactiCrm(token, cilovyUid);
      process.stdout.write(vypisSouhrn(polozky.map(bezFotek), crm, data) + '\n');
      break;
    }
    case 'sklad':
      vystup(uprav(polozky.filter(function(it) { return !it.saleState || it.saleState === 'stock'; }), volby));
      break;
    case 'ceka':
      vystup(uprav(polozky.filter(function(it) { return it.saleState === 'waiting'; }), volby));
      break;
    case 'prodano': {
      let sada = polozky.filter(function(it) { return it.saleState === 'paid'; });
      if (rok) sada = sada.filter(function(it) {
        return String(it.payoutDate || it.saleDate || '').slice(0, 4) === rok;
      });
      vystup(uprav(sada, volby));
      break;
    }
    case 'zakaznici': {
      const crm = await nactiCrm(token, cilovyUid);
      vystup(crm);
      break;
    }
    case 'nastaveni':
      vystup(nastaveniZDat(data));
      break;
    case 'cache':
      vystup(cache || {});
      break;
    case 'vse': {
      const crm = await nactiCrm(token, cilovyUid);
      vystup({
        aplikace: 'SKLAD',
        nacteno: new Date().toISOString(),
        savedAt: data.savedAt || null,
        profil: volby.profil,
        poznamka: 'Ceny jsou v Kč, pokud u položky není uvedená měna. Fotky vynechané '
          + '(maFotku: 1 znamená, že položka fotku má). Metriky si dopočítej z pole polozky.',
        polozky: uprav(polozky, volby),
        zakaznici: crm.customers || [],
        partneri: crm.partners || [],
        nastaveni: nastaveniZDat(data),
      });
      break;
    }
    default:
      konec('Neznámý příkaz "' + prikaz + '".\n'
        + 'Použij: souhrn | sklad | ceka | prodano [rok] | zakaznici | nastaveni | cache | vse');
  }
}

// Při spuštění z příkazové řádky se běží, při require se jen vydají funkce
// dovnitř — testy tak můžou zkoušet rozbalování a skládání dat bez sítě.
if (require.main === module) {
  main().catch(function(e) { konec('Chyba: ' + (e && e.message ? e.message : e)); });
} else {
  module.exports = {
    rozbal: rozbal, rozbalPole: rozbalPole, slozPolozky: slozPolozky,
    bezFotek: bezFotek, uprav: uprav, jeOsobni: jeOsobni,
    nastaveniZDat: nastaveniZDat, vypisSouhrn: vypisSouhrn,
    // Stahovací část — testy jí podstrčí vlastní fetch
    nactiSklad: nactiSklad, nactiCrm: nactiCrm, prihlas: prihlas,
  };
}
