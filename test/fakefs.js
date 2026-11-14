// Falešný Firestore v prohlížeči — dovolí testovat skutečné ukládací cesty aplikace
module.exports = function installFakeFirestore() {
  window.__store = {};
  window.__commits = 0;
  window.__lastBatch = [];
  window.__failWrites = false;
  window.__reads = [];
  var clone = function(v) { return JSON.parse(JSON.stringify(v)); };
  function mkRef(args) { return { path: [].slice.call(args, 1).join('/') }; }
  /* Posluchač kolekce zpráv (ZPRÁVY A POZNÁMKY). Ozve se sám po
     každém zápisu do své kolekce — jako skutečný Firestore, který
     ohlásí i vlastní zápis hned. Sklad zůstává na ručním
     __emitSnapshot, na tom stojí testy synchronizace. */
  window.__posluchaci = {};
  function snimekKolekce(cesta) {
    var pre = cesta + '/';
    var keys = Object.keys(window.__store).filter(function(k) {
      return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1;
    });
    return {
      forEach: function(f) {
        keys.forEach(function(k) { f({ id: k.slice(pre.length), ref: { path: k }, data: function() { return clone(window.__store[k]); } }); });
      },
    };
  }
  function ozvi(cestaDokumentu) {
    var kol = cestaDokumentu.slice(0, cestaDokumentu.lastIndexOf('/'));
    if (window.__posluchaci[kol]) setTimeout(window.__posluchaci[kol], 0);
  }
  window.__ozviKolekci = function(kol) { if (window.__posluchaci[kol]) window.__posluchaci[kol](); };
  window._fbDb = { fake: true };
  window._fbUser = { uid: 'u1' };
  window._fbFns = {
    doc: function() { return mkRef(arguments); },
    collection: function() { return mkRef(arguments); },
    getDoc: function(ref) {
      window.__reads.push(ref.path);
      var has = Object.prototype.hasOwnProperty.call(window.__store, ref.path);
      return Promise.resolve({
        exists: function() { return has; },
        data: function() { return has ? clone(window.__store[ref.path]) : undefined; },
        ref: ref,
      });
    },
    getDocs: function(col) {
      var pre = col.path + '/';
      var keys = Object.keys(window.__store).filter(function(k) {
        return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1;
      });
      return Promise.resolve({
        forEach: function(f) {
          keys.forEach(function(k) {
            f({ id: k.slice(pre.length), ref: { path: k }, data: function() { return clone(window.__store[k]); } });
          });
        },
      });
    },
    setDoc: function(ref, data, opts) {
      if (window.__failWrites) return Promise.reject(new Error('offline'));
      window.__store[ref.path] = (opts && opts.merge)
        ? Object.assign({}, window.__store[ref.path] || {}, clone(data))
        : clone(data);
      ozvi(ref.path);
      return Promise.resolve();
    },
    deleteDoc: function(ref) {
      if (window.__failWrites) return Promise.reject(new Error('offline'));
      delete window.__store[ref.path];
      ozvi(ref.path);
      return Promise.resolve();
    },
    writeBatch: function() {
      var ops = [];
      return {
        set: function(ref, data, opts) { ops.push({ t: 'set', path: ref.path, data: clone(data), merge: !!(opts && opts.merge) }); },
        delete: function(ref) { ops.push({ t: 'del', path: ref.path }); },
        commit: function() {
          if (window.__failWrites) return Promise.reject(new Error('offline'));
          ops.forEach(function(o) {
            if (o.t === 'set') window.__store[o.path] = o.merge ? Object.assign({}, window.__store[o.path] || {}, o.data) : o.data; else delete window.__store[o.path];
            ozvi(o.path);   // posluchači zpráv a financí; sklad má vlastní __emitSnapshot
          });
          window.__commits++;
          window.__lastBatch = ops.map(function(o) { return o.t + ' ' + o.path; });
          return Promise.resolve();
        },
      };
    },
    // onSnapshot nad kolekcí — snímek se skládá ze všech dokumentů pod cestou
    onSnapshot: function(ref, next, err) {
      if (/\/(zpravy|finance)$/.test(ref.path)) {
        var emit = function() { next(snimekKolekce(ref.path)); };
        window.__posluchaci[ref.path] = emit;
        setTimeout(emit, 0);
        return function() { if (window.__posluchaci[ref.path] === emit) delete window.__posluchaci[ref.path]; };
      }
      function mkSnap() {
        var pre = ref.path + '/';
        var keys = Object.keys(window.__store).filter(function(k) {
          return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1;
        });
        return {
          forEach: function(f) {
            keys.forEach(function(k) { f({ id: k.slice(pre.length), ref: { path: k }, data: function() { return clone(window.__store[k]); } }); });
          },
        };
      }
      window.__emitSnapshot = function() { next(mkSnap()); };
      window.__emitSnapshotError = function(e) { if (err) err(e); };
      return function() { window.__emitSnapshot = null; };
    },
    deleteUser: function() { return Promise.resolve(); },
    signOut: function() { return Promise.resolve(); },
  };
  // Kopie dokumentu — skutečný Firestore taky vrací vlastní objekty, ne odkaz do úložiště
  window.__doc = function(name) {
    var v = window.__store['users/u1/sklad/' + name];
    return v ? clone(v) : undefined;
  };
  /* Označí zařízení za takové, které už první snímek z cloudu dostalo.
     Bez toho aplikace zápis odmítne — viz test-zarizeni.js, kde se
     tahle ochrana testuje. Testy, které zkoumají jen mechaniku zápisu
     (dávky, archivy, fotky), si tím zkrátí cestu. */
  window.__cloudUzVideny = function() { _fbCloudReady = true; };
  // Zapomeň stav archivů, ať každý test začíná jako čerstvé zařízení
  window.__resetDevice = function() {
    _archiveHashes = {}; _archiveCache = null; _cloudIncomplete = false;
    _itemCacheLoaded = false; _lastOwnSavedAt = null;
  };
  // Načtení z cloudu přesně tak, jak to dělá posluchač kolekce
  window.__load = function() {
    var c = _collectCloud(window.__snapshot());
    if (!c) return null;
    _rememberArchives(c.byYear);
    _rememberPhotos(c.photos);
    _cloudIncomplete = c.archiveItems === null && !(c.data.items && c.data.items.length);
    var ok = _cloudIncomplete ? false : _applyCloudData(c.data, c.archiveItems, c.photos);
    try { _applyItemCacheDoc(c.cache, c.data.itemCache); } catch(e) {}
    return { ok: ok, pocet: items.length, neuplne: _cloudIncomplete, chybi: c.missing, archivy: c.archiveItems };
  };
  // Snímek celé kolekce, jak ho vidí aplikace — pro testy čtecí cesty
  window.__snapshot = function() {
    var pre = 'users/u1/sklad/';
    var keys = Object.keys(window.__store).filter(function(k) {
      return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') === -1;
    });
    return {
      forEach: function(f) {
        keys.forEach(function(k) { f({ id: k.slice(pre.length), ref: { path: k }, data: function() { return clone(window.__store[k]); } }); });
      },
    };
  };
};
