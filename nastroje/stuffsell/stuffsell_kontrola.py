# -*- coding: utf-8 -*-
"""
Stuffsell kontrola pro MTKM.Store (Gabro).

Stuffsell je komise přes ConsignR — stejná platforma jako Tuzex, jen
v Kč a s vlastním e-shopem. Přihlásí se do 4d7f5a.consignr.store (heslo
si pamatuje ve Správci pověření Windows, poprvé se zeptá), načte
Inventory, ceny z e-shopu stuffsell.cz a porovná to se skladem z cloudu.
Výsledek pošle do aplikace SKLAD. — fajfky, okno Kontroly listingů
a Report. Pravidla jsou ze skillu „stuffsell-kontrola" (zůstává jako záloha).

Na Stuffsellu nic nemění — jen čte.

Spuštění: SPUSTIT_stuffsell.bat (nebo python stuffsell_kontrola.py)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle ani neprodlouží
  --nove-heslo  zapomene uložené heslo a zeptá se znovu

V repozitáři: nastroje/stuffsell/stuffsell_kontrola.py, hlídá to test/test-stuffsell.js.
"""
import sys, os, re, json, time, unicodedata, traceback, collections
import urllib.request, urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Stuffsell"
API = os.environ.get("STUFFSELL_API") or "https://api.consignr.app/v1"
ESHOP = os.environ.get("STUFFSELL_ESHOP") or "https://www.stuffsell.cz"
HOST = "4d7f5a.consignr.store"
WEB = "https://4d7f5a.consignr.store/seller/inventory"
VYSTUP = os.path.join(SLOZKA, "vysledek_stuffsell.json")
KATEGORIE = ("sneakers", "obleceni", "alternate")   # alternate (Labubu) jen pro párování
KATEGORIE_PRIDAT = ("sneakers", "obleceni")
# Kus u jiného komisního prodejce (Sellect, Section…) se nehlásí nikam — je u někoho jiného
MISTA_PRIDAT = ("", "Doma", "Na cestě", "Bude vráceno")
# Stavy, kdy kus na Stuffsellu už není (WITHDRAW_REQUESTED = o stažení už je zažádáno)
PRYC = {"SOLD", "PAID", "WITHDRAWN", "WITHDRAW_REQUESTED", "RETURNED", "CANCELLED", "CANCELED", "REJECTED", "DELETED"}
OPRAVIT = set()   # skutečné chyby evidence (vratka vedená jako prodaná) — zatím žádná
# Jiný název téhož kusu (Stuffsell → SKLAD)
NAZVY = {"corteiz x v a a virgil abloh tee white": "corteiz v a a tee white"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"


def payout(cena):
    """Fee Stuffsell: 22,5 % + 30 Kč za kus."""
    return round(cena * 0.775 - 30)


def doporucena(nejnizsi):
    """Nejvyšší cena končící 90 pod nejnižší cenou na e-shopu (5 490 → 5 390)."""
    return int((nejnizsi - 1 - 90) // 100 * 100 + 90)


# ---------- síť ----------
def _json(url, telo=None, token=None, hlavicky=None):
    hl = {"User-Agent": UA, "Accept": "application/json", "x-client-host": HOST, "Origin": "https://" + HOST}
    if telo is not None:
        hl["Content-Type"] = "application/json"
    if token:
        hl["Authorization"] = "Bearer " + token
    hl.update(hlavicky or {})
    req = urllib.request.Request(url, data=None if telo is None else json.dumps(telo).encode("utf-8"),
                                 headers=hl, method="POST" if telo is not None else "GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        cookies = r.headers.get_all("Set-Cookie") or []
        return json.loads(r.read().decode("utf-8") or "null"), cookies


def _najdi_token(o, cookies):
    for c in cookies:
        m = re.match(r"\s*accessToken=([^;]+)", c)
        if m:
            return m.group(1)
    stack = [o]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("accessToken", "access_token") and isinstance(v, str):
                    return v
                stack.append(v)
    return None


def prihlas_web(email, heslo):
    try:
        o, cookies = _json(API + "/auth/login", {"email": email, "password": heslo})
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise PermissionError("ConsignR přihlášení odmítl (špatný e-mail nebo heslo).")
        raise
    t = _najdi_token(o, cookies)
    if not t:
        S.uloz_ladici(SLOZKA, "stuffsell_login.json", {"klice": sorted((o or {}).keys()) if isinstance(o, dict) else str(type(o))})
        raise RuntimeError("ConsignR po přihlášení nevrátil token — tvar je v debug/stuffsell_login.json (bez hesla), řekni Claudovi.")
    return t


def nacti_inventar(token):
    vse = []
    for strana in range(1, 101):
        o, _ = _json(API + "/inventory?sort=createdAt&order=desc&page=%d" % strana, token=token)
        if isinstance(o, dict):
            o = o.get("data") or o.get("items") or o.get("results") or []
        if not o:
            break
        vse.extend(o)
        if strana == 1:
            S.uloz_ladici(SLOZKA, "stuffsell_inventory_ukazka.json", o[:3])
    return vse


def velikost_z(x):
    jm = x.get("optionNames") or []
    hod = x.get("optionValues") or []
    i = jm.index("Size") if "Size" in jm else 0
    return str(hod[i] if i < len(hod) else (hod[0] if hod else "OS"))


def rozeber(inventar):
    out = []
    for x in inventar:
        p = x.get("product") or {}
        try:
            cena = float(x.get("price"))
        except (TypeError, ValueError):
            cena = None
        out.append({"id": x.get("id"), "stav": x.get("status") or "", "nazev": p.get("title") or x.get("title") or "",
                    "sku": p.get("sku") or "", "velikost": velikost_z(x), "cena": cena,
                    "obrazek": ((p.get("images") or [None])[0]) or ""})
    return out


def nacti_eshop():
    """{(SKU, velikost) → nejnižší cena} z dostupných variant stuffsell.cz/products.json
    (stejné SKU může být u víc produktů; SKU „A / B" se rozdělí)."""
    nej = {}
    stranka = lambda n: ((_json(ESHOP + "/products.json?limit=250&page=%d" % n)[0] or {}).get("products") or [])
    for pr in S.stranky(stranka, vlaken=6):   # 6 stránek naráz (dřív ~18 s po jedné)
        for v in pr.get("variants") or []:
            if not v.get("sku") or v.get("available") is False:
                continue
            try:
                c = float(v.get("price"))
            except (TypeError, ValueError):
                continue
            for sku in str(v["sku"]).split("/"):
                k = (sku.strip().upper(), vel(v.get("option1")))
                if k not in nej or c < nej[k]:
                    nej[k] = c
    return nej


# ---------- srovnání ----------
def klic(s):
    s = unicodedata.normalize("NFKD", (s or "").lower().replace("’", "'"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\bair jordan\b", "jordan", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return NAZVY.get(s, s)


def vel(s):
    s = str(s or "").strip().upper().replace("EU", "").strip().replace(",", ".")
    s = s.replace("⅓", " 1/3").replace("⅔", " 2/3").replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", re.sub(r"\.0$", "", s))
    return {"ONE SIZE": "OS", "ONESIZE": "OS", "O/S": "OS", "ONE-SIZE": "OS"}.get(s, s)


def sedi_velikost(tz, sk):
    """Adidas 39.5 = 39 1/3; čepice S = S/M, L = L/XL; Labubu OS = prázdná velikost."""
    a, b = vel(tz), vel(sk) or "OS"
    if a == b or (a.isalpha() and "/" in b and b.split("/")[0] == a):
        return True
    m = re.fullmatch(r"(\d+)\.5", a)
    if m and b in (m.group(1) + " 1/3", m.group(1) + " 2/3"):
        return True
    r = re.fullmatch(r"(\d+)-(\d+)", b)
    return bool(r and re.fullmatch(r"\d+", a) and int(r.group(1)) <= int(a) <= int(r.group(2)))


def podobnost(a, b):
    """Kolik slov kratšího názvu je i v delším (názvy míchají SK a EN)."""
    A, B = set(klic(a).split()), set(klic(b).split())
    spolu = len(A & B)
    return spolu / min(len(A), len(B)) if A and B and spolu >= 2 else 0.0


def najdi(n, kusy):
    """Kusy ze skladu ke kusu ze Stuffsellu: SKU + velikost, jinak název + velikost.
    Vrací (kusy, jistota) — jistota False = podobný název, ověřit ručně."""
    skus = {x.strip() for x in n["sku"].upper().split("/") if x.strip()}   # SKU může být „A / B"
    s = [p for p in kusy if (p.get("sku") or "").upper() in skus and sedi_velikost(n["velikost"], p.get("size"))]
    if s:
        return s, True
    s = [p for p in kusy if klic(p.get("name")) == klic(n["nazev"]) and sedi_velikost(n["velikost"], p.get("size"))]
    if s:
        return s, True
    kand = [(podobnost(n["nazev"], p.get("name")), p) for p in kusy
            if p.get("category") != "sneakers" and sedi_velikost(n["velikost"], p.get("size"))]
    kand = [x for x in kand if x[0] >= 0.6]
    if kand:
        nej = max(x[0] for x in kand)
        return [p for sc, p in kand if sc == nej], False
    return [], True


def vyhodnot(inzeraty, eshop, skladem, prodane):
    kusy = [p for p in skladem if p.get("category") in KATEGORIE and p.get("condition") != "poskozene"]
    aktivni = [n for n in inzeraty if n["stav"] == "ACTIVE"]
    smazat, opravit, overit, platby, zmeny = [], [], [], [], []
    nalistovano, nejiste = set(), set()
    # Kus čekající na schválení apod. na Stuffsellu je — znovu ho nepřidávat
    for n in inzeraty:
        if n["stav"] != "ACTIVE" and n["stav"] not in PRYC:
            st, _ = najdi(n, kusy)
            if st:
                nalistovano.add((klic(st[0].get("name")), vel(st[0].get("size"))))
    for n in aktivni:
        st, jiste = najdi(n, kusy)
        if st:
            sk = (klic(st[0].get("name")), vel(st[0].get("size")))
            if not jiste:   # nejistá shoda nikam nejde: nesmaže, nepřidá, fajfku nemění
                nejiste.add(sk)
                overit.append(dict(n, ids=[st[0]["id"]], duvod="Podobný název ve SKLADu: " + (st[0].get("name") or "")))
                continue
            nalistovano.add(sk)
            lo = min([c for c in (eshop.get((x.strip().upper(), vel(n["velikost"]))) for x in n["sku"].split("/")) if c is not None],
                     default=None)
            levnejsi = lo is not None and n["cena"] is not None and lo < n["cena"]
            platby.append(dict(n, ids=[st[0]["id"]], payout=payout(n["cena"] or 0), eshop=lo,
                               doporucena=doporucena(lo) if levnejsi else None))
            continue
        so, _ = najdi(n, prodane)
        if (klic(n["nazev"]), vel(n["velikost"])) in OPRAVIT:
            opravit.append(dict(n, ids=[so[0]["id"]] if so else [], duvod="Vratka vedená jako prodaná — leží v Instore, oprav ve SKLADu"))
            continue
        if so:
            so.sort(key=lambda p: str(p.get("payoutDate") or p.get("saleDate") or ""), reverse=True)
            p = so[0]
            duvod = ("Ve SKLADu v Čeká" if S.stav(p) == "waiting" else "Prodáno") + \
                    " (%s %s)" % (p.get("soldWhere") or "?", p.get("saleDate") or "")
            smazat.append(dict(n, ids=[p["id"]], duvod=duvod))
        else:
            smazat.append(dict(n, ids=[], duvod="Ve SKLADu skladem není"))
    jinde = lambda ps: {(klic(ps[0].get("name")), vel(ps[0].get("size")))} \
        if ps[0].get("category") not in KATEGORIE_PRIDAT or not any((x.get("location") or "") in MISTA_PRIDAT for x in ps) else set()
    G = collections.OrderedDict()
    for p in kusy:
        G.setdefault((klic(p.get("name")), vel(p.get("size"))), []).append(p)
    pridat = []
    for k, ps in G.items():
        if k in nalistovano or k in nejiste or k in jinde(ps):
            continue
        p = ps[0]
        pridat.append({"nazev": p.get("name"), "velikost": p.get("size") or "", "sku": p.get("sku") or "",
                       "ids": [p["id"]], "duvod": " · ".join(x for x in ("na cestě" if p.get("location") == "Na cestě" else "",
                                                                         eshop_info(p, eshop)) if x)})
    for k, ps in G.items():
        if (k in nejiste or k in jinde(ps)) and k not in nalistovano:
            continue
        visi = k in nalistovano
        ids = [x["id"] for x in ps if (MISTO in (x.get("platforms") or [])) != visi]
        if ids:   # 1 id na model+velikost, zbytek skupiny srovná aplikace
            zmeny.append({"id": ids[0], "platforma": MISTO, "zaskrtnout": visi})
    nejsi = sorted([x for x in platby if x["doporucena"] is not None], key=lambda x: -(x["cena"] - x["eshop"]))
    return {"smazat": smazat, "opravit": opravit, "overit": overit, "pridat": pridat, "platby": platby,
            "nejsi": nejsi, "zmeny": zmeny, "aktivnich": len(aktivni), "celkem": len(inzeraty)}


def kc(n):
    return "—" if n is None else f"{int(round(n)):,}".replace(",", " ") + " Kč"


def eshop_info(p, eshop):
    """U Přidat: za kolik to na e-shopu je (a co nastavit), nebo že tam není."""
    sku = (p.get("sku") or "").upper()
    if not sku:
        return ""
    lo = eshop.get((sku, vel(p.get("size"))))
    if lo is not None:
        return f"na e-shopu nejlevněji {kc(lo)} · nastav {kc(doporucena(lo))} → payout {kc(payout(doporucena(lo)))}"
    jine = [c for (s, v), c in eshop.items() if s == sku]
    if jine:
        return f"velikost není na e-shopu (jiné velikosti od {kc(min(jine))})"
    return "není na e-shopu (nový produkt, cenu volíš sám)"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    radek = lambda x, duvod="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""),
                                 "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": duvod}
    nej = len(r["platby"]) - len(r["nejsi"])
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Stuffsell", "datum": datum,
        "souhrn": [f"Aktivních: {r['aktivnich']}", f"Nejlevnější u {nej} z {len(r['platby'])}",
                   f"Payout celkem: {kc(sum(x['payout'] for x in r['platby']))}"],
        "sekce": [
            {"nazev": "Nejsi nejlevnější", "barva": "opravit",
             "radky": [dict(radek(x, f"tvoje {kc(x['cena'])} · na e-shopu {kc(x['eshop'])} · o {kc(x['cena'] - x['eshop'])} dráž"),
                            udaje=[{"popis": "Nastav", "hodnota": kc(x["doporucena"])},
                                   {"popis": "Payout", "hodnota": kc(payout(x["doporucena"]))}]) for x in r["nejsi"]]},
            {"nazev": "Smazat", "barva": "smazat", "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
            {"nazev": "Přidat", "barva": "pridat", "hromadne": True, "radky": [radek(x, x["duvod"]) for x in r["pridat"]]},
            {"nazev": "Ověřit ručně", "barva": "overit", "radky": [radek(x, x["duvod"]) for x in r["overit"]]},
            {"nazev": "Fajfka Stuffsell", "barva": "fajfky",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
            {"nazev": "Opravit ve SKLADu", "barva": "opravit", "radky": [radek(x, x["duvod"]) for x in r["opravit"]]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Payout: 77,5 % ceny (fee 22,5 % + 30 Kč / ks)",
             "radky": [dict(radek(x, "nejlevnější" if x["doporucena"] is None else "nejsi nejlevnější"),
                            udaje=[{"popis": "Cena", "hodnota": kc(x["cena"])}, {"popis": "Payout", "hodnota": kc(x["payout"])}])
                       for x in r["platby"]]},
        ],
    }


def main(argv):
    start = time.time()
    if "--nove-heslo" in argv:
        S.zapomen_prihlaseni_webu(MISTO)
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    skladem, prodane = S.skladem(polozky), S.prodane(polozky)
    print(f"Sklad z cloudu: {len(skladem)} kusů skladem")
    # Při špatném hesle se zeptá znovu, uložené nefunkční zapomene
    web = S.prihlas_opakovane(MISTO, prihlas_web)[0]
    with S.pracuji("Čtu Inventory na Stuffsellu"):
        inzeraty = rozeber(nacti_inventar(web))
    print(f"Stuffsell: {len(inzeraty)} kusů v Inventory, z toho ACTIVE {sum(1 for n in inzeraty if n['stav'] == 'ACTIVE')}")
    with S.pracuji("Čtu ceny z e-shopu"):
        eshop = nacti_eshop()
    print(f"stuffsell.cz: {len(eshop)} variant s cenou")
    r = vyhodnot(inzeraty, eshop, skladem, prodane)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- Stuffsell: {r['aktivnich']} aktivních ---")
    for x in r["nejsi"]:
        print(f"  NEJSI NEJLEVNĚJŠÍ  {x['nazev']} {x['velikost']}  {kc(x['cena'])} → nastav {kc(x['doporucena'])}")
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}")
    for x in r["overit"]:
        print(f"  OVĚŘIT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    print("\n================ HOTOVO ================")
    print(f"Stuffsell: nejsi nejlevnější {len(r['nejsi'])} | smazat {len(r['smazat'])} | přidat {len(r['pridat'])} "
          f"| ověřit {len(r['overit'])} | fajfky {len(r['zmeny'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["aktivnich"],
        chybi=[x["ids"][0] for x in r["pridat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        opravit=[{"nazev": x["nazev"], "inzerat": x["velikost"], "sklad": x["duvod"], "odkaz": WEB, "ids": x["ids"]} for x in r["opravit"]],
        poznamka=f"nejlevnější u {len(r['platby']) - len(r['nejsi'])} z {len(r['platby'])}, "
                 f"payout celkem {kc(sum(x['payout'] for x in r['platby']))}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_stuffsell.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_stuffsell.txt. Pošli screenshot Claudovi.")
