# -*- coding: utf-8 -*-
"""
SneakersNow kontrola pro MTKM.Store (Gabro).

Přihlásí se do portálu snconsign.cz tvým účtem (heslo si pamatuje ve
Správci pověření Windows, poprvé se zeptá), načte tvoje nabídky a katalog
modelů — stejná data, jaká ukazuje Dashboard a stránka /submit — a porovná
je se skladem z cloudu. Výsledek pošle do aplikace SKLAD. — fajfky, okno
Kontroly listingů a Report. Pravidla i párování jsou ze skillu
„sneakersnow-kontrola" (jeho kontrola.py; skill zůstává jako záloha).

Na SneakersNow nic nemění — jen čte. Portál běží na Supabase: přihlášení
a čtení jdou stejnou cestou jako z jejich stránky (adresa a veřejný klíč
se berou z jejich stránky při každém spuštění).

Spuštění: SPUSTIT_sneakersnow.bat (nebo python sneakersnow_kontrola.py)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle ani neprodlouží
  --nove-heslo  zapomene uložené heslo a zeptá se znovu

V repozitáři: nastroje/sneakersnow/sneakersnow_kontrola.py, hlídá to test/test-sneakersnow.js.
"""
import sys, os, re, json, time, traceback, base64
import urllib.request, urllib.parse, urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Sneakersnow"
PORTAL = "https://snconsign.cz"
WEB = "https://snconsign.cz/dashboard"
VYSTUP = os.path.join(SLOZKA, "vysledek_sneakersnow.json")
CATS = ("sneakers", "obleceni")
EXC = {"Zrušeno", "Vráceno", "Poškozené"}
STROP_ODSKRTNUTI = 10
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"

# Párování ze skillu (kontrola.py) — aliasy jen pro OPRAVDU stejný model
ALIAS = [("&amp;", "&"), ("&#039;", "'"), ("women's", "w"), ("womens", "w"), ("(w)", " w "), ("air jordan", "jordan"),
         ("nike-mind", "nike mind"), ("bred(2025)", "bred 2025"), ("jjjjound mesa", "jjjjound tobacco"), ("&quot;", '"')]
DROP = {"x", "the", "retro", "nike", "adidas", "jordan", "supreme", "palace", "og", "se", "gs", "j"}


def payout(cena):
    """Provize 20 %, bez minima."""
    return round(cena * 0.8)


def doporucena(tm):
    """Cena končí 90, pod tržním minimem."""
    return ((tm - 1 - 90) // 100) * 100 + 90


# ---------- síť (Supabase portálu) ----------
def _get(url, hlavicky=None):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA}, **(hlavicky or {})))
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def nastaveni_portalu():
    """Adresa Supabase a veřejný klíč z jejich stránky (mění se s novou verzí stránky)."""
    stranka = _get(PORTAL + "/login")
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', stranka)
    if not m:
        raise RuntimeError("Na snconsign.cz se nenašel skript stránky — změnila se?")
    js = _get(PORTAL + m.group(1))
    url = re.search(r"https://[a-z0-9]+\.supabase\.co", js)
    klic = None
    for k in re.findall(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", js):
        try:
            telo = k.split(".")[1]
            if json.loads(base64.urlsafe_b64decode(telo + "=" * (-len(telo) % 4))).get("role") == "anon":
                klic = k
                break
        except Exception:
            continue
    if not url or not klic:
        raise RuntimeError("Ve stránce snconsign.cz se nenašlo nastavení přihlášení — změnila se?")
    return url.group(0), klic


class Portal:
    def __init__(self, url, klic):
        self.url, self.klic, self.token, self.uid = url, klic, None, None

    def _req(self, cesta, telo=None):
        hl = {"User-Agent": UA, "apikey": self.klic, "Accept": "application/json",
              "Authorization": "Bearer " + (self.token or self.klic)}
        if telo is not None:
            hl["Content-Type"] = "application/json"
        req = urllib.request.Request(self.url + cesta, headers=hl, method="POST" if telo is not None else "GET",
                                     data=None if telo is None else json.dumps(telo).encode("utf-8"))
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8") or "null")

    def prihlas(self, email, heslo):
        try:
            o = self._req("/auth/v1/token?grant_type=password", {"email": email, "password": heslo})
        except urllib.error.HTTPError as e:
            if e.code in (400, 401):
                raise PermissionError("SneakersNow přihlášení odmítl (špatný e-mail nebo heslo).")
            raise
        self.token = o.get("access_token")
        self.uid = (o.get("user") or {}).get("id")
        if not self.token or not self.uid:
            raise RuntimeError("SneakersNow po přihlášení nevrátil token.")

    def nabidky(self):
        return self._req("/rest/v1/submitted_products?select=*&user_id=eq.%s&order=created_at.desc"
                         % urllib.parse.quote(self.uid)) or []

    def katalog(self):
        return self._req("/rest/v1/catalog_models?select=brand,name,sku_codes&order=model_number.asc") or []

    def nejnizsi(self, brand, model, size):
        """Nejnižší cena téhož modelu a velikosti (jako „Tržní minimum" na dashboardu)."""
        q = urllib.parse.urlencode({"select": "shop_price", "brand": "eq." + brand, "model": "eq." + model,
                                    "size": "eq." + str(size), "status": "in.(pending,approved)",
                                    "order": "shop_price.asc", "limit": "1"})
        r = self._req("/rest/v1/submitted_products?" + q) or []
        return int(r[0]["shop_price"]) if r and r[0].get("shop_price") is not None else None


# ---------- srovnání (kontrola.py ze skillu) ----------
def norm(n):
    n = (n or "").lower()
    for a, b in ALIAS:
        n = n.replace(a, b)
    return frozenset(re.sub(r"[^a-z0-9 ]", " ", n).split()) - DROP


def sz(s):
    s = str(s or "").strip().upper().replace(",", ".").replace("-", "/").replace("1/3", ".33").replace("2/3", ".67").replace(" ", "")
    s = re.sub(r"^EU", "", s)
    return {"OS": "OS", "": "OS", "ONE/SIZE": "OS", "ONESIZE": "OS"}.get(s, s)


def jac(a, b):
    return len(a & b) / max(len(a | b), 1)


def disp(n):
    n = (n or "").replace("&amp;", "&").replace("&#039;", "'")
    for b in ("Nike ", "Adidas ", "Jordan ", "Supreme ", "Palace "):
        if n.startswith(b + b):
            n = n[len(b):]
    return n


def zive(x):
    return x.get("category") in CATS and x.get("condition") != "poskozene" and x.get("location") not in EXC \
        and S.stav(x) == "stock"


def vyhodnot(nabidky, katalog, polozky, minima):
    """nabidky = [{stav, nazev, velikost, cena, payout, obrazek, id}], minima = {id nabídky: nejnižší cena}."""
    vse = [x for x in polozky if x and x.get("type") != "bulk"]
    stock = [x for x in vse if zive(x)]
    grp = {}
    for s in stock:
        grp.setdefault((norm(s.get("name")), sz(s.get("size"))), []).append(s)

    def best(n):
        A, sA, b = norm(n["nazev"]), sz(n["velikost"]), (0, None)
        for k in grp:
            if k[1] == sA:
                sc = jac(A, k[0])
                if sc > b[0]:
                    b = (sc, k)
        return b

    def duvod(n):
        A, sA, jine = norm(n["nazev"]), sz(n["velikost"]), set()
        for x in vse:
            if jac(A, norm(x.get("name"))) >= 0.6:
                if sz(x.get("size")) == sA:
                    if S.stav(x) != "stock":
                        return ("Ve SKLADu v Čeká" if S.stav(x) == "waiting" else "Prodáno ve SKLADu"), x["id"]
                    if x.get("location") in EXC:
                        return "Ve SKLADu: " + x["location"], x["id"]
                    if x.get("condition") == "poskozene":
                        return "Ve SKLADu poškozené", x["id"]
                elif zive(x):
                    jine.add(x.get("size"))
        if jine:
            return "Skladem jen vel. " + ", ".join(sorted(jine)) + " — asi špatná velikost", None
        return "Ve SKLADu vůbec není", None

    aktivni = [n for n in nabidky if n["stav"] in ("approved", "pending")]
    used, smazat, platby = set(), [], []
    for n in aktivni:
        sc, k = best(n)
        if sc >= 0.6:
            used.add(k)
        else:
            d, kus = duvod(n)
            smazat.append(dict(n, duvod=d, ids=[kus] if kus else []))
    for n in aktivni:
        if n["stav"] != "approved":
            continue   # čeká na schválení: nalistováno, ale do payoutů ještě ne
        sc, k = best(n)
        g0 = grp[k][0] if sc >= 0.6 else None
        tm = minima.get(n["id"])
        o = n["cena"] - tm if tm and n["cena"] > tm else 0
        doporuc = doporucena(tm) if o else None
        platby.append(dict(n, ids=[g0["id"]] if g0 else [], sku=(g0 or {}).get("sku") or "",
                           nazev_sklad=(g0 or {}).get("name") or disp(n["nazev"]), drazsi_o=o, minimum=tm,
                           doporucena=doporuc, payout_doporucena=payout(doporuc) if doporuc else None))
    kat = [norm(m) for m in katalog]
    pridat = []
    for k, g in grp.items():
        if k in used:
            continue
        x = g[0]
        A = norm(x.get("name"))
        v_kat = any(jac(A, m) >= 0.75 for m in kat) if katalog else None
        pridat.append({"nazev": x.get("name"), "velikost": x.get("size") or "", "sku": x.get("sku") or "",
                       "ids": [x["id"]], "duvod": "na cestě" if x.get("location") == "Na cestě" else "", "v_katalogu": v_kat})
    tick = [g[0] for k, g in grp.items() if k in used and not any(p == MISTO for p in g[0].get("platforms") or [])]
    untick = [x for k, g in grp.items() if k not in used for x in g if MISTO in (x.get("platforms") or [])]
    untick += [x for x in vse if MISTO in (x.get("platforms") or []) and not zive(x) and x.get("category") in CATS
               and S.stav(x) == "stock"]
    zmeny = [{"id": x["id"], "platforma": MISTO, "zaskrtnout": True} for x in tick] + \
            [{"id": x["id"], "platforma": MISTO, "zaskrtnout": False} for x in untick]
    pojistka = len(untick) > STROP_ODSKRTNUTI
    return {"smazat": smazat, "pridat": pridat, "platby": platby, "zmeny": [] if pojistka else zmeny,
            "zmeny_zadrzene": zmeny if pojistka else [], "aktivnich": len(aktivni),
            "schvalenych": sum(1 for n in aktivni if n["stav"] == "approved"), "katalog": len(katalog)}


def kc(n):
    return "—" if n is None else f"{int(n):,}".replace(",", " ") + " Kč"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    radek = lambda x, duvod="": {"nazev": x.get("nazev_sklad") or disp(x["nazev"]), "velikost": x["velikost"],
                                 "sku": x.get("sku", ""), "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": duvod}
    jde = [x for x in r["pridat"] if x["v_katalogu"] is not False]
    nejde = [x for x in r["pridat"] if x["v_katalogu"] is False]
    drazsi = sorted([x for x in r["platby"] if x["drazsi_o"]], key=lambda x: -x["drazsi_o"])
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola SneakersNow", "datum": datum,
        "souhrn": [f"Schválených: {r['schvalenych']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                   f"Payout celkem: {kc(sum(x['payout'] for x in r['platby']))}"]
                  + ([f"POZOR: {len(r['zmeny_zadrzene'])} změn fajfek zadrženo — víc než {STROP_ODSKRTNUTI} odškrtnutí"] if r["zmeny_zadrzene"] else []),
        "sekce": [
            {"nazev": "Nejsi nejlevnější", "barva": "opravit",
             "radky": [dict(radek(x, f"tvoje {kc(x['cena'])} · tržní minimum {kc(x['minimum'])} · o {kc(x['drazsi_o'])} dráž"),
                            udaje=[{"popis": "Nastav", "hodnota": kc(x["doporucena"])},
                                   {"popis": "Payout", "hodnota": kc(x["payout_doporucena"])}]) for x in drazsi]},
            {"nazev": "Smazat", "barva": "smazat", "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
            {"nazev": "Přidat", "barva": "pridat", "hromadne": True, "radky": [radek(x, x["duvod"]) for x in jde]},
            {"nazev": "Nejde nalistovat — není v katalogu SneakersNow", "barva": "info", "hromadne": True,
             "radky": [radek(x, x["duvod"]) for x in nejde]},
            {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Provize 20 %.",
             "radky": [dict(radek(x, "nejlevnější" if not x["drazsi_o"] else f"dražší o {kc(x['drazsi_o'])}"),
                            udaje=[{"popis": "Cena", "hodnota": kc(x["cena"])}, {"popis": "Payout", "hodnota": kc(x["payout"])}])
                       for x in r["platby"]]},
        ],
    }


def rozeber(radky):
    out = []
    for x in radky or []:
        obr = x.get("images") or x.get("image_url") or ""
        if isinstance(obr, list):
            obr = obr[0] if obr else ""
        try:
            cena = int(round(float(x.get("shop_price") or 0)))
        except (TypeError, ValueError):
            cena = 0
        out.append({"id": x.get("id"), "stav": x.get("status") or "", "brand": x.get("brand") or "", "model": x.get("model") or "",
                    "nazev": ((x.get("brand") or "") + " " + (x.get("model") or "")).strip(), "velikost": str(x.get("size") or ""),
                    "cena": cena, "payout": payout(cena), "obrazek": obr if str(obr).startswith("http") else ""})
    return out


def main(argv):
    start = time.time()
    if "--nove-heslo" in argv:
        S.zapomen_prihlaseni_webu(MISTO)
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    email, heslo, nove = S.prihlaseni_webu(MISTO)
    p = Portal(*nastaveni_portalu())
    try:
        p.prihlas(email, heslo)
    except PermissionError as e:
        if not nove:
            S.zapomen_prihlaseni_webu(MISTO)
        raise RuntimeError(f"{e} Spusť znovu, zeptá se na heslo.")
    if nove:
        S.uloz_prihlaseni_webu(MISTO, email, heslo)
    with S.pracuji("Čtu nabídky na SneakersNow"):
        surove = p.nabidky()
    if surove:
        S.uloz_ladici(SLOZKA, "sneakersnow_ukazka.json", [{k: v for k, v in surove[0].items() if k != "user_id"}])
    nabidky = rozeber(surove)
    # Shoda s názvem modelu (jako skill) i se značkou + modelem (Corteiz, New Balance…)
    katalog = [x for m in p.katalog() for x in (m.get("name") or "", ((m.get("brand") or "") + " " + (m.get("name") or "")).strip())]
    print(f"SneakersNow: {len(nabidky)} nabídek, katalog {len(katalog) // 2} modelů")
    schvalene = [n for n in nabidky if n["stav"] == "approved"]   # tržní minimum 6 nabídek naráz
    with S.pracuji("Zjišťuji nejnižší ceny na trhu"):
        minima = dict(zip([n["id"] for n in schvalene],
                          S.paralelne(lambda n: p.nejnizsi(n["brand"], n["model"], n["velikost"]), schvalene, 6)))
    r = vyhodnot(nabidky, katalog, polozky, minima)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- SneakersNow: {r['aktivnich']} aktivních ---")
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}" + ("  (není v katalogu)" if x["v_katalogu"] is False else ""))
    if r["zmeny_zadrzene"]:
        print(f"  POZOR: {len(r['zmeny_zadrzene'])} změn fajfek zadrženo — nenačetly se asi všechny nabídky.")
    drazsi = sum(1 for x in r["platby"] if x["drazsi_o"])
    print("\n================ HOTOVO ================")
    print(f"SneakersNow: smazat {len(r['smazat'])} | přidat {len(r['pridat'])} | fajfky {len(r['zmeny'])} | dražší {drazsi}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["aktivnich"],
        chybi=[x["ids"][0] for x in r["pridat"] if x["v_katalogu"] is not False],
        nejde=[{"id": x["ids"][0], "duvod": "není v katalogu SneakersNow"} for x in r["pridat"] if x["v_katalogu"] is False],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": disp(x["nazev"]), "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}, payout celkem "
                 f"{kc(sum(x['payout'] for x in r['platby']))}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_sneakersnow.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_sneakersnow.txt. Pošli screenshot Claudovi.")
