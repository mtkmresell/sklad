# -*- coding: utf-8 -*-
"""
Sneakerstore kontrola pro MTKM.Store (Gabro).

Otevře sell.sneakerstore.cz v prohlížeči kontrol (prohlizec.py),
přihlásí se sám heslem ze Správce pověření Windows (poprvé se zeptá), přečte Inventory a katalog (/products) a porovná
je se skladem z cloudu. Výsledek pošle do aplikace SKLAD. — fajfky, okno
Kontroly listingů a Report. Pravidla jsou ze skillu „sneakerstore-kontrola"
(jeho skript pro portál; skill zůstává jako záloha). Ceny v €.

Na Sneakerstore nic nemění — jen čte (GET stránek inventory a products,
formulář nového kusu se jen otevře kvůli cenám, nic se neodesílá).

Spuštění: SPUSTIT_sneakerstore.bat   (pošle samo; --nahled jen ukáže)
V repozitáři: nastroje/sneakerstore/sneakerstore_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
"""
import sys, os, re, json, time, traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Sneakerstore"
WEB = "https://sell.sneakerstore.cz/inventory"
VYSTUP = os.path.join(SLOZKA, "vysledek_sneakerstore.json")
EXC = ("Zrušeno", "Vráceno", "Poškozené")
FEE = 0.28

JS_TEST = "!!document.querySelector('table tbody tr') || /inventory/.test(location.pathname) && !/login|sign_in/.test(location.pathname)"
# Živé nabídky (Accepted / Active) a celý katalog — stejné čtení jako skript ve skillu
JS_DATA = r"""async()=>{
const N=s=>(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const D=h=>new DOMParser().parseFromString(h,'text/html');
const G=u=>fetch(u).then(r=>r.text());
const num=s=>parseFloat(String(s).replace(/[^\d.,]/g,'').replace(',','.'));
const live=[];
for(let p=1;p<=8;p++){const rows=[...D(await G(`/inventory?page=${p}&limit=100`)).querySelectorAll('table tbody tr')];
  for(const tr of rows){const t=[...tr.children].map(x=>x.textContent.trim());
    if(t[5]==='Accepted'||t[5]==='Active')live.push({id:t[0],pn:t[2],size:t[3]==='One Size'?'OS':t[3],sku:t[4].replace(/;+$/,'').trim(),st:t[5],price:num(t[6])});}
  if(rows.length<100)break;}
const cat=[];
let konec=false;
for(let i0=1;i0<=40&&!konec;i0+=5){const davka=await Promise.all([0,1,2,3,4].map(j=>G(`/products?page=${i0+j}&limit=100`)));  // 5 stránek katalogu naráz
 for(const h of davka){if(konec)break;const d=D(h);const cards=[...d.querySelectorAll('.card-body')];
  for(const c of cards){const root=c.parentElement||c;const a=root.querySelector('a[href*="inventories_variants"]')||c.querySelector('a[href*="/products/"]');const m=a&&a.getAttribute('href').match(/products\/(\d+)/);if(!m)continue;
    const img=root.querySelector('img');
    cat.push({id:m[1],title:(c.querySelector('.card-title')||{textContent:''}).textContent.trim(),skus:((c.querySelector('p')||{textContent:''}).textContent.trim()).split('/').map(N).filter(Boolean),img:img?img.src:''});}
  if(cards.length<100)konec=true;}}
return {live,cat};}"""
# Ceny podle velikostí z formuláře nového kusu (jen se načte, nic se neodesílá)
JS_FORMY = r"""async(ids)=>{const D=h=>new DOMParser().parseFromString(h,'text/html');const num=s=>parseFloat(String(s).replace(/[^\d.,]/g,'').replace(',','.'));const forms={};
await Promise.all(ids.map(async id=>{const d=D(await fetch(`/products/${id}/inventories_variants/new`,{headers:{'Turbo-Frame':'modal'}}).then(r=>r.text()));const o={};
  d.querySelectorAll('input[data-variant-id]').forEach(i=>{const lb=i.closest('label')||d.querySelector(`label[for="${i.id}"]`)||i.parentElement;const m=lb&&lb.textContent.replace(/\s+/g,' ').trim().match(/^(.*) - €\s?([\d.,]+)$/);if(m)o[m[1].trim()]=num(m[2]);});forms[id]=o;}));
return forms;}"""


def N(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def nacti(potrebne_fn):
    """potrebne_fn(live, cat) → id produktů, u kterých jsou potřeba ceny velikostí."""
    import prohlizec as P
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 2500)
        P.prihlas_sam(b, s, JS_TEST, MISTO, WEB, "https://sell.sneakerstore.cz/users/sign_in")
        d = s.evaluate(JS_DATA)
        forms = s.evaluate(JS_FORMY, list(potrebne_fn(d["live"], d["cat"]))) if d["live"] or d["cat"] else {}
    return d["live"], d["cat"], forms


def sklad_mapa(polozky):
    """klíč (SKU bez pomlček, nebo N+název) → {sku, name, sizes, kusy}; jen skladem, bez vyřazených."""
    stock = {}
    for x in polozky:
        if not x or x.get("type") == "bulk" or S.stav(x) != "stock" or x.get("condition") == "poskozene" or x.get("location") in EXC:
            continue
        kat = x.get("category")
        if kat not in ("sneakers", "obleceni") and not (kat == "alternate" and "labubu" in (x.get("name") or "").lower()):
            continue
        k = N(x.get("sku")) or ("N" + N(x.get("name")))
        vel = "OS" if kat == "alternate" else (x.get("size") or "").strip()
        v = stock.setdefault(k, {"sku": x.get("sku") or "", "name": x.get("name"), "sizes": {}, "na_ceste": set()})
        v["sizes"].setdefault(vel, []).append(x)
    return stock


def klic_nabidky(r, stock):
    if r["sku"]:
        return N(r["sku"])
    n = N(r["pn"])
    for k in stock:
        if k[0] == "N" and (k[1:] == n or n in k[1:] or k[1:] in n):
            return k
    return None


def potrebne(live, cat, stock):
    by_sku = {}
    for p in cat:
        for s in p["skus"]:
            by_sku.setdefault(s, p)
    ids = {by_sku[N(r["sku"])]["id"] for r in live if r["sku"] and N(r["sku"]) in by_sku}
    ids |= {by_sku[k]["id"] for k in stock if k in by_sku}
    return sorted(ids)


def vyhodnot(live, cat, forms, polozky):
    stock = sklad_mapa(polozky)
    by_sku = {}
    for p in cat:
        for s in p["skus"]:
            by_sku.setdefault(s, p)
    unk = []
    for r in live:
        r["k"] = klic_nabidky(r, stock)
        if not r["k"]:
            unk.append(r)
    L = {(r["k"], r["size"]) for r in live if r["k"] and r["k"] in stock}
    smazat, fix = [], []
    for r in live:
        if not r["k"] or (r["k"] in stock and r["size"] in stock[r["k"]]["sizes"]):
            continue
        cand = [s for s in stock[r["k"]]["sizes"] if (r["k"], s) not in L] if r["k"] in stock else []
        if cand:
            fix.append(dict(r, nazev=stock[r["k"]]["name"], ids=[stock[r["k"]]["sizes"][cand[0]][0]["id"]],
                            duvod="Na Sneakerstore %s → ve SKLADu %s" % (r["size"], "/".join(cand)), kandidati=cand))
        else:
            prod = sorted([x for x in polozky if x and S.stav(x) in ("waiting", "paid") and (x.get("size") or "").strip() == r["size"]
                           and (N(x.get("sku")) == r["k"] or ("N" + N(x.get("name"))) == r["k"])],
                          key=lambda x: str(x.get("payoutDate") or x.get("saleDate") or ""), reverse=True)
            if prod:
                duvod = ("Ve SKLADu v Čeká" if S.stav(prod[0]) == "waiting" else "Prodáno") + " (%s)" % (prod[0].get("soldWhere") or "?")
            else:
                duvod = "Ve SKLADu skladem není"
            smazat.append(dict(r, nazev=r["pn"], ids=[prod[0]["id"]] if prod else [], duvod=duvod))
    opravene = {(f["k"], s) for f in fix for s in f["kandidati"]}
    pridat = []
    for k, v in stock.items():
        for sz, kusy in v["sizes"].items():
            if (k, sz) in L or (k, sz) in opravene:
                continue
            p = by_sku.get(k)
            kat, pozn = 0, "není v katalogu"
            if p:
                pr = (forms.get(p["id"]) or {}).get(sz)
                if pr is not None:
                    kat, pozn = 1, "%s € → payout %s €" % (_eur(pr), _eur(round(pr * (1 - FEE))))
                else:
                    pozn = "velikost není v nabídce"
            na_ceste = any(x.get("location") == "Na cestě" for x in kusy)
            pridat.append({"sku": v["sku"], "nazev": v["name"], "velikost": sz, "ids": [kusy[0]["id"]], "kat": kat,
                           "duvod": " · ".join(x for x in (pozn, "na cestě" if na_ceste else "") if x),
                           "obrazek": (p or {}).get("img", "")})
    platby = []
    for r in live:
        if r["k"] in stock and r["size"] in stock[r["k"]]["sizes"]:
            p = r["sku"] and by_sku.get(N(r["sku"]))
            f = forms.get(p["id"]) if p else None
            low = f[r["size"]] if f and f.get(r["size"]) is not None else r["price"]
            platby.append({"sku": r["sku"], "nazev": stock[r["k"]]["name"], "velikost": r["size"], "cena": r["price"],
                           "nejnizsi": low, "payout": round(r["price"] * (1 - FEE), 2),
                           "ids": [stock[r["k"]]["sizes"][r["size"]][0]["id"]], "stav": r["st"]})
    zmeny = []
    for k, v in stock.items():
        for sz, kusy in v["sizes"].items():
            visi = (k, sz) in L
            maji = [x for x in kusy if MISTO in (x.get("platforms") or [])]
            if visi and not maji:
                zmeny.append({"id": kusy[0]["id"], "platforma": MISTO, "zaskrtnout": True})
            if not visi and maji:
                zmeny += [{"id": x["id"], "platforma": MISTO, "zaskrtnout": False} for x in maji]
    return {"smazat": smazat, "opravit": fix, "pridat": pridat, "platby": platby, "nespárované": unk, "zmeny": zmeny,
            "zive": len(live), "accepted": sum(1 for r in live if r["st"] == "Accepted"), "katalog": len(cat)}


def _eur(n):
    return ("%g" % round(n, 2)).replace(".", ",")


def eur(n):
    return "—" if n is None else _eur(n) + " €"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    rad = lambda x, d="": {"nazev": x.get("nazev") or "", "velikost": x.get("velikost") or x.get("size") or "", "sku": x.get("sku", ""),
                           "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": d}
    drazsi = sorted([x for x in r["platby"] if x["cena"] > x["nejnizsi"]], key=lambda x: x["nejnizsi"] - x["cena"])
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Sneakerstore", "datum": datum,
            "souhrn": [f"Živých: {r['zive']} (Accepted {r['accepted']})", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                       f"Payout celkem: {eur(sum(x['payout'] for x in r['platby']))}"],
            "sekce": [
                {"nazev": "Přidat", "barva": "pridat", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if x["kat"]]},
                {"nazev": "Nejde nalistovat — není v katalogu", "barva": "info", "hromadne": True,
                 "radky": [rad(x, x["duvod"]) for x in r["pridat"] if not x["kat"]]},
                {"nazev": "Smazat ze Sneakerstore", "barva": "smazat", "radky": [rad(dict(x, velikost=x["size"]), "%s · ID %s" % (x["duvod"], x["id"])) for x in r["smazat"]]},
                {"nazev": "Opravit na Sneakerstore", "barva": "opravit", "radky": [rad(x, x["duvod"]) for x in r["opravit"]]},
                {"nazev": "Ověřit ručně (nespárováno)", "barva": "overit", "radky": [{"nazev": x["pn"], "velikost": x["size"], "duvod": "bez SKU, ve SKLADu nenalezeno"} for x in r["nespárované"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
                {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee 28 %.",
                 "radky": [dict(rad(x, "nejlevnější" if x["cena"] <= x["nejnizsi"] else "nejsi nejlevnější · nejnižší %s → payout %s"
                                    % (eur(x["nejnizsi"]), eur(round(x["nejnizsi"] * (1 - FEE), 2)))),
                                udaje=[{"popis": "Cena", "hodnota": eur(x["cena"])}, {"popis": "Payout", "hodnota": eur(x["payout"])}])
                           for x in r["platby"]]},
            ]}


def main(argv):
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    stock = sklad_mapa(polozky)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    live, cat, forms = nacti(lambda l, c: potrebne(l, c, stock))
    print(f"Sneakerstore: {len(live)} živých nabídek, katalog {len(cat)} produktů")
    if not cat:
        S.uloz_ladici(SLOZKA, "sneakerstore_prazdny_katalog.txt", "katalog se nenačetl")
    r = vyhodnot(live, cat, forms, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1, default=list)
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']} {x['size']} (ID {x['id']}, {x['duvod']})")
    for x in r["opravit"]:
        print(f"  OPRAVIT  {x['nazev']}  {x['duvod']}")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    print("\n================ HOTOVO ================")
    print(f"Sneakerstore: smazat {len(r['smazat'])} | opravit {len(r['opravit'])} | přidat {sum(1 for x in r['pridat'] if x['kat'])} "
          f"(+{sum(1 for x in r['pridat'] if not x['kat'])} nejde) | fajfky {len(r['zmeny'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    drazsi = sum(1 for x in r["platby"] if x["cena"] > x["nejnizsi"])
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["zive"],
        chybi=[x["ids"][0] for x in r["pridat"] if x["kat"]],
        nejde=[{"id": x["ids"][0], "duvod": x["duvod"]} for x in r["pridat"] if not x["kat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["size"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        opravit=[{"nazev": x["nazev"], "inzerat": x["size"], "sklad": "/".join(x["kandidati"]), "odkaz": WEB, "ids": x["ids"]} for x in r["opravit"]],
        poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}, payout celkem {eur(sum(x['payout'] for x in r['platby']))}"),
        argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_sneakerstore.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_sneakerstore.txt. Pošli screenshot Claudovi.")
