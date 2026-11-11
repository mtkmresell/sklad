/* ══════════════════════════════════════════════════════════════════════
   FINANCE — DAŇOVÁ EVIDENCE (majitel, 11. 11. 2026)

   Druhé pracovní prostředí vedle skladu: přepínač Sklad | Finance
   v hlavičce. Tabulka transakcí z výpisů Air Bank a Revolut Pro, ke
   každé odkaz na doklad (OneDrive, jako invoiceUrl u položek), kategorie
   a poznámka. Účetní pak nemusí luštit PDF výpisy a hledat faktury.

   Schválně v samostatném souboru a ve vlastní kolekci cloudu
   (users/{uid}/finance) — chyba tady nesmí sáhnout na sklad, ani
   obráceně. Každá transakce je vlastní dokument t_<banka>_<otisk>:
   import stejného výpisu podruhé nic nezdvojí (stejný otisk = stejný
   dokument) a úprava jedné transakce nepřepisuje ostatní.

   Import bere CSV z banky. Sloupce se poznají podle názvu
   (FIN_SLOUPCE), ne podle pořadí — Air Bank i Revolut je čas od času
   přeskládají. Když se datum nebo částka nenajdou, nic se neuloží
   a řekne se to.
══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var BANKY = { airbank: 'Air Bank', revolut: 'Revolut' };
  var MESICE = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];

  var st = {
    tx: {},              // id → transakce
    nacteno: false,
    chyba: null,
    unsub: null,
    zalozka: 'vse',      // airbank | revolut | vse
    rok: null, mesic: null,   // mesic 0–11, null = celý rok
    filtr: 'vse',        // vse | prijmy | vydaje | bezdokladu
    hledat: '',
    otevrena: null,
    importData: null
  };
  var _aktivni = false;

  /* ── Pomocné ── */
  function esc(s) { return typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
  function bezDiakritiky(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function castkaText(n, mena) {
    var s = Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−' : '+') + s + ' ' + (mena === 'CZK' || !mena ? 'Kč' : mena === 'EUR' ? '€' : mena);
  }
  function datumText(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? (+p[2]) + '. ' + (+p[1]) + '. ' + p[0] : iso || ''; }
  function jeOdkaz(u) { return /^https?:\/\/\S+$/i.test(String(u || '').trim()); }
  function uid() { return typeof _datovyUid === 'function' ? _datovyUid() : null; }
  function uct() { return typeof jeUctetni === 'function' && jeUctetni(); }

  /* ── Cloud ── */
  function finSpust() {
    finZastav();
    var fns = window._fbFns, u = uid();
    if (!fns || !window._fbDb || !u || uct()) { aktualizujPrepinac(); return; }
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
  }
  function finZastav() {
    if (st.unsub) { try { st.unsub(); } catch (e) {} st.unsub = null; }
    st.tx = {}; st.nacteno = false; st.chyba = null;
    if (_aktivni) prepniProstredi('sklad');
    aktualizujPrepinac();
  }
  function zapis(id, data, merge) {
    var fns = window._fbFns, u = uid();
    if (!fns || !window._fbDb || !u) { toast('Finance jdou jen přes cloud — přihlas se.', 'err'); return Promise.reject(new Error('bez cloudu')); }
    return fns.setDoc(fns.doc(window._fbDb, 'users', u, 'finance', id), data, merge ? { merge: true } : undefined).catch(chybaZapisu);
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
    if (p) p.style.display = (!uct() && window._fbUser) ? '' : 'none';
  }
  function prepniProstredi(kam) {
    var fin = kam === 'finance' && !uct();
    _aktivni = fin;
    document.body.classList.toggle('prostredi-finance', fin);
    document.querySelectorAll('#prostrediSwitch .ps-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-kam') === (fin ? 'finance' : 'sklad')); });
    var app = document.getElementById('financeApp');
    if (fin) {
      if (!app) { app = document.createElement('div'); app.id = 'financeApp'; var main = document.querySelector('.main'); main.parentNode.insertBefore(app, main); }
      if (st.rok == null) { var d = new Date(); st.rok = d.getFullYear(); st.mesic = d.getMonth(); }
      vykresli();
    }
    try { localStorage.setItem('sklad_prostredi_v1', fin ? 'finance' : 'sklad'); } catch (e) {}
  }

  /* ── Výběr a souhrn ── */
  function vyber() {
    var q = bezDiakritiky(st.hledat);
    return Object.keys(st.tx).map(function (k) { return st.tx[k]; }).filter(function (t) {
      if (st.zalozka !== 'vse' && t.banka !== st.zalozka) return false;
      var d = String(t.datum || '');
      if (st.rok != null && d.slice(0, 4) !== String(st.rok)) return false;
      if (st.mesic != null && +d.slice(5, 7) !== st.mesic + 1) return false;
      if (st.filtr === 'prijmy' && !(t.castka > 0)) return false;
      if (st.filtr === 'vydaje' && !(t.castka < 0)) return false;
      if (st.filtr === 'bezdokladu' && (t.dokladUrl || t.bezDokladu)) return false;
      if (q && bezDiakritiky([t.protistrana, t.zprava, t.vs, t.kategorie, t.poznamka, t.ucet].join(' ')).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.datum).localeCompare(String(a.datum)) || (b.poradi || 0) - (a.poradi || 0); });
  }
  function souhrn(seznam) {
    var m = {};
    seznam.forEach(function (t) {
      var k = t.mena || 'CZK'; m[k] = m[k] || { prijmy: 0, vydaje: 0 };
      if (t.castka > 0) m[k].prijmy += t.castka; else m[k].vydaje += t.castka;
    });
    return m;
  }
  function finChybiDoklad(t) { return !t.dokladUrl && !t.bezDokladu; }

  /* ── Vykreslení ── */
  function vykresli() {
    var app = document.getElementById('financeApp'); if (!app) return;
    var y = app.scrollTop;
    var seznam = vyber(), s = souhrn(seznam);
    var bez = seznam.filter(finChybiDoklad).length;
    var h = '<div class="fin-lista">'
      + '<div class="fin-zal">' + ['vse', 'airbank', 'revolut'].map(function (k) {
          var n = Object.keys(st.tx).filter(function (i) { return k === 'vse' || st.tx[i].banka === k; }).length;
          return '<button class="fin-zal-btn' + (st.zalozka === k ? ' akt' : '') + '" data-zal="' + k + '" onclick="finZalozka(\'' + k + '\')">' + (k === 'vse' ? 'Dohromady' : BANKY[k]) + ' <span>' + n + '</span></button>';
        }).join('') + '</div>'
      + '<div class="fin-obdobi"><button class="fin-sip" onclick="finPosun(-1)" aria-label="Předchozí měsíc">‹</button>'
      + '<span class="fin-obd-text" id="finObdobi">' + (st.mesic == null ? 'Celý rok ' + st.rok : MESICE[st.mesic] + ' ' + st.rok) + '</span>'
      + '<button class="fin-sip" onclick="finPosun(1)" aria-label="Další měsíc">›</button>'
      + '<button class="fin-mini' + (st.mesic == null ? ' akt' : '') + '" onclick="finCelyRok()">Celý rok</button></div>'
      + '<button class="add-btn fin-import-btn" onclick="finOtevriImport()">Importovat výpis</button>'
      + '</div>';
    h += '<div class="fin-dlazdice">' + (Object.keys(s).length ? Object.keys(s).sort().map(function (m) {
          return '<div class="fin-dl"><div class="fin-dl-l">Příjmy ' + esc(m) + '</div><div class="fin-dl-v plus">' + castkaText(s[m].prijmy, m) + '</div></div>'
            + '<div class="fin-dl"><div class="fin-dl-l">Výdaje ' + esc(m) + '</div><div class="fin-dl-v minus">' + castkaText(s[m].vydaje, m) + '</div></div>'
            + '<div class="fin-dl"><div class="fin-dl-l">Saldo ' + esc(m) + '</div><div class="fin-dl-v">' + castkaText(s[m].prijmy + s[m].vydaje, m) + '</div></div>';
        }).join('') : '<div class="fin-dl"><div class="fin-dl-l">Pohyby</div><div class="fin-dl-v">0</div></div>')
      + '<button class="fin-dl fin-dl-bez' + (bez ? ' svit' : '') + '" onclick="finFiltr(\'bezdokladu\')"><div class="fin-dl-l">Bez dokladu</div><div class="fin-dl-v">' + bez + '</div></button>'
      + '</div>';
    h += '<div class="fin-filtry"><input id="finHledat" class="fin-inp" placeholder="Protistrana, zpráva, VS, kategorie…" value="' + esc(st.hledat) + '" oninput="finHledej(this.value)">'
      + ['vse', 'prijmy', 'vydaje', 'bezdokladu'].map(function (k) {
          return '<button class="fin-chip' + (st.filtr === k ? ' akt' : '') + '" data-filtr="' + k + '" onclick="finFiltr(\'' + k + '\')">' + { vse: 'Vše', prijmy: 'Příjmy', vydaje: 'Výdaje', bezdokladu: 'Bez dokladu' }[k] + '</button>';
        }).join('') + '<span class="fin-pocet">' + seznam.length + ' pohybů</span></div>';
    if (st.chyba) {
      h += '<div class="fin-prazdne">' + (st.chyba === 'permission-denied'
        ? 'Cloud Finance odmítl. V konzoli Firebase je potřeba publikovat nová pravidla (firestore.rules, blok finance).'
        : 'Finance se nenačetly (' + esc(st.chyba) + ').') + '</div>';
    } else if (!st.nacteno) {
      h += '<div class="fin-prazdne">Načítám transakce…</div>';
    } else if (!Object.keys(st.tx).length) {
      h += '<div class="fin-prazdne"><b>Zatím tu nic není.</b><br>Stáhni si v Air Bank nebo v Revolutu výpis jako CSV a nahraj ho tlačítkem <b>Importovat výpis</b>. Každý pohyb se zapíše jednou — stejný výpis nahraný podruhé nic nezdvojí.</div>';
    } else if (!seznam.length) {
      h += '<div class="fin-prazdne">V tomhle období a filtru nic není.</div>';
    } else {
      h += '<div class="fin-tab-obal"><table class="fin-tab"><thead><tr><th>Datum</th>' + (st.zalozka === 'vse' ? '<th>Banka</th>' : '')
        + '<th>Protistrana</th><th>Zpráva / VS</th><th>Kategorie</th><th class="r">Částka</th><th class="c">Doklad</th></tr></thead><tbody>'
        + seznam.map(function (t) {
          var dok = t.dokladUrl ? '<a class="fin-dok ok" href="' + esc(t.dokladUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" data-tip="Otevřít doklad">✓</a>'
            : t.bezDokladu ? '<span class="fin-dok nic" data-tip="Doklad není potřeba">—</span>'
            : '<span class="fin-dok chybi" data-tip="Chybí doklad">!</span>';
          return '<tr data-tx="' + esc(t.id) + '" onclick="finDetail(\'' + esc(t.id) + '\')">'
            + '<td class="fin-d">' + esc(datumText(t.datum)) + '</td>'
            + (st.zalozka === 'vse' ? '<td><span class="fin-banka b-' + esc(t.banka) + '">' + esc(BANKY[t.banka] || t.banka) + '</span></td>' : '')
            + '<td class="fin-pr">' + esc(t.protistrana || '—') + (t.ucet ? '<span class="fin-ucet">' + esc(t.ucet) + '</span>' : '') + '</td>'
            + '<td class="fin-zp">' + esc(t.zprava || '') + (t.vs ? '<span class="fin-vs">VS ' + esc(t.vs) + '</span>' : '') + '</td>'
            + '<td>' + (t.kategorie ? '<span class="fin-kat">' + esc(t.kategorie) + '</span>' : '') + '</td>'
            + '<td class="r fin-c ' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</td>'
            + '<td class="c">' + dok + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var foc = document.activeElement && document.activeElement.id === 'finHledat', sel = foc ? document.activeElement.selectionStart : 0;
    app.innerHTML = h;
    app.scrollTop = y;
    if (foc) { var i = document.getElementById('finHledat'); i.focus(); try { i.setSelectionRange(sel, sel); } catch (e) {} }
  }

  /* ── Ovládání ── */
  window.finZalozka = function (k) { st.zalozka = k; vykresli(); };
  window.finFiltr = function (k) { st.filtr = st.filtr === k && k !== 'vse' ? 'vse' : k; vykresli(); };
  window.finHledej = function (v) { st.hledat = v; vykresli(); };
  window.finCelyRok = function () { st.mesic = st.mesic == null ? new Date().getMonth() : null; vykresli(); };
  window.finPosun = function (o) {
    if (st.mesic == null) { st.rok += o; }
    else { st.mesic += o; if (st.mesic < 0) { st.mesic = 11; st.rok--; } if (st.mesic > 11) { st.mesic = 0; st.rok++; } }
    vykresli();
  };

  /* ── Detail transakce ── */
  function okno(id, obsah) {
    var mo = document.getElementById(id);
    if (!mo) { mo = document.createElement('div'); mo.id = id; mo.className = 'mo'; document.body.appendChild(mo); }
    mo.innerHTML = '<div class="modal fin-modal">' + obsah + '</div>';
    mo.classList.add('open');
    return mo;
  }
  window.finDetail = function (id) {
    var t = st.tx[id]; if (!t) return;
    st.otevrena = id;
    var kategorie = {}; Object.keys(st.tx).forEach(function (k) { if (st.tx[k].kategorie) kategorie[st.tx[k].kategorie] = 1; });
    var radek = function (l, v) { return v ? '<div class="fin-r"><span>' + l + '</span><b>' + esc(v) + '</b></div>' : ''; };
    okno('moFinDetail',
      '<div class="mh"><span class="mt2">' + esc(t.protistrana || 'Transakce') + '</span><button class="xb" onclick="cm(\'moFinDetail\')">✕</button></div>'
      + '<div class="fin-det-castka ' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</div>'
      + '<div class="fin-det-info">'
      + radek('Datum', datumText(t.datum)) + radek('Banka', BANKY[t.banka] || t.banka) + radek('Typ', t.typ)
      + radek('Účet protistrany', t.ucet) + radek('Zpráva', t.zprava) + radek('VS', t.vs)
      + (t.puvodniCastka ? radek('Původní částka', t.puvodniCastka) : '')
      + '</div>'
      + '<div class="fs"><div class="fs-title">Doklad</div>'
      + '<div class="fi"><label for="finDok">Odkaz na doklad (OneDrive)</label><input id="finDok" type="url" placeholder="https://…" value="' + esc(t.dokladUrl || '') + '"></div>'
      + (t.dokladUrl ? '<a class="faktura-link fin-otevrit" href="' + esc(t.dokladUrl) + '" target="_blank" rel="noopener">Otevřít doklad</a>' : '')
      + '<label class="fin-chk"><input type="checkbox" id="finBezDok"' + (t.bezDokladu ? ' checked' : '') + '> Doklad není potřeba (převod mezi vlastními účty, poplatek banky…)</label></div>'
      + '<div class="fs"><div class="fs-title">Zařazení</div><div class="fg">'
      + '<div class="fi"><label for="finKat">Kategorie</label><input id="finKat" list="finKatSeznam" placeholder="Nákup zboží, Prodej, Poštovné…" value="' + esc(t.kategorie || '') + '">'
      + '<datalist id="finKatSeznam">' + Object.keys(kategorie).sort().map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist></div>'
      + '<div class="fi full"><label for="finPozn">Poznámka</label><textarea id="finPozn" rows="2">' + esc(t.poznamka || '') + '</textarea></div>'
      + '</div></div>'
      + '<div class="btn-row"><button class="btn-sec fin-smazat" onclick="finSmaz(this)">Smazat transakci</button><button class="btn-pri" onclick="finUloz()">Uložit</button></div>');
    setTimeout(function () { var i = document.getElementById('finDok'); if (i && !t.dokladUrl) i.focus(); }, 30);
  };
  window.finUloz = function () {
    var id = st.otevrena, t = st.tx[id]; if (!t) return;
    var url = (document.getElementById('finDok').value || '').trim();
    if (url && !jeOdkaz(url)) { toast('Odkaz na doklad musí začínat https://', 'err'); return; }
    var zmena = { dokladUrl: url, bezDokladu: !!document.getElementById('finBezDok').checked,
      kategorie: (document.getElementById('finKat').value || '').trim().slice(0, 60),
      poznamka: (document.getElementById('finPozn').value || '').trim().slice(0, 2000), upraveno: Date.now() };
    Object.assign(t, zmena);
    zapis(id, zmena, true).then(function () { toast('Uloženo.'); }).catch(function () {});
    cm('moFinDetail'); vykresli();
  };
  window.finSmaz = function (btn) {
    if (!btn.dataset.jiste) { btn.dataset.jiste = '1'; btn.textContent = 'Opravdu smazat?'; return; }
    var id = st.otevrena, fns = window._fbFns;
    delete st.tx[id];
    fns.deleteDoc(fns.doc(window._fbDb, 'users', uid(), 'finance', id)).catch(chybaZapisu).catch(function () {});
    cm('moFinDetail'); vykresli();
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
    s = String(s || '').replace(/\s| /g, '');
    if (!s) return NaN;
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') !== -1 && s.lastIndexOf('.') < s.lastIndexOf(',')) s = s.replace(/\./g, '');   // 1.234,56
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
  function nactiTransakce(radky, banka) {
    if (radky.length < 2) return { chyba: 'Soubor nemá žádné řádky s pohyby.' };
    var hl = radky[0].map(bezDiakritiky), map = {};
    Object.keys(FIN_SLOUPCE).forEach(function (k) {
      for (var i = 0; i < FIN_SLOUPCE[k].length; i++) { var j = hl.indexOf(FIN_SLOUPCE[k][i]); if (j !== -1) { map[k] = j; return; } }
    });
    if (map.datum == null || map.castka == null) {
      return { chyba: 'Ve výpisu jsem nenašel sloupec s ' + (map.datum == null ? 'datem' : 'částkou') + '. Pošli mi ten soubor a doplním ho.', hlavicka: radky[0] };
    }
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
    return { tx: tx, vynechano: vynechano, sloupce: map };
  }
  function dekoduj(buf) {
    var t = new TextDecoder('utf-8').decode(buf);
    if (t.indexOf('�') !== -1) { try { t = new TextDecoder('windows-1250').decode(buf); } catch (e) {} }   // Air Bank umí i starší kódování
    return t;
  }
  window.finOtevriImport = function () {
    st.importData = null;
    okno('moFinImport',
      '<div class="mh"><span class="mt2">Importovat výpis</span><button class="xb" onclick="cm(\'moFinImport\')">✕</button></div>'
      + '<p class="fin-pom">V internetovém bankovnictví si stáhni výpis jako <b>CSV</b> (Air Bank: Historie plateb → Exportovat; Revolut: Statements → Excel/CSV). Pohyby, které už tu jsou, se nezdvojí.</p>'
      + '<div class="fin-banky">' + Object.keys(BANKY).map(function (k) { return '<label class="fin-banka-volba"><input type="radio" name="finBanka" value="' + k + '"' + ((st.zalozka === k || (st.zalozka === 'vse' && k === 'airbank')) ? ' checked' : '') + '> ' + BANKY[k] + '</label>'; }).join('') + '</div>'
      + '<input type="file" id="finSoubor" accept=".csv,text/csv,text/plain" onchange="finNactiSoubor(this)">'
      + '<div id="finNahled" class="fin-nahled"></div>'
      + '<div class="btn-row"><button class="btn-sec" onclick="cm(\'moFinImport\')">Zrušit</button><button class="btn-pri" id="finImportuj" disabled onclick="finImportuj()">Importovat</button></div>');
  };
  window.finNactiSoubor = function (inp) {
    var f = inp.files && inp.files[0]; if (!f) return;
    var banka = (document.querySelector('input[name="finBanka"]:checked') || {}).value || 'airbank';
    var r = new FileReader();
    r.onload = function () { finZpracujText(dekoduj(r.result), banka); };
    r.readAsArrayBuffer(f);
  };
  window.finZpracujText = function (text, banka) {
    var v = nactiTransakce(rozdelCsv(text), banka), nah = document.getElementById('finNahled'), btn = document.getElementById('finImportuj');
    if (v.chyba) { st.importData = null; nah.innerHTML = '<div class="fin-chyba">' + esc(v.chyba) + '</div>'; if (btn) btn.disabled = true; return v; }
    var nove = v.tx.filter(function (t) { return !st.tx[t.id]; });
    st.importData = nove;
    nah.innerHTML = '<div class="fin-nahled-sum"><b>' + nove.length + '</b> nových pohybů · ' + (v.tx.length - nove.length) + ' už tu je'
      + (v.vynechano ? ' · ' + v.vynechano + ' vynecháno (bez data/částky nebo nedokončené)' : '') + '</div>'
      + nove.slice(0, 5).map(function (t) { return '<div class="fin-nahled-r"><span>' + esc(datumText(t.datum)) + '</span><span>' + esc(t.protistrana || t.zprava || '—') + '</span><b class="' + (t.castka < 0 ? 'minus' : 'plus') + '">' + castkaText(t.castka, t.mena) + '</b></div>'; }).join('')
      + (nove.length > 5 ? '<div class="fin-pom">… a dalších ' + (nove.length - 5) + '</div>' : '');
    if (btn) btn.disabled = !nove.length;
    return v;
  };
  window.finImportuj = function () {
    var nove = st.importData || []; if (!nove.length) return;
    var fns = window._fbFns, u = uid();
    if (!fns || !window._fbDb || !u) { toast('Finance jdou jen přes cloud — přihlas se.', 'err'); return; }
    var ted = Date.now(), davky = [];
    for (var i = 0; i < nove.length; i += 400) davky.push(nove.slice(i, i + 400));
    Promise.all(davky.map(function (d) {
      var b = fns.writeBatch(window._fbDb);
      d.forEach(function (t) { var x = Object.assign({}, t); delete x.id; x.importovano = ted; b.set(fns.doc(window._fbDb, 'users', u, 'finance', t.id), x); });
      return b.commit();
    })).then(function () {
      toast('Importováno ' + nove.length + ' pohybů.');
    }).catch(function (e) { try { chybaZapisu(e); } catch (x) {} });
    nove.forEach(function (t) { st.tx[t.id] = Object.assign({ importovano: ted }, t); });
    st.importData = null;
    cm('moFinImport');
    // Ať je hned vidět, co přibylo: měsíc posledního pohybu z výpisu
    var nejnovejsi = nove.map(function (t) { return t.datum; }).sort().pop();
    if (nejnovejsi) { st.rok = +nejnovejsi.slice(0, 4); st.mesic = +nejnovejsi.slice(5, 7) - 1; }
    vykresli();
  };

  /* ── Napojení na aplikaci ── */
  window.finSpust = finSpust;
  window.finZastav = finZastav;
  window.prepniProstredi = prepniProstredi;
  window.finStav = st;   // pro testy
  window._finNactiTransakce = function (text, banka) { return nactiTransakce(rozdelCsv(text), banka); };
  window.finChybiDoklad = finChybiDoklad;
})();
