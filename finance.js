/* ══════════════════════════════════════════════════════════════════════
   FINANCE — DAŇOVÁ EVIDENCE (majitel, 11. 11. 2026; doladěno 13. 11.)

   Druhé pracovní prostředí vedle skladu: přepínač Sklad | Finance
   v hlavičce. Tabulka transakcí z výpisů Air Bank a Revolut Pro, ke
   každé odkaz na doklad (OneDrive, jako invoiceUrl u položek), kategorie
   a poznámka. Účetní pak nemusí luštit PDF výpisy a hledat faktury.

   Světlý vzhled je záměr (majitel, 13. 11. 2026): podle barev má být
   hned poznat, že jsem ve Financích a ne ve skladu. Písma a tvary jsou
   stejné, mění se jen proměnné barev — a jen na hlavičce, #financeApp
   a oknech Financí (.fin-mo). Okna skladu (Nastavení…) zůstávají tmavá.

   Schválně v samostatném souboru a ve vlastní kolekci cloudu
   (users/{uid}/finance) — chyba tady nesmí sáhnout na sklad, ani
   obráceně. DO SKLADU SE ODSUD NEZAPISUJE NIC: párování se skladem si
   pamatuje transakce (pole `sklad` s id položek), položka o něm neví.
   Každá transakce je vlastní dokument t_<banka>_<otisk>: import stejného
   výpisu podruhé nic nezdvojí (stejný otisk = stejný dokument) a úprava
   jedné transakce nepřepisuje ostatní.

   Import bere CSV z banky. Sloupce se poznají podle názvu
   (FIN_SLOUPCE), ne podle pořadí — Air Bank i Revolut je čas od času
   přeskládají. Když se datum nebo částka nenajdou, nic se neuloží
   a řekne se to.

   Účetní Finance vidí, ale jen čte (pravidla Firestore mu zápis do
   kolekce finance nedovolí a tlačítka tu pro něj nejsou). Zaúčtováno si
   odškrtává do VLASTNÍ složky — stejný dokument jako okno Účetnictví
   (klíč `f:<id transakce>`), viz ZAÚČTOVÁNO v index.html.
══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var BANKY = { airbank: 'Air Bank', revolut: 'Revolut' };
  var MESICE = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
  // Nabídka pro první zařazení; další kategorie si majitel napíše sám a pamatují se
  var KATEGORIE = ['Nákup zboží', 'Prodej', 'Poštovné', 'Poplatky', 'Převod mezi účty', 'Daně a pojištění', 'Ostatní'];
  var DEN = 864e5;

  var st = {
    tx: {},              // id → transakce
    nacteno: false,
    chyba: null,
    unsub: null,
    pohled: 'pohyby',    // pohyby | prehled (rok po měsících)
    zalozka: 'vse',      // airbank | revolut | vse
    rok: null, mesic: null,   // mesic 0–11, null = celý rok
    filtr: 'vse',        // vse | prijmy | vydaje | bezdokladu | nezauc
    hledat: '',
    otevrena: null,
    vyberRezim: false, vyber: {},
    importData: null
  };
  var _aktivni = false;
  var _seznam = [];      // naposledy vykreslené pohyby (listování detailem, export)

  /* ── Pomocné ── */
  function esc(s) { return typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
  function bezDiakritiky(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function mena(m) { return m === 'CZK' || !m ? 'Kč' : m === 'EUR' ? '€' : m; }
  function cisloText(n) { return Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function castkaText(n, m) { return (n < 0 ? '−' : '+') + cisloText(n) + ' ' + mena(m); }
  function datumText(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? (+p[2]) + '. ' + (+p[1]) + '. ' + p[0] : iso || ''; }
  function jeOdkaz(u) { return /^https?:\/\/\S+$/i.test(String(u || '').trim()); }
  function uid() { return typeof _datovyUid === 'function' ? _datovyUid() : null; }
  function uct() { return typeof jeUctetni === 'function' && jeUctetni(); }
  function pocet(n, jedna, dve, pet) { return n + ' ' + (n === 1 ? jedna : n > 1 && n < 5 ? dve : pet); }
  function vsechny() { return Object.keys(st.tx).map(function (k) { return st.tx[k]; }); }

  /* ── Cloud ── */
  function finSpust() {
    finZastav(true);
    var fns = window._fbFns, u = uid();
    if (!fns || !window._fbDb || !u) { aktualizujPrepinac(); return; }
    try {
      st.unsub = fns.onSnapshot(fns.collection(window._fbDb, 'users', u, 'finance'), function (snap) {
        var tx = {};
        snap.forEach(function (d) { if (/^t_/.test(d.id)) { var x = d.data() || {}; x.id = d.id; tx[d.id] = x; } });
        st.tx = tx; st.nacteno = true; st.chyba = null;
        if (_aktivni) vykresli();
      }, function (e) {
        console.warn('finance:', e);
        st.chyba = (e && e.code) || 'chyba';
        if (_aktivni) vykresli();
      });
    } catch (e) { console.warn('finance:', e); }
    aktualizujPrepinac();
    // Kdo ve Financích skončil, po obnovení stránky se do nich vrátí
    try { if (!_aktivni && localStorage.getItem('sklad_prostredi_v1') === 'finance') prepniProstredi('finance'); } catch (e) {}
    if (_aktivni) vykresli();
  }
  // nechat = jen přepojení posluchače (účetní se přepíná na data majitele), prostředí zůstává
  function finZastav(nechat) {
    if (st.unsub) { try { st.unsub(); } catch (e) {} st.unsub = null; }
    st.tx = {}; st.nacteno = false; st.chyba = null; st.vyber = {}; st.vyberRezim = false;
    if (nechat === true) return;
    if (_aktivni) prepniProstredi('sklad', true);
    ['moFinDetail', 'moFinImport', 'moFinParovani'].forEach(function (id) { var m = document.getElementById(id); if (m) m.classList.remove('open'); });
    aktualizujPrepinac();
  }
  function cloud() {
    var fns = window._fbFns, u = uid();
    if (uct()) return null;
    if (!fns || !window._fbDb || !u) { toast('Finance jdou jen přes cloud — přihlas se.', 'err'); return null; }
    return { fns: fns, doc: function (id) { return fns.doc(window._fbDb, 'users', u, 'finance', id); } };
  }
  function zapis(id, data) {
    var c = cloud(); if (!c) return Promise.reject(new Error('bez cloudu'));
    return c.fns.setDoc(c.doc(id), data, { merge: true }).catch(chybaZapisu);
  }
  // Víc transakcí naráz: [{id, data}] — po dávkách, Firestore bere nejvýš 500 zápisů
  function zapisVic(zmeny, smazat) {
    var c = cloud(); if (!c) return Promise.reject(new Error('bez cloudu'));
    var davky = [];
    for (var i = 0; i < zmeny.length; i += 400) davky.push(zmeny.slice(i, i + 400));
    return Promise.all(davky.map(function (d) {
      var b = c.fns.writeBatch(window._fbDb);
      d.forEach(function (z) { if (smazat) b.delete(c.doc(z.id)); else if (z.cele) b.set(c.doc(z.id), z.data); else b.set(c.doc(z.id), z.data, { merge: true }); });
      return b.commit();
    })).catch(chybaZapisu);
  }
  function chybaZapisu(e) {
    console.warn('finance zápis:', e);
    toast(e && e.code === 'permission-denied'
      ? 'Cloud zápis odmítl — v konzoli Firebase chybí pravidla pro Finance (firestore.rules).'
      : 'Uložit se nepovedlo. Zkus to znovu.', 'err');
    throw e;
  }

  /* ── Přepínač Sklad | Finance ── */
  function aktualizujPrepinac() {
    var p = document.getElementById('prostrediSwitch');
    if (p) p.style.display = window._fbUser ? '' : 'none';
  }
  function prepniProstredi(kam, nepamatovat) {
    var fin = kam === 'finance' && !!window._fbUser;
    _aktivni = fin;
    document.body.classList.toggle('prostredi-finance', fin);
    document.querySelectorAll('#prostrediSwitch .ps-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-kam') === (fin ? 'finance' : 'sklad')); });
    var app = document.getElementById('financeApp');
    if (fin) {
      if (!app) { app = document.createElement('div'); app.id = 'financeApp'; var main = document.querySelector('.main'); main.parentNode.insertBefore(app, main); }
      if (st.rok == null) {
        var d = new Date();
        // Účetní zpracovává vždycky minulý měsíc (jako v Prodáno)
        if (uct()) d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        st.rok = d.getFullYear(); st.mesic = d.getMonth();
      }
      if (uct() && typeof _ucZaucNacti === 'function') _ucZaucNacti(function () { if (_aktivni) vykresli(); });
      vykresli();
    } else {
      st.vyberRezim = false; st.vyber = {};
      var hb = document.getElementById('finHrom'); if (hb) hb.remove();
    }
    if (!nepamatovat) { try { localStorage.setItem('sklad_prostredi_v1', fin ? 'finance' : 'sklad'); } catch (e) {} }
  }

  /* ── Sklad: čtení položek pro párování (nikdy zápis) ── */
  function polozky() { try { return (typeof items !== 'undefined' && Array.isArray(items)) ? items : []; } catch (e) { return []; } }
  function osobni(it) { try { return typeof isPersonal === 'function' && isPersonal(it); } catch (e) { return false; } }
  function d10(v) { return typeof _ucDatum === 'function' ? _ucDatum(v) : String(v || '').slice(0, 10); }
  function dnu(a, b) { var x = Date.parse(a), y = Date.parse(b); return isNaN(x) || isNaN(y) ? 9999 : Math.round((x - y) / DEN); }
  function klic(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function polozka(id) { var p = polozky(); for (var i = 0; i < p.length; i++) if (p[i] && p[i].id === id) return p[i]; return null; }
  function nazevKusu(it) { return (it.name || 'Položka') + (it.size ? ' · ' + it.size : ''); }
  // Totéž co stejnyNakup() ve skladu, jen jako klíč: objednávka, FP nebo kupní smlouva
  function klicNakupu(it) {
    if (klic(it.orderNum) && klic(it.buyWhere)) return 'o:' + klic(it.buyWhere) + '|' + klic(it.orderNum);
    if (it.dokladTyp === 'fp' && klic(it.fpCislo)) return 'fp:' + klic(it.fpCislo);
    if (it.dokladTyp === 'ks' && klic(it.dokladCislo)) return 'ks:' + klic(it.dokladCislo);
    return '';
  }
  function cisloNakupu(it) { return it.dokladTyp === 'fp' && it.fpCislo ? it.fpCislo : it.dokladTyp === 'ks' && it.dokladCislo ? it.dokladCislo : (it.orderNum || ''); }

  /* Kandidáti ze skladu: nákupy (kus i celá objednávka) a prodeje (kus
     i celý payout jednoho místa a dne). Staví se jednou na vykreslení. */
  var _kand = null;
  function kandidati() {
    if (_kand) return _kand;
    var nak = [], pro = [], skup = {}, vyp = {};
    polozky().forEach(function (it) {
      if (!it || !it.id || osobni(it)) return;
      if (it.type !== 'bulk' && it.buyPrice > 0) {
        var c = { typ: 'nakup', ids: [it.id], mena: it.buyCurrency === 'EUR' ? 'EUR' : 'CZK', castka: it.buyPrice * (it.qty || 1), datum: d10(it.buyDate),
          popis: nazevKusu(it), kde: it.buyWhere || it.from || '', cislo: cisloNakupu(it), hledat: bezDiakritiky([it.name, it.sku, it.size, it.buyWhere, it.from, it.orderNum, it.fpCislo, it.dokladCislo].join(' ')) };
        nak.push(c);
        var k = klicNakupu(it); if (k) (skup[k] = skup[k] || []).push(c);
      }
      if (!it.bulkId && (it.saleState === 'paid' || it.saleState === 'waiting') && it.sellPrice > 0) {
        var eur = it.sellCurrency === 'EUR';
        var p = { typ: 'prodej', ids: [it.id], mena: eur ? 'EUR' : 'CZK', castka: eur && typeof getSellOrig === 'function' ? getSellOrig(it) : it.sellPrice,
          datum: d10(it.payoutDate || it.saleDate), vyplaceno: !!it.payoutDate, popis: nazevKusu(it), kde: it.soldWhere || '', cislo: it.saleNum || it.saleNumber || '',
          hledat: bezDiakritiky([it.name, it.sku, it.size, it.soldWhere, it.saleNum, it.saleNumber, it.orderNum].join(' ')) };
        pro.push(p);
        if (it.payoutDate && it.soldWhere) { var v = klic(it.soldWhere) + '|' + p.datum + '|' + p.mena; (vyp[v] = vyp[v] || []).push(p); }
      }
    });
    var slouc = function (mapa, typ, cil, jak) {
      Object.keys(mapa).forEach(function (k) {
        var g = mapa[k]; if (g.length < 2) return;
        if (g.some(function (x) { return x.mena !== g[0].mena; })) return;
        cil.push({ typ: typ, ids: [].concat.apply([], g.map(function (x) { return x.ids; })), mena: g[0].mena,
          castka: Math.round(g.reduce(function (a, x) { return a + x.castka; }, 0) * 100) / 100,
          datum: g.map(function (x) { return x.datum; }).sort()[0], vyplaceno: g[0].vyplaceno,
          popis: jak(g), kde: g[0].kde, cislo: g[0].cislo, skupina: true, hledat: g.map(function (x) { return x.hledat; }).join(' ') });
      });
    };
    slouc(skup, 'nakup', nak, function (g) { return 'Celý nákup · ' + pocet(g.length, 'kus', 'kusy', 'kusů') + ' · ' + g[0].popis + ' …'; });
    slouc(vyp, 'prodej', pro, function (g) { return 'Payout ' + (g[0].kde || '') + ' · ' + pocet(g.length, 'prodej', 'prodeje', 'prodejů'); });
    // Co už je spárované s jinou transakcí, se znovu nenabízí
    var pouzite = {};
    vsechny().forEach(function (t) { (t.sklad || []).forEach(function (id) { pouzite[(t.skladTyp || '') + ':' + id] = t.id; }); });
    _kand = { nakup: nak, prodej: pro, pouzite: pouzite };
    return _kand;
  }
  /* Návrhy ke transakci. Sedět musí měna a částka (na korunu / pět centů)
     a datum poblíž; číslo objednávky ve zprávě je jistota i bez data.
     Radši nenavrhnout než navrhnout špatně — špatný pár by účetnímu
     podstrčil cizí doklad. */
  function navrhy(t, dotaz) {
    if (!t || !t.castka) return [];
    var typ = t.castka < 0 ? 'nakup' : 'prodej', K = kandidati(), abs = Math.abs(t.castka);
    var tol = (t.mena || 'CZK') === 'CZK' ? 1 : 0.05;
    var text = bezDiakritiky([t.zprava, t.vs, t.protistrana, t.poznamka].join(' '));
    var q = bezDiakritiky(dotaz);
    var out = [];
    K[typ].forEach(function (c) {
      if (c.ids.some(function (id) { var kdo = K.pouzite[typ + ':' + id]; return kdo && kdo !== t.id; })) return;
      var dd = Math.abs(dnu(t.datum, c.datum));
      if (q) {
        if (q.split(/\s+/).every(function (s) { return c.hledat.indexOf(s) !== -1; })) out.push({ c: c, dny: dd, skore: (c.mena === (t.mena || 'CZK') && Math.abs(c.castka - abs) <= tol ? 0 : 50) + Math.min(dd, 40), rucne: true });
        return;
      }
      if (c.mena !== (t.mena || 'CZK') || Math.abs(c.castka - abs) > tol) return;
      var cis = klic(c.cislo), maCislo = cis.length >= 5 && text.indexOf(bezDiakritiky(cis)) !== -1;
      var okno = typ === 'nakup' ? 14 : (c.vyplaceno ? 10 : 30);
      if (!maCislo && dd > okno) return;
      out.push({ c: c, dny: dd, cislo: maCislo, skore: (maCislo ? -100 : 0) + dd + (c.skupina ? -0.5 : 0) });
    });
    out.sort(function (a, b) { return a.skore - b.skore; });
    return out.slice(0, q ? 12 : 6);
  }
  // Jistý návrh: jediný kandidát a je blízko (nebo sedí číslo objednávky)
  function jistyNavrh(t) {
    if ((t.sklad && t.sklad.length) || t.bezDokladu) return null;
    var n = navrhy(t);
    if (!n.length) return null;
    if (n[0].cislo && (n.length === 1 || !n[1].cislo)) return n[0];
    return n.length === 1 && n[0].dny <= 5 ? n[0] : null;
  }

  /* ── Doklad k transakci ──
     Vlastní odkaz, nebo doklad převzatý ze spárované položky skladu
     (nákupní faktura, u prodeje faktura nebo prodejní doklad z řady). */
  var _cisla = null;
  function cislaDokladu() { if (!_cisla) { try { _cisla = typeof _cislaDokladu === 'function' ? _cislaDokladu() : {}; } catch (e) { _cisla = {}; } } return _cisla; }
  function dokladStav(t) {
    if (jeOdkaz(t.dokladUrl)) return { stav: 'ok', url: t.dokladUrl, popis: 'Otevřít doklad' };
    var ids = t.sklad || [];
    for (var i = 0; i < ids.length; i++) {
      var it = polozka(ids[i]); if (!it) continue;
      if (t.skladTyp === 'prodej') {
        if (jeOdkaz(it.saleInvoiceUrl)) return { stav: 'ok', url: it.saleInvoiceUrl, popis: 'Faktura ze skladu', zeSkladu: true };
        var c = cislaDokladu()[it.id];
        if (c) return { stav: 'ok', doklad: it.id, popis: 'Prodejní doklad ' + c, zeSkladu: true };
      } else if (jeOdkaz(it.invoiceUrl)) return { stav: 'ok', url: it.invoiceUrl, popis: 'Doklad ze skladu', zeSkladu: true };
    }
    if (t.bezDokladu) return { stav: 'nic', popis: 'Doklad není potřeba' };
    return { stav: 'chybi', popis: 'Chybí doklad' };
  }
  function finChybiDoklad(t) { return dokladStav(t).stav === 'chybi'; }

  /* ── Zaúčtováno (jen účetní, jeho vlastní složka) ── */
  function otiskTx(t) { return [t.datum, t.mena || 'CZK', t.castka].join('|'); }
  function zaucStav(t) {
    var z = window._ucZauc && window._ucZauc['f:' + t.id];
    return !z ? '' : z.o === otiskTx(t) ? 'ok' : 'zmena';
  }
  window.finZauctuj = function (id, ano) {
    var t = st.tx[id];
    if (!uct() || !window._ucZauc || !t) return;
    if (ano) window._ucZauc['f:' + id] = { t: Date.now(), o: otiskTx(t) }; else delete window._ucZauc['f:' + id];
    if (typeof _ucZaucUloz === 'function') _ucZaucUloz();
    vykresli();
  };

  /* ── Kategorie podle protistrany ── */
  function klicProtistrany(t) { return bezDiakritiky(t.protistrana).replace(/\s+/g, ' '); }
  // Naposledy ručně zařazený pohyb téže protistrany; bez dokladu jen když to tak mají všechny
  function pravidlo(t, zdroj) {
    var k = klicProtistrany(t); if (!k) return null;
    var stejne = (zdroj || vsechny()).filter(function (x) { return x.id !== t.id && x.kategorie && klicProtistrany(x) === k; });
    if (!stejne.length) return null;
    stejne.sort(function (a, b) { return (b.upraveno || 0) - (a.upraveno || 0); });
    return { kategorie: stejne[0].kategorie, bezDokladu: stejne.every(function (x) { return x.bezDokladu && !x.dokladUrl; }) };
  }
  function seznamKategorii() {
    var m = {}; vsechny().forEach(function (t) { if (t.kategorie) m[t.kategorie] = (m[t.kategorie] || 0) + 1; });
    var vlastni = Object.keys(m).sort(function (a, b) { return m[b] - m[a] || a.localeCompare(b, 'cs'); });
    return vlastni.concat(KATEGORIE.filter(function (k) { return !m[k]; }));
  }

  /* ── Výběr a souhrn ── */
  function vObdobi(t, mesic) {
    var d = String(t.datum || '');
    if (st.zalozka !== 'vse' && t.banka !== st.zalozka) return false;
    if (st.rok != null && d.slice(0, 4) !== String(st.rok)) return false;
    if (mesic != null && +d.slice(5, 7) !== mesic + 1) return false;
    return true;
  }
  function vyber() {
    var q = bezDiakritiky(st.hledat);
    return vsechny().filter(function (t) {
      if (!vObdobi(t, st.mesic)) return false;
      if (st.filtr === 'prijmy' && !(t.castka > 0)) return false;
      if (st.filtr === 'vydaje' && !(t.castka < 0)) return false;
      if (st.filtr === 'bezdokladu' && !finChybiDoklad(t)) return false;
      if (st.filtr === 'nezauc' && zaucStav(t) === 'ok') return false;
      if (q && bezDiakritiky([t.protistrana, t.zprava, t.vs, t.kategorie, t.poznamka, t.ucet, cisloText(t.castka)].join(' ')).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.datum).localeCompare(String(a.datum)) || (b.poradi || 0) - (a.poradi || 0); });
  }
  function souhrn(seznam) {
    var m = {};
    seznam.forEach(function (t) {
      var k = t.mena || 'CZK'; m[k] = m[k] || { prijmy: 0, vydaje: 0, n: 0 };
      m[k].n++;
      if (t.castka > 0) m[k].prijmy += t.castka; else m[k].vydaje += t.castka;
    });
    return m;
  }
  function obdobiText() { return st.mesic == null ? 'Celý rok ' + st.rok : MESICE[st.mesic] + ' ' + st.rok; }

  /* ── Vykreslení ── */
  function vykresli() {
    var app = document.getElementById('financeApp'); if (!app) return;
    _kand = null; _cisla = null;
    var y = app.scrollTop, U = uct();
    var seznam = _seznam = vyber();
    var h = '<div class="fin-lista">'
      + '<div class="fin-zal">' + ['vse', 'airbank', 'revolut'].map(function (k) {
          var n = vsechny().filter(function (t) { return k === 'vse' || t.banka === k; }).length;
          return '<button class="fin-zal-btn' + (st.zalozka === k ? ' akt' : '') + '" data-zal="' + k + '" onclick="finZalozka(\'' + k + '\')">' + (k === 'vse' ? 'Dohromady' : BANKY[k]) + ' <span>' + n + '</span></button>';
        }).join('') + '</div>'
      + '<div class="fin-obdobi"><button class="fin-sip" onclick="finPosun(-1)" aria-label="Předchozí">‹</button>'
      + '<span class="fin-obd-text" id="finObdobi">' + (st.pohled === 'prehled' ? 'Rok ' + st.rok : obdobiText()) + '</span>'
      + '<button class="fin-sip" onclick="finPosun(1)" aria-label="Další">›</button>'
      + (st.pohled === 'pohyby' ? '<button class="fin-mini' + (st.mesic == null ? ' akt' : '') + '" onclick="finCelyRok()">Celý rok</button>' : '') + '</div>'
      + '<div class="fin-zal fin-pohledy">'
      + '<button class="fin-zal-btn' + (st.pohled === 'pohyby' ? ' akt' : '') + '" data-pohled="pohyby" onclick="finPohled(\'pohyby\')">Pohyby</button>'
      + '<button class="fin-zal-btn' + (st.pohled === 'prehled' ? ' akt' : '') + '" data-pohled="prehled" onclick="finPohled(\'prehled\')">Přehled roku</button></div>'
      + '<div class="fin-akce">'
      + (seznam.length && st.pohled === 'pohyby' ? '<button class="fin-mini" id="finExport" onclick="finExport()" data-tip="Stáhne pohyby, které jsou vidět, jako CSV pro Excel">Export CSV</button>' : '')
      + (U ? '' : '<button class="add-btn fin-import-btn" onclick="finOtevriImport()">Importovat výpis</button>')
      + '</div></div>';
    if (st.chyba) {
      h += '<div class="fin-prazdne">' + (st.chyba === 'permission-denied'
        ? 'Cloud Finance odmítl. V konzoli Firebase je potřeba publikovat nová pravidla (firestore.rules, blok finance).'
        : 'Finance se nenačetly (' + esc(st.chyba) + ').') + '</div>';
    } else if (!st.nacteno) {
      h += '<div class="fin-prazdne">Načítám transakce…</div>';
    } else if (!Object.keys(st.tx).length) {
      h += '<div class="fin-prazdne">' + (U ? '<b>Zatím tu nic není.</b><br>Majitel ještě nenahrál žádný výpis z banky.'
        : '<b>Zatím tu nic není.</b><br>Stáhni si v Air Bank nebo v Revolutu výpis jako CSV a nahraj ho tlačítkem <b>Importovat výpis</b>. Každý pohyb se zapíše jednou — stejný výpis nahraný podruhé nic nezdvojí.') + '</div>';
    } else if (st.pohled === 'prehled') {
      h += prehledHtml();
    } else {
      h += pohybyHtml(seznam, U);
    }
    var foc = document.activeElement && document.activeElement.id === 'finHledat', sel = foc ? document.activeElement.selectionStart : 0;
    app.innerHTML = h;
    app.scrollTop = y;
    if (foc) { var i = document.getElementById('finHledat'); if (i) { i.focus(); try { i.setSelectionRange(sel, sel); } catch (e) {} } }
    vykresliHromadne();
  }

  function pohybyHtml(seznam, U) {
    var s = souhrn(seznam), bez = seznam.filter(finChybiDoklad).length;
    var jiste = U ? [] : seznam.filter(function (t) { return !!jistyNavrh(t); });
    var nezauc = U ? seznam.filter(function (t) { return zaucStav(t) !== 'ok'; }).length : 0;
    var h = '<div class="fin-dlazdice">' + (Object.keys(s).length ? Object.keys(s).sort().map(function (m) {
          return '<div class="fin-dl"><div class="fin-dl-l">Příjmy ' + esc(m) + '</div><div class="fin-dl-v plus">' + castkaText(s[m].prijmy, m) + '</div></div>'
            + '<div class="fin-dl"><div class="fin-dl-l">Výdaje ' + esc(m) + '</div><div class="fin-dl-v minus">' + castkaText(s[m].vydaje, m) + '</div></div>'
            + '<div class="fin-dl"><div class="fin-dl-l">Saldo ' + esc(m) + '</div><div class="fin-dl-v">' + castkaText(s[m].prijmy + s[m].vydaje, m) + '</div></div>';
        }).join('') : '<div class="fin-dl"><div class="fin-dl-l">Pohyby</div><div class="fin-dl-v">0</div></div>')
      + '<button class="fin-dl fin-dl-bez' + (bez ? ' svit' : '') + (st.filtr === 'bezdokladu' ? ' akt' : '') + '" onclick="finFiltr(\'bezdokladu\')"><div class="fin-dl-l">Bez dokladu</div><div class="fin-dl-v">' + bez + '</div></button>'
      + (U ? '<button class="fin-dl fin-dl-zauc' + (st.filtr === 'nezauc' ? ' akt' : '') + '" onclick="finFiltr(\'nezauc\')"><div class="fin-dl-l">Nezaúčtováno</div><div class="fin-dl-v">' + nezauc + '</div></button>' : '')
      + '</div>';
    var filtry = ['vse', 'prijmy', 'vydaje', 'bezdokladu'].concat(U ? ['nezauc'] : []);
    h += '<div class="fin-filtry"><input id="finHledat" class="fin-inp" placeholder="Protistrana, zpráva, VS, kategorie, částka…" value="' + esc(st.hledat) + '" oninput="finHledej(this.value)">'
      + filtry.map(function (k) {
          return '<button class="fin-chip' + (st.filtr === k ? ' akt' : '') + '" data-filtr="' + k + '" onclick="finFiltr(\'' + k + '\')">' + { vse: 'Vše', prijmy: 'Příjmy', vydaje: 'Výdaje', bezdokladu: 'Bez dokladu', nezauc: 'Nezaúčtované' }[k] + '</button>';
        }).join('')
      + (jiste.length ? '<button class="fin-chip fin-chip-par" id="finParovat" onclick="finOtevriParovani()" data-tip="Pohyby, ke kterým ve skladu sedí právě jeden nákup nebo prodej">Spárovat se skladem · ' + jiste.length + '</button>' : '')
      + (U ? '' : '<button class="fin-chip' + (st.vyberRezim ? ' akt' : '') + '" id="finVybrat" onclick="finVyberRezim()">Vybrat</button>')
      + '<span class="fin-pocet">' + pocet(seznam.length, 'pohyb', 'pohyby', 'pohybů') + '</span></div>';
    if (!seznam.length) return h + '<div class="fin-prazdne">V tomhle období a filtru nic není.</div>';
    var vsechnyVybrane = seznam.every(function (t) { return st.vyber[t.id]; });
    h += '<div class="fin-tab-obal"><table class="fin-tab' + (st.vyberRezim ? ' vybira' : '') + '"><thead><tr>'
      + (st.vyberRezim ? '<th class="fin-cb"><input type="checkbox" id="finVyberVse"' + (vsechnyVybrane ? ' checked' : '') + ' onclick="finVyberVse(this.checked)" aria-label="Vybrat vše"></th>' : '')
      + (U ? '<th class="fin-cb" data-tip="Zaúčtováno">Zaúčt.</th>' : '')
      + '<th>Datum</th>' + (st.zalozka === 'vse' ? '<th>Banka</th>' : '')
      + '<th>Protistrana</th><th>Zpráva / VS</th><th>Kategorie</th><th>Sklad</th><th class="r">Částka</th><th class="c">Doklad</th></tr></thead><tbody>'
      + seznam.map(function (t) { return radekHtml(t, U); }).join('') + '</tbody></table></div>';
    return h;
  }
  function dokladZnak(t) {
    var d = dokladStav(t);
    if (d.stav === 'ok' && d.url) return '<a class="fin-dok ok faktura-link' + (d.zeSkladu ? ' ze-skladu' : '') + '" href="' + esc(d.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" data-tip="' + esc(d.popis) + '">✓</a>';
    if (d.stav === 'ok') return '<button class="fin-dok ok ze-skladu" onclick="event.stopPropagation();finOtevriDoklad(\'' + esc(d.doklad) + '\')" data-tip="' + esc(d.popis) + '">✓</button>';
    if (d.stav === 'nic') return '<span class="fin-dok nic" data-tip="Doklad není potřeba">—</span>';
    return '<span class="fin-dok chybi" data-tip="Chybí doklad">!</span>';
  }
  function skladZnak(t, U) {
    var ids = t.sklad || [];
    if (ids.length) {
      var it = polozka(ids[0]);
      return '<span class="fin-sklad ma" data-tip="' + esc(t.skladTyp === 'prodej' ? 'Spárováno s prodejem' : 'Spárováno s nákupem') + '">'
        + esc(it ? (it.name || 'Položka') : 'Položka už ve skladu není') + (ids.length > 1 ? ' +' + (ids.length - 1) : '') + '</span>';
    }
    if (U) return '';
    var n = jistyNavrh(t);
    return n ? '<span class="fin-sklad navrh" data-tip="Ve skladu tomu odpovídá: ' + esc(n.c.popis) + '">návrh</span>' : '';
  }
  function radekHtml(t, U) {
    var z = U ? zaucStav(t) : '';
    return '<tr data-tx="' + esc(t.id) + '"' + (st.vyber[t.id] ? ' class="vybrano"' : '') + ' onclick="finRadek(\'' + esc(t.id) + '\')">'
      + (st.vyberRezim ? '<td class="fin-cb"><input type="checkbox"' + (st.vyber[t.id] ? ' checked' : '') + ' tabindex="-1" aria-label="Vybrat"></td>' : '')
      + (U ? '<td class="fin-cb"><input type="checkbox" class="fin-zauc' + (z === 'zmena' ? ' zmena' : '') + '"' + (z === 'ok' ? ' checked' : '')
          + ' onclick="event.stopPropagation();finZauctuj(\'' + esc(t.id) + '\', this.checked)" aria-label="Zaúčtováno"' + (z === 'zmena' ? ' data-tip="Od zaúčtování se pohyb změnil"' : '') + '></td>' : '')
      + '<td class="fin-d">' + esc(datumText(t.datum)) + '</td>'
      + (st.zalozka === 'vse' ? '<td class="fin-b"><span class="fin-banka b-' + esc(t.banka) + '">' + esc(BANKY[t.banka] || t.banka) + '</span></td>' : '')
      + '<td class="fin-pr">' + esc(t.protistrana || '—') + (t.ucet ? '<span class="fin-ucet">' + esc(t.ucet) + '</span>' : '') + '</td>'
      + '<td class="fin-zp">' + esc(t.zprava || '') + (t.vs ? '<span class="fin-vs">VS ' + esc(t.vs) + '</span>' : '')
        + (t.poznamka ? '<span class="fin-pozn">' + esc(t.poznamka) + '</span>' : '') + '</td>'
      + '<td class="fin-k">' + (t.kategorie ? '<span class="fin-kat">' + esc(t.kategorie) + '</span>' : '') + '</td>'
      + '<td class="fin-s">' + skladZnak(t, U) + '</td>'
      + '<td class="r fin-c ' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</td>'
      + '<td class="c fin-dk">' + dokladZnak(t) + '</td></tr>';
  }

  /* ── Přehled roku: měsíce a kategorie ── */
  function prehledHtml() {
    var rok = vsechny().filter(function (t) { return vObdobi(t, null); });
    if (!rok.length) return '<div class="fin-prazdne">V roce ' + st.rok + ' tu nejsou žádné pohyby.</div>';
    var meny = Object.keys(souhrn(rok)).sort();
    var max = 0, mes = [];
    for (var m = 0; m < 12; m++) {
      var s = rok.filter(function (t) { return +String(t.datum).slice(5, 7) === m + 1; });
      var so = souhrn(s);
      meny.forEach(function (k) { if (so[k]) max = Math.max(max, so[k].prijmy, -so[k].vydaje); });
      mes.push({ m: m, n: s.length, s: so, bez: s.filter(finChybiDoklad).length });
    }
    var bunka = function (so, k) {
      if (!so[k]) return '<td class="r fin-nic">—</td><td class="r fin-nic">—</td><td class="r fin-nic">—</td>';
      var p = so[k].prijmy, v = so[k].vydaje;
      return '<td class="r plus">' + cisloText(p) + '<i class="fin-pruh" style="width:' + (max ? Math.round(p / max * 100) : 0) + '%"></i></td>'
        + '<td class="r minus">' + cisloText(v) + '<i class="fin-pruh vyd" style="width:' + (max ? Math.round(-v / max * 100) : 0) + '%"></i></td>'
        + '<td class="r fin-saldo">' + castkaText(p + v, k) + '</td>';
    };
    var celkem = souhrn(rok);
    var h = '<div class="fin-nadpis">Po měsících</div><div class="fin-tab-obal"><table class="fin-tab fin-rok"><thead><tr><th>Měsíc</th><th class="r">Pohybů</th>'
      + meny.map(function (k) { return '<th class="r">Příjmy ' + esc(k) + '</th><th class="r">Výdaje ' + esc(k) + '</th><th class="r">Saldo ' + esc(k) + '</th>'; }).join('')
      + '<th class="r">Bez dokladu</th></tr></thead><tbody>'
      + mes.map(function (x) {
        return '<tr data-mesic="' + x.m + '"' + (x.n ? ' onclick="finMesic(' + x.m + ')"' : ' class="prazdny"') + '><td class="fin-pr">' + MESICE[x.m] + '</td><td class="r fin-d">' + (x.n || '—') + '</td>'
          + meny.map(function (k) { return bunka(x.s, k); }).join('')
          + '<td class="r">' + (x.bez ? '<span class="fin-bez-n">' + x.bez + '</span>' : (x.n ? '<span class="fin-ok-n">✓</span>' : '')) + '</td></tr>';
      }).join('')
      + '</tbody><tfoot><tr><td class="fin-pr">Celkem</td><td class="r fin-d">' + rok.length + '</td>'
      + meny.map(function (k) { return '<td class="r plus">' + cisloText(celkem[k].prijmy) + '</td><td class="r minus">' + cisloText(celkem[k].vydaje) + '</td><td class="r fin-saldo">' + castkaText(celkem[k].prijmy + celkem[k].vydaje, k) + '</td>'; }).join('')
      + '<td class="r">' + (rok.filter(finChybiDoklad).length || '') + '</td></tr></tfoot></table></div>';
    // Kategorie
    var kat = {};
    rok.forEach(function (t) {
      var k = t.kategorie || 'Nezařazeno'; kat[k] = kat[k] || { n: 0, s: {} };
      kat[k].n++; var mn = t.mena || 'CZK'; kat[k].s[mn] = (kat[k].s[mn] || 0) + t.castka;
    });
    var poradi = Object.keys(kat).sort(function (a, b) { return (a === 'Nezařazeno') - (b === 'Nezařazeno') || kat[b].n - kat[a].n; });
    h += '<div class="fin-nadpis">Podle kategorií</div><div class="fin-tab-obal"><table class="fin-tab fin-kategorie"><thead><tr><th>Kategorie</th><th class="r">Pohybů</th>'
      + meny.map(function (k) { return '<th class="r">Celkem ' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + poradi.map(function (k) {
        return '<tr data-kat="' + esc(k) + '" onclick="finKategorie(this.dataset.kat)"><td>' + (k === 'Nezařazeno' ? '<span class="fin-nic">Nezařazeno</span>' : '<span class="fin-kat">' + esc(k) + '</span>') + '</td><td class="r fin-d">' + kat[k].n + '</td>'
          + meny.map(function (mn) { var v = kat[k].s[mn]; return '<td class="r fin-c ' + (v < 0 ? 'minus' : 'plus') + '">' + (v == null ? '<span class="fin-nic">—</span>' : castkaText(v, mn)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    return h;
  }

  /* ── Ovládání ── */
  window.finZalozka = function (k) { st.zalozka = k; vykresli(); };
  window.finFiltr = function (k) { st.filtr = st.filtr === k && k !== 'vse' ? 'vse' : k; vykresli(); };
  window.finHledej = function (v) { st.hledat = v; vykresli(); };
  window.finPohled = function (p) { st.pohled = p; vykresli(); };
  window.finCelyRok = function () { st.mesic = st.mesic == null ? new Date().getMonth() : null; vykresli(); };
  window.finMesic = function (m) { st.mesic = m; st.pohled = 'pohyby'; st.filtr = 'vse'; st.hledat = ''; vykresli(); };
  window.finKategorie = function (k) { st.mesic = null; st.pohled = 'pohyby'; st.filtr = 'vse'; st.hledat = k === 'Nezařazeno' ? '' : k; vykresli(); };
  window.finPosun = function (o) {
    if (st.mesic == null || st.pohled === 'prehled') { st.rok += o; }
    else { st.mesic += o; if (st.mesic < 0) { st.mesic = 11; st.rok--; } if (st.mesic > 11) { st.mesic = 0; st.rok++; } }
    vykresli();
  };
  window.finRadek = function (id) {
    if (st.vyberRezim) { if (st.vyber[id]) delete st.vyber[id]; else st.vyber[id] = 1; vykresli(); return; }
    window.finDetail(id);
  };
  window.finOtevriDoklad = function (id) { if (typeof openSaleDocument === 'function') openSaleDocument(id); };
  window.finOtevriPolozku = function (id) {
    if (!polozka(id) || typeof openDetail !== 'function') { toast('Položka už ve skladu není.', 'err'); return; }
    cm('moFinDetail'); prepniProstredi('sklad'); openDetail(id);
  };

  /* ── Export toho, co je vidět ── */
  function csvText(seznam) {
    var radky = [['Datum', 'Banka', 'Protistrana', 'Účet protistrany', 'VS', 'Zpráva', 'Typ', 'Částka', 'Měna', 'Kategorie', 'Doklad', 'Odkaz na doklad', 'Poznámka']];
    seznam.slice().reverse().forEach(function (t) {
      var d = dokladStav(t);
      radky.push([datumText(t.datum), BANKY[t.banka] || t.banka, t.protistrana, t.ucet, t.vs, t.zprava, t.typ,
        String(t.castka).replace('.', ','), t.mena || 'CZK', t.kategorie,
        d.stav === 'ok' ? (d.url ? 'ano' : d.popis) : d.stav === 'nic' ? 'není potřeba' : 'chybí', d.url || '', t.poznamka]);
    });
    // Středník a desetinná čárka — tak to český Excel otevře rovnou do sloupců
    return '﻿' + radky.map(function (r) {
      return r.map(function (v) { v = String(v == null ? '' : v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';');
    }).join('\r\n') + '\r\n';
  }
  window.finExport = function () {
    if (!_seznam.length) return;
    var jmeno = 'finance_' + st.rok + (st.mesic == null ? '' : '-' + ('0' + (st.mesic + 1)).slice(-2)) + (st.zalozka === 'vse' ? '' : '_' + st.zalozka) + '.csv';
    var url = URL.createObjectURL(new Blob([csvText(_seznam)], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = jmeno;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    toast('Staženo ' + pocet(_seznam.length, 'pohyb', 'pohyby', 'pohybů') + ' (' + obdobiText() + ').');
  };

  /* ── Hromadné úpravy ── */
  window.finVyberRezim = function () { if (uct()) return; st.vyberRezim = !st.vyberRezim; st.vyber = {}; vykresli(); };
  window.finVyberVse = function (ano) { _seznam.forEach(function (t) { if (ano) st.vyber[t.id] = 1; else delete st.vyber[t.id]; }); vykresli(); };
  function vybrane() { return Object.keys(st.vyber).filter(function (id) { return st.tx[id]; }); }
  function vykresliHromadne() {
    var b = document.getElementById('finHrom'), ids = vybrane();
    if (!_aktivni || !st.vyberRezim || !ids.length) { if (b) b.remove(); return; }
    var hodnota = b && b.querySelector('#finHromKat') ? b.querySelector('#finHromKat').value : '';
    if (!b) { b = document.createElement('div'); b.id = 'finHrom'; b.className = 'fin-hrom'; document.body.appendChild(b); }
    b.innerHTML = '<b>' + pocet(ids.length, 'vybraný', 'vybrané', 'vybraných') + '</b>'
      + '<input id="finHromKat" class="fin-inp" list="finHromSeznam" placeholder="Kategorie…" value="' + esc(hodnota) + '" onkeydown="if(event.key===\'Enter\')finHromadne(\'kategorie\')">'
      + '<datalist id="finHromSeznam">' + seznamKategorii().map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist>'
      + '<button class="fin-mini" onclick="finHromadne(\'kategorie\')">Nastavit kategorii</button>'
      + '<button class="fin-mini" onclick="finHromadne(\'bez\')">Doklad není potřeba</button>'
      + '<button class="fin-mini" onclick="finHromadne(\'potreba\')">Doklad je potřeba</button>'
      + '<button class="fin-mini fin-nebezp" id="finHromSmazat" onclick="finHromadne(\'smazat\', this)">Smazat</button>'
      + '<button class="fin-mini" onclick="finVyberRezim()">Zrušit</button>';
  }
  window.finHromadne = function (co, btn) {
    var ids = vybrane(); if (!ids.length || uct()) return;
    if (co === 'smazat') {
      if (!btn.dataset.jiste) { btn.dataset.jiste = '1'; btn.textContent = 'Opravdu smazat ' + ids.length + '?'; return; }
      ids.forEach(function (id) { delete st.tx[id]; });
      zapisVic(ids.map(function (id) { return { id: id }; }), true).then(function () { toast('Smazáno ' + pocet(ids.length, 'pohyb', 'pohyby', 'pohybů') + '.'); }).catch(function () {});
    } else {
      var zmena = { upraveno: Date.now() };
      if (co === 'kategorie') {
        var k = (document.getElementById('finHromKat').value || '').trim().slice(0, 60);
        if (!k) { toast('Napiš kategorii.', 'err'); document.getElementById('finHromKat').focus(); return; }
        zmena.kategorie = k;
      } else zmena.bezDokladu = co === 'bez';
      ids.forEach(function (id) { Object.assign(st.tx[id], zmena); });
      zapisVic(ids.map(function (id) { return { id: id, data: zmena }; })).then(function () { toast('Upraveno ' + pocet(ids.length, 'pohyb', 'pohyby', 'pohybů') + '.'); }).catch(function () {});
    }
    st.vyber = {}; st.vyberRezim = false;
    vykresli();
  };

  /* ── Okna ── */
  function okno(id, obsah, trida) {
    var mo = document.getElementById(id);
    if (!mo) { mo = document.createElement('div'); mo.id = id; mo.className = 'mo fin-mo'; document.body.appendChild(mo); }
    mo.innerHTML = '<div class="modal fin-modal' + (trida ? ' ' + trida : '') + '">' + obsah + '</div>';
    mo.classList.add('open');
    return mo;
  }

  /* ── Detail transakce ── */
  function kandidatHtml(n, akce) {
    var c = n.c;
    return '<div class="fin-kand"><div class="fin-kand-t"><b>' + esc(c.popis) + '</b><span>'
      + esc([c.kde, c.cislo ? 'č. ' + c.cislo : '', datumText(c.datum), cisloText(c.castka) + ' ' + mena(c.mena)].filter(Boolean).join(' · '))
      + (n.cislo ? ' · <i>sedí číslo objednávky</i>' : '') + '</span></div>' + akce + '</div>';
  }
  function skladSekce(t, U) {
    var ids = t.sklad || [], h = '<div class="fs" id="finSkladSekce"><div class="fs-title">Sklad</div>';
    if (ids.length) {
      h += ids.map(function (id) {
        var it = polozka(id);
        return '<div class="fin-kand sparovano"><div class="fin-kand-t"><b>' + esc(it ? nazevKusu(it) : 'Položka už ve skladu není') + '</b><span>'
          + esc(it ? (t.skladTyp === 'prodej'
              ? [it.soldWhere, datumText(d10(it.payoutDate || it.saleDate))].filter(Boolean).join(' · ')
              : [it.buyWhere || it.from, cisloNakupu(it) ? 'č. ' + cisloNakupu(it) : '', datumText(d10(it.buyDate))].filter(Boolean).join(' · ')) : '')
          + '</span></div>' + (it ? '<button class="fin-mini" data-id="' + esc(id) + '" onclick="finOtevriPolozku(this.dataset.id)">Otevřít</button>' : '') + '</div>';
      }).join('');
      if (!U) h += '<button class="fin-mini fin-odparovat" onclick="finOdparuj()">Zrušit spárování</button>';
      return h + '</div>';
    }
    if (U) return '';
    var n = navrhy(t);
    h += n.length
      ? '<div class="fin-pom">Ve skladu tomu odpovídá ' + (t.castka < 0 ? 'nákup' : 'prodej') + ' se stejnou částkou. Po spárování se doklad vezme z položky.</div>'
        + n.map(function (x, i) { return kandidatHtml(x, '<button class="fin-mini fin-sparovat" onclick="finSparuj(' + i + ')">Spárovat</button>'); }).join('')
      : '<div class="fin-pom">Nic se stejnou částkou a datem poblíž ve skladu není. Můžeš hledat ručně.</div>';
    h += '<input id="finSkladHledat" class="fin-inp fin-sklad-hledat" placeholder="Hledat ve skladu: název, SKU, číslo objednávky…" oninput="finSkladHledej(this.value)"><div id="finSkladVysledky"></div>';
    return h + '</div>';
  }
  var _detNavrhy = [], _detHledane = [];
  window.finDetail = function (id) {
    var t = st.tx[id]; if (!t) return;
    st.otevrena = id;
    _kand = null; _cisla = null;
    var U = uct(), d = dokladStav(t);
    _detNavrhy = U ? [] : navrhy(t); _detHledane = [];
    var radek = function (l, v) { return v ? '<div class="fin-r"><span>' + l + '</span><b>' + esc(v) + '</b></div>' : ''; };
    var poradi = _seznam.map(function (x) { return x.id; }).indexOf(id);
    var ostatni = U ? 0 : vsechny().filter(function (x) { return x.id !== id && !x.kategorie && klicProtistrany(x) && klicProtistrany(x) === klicProtistrany(t); }).length;
    var z = U ? zaucStav(t) : '';
    okno('moFinDetail',
      '<div class="mh"><span class="mt2">' + esc(t.protistrana || 'Transakce') + '</span>'
      + '<span class="fin-nav">' + (poradi !== -1 && _seznam.length > 1 ? '<button class="fin-sip" onclick="finDetailPosun(-1)" aria-label="Předchozí pohyb">‹</button><span>' + (poradi + 1) + ' / ' + _seznam.length + '</span><button class="fin-sip" onclick="finDetailPosun(1)" aria-label="Další pohyb">›</button>' : '')
      + '<button class="xb" onclick="cm(\'moFinDetail\')">✕</button></span></div>'
      + '<div class="fin-det-castka ' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</div>'
      + '<div class="fin-det-info">'
      + radek('Datum', datumText(t.datum)) + radek('Banka', BANKY[t.banka] || t.banka) + radek('Typ', t.typ)
      + radek('Účet protistrany', t.ucet) + radek('Zpráva', t.zprava) + radek('VS', t.vs)
      + (t.puvodniCastka ? radek('Původní částka', t.puvodniCastka) : '')
      + (U ? radek('Kategorie', t.kategorie) + radek('Poznámka', t.poznamka) : '')
      + '</div>'
      + '<div class="fs"><div class="fs-title">Doklad</div>'
      + (U ? '<div class="fin-doklad-stav ' + d.stav + '">' + esc(d.popis) + '</div>'
          : '<div class="fi"><label for="finDok">Odkaz na doklad (OneDrive)</label><input id="finDok" type="url" placeholder="https://…" value="' + esc(t.dokladUrl || '') + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();finUloz(true)}"></div>')
      + (d.stav === 'ok' && d.url ? '<a class="faktura-link fin-otevrit" href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.zeSkladu ? d.popis + ' — otevřít' : 'Otevřít doklad') + '</a>' : '')
      + (d.stav === 'ok' && !d.url ? '<button class="fin-mini fin-otevrit" onclick="finOtevriDoklad(\'' + esc(d.doklad) + '\')">' + esc(d.popis) + ' — otevřít</button>' : '')
      + (U ? '' : '<label class="fin-chk"><input type="checkbox" id="finBezDok"' + (t.bezDokladu ? ' checked' : '') + '> Doklad není potřeba (převod mezi vlastními účty, poplatek banky…)</label>') + '</div>'
      + skladSekce(t, U)
      + (U ? '<label class="fin-chk fin-zauc-velke"><input type="checkbox" id="finZaucDet"' + (z === 'ok' ? ' checked' : '') + ' onchange="finZauctuj(\'' + esc(id) + '\', this.checked)"> Zaúčtováno' + (z === 'zmena' ? ' <i>(od zaúčtování se pohyb změnil)</i>' : '') + '</label>'
        : '<div class="fs"><div class="fs-title">Zařazení</div>'
          + '<div class="fi"><label for="finKat">Kategorie</label><input id="finKat" placeholder="Napiš, nebo vyber níž" value="' + esc(t.kategorie || '') + '" autocomplete="off"></div>'
          + '<div class="fin-kat-volby">' + seznamKategorii().slice(0, 12).map(function (k) { return '<button type="button" class="fin-chip' + (k === t.kategorie ? ' akt' : '') + '" data-kat="' + esc(k) + '" onclick="finZvolKategorii(this)">' + esc(k) + '</button>'; }).join('') + '</div>'
          + (ostatni ? '<label class="fin-chk"><input type="checkbox" id="finKatVsem" checked> Zařadit stejně i ' + pocet(ostatni, 'další nezařazený pohyb', 'další nezařazené pohyby', 'dalších nezařazených pohybů') + ' od „' + esc(t.protistrana) + '“</label>' : '')
          + '<div class="fi full fin-pozn-pole"><label for="finPozn">Poznámka</label><textarea id="finPozn" rows="2">' + esc(t.poznamka || '') + '</textarea></div></div>'
          + '<div class="btn-row"><button class="btn-sec fin-smazat" onclick="finSmaz(this)">Smazat</button>'
          + '<button class="btn-sec" id="finUlozDalsi" onclick="finUloz(true)" data-tip="Uloží a otevře další pohyb bez dokladu (Enter v poli s odkazem)">Uložit a další</button>'
          + '<button class="btn-pri" onclick="finUloz()">Uložit</button></div>'));
    if (!U) setTimeout(function () { var i = document.getElementById('finDok'); if (i && !t.dokladUrl && st.otevrena === id) i.focus(); }, 30);
  };
  window.finZvolKategorii = function (b) {
    var i = document.getElementById('finKat'); if (!i) return;
    i.value = b.classList.contains('akt') ? '' : b.dataset.kat;
    [].forEach.call(b.parentNode.children, function (x) { x.classList.toggle('akt', x === b && !!i.value); });
  };
  window.finDetailPosun = function (o) {
    var ids = _seznam.map(function (x) { return x.id; }), i = ids.indexOf(st.otevrena);
    if (i === -1 || !ids.length) return;
    window.finDetail(ids[(i + o + ids.length) % ids.length]);
  };
  window.finUloz = function (dalsi) {
    var id = st.otevrena, t = st.tx[id]; if (!t || uct()) return;
    var url = (document.getElementById('finDok').value || '').trim();
    if (url && !jeOdkaz(url)) { toast('Odkaz na doklad musí začínat https://', 'err'); return; }
    var ted = Date.now();
    var zmena = { dokladUrl: url, bezDokladu: !!document.getElementById('finBezDok').checked,
      kategorie: (document.getElementById('finKat').value || '').trim().slice(0, 60),
      poznamka: (document.getElementById('finPozn').value || '').trim().slice(0, 2000), upraveno: ted };
    var vsem = document.getElementById('finKatVsem'), zmeny = [{ id: id, data: zmena }];
    if (vsem && vsem.checked && zmena.kategorie) {
      var k = klicProtistrany(t);
      vsechny().forEach(function (x) {
        if (x.id !== id && !x.kategorie && klicProtistrany(x) === k) { x.kategorie = zmena.kategorie; zmeny.push({ id: x.id, data: { kategorie: zmena.kategorie, upraveno: ted - 1 } }); }
      });
    }
    Object.assign(t, zmena);
    zapisVic(zmeny).then(function () { toast(zmeny.length > 1 ? 'Uloženo, zařazeno i ' + pocet(zmeny.length - 1, 'další pohyb', 'další pohyby', 'dalších pohybů') + '.' : 'Uloženo.'); }).catch(function () {});
    // Další = nejbližší pohyb bez dokladu za tímhle v pořadí na obrazovce
    var dalsiId = null;
    if (dalsi) {
      var ids = _seznam.map(function (x) { return x.id; }), i = ids.indexOf(id);
      for (var j = 1; j < ids.length && !dalsiId; j++) { var x = st.tx[ids[(i + j) % ids.length]]; if (x && finChybiDoklad(x)) dalsiId = x.id; }
    }
    vykresli();
    if (dalsiId) window.finDetail(dalsiId); else { cm('moFinDetail'); if (dalsi) toast('Uloženo. Žádný další pohyb bez dokladu tu není.'); }
  };
  window.finSmaz = function (btn) {
    if (uct()) return;
    if (!btn.dataset.jiste) { btn.dataset.jiste = '1'; btn.textContent = 'Opravdu smazat?'; return; }
    var id = st.otevrena;
    delete st.tx[id];
    zapisVic([{ id: id }], true).catch(function () {});
    cm('moFinDetail'); vykresli();
  };
  // Párování: transakce si pamatuje id položek. Do skladu se nezapisuje.
  function sparuj(t, c) {
    var zmena = { sklad: c.ids.slice(0, 200), skladTyp: c.typ, upraveno: Date.now() };
    Object.assign(t, zmena);
    return { id: t.id, data: zmena };
  }
  window.finSparuj = function (i, hledane) {
    var t = st.tx[st.otevrena], n = (hledane ? _detHledane : _detNavrhy)[i];
    if (!t || !n || uct()) return;
    var z = sparuj(t, n.c);
    zapis(z.id, z.data).then(function () { toast('Spárováno se skladem.'); }).catch(function () {});
    vykresli(); window.finDetail(t.id);
  };
  window.finOdparuj = function () {
    var t = st.tx[st.otevrena]; if (!t || uct()) return;
    var zmena = { sklad: [], skladTyp: '', upraveno: Date.now() };
    Object.assign(t, zmena);
    zapis(t.id, zmena).catch(function () {});
    vykresli(); window.finDetail(t.id);
  };
  window.finSkladHledej = function (q) {
    var t = st.tx[st.otevrena], el = document.getElementById('finSkladVysledky'); if (!t || !el) return;
    _detHledane = String(q || '').trim().length < 2 ? [] : navrhy(t, q);
    el.innerHTML = _detHledane.map(function (x, i) { return kandidatHtml(x, '<button class="fin-mini fin-sparovat" onclick="finSparuj(' + i + ', true)">Spárovat</button>'); }).join('')
      || (String(q || '').trim().length >= 2 ? '<div class="fin-pom">Nic takového ve skladu není (nebo už je spárované s jiným pohybem).</div>' : '');
  };

  /* ── Hromadné párování jistých návrhů ── */
  var _parovani = [];
  window.finOtevriParovani = function () {
    if (uct()) return;
    _kand = null;
    var obsazene = {};
    _parovani = [];
    _seznam.forEach(function (t) {
      var n = jistyNavrh(t); if (!n) return;
      // Jedna položka nesmí skončit u dvou pohybů
      if (n.c.ids.some(function (id) { return obsazene[id]; })) return;
      n.c.ids.forEach(function (id) { obsazene[id] = 1; });
      _parovani.push({ t: t, n: n });
    });
    okno('moFinParovani',
      '<div class="mh"><span class="mt2">Spárovat se skladem</span><button class="xb" onclick="cm(\'moFinParovani\')">✕</button></div>'
      + '<p class="fin-pom">U těchhle pohybů sedí ve skladu právě jeden nákup nebo prodej — stejná částka a datum poblíž. Odškrtni, co nechceš. Doklad se pak bere z položky, do skladu se nic nezapisuje.</p>'
      + '<div class="fin-par-seznam">' + _parovani.map(function (p, i) {
        return '<label class="fin-par"><input type="checkbox" checked data-i="' + i + '"><div><div class="fin-par-tx"><span>' + esc(datumText(p.t.datum)) + '</span><b>' + esc(p.t.protistrana || p.t.zprava || '—') + '</b><b class="' + (p.t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(p.t.castka, p.t.mena) + '</b></div>'
          + '<div class="fin-par-sk">↳ ' + esc(p.n.c.popis) + ' · ' + esc([p.n.c.kde, datumText(p.n.c.datum)].filter(Boolean).join(' · ')) + '</div></div></label>';
      }).join('') + '</div>'
      + '<div class="btn-row"><button class="btn-sec" onclick="cm(\'moFinParovani\')">Zrušit</button><button class="btn-pri" id="finParPotvrdit" onclick="finPotvrdParovani()">Spárovat vybrané</button></div>', 'fin-modal-siroky');
  };
  window.finPotvrdParovani = function () {
    var zmeny = [];
    document.querySelectorAll('#moFinParovani input[data-i]').forEach(function (ch) {
      var p = _parovani[+ch.dataset.i];
      if (ch.checked && p && st.tx[p.t.id]) zmeny.push(sparuj(st.tx[p.t.id], p.n.c));
    });
    cm('moFinParovani');
    if (!zmeny.length) return;
    zapisVic(zmeny).then(function () { toast('Spárováno ' + pocet(zmeny.length, 'pohyb', 'pohyby', 'pohybů') + '.'); }).catch(function () {});
    vykresli();
  };

  /* ── Import výpisu ── */
  // Sloupce podle názvu, bez diakritiky; první shoda v pořadí vyhrává
  var FIN_SLOUPCE = {
    datum: ['datum provedeni', 'date completed (utc)', 'date completed', 'date started (utc)', 'date started', 'datum zauctovani', 'datum'],
    castka: ['castka v mene uctu', 'total amount', 'amount', 'castka'],
    mena: ['mena uctu', 'payment currency', 'currency', 'mena'],
    protistrana: ['nazev protistrany', 'description', 'payer', 'obchodni misto', 'protistrana'],
    ucet: ['cislo uctu protistrany', 'beneficiary iban', 'beneficiary account number'],
    zprava: ['zprava pro prijemce', 'poznamka k uhrade', 'reference', 'zprava', 'poznamka pro mne'],
    vs: ['variabilni symbol'],
    typ: ['typ uhrady', 'type'],
    ref: ['referencni cislo', 'id'],
    stav: ['state'],
    puvodniMena: ['puvodni mena uhrady', 'orig currency'],
    puvodniCastka: ['puvodni castka uhrady', 'orig amount']
  };
  function rozdelCsv(text) {
    text = text.replace(/^﻿/, '');
    var prvni = text.split(/\r?\n/)[0] || '';
    var odd = (prvni.split(';').length > prvni.split(',').length) ? ';' : (prvni.split('\t').length > prvni.split(',').length ? '\t' : ',');
    var radky = [], r = [], pole = '', uv = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (uv) { if (c === '"') { if (text[i + 1] === '"') { pole += '"'; i++; } else uv = false; } else pole += c; }
      else if (c === '"') uv = true;
      else if (c === odd) { r.push(pole); pole = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; r.push(pole); pole = ''; if (r.some(function (x) { return x.trim(); })) radky.push(r); r = []; }
      else pole += c;
    }
    r.push(pole); if (r.some(function (x) { return x.trim(); })) radky.push(r);
    return radky;
  }
  function cislo(s) {
    s = String(s || '').replace(/\s| | /g, '').replace(/−/g, '-');
    if (!s) return NaN;
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') !== -1 && s.lastIndexOf('.') < s.lastIndexOf(',')) s = s.replace(/\./g, '');   // 1.234,56
    else if (/\.\d{1,2}$/.test(s) && s.indexOf(',') !== -1 && s.lastIndexOf(',') < s.lastIndexOf('.')) s = s.replace(/,/g, '');   // 1,234.56
    s = s.replace(',', '.').replace(/[^\d.+-]/g, '');
    return parseFloat(s);
  }
  function datumIso(s) {
    s = String(s || '').trim(); var m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{1,2})[\/.]\s*(\d{1,2})[\/.]\s*(\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }
  function otisk(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
  // Banka se pozná z hlavičky — špatně zaškrtnutá by pohyby uložila pod cizí záložku
  function poznejBanku(hlavicka) {
    var hl = (hlavicka || []).map(bezDiakritiky);
    if (hl.indexOf('state') !== -1 || hl.indexOf('date started (utc)') !== -1 || hl.indexOf('date completed (utc)') !== -1) return 'revolut';
    if (hl.indexOf('datum provedeni') !== -1 || hl.indexOf('castka v mene uctu') !== -1 || hl.indexOf('nazev protistrany') !== -1) return 'airbank';
    return '';
  }
  function nactiTransakce(radky, banka) {
    if (radky.length < 2) return { chyba: 'Soubor nemá žádné řádky s pohyby.' };
    var hl = radky[0].map(bezDiakritiky), map = {};
    Object.keys(FIN_SLOUPCE).forEach(function (k) {
      for (var i = 0; i < FIN_SLOUPCE[k].length; i++) { var j = hl.indexOf(FIN_SLOUPCE[k][i]); if (j !== -1) { map[k] = j; return; } }
    });
    if (map.datum == null || map.castka == null) {
      return { chyba: 'Ve výpisu jsem nenašel sloupec s ' + (map.datum == null ? 'datem' : 'částkou') + '. Pošli Claudovi jen první řádek souboru (názvy sloupců) a doplní ho.', hlavicka: radky[0] };
    }
    banka = poznejBanku(radky[0]) || banka;
    var tx = [], vynechano = 0, pocty = {};
    radky.slice(1).forEach(function (r, i) {
      var g = function (k) { return map[k] != null ? String(r[map[k]] || '').trim() : ''; };
      var stav = g('stav').toUpperCase();
      if (stav && stav !== 'COMPLETED') { vynechano++; return; }   // Revolut: zamítnuté a čekající ne
      var datum = datumIso(g('datum')), castka = cislo(g('castka'));
      if (!datum || isNaN(castka)) { vynechano++; return; }
      var t = { banka: banka, datum: datum, castka: Math.round(castka * 100) / 100, mena: (g('mena') || 'CZK').toUpperCase(),
        protistrana: g('protistrana').slice(0, 140), ucet: g('ucet').slice(0, 60), zprava: g('zprava').slice(0, 300),
        vs: g('vs').slice(0, 20), typ: g('typ').slice(0, 60), poradi: radky.length - i };
      if (g('puvodniMena') && g('puvodniMena').toUpperCase() !== t.mena && g('puvodniCastka')) t.puvodniCastka = g('puvodniCastka') + ' ' + g('puvodniMena').toUpperCase();
      // Stejný výpis podruhé = stejné id. Bez reference z banky se bere obsah
      // řádku a pořadí shody v souboru (dva stejné pohyby téhož dne zůstanou dva)
      var zaklad = g('ref') ? 'r' + g('ref') : [datum, t.castka, t.mena, t.protistrana, t.zprava, t.vs].join('|');
      pocty[zaklad] = (pocty[zaklad] || 0) + 1;
      t.id = 't_' + banka + '_' + otisk(zaklad + '#' + pocty[zaklad]) + otisk('x' + zaklad + pocty[zaklad]);
      tx.push(t);
    });
    return { tx: tx, vynechano: vynechano, sloupce: map, banka: banka };
  }
  function dekoduj(buf) {
    var t = new TextDecoder('utf-8').decode(buf);
    if (t.indexOf('�') !== -1) { try { t = new TextDecoder('windows-1250').decode(buf); } catch (e) {} }   // Air Bank umí i starší kódování
    return t;
  }
  window.finOtevriImport = function () {
    if (uct()) return;
    st.importData = null;
    okno('moFinImport',
      '<div class="mh"><span class="mt2">Importovat výpis</span><button class="xb" onclick="cm(\'moFinImport\')">✕</button></div>'
      + '<p class="fin-pom">Nahraj výpis jako <b>CSV</b> — klidně víc souborů naráz, banka se pozná sama. Pohyby, které už tu jsou, se nezdvojí.</p>'
      + '<div class="fin-banky">' + Object.keys(BANKY).map(function (k) { return '<label class="fin-banka-volba"><input type="radio" name="finBanka" value="' + k + '"' + ((st.zalozka === k || (st.zalozka === 'vse' && k === 'airbank')) ? ' checked' : '') + '> ' + BANKY[k] + '</label>'; }).join('') + '</div>'
      + '<label class="fin-drop" id="finDrop"><input type="file" id="finSoubor" accept=".csv,text/csv,text/plain" multiple onchange="finNactiSoubor(this)">'
      + '<b>Vyber soubory</b> nebo je sem přetáhni</label>'
      + '<details class="fin-kde"><summary>Kde v bance CSV stáhnu?</summary>'
      + '<p><b>Air Bank:</b> internetové bankovnictví → účet → Historie plateb → nastav období → Exportovat (Stáhnout) → formát CSV.</p>'
      + '<p><b>Revolut Business:</b> Home → Statements (Výpisy) → Transaction statement → vyber období → Export → CSV.</p>'
      + '<p>PDF výpis přečíst neumím — je to obrázek stránky, ne tabulka.</p></details>'
      + '<div id="finNahled" class="fin-nahled"></div>'
      + '<div class="btn-row"><button class="btn-sec" onclick="cm(\'moFinImport\')">Zrušit</button><button class="btn-pri" id="finImportuj" disabled onclick="finImportuj()">Importovat</button></div>');
    var drop = document.getElementById('finDrop');
    ['dragover', 'dragenter'].forEach(function (u) { drop.addEventListener(u, function (e) { e.preventDefault(); drop.classList.add('nad'); }); });
    ['dragleave', 'drop'].forEach(function (u) { drop.addEventListener(u, function (e) { e.preventDefault(); drop.classList.remove('nad'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) nactiSoubory(e.dataTransfer.files); });
  };
  function zvolenaBanka() { return (document.querySelector('input[name="finBanka"]:checked') || {}).value || 'airbank'; }
  function nactiSoubory(files) {
    var seznam = [].slice.call(files), banka = zvolenaBanka(), texty = [];
    if (seznam.some(function (f) { return /\.pdf$/i.test(f.name); })) {
      ukazNahled({ chyba: 'PDF výpis přečíst neumím. Stáhni si v bance tentýž výpis jako CSV (návod je výš pod „Kde v bance CSV stáhnu?“).' });
      return;
    }
    var zbyva = seznam.length;
    seznam.forEach(function (f, i) {
      var r = new FileReader();
      r.onload = function () { texty[i] = dekoduj(r.result); if (--zbyva === 0) ukazNahled(zpracujTexty(texty, banka)); };
      r.readAsArrayBuffer(f);
    });
  }
  window.finNactiSoubor = function (inp) { if (inp.files && inp.files.length) nactiSoubory(inp.files); };
  function zpracujTexty(texty, banka) {
    var vse = { tx: [], vynechano: 0, banky: {} }, videne = {};
    for (var i = 0; i < texty.length; i++) {
      var v = nactiTransakce(rozdelCsv(texty[i]), banka);
      if (v.chyba) return v;
      vse.vynechano += v.vynechano; vse.banky[v.banka] = 1; vse.sloupce = v.sloupce;
      v.tx.forEach(function (t) { if (!videne[t.id]) { videne[t.id] = 1; vse.tx.push(t); } });
    }
    return vse;
  }
  function ukazNahled(v) {
    var nah = document.getElementById('finNahled'), btn = document.getElementById('finImportuj');
    if (!nah) return v;
    if (v.chyba) { st.importData = null; nah.innerHTML = '<div class="fin-chyba">' + esc(v.chyba) + '</div>'; if (btn) btn.disabled = true; return v; }
    var nove = v.tx.filter(function (t) { return !st.tx[t.id]; });
    // Kategorie podle protistrany — z toho, co už je zařazené
    var zarazeno = 0, zname = vsechny();
    nove.forEach(function (t) { var p = pravidlo(t, zname); if (p) { t.kategorie = p.kategorie; if (p.bezDokladu) t.bezDokladu = true; zarazeno++; } });
    st.importData = nove;
    Object.keys(v.banky || {}).forEach(function (b) { var r = document.querySelector('input[name="finBanka"][value="' + b + '"]'); if (r && Object.keys(v.banky).length === 1) r.checked = true; });
    nah.innerHTML = '<div class="fin-nahled-sum"><b>' + nove.length + '</b> nových pohybů · ' + (v.tx.length - nove.length) + ' už tu je'
      + (v.vynechano ? ' · ' + v.vynechano + ' vynecháno (bez data/částky nebo nedokončené)' : '')
      + (zarazeno ? ' · ' + zarazeno + ' se samo zařadí podle protistrany' : '')
      + ' · ' + Object.keys(v.banky || {}).map(function (b) { return BANKY[b] || b; }).join(' + ') + '</div>'
      + nove.slice(0, 6).map(function (t) { return '<div class="fin-nahled-r"><span>' + esc(datumText(t.datum)) + '</span><span>' + esc(t.protistrana || t.zprava || '—') + (t.kategorie ? ' <i class="fin-kat">' + esc(t.kategorie) + '</i>' : '') + '</span><b class="' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</b></div>'; }).join('')
      + (nove.length > 6 ? '<div class="fin-pom">… a dalších ' + (nove.length - 6) + '</div>' : '');
    if (btn) btn.disabled = !nove.length;
    return v;
  }
  window.finZpracujText = function (text, banka) { return ukazNahled(zpracujTexty([text], banka)); };
  window.finImportuj = function () {
    var nove = st.importData || []; if (!nove.length) return;
    if (!cloud()) return;
    var ted = Date.now();
    zapisVic(nove.map(function (t) { var x = Object.assign({}, t); delete x.id; x.importovano = ted; return { id: t.id, data: x, cele: true }; }))
      .then(function () { toast('Importováno ' + pocet(nove.length, 'pohyb', 'pohyby', 'pohybů') + '.'); }).catch(function () {});
    nove.forEach(function (t) { st.tx[t.id] = Object.assign({ importovano: ted }, t); });
    st.importData = null;
    cm('moFinImport');
    // Ať je hned vidět, co přibylo: měsíc posledního pohybu z výpisu
    var nejnovejsi = nove.map(function (t) { return t.datum; }).sort().pop();
    if (nejnovejsi) { st.rok = +nejnovejsi.slice(0, 4); st.mesic = +nejnovejsi.slice(5, 7) - 1; }
    st.pohled = 'pohyby'; st.filtr = 'vse'; st.hledat = '';
    vykresli();
  };

  /* ── Klávesy ──
     Zkratky skladu (n = nová položka, čísla přepínají sekce, Delete maže
     vybrané) ve Financích nesmí dělat nic — člověk sklad nevidí a nevěděl
     by, co se stalo. Posluchač je v capture fázi, aby byl před nimi.
     Escape se pouští dál: zavírá okna stejně jako ve skladu. */
  document.addEventListener('keydown', function (e) {
    if (!_aktivni) return;
    var vPoli = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
    if (e.key === 'Escape') {
      if (st.vyberRezim && !document.querySelector('.mo.open')) { window.finVyberRezim(); e.stopImmediatePropagation(); }
      return;
    }
    if (vPoli || e.ctrlKey || e.metaKey || e.altKey) return;
    var det = document.getElementById('moFinDetail'), detOtevreny = det && det.classList.contains('open');
    if (document.querySelector('.mo.open:not(.fin-mo)')) return;   // okno skladu (Nastavení) má své klávesy
    if (detOtevreny && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { window.finDetailPosun(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); }
    else if (!document.querySelector('.mo.open')) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { window.finPosun(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); }
      else if (e.key === '/') { var h = document.getElementById('finHledat'); if (h) { h.focus(); e.preventDefault(); } }
    }
    e.stopImmediatePropagation();
  }, true);

  /* ── Napojení na aplikaci ── */
  window.finSpust = finSpust;
  window.finZastav = finZastav;
  window.prepniProstredi = prepniProstredi;
  window.finStav = st;   // pro testy
  window._finNactiTransakce = function (text, banka) { return nactiTransakce(rozdelCsv(text), banka); };
  window._finNavrhy = navrhy;
  window._finJistyNavrh = jistyNavrh;
  window._finDokladStav = dokladStav;
  window._finCsv = function () { return csvText(_seznam); };
  window.finChybiDoklad = finChybiDoklad;
})();
