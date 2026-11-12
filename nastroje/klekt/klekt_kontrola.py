# -*- coding: utf-8 -*-
"""
KLEKT kontrola pro MTKM.Store (Gabro).

Otevře klekt.com/profile/seller/listings v prohlížeči kontrol
(prohlizec.py) a přihlásí se sám heslem ze Správce pověření Windows (poprvé se zeptá, jako Sellect), přečte nabídky přes
jejich .data endpointy (stejný dekodér jako skill), z katalogu doplní EU
velikosti a nejnižší ceny ostatních a porovná to se skladem z cloudu.
Výsledek pošle do aplikace SKLAD. — fajfky, okno Kontroly listingů
a Report. Pravidla jsou ze skillu „klekt-kontrola" (zůstává jako záloha).

Na KLEKT jediná změna: vždy, bez ptaní, prodlouží expiraci všech nabídek na
60 dní (kromě IE5836), sekvenčně, cena a množství beze změny.
Osobní údaje účtu z .data odpovědí se nikam nevypisují ani neukládají.

Spuštění: SPUSTIT_klekt.bat   (pošle samo; --nahled jen ukáže)
V repozitáři: nastroje/klekt/klekt_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
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

MISTO = "Klekt"
WEB = "https://klekt.com/profile/seller/listings"
VYSTUP = os.path.join(SLOZKA, "vysledek_klekt.json")
IGNOROVAT = {"IE5836"}   # roky starý bug na straně KLEKT — nehlásit, neprodlužovat, ne do Payoutů
EXC = ("Zrušeno", "Vráceno", "Poškozené")

# Dekodér turbo-stream (řádek 1 = plochý JSON, klíče _N = index názvu, čísla = indexy)
JS_LIB = r"""window.__k={dec(t){const G=JSON.parse(t.split('\n')[0]);const memo=new Map();const r=i=>{if(typeof i!=='number')return i;if(i<0)return null;if(memo.has(i))return memo.get(i);const v=G[i];let o=v;if(Array.isArray(v)){o=[];memo.set(i,o);v.forEach(x=>o.push(r(x)));}else if(v&&typeof v==='object'){o={};memo.set(i,o);for(const k in v){const n=k[0]==='_'?G[+k.slice(1)]:k;o[n]=r(v[k]);}}return o;};return r(0);},
najdi(o,re,h=0){if(!o||typeof o!=='object'||h>6)return null;for(const k in o){if(re.test(k))return o[k];const x=this.najdi(o[k],re,h+1);if(x)return x;}return null;},
async get(u){for(let a=0;a<4;a++){const r=await fetch(u,{credentials:'include'});if(r.status===429){await new Promise(s=>setTimeout(s,5000));continue;}return r.ok?await r.text():null;}return null;}};true"""
JS_TEST = "fetch('/profile/seller/listings.data?page=1',{credentials:'include'}).then(r=>r.ok&&!/login/.test(r.url)).catch(()=>false)"
JS_NABIDKY = r"""async()=>{const out=[];for(let p=1;p<=20;p++){const t=await __k.get('/profile/seller/listings.data?page='+p);if(!t)break;const m=__k.dec(t);const sl=__k.najdi(m,/seller-listings$/);const L=(sl&&sl.data&&sl.data.listings)||[];if(!L.length)break;
for(const l of L){const a=l.attributes||l;out.push({id:String(l.id||a.id),name:a.name,sku:a.sku,size:a.formatted_size,price:(a.sale_price_cents||0)/100,qty:a.quantity,exp:a.expired_at,status:a.status,img:a.image_url||a.thumbnail_url||''});}
if(L.length<25)break;}return out;}"""
JS_FEED = r"""async(skus)=>{const res={};const fr0=[...skus];await Promise.all([0,1,2].map(async()=>{while(fr0.length){const sku=fr0.shift();const seen=new Map();for(let p=1;p<=14;p++){const t=await __k.get('/catalog.data?search='+encodeURIComponent(sku)+'&page='+p);if(!t)break;const m=__k.dec(t);const cb=__k.najdi(m,/catalog-bare$/);const fr=cb&&cb.data&&cb.data.feedResponse;const D=(fr&&fr.data)||[];D.forEach(d=>{const a=d.attributes||{};seen.set(String(d.id),{id:String(d.id),name:a.name,price:+a.sale_price,size:a.size||[],fs:a.formatted_size,type:a.listing_type,img:a.image_url||''});});const pg=fr&&fr.meta&&fr.meta.pagy;if(!D.length||(pg&&pg.page>=pg.pages))break;}res[sku]=[...seen.values()];}}));return res;}"""
JS_AUTO = r"""async(skus)=>{const res={};const fr0=[...skus];await Promise.all([0,1,2].map(async()=>{while(fr0.length){const sku=fr0.shift();try{const r=await fetch('https://api.k-v3.com/api/v2/catalogs/autocomplete?search='+encodeURIComponent(sku)+'&page[number]=1&page[size]=40');const j=await r.json();res[sku]=(j.data||[]).map(d=>({name:d.attributes.name,sku:d.attributes.sku}));}catch(e){res[sku]=null;}}}));return res;}"""
JS_PRODLOUZIT = r"""async(ids)=>{let ok=0,fail=[];for(const id of ids){let hotovo=false;for(let a=0;a<4&&!hotovo;a++){try{const t=await __k.get('/profile/seller/listings/'+id+'/edit.data');if(!t)continue;const m=__k.dec(t);const e=__k.najdi(m,/seller-listing-edit$/);const l=e&&e.data&&e.data.listing;if(!l)continue;
const f=new URLSearchParams({quantity:String(l.quantity),salePriceCents:String(l.salePriceCents),expiration:'60'});if(l.acceptBids){f.set('acceptBids','true');if(l.bidRange!=null)f.set('bidRange',String(l.bidRange));}
const r=await fetch('/profile/seller/listings/'+id+'/edit',{method:'POST',body:f,credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'}});hotovo=r.ok;}catch(e){}}hotovo?ok++:fail.push(id);}return {ok,fail};}"""


def nsku(s):
    return re.sub(r"\s+", "-", (s or "").strip().upper())


def nvel(s):
    s = str(s or "").upper().replace("EU", "").replace(" 1/3", ".33").replace(" 2/3", ".67").replace(",", ".").strip()
    s = re.sub(r"\.0$", "", s.replace(" ", ""))
    return {"ONESIZE": "OS", "": "OS"}.get(s, s)


def nnaz(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("air jordan", "jordan")
    return re.sub(r"[^a-z0-9]", "", s)


def eu_velikost(n, feed):
    """US velikost nabídky → EU podle katalogu (stejný název a formatted_size)."""
    if n["sku"] in ("", "TBC"):
        return n["size"]
    for d in feed.get(n["sku"]) or []:
        if nnaz(d["name"]) == nnaz(n["name"]) and d["fs"] == n["size"]:
            eu = next((x for x in d["size"] if str(x).upper().startswith("EU")), None)
            if eu:
                return eu[2:].strip()
    return None


def nejnizsi(nazev, eu, feed_sku, moje_ids):
    ceny = [d["price"] for d in feed_sku or [] if nnaz(d["name"]) == nnaz(nazev) and d["type"] == "brand_new"
            and d["id"] not in moje_ids and any(nvel(x) == nvel(eu) for x in d["size"] if str(x).upper().startswith("EU"))]
    return min(ceny) if ceny else None


def payout(cena):
    return round(cena * 0.92 - 16.58, 2)


def k_vystaveni(polozky):
    """Kusy skladem, které na KLEKT patří (jen pro ně se má smysl ptát katalogu)."""
    return [x for x in polozky if x and x.get("type") != "bulk" and S.stav(x) == "stock"
            and x.get("category") in ("sneakers", "obleceni") and x.get("condition") != "poskozene" and x.get("location") not in EXC]


def vyhodnot(nabidky, feed, auto, polozky):
    vse = [x for x in polozky if x and x.get("type") != "bulk"]
    sklad = k_vystaveni(polozky)
    klic = lambda sku, nazev, vel: ((nsku(sku) if sku and sku != "TBC" else "N" + nnaz(nazev)), nvel(vel))
    skup = {}
    for x in sklad:
        skup.setdefault(klic(x.get("sku"), x.get("name"), x.get("size")), []).append(x)
    moje = {n["id"] for n in nabidky}
    listed, smazat, platby = set(), [], []
    for n in nabidky:
        if nsku(n["sku"]) in IGNOROVAT:
            continue
        eu = eu_velikost(n, feed) or n["size"]
        k = klic(n["sku"], n["name"], eu)
        g = skup.get(k)
        if g:
            listed.add(k)
            lo = nejnizsi(n["name"], eu, feed.get(n["sku"]), moje)
            platby.append({"nazev": g[0].get("name"), "sku": g[0].get("sku") or "", "velikost": g[0].get("size"), "cena": n["price"],
                           "nejnizsi": lo if lo is not None else n["price"], "payout": payout(n["price"]), "ids": [g[0]["id"]],
                           "obrazek": n.get("img", "")})
            continue
        prod = sorted([x for x in vse if S.stav(x) in ("waiting", "paid") and klic(x.get("sku"), x.get("name"), x.get("size")) == k],
                      key=lambda x: str(x.get("payoutDate") or x.get("saleDate") or ""), reverse=True)
        jine = [x.get("size") for x in sklad if k[0] == klic(x.get("sku"), x.get("name"), "")[0]]
        if prod:
            duvod, ids = ("Ve SKLADu v Čeká" if S.stav(prod[0]) == "waiting" else "Prodáno") + " (%s)" % (prod[0].get("soldWhere") or "?"), [prod[0]["id"]]
        elif jine:
            duvod, ids = "Na KLEKT je EU %s, ve SKLADu %s" % (eu, ", ".join(jine)), []
        else:
            duvod, ids = "Ve SKLADu skladem není", []
        smazat.append({"nazev": n["name"], "velikost": eu, "sku": n["sku"], "ids": ids, "duvod": duvod, "obrazek": n.get("img", ""),
                       "spatna_velikost": bool(jine) and not prod})
    pridat = []
    for k, g in skup.items():
        if k in listed:
            continue
        x = g[0]
        sku = x.get("sku") or ""
        zaznamy = auto.get(sku) if sku else None
        kat = 1
        if sku and zaznamy is not None and not any(nsku(z.get("sku")) == nsku(sku) for z in zaznamy):
            kat = 0
        lo = nejnizsi(x.get("name"), x.get("size"), feed.get(sku), moje) if sku else None
        if not kat:
            pozn = "není v katalogu KLEKT"
        elif lo is not None:
            pozn = "nejnižší %s → payout %s (%d %%)" % (eur(lo), eur(payout(lo)), round(payout(lo) / lo * 100))
        else:
            pozn = "nikdo v této velikosti nenabízí"
        dup = [z for z in (zaznamy or []) if nsku(z.get("sku")) == nsku(sku)]
        if len(dup) > 1:
            pozn += " · v katalogu %d záznamy: %s" % (len(dup), " / ".join(z["name"] for z in dup))
        if x.get("location") == "Na cestě":
            pozn += " · na cestě"
        pridat.append({"nazev": x.get("name"), "velikost": x.get("size"), "sku": sku, "ids": [x["id"]], "kat": kat, "duvod": pozn})
    zmeny = []
    for k, g in skup.items():
        maji = [x for x in g if MISTO in (x.get("platforms") or [])]
        if k in listed and not maji:
            zmeny.append({"id": g[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        if k not in listed and maji:
            zmeny += [{"id": x["id"], "platforma": MISTO, "zaskrtnout": False} for x in maji]
    return {"pridat": pridat, "smazat": smazat, "platby": platby, "zmeny": zmeny,
            "nabidek": sum(1 for n in nabidky if nsku(n["sku"]) not in IGNOROVAT)}


def eur(n):
    return "—" if n is None else ("%.2f" % n).rstrip("0").rstrip(".").replace(".", ",") + " €"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    rad = lambda x, d="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""), "ids": x.get("ids", []),
                           "obrazek": x.get("obrazek", ""), "duvod": d}
    drazsi = [x for x in r["platby"] if x["cena"] > x["nejnizsi"]]
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola KLEKT", "datum": datum,
            "souhrn": [f"Nabídek: {r['nabidek']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                       f"Payout celkem: {eur(sum(x['payout'] for x in r['platby']))}"]
                      + ([f"Expirace prodloužena u {r['prodlouzeno']['ok']} nabídek" + (f", selhalo {len(r['prodlouzeno']['fail'])}" if r['prodlouzeno']['fail'] else "")]
                         if r.get("prodlouzeno") else []),
            "sekce": [
                {"nazev": "Přidat na KLEKT", "barva": "pridat", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if x["kat"]]},
                {"nazev": "Nejde nalistovat", "barva": "info", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if not x["kat"]]},
                {"nazev": "Smazat z KLEKT", "barva": "smazat", "radky": [rad(x, x["duvod"]) for x in r["smazat"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
                {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Payout = cena × 0,92 − 16,58 €.",
                 "radky": [dict(rad(x, "nejlevnější" if x["cena"] <= x["nejnizsi"] else "dražší o %s · při %s payout %s"
                                    % (eur(x["cena"] - x["nejnizsi"]), eur(x["nejnizsi"] - 1), eur(payout(x["nejnizsi"] - 1)))),
                                udaje=[{"popis": "Cena", "hodnota": eur(x["cena"])},
                                       {"popis": "Payout", "hodnota": "%s (%d %%)" % (eur(x["payout"]), round(x["payout"] / x["cena"] * 100) if x["cena"] else 0)}])
                           for x in r["platby"]]},
            ]}


def main(argv):
    import prohlizec as P
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 2500)
        P.prihlas_sam(b, s, JS_TEST, MISTO, WEB, "https://klekt.com/login")
        s.evaluate(JS_LIB)
        nabidky = s.evaluate(JS_NABIDKY)
        if not nabidky:
            raise RuntimeError("KLEKT nevrátil žádnou nabídku — změnil se tvar dat? Řekni Claudovi.")
        print(f"KLEKT: {len(nabidky)} nabídek, dohledávám EU velikosti a ceny v katalogu…")
        skus_sklad = sorted({x.get("sku") for x in k_vystaveni(polozky) if x.get("sku")})
        skus_nabidek = {n["sku"] for n in nabidky if n["sku"] and n["sku"] != "TBC"}
        feed = s.evaluate(JS_FEED, sorted(skus_nabidek | set(skus_sklad)))   # 3 dotazy naráz
        # katalog stačí u SKU, které na KLEKT ještě nevisí v žádné velikosti (visící katalog zná)
        auto = s.evaluate(JS_AUTO, [k for k in skus_sklad if k not in skus_nabidek])
        r = vyhodnot(nabidky, feed, auto, polozky)
        datum = S._iso_ted()
        for x in r["smazat"]:
            print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
        for x in r["pridat"]:
            print(f"  PŘIDAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
        print("\n================ HOTOVO ================")
        print(f"KLEKT: přidat {sum(1 for x in r['pridat'] if x['kat'])} | nejde {sum(1 for x in r['pridat'] if not x['kat'])} "
              f"| smazat {len(r['smazat'])} | fajfky {len(r['zmeny'])}")
        print(f"Trvalo {int(time.time() - start)} s. Teď se ještě prodlouží expirace na 60 dní.")
        ids = [n["id"] for n in nabidky if nsku(n["sku"]) not in IGNOROVAT]

        def prodluz():
            r["prodlouzeno"] = s.evaluate(JS_PRODLOUZIT, ids)
            print("Expirace prodloužena u %d nabídek" % r["prodlouzeno"]["ok"] + (", selhalo %d" % len(r["prodlouzeno"]["fail"]) if r["prodlouzeno"]["fail"] else ""))
            rep.update(sestav_report(r, datum, polozky))

        rep = sestav_report(r, datum, polozky)
        drazsi = sum(1 for x in r["platby"] if x["cena"] > x["nejnizsi"])
        S.dokonci_kontrolu(token, data, polozky, r["zmeny"], rep, dict(
            misto=MISTO, web=WEB, datum=datum, inzeratu=r["nabidek"],
            chybi=[x["ids"][0] for x in r["pridat"] if x["kat"]],
            nejde=[{"id": x["ids"][0], "duvod": x["duvod"]} for x in r["pridat"] if not x["kat"]],
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
        with open(os.path.join(SLOZKA, "chyba_klekt.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_klekt.txt. Pošli screenshot Claudovi.")
