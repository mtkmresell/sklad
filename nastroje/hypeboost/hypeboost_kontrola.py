# -*- coding: utf-8 -*-
"""
Hypeboost kontrola pro MTKM.Store (Gabro).

Otevře My sales → Current na hypeboost.com v prohlížeči kontrol
(prohlizec.py) a přihlásí se sám heslem ze Správce pověření (ověření Cloudflare
možná občas odklikneš v okně), přečte
všechny listingy a porovná je se skladem z cloudu (jen sneakers). Výsledek
pošle do aplikace SKLAD. — fajfky, okno Kontroly listingů a Report.
Pravidla jsou ze skillu „hypeboost-kontrola" (zůstává jako záloha).

Na Hypeboostu jediná změna: vždy, bez ptaní, prodlouží listingy z „almost
expired" (+14 dní) — Gabro to chce u každé kontroly (1. 10. 2026).

Spuštění: SPUSTIT_hypeboost.bat   (pošle samo; --nahled jen ukáže)
V repozitáři: nastroje/hypeboost/hypeboost_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
"""
import sys, os, re, json, time, traceback, unicodedata

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Hypeboost"
WEB = "https://hypeboost.com/en/account/sales/current"
VYSTUP = os.path.join(SLOZKA, "vysledek_hypeboost.json")
FEE = 0.085   # fee level 3 pro stávající listingy (skill)
ALIAS = {"adidas samba og jjjjound mesa": "adidas samba og jjjjound tobacco", "nike dunk low se jackpot gs": "nike dunk low jackpot gs"}
EXC = ("Zrušeno", "Vráceno", "Poškozené")

JS_TEST = "!/Okamžik|Just a moment/i.test(document.title) && !/login/.test(location.pathname) && !!document.querySelector('.grid-row')"
# Všechny stránky My sales (stránkování ?p=N, pauzy kvůli 429) → [název, velikost, cena, nejnižší, obrázek]
JS_NABIDKY = r"""async()=>{const S=ms=>new Promise(r=>setTimeout(r,ms));
const G=async u=>{for(let a=0;a<4;a++){const r=await fetch(u,{credentials:'include'});if(r.status===429){await S(8000);continue;}return r;}return null;};
const num=t=>parseFloat(t.replace(/\./g,'').replace(',','.'));
const parse=d=>[...d.querySelectorAll('.grid-row')].map(r=>{const m=r.textContent.replace(/\s+/g,' ').trim().match(/^(.*?)\s*Edit\s*Size:\s*(.*?)\s*Price:\s*([\d.,]+)\s*€\s*Lowest price:\s*([\d.,]+)\s*€/);const img=r.querySelector('img');return m?[m[1].trim(),m[2].trim(),num(m[3]),num(m[4]),img?img.src:'']:null}).filter(Boolean);
const last=Math.max(1,...[...document.querySelectorAll('a')].map(a=>+(a.href.match(/current\?p=(\d+)/)||[])[1]||1));
let hb=parse(document),bad=0;
for(let p=2;p<=last;p++){await S(1200);const r=await G('/en/account/sales/current?p='+p);if(!r){bad++;continue;}hb=hb.concat(parse(new DOMParser().parseFromString(await r.text(),'text/html')));}
return {stran:last,bad,radky:hb};}"""
# Prodloužení almost expired (každý odkaz = GET na /current/<id>/extend, +14 dní)
JS_PRODLOUZIT = r"""async()=>{const S=ms=>new Promise(r=>setTimeout(r,ms));
const G=async u=>{for(let a=0;a<4;a++){const r=await fetch(u,{credentials:'include'});if(r.status===429){await S(8000);continue;}return r;}return null;};
const B='/en/account/sales/current/almost-expired';let urls=[];for(let p=1;p<=10;p++){await S(1500);const r=await G(B+(p>1?'?p='+p:''));if(!r)break;const u=[...new DOMParser().parseFromString(await r.text(),'text/html').querySelectorAll('a.extend-listing')].map(a=>a.getAttribute('href'));if(!u.length)break;urls=urls.concat(u);}urls=[...new Set(urls)];let ok=0,fail=0;for(const u of urls){await S(2500);const r=await G(u);r&&r.ok?ok++:fail++;}return {found:urls.length,ok,fail};}"""


def N(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[\"'‘’“”]", "", s)
    s = re.sub(r"\((womens|w)\)", " ", s)
    s = re.sub(r"[()]", " ", s)
    s = re.sub(r"\bair jordan\b", "jordan", s)
    s = re.sub(r"\s+x\s+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return ALIAS.get(s, s)


def Z(z):
    return str(z or "").replace(" 1/3", ".33").replace(" 2/3", ".67").strip()


def pismenna(v):
    return bool(re.fullmatch(r"(X{0,3}S|M|X{0,3}L|OS|ONE SIZE)(/.*)?", str(v or "").strip().upper()))


def vyhodnot(hb, polozky):
    vse = [x for x in polozky if x and x.get("type") != "bulk" and x.get("category") == "sneakers"]
    sklad = [x for x in vse if S.stav(x) == "stock" and x.get("location") not in EXC and x.get("condition") != "poskozene"
             and not pismenna(x.get("size"))]
    K = lambda n, z: N(n) + "|" + Z(z)
    skup = {}
    for x in sklad:
        skup.setdefault(K(x.get("name"), x.get("size")), []).append(x)
    hs = {K(a[0], a[1]) for a in hb}
    pridat = [{"nazev": g[0].get("name"), "velikost": g[0].get("size"), "sku": g[0].get("sku") or "", "ids": [g[0]["id"]],
               "duvod": "na cestě" if any(x.get("location") == "Na cestě" for x in g) else ""}
              for k, g in skup.items() if k not in hs]
    smazat, overit, platby = [], [], []
    for n, z, cena, lo, img in hb:
        k = K(n, z)
        g = skup.get(k)
        if g:
            platby.append({"nazev": g[0].get("name"), "sku": g[0].get("sku") or "", "velikost": z, "cena": cena, "nejnizsi": lo,
                           "payout": round(cena * (1 - FEE), 2), "ids": [g[0]["id"]], "obrazek": img})
            continue
        prod = sorted([x for x in vse if S.stav(x) in ("waiting", "paid") and K(x.get("name"), x.get("size")) == k],
                      key=lambda x: str(x.get("payoutDate") or x.get("saleDate") or ""), reverse=True)
        if prod:
            p = prod[0]
            smazat.append({"nazev": n, "velikost": z, "sku": p.get("sku") or "", "ids": [p["id"]], "obrazek": img,
                           "duvod": ("Ve SKLADu v Čeká" if S.stav(p) == "waiting" else "Prodáno") + " (%s)" % (p.get("soldWhere") or "?")})
        elif any(K(x.get("name"), x.get("size")) == k for x in vse):
            x = next(x for x in vse if K(x.get("name"), x.get("size")) == k)
            smazat.append({"nazev": n, "velikost": z, "sku": x.get("sku") or "", "ids": [], "obrazek": img,
                           "duvod": "Ve SKLADu: " + (x.get("location") or "poškozené")})
        else:   # ve SKLADu nikdy nebylo — Gabro si občas nalistuje kvůli sledování ceny
            overit.append({"nazev": n, "velikost": z, "sku": "", "ids": [], "obrazek": img, "duvod": "Ve SKLADu nikdy nebylo — sledování ceny?"})
    zmeny = []
    for k, g in skup.items():
        maji = [x for x in g if MISTO in (x.get("platforms") or [])]
        if k in hs and not maji:
            zmeny.append({"id": g[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        if k not in hs:
            zmeny += [{"id": x["id"], "platforma": MISTO, "zaskrtnout": False} for x in maji]
    for x in vse:
        if S.stav(x) == "stock" and (x.get("location") in EXC or x.get("condition") == "poskozene") and MISTO in (x.get("platforms") or []):
            zmeny.append({"id": x["id"], "platforma": MISTO, "zaskrtnout": False})
    return {"pridat": pridat, "smazat": smazat, "overit": overit, "platby": platby, "zmeny": zmeny, "listingu": len(hb)}


def eur(n):
    return "—" if n is None else ("%g" % round(n, 2)).replace(".", ",") + " €"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    rad = lambda x, d="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""), "ids": x.get("ids", []),
                           "obrazek": x.get("obrazek", ""), "duvod": d}
    drazsi = sorted([x for x in r["platby"] if x["cena"] > x["nejnizsi"]], key=lambda x: x["nejnizsi"] - x["cena"])
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Hypeboost", "datum": datum,
            "souhrn": [f"Listingů: {r['listingu']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                       f"Payout celkem: {eur(sum(x['payout'] for x in r['platby']))}"]
                      + ([f"Prodlouženo: {r['prodlouzeno']['ok']} z {r['prodlouzeno']['found']}"] if r.get("prodlouzeno") else []),
            "sekce": [
                {"nazev": "Přidat na Hypeboost", "barva": "pridat", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"]]},
                {"nazev": "Smazat z Hypeboostu", "barva": "smazat", "radky": [rad(x, x["duvod"]) for x in r["smazat"]]},
                {"nazev": "Ověřit", "barva": "overit", "radky": [rad(x, x["duvod"]) for x in r["overit"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
                {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee 8,5 %.",
                 "radky": [dict(rad(x, "nejlevnější" if x["cena"] <= x["nejnizsi"] else "nejsi nejlevnější · nejnižší " + eur(x["nejnizsi"])),
                                udaje=[{"popis": "Cena", "hodnota": eur(x["cena"])}, {"popis": "Payout", "hodnota": eur(x["payout"])}])
                           for x in r["platby"]]},
            ]}


def main(argv):
    import prohlizec as P
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 3000)
        P.prihlas_sam(b, s, JS_TEST, MISTO, WEB, "https://hypeboost.com/en/login")
        with S.pracuji("Čtu listingy na Hypeboost"):
            d = s.evaluate(JS_NABIDKY)
        if d["bad"]:
            raise RuntimeError("Hypeboost: %d stránek se nenačetlo (429). Spusť znovu — výsledek by nebyl spolehlivý." % d["bad"])
        if not d["radky"]:
            raise RuntimeError("Hypeboost nevrátil žádný listing — nikdy se to nebere jako „všechno chybí“. Zkontroluj okno prohlížeče.")
        hb = [tuple(x) for x in d["radky"]]
        print(f"Hypeboost: {len(hb)} listingů na {d['stran']} stránkách")
        r = vyhodnot(hb, polozky)
        datum = S._iso_ted()
        for x in r["smazat"]:
            print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
        for x in r["pridat"]:
            print(f"  PŘIDAT   {x['nazev']} {x['velikost']}")
        for x in r["overit"]:
            print(f"  OVĚŘIT   {x['nazev']} {x['velikost']}")
        print("\n================ HOTOVO ================")
        print(f"Hypeboost: přidat {len(r['pridat'])} | smazat {len(r['smazat'])} | ověřit {len(r['overit'])} | fajfky {len(r['zmeny'])}")
        print(f"Trvalo {int(time.time() - start)} s. Teď se ještě prodlouží almost expired (asi 2,5 s na listing).")

        def prodluz():
            with S.pracuji("Prodlužuji almost expired na Hypeboost"):
                r["prodlouzeno"] = s.evaluate(JS_PRODLOUZIT)
            print("Prodlouženo %(ok)d z %(found)d" % r["prodlouzeno"] + (" (%(fail)d selhalo)" % r["prodlouzeno"] if r["prodlouzeno"]["fail"] else ""))
            rep.update(sestav_report(r, datum, polozky))

        rep = sestav_report(r, datum, polozky)
        drazsi = sum(1 for x in r["platby"] if x["cena"] > x["nejnizsi"])
        S.dokonci_kontrolu(token, data, polozky, r["zmeny"], rep, dict(
            misto=MISTO, web=WEB, datum=datum, inzeratu=r["listingu"], chybi=[x["ids"][0] for x in r["pridat"]],
            smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
            neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
            poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}, payout celkem {eur(sum(x['payout'] for x in r['platby']))}"),
            argv, pred_odeslanim=prodluz)
        with open(VYSTUP, "w", encoding="utf-8") as f:
            json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_hypeboost.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_hypeboost.txt. Pošli screenshot Claudovi.")
