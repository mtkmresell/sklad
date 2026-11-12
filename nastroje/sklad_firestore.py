#!/usr/bin/env python3
"""
SKLAD — data aplikace pro lokální kontroly listingů (Python, bez instalace).

Kontroly listingů (Bazoš a další) běží na domácím PC. Tenhle modul jim
dá dvě věci, které dřív dělal Claude v chatu:

  1. ČTENÍ  — sklad přímo z Firestore, místo ručně obnovovaného sklad.json
              (`nacti_sklad`, příkaz `sklad`).
  2. ZÁPIS  — fajfky a výsledek kontroly do aplikace (`posli_fajfky`,
              `posli_kontrolu`, příkazy `fajfky` a `kontrola`).

Zapisuje se **stejnou cestou jako konektor** (konektor/worker.js,
POŽADAVEK PRO APLIKACI): do skladu se nesahá, jen se položí lísteček
`pozadavek_…` a provede ho aplikace (index.html, POŽADAVKY Z KONEKTORU)
se všemi svými branami. Druhý zapisovatel do skladu by se pral se
synchronizací aplikace a neodeslaná změna by zmizela.

Přihlašuje se účtem **čtečky** — tím samým, kterým se hlásí konektor.
Pravidla Firestore mu dovolí sklad číst a zapsat jedině lísteček; víc
neudělá, ani kdyby se tenhle soubor pokazil. Heslo **nikdy neleží
v souboru na Disku**: bere se ze Správce pověření Windows (příkaz
`nastavit`), nebo z proměnných prostředí SKLAD_EMAIL a SKLAD_HESLO.

Jen standardní knihovna — Python z Microsoft Store stačí.

Příkazy (python sklad_firestore.py …):
  nastavit                      uloží přihlášení čtečky do Správce pověření
  test                          přihlásí se a řekne, co ve skladu vidí
  sklad [sklad.json]            uloží sklad ve formátu [id, název, velikost, cz, sk]
                                (a vedle prodane.json s prodanými kusy)
  fajfky soubor.json [--odeslat]     {"zmeny": [{"id", "platforma", "zaskrtnout"}]}
  kontrola soubor.json [--odeslat]   {"misto", "chybi", "smazat", "nejde", "opravit", "neniVeSkladu",
                                      "inzeratu", "limit", "report", "web", "poznamka"}

Bez --odeslat se jen ukáže, co by se poslalo, a nic se nezapíše.

Podrobnosti a postup: nastroje/LOKALNI_KONTROLY.md
"""

import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

PROJEKT = 'sklad-7eec9'
# Veřejný klíč projektu — je i v index.html; přístup hlídá přihlášení a pravidla
API_KEY = 'AIzaSyDS1e4Y3LfglhKsLryxJZYqrfMSCZ9evnU'
# Adresy jdou přepsat jen kvůli testům (test/test-skladpy.js)
AUTH_URL = os.environ.get('SKLAD_AUTH_URL') or (
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY)
FS_BASE = os.environ.get('SKLAD_FS_BASE') or (
    'https://firestore.googleapis.com/v1/projects/' + PROJEKT + '/databases/(default)/documents')

# Čí sklad se čte. UID nejsou tajemství (stojí i ve firestore.rules),
# přístup dokazuje přihlášení.
MAJITEL_UID = 'p6JKNhfrbmZYaF8OIBxgd9durmq2'

# Pod tímhle jménem leží přihlášení ve Správci pověření Windows
POVERENI_JMENO = 'SKLAD-kontroly'

# Kusy na těchhle místech už nejsou skladem — do kontroly nepatří
# (zadání kontroly: „Ze skladu vyřadit jen location Zrušeno, Vráceno,
# Poškozené". „Bude vráceno" a „Na cestě" skladem jsou.)
VYRADIT_MISTA = ('Zrušeno', 'Vráceno', 'Poškozené')

# Lísteček pro aplikaci. Pravidla Firestore pustí čtečku jedině na
# dokument s tímhle jménem (^pozadavek_[A-Za-z0-9_-]{1,60}$).
POZADAVEK_PREFIX = 'pozadavek_'
KONTROLA_NEJVIC = 500  # stejný strop jako v konektoru a v aplikaci


class ChybaSkladu(Exception):
    """Chyba, kterou jde říct člověku jednou větou."""


# ── Přihlašovací údaje ──────────────────────────────────────────────────
#
# Správce pověření Windows je trezor, který Windows mají pro hesla
# (Ovládací panely → Správce pověření). Je zamčený tvým přihlášením do
# Windows a nesynchronizuje se na Google Disk ani do mobilu — na rozdíl
# od souboru ve složce MTKM-kontroly.

def _poverovani():
    """Funkce Správce pověření přes ctypes, nebo None mimo Windows."""
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes

    class FILETIME(ctypes.Structure):
        _fields_ = [('dwLowDateTime', wintypes.DWORD), ('dwHighDateTime', wintypes.DWORD)]

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ('Flags', wintypes.DWORD),
            ('Type', wintypes.DWORD),
            ('TargetName', wintypes.LPWSTR),
            ('Comment', wintypes.LPWSTR),
            ('LastWritten', FILETIME),
            ('CredentialBlobSize', wintypes.DWORD),
            ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)),
            ('Persist', wintypes.DWORD),
            ('AttributeCount', wintypes.DWORD),
            ('Attributes', ctypes.c_void_p),
            ('TargetAlias', wintypes.LPWSTR),
            ('UserName', wintypes.LPWSTR),
        ]

    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wintypes.DWORD]
    advapi.CredWriteW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    advapi.CredFree.restype = None
    return ctypes, CREDENTIAL, advapi


def uloz_pristup(email, heslo, jmeno=None, popis='Účet čtečky pro lokální kontroly SKLADu'):
    """Uloží e-mail a heslo do Správce pověření Windows (výchozí: účet čtečky)."""
    w = _poverovani()
    if not w:
        raise ChybaSkladu('Správce pověření je jen ve Windows. Jinde nastav proměnné '
                          'SKLAD_EMAIL a SKLAD_HESLO.')
    ctypes, CREDENTIAL, advapi = w
    data = heslo.encode('utf-16-le')
    blob = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    c = CREDENTIAL()
    c.Type = 1                 # CRED_TYPE_GENERIC
    c.TargetName = jmeno or POVERENI_JMENO
    c.Comment = popis
    c.CredentialBlobSize = len(data)
    c.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
    c.Persist = 2              # CRED_PERSIST_LOCAL_MACHINE — přežije restart
    c.UserName = email
    if not advapi.CredWriteW(ctypes.byref(c), 0):
        raise ChybaSkladu('Windows přihlášení neuložily (chyba %d).' % ctypes.get_last_error())


def _cti_pristup_windows(jmeno=None):
    w = _poverovani()
    if not w:
        return None
    ctypes, CREDENTIAL, advapi = w
    p = ctypes.POINTER(CREDENTIAL)()
    if not advapi.CredReadW(jmeno or POVERENI_JMENO, 1, 0, ctypes.byref(p)):
        return None
    try:
        c = p.contents
        heslo = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode('utf-16-le')
        return c.UserName, heslo
    finally:
        advapi.CredFree(p)


def nacti_pristup():
    """(email, heslo) — z proměnných prostředí, jinak ze Správce pověření."""
    email = (os.environ.get('SKLAD_EMAIL') or '').strip()
    heslo = os.environ.get('SKLAD_HESLO') or ''
    if email and heslo:
        return email, heslo
    try:
        z = _cti_pristup_windows()
    except Exception:
        z = None
    if z and z[0] and z[1]:
        return z
    raise ChybaSkladu('Chybí přihlášení. Spusť jednou:  python sklad_firestore.py nastavit')


# ── Přihlášení k webům míst prodeje (TheBeast, Sellect, Tuzex…) ─────────
#
# Majitel souhlasil (12. 11. 2026), ať si kontroly hesla k webům pamatují
# a přihlašují se samy. Leží ve stejném trezoru jako účet čtečky, každé
# místo pod vlastním jménem „SKLAD-web-<místo>". Nikdy v souboru na Disku.

def _jmeno_webu(misto):
    return 'SKLAD-web-' + ''.join(c for c in str(misto) if c.isalnum())


def prihlaseni_webu(misto, zeptat=True):
    """(email, heslo, nove) — z prostředí, ze Správce pověření, jinak se zeptá.

    nove=True znamená, že se právě zadalo: volající ho po úspěšném
    přihlášení uloží (uloz_prihlaseni_webu), ať se špatné heslo neuloží."""
    klic = ''.join(c for c in str(misto) if c.isalnum()).upper()
    email = (os.environ.get('SKLAD_%s_EMAIL' % klic) or '').strip()
    heslo = os.environ.get('SKLAD_%s_HESLO' % klic) or ''
    if email and heslo:
        return email, heslo, False
    try:
        z = _cti_pristup_windows(_jmeno_webu(misto))
    except Exception:
        z = None
    if z and z[0] and z[1]:
        return z[0], z[1], False
    if not zeptat:
        raise ChybaSkladu('Chybí přihlášení k %s.' % misto)
    import getpass
    print('Přihlášení k %s (uloží se do Správce pověření Windows, příště se neptá).' % misto)
    email = input('E-mail na %s: ' % misto).strip()
    print('Heslo zkopíruj (Ctrl+C) a tady dej jen Enter. Nebo ho napiš — při psaní se nic neukazuje.')
    heslo = getpass.getpass('Heslo: ')
    if not heslo:
        heslo = heslo_ze_schranky()
        vymaz_schranku()
    if not email or not heslo:
        raise ChybaSkladu('Přihlášení k %s nevyplněné.' % misto)
    return email, heslo, True


def uloz_prihlaseni_webu(misto, email, heslo):
    try:
        uloz_pristup(email, heslo, _jmeno_webu(misto), 'Přihlášení k %s pro kontrolu SKLADu' % misto)
        print('Přihlášení k %s uloženo do Správce pověření Windows.' % misto)
    except ChybaSkladu as e:
        print('(Přihlášení se neuložilo: %s)' % e)


def zapomen_prihlaseni_webu(misto):
    """Smaže uložené heslo (špatné nebo změněné) — příště se program zeptá znovu."""
    w = _poverovani()
    if not w:
        return
    ctypes, CREDENTIAL, advapi = w
    try:
        advapi.CredDeleteW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
        advapi.CredDeleteW(_jmeno_webu(misto), 1, 0)
    except Exception:
        pass


# ── HTTP a Firestore ────────────────────────────────────────────────────

def _http(url, telo=None, token=None, metoda=None):
    hlavicky = {'Content-Type': 'application/json'}
    if token:
        hlavicky['Authorization'] = 'Bearer ' + token
    data = json.dumps(telo).encode('utf-8') if telo is not None else None
    req = urllib.request.Request(url, data=data, headers=hlavicky,
                                 method=metoda or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            obsah = r.read().decode('utf-8')
            return r.status, (json.loads(obsah) if obsah else None)
    except urllib.error.HTTPError as e:
        obsah = e.read().decode('utf-8', 'replace')
        try:
            j = json.loads(obsah)
        except ValueError:
            j = {'raw': obsah[:300]}
        return e.code, j
    except urllib.error.URLError as e:
        raise ChybaSkladu('Nejde se spojit s Googlem (%s). Jede internet?' % e.reason)


def prihlas(email=None, heslo=None):
    """Přihlásí účet a vrátí token (platí hodinu)."""
    if email is None:
        email, heslo = nacti_pristup()
    status, j = _http(AUTH_URL, {'email': email, 'password': heslo, 'returnSecureToken': True})
    if status != 200 or not j or not j.get('idToken'):
        zprava = ((j or {}).get('error') or {}).get('message', str(status))
        if 'INVALID' in zprava or 'PASSWORD' in zprava or 'EMAIL' in zprava:
            raise ChybaSkladu('Přihlášení nesedí (špatný e-mail nebo heslo). '
                              'Ulož ho znovu:  python sklad_firestore.py nastavit')
        raise ChybaSkladu('Přihlášení selhalo: ' + zprava)
    return j['idToken']


def rozbal(v):
    """Hodnota z Firestore → obyčejná hodnota Pythonu."""
    if not isinstance(v, dict):
        return v
    if 'nullValue' in v:
        return None
    if 'stringValue' in v:
        return v['stringValue']
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'integerValue' in v:
        return int(v['integerValue'])
    if 'doubleValue' in v:
        return float(v['doubleValue'])
    if 'timestampValue' in v:
        return v['timestampValue']
    if 'arrayValue' in v:
        return [rozbal(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v:
        return rozbal_pole(v['mapValue'].get('fields', {}))
    return None


def rozbal_pole(pole):
    return {k: rozbal(x) for k, x in (pole or {}).items()}


def zabal(v):
    """Obyčejná hodnota → hodnota pro Firestore (opak `rozbal`)."""
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, (int, float)):
        return {'doubleValue': float(v)}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, (list, tuple)):
        return {'arrayValue': {'values': [zabal(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: zabal(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}


# ── Čtení skladu ────────────────────────────────────────────────────────
#
# Jako v aplikaci i v konektoru (nactiSklad): nejdřív jen jména
# dokumentů, pak jedno hromadné čtení — hlavní dokument a roční archivy
# dorazí ze stejného okamžiku a nerozejdou se. Fotky se nestahují.

def nacti_sklad(token, uid=MAJITEL_UID):
    """Vrátí (data, polozky): hlavní dokument a všechny kusy (sklad + archivy prodejů)."""
    jmena, stranka = [], None
    while True:
        url = FS_BASE + '/users/' + uid + '/sklad?pageSize=300&mask.fieldPaths=savedAt'
        if stranka:
            url += '&pageToken=' + urllib.request.quote(stranka)
        status, j = _http(url, token=token)
        if status == 404:
            break
        if status != 200:
            raise ChybaSkladu('Čtení skladu selhalo (%s).' % status)
        jmena += [d['name'] for d in (j or {}).get('documents', [])]
        stranka = (j or {}).get('nextPageToken')
        if not stranka:
            break
    chtene = [n for n in jmena if not n.rsplit('/', 1)[-1].startswith(('photo_', POZADAVEK_PREFIX))]
    if not chtene:
        raise ChybaSkladu('Ve skladu nejsou žádná data.')
    status, davka = _http(FS_BASE + ':batchGet', {'documents': chtene}, token=token)
    if status != 200:
        raise ChybaSkladu('Hromadné čtení skladu selhalo (%s).' % status)
    data, archivy = None, {}
    for radek in davka or []:
        nalez = radek.get('found')
        if not nalez:
            continue
        jmeno = nalez['name'].rsplit('/', 1)[-1]
        obsah = rozbal_pole(nalez.get('fields'))
        if jmeno == 'data':
            data = obsah
        elif jmeno.startswith('sold_'):
            archivy[jmeno[5:]] = obsah.get('items') or []
    if not data:
        raise ChybaSkladu('Hlavní dokument skladu chybí.')
    return data, sloz_polozky(data, archivy)


def sloz_polozky(data, archivy):
    """Stejně jako slozPolozky v konektoru."""
    hlavni = data.get('itemsStock') or []
    roky = data.get('archiveYears') or []
    z_archivu = [it for r in roky for it in (archivy.get(str(r)) or archivy.get(r) or [])]
    if not hlavni and not z_archivu and isinstance(data.get('items'), list):
        return data['items']
    return list(hlavni) + z_archivu


def stav(it):
    return it.get('saleState') or 'stock'


def mista_prodeje(data):
    """Místa prodeje, jak je má majitel v nastavení aplikace (platGroups)."""
    g = data.get('platGroups')
    if isinstance(g, str):
        try:
            g = json.loads(g)
        except ValueError:
            g = {}
    g = g or {}
    return list(g.get('platforms') or []) + list(g.get('eshopy') or []) + list(g.get('local') or [])


def skladem(polozky):
    """Kusy, které se kontrolují: na skladě, mimo vyřazená místa, bez balíků."""
    return [it for it in polozky if it and it.get('type') != 'bulk' and stav(it) == 'stock'
            and (it.get('location') or '') not in VYRADIT_MISTA]


def prodane(polozky):
    return [it for it in polozky if it and it.get('type') != 'bulk' and stav(it) in ('waiting', 'paid')]


def radek_bazos(it):
    """[id, název, velikost, cz, sk] — formát dosavadního sklad.json."""
    p = it.get('platforms') or []
    return [it.get('id'), it.get('name') or '', it.get('size') or '',
            'Bazoš.cz' in p, 'Bazoš.sk' in p]


# ── Zápis lístečku pro aplikaci ─────────────────────────────────────────

def _jmeno_listecku():
    cas = ''
    n = int(time.time() * 1000)
    abeceda = string.digits + string.ascii_lowercase
    while n:
        n, z = divmod(n, 36)
        cas = abeceda[z] + cas
    return POZADAVEK_PREFIX + cas + '_' + ''.join(random.choice(abeceda) for _ in range(6))


def _iso_ted():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _zapis_dokument(token, uid, jmeno, obsah):
    """Jediné místo, které do Firestore zapisuje — a jen pod pozadavek_…"""
    if not jmeno.startswith(POZADAVEK_PREFIX):
        raise ChybaSkladu('Zapisovat se smí jen pod %s…' % POZADAVEK_PREFIX)
    telo = {'fields': zabal(obsah)['mapValue']['fields']}
    status, j = _http(FS_BASE + '/users/' + uid + '/sklad/' + jmeno, telo, token=token, metoda='PATCH')
    if status == 403:
        raise ChybaSkladu('Firestore zápis odmítl (403). Buď je přihlášený jiný účet než čtečka, '
                          'nebo v konzoli Firebase leží stará pravidla (chybí jePozadavekCtecky).')
    if status != 200:
        raise ChybaSkladu('Zápis do cloudu selhal (%s).' % status)
    return jmeno


def _zapis_listecek(token, uid, obsah):
    return _zapis_dokument(token, uid, _jmeno_listecku(), dict({'kdy': _iso_ted()}, **obsah))


def posli_fajfky(token, data, polozky, zmeny, odeslat=False, uid=MAJITEL_UID):
    """Zaškrtnutí / odškrtnutí místa prodeje u kusů na skladě.

    zmeny = [{"id": "...", "platforma": "Bazoš.cz", "zaskrtnout": True}, ...]
    Stejné kontroly jako sklad_listing v konektoru. Bez odeslat=True jen náhled.
    """
    mista = mista_prodeje(data)
    if not mista:
        return {'stav': 'nezname_mista', 'poznamka': 'V cloudu chybí nastavení míst prodeje — otevři aplikaci.'}
    platne, nelze = [], []
    for z in zmeny or []:
        z = z or {}
        id_, plat = z.get('id'), z.get('platforma')
        if not isinstance(id_, str) or not id_:
            nelze.append({'zmena': z, 'duvod': 'chybí id položky'})
            continue
        if plat not in mista:
            nelze.append({'id': id_, 'duvod': 'takové místo prodeje v nastavení není: %s' % plat})
            continue
        it = next((x for x in polozky if x and x.get('id') == id_), None)
        if not it:
            nelze.append({'id': id_, 'duvod': 'položka s tímhle id ve skladu není'})
            continue
        if stav(it) != 'stock':
            nelze.append({'id': id_, 'nazev': it.get('name'), 'duvod': 'kus není na skladě'})
            continue
        zaskrtnout = z.get('zaskrtnout') is not False
        if (plat in (it.get('platforms') or [])) == zaskrtnout:
            nelze.append({'id': id_, 'nazev': it.get('name'),
                          'duvod': 'už je zaškrtnuté' if zaskrtnout else 'zaškrtnuté ani není'})
            continue
        platne.append({'id': id_, 'platforma': plat, 'zaskrtnout': zaskrtnout})
    vysledek = {'zmeny': platne, 'nelze': nelze}
    if not platne:
        vysledek['stav'] = 'nic_k_provedeni'
        return vysledek
    if not odeslat:
        vysledek['stav'] = 'nahled'
        return vysledek
    vysledek['dokument'] = _zapis_listecek(token, uid, {'zmeny': platne})
    vysledek['stav'] = 'zadano'
    return vysledek


def _inzeraty(seznam, s_ids, polozky, pozor, druh):
    """Opravit / Není ve SKLADu — inzeráty, ne kusy. Odkaz jen http(s)."""
    podle_id = {it.get('id') for it in polozky if it}
    out = []
    for x in list(seznam or [])[:KONTROLA_NEJVIC]:
        if not isinstance(x, dict):
            continue
        odkaz = str(x.get('odkaz') or '').strip()
        if odkaz and (not odkaz.lower().startswith(('https://', 'http://')) or len(odkaz) > 500):
            pozor.append({'duvod': 'odkaz u %s „%s“ se neuložil — musí začínat https://' % (druh, x.get('nazev'))})
            odkaz = ''
        o = {'nazev': str(x.get('nazev') or '')[:200], 'velikost': str(x.get('velikost') or '')[:100], 'odkaz': odkaz}
        if s_ids:
            o['inzerat'] = str(x.get('inzerat') or '')[:200]
            o['sklad'] = str(x.get('sklad') or '')[:200]
            o['ids'] = [i for i in (x.get('ids') or []) if isinstance(i, str) and i in podle_id][:50]
        if o['nazev'] or o['odkaz']:
            out.append(o)
    return out


def posli_kontrolu(token, data, polozky, misto, chybi=(), smazat=(), nejde=(), report='', web='',
                   poznamka='', datum=None, odeslat=False, uid=MAJITEL_UID,
                   opravit=(), neni_ve_skladu=(), inzeratu=None, limit=None):
    """Výsledek kontroly jednoho místa → okno Kontroly listingů v aplikaci.

    chybi  = id kusů skladem, které na místě nevisí (sekce Přidat)
    smazat = id prodaných kusů, které tam pořád visí (sekce Smazat)
    nejde  = [{"id": ..., "duvod": "..."}] kusy, které místo nevezme
    opravit = [{"nazev", "odkaz", "inzerat": "41, 42.5", "sklad": "42.5, 44", "ids": [...]}]
             inzeráty, kde velikosti nesedí se skladem (ids = kusy skladem, nepovinné)
    neni_ve_skladu = [{"nazev", "odkaz", "velikost"}] inzerát běží, kus ve skladu nikdy nebyl
    inzeratu, limit = počet inzerátů na místě a jeho limit (Bazoš 50)
    Stejný tvar jako sklad_kontrola v konektoru; ukládá se i čistá
    kontrola bez nálezů („vše sedí" je taky zpráva). Bez odeslat=True jen náhled.
    """
    mista = mista_prodeje(data)
    if not mista:
        return {'stav': 'nezname_mista', 'poznamka': 'V cloudu chybí nastavení míst prodeje — otevři aplikaci.'}
    if misto not in mista:
        return {'stav': 'nezname_misto', 'poznamka': 'Takové místo prodeje v nastavení není: %s' % misto,
                'mista_v_nastaveni': mista}
    for seznam in (chybi, smazat, nejde, opravit, neni_ve_skladu):
        if len(seznam or []) > KONTROLA_NEJVIC:
            return {'stav': 'moc_polozek', 'poznamka': 'Najednou nejvýš %d položek v seznamu.' % KONTROLA_NEJVIC}
    podle_id = {it.get('id'): it for it in polozky if it}
    nelze, pozor = [], []

    def prevod(seznam, druh):
        ids = []
        for id_ in seznam or []:
            it = podle_id.get(id_) if isinstance(id_, str) else None
            if not it:
                nelze.append({'seznam': druh, 'id': id_, 'duvod': 'položka s tímhle id ve skladu není'})
                continue
            ok = (stav(it) == 'stock') if druh != 'smazat' else (stav(it) in ('waiting', 'paid'))
            if it.get('type') == 'bulk' or not ok:
                nelze.append({'seznam': druh, 'id': id_, 'nazev': it.get('name'),
                              'duvod': 'kus není na skladě' if druh != 'smazat' else 'kus není prodaný'})
                continue
            if id_ in ids:
                continue
            ids.append(id_)
            if druh == 'chybi' and misto in (it.get('platforms') or []):
                pozor.append({'id': id_, 'nazev': it.get('name'),
                              'duvod': 'má fajfku u %s, ale podle kontroly tam nevisí — odškrtni ji' % misto})
        return ids

    chybi_ids = prevod(chybi, 'chybi')
    smazat_ids = prevod(smazat, 'smazat')
    nejde_ids = prevod([(x or {}).get('id') for x in (nejde or [])], 'nejde')
    duvody = {(x or {}).get('id'): str((x or {}).get('duvod') or '')[:200] for x in (nejde or [])}
    nejde_out = [{'id': i, 'duvod': duvody.get(i, '')} for i in nejde_ids]

    def odkaz(u, co):
        u = (u or '').strip()
        if u and (not u.lower().startswith('https://') or len(u) > 500):
            pozor.append({'duvod': 'odkaz na %s se neuložil — musí začínat https://' % co})
            return ''
        return u

    kontrola = {
        'misto': misto,
        'datum': datum or _iso_ted(),
        'report': odkaz(report, 'report'),
        'web': odkaz(web, 'e-shop'),
        'chybi': chybi_ids,
        'smazat': smazat_ids,
        'nejde': nejde_out,
        'poznamka': (poznamka or '')[:500],
        'opravit': _inzeraty(opravit, True, polozky, pozor, 'Opravit'),
        'neniVeSkladu': _inzeraty(neni_ve_skladu, False, polozky, pozor, 'Není ve SKLADu'),
        'inzeratu': inzeratu if isinstance(inzeratu, int) and inzeratu >= 0 else None,
        'limit': limit if isinstance(limit, int) and limit >= 0 else None,
    }
    vysledek = {'kontrola': kontrola, 'nelze': nelze, 'pozor': pozor}
    if not odeslat:
        vysledek['stav'] = 'nahled'
        return vysledek
    vysledek['dokument'] = _zapis_listecek(token, uid, {'kontrola': kontrola})
    vysledek['stav'] = 'zadano'
    return vysledek


# ── Report kontroly ─────────────────────────────────────────────────────
#
# Skript artifact v Claudovi vyrobit nemůže, a tak posílá report aplikaci:
# do dokumentu pozadavek_report_<místo> (pravidla čtečku pustí jen pod
# pozadavek_…). Aplikace ho na rozdíl od lístečku neprovádí ani nemaže —
# ukáže ho odkazem Report v okně Kontroly listingů (index.html, REPORT
# KONTROLY). Tvar je obecný: sekce si určuje kontrola, stránka vykreslí
# jakékoli.

REPORT_PREFIX = 'pozadavek_report_'
REPORT_BARVY = ('smazat', 'opravit', 'pridat', 'fajfky', 'neni', 'overit', 'info')


def klic_reportu(misto):
    """„Bazoš.cz" → „bazos-cz" — jméno dokumentu musí projít vzorkem v pravidlech."""
    import unicodedata
    t = unicodedata.normalize('NFKD', str(misto or '')).encode('ascii', 'ignore').decode('ascii').lower()
    t = ''.join(c if c.isalnum() else '-' for c in t).strip('-')
    while '--' in t:
        t = t.replace('--', '-')
    return (t or 'misto')[:40]


def _txt(v, n):
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) and not isinstance(v, bool) else ''


def _http_odkaz(u, n=500):
    u = (u or '').strip() if isinstance(u, str) else ''
    return u if u.lower().startswith(('https://', 'http://')) and len(u) <= n else ''


def _report_radky(radky, podle_id):
    out = []
    for r in list(radky or [])[:KONTROLA_NEJVIC]:
        if not isinstance(r, dict):
            continue
        o = {'nazev': _txt(r.get('nazev'), 200), 'velikost': _txt(r.get('velikost'), 100),
             'sku': _txt(r.get('sku'), 80), 'duvod': _txt(r.get('duvod'), 400),
             'odkaz': _http_odkaz(r.get('odkaz')), 'obrazek': _http_odkaz(r.get('obrazek'), 800),
             'ids': [i for i in (r.get('ids') or []) if isinstance(i, str) and i in podle_id][:50],
             'udaje': [{'popis': _txt(u.get('popis'), 60), 'hodnota': _txt(u.get('hodnota'), 120)}
                       for u in (r.get('udaje') or [])[:8] if isinstance(u, dict)]}
        if o['nazev'] or o['odkaz']:
            out.append(o)
    return out


def posli_report(token, data, polozky, report, odeslat=False, uid=MAJITEL_UID):
    """report = {misto, skupina, nadpis, datum, limit: {pocet, max}, souhrn: [text],
                 sekce: [{nazev, barva, poznamka, hromadne, radky: [{nazev, velikost, sku,
                 duvod, odkaz, obrazek, ids, udaje: [{popis, hodnota}]}]}]}
    Bez odeslat=True jen náhled."""
    mista = mista_prodeje(data)
    misto = (report or {}).get('misto')
    if not mista:
        return {'stav': 'nezname_mista', 'poznamka': 'V cloudu chybí nastavení míst prodeje — otevři aplikaci.'}
    if misto not in mista:
        return {'stav': 'nezname_misto', 'poznamka': 'Takové místo prodeje v nastavení není: %s' % misto}
    podle_id = {it.get('id') for it in polozky if it}
    lim = report.get('limit') if isinstance(report.get('limit'), dict) else None
    ven = {
        'misto': misto,
        'skupina': _txt(report.get('skupina'), 60) or misto,
        'nadpis': _txt(report.get('nadpis'), 120) or misto,
        'datum': report.get('datum') or _iso_ted(),
        'limit': {'pocet': int(lim['pocet']), 'max': int(lim['max'])}
                 if lim and isinstance(lim.get('pocet'), int) and isinstance(lim.get('max'), int) and lim['max'] > 0 else None,
        'souhrn': [_txt(t, 200) for t in (report.get('souhrn') or [])[:12] if _txt(t, 200)],
        'sekce': [{'nazev': _txt(s.get('nazev'), 120) or 'Sekce',
                   'barva': s.get('barva') if s.get('barva') in REPORT_BARVY else 'info',
                   'poznamka': _txt(s.get('poznamka'), 300), 'hromadne': s.get('hromadne') is True,
                   'radky': _report_radky(s.get('radky'), podle_id)}
                  for s in (report.get('sekce') or [])[:20] if isinstance(s, dict)],
    }
    jmeno = REPORT_PREFIX + klic_reportu(misto)
    vysledek = {'report': ven, 'dokument': jmeno}
    if not odeslat:
        vysledek['stav'] = 'nahled'
        return vysledek
    _zapis_dokument(token, uid, jmeno, ven)
    vysledek['stav'] = 'zadano'
    return vysledek


# ── Společný závěr kontroly ─────────────────────────────────────────────

def dokonci_kontrolu(token, data, polozky, zmeny, report, kontrola, argv, pred_odeslanim=None):
    """Náhled → (prodloužení na webu) → fajfky, report a kontrola (v tomhle pořadí).
    Posílá se vždy, bez ptaní (Gabro, 12. 11. 2026) — jen --nahled nic nepošle.

    kontrola = argumenty pro posli_kontrolu (misto, chybi, smazat, …).
    pred_odeslanim = co se má udělat na webu (Sellect, Hypeboost, KLEKT
    prodlužují nabídky) — vždy, jen v --nahled ne.
    Vrací True, když se poslalo."""
    def posli(tok, odeslat):
        return {'fajfky': posli_fajfky(tok, data, polozky, zmeny, odeslat=odeslat),
                'report': posli_report(tok, data, polozky, report, odeslat=odeslat),
                'kontrola': posli_kontrolu(tok, data, polozky, odeslat=odeslat, **kontrola)}
    nahled = posli(token, False)
    for co in nahled.values():
        for x in co.get('nelze') or []:
            print('  (neodešle se:', x.get('nazev') or x.get('id'), '—', x.get('duvod'), ')')
        if co.get('stav') in ('nezname_mista', 'nezname_misto'):
            raise ChybaSkladu(co.get('poznamka'))
    if '--nahled' in argv:
        print('\nJen náhled, nic se neposlalo.')
        return False
    if pred_odeslanim:
        pred_odeslanim()
    posli(prihlas(), True)     # nový token — prodlužování mohlo trvat
    print('Posláno. Aplikace to převezme, až bude otevřená (okno Kontroly listingů, odkaz Report).')
    return True


def paralelne(fn, seznam, vlaken=4):
    """fn pro každou položku, víc najednou; výsledky ve stejném pořadí.
    U citlivých webů (Bazoš, Refresher) jen 2–3 vlákna, ať nás neberou jako útok."""
    from concurrent.futures import ThreadPoolExecutor
    seznam = list(seznam)
    if vlaken <= 1 or len(seznam) <= 1:
        return [fn(x) for x in seznam]
    with ThreadPoolExecutor(max_workers=vlaken) as ex:
        return list(ex.map(fn, seznam))


def stranky(nacti_stranku, vlaken=6, nejvic=200):
    """Stránkovaný katalog (products.json…) po dávkách několika stránek naráz,
    dokud nepřijde prázdná. nacti_stranku(n) vrací seznam (prázdný = konec)."""
    vse, od = [], 1
    while od <= nejvic:
        davka = paralelne(nacti_stranku, range(od, min(od + vlaken, nejvic + 1)), vlaken)
        for d in davka:
            if not d:
                return vse
            vse.extend(d)
        od += vlaken
    return vse


def uloz_ladici(slozka, nazev, obsah):
    """Uloží, co web vrátil, do <kontrola>/debug — když se změní tvar dat,
    pošle majitel soubor a oprava se dělá z faktů, ne z dohadů."""
    d = os.path.join(slozka, 'debug')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, nazev), 'w', encoding='utf-8') as f:
        f.write(obsah if isinstance(obsah, str) else json.dumps(obsah, ensure_ascii=False, indent=1))
    return os.path.join(d, nazev)


# ── Příkazová řádka ─────────────────────────────────────────────────────

def _vypis(o):
    print(json.dumps(o, ensure_ascii=False, indent=2))


def _nacti_json(cesta):
    try:
        with open(cesta, encoding='utf-8-sig') as f:
            return json.load(f)
    except FileNotFoundError:
        raise ChybaSkladu('Soubor %s neexistuje.' % cesta)
    except ValueError as e:
        raise ChybaSkladu('Soubor %s není platný JSON: %s' % (cesta, e))


def _jen_heslo(text):
    """Ze zkopírovaného textu vezme heslo: bez konce řádku a okolních mezer.

    Kopíruje se z nastavení prostředí, kde je řádek celý („SKLAD_HESLO=…"),
    takže se případné jméno proměnné před rovnítkem utne."""
    t = (text or '').strip()
    if t.startswith('SKLAD_HESLO='):
        t = t[len('SKLAD_HESLO='):].strip()
    return t


def heslo_ze_schranky():
    """Přečte schránku Windows (PowerShell), jinde přes tkinter."""
    import subprocess
    try:
        r = subprocess.run(['powershell', '-NoProfile', '-Command', 'Get-Clipboard -Raw'],
                           capture_output=True, timeout=15)
        if r.returncode == 0:
            for kod in ('utf-8', 'cp1250', 'cp852'):
                try:
                    return _jen_heslo(r.stdout.decode(kod))
                except UnicodeDecodeError:
                    continue
    except Exception:
        pass
    try:
        import tkinter
        okno = tkinter.Tk()
        okno.withdraw()
        try:
            return _jen_heslo(okno.clipboard_get())
        finally:
            okno.destroy()
    except Exception:
        return ''


def vymaz_schranku():
    import subprocess
    try:
        subprocess.run(['powershell', '-NoProfile', '-Command', 'Set-Clipboard -Value $null'],
                       capture_output=True, timeout=15)
    except Exception:
        pass


def hlavni(argv):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if not argv or argv[0] in ('-h', '--help', 'pomoc'):
        print(__doc__)
        return 0
    prikaz, zbytek = argv[0], argv[1:]
    odeslat = '--odeslat' in zbytek
    zbytek = [a for a in zbytek if a != '--odeslat']

    if prikaz == 'nastavit':
        import getpass
        print('Přihlášení účtu ČTEČKY (ne tvého hlavního účtu).')
        email = input('E-mail: ').strip()
        # Psaní hesla do příkazového řádku je naslepo (nic se neukazuje)
        # a vložení přes Ctrl+V tam často nejde vůbec. Proto stačí heslo
        # zkopírovat a dát jen Enter — vezme se ze schránky.
        print('Heslo zkopíruj (Ctrl+C) a tady dej jen Enter. Nebo ho napiš — při psaní se nic neukazuje.')
        heslo = getpass.getpass('Heslo: ')
        ze_schranky = not heslo
        if ze_schranky:
            heslo = heslo_ze_schranky()
            if not heslo:
                raise ChybaSkladu('Ve schránce nic není. Zkopíruj heslo (Ctrl+C) a spusť to znovu.')
        prihlas(email, heslo)          # ověří, že sedí, dřív než se uloží
        uloz_pristup(email, heslo)
        if ze_schranky:
            vymaz_schranku()            # heslo ve schránce nemá co dělat
        print('Uloženo do Správce pověření Windows pod jménem %s. Přihlášení funguje.' % POVERENI_JMENO)
        return 0

    token = prihlas()
    data, polozky = nacti_sklad(token)

    if prikaz == 'test':
        ks = skladem(polozky)
        print('Přihlášení OK. Skladem ke kontrole: %d kusů, prodaných: %d.' % (len(ks), len(prodane(polozky))))
        print('Bazoš.cz zaškrtnutý u %d, Bazoš.sk u %d.' % (
            sum(1 for it in ks if 'Bazoš.cz' in (it.get('platforms') or [])),
            sum(1 for it in ks if 'Bazoš.sk' in (it.get('platforms') or []))))
        print('Místa prodeje v nastavení: ' + ', '.join(mista_prodeje(data)))
        return 0

    if prikaz == 'sklad':
        cil = zbytek[0] if zbytek else 'sklad.json'
        with open(cil, 'w', encoding='utf-8') as f:
            json.dump([radek_bazos(it) for it in skladem(polozky)], f, ensure_ascii=False)
        vedle = os.path.join(os.path.dirname(os.path.abspath(cil)), 'prodane.json')
        with open(vedle, 'w', encoding='utf-8') as f:
            json.dump([radek_bazos(it) for it in prodane(polozky)], f, ensure_ascii=False)
        print('Uloženo: %s (%d kusů skladem) a %s (%d prodaných).' % (
            cil, len(skladem(polozky)), vedle, len(prodane(polozky))))
        return 0

    if prikaz == 'fajfky':
        if not zbytek:
            raise ChybaSkladu('Řekni, ze kterého souboru:  fajfky soubor.json')
        o = _nacti_json(zbytek[0])
        _vypis(posli_fajfky(token, data, polozky, o.get('zmeny') if isinstance(o, dict) else o, odeslat))
        if not odeslat:
            print('\nNic se neodeslalo. Odešleš to s --odeslat.')
        return 0

    if prikaz == 'kontrola':
        if not zbytek:
            raise ChybaSkladu('Řekni, ze kterého souboru:  kontrola soubor.json')
        o = _nacti_json(zbytek[0])
        _vypis(posli_kontrolu(token, data, polozky, o.get('misto'), o.get('chybi') or [],
                              o.get('smazat') or [], o.get('nejde') or [], o.get('report') or '',
                              o.get('web') or '', o.get('poznamka') or '', o.get('datum'), odeslat,
                              opravit=o.get('opravit') or [], neni_ve_skladu=o.get('neniVeSkladu') or [],
                              inzeratu=o.get('inzeratu'), limit=o.get('limit')))
        if not odeslat:
            print('\nNic se neodeslalo. Odešleš to s --odeslat.')
        return 0

    raise ChybaSkladu('Neznámý příkaz %s. Nápověda:  python sklad_firestore.py pomoc' % prikaz)


if __name__ == '__main__':
    try:
        sys.exit(hlavni(sys.argv[1:]))
    except ChybaSkladu as e:
        print('!!! CHYBA: ' + str(e))
        sys.exit(1)
