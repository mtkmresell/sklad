# -*- coding: utf-8 -*-
"""
Bazoš kontrola pro MTKM.Store (Gabro).

Projde inzeráty na Bazoš.cz a Bazoš.sk a porovná je se skladem, který si
sama načte z cloudu (sklad_firestore.py ve stejné složce). Výsledek pošle
rovnou do aplikace SKLAD. — fajfky a okno Kontroly listingů (Smazat,
Opravit, Není ve SKLADu, počet inzerátů). Claude v chatu už potřeba není.

Na Bazoši nic nemění, jen čte. Do skladu taky nezapisuje: položí lísteček
a provede ho aplikace (stejně jako konektor).

Spuštění: dvojklik na SPUSTIT_bazos.bat (nebo python bazos_kontrola.py).
Vypíše výsledek a rovnou ho pošle do SKLADu (bez ptaní; --nahled jen ukáže).
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle

V repozitáři: nastroje/bazos/bazos_kontrola.py, hlídá to test/test-bazoskontrola.js.
"""
import sys, os, re, json, time, html, unicodedata, traceback, datetime
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

VYSTUP = os.path.join(SLOZKA, "vysledek_bazos.json")
DEBUG = os.path.join(SLOZKA, "debug")
LIMIT = 50
PAUZA = 0.6
DEBUG_N = 0  # sekundy mezi požadavky, ať Bazoš nezlobí

MISTA = {
    "cz": {
        "platforma": "Bazoš.cz",
        "profil": "https://www.bazos.cz/hodnoceni.php?idmail={m}&idphone={p}&jmeno=Gabriel+V.",
        "idmail": "19071261", "idphone": "19072112",
        "zaloha": "https://obleceni.bazos.cz/inzerat/224599428/crocs-crocband-clog-cars-lightning-mcqueen-dinoco.php",
    },
    "sk": {
        "platforma": "Bazoš.sk",
        "profil": "https://www.bazos.sk/hodnotenie.php?idmail={m}&idphone={p}&jmeno=Gabriel+V.",
        "idmail": "16146196", "idphone": "16174249",
        "zaloha": "https://oblecenie.bazos.sk/inzerat/196141935/crocs-crocband-clog-cars-lightning-mcqueen-dinoco.php",
    },
}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/142.0 Safari/537.36")


# ---------- stahování ----------
def stahni(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "cs,sk;q=0.9",
                                               "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
    except urllib.error.HTTPError as e:  # Bazoš vrací 404 i s obsahem
        data = e.read()
    time.sleep(PAUZA)
    for enc in ("utf-8", "windows-1250"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", "replace")


def uloz_debug(nazev, obsah):
    os.makedirs(DEBUG, exist_ok=True)
    with open(os.path.join(DEBUG, nazev), "w", encoding="utf-8") as f:
        f.write(obsah)


def bez_tagu(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).replace("\xa0", " ")


# ---------- Bazoš ----------
RE_ODKAZ = re.compile(r'href="((?:https?://[a-z0-9.\-]*bazos\.(?:cz|sk))?/inzerat/(\d+)/[^"]*)"[^>]*>(.*?)</a>', re.S | re.I)
RE_POCET = re.compile(r"inzer[aá]ty\s+u[žz]ivate[lľ]a\s*\((\d+)\)", re.I)


def nacti_profil(misto, kod):
    def url_profilu(crz=0):
        u = misto["profil"].format(m=misto["idmail"], p=misto["idphone"])
        return u + (f"&crz={crz}" if crz else "")

    def projdi():
        inzeraty, pocet, crz = {}, None, 0
        while True:
            stranka = stahni(url_profilu(crz))
            if crz == 0:
                uloz_debug(f"profil_{kod}.html", stranka)
                m = RE_POCET.search(stranka)
                pocet = int(m.group(1)) if m else None
            nove = 0
            for href, iid, txt in RE_ODKAZ.findall(stranka):
                nazev = " ".join(bez_tagu(txt).split())
                if iid not in inzeraty:
                    inzeraty[iid] = {"id": iid, "url": href, "nazev": nazev}
                    nove += 1
                elif nazev and not inzeraty[iid]["nazev"]:
                    inzeraty[iid]["nazev"] = nazev
            if nove == 0 or crz >= 300:
                break
            crz += 50
        return inzeraty, pocet

    inzeraty, pocet = projdi()
    if not inzeraty:
        # odkazy na profil se mohly změnit -> zjistit nové idmail/idphone z detailu inzerátu
        detail = stahni(misto["zaloha"])
        uloz_debug(f"zaloha_{kod}.html", detail)
        m1 = re.search(r"idmail=(\d+)", detail)
        m2 = re.search(r"idphone=(\d+)", detail)
        if m1 and m2:
            misto["idmail"], misto["idphone"] = m1.group(1), m2.group(1)
            inzeraty, pocet = projdi()
    if not inzeraty:
        raise RuntimeError(f"{misto['platforma']}: nepodařilo se načíst seznam inzerátů "
                           f"(stránka uložena ve složce debug).")
    web = misto["profil"].format(m=misto["idmail"], p=misto["idphone"])
    for i in inzeraty.values():
        if i["url"].startswith("/"):
            i["url"] = re.match(r"https://[^/]+", web).group(0) + i["url"]
    return list(inzeraty.values()), pocet, web


RE_POPIS = re.compile(r"""<div[^>]*class=["']?popisdetail["']?[^>]*>(.*?)</div>""", re.S | re.I)
RE_OBRAZEK = re.compile(r"""<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']""", re.I)
RE_VEL = re.compile(r"Ve[lľ]ikos[tť]\s*:\s*([^•\n]*?)\s*(?:•|\n|$)", re.I)


def nacti_velikosti(inz):
    stranka = stahni(inz["url"])
    m = RE_POPIS.search(stranka)
    if m:
        popis = bez_tagu(m.group(1))
    else:
        # záloha: text stránky před výpisem dalších inzerátů
        cela = stranka.split("Další inzeráty")[0].split("Ďalšie inzeráty")[0]
        popis = bez_tagu(cela)
        global DEBUG_N
        if DEBUG_N < 3:
            DEBUG_N += 1
            uloz_debug(f"detail_bez_popisu_{inz['id']}.html", stranka)
    if not inz["nazev"]:
        t = re.search(r"<h1[^>]*>(.*?)</h1>", stranka, re.S)
        if t:
            inz["nazev"] = " ".join(bez_tagu(t.group(1)).split())
    o = RE_OBRAZEK.search(stranka)
    inz["obrazek"] = html.unescape(o.group(1)) if o else ""
    v = RE_VEL.search(popis.replace("<br>", "\n"))
    inz["velikosti_text"] = v.group(1).strip() if v else ""
    inz["velikosti"] = sorted(rozdel_velikosti(inz["velikosti_text"]), key=klic_vel)
    inz["popis_nalezen"] = bool(m)


# ---------- velikosti ----------
def norm_vel(s):
    s = re.sub(r"\(.*?\)", "", s)  # "M (ROZMĚRY MOHU POSLAT)" -> "M"
    s = s.strip().upper().replace("EU", "").replace("UK", "").strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    s = s.replace("⅓", " 1/3").replace("⅔", " 2/3")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def rozdel_velikosti(text):
    if not text:
        return set()
    t = re.sub(r"(\d),(\d)", r"\1.\2", text)
    casti = re.split(r"[,;|]|\s+a\s+", t)
    return {norm_vel(c) for c in casti if norm_vel(c)}


def klic_vel(s):
    m = re.match(r"(\d+(?:\.\d+)?)", s)
    return (0, float(m.group(1)), s) if m else (1, 0, s)


# ---------- párování názvů ----------
STOP = set("""nike air jordan retro og the x a and s w women womens wmns gs ps td
eu vel velikost velkost size novy nove nova nová nové nový ds original originalni originál
tenisky boty topanky panske damske detske panské dámské dětské mikina tricko triko
tričko cepice čepice ksiltovka kšiltovka zcela uplne nenošené nenosene nepouzite
cena prodam predam prodám predám sneakers rozmer v vo na s do""".split())


def tokeny(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"(?<=[a-z0-9])\.(?=[a-z0-9])", "", s)  # V.A.A. -> vaa
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return {t for t in s.split() if t not in STOP}


def skore(tt, mt):
    if not tt or not mt:
        return 0.0, 0
    spol = len(tt & mt)
    return spol / min(len(tt), len(mt)) + 0.5 * spol / max(len(tt), len(mt)), spol


# ---------- hlavní logika ----------
def sestav_modely(radky):
    """[id, název, velikost, cz, sk] (S.radek_bazos) -> modely podle názvu."""
    modely = {}
    for iid, name, size, cz, sk in radky:
        m = modely.setdefault(name, {"name": name, "tok": tokeny(name), "kusy": []})
        m["kusy"].append({"id": iid, "size": norm_vel(size) if size else "", "cz": bool(cz), "sk": bool(sk)})
    for m in modely.values():
        m["velikosti"] = {k["size"] for k in m["kusy"] if k["size"]}
    return modely


def _kdy_prodano(it):
    return str(it.get("payoutDate") or it.get("sellDate") or it.get("soldDate") or "")


def nacti_sklad(token):
    """Sklad přímo z cloudu: modely skladem, modely prodané, data pro zápis."""
    data, polozky = S.nacti_sklad(token)
    modely = sestav_modely([S.radek_bazos(it) for it in S.skladem(polozky)])
    # Prodané: nejčerstvější prodej první — ten se nabídne ke Smazat
    prod = sorted(S.prodane(polozky), key=_kdy_prodano, reverse=True)
    prodane = sestav_modely([S.radek_bazos(it) for it in prod])
    return data, polozky, modely, prodane


def sparuj(inz, modely):
    tt = tokeny(inz["nazev"])
    vysl = []
    for m in modely.values():
        sc, spol = skore(tt, m["tok"])
        if spol >= 2 or (spol >= 1 and len(m["tok"]) == 1):
            vysl.append((sc, spol, m))
    vysl.sort(key=lambda x: (-x[0], -x[1]))
    if not vysl or vysl[0][0] < 0.75:
        return None, [x[2]["name"] for x in vysl[:3]]
    nejlepsi = vysl[0][0]
    remiza = [x for x in vysl if x[0] >= nejlepsi - 0.1]
    if len(remiza) > 1 and inz["velikosti"]:
        sedi = [x for x in remiza if x[2]["velikosti"] & set(inz["velikosti"])]
        if len(sedi) == 1:
            remiza = sedi
        elif sedi:
            # vyber ten, kterému sedí nejvíc velikostí
            sedi.sort(key=lambda x: -len(x[2]["velikosti"] & set(inz["velikosti"])))
            if len(sedi[0][2]["velikosti"] & set(inz["velikosti"])) > len(sedi[1][2]["velikosti"] & set(inz["velikosti"])):
                remiza = sedi[:1]
    if len(remiza) == 1 and nejlepsi >= 1.1:
        return remiza[0][2], []
    return "overit", [x[2]["name"] for x in remiza[:4]]


def vel_text(v):
    return ", ".join(sorted(v, key=klic_vel)) if v else "—"


def zkontroluj(kod, misto, modely, prodane):
    plat = misto["platforma"]
    print(f"\n== {plat} ==")
    inzeraty, pocet, web = nacti_profil(misto, kod)
    print(f"Inzerátů na profilu: {pocet if pocet is not None else len(inzeraty)} (načteno {len(inzeraty)})")
    print(f"  Čtu detaily {len(inzeraty)} inzerátů (po dvou naráz)…", flush=True)
    with S.pracuji("Čtu detaily inzerátů"):
        S.paralelne(nacti_velikosti, inzeraty, 2)   # Bazoš je citlivý — víc najednou ne
    return vyhodnot(kod, plat, inzeraty, pocet, web, modely, prodane)


def vyhodnot(kod, plat, inzeraty, pocet, web, modely, prodane):
    """Porovnání načtených inzerátů se skladem. Nic nestahuje — dá se testovat."""
    pokryte = {}   # name -> set velikostí z inzerátů (None = model bez velikostí)
    k_overeni, neznamé, nejiste_modely = [], [], set()
    inz_modelu = {}   # name -> inzeráty, které na model sedí (odkaz u Opravit)
    for inz in inzeraty:
        m, kand = sparuj(inz, modely)
        if m is None:
            inz["sparovano"] = None
            # Podobný model skladem: inzerát je možná jeho, jen se nespároval.
            # Fajfku mu proto neodškrtávat — chybějící je otrava, smazaná
            # u běžícího inzerátu tvrdí, že kus nikde nevisí.
            nejiste_modely.update(kand)
            neznamé.append({"nazev": inz["nazev"], "velikosti": vel_text(inz["velikosti"]),
                            "url": inz["url"], "podobne": kand, "_inz": inz})
        elif m == "overit":
            inz["sparovano"] = "overit"
            nejiste_modely.update(kand)
            k_overeni.append({"nazev": inz["nazev"], "velikosti": vel_text(inz["velikosti"]),
                              "url": inz["url"], "kandidati": kand})
        else:
            inz["sparovano"] = m["name"]
            pokryte.setdefault(m["name"], set()).update(inz["velikosti"])
            inz_modelu.setdefault(m["name"], []).append(inz)

    fix, chk, zmeny, opravit = [], [], [], []
    for name, vel_inz in sorted(pokryte.items()):
        m = modely[name]
        if m["velikosti"]:
            chybi = m["velikosti"] - vel_inz
            navic = vel_inz - m["velikosti"]
            duvod = []
            if not vel_inz:
                duvod.append("V inzerátu nenašel velikost, doplnit.")
            elif chybi or navic:
                if chybi:
                    duvod.append(f"Ve SKLAD. je i {vel_text(chybi)}, přidat.")
                if navic:
                    duvod.append(f"V inzerátu je i {vel_text(navic)}, ve SKLAD. není, odebrat.")
            if duvod:
                fix.append([name, vel_text(m["velikosti"]), " ".join(duvod)])
                opravit.append({"nazev": name, "odkaz": inz_modelu[name][0]["url"], "duvod": " ".join(duvod),
                                "obrazek": inz_modelu[name][0].get("obrazek", ""),
                                "inzerat": vel_text(vel_inz) if vel_inz else "velikost nenalezena",
                                "sklad": vel_text(m["velikosti"]), "ids": [k["id"] for k in m["kusy"]]})
        # fajfky: inzerát běží -> zaškrtnout (1 id na model+velikost)
        skupiny = {}
        for k in m["kusy"]:
            skupiny.setdefault(k["size"], []).append(k)
        pridat = []
        for size, kusy in skupiny.items():
            v_inzeratu = (not size) or (not vel_inz) or (size in vel_inz)
            if v_inzeratu and not any(k[kod] for k in kusy):
                zmeny.append({"id": kusy[0]["id"], "platforma": plat, "zaskrtnout": True})
                pridat.append(size)
        if pridat:
            chk.append([name, vel_text({s for s in pridat if s}),
                        f"Inzerát běží, ve SKLAD. chyběla fajfka {plat}."])

    # fajfka bez běžícího inzerátu -> odškrtnout
    for name, m in sorted(modely.items()):
        if name in nejiste_modely:
            continue
        vel_inz = pokryte.get(name)
        odebrat = []
        for k in m["kusy"]:
            if not k[kod]:
                continue
            # model má běžící inzerát -> fajfky nechat (chybějící velikost řeší sekce Opravit)
            if vel_inz is None:
                zmeny.append({"id": k["id"], "platforma": plat, "zaskrtnout": False})
                odebrat.append(k["size"])
        if odebrat:
            chk.append([name, vel_text({s for s in odebrat if s}),
                        f"Fajfka {plat} bez běžícího inzerátu, odškrtnout."])

    # Inzerát bez kusu skladem: prodaný model = Smazat, jinak Není ve SKLADu.
    # Dřív tohle rozhodoval Claude v chatu; teď se páruje s prodanými
    # stejně přísně jako se skladem. Nejistá shoda nejde nikam — radši
    # nic než tvrdit „smaž" o inzerátu, který je možná v pořádku.
    smazat, neni_ve_skladu, smazat_radky = [], [], []
    for n in neznamé:
        inz = n.pop("_inz")
        mp, kand = sparuj(inz, prodane)
        if n["podobne"] and not isinstance(mp, dict):
            # podobá se modelu skladem a prodaný jistě není — rozhodne člověk
            k_overeni.append({"nazev": n["nazev"], "velikosti": n["velikosti"], "url": n["url"],
                              "kandidati": n["podobne"]})
            n["vysledek"] = "k_overeni"
            continue
        if isinstance(mp, dict):
            vel = set(inz["velikosti"])
            kusy = [k for k in mp["kusy"] if not vel or k["size"] in vel] or mp["kusy"][:1]
            vzato = set()
            for k in kusy:            # jeden prodaný kus na velikost, nejčerstvější
                if k["size"] in vzato:
                    continue
                vzato.add(k["size"])
                smazat.append(k["id"])
            smazat_radky.append({"nazev": mp["name"], "velikost": n["velikosti"], "odkaz": n["url"],
                                 "ids": [i for i in smazat if any(k["id"] == i for k in mp["kusy"])],
                                 "inzerat": n["nazev"], "obrazek": inz.get("obrazek", "")})
            n["vysledek"] = "smazat"
        elif mp == "overit" or kand:
            k_overeni.append({"nazev": n["nazev"], "velikosti": n["velikosti"], "url": n["url"],
                              "kandidati": kand})
            n["vysledek"] = "k_overeni"
        else:
            neni_ve_skladu.append({"nazev": n["nazev"], "odkaz": n["url"],
                                   "velikost": "" if n["velikosti"] == "—" else n["velikosti"],
                                   "obrazek": inz.get("obrazek", "")})
            n["vysledek"] = "neni_ve_skladu"

    uloz_debug(f"inzeraty_{kod}.json", json.dumps(
        [{k: i.get(k) for k in ("id", "nazev", "velikosti_text", "popis_nalezen", "sparovano", "url")} for i in inzeraty],
        ensure_ascii=False, indent=1))
    bez_vel = sum(1 for i in inzeraty if not i.get("velikosti_text"))
    print(f"Inzerátů bez nalezené velikosti: {bez_vel}")
    return {
        "bez_velikosti": bez_vel,
        "count": pocet if pocet is not None else len(inzeraty),
        "nacteno": len(inzeraty),
        "web": web,
        "fix": fix, "chk": chk,
        "nezname": neznamé,          # nic skladem; "vysledek" říká, kam to spadlo
        "k_overeni": k_overeni,      # skript si nebyl jistý párováním — jen do výpisu
        "zmeny": zmeny,
        "smazat": smazat,            # id prodaných kusů
        "smazat_radky": smazat_radky,
        "opravit": opravit,
        "neni_ve_skladu": neni_ve_skladu,
    }


def poznamka(r):
    casti = []
    if r["k_overeni"]:
        casti.append(f"K ověření ručně: {len(r['k_overeni'])} (párování nejisté, viz okno skriptu)")
    if r["bez_velikosti"]:
        casti.append(f"Bez velikosti v inzerátu: {r['bez_velikosti']}")
    return " · ".join(casti)


def sestav_report(kod, r, datum, modely, prodane):
    """Report pro stránku v aplikaci — totéž, co dřív stavěl Claude do artifactu."""
    plat = MISTA[kod]["platforma"]
    kus = {k["id"]: (m["name"], k["size"]) for mm in (modely, prodane) for m in mm.values() for k in m["kusy"]}
    sekce = [
        {"nazev": "Smazat", "barva": "smazat", "poznamka": "Inzerát běží, ale kus už není skladem.",
         "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": x["odkaz"], "ids": x["ids"],
                    "obrazek": x["obrazek"], "duvod": "Prodáno. Inzerát: " + x["inzerat"]} for x in r["smazat_radky"]]},
        {"nazev": "Opravit", "barva": "opravit", "poznamka": "Velikosti v inzerátu neodpovídají skladu.",
         "radky": [{"nazev": o["nazev"], "velikost": o["sklad"], "odkaz": o["odkaz"], "ids": o["ids"],
                    "duvod": o["duvod"], "udaje": [{"popis": "V inzerátu", "hodnota": o["inzerat"]},
                                                   {"popis": "Skladem", "hodnota": o["sklad"]}]} for o in r["opravit"]]},
        {"nazev": "Zaškrtnutí ve SKLADu", "barva": "fajfky",
         "poznamka": "Fajfky poslané do SKLADu, zapíše je aplikace.",
         "radky": [{"nazev": kus.get(z["id"], ("?", ""))[0], "velikost": kus.get(z["id"], ("", ""))[1], "ids": [z["id"]],
                    "duvod": ("Inzerát běží, chyběla fajfka " + plat + " — zaškrtnuto." if z["zaskrtnout"]
                              else "Fajfka " + plat + " bez běžícího inzerátu — odškrtnuto.")} for z in r["zmeny"]]},
        {"nazev": "Není ve SKLADu", "barva": "neni", "poznamka": "Inzerát běží, ve SKLADu takový kus není.",
         "radky": [{"nazev": o["nazev"], "velikost": o["velikost"], "odkaz": o["odkaz"], "obrazek": o.get("obrazek", "")}
                   for o in r["neni_ve_skladu"]]},
    ]
    if r["k_overeni"]:
        sekce.append({"nazev": "Ověřit ručně", "barva": "overit",
                      "poznamka": "Skript si párováním nebyl jistý — nic se s tím nedělalo.",
                      "radky": [{"nazev": o["nazev"], "velikost": o["velikosti"], "odkaz": o["url"],
                                 "duvod": "Možná: " + (", ".join(o["kandidati"]) or "nic podobného ve skladu")}
                                for o in r["k_overeni"]]})
    souhrn = []
    if r["bez_velikosti"]:
        souhrn.append(f"Bez velikosti v inzerátu: {r['bez_velikosti']}")
    if r.get("nacteno") is not None and r.get("nacteno") != r["count"]:
        souhrn.append(f"Načteno {r['nacteno']} z {r['count']} inzerátů")
    return {"misto": plat, "skupina": "Bazoš", "nadpis": "Bazoš — listingy", "datum": datum,
            "limit": {"pocet": r["count"], "max": LIMIT}, "souhrn": souhrn, "sekce": sekce}


def posli(token, data, polozky, vysledek, odeslat, modely=None, prodane=None):
    """Nejdřív fajfky, pak report a kontrola — aplikace to v tomhle pořadí i zpracuje."""
    zmeny = vysledek["cz"]["zmeny"] + vysledek["sk"]["zmeny"]
    f = S.posli_fajfky(token, data, polozky, zmeny, odeslat=odeslat)
    out = {"fajfky": f}
    for kod in ("cz", "sk"):
        r = vysledek[kod]
        out["report_" + kod] = S.posli_report(token, data, polozky,
                                              sestav_report(kod, r, vysledek["datum"], modely or {}, prodane or {}),
                                              odeslat=odeslat)
        out[kod] = S.posli_kontrolu(
            token, data, polozky, MISTA[kod]["platforma"],
            chybi=[], smazat=r["smazat"], nejde=[], web=r["web"],
            poznamka=poznamka(r), datum=vysledek["datum"], odeslat=odeslat,
            opravit=r["opravit"], neni_ve_skladu=r["neni_ve_skladu"],
            inzeratu=r["count"], limit=LIMIT)
    return out


def vypis_nalezy(vysledek, modely, prodane):
    jmena = {k["id"]: m["name"] + (" " + k["size"] if k["size"] else "")
             for mm in (modely, prodane) for m in mm.values() for k in m["kusy"]}
    for kod in ("cz", "sk"):
        r = vysledek[kod]
        print(f"\n--- {MISTA[kod]['platforma']}: {r['count']}/{LIMIT} inzerátů ---")
        for i in r["smazat"]:
            print(f"  SMAZAT        {jmena.get(i, i)}")
        for o in r["opravit"]:
            print(f"  OPRAVIT       {o['nazev']}  (v inzerátu: {o['inzerat']} · skladem: {o['sklad']})")
        for o in r["neni_ve_skladu"]:
            print(f"  NENÍ VE SKLAD {o['nazev']}")
        for z in r["zmeny"]:
            print(f"  FAJFKA {'+' if z['zaskrtnout'] else '−'}      {jmena.get(z['id'], z['id'])}")
        for o in r["k_overeni"]:
            print(f"  OVĚŘIT RUČNĚ  {o['nazev']}  → {', '.join(o['kandidati']) or 'nic podobného'}")
            print(f"                {o['url']}")


def main(argv):
    start = time.time()
    token = S.prihlas()
    data, polozky, modely, prodane = nacti_sklad(token)
    sklad_k = data.get("savedAt") or "?"
    print(f"Sklad z cloudu: {sum(len(m['kusy']) for m in modely.values())} kusů skladem, "
          f"{len(modely)} modelů (uloženo {sklad_k})")
    # Kontrola i report nesou stejný okamžik — podle něj aplikace pozná, že k sobě patří
    vysledek = {"datum": S._iso_ted(), "sklad_k": sklad_k}
    for kod in ("cz", "sk"):
        vysledek[kod] = zkontroluj(kod, MISTA[kod], modely, prodane)
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(vysledek, f, ensure_ascii=False, indent=1)

    vypis_nalezy(vysledek, modely, prodane)
    print("\n================ HOTOVO ================")
    for kod in ("cz", "sk"):
        r = vysledek[kod]
        print(f"{MISTA[kod]['platforma']}: {r['count']}/{LIMIT} | smazat {len(r['smazat'])} | opravit {len(r['opravit'])} "
              f"| není ve SKLAD {len(r['neni_ve_skladu'])} | fajfky {len(r['zmeny'])} | ověřit ručně {len(r['k_overeni'])}")
    print(f"Trvalo {int(time.time() - start)} s.")

    nahled = posli(token, data, polozky, vysledek, False, modely, prodane)
    for co in (nahled["fajfky"], nahled["cz"], nahled["sk"], nahled["report_cz"], nahled["report_sk"]):
        for x in co.get("nelze") or []:
            print("  (neodešle se:", x.get("nazev") or x.get("id"), "—", x.get("duvod"), ")")
        if co.get("stav") in ("nezname_mista", "nezname_misto"):
            raise RuntimeError(co.get("poznamka"))

    if "--nahled" in argv:
        print("\nJen náhled, nic se neposlalo.")
        return
    token = S.prihlas()   # čerstvý token (stahování mohlo trvat)
    hotovo = posli(token, data, polozky, vysledek, True, modely, prodane)
    print("Posláno. Aplikace to převezme, až bude otevřená (okno Kontroly listingů, odkaz Report).")
    if hotovo["fajfky"].get("stav") == "zadano":
        print(f"  fajfky: {len(hotovo['fajfky']['zmeny'])}")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_bazos.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_bazos.txt. Pošli screenshot Claudovi.")
