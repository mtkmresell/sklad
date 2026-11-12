# -*- coding: utf-8 -*-
"""
Sellect kontrola pro MTKM.Store (Gabro).

Přihlásí se na partner.sellect.cz (heslo si pamatuje ve Správci pověření
Windows, poprvé se zeptá), přečte Aktuální nabídky, ověří katalog pro
chybějící SKU a porovná to se skladem z cloudu. Výsledek pošle do
aplikace SKLAD. — fajfky, okno Kontroly listingů a Report. Pravidla jsou
ze skillu „sellect-kontrola" (ten zůstává jako záloha, když nejsi u PC).

Na Sellectu chodí JEN do Aktuálních nabídek a do vyhledání v katalogu.
Jediný zápis: prodloužení nabídek, které jsou ve SKLADu skladem
(Gabro povolil u každé kontroly) — vždy, bez ptaní.

Spuštění: SPUSTIT_sellect.bat (nebo python sellect_kontrola.py)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle ani neprodlouží
  --nove-heslo  zapomene uložené heslo a zeptá se znovu

V repozitáři: nastroje/sellect/sellect_kontrola.py, hlídá to test/test-sellect.js.
"""
import sys, os, re, json, time, traceback, html
import urllib.request, urllib.parse, urllib.error, http.cookiejar
from html.parser import HTMLParser

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Sellect"
ZAKLAD = os.environ.get("SELLECT_URL") or "https://partner.sellect.cz"
WEB = "https://partner.sellect.cz/nabidky/aktualni"
VYSTUP = os.path.join(SLOZKA, "vysledek_sellect.json")
OK_LOC = ("Doma", "Na cestě", "Section", "Sneakerstore", "Instore", "Bude vráceno")
US = {"1181910-CHE|9": "1181910-CHE|42"}   # UGG Tasman: Sellect US 9 = sklad 42
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"


# ---------- web ----------
class Web:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def get(self, cesta, hlavicky=None):
        req = urllib.request.Request(ZAKLAD + cesta, headers=dict({"User-Agent": UA}, **(hlavicky or {})))
        with self.op.open(req, timeout=60) as r:
            return r.geturl(), r.read().decode("utf-8", "replace")

    def post(self, cesta, pole, hlavicky=None):
        telo = urllib.parse.urlencode(pole).encode("utf-8")
        req = urllib.request.Request(ZAKLAD + cesta, data=telo, method="POST", headers=dict({
            "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded",
            "Origin": ZAKLAD, "Referer": ZAKLAD + "/security/login"}, **(hlavicky or {})))
        with self.op.open(req, timeout=60) as r:
            return r.geturl(), r.read().decode("utf-8", "replace")


def prihlasena(stranka):
    return 'id="table"' in stranka or "/security/logout" in stranka


def prihlas_web(w, email, heslo):
    _, login = w.get("/security/login")
    m = re.search(r'name="_csrf_token"\s+value="([^"]*)"', login)
    _, t = w.post("/security/login", {"email": email, "password": heslo,
                                       "_csrf_token": m.group(1) if m else "csrf-token"})
    if "Neplatné přihlašovací údaje" in t or ('name="password"' in t and not prihlasena(t)):
        raise PermissionError("Sellect přihlášení odmítl (Neplatné přihlašovací údaje).")


class _Tabulka(HTMLParser):
    """Řádky tabulky #table: text buněk a odkaz na prodloužení."""
    def __init__(self):
        super().__init__()
        self.v_tab = 0; self.radky = []; self.radek = None; self.bunka = None

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == "table":
            if a.get("id") == "table" or self.v_tab:
                self.v_tab += 1
        elif self.v_tab and tag == "tr":
            self.radek = {"c": [], "extend": None}
        elif self.v_tab and tag == "td" and self.radek is not None:
            self.bunka = []
        elif self.v_tab and tag == "a" and self.radek is not None and "/nabidky/extend/" in (a.get("href") or ""):
            self.radek["extend"] = a["href"]
        elif self.v_tab and tag == "img" and self.radek is not None and a.get("src", "").startswith("http"):
            self.radek.setdefault("obrazek", a["src"])

    def handle_endtag(self, tag):
        if not self.v_tab:
            return
        if tag == "td" and self.bunka is not None:
            self.radek["c"].append(re.sub(r"\s+", " ", "".join(self.bunka)).strip()); self.bunka = None
        elif tag == "tr" and self.radek is not None:
            if self.radek["c"]:
                self.radky.append(self.radek)
            self.radek = None
        elif tag == "table":
            self.v_tab -= 1

    def handle_data(self, d):
        if self.bunka is not None:
            self.bunka.append(d)


def ns(s):
    return re.sub(r"\.0$", "", str(s or "").strip()).upper()


def rozeber_nabidky(stranka):
    """[{sku, nazev, velikost, cena, navic, payout, info, extend, obrazek}] z HTML Aktuálních nabídek."""
    p = _Tabulka(); p.feed(stranka)
    out = []
    for r in p.radky:
        c = r["c"]
        if len(c) < 12:
            continue
        m = re.search(r"(\d+)Kč\(?(?:\+(\d+)Kč)?", re.sub(r"\s", "", c[9]))
        if not m:
            continue
        out.append({"sku": html.unescape(c[5]), "nazev": html.unescape(c[6]), "velikost": ns(c[7]),
                    "cena": int(m.group(1)), "navic": int(m.group(2) or 0),
                    "payout": int(re.sub(r"\D", "", c[11]) or 0), "info": c[12] if len(c) > 12 else "",
                    "extend": r.get("extend"), "obrazek": r.get("obrazek", "")})
    return out


def v_katalogu(w, sku):
    _, t = w.post("/produkty/find-product/", {"search": sku},
                  {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json", "Referer": WEB})
    try:
        seznam = json.loads(t)
    except ValueError:
        return True   # neznámá odpověď → radši „v katalogu" (jen štítek v Přidat)
    if isinstance(seznam, dict):
        seznam = seznam.get("data") or seznam.get("products") or []
    return any(str((x or {}).get("code") or "").upper() == sku.upper() for x in seznam if isinstance(x, dict))


# ---------- vyhodnocení (pravidla ze skillu sellect-kontrola) ----------
def klic(p):
    return (p["sku"].upper() if p.get("sku") else "N:" + (p.get("name") or "").upper()) + "|" + ns(p.get("size"))


def _dm(d):
    return "%d. %d." % (int(d[8:10]), int(d[5:7])) if d and len(d) >= 10 else ""


def _sus(p):
    """Skladem, ale s místem prodeje a mimo známá místa = nejspíš prodaný."""
    return bool(p.get("soldWhere")) and (p.get("location") or "") not in OK_LOC


def skupiny(skladem):
    G = {}
    for p in skladem:
        if p.get("condition") == "poskozene":
            continue
        G.setdefault(klic(p), []).append(p)
    return G


def klice_skladu(G):
    return {k for k, ps in G.items() if ps[0].get("category") in ("sneakers", "obleceni", "alternate")
            and not all(_sus(x) for x in ps)}


def klic_nabidky(n, G):
    k = n["sku"].upper() + "|" + ns(n["velikost"])
    k = US.get(k, k)
    if k in G:
        return k
    for kn in ("N:" + n["nazev"].upper() + "|" + ns(n["velikost"]), "N:" + n["nazev"].upper() + "|"):
        if kn in G:     # bez SKU (Labubu) podle názvu
            return kn
    return k


def vyhodnot(nabidky, katalog, skladem, polozky):
    G = skupiny(skladem)
    vse = [p for p in polozky if p and p.get("type") != "bulk"]
    listed = {klic_nabidky(n, G) for n in nabidky}
    smazat = []
    for n in nabidky:
        k = klic_nabidky(n, G); ps = G.get(k, [])
        if ps and not all(_sus(x) for x in ps):
            continue
        hist = [p for p in vse if klic(p) == k and S.stav(p) in ("waiting", "paid")]
        hist.sort(key=lambda p: str(p.get("saleDate") or ""))
        stejne = sorted({p.get("size") for p in skladem if p.get("sku") and p["sku"].upper() == n["sku"].upper()})
        ids = []
        if ps:
            duvod = "Ověř: ve SKLADu „skladem“, ale prodáno přes %s %s" % (ps[0]["soldWhere"], _dm(ps[0].get("saleDate")))
        elif any(S.stav(p) == "waiting" for p in hist):
            h = [p for p in hist if S.stav(p) == "waiting"][0]
            duvod = "Ve SKLADu v Čeká (%s %s)" % (h.get("soldWhere") or "?", _dm(h.get("saleDate"))); ids = [h["id"]]
        elif hist:
            h = hist[-1]; duvod = "Prodáno (%s %s)" % (h.get("soldWhere") or "?", _dm(h.get("saleDate"))); ids = [h["id"]]
        elif stejne:
            duvod = "Vel. %s ve SKLADu není (skladem %s) — špatná velikost?" % (n["velikost"], ", ".join(stejne))
        else:
            duvod = "Ve SKLADu vůbec není"
        smazat.append(dict(n, duvod=duvod, ids=ids, overit=bool(ps)))
    pridat = []
    for k, ps in G.items():
        p = ps[0]
        if p.get("category") not in ("sneakers", "obleceni") or k in listed or all(_sus(x) for x in ps):
            continue
        stitky = ["na cestě"] if p.get("location") == "Na cestě" else []
        v_kat = bool(p.get("sku")) and katalog.get(p["sku"].upper(), True)
        if not v_kat:
            stitky.append("není v katalogu Sellectu" if p.get("sku") else "bez SKU · není v katalogu")
        pridat.append(((not v_kat, p.get("category") != "sneakers", "na cestě" in stitky, p.get("name") or "", str(p.get("size"))),
                       {"nazev": p.get("name"), "velikost": p.get("size") or "", "sku": p.get("sku") or "",
                        "ids": [p["id"]], "duvod": " · ".join(stitky), "v_katalogu": v_kat}))
    pridat = [x[1] for x in sorted(pridat, key=lambda x: x[0])]
    zmeny = []
    for k, ps in G.items():
        if all(_sus(x) for x in ps):
            continue
        visi = k in listed
        ids = [x["id"] for x in ps if (MISTO in (x.get("platforms") or [])) != visi]
        if ids:
            zmeny.append({"id": ids[0], "platforma": MISTO, "zaskrtnout": visi})
    prodlouzit = [n["extend"] for n in nabidky if n.get("extend") and klic_nabidky(n, G) in klice_skladu(G)]
    for n in nabidky:   # u nabídky skladem doplnit název ze skladu (Sellect ho má jinak)
        ps = G.get(klic_nabidky(n, G))
        n["ids"] = [ps[0]["id"]] if ps else []
    return {"smazat": smazat, "pridat": pridat, "zmeny": zmeny, "prodlouzit": prodlouzit,
            "nabidky": nabidky, "nabidek": len(nabidky)}


def kc(n):
    return f"{n:,}".replace(",", " ") + " Kč"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    radek = lambda x, duvod="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""),
                                 "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": duvod}
    celkem = sum(n["payout"] for n in r["nabidky"])
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Sellect", "datum": datum,
        "souhrn": [f"Aktivních nabídek: {r['nabidek']}", f"Payout celkem: {kc(celkem)}",
                   f"K prodloužení: {len(r['prodlouzit'])}"],
        "sekce": [
            {"nazev": "Smazat", "barva": "smazat", "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
            {"nazev": "Přidat", "barva": "pridat", "hromadne": True,
             "radky": [radek(x, x["duvod"]) for x in r["pridat"]]},
            {"nazev": "Fajfka Sellect", "barva": "fajfky", "poznamka": "Poslané do SKLADu, zapíše je aplikace.",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "sku": (kus.get(z["id"]) or {}).get("sku", ""), "ids": [z["id"]],
                        "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee 20 % + 50 Kč/ks.",
             "radky": [dict(radek(n, n.get("info", "")), udaje=[
                 {"popis": "Cena", "hodnota": kc(n["cena"]) + (f" (+{kc(n['navic'])})" if n["navic"] else "")},
                 {"popis": "Payout", "hodnota": kc(n["payout"])}]) for n in r["nabidky"]]},
        ],
    }


def main(argv):
    start = time.time()
    if "--nove-heslo" in argv:
        S.zapomen_prihlaseni_webu(MISTO)
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    skladem = S.skladem(polozky)
    print(f"Sklad z cloudu: {len(skladem)} kusů skladem")
    email, heslo, nove = S.prihlaseni_webu(MISTO)
    w = Web()
    try:
        prihlas_web(w, email, heslo)
    except PermissionError as e:
        if not nove:
            S.zapomen_prihlaseni_webu(MISTO)
        raise RuntimeError(f"{e} Spusť znovu, zeptá se na heslo.")
    _, stranka = w.get("/nabidky/aktualni")
    if not prihlasena(stranka):
        S.uloz_ladici(SLOZKA, "sellect_aktualni.html", stranka)
        raise RuntimeError("Sellect po přihlášení neukázal Aktuální nabídky. Stránka je v debug/sellect_aktualni.html — řekni Claudovi.")
    if nove:
        S.uloz_prihlaseni_webu(MISTO, email, heslo)
    nabidky = rozeber_nabidky(stranka)
    print(f"Sellect: {len(nabidky)} aktivních nabídek")
    if not nabidky:
        cesta = S.uloz_ladici(SLOZKA, "sellect_aktualni.html", stranka)
        print(f"  Žádná nabídka — stránka je uložená v {cesta}. Jestli nějaké máš, řekni Claudovi.")
    G = skupiny(skladem)
    listed = {klic_nabidky(n, G) for n in nabidky}
    katalog = {}
    for k in sorted(klice_skladu(G)):
        if k in listed or k.startswith("N:"):
            continue
        sku = k.split("|")[0]
        if sku not in katalog:
            katalog[sku] = v_katalogu(w, sku)
    r = vyhodnot(nabidky, katalog, skladem, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- Sellect: {r['nabidek']} nabídek ---")
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['sku']} {x['velikost']}  — {x['duvod']}")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}" + (f"  ({x['duvod']})" if x["duvod"] else ""))
    print("\n================ HOTOVO ================")
    print(f"Sellect: smazat {len(r['smazat'])} | přidat {len(r['pridat'])} (v katalogu "
          f"{sum(1 for x in r['pridat'] if x['v_katalogu'])}) | fajfky {len(r['zmeny'])} | prodloužit {len(r['prodlouzit'])}")
    print(f"Trvalo {int(time.time() - start)} s.")

    def prodluz():
        ok = 0
        for h in r["prodlouzit"]:
            try:
                w.get(h if h.startswith("/") else urllib.parse.urlparse(h).path)
                ok += 1
            except Exception as e:
                print("  (prodloužení neprošlo:", h, e, ")")
        print(f"Prodlouženo {ok} nabídek.")
        r["prodlouzeno"] = ok

    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["nabidek"],
        chybi=[x["ids"][0] for x in r["pridat"] if x["v_katalogu"]],
        nejde=[{"id": x["ids"][0], "duvod": x["duvod"]} for x in r["pridat"] if not x["v_katalogu"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"] and not x["overit"]],
        neni_ve_skladu=[{"nazev": f"{x['nazev']} ({x['sku']})", "velikost": x["velikost"], "odkaz": WEB}
                        for x in r["smazat"] if not x["ids"] and not x["overit"]],
        poznamka=f"payout celkem {kc(sum(n['payout'] for n in r['nabidky']))} za {r['nabidek']} nabídek, "
                 f"prodlouženo {len(r['prodlouzit'])}"), argv, pred_odeslanim=prodluz)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_sellect.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_sellect.txt. Pošli screenshot Claudovi.")
