# -*- coding: utf-8 -*-
"""
Refresher kontrola pro MTKM.Store (Gabro).

Projde aktivní inzeráty na Refresher Market (refresher.cz/profil/mtkm-store)
a porovná je se skladem, který si sama načte z cloudu (sklad_firestore.py ve
stejné složce). Výsledek pošle rovnou do aplikace SKLAD. — fajfky, okno
Kontroly listingů a Report. Pravidla jsou ze skillu „refresher-kontrola".

Na Refresheru nic nemění, jen čte (bez přihlášení). Do skladu nezapisuje:
položí lísteček a provede ho aplikace (stejně jako konektor).

Spuštění: python refresher_kontrola.py   (nebo SPUSTIT_refresher.bat)
Vypíše výsledek a rovnou ho pošle do SKLADu (bez ptaní; --nahled jen ukáže).
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle

V repozitáři: nastroje/refresher/refresher_kontrola.py, hlídá to test/test-refresher.js.
"""
import sys, os, re, json, time, html, unicodedata, traceback, collections
import urllib.request
import urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
# Společný modul leží o složku výš (MTKM-kontroly/sklad_firestore.py), každá
# kontrola má vlastní složku se svými soubory a výsledky.
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Refresher"
PROFIL = "https://refresher.cz/profil/mtkm-store"
VYSTUP = os.path.join(SLOZKA, "vysledek_refresher.json")
PAUZA = 0.3   # mezi požadavky, ať Refresher nezlobí
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/142.0 Safari/537.36")


# ---------- stahování ----------
def stahni(url, pokusu=2):
    """(status, text). 403/404 u smazaného inzerátu je odpověď, ne chyba."""
    posledni = (0, "")
    for k in range(pokusu):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "cs,sk;q=0.9"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            data, status = e.read(), e.code
        except Exception:
            data, status = b"", 0
        time.sleep(PAUZA)
        posledni = (status, data.decode("utf-8", "replace"))
        if status == 200 or status in (403, 404):
            return posledni
        time.sleep(0.8)
    return posledni


RE_POLOZKA = re.compile(r'<div class="market-list__item" data-id="(\d+)">(.*?)(?=<div class="market-list__item" data-id=|\Z)', re.S)
RE_ODKAZ = re.compile(r'href="(https://market\.refresher\.sk/product/\d+/[^"]*)"')
RE_JMENO = re.compile(r'class="market-list__item-name"[^>]*>(.*?)</a>', re.S)
RE_OBR = re.compile(r'<img class="market-list__item-image" src="([^"]+)"')


def bez_tagu(s):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s)).replace("\xa0", " ").split())


def rozeber_seznam(stranka):
    out = []
    for iid, kus in RE_POLOZKA.findall(stranka):
        o = RE_ODKAZ.search(kus)
        j = RE_JMENO.search(kus)
        b = RE_OBR.search(kus)
        out.append({"id": iid, "url": o.group(1) if o else "https://market.refresher.sk/product/" + iid,
                    "nazev": bez_tagu(j.group(1)) if j else "", "obrazek": html.unescape(b.group(1)) if b else ""})
    return out


def nacti_profil():
    """Aktivní inzeráty z profilu: první stránka + /ajx/profil/market?seller=…&page=N&more=1."""
    status, prvni = stahni(PROFIL)
    if status != 200:
        raise RuntimeError(f"Profil na Refresheru nejde načíst ({status}).")
    seller = re.search(r'data-seller="(\d+)"', prvni)
    endpoint = re.search(r'data-product-endpoint="([^"]+)"', prvni)
    stran = re.search(r'data-more data-page="\d+" data-pages="(\d+)"', prvni)
    inzeraty = {i["id"]: i for i in rozeber_seznam(prvni)}
    if seller and endpoint:
        for p in range(2, (int(stran.group(1)) if stran else 1) + 1):
            st, t = stahni(f"{html.unescape(endpoint.group(1))}?seller={seller.group(1)}&page={p}&more=1")
            if st != 200 or not t.strip():
                break
            for i in rozeber_seznam(t):
                inzeraty.setdefault(i["id"], i)
    if not inzeraty:
        raise RuntimeError("Na profilu Refresheru se nenašel žádný inzerát (změnila se stránka?).")
    return list(inzeraty.values())


RE_INFO = re.compile(r'Product-Info-Name[^>]*>(.*?)</[^>]+>\s*<[^>]*Product-Info-Value[^>]*>(.*?)</div>', re.S)


def nacti_detail(inz):
    """Doplní velikosti (pole „Dostupné veľkosti"). Smazaný detail = velikosti ['?']."""
    status, t = stahni(inz["url"])
    if status != 200:
        inz["velikosti"] = ["?"]
        inz["detail"] = status
        if not inz["nazev"]:
            inz["nazev"] = inz["url"].rstrip("/").split("/")[-1].replace("-", " ")
        return
    vel = ""
    for jm, hod in RE_INFO.findall(t):
        if re.search(r"velik|veľk", bez_tagu(jm), re.I):
            vel = bez_tagu(hod)
    if not inz["nazev"]:
        m = re.search(r'property="og:title" content="([^"|]+)', t)
        inz["nazev"] = html.unescape(m.group(1)).strip() if m else ""
    inz["velikosti"] = [x.strip() for x in vel.split(",") if x.strip()] if vel else ["?"]
    inz["detail"] = 200


# ---------- srovnání (pravidla ze skillu refresher-kontrola) ----------
def klic(s):
    s = (s or "").lower().replace("(women's)", "(w)").replace("’", "'")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


ONESIZE = {"os", "onesize", "one size", "l/xl", "m/l"}


def vel(s):
    """Refresher má omezené velikosti: Onesize = OS / L/XL / M/L, S = S/M."""
    s = (s or "").strip()
    if s.lower() in ONESIZE:
        return "Onesize"
    if s == "S/M":
        return "S"
    return s


def _kdy_prodano(it):
    return str(it.get("payoutDate") or it.get("sellDate") or it.get("soldDate") or "")


def vyhodnot(inzeraty, skladem, prodane):
    """inzeraty = [{id, url, nazev, obrazek, velikosti}] → Smazat, Opravit, fajfky, Není ve SKLADu."""
    ST, SO = collections.defaultdict(list), collections.defaultdict(list)
    for p in skladem:
        ST[klic(p.get("name"))].append(p)
    for p in sorted(prodane, key=_kdy_prodano, reverse=True):
        SO[klic(p.get("name"))].append(p)

    smazat, opravit, neni, zmeny = [], [], [], []
    videno, vystaveno = set(), set()
    modely = collections.OrderedDict()   # model skladem → jeho inzeráty a velikosti dohromady
    for inz in inzeraty:
        k = klic(inz["nazev"])
        st, so = ST.get(k, []), SO.get(k, [])
        sz = [vel(x) for x in inz["velikosti"]] if inz["velikosti"] != ["?"] else ["?"]
        vystaveno.add(k)
        sku = next((p.get("sku") for p in st + so if p.get("sku")), "")
        vel_txt = ", ".join(sz) if sz != ["?"] else ""
        smazany = sz == ["?"] and inz.get("detail") not in (None, 200)
        if not st:
            if so:
                duvod = "Ve SKLADu v Čeká" if all(p.get("saleState") == "waiting" for p in so) else "Prodáno ve SKLADu"
                kusy = [p for p in so if not vel_txt or vel(p.get("size")) in sz] or so[:1]
                ids, vzato = [], set()
                for p in kusy:
                    if vel(p.get("size")) in vzato:
                        continue
                    vzato.add(vel(p.get("size")))
                    ids.append(p["id"])
                if smazany:
                    duvod += "; detail inzerátu nejde otevřít, zřejmě smazaný"
                smazat.append({"nazev": inz["nazev"], "velikost": vel_txt, "duvod": duvod, "sku": sku,
                               "odkaz": inz["url"], "obrazek": inz.get("obrazek", ""), "ids": ids})
            else:
                neni.append({"nazev": inz["nazev"], "velikost": vel_txt, "odkaz": inz["url"],
                             "obrazek": inz.get("obrazek", ""),
                             "duvod": "Ve SKLADu není (ani skladem, ani prodané)"
                                      + ("; detail nejde otevřít" if smazany else "")})
            continue
        if sz != ["?"] and all((k, s) in videno for s in sz):
            opravit.append({"nazev": inz["nazev"], "odkaz": inz["url"], "inzerat": vel_txt,
                            "sklad": "duplicitní inzerát — označ jako neaktivní", "duvod": "Duplicitní inzerát "
                            "(stejný model a velikost už je v jiném inzerátu) — označ jako neaktivní.",
                            "ids": [p["id"] for p in st], "obrazek": inz.get("obrazek", ""), "duplicitni": True})
            continue
        m = modely.setdefault(k, {"inz": [], "vel": [], "znamo": True, "st": st})
        m["inz"].append(inz)
        if sz == ["?"]:
            m["znamo"] = False
        for s in sz:
            videno.add((k, s))
            if s != "?" and s not in m["vel"]:
                m["vel"].append(s)
    # Velikosti modelu se sčítají přes všechny jeho inzeráty — model rozdělený
    # do dvou inzerátů (44 v jednom, 45 ve druhém) není k opravě a fajfky má mít obě.
    for k, m in modely.items():
        st, sz = m["st"], m["vel"]
        ss = sorted({vel(p.get("size")) for p in st})
        prvni = m["inz"][0]
        if m["znamo"]:
            navic = [s for s in sz if s not in ss]
            chybi = [s for s in ss if s not in sz]
            if navic or chybi:
                co = (["odeber " + ", ".join(navic)] if navic else []) + (["přidej " + ", ".join(chybi)] if chybi else [])
                kde = next((i for i in m["inz"] if any(vel(x) in navic for x in i["velikosti"])), prvni)
                opravit.append({"nazev": prvni["nazev"], "odkaz": kde["url"], "inzerat": ", ".join(sz), "sklad": ", ".join(ss),
                                "duvod": "V inzerátu " + ", ".join(sz) + ", skladem " + ", ".join(ss) + " → " + "; ".join(co),
                                "ids": [p["id"] for p in st], "obrazek": kde.get("obrazek", "")})
        for s in ss:
            grp = [p for p in st if vel(p.get("size")) == s]
            chce = s in sz
            if chce and not any(MISTO in (p.get("platforms") or []) for p in grp):
                zmeny.append({"id": grp[0]["id"], "platforma": MISTO, "zaskrtnout": True})
            if not chce and m["znamo"]:
                for p in grp:
                    if MISTO in (p.get("platforms") or []):
                        zmeny.append({"id": p["id"], "platforma": MISTO, "zaskrtnout": False})
    for k, ps in ST.items():
        if k in vystaveno:
            continue
        for p in ps:
            if MISTO in (p.get("platforms") or []):
                zmeny.append({"id": p["id"], "platforma": MISTO, "zaskrtnout": False})
    return {"smazat": smazat, "opravit": opravit, "neni_ve_skladu": neni, "zmeny": zmeny,
            "count": len(inzeraty), "bez_velikosti": sum(1 for i in inzeraty if i["velikosti"] == ["?"])}


# ---------- report a odeslání ----------
def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    def jm(i):
        p = kus.get(i) or {}
        return p.get("name") or "?", p.get("size") or ""
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Refresher — listingy", "datum": datum,
        "souhrn": [f"Aktivních inzerátů: {r['count']}"]
                  + ([f"Bez velikosti / smazaný detail: {r['bez_velikosti']}"] if r["bez_velikosti"] else []),
        "sekce": [
            {"nazev": "Smazat (označit jako neaktivní)", "barva": "smazat",
             "poznamka": "Inzerát je aktivní, ale kus už není skladem.",
             "radky": [dict(x) for x in r["smazat"]]
                      + [{"nazev": x["nazev"], "velikost": x["inzerat"], "odkaz": x["odkaz"], "ids": x["ids"],
                          "obrazek": x["obrazek"], "duvod": x["duvod"]} for x in r["opravit"] if x.get("duplicitni")]},
            {"nazev": "Opravit", "barva": "opravit", "poznamka": "Velikosti v inzerátu neodpovídají skladu.",
             "radky": [{"nazev": x["nazev"], "velikost": x["sklad"], "odkaz": x["odkaz"], "ids": x["ids"],
                        "obrazek": x["obrazek"], "duvod": x["duvod"],
                        "udaje": [{"popis": "V inzerátu", "hodnota": x["inzerat"]}, {"popis": "Skladem", "hodnota": x["sklad"]}]}
                       for x in r["opravit"] if not x.get("duplicitni")]},
            {"nazev": "Fajfky ve SKLADu", "barva": "fajfky", "poznamka": "Poslané do SKLADu, zapíše je aplikace.",
             "radky": [{"nazev": jm(z["id"])[0], "velikost": jm(z["id"])[1], "ids": [z["id"]],
                        "duvod": "Inzerát běží, chyběla fajfka — zaškrtnuto." if z["zaskrtnout"]
                                 else "Fajfka bez aktivního inzerátu — odškrtnuto."} for z in r["zmeny"]]},
            {"nazev": "Není ve SKLADu", "barva": "neni", "poznamka": "Inzerát je aktivní, ve SKLADu takový kus není.",
             "radky": [dict(x) for x in r["neni_ve_skladu"]]},
        ],
    }


def posli(token, data, polozky, r, datum, odeslat):
    """Nejdřív fajfky, pak report a kontrola — aplikace to v tomhle pořadí i zpracuje."""
    out = {"fajfky": S.posli_fajfky(token, data, polozky, r["zmeny"], odeslat=odeslat)}
    out["report"] = S.posli_report(token, data, polozky, sestav_report(r, datum, polozky), odeslat=odeslat)
    smazat_ids = []
    for x in r["smazat"]:
        smazat_ids += [i for i in x["ids"] if i not in smazat_ids]
    out["kontrola"] = S.posli_kontrolu(
        token, data, polozky, MISTO, chybi=[], smazat=smazat_ids, nejde=[], web=PROFIL,
        poznamka=(f"Bez velikosti / smazaný detail: {r['bez_velikosti']}" if r["bez_velikosti"] else ""),
        datum=datum, odeslat=odeslat,
        opravit=[{"nazev": x["nazev"], "odkaz": x["odkaz"], "inzerat": x["inzerat"], "sklad": x["sklad"], "ids": x["ids"]}
                 for x in r["opravit"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "odkaz": x["odkaz"], "velikost": x["velikost"]} for x in r["neni_ve_skladu"]],
        inzeratu=r["count"])
    return out


def vypis(r, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    print(f"\n--- Refresher: {r['count']} aktivních inzerátů ---")
    for x in r["smazat"]:
        print(f"  SMAZAT        {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["opravit"]:
        print(f"  OPRAVIT       {x['nazev']}  ({x['duvod']})")
    for x in r["neni_ve_skladu"]:
        print(f"  NENÍ VE SKLAD {x['nazev']} {x['velikost']}")
    for z in r["zmeny"]:
        p = kus.get(z["id"]) or {}
        print(f"  FAJFKA {'+' if z['zaskrtnout'] else '−'}      {p.get('name', z['id'])} {p.get('size', '')}")


def main(argv):
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    skladem, prodane = S.skladem(polozky), S.prodane(polozky)
    print(f"Sklad z cloudu: {len(skladem)} kusů skladem, {len(prodane)} prodaných")
    inzeraty = nacti_profil()
    print(f"Aktivních inzerátů na profilu: {len(inzeraty)}")
    print(f"  Čtu detaily {len(inzeraty)} inzerátů (po třech naráz)…", flush=True)
    S.paralelne(nacti_detail, inzeraty, 3)
    r = vyhodnot(inzeraty, skladem, prodane)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    vypis(r, polozky)
    print("\n================ HOTOVO ================")
    print(f"Refresher: {r['count']} inzerátů | smazat {len(r['smazat'])} | opravit {len(r['opravit'])} "
          f"| není ve SKLAD {len(r['neni_ve_skladu'])} | fajfky {len(r['zmeny'])}")
    print(f"Trvalo {int(time.time() - start)} s.")

    nahled = posli(token, data, polozky, r, datum, odeslat=False)
    for co in nahled.values():
        for x in co.get("nelze") or []:
            print("  (neodešle se:", x.get("nazev") or x.get("id"), "—", x.get("duvod"), ")")
        if co.get("stav") in ("nezname_mista", "nezname_misto"):
            raise RuntimeError(co.get("poznamka"))
    if "--nahled" in argv:
        print("\nJen náhled, nic se neposlalo.")
        return
    token = S.prihlas()   # čerstvý token (stahování mohlo trvat)
    posli(token, data, polozky, r, datum, odeslat=True)
    print("Posláno. Aplikace to převezme, až bude otevřená (okno Kontroly listingů, odkaz Report).")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_refresher.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_refresher.txt. Pošli screenshot Claudovi.")
