# -*- coding: utf-8 -*-
"""
Section kontrola pro MTKM.Store (Gabro).

Porovná komisní tabulku Section (Google Sheets, list ONLINE KOMISE) a jejich
e-shop sectionstore.cz se skladem, který si sama načte z cloudu
(sklad_firestore.py ve stejné složce). Výsledek pošle rovnou do aplikace
SKLAD. — fajfky, okno Kontroly listingů a Report. Pravidla jsou ze skillu
„section-kontrola" (ten majitel nechává jako zálohu, když nebude u PC).

Tabulku ani e-shop nemění, jen čte — tabulka je sdílená odkazem, takže jde
stáhnout jako CSV bez přihlášení; e-shop má veřejný products.json.
Do skladu nezapisuje: položí lísteček a provede ho aplikace.

Spuštění: python section_kontrola.py   (nebo SPUSTIT_section.bat)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle

V repozitáři: nastroje/section/section_kontrola.py, hlídá to test/test-section.js.
"""
import sys, os, re, csv, io, json, time, unicodedata, traceback, collections
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

MISTO = "Section"
TABULKA_ID = "1ZBPqFdB2fKrdLNAhY3fiBvWmRrZcUAoNAcalqLsKVB8"
TABULKA = "https://docs.google.com/spreadsheets/d/" + TABULKA_ID + "/edit"
LIST_ONLINE = 0               # záložka ONLINE KOMISE
ESHOP = "https://sectionstore.cz"
PROVIZE = 0.25                # fee Section od 15. 7. 2026 → payout = cena × 0,75
KATEGORIE = ("sneakers", "obleceni")
# Interní, vyřešené věci, které se nehlásí (skill section-kontrola)
NEHLASIT = {("jordan 4 retro white cement 2025", "42"), ("palace x nike font swoosh t shirt black", "L")}
VYSTUP = os.path.join(SLOZKA, "vysledek_section.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/142.0 Safari/537.36")


# ---------- stahování ----------
def stahni(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:
        return 0, ""


def nacti_tabulku(gid=LIST_ONLINE):
    st, t = stahni(f"https://docs.google.com/spreadsheets/d/{TABULKA_ID}/export?format=csv&gid={gid}")
    if st != 200 or not t.strip() or t.lstrip().startswith("<"):
        raise RuntimeError(f"Tabulku Section nejde stáhnout ({st}) — je pořád sdílená odkazem?")
    return t


def nacti_eshop():
    def stranka(n):
        st, t = stahni(f"{ESHOP}/products.json?limit=250&page={n}")
        if st != 200:
            raise RuntimeError(f"E-shop Section neodpovídá ({st}).")
        return json.loads(t).get("products") or []
    return S.stranky(stranka, vlaken=4)   # 4 stránky naráz (dřív po jedné s pauzou)


# ---------- srovnání ----------
def klic(s):
    s = (s or "").lower().replace("(women's)", "(w)").replace("’", "'")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9/]+", " ", s).strip()


SLOVNI = {"SMALL": "S", "MEDIUM": "M", "LARGE": "L", "XLARGE": "XL", "XXLARGE": "XXL", "X-LARGE": "XL",
          "ONE SIZE": "OS", "ONESIZE": "OS", "O/S": "OS"}


def vel(s):
    s = re.sub(r"\s+", " ", str(s or "").strip().upper().replace("EU", "").strip())
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    s = SLOVNI.get(s, s)
    return s


def tokeny(s):
    return set(klic(s).replace("/", " ").split()) - {"nike", "air", "x", "the", "w", "gs", "retro", "og"}


def nacti_radky(csv_text):
    """Řádky listu ONLINE KOMISE: A Produkt, B Size, C EAN, D Cena, G Online nahozeno?"""
    out = []
    for i, r in enumerate(csv.reader(io.StringIO(csv_text))):
        if i == 0 or not r or not (r[0] or "").strip():
            continue
        r = r + [""] * 8
        cena = re.sub(r"[^\d]", "", r[3] or "")
        out.append({"radek": i + 1, "nazev": r[0].strip(), "velikost": r[1].strip(), "ean": r[2].strip(),
                    "cena": int(cena) if cena else None, "stav": r[6].strip(), "poznamka": r[5].strip()})
    return out


def aktivni(r):
    """Prodané přes Shopify v tabulce zůstávají jako historie — do kontroly nejdou."""
    return not re.search(r"prodej", r["stav"], re.I)


def najdi_v_eshopu(r, produkty, idx_sku):
    """Varianta e-shopu k řádku: EAN/SKU varianty, pak SKU bez velikosti, pak název (jen jistá shoda)."""
    v = idx_sku.get(r["ean"]) if r["ean"] else None
    if v:
        return v
    zakl = re.sub(r"-(\d{2,4}|[A-Z]{1,4})$", "", r["ean"]) if r["ean"] else ""
    kand = []
    for p in produkty:
        sk = {x.get("sku") for x in p["variants"]}
        if zakl and zakl in sk:
            kand.append(p)
    if not kand:
        tt = tokeny(r["nazev"])
        for p in produkty:
            pt = tokeny(p["title"])
            if tt and pt and len(tt & pt) / max(len(tt), len(pt)) >= 0.85:
                kand.append(p)
    if len(kand) != 1:
        return None
    p = kand[0]
    for x in p["variants"]:
        if vel(x.get("option1") or x.get("title")) == vel(r["velikost"]):
            return (p, x)
    return (p, None)


def vyhodnot(radky, produkty, skladem, prodane):
    idx_sku = {}
    for p in produkty:
        for x in p["variants"]:
            if x.get("sku") and x["sku"] != "99999":
                idx_sku.setdefault(x["sku"], (p, x))

    ST = collections.defaultdict(list)
    for p in skladem:
        if p.get("category") in KATEGORIE and p.get("condition") != "poskozene":
            ST[(klic(p.get("name")), vel(p.get("size")))].append(p)
    SO = collections.defaultdict(list)
    for p in sorted(prodane, key=lambda x: str(x.get("payoutDate") or x.get("sellDate") or ""), reverse=True):
        SO[(klic(p.get("name")), vel(p.get("size")))].append(p)

    smazat, pridat, platby, cena_jinak, nenahozeno, zmeny = [], [], [], [], [], []
    v_tabulce, videno = set(), set()
    gabro_vel = collections.defaultdict(set)   # produkt e-shopu → Gabrovy velikosti
    akt = [r for r in radky if aktivni(r)]
    for r in akt:
        k = (klic(r["nazev"]), vel(r["velikost"]))
        v_tabulce.add(k)
        if k in NEHLASIT:
            continue
        st = ST.get(k, [])
        if k in videno:
            smazat.append(dict(r, duvod="Duplicitní řádek (model a velikost už v tabulce jsou)", ids=[p["id"] for p in st]))
            continue
        videno.add(k)
        if not st:
            so = SO.get(k, [])
            duvod = ("Ve SKLADu v Čeká" if so and all(p.get("saleState") == "waiting" for p in so)
                     else "Prodáno ve SKLADu" if so else "Ve SKLADu skladem není")
            smazat.append(dict(r, duvod=duvod, ids=[so[0]["id"]] if so else []))
            continue
        if not any(MISTO in (p.get("platforms") or []) for p in st):
            zmeny.append({"id": st[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        e = najdi_v_eshopu(r, produkty, idx_sku)
        stav, ecena = "N", None
        if e and e[1]:
            stav = "A" if e[1].get("available") else "X"
            try:
                ecena = int(float(e[1].get("price") or 0))
            except ValueError:
                ecena = None
            if ecena == 99999:
                ecena = None
            gabro_vel[e[0]["id"]].add(vel(r["velikost"]))
        elif e:
            stav = "O"
        platby.append(dict(r, ids=[st[0]["id"]], eshop=stav, ecena=ecena, produkt=e[0] if e else None))
        if ecena and r["cena"] and ecena != r["cena"]:
            cena_jinak.append(dict(r, ids=[st[0]["id"]], ecena=ecena, odkaz=ESHOP + "/products/" + e[0]["handle"]))
        if stav == "N" and re.search(r"nahozeno", r["stav"], re.I):
            nenahozeno.append(dict(r, ids=[st[0]["id"]]))
    # Jediný na e-shopu: všechny dostupné velikosti produktu jsou Gabrovy
    for pl in platby:
        p = pl["produkt"]
        pl["jediny"] = False
        if p and pl["eshop"] == "A":
            dost = {vel(x.get("option1") or x.get("title")) for x in p["variants"] if x.get("available")}
            pl["jediny"] = bool(dost) and dost <= gabro_vel.get(p["id"], set())
            pl["odkaz"] = ESHOP + "/products/" + p["handle"]
            pl["obrazek"] = (p.get("images") or [{}])[0].get("src", "")
    # Přidat: skladem, v tabulce chybí; fajfka bez řádku → odškrtnout
    for k, ps in ST.items():
        if k in v_tabulce:
            continue
        if k not in NEHLASIT:
            pridat.append({"nazev": ps[0].get("name"), "velikost": ps[0].get("size") or "", "sku": ps[0].get("sku") or "",
                           "ids": [ps[0]["id"]]})
        for p in ps:
            if MISTO in (p.get("platforms") or []):
                zmeny.append({"id": p["id"], "platforma": MISTO, "zaskrtnout": False})
    for r in platby:
        r.pop("produkt", None)
    return {"smazat": smazat, "pridat": pridat, "platby": platby, "cena_jinak": cena_jinak,
            "nenahozeno": nenahozeno, "zmeny": zmeny, "radku": len(akt)}


# ---------- report a odeslání ----------
STAV_TEXT = {"A": "na e-shopu dostupná", "X": "na e-shopu vyprodaná", "O": "produkt bez tvojí velikosti", "N": "na e-shopu není"}


def kc(n):
    return f"{n:,}".replace(",", " ") + " Kč" if n is not None else "—"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    payout = sum(round((x["cena"] or 0) * (1 - PROVIZE)) for x in r["platby"])
    jedinych = sum(1 for x in r["platby"] if x.get("jediny"))
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Section — komise", "datum": datum,
        "souhrn": [f"V tabulce aktivních: {r['radku']}", f"Jediný na e-shopu: {jedinych}",
                   f"Payout celkem: {kc(payout)}"],
        "sekce": [
            {"nazev": "Přidat do tabulky", "barva": "pridat", "hromadne": True,
             "poznamka": "Skladem (sneakers a oblečení), v tabulce chybí.",
             "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "sku": x["sku"], "ids": x["ids"]} for x in r["pridat"]]},
            {"nazev": "Smazat z tabulky", "barva": "smazat", "poznamka": "V tabulce, ve SKLADu už není skladem.",
             "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "sku": x["ean"], "ids": x["ids"],
                        "duvod": x["duvod"] + f" (řádek {x['radek']})"} for x in r["smazat"]]},
            {"nazev": "Cena e-shop ≠ tabulka", "barva": "opravit",
             "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": x["odkaz"], "ids": x["ids"],
                        "duvod": ("E-shop je levnější." if x["ecena"] < x["cena"] else "Section ještě nepřecenil?"),
                        "udaje": [{"popis": "Tabulka", "hodnota": kc(x["cena"])}, {"popis": "E-shop", "hodnota": kc(x["ecena"])}]}
                       for x in r["cena_jinak"]]},
            {"nazev": "Nahozeno v tabulce, na e-shopu není", "barva": "neni",
             "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "sku": x["ean"], "ids": x["ids"]} for x in r["nenahozeno"]]},
            {"nazev": "Fajfky Section ve SKLADu", "barva": "fajfky", "poznamka": "Poslané do SKLADu, zapíše je aplikace.",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "ids": [z["id"]], "duvod": "Řádek v tabulce — zaškrtnuto." if z["zaskrtnout"]
                        else "V tabulce není — odškrtnuto."} for z in r["zmeny"]]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True,
             "poznamka": f"Všechny aktivní řádky. Payout = cena × {1 - PROVIZE:.2f}.".replace(".", ",", 1),
             "radky": [{"nazev": x["nazev"], "velikost": x["velikost"], "sku": x["ean"], "ids": x["ids"],
                        "odkaz": x.get("odkaz", ""), "obrazek": x.get("obrazek", ""),
                        "duvod": "Jediný na e-shopu" if x.get("jediny") else "",
                        "udaje": [{"popis": "Cena", "hodnota": kc(x["cena"])},
                                  {"popis": "Payout", "hodnota": kc(round((x["cena"] or 0) * (1 - PROVIZE)))},
                                  {"popis": "", "hodnota": STAV_TEXT[x["eshop"]]}]} for x in r["platby"]]},
        ],
    }


def posli(token, data, polozky, r, datum, odeslat):
    out = {"fajfky": S.posli_fajfky(token, data, polozky, r["zmeny"], odeslat=odeslat)}
    out["report"] = S.posli_report(token, data, polozky, sestav_report(r, datum, polozky), odeslat=odeslat)
    payout = sum(round((x["cena"] or 0) * (1 - PROVIZE)) for x in r["platby"])
    jedinych = sum(1 for x in r["platby"] if x.get("jediny"))
    out["kontrola"] = S.posli_kontrolu(
        token, data, polozky, MISTO,
        chybi=[x["ids"][0] for x in r["pridat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"] and x["duvod"] != "Ve SKLADu skladem není"
                and not x["duvod"].startswith("Duplicitní")],
        nejde=[], web=TABULKA, datum=datum, odeslat=odeslat,
        poznamka=f"Jediný na e-shopu u {jedinych} z {len(r['platby'])}, payout celkem {kc(payout)}",
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": TABULKA}
                        for x in r["smazat"] if x["duvod"] == "Ve SKLADu skladem není"])
    return out


def main(argv):
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    skladem, prodane = S.skladem(polozky), S.prodane(polozky)
    print(f"Sklad z cloudu: {len(skladem)} kusů skladem")
    radky = nacti_radky(nacti_tabulku())
    print(f"Tabulka ONLINE KOMISE: {len(radky)} řádků")
    produkty = nacti_eshop()
    print(f"E-shop: {len(produkty)} produktů")
    r = vyhodnot(radky, produkty, skladem, prodane)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- Section: {r['radku']} aktivních řádků ---")
    for x in r["pridat"]:
        print(f"  PŘIDAT        {x['nazev']} {x['velikost']}")
    for x in r["smazat"]:
        print(f"  SMAZAT        {x['nazev']} {x['velikost']}  ({x['duvod']}, řádek {x['radek']})")
    for x in r["cena_jinak"]:
        print(f"  CENA          {x['nazev']} {x['velikost']}  tabulka {kc(x['cena'])}, e-shop {kc(x['ecena'])}")
    for x in r["nenahozeno"]:
        print(f"  NENÍ NA ESHOPU {x['nazev']} {x['velikost']}")
    print(f"  Jediný na e-shopu: {sum(1 for x in r['platby'] if x.get('jediny'))} z {len(r['platby'])}")
    print("\n================ HOTOVO ================")
    print(f"Section: přidat {len(r['pridat'])} | smazat {len(r['smazat'])} | cena jinak {len(r['cena_jinak'])} "
          f"| fajfky {len(r['zmeny'])}")
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
    token = S.prihlas()
    posli(token, data, polozky, r, datum, odeslat=True)
    print("Posláno. Aplikace to převezme, až bude otevřená (okno Kontroly listingů, odkaz Report).")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_section.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_section.txt. Pošli screenshot Claudovi.")
