# -*- coding: utf-8 -*-
"""
TheBeast kontrola pro MTKM.Store (Gabro).

Přihlásí se na sell.thebeast.cz (heslo si pamatuje ve Správci pověření
Windows, poprvé se zeptá), načte tvoje aktivní nabídky a jejich katalog
a porovná je se skladem z cloudu. Výsledek pošle do aplikace SKLAD. —
fajfky, okno Kontroly listingů a Report. Pravidla jsou ze skillu
„thebeast-kontrola" (ten zůstává jako záloha, když nejsi u PC).

Na TheBeast nic nemění — jen čte (přihlášení, nabídky, katalog).
Do skladu nezapisuje: položí lísteček a provede ho aplikace.

Spuštění: SPUSTIT_thebeast.bat (nebo python thebeast_kontrola.py)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle ani neprodlouží
  --nove-heslo  zapomene uložené heslo a zeptá se znovu

V repozitáři: nastroje/thebeast/thebeast_kontrola.py, hlídá to test/test-thebeast.js.
"""
import sys, os, re, json, time, unicodedata, traceback, collections
import urllib.request
import urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
# Společný modul leží o složku výš (MTKM-kontroly/sklad_firestore.py)
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "TheBeast"
WEB = "https://sell.thebeast.cz/"
API = "https://api-thebeast.eu.contember.cloud"
VYSTUP = os.path.join(SLOZKA, "vysledek_thebeast.json")
KATEGORIE = ("sneakers", "obleceni")
STROP_ODSKRTNUTI = 10     # víc = nejspíš se nenačetly všechny nabídky → fajfky se neposílají
# Vratky vedené jako prodané — místo Smazat jdou do Opravit ve SKLADu (skill)
OPRAVIT = {("nike x nocta cs t shirt dark grey", "M")}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"


def payout(cena):
    """Fee TheBeast: 23 % + 50 Kč za kus."""
    return round(cena * 0.77) - 50


# ---------- API (Contember GraphQL) ----------
def _post(url, dotaz, promenne=None, token=None):
    telo = json.dumps({"query": dotaz, "variables": promenne or {}}).encode("utf-8")
    hl = {"Content-Type": "application/json", "User-Agent": UA}
    if token:
        hl["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=telo, headers=hl, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"TheBeast API odmítlo dotaz ({e.code}).")
    if j.get("errors"):
        raise RuntimeError("TheBeast API: " + "; ".join(str(x.get("message")) for x in j["errors"])[:300])
    return j.get("data") or {}


def verejny_token():
    """Přihlašovací token stránky (veřejný, je přímo v HTML sell.thebeast.cz)."""
    req = urllib.request.Request(WEB, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read().decode("utf-8", "replace")
    m = re.search(r'tenantLogin:\{token:\{type:"Bearer",name:"Authorization",value:"([0-9a-f]+)"', t)
    if not m:
        raise RuntimeError("Na sell.thebeast.cz se nenašel přihlašovací token — změnila se stránka?")
    return m.group(1)


def prihlas_web(email, heslo):
    d = _post(API + "/tenant", """mutation UserLogin($email: String!, $password: String!) {
  result: signIn(email: $email, password: $password, expiration: 604800) {
    ok result { token } error { code developerMessage } } }""", {"email": email, "password": heslo}, verejny_token())
    r = (d.get("result") or {})
    if not r.get("ok"):
        kod = (r.get("error") or {}).get("code") or "?"
        raise PermissionError({"UNKNOWN_EMAIL": "TheBeast tenhle e-mail nezná.",
                               "INVALID_PASSWORD": "Špatné heslo k TheBeast."}.get(kod, f"Přihlášení k TheBeast neprošlo ({kod})."))
    return r["result"]["token"]


def nacti_nabidky(token):
    """Aktivní nabídky (quantity ≠ 0) přihlášeného prodejce + celý katalog SKU."""
    me = _post(API + "/tenant", "query { me { person { id } } }", token=token)
    person = ((me.get("me") or {}).get("person") or {}).get("id")
    if not person:
        raise RuntimeError("TheBeast nevrátil přihlášeného uživatele.")
    obsah = API + "/content/thebeast/live"
    # id se vkládá přímo (json.dumps = bezpečné uvozovky) — typ proměnné se v Contemberu jmenuje různě
    m = _post(obsah, "query { listMerchant(filter: {personId: {eq: %s}}) { id name } }" % json.dumps(person), token=token)
    merch = (m.get("listMerchant") or [{}])[0].get("id")
    if not merch:
        raise RuntimeError("Na TheBeast není k účtu založený prodejce.")
    o = _post(obsah, """query {
  listOffer(filter: {merchant: {id: {eq: %s}}, quantity: {not: {eq: 0}}}) {
    id price quantity
    productSize { statsMinPrice product { id title sku imageUrl } size { title } } } }""" % json.dumps(merch), token=token)
    k = _post(obsah, "query { listProduct { sku title } }", token=token)
    nabidky = []
    for x in o.get("listOffer") or []:
        ps = x.get("productSize") or {}
        p = ps.get("product") or {}
        cena = int(round(float(x.get("price") or 0)))
        nejnizsi = ps.get("statsMinPrice")
        nabidky.append({"id": x.get("id"), "nazev": p.get("title") or "", "sku": p.get("sku") or "",
                        "velikost": (ps.get("size") or {}).get("title") or "", "cena": cena,
                        "drazsi_o": max(0, cena - int(round(float(nejnizsi)))) if nejnizsi else 0,
                        "obrazek": p.get("imageUrl") or ""})
    katalog = {(p.get("sku") or "").upper() for p in (k.get("listProduct") or []) if p.get("sku")}
    katalog_nazvy = {klic(p.get("title")) for p in (k.get("listProduct") or [])}
    return nabidky, katalog, katalog_nazvy


# ---------- srovnání (pravidla ze skillu thebeast-kontrola) ----------
def klic(s):
    s = (s or "").lower().replace("’", "'").replace("(women's)", " w ").replace("(w)", " w ")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\bair jordan\b", "jordan", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def vel(s):
    s = str(s or "").strip().upper().replace("EU", "").strip()
    s = s.replace(",", ".").replace(" 1/3", ".33").replace(" 2/3", ".67").replace("⅓", ".33").replace("⅔", ".67")
    s = re.sub(r"\.0$", "", s)
    return {"ONE-SIZE": "OS", "ONE SIZE": "OS", "ONESIZE": "OS", "O/S": "OS"}.get(s, s)


def vyhodnot(nabidky, katalog, katalog_nazvy, skladem, prodane):
    ST = collections.defaultdict(list)      # (klíč názvu, velikost) → kusy skladem
    PO_SKU = collections.defaultdict(list)  # (SKU, velikost) → kusy skladem
    for p in skladem:
        if p.get("category") not in KATEGORIE or p.get("condition") == "poskozene":
            continue
        ST[(klic(p.get("name")), vel(p.get("size")))].append(p)
        if p.get("sku"):
            PO_SKU[(p["sku"].upper(), vel(p.get("size")))].append(p)
    SO = collections.defaultdict(list)
    for p in sorted(prodane, key=lambda x: str(x.get("payoutDate") or x.get("saleDate") or ""), reverse=True):
        SO[(klic(p.get("name")), vel(p.get("size")))].append(p)
        if p.get("sku"):
            SO[(p["sku"].upper(), vel(p.get("size")))].append(p)

    smazat, opravit, platby, zmeny = [], [], [], []
    nalistovano = set()   # klíče skupin skladem, které na TheBeast visí
    for n in nabidky:
        v = vel(n["velikost"])
        k_sku = (n["sku"].upper(), v) if n["sku"] else None
        k_nazev = (klic(n["nazev"]), v)
        st = (PO_SKU.get(k_sku) if k_sku else None) or ST.get(k_nazev) or []
        if st:
            nalistovano.add((klic(st[0].get("name")), vel(st[0].get("size"))))
            platby.append(dict(n, ids=[st[0]["id"]], payout=payout(n["cena"]),
                               konkurent=payout(n["cena"] - n["drazsi_o"]) if n["drazsi_o"] else None))
            continue
        so = (SO.get(k_sku) if k_sku else None) or SO.get(k_nazev) or []
        if k_nazev in OPRAVIT:
            opravit.append(dict(n, duvod="Vratka vedená ve SKLADu jako prodaná — oprav ve SKLADu", ids=[so[0]["id"]] if so else []))
            continue
        duvod = ("Ve SKLADu v Čeká" if so and S.stav(so[0]) == "waiting"
                 else "Prodáno ve SKLADu" if so else "Ve SKLADu skladem není")
        smazat.append(dict(n, duvod=duvod, ids=[so[0]["id"]] if so else []))

    pridat, nejde = [], []
    for k, ps in ST.items():
        if k in nalistovano:
            continue
        p = ps[0]
        v_katalogu = (p.get("sku") or "").upper() in katalog if p.get("sku") else klic(p.get("name")) in katalog_nazvy
        radek = {"nazev": p.get("name"), "velikost": p.get("size") or "", "sku": p.get("sku") or "", "ids": [p["id"]],
                 "duvod": "na cestě" if p.get("location") == "Na cestě" else ""}
        (pridat if v_katalogu else nejde).append(radek)
    # Fajfky: visí bez fajfky → zaškrtnout; fajfka a nevisí → odškrtnout (1 kus na skupinu)
    for k, ps in ST.items():
        visi = k in nalistovano
        if visi and not any(MISTO in (p.get("platforms") or []) for p in ps):
            zmeny.append({"id": ps[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        if not visi:
            for p in ps:
                if MISTO in (p.get("platforms") or []):
                    zmeny.append({"id": p["id"], "platforma": MISTO, "zaskrtnout": False})
    # Fajfka u vyřazeného kusu (poškozený) → odškrtnout
    for p in skladem:
        if p.get("condition") == "poskozene" and MISTO in (p.get("platforms") or []):
            zmeny.append({"id": p["id"], "platforma": MISTO, "zaskrtnout": False})
    odskrt = sum(1 for z in zmeny if not z["zaskrtnout"])
    pojistka = odskrt > STROP_ODSKRTNUTI
    return {"smazat": smazat, "opravit": opravit, "pridat": pridat, "nejde": nejde, "platby": platby,
            "zmeny": [] if pojistka else zmeny, "zmeny_zadrzene": zmeny if pojistka else [], "nabidek": len(nabidky)}


def kc(n):
    return f"{n:,}".replace(",", " ") + " Kč" if n is not None else "—"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    nejlevnejsi = sum(1 for x in r["platby"] if not x["drazsi_o"])
    celkem = sum(x["payout"] for x in r["platby"])
    radek = lambda x, duvod="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""),
                                 "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": duvod}
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "TheBeast — nabídky", "datum": datum,
        "souhrn": [f"Aktivních nabídek: {r['nabidek']}", f"Nejlevnější u {nejlevnejsi} z {len(r['platby'])}",
                   f"Payout celkem: {kc(celkem)}"]
                  + ([f"POZOR: {len(r['zmeny_zadrzene'])} změn fajfek zadrženo — víc než {STROP_ODSKRTNUTI} odškrtnutí, "
                      "nejspíš se nenačetly všechny nabídky"] if r["zmeny_zadrzene"] else []),
        "sekce": [
            {"nazev": "Přidat", "barva": "pridat", "hromadne": True, "poznamka": "Skladem, na TheBeast nevisí, v katalogu je.",
             "radky": [radek(x, x["duvod"]) for x in r["pridat"]]},
            {"nazev": "Smazat", "barva": "smazat", "poznamka": "Nabídka visí, kus už není skladem.",
             "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
            {"nazev": "Opravit ve SKLADu", "barva": "opravit", "radky": [radek(x, x["duvod"]) for x in r["opravit"]]},
            {"nazev": "Nejde nalistovat — není v katalogu TheBeast", "barva": "info", "hromadne": True,
             "radky": [radek(x, x["duvod"]) for x in r["nejde"]]},
            {"nazev": "Fajfky ve SKLADu", "barva": "fajfky", "poznamka": "Poslané do SKLADu, zapíše je aplikace.",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "ids": [z["id"]], "duvod": "Nabídka visí — zaškrtnuto." if z["zaskrtnout"] else "Nabídka nevisí — odškrtnuto."}
                       for z in r["zmeny"]]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee TheBeast 23 % + 50 Kč za kus.",
             "radky": [dict(radek(x, "Jsi nejlevnější" if not x["drazsi_o"] else f"Dražší o {kc(x['drazsi_o'])}"),
                            udaje=[{"popis": "Cena", "hodnota": kc(x["cena"])}, {"popis": "Payout", "hodnota": kc(x["payout"])}]
                            + ([{"popis": "U nejlevnějšího", "hodnota": kc(x["konkurent"])}] if x["konkurent"] is not None else []))
                       for x in sorted(r["platby"], key=lambda x: -x["drazsi_o"])]},
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
    email, heslo, nove = S.prihlaseni_webu(MISTO)
    try:
        web = prihlas_web(email, heslo)
    except PermissionError as e:
        if not nove:
            S.zapomen_prihlaseni_webu(MISTO)
        raise RuntimeError(f"{e} Spusť znovu, zeptá se na heslo.")
    if nove:
        S.uloz_prihlaseni_webu(MISTO, email, heslo)
    with S.pracuji("Čtu nabídky a katalog TheBeast"):
        nabidky, katalog, katalog_nazvy = nacti_nabidky(web)
    print(f"TheBeast: {len(nabidky)} aktivních nabídek, katalog {len(katalog)} SKU")
    if not nabidky:
        S.uloz_ladici(SLOZKA, "thebeast_prazdne.json", {"nabidky": nabidky})
    r = vyhodnot(nabidky, katalog, katalog_nazvy, skladem, prodane)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- TheBeast: {r['nabidek']} nabídek ---")
    for x in r["pridat"]:
        print(f"  PŘIDAT        {x['nazev']} {x['velikost']}")
    for x in r["smazat"]:
        print(f"  SMAZAT        {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["opravit"]:
        print(f"  OPRAVIT       {x['nazev']} {x['velikost']}  ({x['duvod']})")
    if r["zmeny_zadrzene"]:
        print(f"  POZOR: {len(r['zmeny_zadrzene'])} změn fajfek zadrženo — nenačetly se asi všechny nabídky.")
    print("\n================ HOTOVO ================")
    print(f"TheBeast: přidat {len(r['pridat'])} | smazat {len(r['smazat'])} | nejde {len(r['nejde'])} "
          f"| fajfky {len(r['zmeny'])} | nejlevnější {sum(1 for x in r['platby'] if not x['drazsi_o'])} z {len(r['platby'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, chybi=[x["ids"][0] for x in r["pridat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"] and x["duvod"] != "Ve SKLADu skladem není"],
        nejde=[{"id": x["ids"][0], "duvod": "není v katalogu TheBeast"} for x in r["nejde"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB}
                        for x in r["smazat"] if x["duvod"] == "Ve SKLADu skladem není"],
        opravit=[{"nazev": x["nazev"], "inzerat": x["velikost"], "sklad": x["duvod"], "odkaz": WEB, "ids": x["ids"]} for x in r["opravit"]],
        web=WEB, datum=datum, inzeratu=r["nabidek"],
        poznamka=f"Nejlevnější u {sum(1 for x in r['platby'] if not x['drazsi_o'])} z {len(r['platby'])}, "
                 f"payout celkem {kc(sum(x['payout'] for x in r['platby']))}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_thebeast.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_thebeast.txt. Pošli screenshot Claudovi.")
