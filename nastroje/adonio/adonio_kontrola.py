# -*- coding: utf-8 -*-
"""
Adonio kontrola pro MTKM.Store (Gabro).

Přihlásí se na consign-adonio.eu tvým účtem (heslo si pamatuje ve
Správci pověření Windows, poprvé se zeptá), otevře „Moje nabídky"
(/listings) a porovná je se skladem z cloudu. Výsledek pošle do aplikace
SKLAD. — fajfky, okno Kontroly listingů a Report. Pravidla i párování
jsou ze skillu „adonio-kontrola" (jeho match.py; skill zůstává jako
záloha).

Na Adoniu nic nemění — jen čte stránku Moje nabídky.

Spuštění: SPUSTIT_adonio.bat (nebo python adonio_kontrola.py)
  Vše pošle do SKLADu samo, bez ptaní.  --nahled  jen ukáže, nic nepošle ani neprodlouží
  --nove-heslo  zapomene uložené heslo a zeptá se znovu

V repozitáři: nastroje/adonio/adonio_kontrola.py, hlídá to test/test-adonio.js.
"""
import sys, os, re, json, time, traceback, base64, html
import urllib.request, urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Adonio"
PORTAL = os.environ.get("ADONIO_URL") or "https://consign-adonio.eu"
WEB = "https://consign-adonio.eu/listings"
VYSTUP = os.path.join(SLOZKA, "vysledek_adonio.json")
EXC = {"Zrušeno", "Vráceno", "Poškozené"}
# Jiný název téhož kusu (Adonio název|velikost → název ve SKLADu)
RUCNE = {"Corteiz x V.A.A. Virgil Abloh Tee White|S": "Corteiz V.A.A. Tee White"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36"


def payout(cena):
    """Fee 25 %, minimum 700 Kč za kus."""
    return round(cena - max(0.25 * cena, 700))


# ---------- síť ----------
def _get(url, cookie=None):
    hl = {"User-Agent": UA}
    if cookie:
        hl["Cookie"] = cookie
    req = urllib.request.Request(url, headers=hl)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def nastaveni_portalu():
    """Adresa Supabase a veřejný klíč z jejich stránky (mění se s novou verzí)."""
    _, stranka = _get(PORTAL + "/login")
    for cesta in sorted(set(re.findall(r'/_next/static/chunks/[^"]+\.js', stranka))):
        _, js = _get(PORTAL + cesta)
        url = re.search(r"https://[a-z0-9]+\.supabase\.co", js)
        for k in re.findall(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", js):
            try:
                telo = k.split(".")[1]
                if url and json.loads(base64.urlsafe_b64decode(telo + "=" * (-len(telo) % 4))).get("role") == "anon":
                    return url.group(0), k
            except Exception:
                continue
    raise RuntimeError("Ve stránce consign-adonio.eu se nenašlo nastavení přihlášení — změnila se?")


def prihlas_web(url, klic, email, heslo):
    """Přihlášení přes Supabase → cookie, kterou stránka Moje nabídky pozná."""
    req = urllib.request.Request(url + "/auth/v1/token?grant_type=password",
                                 data=json.dumps({"email": email, "password": heslo}).encode("utf-8"), method="POST",
                                 headers={"User-Agent": UA, "apikey": klic, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            relace = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (400, 401):
            raise PermissionError("Adonio přihlášení odmítlo (Nesprávný email nebo heslo).")
        raise
    if not relace.get("access_token"):
        raise RuntimeError("Adonio po přihlášení nevrátilo token.")
    return cookie_relace(url, relace)


def cookie_relace(url, relace):
    """Tvar cookie knihovny @supabase/ssr: sb-<projekt>-auth-token=base64-…, dlouhá se dělí na .0, .1…"""
    ref = re.match(r"https://([a-z0-9]+)\.", url).group(1)
    hodnota = "base64-" + base64.urlsafe_b64encode(json.dumps(relace, separators=(",", ":")).encode("utf-8")).decode().rstrip("=")
    jmeno = "sb-%s-auth-token" % ref
    if len(hodnota) <= 3180:
        return "%s=%s" % (jmeno, hodnota)
    kusy = [hodnota[i:i + 3180] for i in range(0, len(hodnota), 3180)]
    return "; ".join("%s.%d=%s" % (jmeno, i, k) for i, k in enumerate(kusy))


def text_stranky(stranka):
    """HTML → řádky textu (jako innerText v prohlížeči)."""
    t = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", stranka)
    t = re.sub(r"(?i)<br\s*/?>|</?(div|p|li|tr|td|th|h[1-6]|button|section|article|header|footer|main)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return [re.sub(r"\s+", " ", x).strip() for x in t.split("\n") if x.strip()]


def nacti_prohlizecem(cookie):
    """Moje nabídky se dnes načítají až v prohlížeči („Načítám…"). Otevře je ve
    skutečném Chromu se stejnou přihlašovací cookie a vrátí řádky innerText
    (přesně to, co četl skill)."""
    import prohlizec as P
    with P.Prohlizec() as b:
        b._ctx.add_cookies([{"name": k.strip(), "value": v.strip(), "domain": "consign-adonio.eu", "path": "/",
                             "secure": True, "sameSite": "Lax"}
                            for k, v in (c.split("=", 1) for c in cookie.split(";") if "=" in c)])
        s = b.otevri(WEB, 2000)
        text = ""
        print("  Čekám, až se nabídky v Chromu načtou…", flush=True)
        for _ in range(30):   # nejvýš ~45 s, než se nabídky dotáhnou
            text = s.evaluate("document.body.innerText")
            if "Načítám" not in text and re.search(r"\d+\s*nab\.|Přidat|Margin", text):
                break
            s.wait_for_timeout(1500)
        s.wait_for_timeout(800)
        text = s.evaluate("document.body.innerText")
    return [re.sub(r"\s+", " ", x).strip() for x in text.split("\n") if x.strip()]


def _kc(s):
    d = re.sub(r"\D", "", s or "")
    return int(d) if d else 0


RADEK_NOVY = re.compile(r"^([\d\s\u00a0\u202f]+)Kč (\d+) (Aktivní|Neaktivní|Prodáno)( Margin)?$")


def prodanych(radky):
    return sum(1 for r in radky if (RADEK_NOVY.match(r) or [None] * 4)[3] == "Prodáno") if radky else 0


def rozeber(radky):
    """Moje nabídky (layout od 12. 10. 2026): produkt = název, SKU, „Přidat";
    varianta = velikost, Margin, ×1, Aktivní/Neaktivní, cena, nejlevnější / +N Kč, Payout, payout."""
    out, cur = [], None
    sku_re = re.compile(r"^[A-Z0-9][A-Z0-9\-/ ]{4,}$")
    for i, r in enumerate(radky):
        if r == "Přidat":
            j, sku = i - 1, ""
            if j >= 0 and sku_re.match(radky[j]) and not re.search(r"[a-z]", radky[j]):
                sku, j = radky[j], j - 1
            cur = (radky[j] if j >= 0 else "", sku)
        elif cur and RADEK_NOVY.match(r):
            # layout od 12. 11. 2026: velikost / cena / (✓ Nejlevnější | +N Kč vs nejlevnější) / „payout ks stav Margin“
            m = RADEK_NOVY.match(r)
            if m.group(3) == "Prodáno":
                continue
            j, diff = i - 1, 0
            if j >= 0 and "nejlevnější" in radky[j].lower():
                diff = _kc(radky[j]) if "vs" in radky[j] else 0
                j -= 1
            if j < 1 or not re.fullmatch(r"[\d\s\u00a0\u202f]+Kč", radky[j]):
                continue
            out.append({"nazev": cur[0], "sku": cur[1], "velikost": radky[j - 1], "cena": _kc(radky[j]),
                        "diff": diff, "payout": _kc(m.group(1)), "aktivni": m.group(3) == "Aktivní"})
        elif r == "Margin" and cur and i > 0:
            konec = next((k for k in range(i + 1, min(i + 15, len(radky))) if radky[k] in ("Margin", "Přidat")), min(i + 15, len(radky)))
            blok = radky[i + 1:konec]
            stav = next((x for x in blok if x in ("Aktivní", "Neaktivní")), "")
            po = blok[blok.index(stav) + 1:] if stav else blok
            ceny = [x for x in po if re.fullmatch(r"[\d\s  ]+Kč", x)]
            diff = next((_kc(x) for x in po if "vs nejlevnější" in x), 0)
            pay = next((_kc(po[k + 1]) for k in range(len(po) - 1) if po[k] == "Payout"), 0)
            out.append({"nazev": cur[0], "sku": cur[1], "velikost": radky[i - 1], "cena": _kc(ceny[0]) if ceny else 0,
                        "diff": diff, "payout": pay, "aktivni": stav == "Aktivní"})
    return out


# ---------- srovnání (match.py ze skillu) ----------
def norm(n):
    n = (n or "").lower().replace("women's", "w").replace("(w)", "w").replace("air jordan", "jordan")
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return set(t for t in n.split() if t not in ("x", "the", "retro"))


def sz(s):
    return (str(s or "")).replace("US", "").strip() or "OS"


def skore(a, s):
    if sz(a["velikost"]) != sz(s.get("size")):
        return 0
    if a["sku"] and a["sku"] == s.get("sku"):
        return 2.0
    A, B = norm(a["nazev"]), norm(s.get("name"))
    return len(A & B) / max(len(A | B), 1)


def vyber_sku(sku, kusy):
    """Dvojité SKU „A / B" → to, které je ve skladu, jinak A."""
    if "/" not in sku:
        return sku.strip()
    casti = [x.strip() for x in sku.split("/")]
    sklad = {p.get("sku") for p in kusy}
    return next((c for c in casti if c in sklad), casti[0])


def vyhodnot(nabidky, polozky):
    vse = [x for x in polozky if x and x.get("type") != "bulk"]
    stock = [x for x in vse if S.stav(x) == "stock" and x.get("category") in ("sneakers", "obleceni", "alternate")
             and x.get("condition") != "poskozene" and x.get("location") not in EXC]
    for n in nabidky:
        n["sku"] = vyber_sku(n["sku"], vse)
    aktivni = [n for n in nabidky if n["aktivni"]]
    neaktivni = [n for n in nabidky if not n["aktivni"]]
    grp = {}
    for s in stock:
        grp.setdefault((s.get("sku") or " ".join(sorted(norm(s.get("name")))), sz(s.get("size"))), []).append(s)
    used, smazat, platby, opravit = set(), [], [], []
    for a in aktivni:
        rucne = RUCNE.get(a["nazev"] + "|" + a["velikost"])
        if rucne:
            k = next((k for k, g in grp.items() if g[0].get("name") == rucne and sz(g[0].get("size")) == sz(a["velikost"])), None)
            sc = 2 if k else 0
        else:
            sc, k = max(((skore(a, g[0]), k) for k, g in grp.items()), default=(0, None), key=lambda x: x[0])
        if sc >= 0.7:
            g0 = grp[k][0]
            used.add(k)
            if sc < 2 and a["sku"] and g0.get("sku") and a["sku"] != g0["sku"]:
                opravit.append(dict(a, ids=[g0["id"]], duvod="SKU na Adoniu %s, ve SKLADu %s" % (a["sku"], g0["sku"])))
            nej = a["cena"] - a["diff"] if a["diff"] else None
            platby.append(dict(a, ids=[g0["id"]], nazev_sklad=g0.get("name"), nejnizsi=nej,
                               doporucena=nej - 1 if nej else None, payout_doporucena=payout(nej - 1) if nej else None))
        else:
            prod = sorted([x for x in vse if S.stav(x) != "stock" and skore(a, x) >= 0.7],
                          key=lambda x: str(x.get("payoutDate") or x.get("saleDate") or ""), reverse=True)
            if prod:
                p = prod[0]
                duvod = ("Ve SKLADu v Čeká" if S.stav(p) == "waiting" else "Prodáno") + " (%s %s)" % (p.get("soldWhere") or "?", p.get("saleDate") or "")
                smazat.append(dict(a, ids=[p["id"]], duvod=duvod))
            else:
                vyr = [x for x in vse if S.stav(x) == "stock" and skore(a, x) >= 0.7]
                smazat.append(dict(a, ids=[], duvod=("Ve SKLADu: " + (vyr[0].get("location") or "poškozené")) if vyr else "Ve SKLADu vůbec není"))
    neakt = lambda g: any(skore(r, g[0]) >= 0.7 for r in neaktivni)
    pridat = [{"nazev": g[0].get("name"), "velikost": g[0].get("size") or "", "sku": g[0].get("sku") or "", "ids": [g[0]["id"]],
               "duvod": " · ".join(x for x in ("neaktivní na Adoniu" if neakt(g) else "",
                                               "na cestě" if g[0].get("location") == "Na cestě" else "") if x)}
              for k, g in grp.items() if k not in used and g[0].get("category") != "alternate"]
    tick = [g[0] for k, g in grp.items() if k in used and not any(MISTO in p for p in g[0].get("platforms") or [])]
    untick = [s for k, g in grp.items() if k not in used for s in g if any(MISTO in p for p in s.get("platforms") or [])]
    zmeny = [{"id": s["id"], "platforma": MISTO, "zaskrtnout": True} for s in tick] + \
            [{"id": s["id"], "platforma": MISTO, "zaskrtnout": False} for s in untick]
    return {"smazat": smazat, "pridat": pridat, "opravit": opravit, "platby": platby, "zmeny": zmeny[:200],
            "nabidek": len(nabidky), "aktivnich": len(aktivni)}


def kc(n):
    return "—" if n is None else f"{int(n):,}".replace(",", " ") + " Kč"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    radek = lambda x, duvod="": {"nazev": x.get("nazev_sklad") or x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""),
                                 "ids": x.get("ids", []), "duvod": duvod}
    drazsi = sorted([x for x in r["platby"] if x["diff"]], key=lambda x: -x["diff"])
    return {
        "misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Adonio", "datum": datum,
        "souhrn": [f"Aktivních: {r['aktivnich']} z {r['nabidek']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                   f"Payout celkem: {kc(sum(x['payout'] for x in r['platby']))}"],
        "sekce": [
            {"nazev": "Smazat z Adonia", "barva": "smazat", "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
            {"nazev": "Přidat na Adonio", "barva": "pridat", "hromadne": True, "radky": [radek(x, x["duvod"]) for x in r["pridat"]]},
            {"nazev": "Opravit ve SKLADu / zkontrolovat", "barva": "opravit", "radky": [radek(x, x["duvod"]) for x in r["opravit"]]},
            {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
             "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                        "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
            {"nazev": "Nejsi nejlevnější", "barva": "info",
             "radky": [dict(radek(x, f"o {kc(x['diff'])} dráž · nejnižší {kc(x['nejnizsi'])}"),
                            udaje=[{"popis": "Nastav", "hodnota": kc(x["doporucena"])},
                                   {"popis": "Payout", "hodnota": kc(x["payout_doporucena"])}]) for x in drazsi]},
            {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee 25 %, minimum 700 Kč / ks.",
             "radky": [dict(radek(x, "nejlevnější" if not x["diff"] else "nejsi nejlevnější"),
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
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    url, klic = nastaveni_portalu()
    # Při špatném hesle se zeptá znovu, uložené nefunkční zapomene
    cookie = S.prihlas_opakovane(MISTO, lambda e, h: prihlas_web(url, klic, e, h))[0]
    with S.pracuji("Načítám Moje nabídky na Adoniu"):
        kam, stranka = _get(PORTAL + "/listings", cookie)
    radky = text_stranky(stranka)
    nabidky = rozeber(radky)
    if not nabidky and "/login" not in kam:
        print("Nabídky se na stránce načítají až v prohlížeči — otevírám je v Chromu…")
        with S.pracuji("Čtu nabídky v Chromu"):
            radky = nacti_prohlizecem(cookie)
        nabidky = rozeber(radky)
    pocet = next((int(m.group(1)) for x in radky for m in [re.match(r"^(\d+) nab\.?$", x)] if m), None)
    prodano = prodanych(radky)   # prodané řádky stránka do „N nab.“ počítá, kontrola je přeskakuje
    print(f"Adonio: {len(nabidky)} nabídek" + (f" + {prodano} prodaných" if prodano else "")
          + (f" (stránka říká {pocet})" if pocet is not None else ""))
    if not nabidky or "/login" in kam or (pocet is not None and pocet != len(nabidky) + prodano):
        cesta = S.uloz_ladici(SLOZKA, "adonio_listings.txt", "\n".join(radky))
        if not nabidky:
            raise RuntimeError("Na stránce Moje nabídky se nenašla žádná nabídka. Text stránky je v %s — pošli ho Claudovi." % cesta)
        print(f"  POZOR: počet nesedí — text stránky je v {cesta}, pošli ho Claudovi.")
    r = vyhodnot(nabidky, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    print(f"\n--- Adonio: {r['aktivnich']} aktivních z {r['nabidek']} ---")
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}" + (f"  ({x['duvod']})" if x["duvod"] else ""))
    for x in r["opravit"]:
        print(f"  ZKONTROLOVAT  {x['nazev']} {x['velikost']}  ({x['duvod']})")
    drazsi = sum(1 for x in r["platby"] if x["diff"])
    print("\n================ HOTOVO ================")
    print(f"Adonio: smazat {len(r['smazat'])} | přidat {len(r['pridat'])} | zkontrolovat {len(r['opravit'])} "
          f"| fajfky {len(r['zmeny'])} | nejsi nejlevnější {drazsi}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["aktivnich"],
        chybi=[x["ids"][0] for x in r["pridat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        opravit=[{"nazev": x["nazev"], "inzerat": x["velikost"], "sklad": x["duvod"], "odkaz": WEB, "ids": x["ids"]} for x in r["opravit"]],
        poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}, payout celkem "
                 f"{kc(sum(x['payout'] for x in r['platby']))}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_adonio.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_adonio.txt. Pošli screenshot Claudovi.")
