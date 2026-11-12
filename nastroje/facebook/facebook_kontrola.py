# -*- coding: utf-8 -*-
"""
Facebook Marketplace kontrola pro MTKM.Store (Gabro).

Otevře facebook.com/marketplace/you/selling v prohlížeči kontrol
(prohlizec.py — na Facebook se přihlásíš v okně sám, jednou), načte
tvoje prodejní inzeráty stejným dotazem, jaký posílá stránka sama
(jako skill), a porovná je se skladem z cloudu. Výsledek pošle do
aplikace SKLAD. — fajfky, okno Kontroly listingů a Report. Pravidla jsou
ze skillu „facebook-kontrola" (zůstává jako záloha).

Chodí se JEN na stránku tvých prodejních inzerátů, nikam jinam. Na
Facebooku nic nemění. 1 inzerát = 1 model, velikosti jsou v popisu —
porovnává se jen model.

Spuštění: SPUSTIT_facebook.bat   (--odeslat / --nahled)
V repozitáři: nastroje/facebook/facebook_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
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

MISTO = "Facebook"
WEB = "https://www.facebook.com/marketplace/you/selling"
VYSTUP = os.path.join(SLOZKA, "vysledek_facebook.json")
EXC = ("Zrušeno", "Vráceno", "Poškozené")
# Názvy na Facebooku se liší od SKLADu (skill): překlepy a jiná slova pro totéž
NAHRADY = [("coretiz", "corteiz"), ("air jordan", "jordan"), (r"\bpg\b", "og"), ("ikea svicen", "vinterfint svicen")]
STOP = {"x", "the", "retro", "nike", "adidas", "jordan", "og", "low", "high", "mid", "sneakers", "boty", "tenisky", "nove", "new",
        "velikost", "vel", "eu", "ds", "w", "wmns", "womens", "a", "s", "v", "na", "pro"}
JISTA, NEJISTA = 0.8, 0.6

JS_TEST = "!/login|checkpoint/.test(location.pathname) && !!document.querySelector('[role=main]')"
# Zachytí dotaz stránky na seznam inzerátů (skill krok 3a)
JS_HOOK = r"""async()=>{window.__cap=window.__cap||[];if(!window.__hook){window.__hook=1;const o=XMLHttpRequest.prototype.open,s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return o.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){try{if(/graphql/.test(this.__u)&&typeof b==='string'&&/MarketplaceYouSelling/.test(b))window.__cap.push(b)}catch(e){}return s.apply(this,arguments)}}
for(let i=0;i<6;i++){document.querySelectorAll('*').forEach(e=>{if(e.scrollHeight>e.clientHeight+50&&/(auto|scroll)/.test(getComputedStyle(e).overflowY))e.scrollTop=e.scrollHeight});window.scrollTo(0,document.body.scrollHeight);await new Promise(r=>setTimeout(r,2000));}
return window.__cap.filter(b=>/PaginationQuery/.test(b)).length}"""
# Zopakuje zachycený dotaz po dávkách (count 50, cursor), skill krok 3b–c
JS_STAHNI = r"""async()=>{const b=window.__cap.filter(x=>/PaginationQuery/.test(x)).pop();if(!b)return {chyba:'dotaz se nezachytil'};const out=[];let cursor=null,dalsi=true,n=0;
while(dalsi&&n<40){n++;const p=new URLSearchParams(b);const v=JSON.parse(p.get('variables'));v.count=50;v.cursor=cursor;p.set('variables',JSON.stringify(v));
const t=await fetch('/api/graphql/',{method:'POST',body:p,credentials:'include'}).then(r=>r.text());const L=t.replace(/^for \(;;\);/,'').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
let pi=null;for(const j of L){const sets=j.data&&j.data.viewer&&j.data.viewer.marketplace_listing_sets;if(sets){(sets.edges||[]).forEach(e=>{const f=e.node&&e.node.first_listing;if(f)out.push({id:f.id,nazev:f.marketplace_listing_title,cena:f.formatted_price&&f.formatted_price.text,stav:f.renderable_listing_status,koncept:!!f.is_draft,prodano:!!f.is_sold,obrazek:(f.primary_listing_photo&&f.primary_listing_photo.image&&f.primary_listing_photo.image.uri)||''})});if(sets.page_info)pi=sets.page_info;}if(j.data&&j.data.page_info)pi=j.data.page_info;}
dalsi=!!(pi&&pi.has_next_page);cursor=pi&&pi.end_cursor;if(!cursor)break;await new Promise(r=>setTimeout(r,800));}
return {inzeraty:out};}"""


def slova(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    for a, b in NAHRADY:
        s = re.sub(a, b, s)
    return {t for t in re.sub(r"[^a-z0-9]+", " ", s).split() if t not in STOP and not re.fullmatch(r"\d{2}([.,]\d)?", t)}


def shoda(a, b):
    A, B = slova(a), slova(b)
    spolu = len(A & B)
    return spolu / min(len(A), len(B)) if A and B and spolu >= 2 else 0.0


def vyhodnot(inzeraty, polozky):
    vse = [x for x in polozky if x and x.get("type") != "bulk"]
    sklad = [x for x in vse if S.stav(x) == "stock" and x.get("condition") != "poskozene" and x.get("location") not in EXC]
    modely = {}
    for x in sklad:
        modely.setdefault(" ".join(sorted(slova(x.get("name")))) or x.get("name"), []).append(x)
    aktivni = [i for i in inzeraty if not i["koncept"] and not i["prodano"]]
    koncepty = [i for i in inzeraty if i["koncept"]]

    def nejlepsi(nazev):
        b = max(((shoda(nazev, g[0].get("name")), k) for k, g in modely.items()), default=(0, None), key=lambda x: x[0])
        return b

    pouzito, smazat, overit = {}, [], []
    for i in aktivni:
        sc, k = nejlepsi(i["nazev"])
        if sc >= JISTA:
            pouzito.setdefault(k, []).append(i)
            continue
        if sc >= NEJISTA:
            overit.append({"nazev": i["nazev"], "velikost": "", "ids": [modely[k][0]["id"]], "obrazek": i.get("obrazek", ""),
                           "duvod": "Podobné ve SKLADu: " + modely[k][0].get("name")})
            pouzito.setdefault(k, [])
            continue
        prod = sorted([x for x in vse if S.stav(x) in ("waiting", "paid") and shoda(i["nazev"], x.get("name")) >= JISTA],
                      key=lambda x: str(x.get("saleDate") or ""), reverse=True)
        if prod:
            p = prod[0]
            smazat.append({"nazev": i["nazev"], "velikost": "", "sku": p.get("sku") or "", "ids": [p["id"]], "obrazek": i.get("obrazek", ""),
                           "duvod": ("Ve SKLADu v Čeká" if S.stav(p) == "waiting" else "Prodáno") + " (%s %s)" % (p.get("soldWhere") or "?", p.get("saleDate") or "")})
        else:
            smazat.append({"nazev": i["nazev"], "velikost": "", "sku": "", "ids": [], "obrazek": i.get("obrazek", ""), "duvod": "Ve SKLADu není"})
    for k, inz in pouzito.items():
        if len(inz) > 1 and len(inz) > len(modely[k]):   # duplicitní inzerát: model visí víckrát, než je kusů
            for i in inz[len(modely[k]):]:
                smazat.append({"nazev": i["nazev"], "velikost": "", "sku": modely[k][0].get("sku") or "", "ids": [],
                               "obrazek": i.get("obrazek", ""), "duvod": "Duplicitní inzerát (skladem %d ks)" % len(modely[k])})
    pridat = []
    for k, g in modely.items():
        if k in pouzito:
            continue
        x = g[0]
        koncept = any(shoda(c["nazev"], x.get("name")) >= JISTA for c in koncepty)
        stit = [s for s in ("na cestě" if any(y.get("location") == "Na cestě" for y in g) else "", "jen koncept" if koncept else "") if s]
        pridat.append({"nazev": x.get("name"), "velikost": ", ".join(sorted({str(y.get("size") or "") for y in g if y.get("size")})),
                       "sku": x.get("sku") or "", "ids": [x["id"]], "kat": 1 if x.get("category") in ("sneakers", "obleceni") else 0,
                       "duvod": " · ".join(stit)})
    zmeny = []
    for k, g in modely.items():
        maji = [x for x in g if MISTO in (x.get("platforms") or [])]
        if pouzito.get(k) and not maji:
            zmeny.append({"id": g[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        if k not in pouzito and maji:
            zmeny += [{"id": x["id"], "platforma": MISTO, "zaskrtnout": False} for x in maji]
    for x in vse:
        if S.stav(x) == "stock" and (x.get("condition") == "poskozene" or x.get("location") in EXC) and MISTO in (x.get("platforms") or []):
            zmeny.append({"id": x["id"], "platforma": MISTO, "zaskrtnout": False})
    return {"pridat": pridat, "smazat": smazat, "overit": overit, "zmeny": zmeny, "aktivnich": len(aktivni),
            "konceptu": len(koncepty), "celkem": len(inzeraty)}


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    rad = lambda x, d="": {"nazev": x["nazev"], "velikost": x.get("velikost", ""), "sku": x.get("sku", ""), "ids": x.get("ids", []),
                           "obrazek": x.get("obrazek", ""), "duvod": d}
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Facebook", "datum": datum,
            "souhrn": [f"Aktivních inzerátů: {r['aktivnich']}", f"Konceptů: {r['konceptu']}"],
            "sekce": [
                {"nazev": "Přidat na Facebook", "barva": "pridat", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if x["kat"]]},
                {"nazev": "Ostatní kategorie", "barva": "info", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if not x["kat"]]},
                {"nazev": "Smazat z Facebooku", "barva": "smazat", "radky": [rad(x, x["duvod"]) for x in r["smazat"]]},
                {"nazev": "Ověřit ručně", "barva": "overit", "radky": [rad(x, x["duvod"]) for x in r["overit"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
            ]}


def main(argv):
    import prohlizec as P
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 4000)
        b.prihlaseni(s, JS_TEST, "Facebook", WEB)
        for _ in range(2):
            if s.evaluate(JS_HOOK):
                break
            s.reload(wait_until="domcontentloaded")
            s.wait_for_timeout(4000)
        d = s.evaluate(JS_STAHNI)
    if d.get("chyba") or not d.get("inzeraty"):
        raise RuntimeError("Facebook: %s. Nech okno prohlížeče větší (aspoň 1280 px) a spusť znovu." % (d.get("chyba") or "žádné inzeráty"))
    inz = list({i["id"]: i for i in d["inzeraty"]}.values())
    print(f"Facebook: {len(inz)} inzerátů")
    r = vyhodnot(inz, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}" + ("" if x["kat"] else "  (ostatní kategorie)"))
    for x in r["overit"]:
        print(f"  OVĚŘIT   {x['nazev']}  ({x['duvod']})")
    print("\n================ HOTOVO ================")
    print(f"Facebook: přidat {sum(1 for x in r['pridat'] if x['kat'])} | smazat {len(r['smazat'])} | ověřit {len(r['overit'])} | fajfky {len(r['zmeny'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["aktivnich"],
        chybi=[x["ids"][0] for x in r["pridat"] if x["kat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": "", "odkaz": WEB} for x in r["smazat"] if not x["ids"]]), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_facebook.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_facebook.txt. Pošli screenshot Claudovi.")
