# -*- coding: utf-8 -*-
"""
Released kontrola pro MTKM.Store (Gabro).

Otevře „Moje nabídky" na sell-releasedcz-dev.web.app v prohlížeči kontrol
(prohlizec.py) a přihlásí se sám heslem ze Správce pověření Windows (poprvé se zeptá, jako Sellect), přečte nabídky, pro
nové kusy ověří katalog a velikosti na stránce /sell a porovná to se
skladem z cloudu. Výsledek pošle do aplikace SKLAD. — fajfky, okno
Kontroly listingů a Report. Pravidla i párování jsou ze skillu
„released-kontrola" (jeho kontrola.py; skill zůstává jako záloha).

Na Released nic nemění: na /sell jen hledá produkt a dívá se na nabídku
velikostí — nic nezvolí ani neodešle. Paměť katalogu je v
katalog_released.json vedle skriptu (co jde nalistovat s tvou velikostí,
se už znovu neověřuje).

Spuštění: SPUSTIT_released.bat   (pošle samo; --nahled jen ukáže)
V repozitáři: nastroje/released/released_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
"""
import sys, os, re, json, time, datetime, traceback, unicodedata, collections

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Released"
ZAKLAD = "https://sell-releasedcz-dev.web.app"
WEB = ZAKLAD + "/my-offers"
VYSTUP = os.path.join(SLOZKA, "vysledek_released.json")
KATALOG = os.path.join(SLOZKA, "katalog_released.json")
OK = ("sneakers", "obleceni", "alternate")
STROP_ODSKRTNUTI = 10

JS_TEST = "!/login/.test(location.pathname) && /Velikost\\tMnožství/.test(document.body.innerText)"
# Ze skillu: obě stránky nabídek → řádky „název|SKU|vel~cena~dražší_o~payout;…“
JS_NABIDKY = r"""async()=>{await new Promise(r=>setTimeout(r,1500));const P=()=>{const L=document.body.innerText.split('\n'),idx=[],out=[];L.forEach((l,i)=>{if(/^Velikost\tMnožství/.test(l))idx.push(i)});idx.forEach((h,k)=>{const a=L[h-1].trim(),b=(L[h-2]||'').trim();let name=a,sku='';if(/^[A-Z0-9][A-Z0-9\-\/ ]*$/.test(a)&&/\d/.test(a)&&!/[a-z]/.test(a)&&b){sku=a;name=b}const blk=L.slice(h+1,k+1<idx.length?idx[k+1]:L.length).join('\n'),C='([\\d][\\d,.\\u00a0\\u202f ]*) Kč',re=new RegExp('([^\\t\\n]+)\\t(\\d+)\\t\\n((?:(?![^\\t\\n]+\\t\\d+\\t\\n)[^\\n]*\\n){0,8}?)\\s*'+C+'\\n\\s*(Nejnižší cena|Dražší o '+C+')\\n\\s*'+C,'g'),D=x=>+String(x).replace(/\D/g,''),rows=[];let m;while(m=re.exec(blk)){if(/Prodáno/.test(m[3]))continue;const p=D(m[4]),po=D(m[7]);rows.push([m[1],p,m[6]?D(m[6]):0,po==Math.floor(p*.77)-50?'':po].join('~'))}out.push(name+'|'+sku+'|'+rows.join(';'))});return out};const n=document.querySelectorAll('button.p-paginator-page').length,pg=[];if(!n)return P();for(let i=n-1;i>=0;i--){document.querySelectorAll('button.p-paginator-page')[i].click();await new Promise(r=>setTimeout(r,1200));pg[i]=P()}return [].concat(...pg)}"""
# Ze skillu: katalog na /sell — jen hledání a nabídka velikostí, nic se nevybere ani neodešle
JS_KATALOG = r"""async(Q)=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const N=s=>s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/\(women's\)|\(w\)/g,'w').replace(/[^a-z0-9]/g,'');const back=()=>{const b=[...document.querySelectorAll('button')].find(b=>/Zpátky na výběr produktu/.test(b.innerText));if(b)b.click()};const res={};for(const it of Q){if(res[it.n]!==undefined)continue;back();await sleep(800);const inp=document.querySelector('input[placeholder="Vyhledat název nebo SKU"]');if(!inp){res[it.n]='NENI VYHLEDAVANI';continue}const w=it.n.split(' ');const qs=[it.sku,it.n,w.slice(1).join(' '),w.slice(-3).join(' ')].filter(Boolean);let found=null;for(const q of qs){inp.value=q;inp.dispatchEvent(new Event('input',{bubbles:true}));await sleep(1100);const rows=[...document.querySelectorAll('span.font-bold')].filter(e=>e.closest('div.flex-row'));const hit=rows.find(e=>{const r=e.closest('div.flex-row');const sk=(r.querySelector('span.text-gray-400')||{}).textContent||'';return N(e.textContent)===N(it.n)||(it.sku&&N(sk)===N(it.sku))});if(hit){found=hit;break}}if(!found){res[it.n]=null;continue}found.closest('div.flex-row').click();await sleep(1200);const ms=document.querySelector('.p-multiselect');if(!ms){res[it.n]=[];continue}ms.click();await sleep(600);res[it.n]=[...document.querySelectorAll('.p-multiselect-option,[role=option]')].map(e=>e.innerText.trim());document.body.click();await sleep(200)}back();return res}"""


def nn(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("air jordan", "jordan").replace("(women's)", "w").replace("(w)", "w").replace("’", "'")
    return re.sub(r"[^a-z0-9]", "", s)


def ns(s):
    s = (s or "").strip().upper().replace(",", ".")
    if s in ("", "ONE SIZE", "ONESIZE", "OS", "ONE-SIZE"):
        return "OS"
    m = re.match(r"^(\d+) ([12])/3$", s)
    if m:
        return str(int(m[1]) + (.33 if m[2] == "1" else .67))
    return s


def dd(s):
    try:
        y, m, d = s.split("-")[:3]
        return f"{int(d[:2])}. {int(m)}. {y}"
    except Exception:
        return s or ""


def po_(p):
    return int(p * .77) - 50


def rozeber(radky):
    R = []
    for l in radky:
        n, s, rows = (l.split("|", 2) + ["", ""])[:3]
        for row in filter(None, rows.split(";")):
            z, p, d, po = (row.split("~") + ["", "", "", ""])[:4]
            p = int(p)
            R.append(dict(name=n, skus={t.strip() for t in s.split("/") if t.strip()}, size=ns(z), raw=z.replace(",", "."),
                          price=p, dr=int(d or 0), po=int(po) if po else po_(p), explicit=bool(po)))
    return R


def _sklad(polozky):
    sk = [dict({"size": "", "sku": "", "category": "", "condition": "", "location": "", "platforms": [], "name": ""}, **x)
          for x in polozky if x and x.get("type") != "bulk"]
    stock = lambda x: S.stav(x) == "stock"
    elig = lambda x: stock(x) and x["category"] in OK and x["condition"] != "poskozene" and x["location"] not in ("Zrušeno", "Vráceno", "Poškozené")
    G = collections.OrderedDict()
    for x in sk:
        if elig(x):
            G.setdefault((nn(x["name"]), ns(x["size"])), []).append(x)
    return sk, G, stock, elig


def same(r, x):
    if ns(x["size"]) != r["size"]:
        return False
    xn, rn = nn(x["name"]), nn(r["name"])
    return (x["sku"] and x["sku"] in r["skus"]) or xn == rn or (len(xn) > 12 and xn in rn)


def k_overeni(R, polozky, KC, dnes):
    """Kusy do Přidat, které je potřeba ověřit v katalogu (co jde s tvou velikostí, se už neověřuje)."""
    sk, G, _, _ = _sklad(polozky)
    matched = {next((k for k in G if k[1] == r["size"] and any(same(r, i) for i in G[k])), None) for r in R}
    Q = []
    for k, items in G.items():
        if k in matched:
            continue
        i = items[0]
        e = KC.get(i["name"])
        if not (e and (e["d"] == dnes or (e["s"] and ns(i["size"]) in [ns(z) for z in e["s"]]))):
            Q.append({"n": i["name"], "sku": i["sku"], "s": i["size"] or "OS"})
    return Q


def vyhodnot(R, polozky, KC, dnes):
    sk, G, stock, elig = _sklad(polozky)
    matched, unR = {}, []
    for r in R:
        hit = next((k for k in G if k[1] == r["size"] and any(same(r, i) for i in G[k])), None)
        if hit:
            matched[hit] = r
        else:
            unR.append(r)
    smazat = []
    for r in unR:
        c = [x for x in sk if same(r, x)]
        w = next((x for x in c if S.stav(x) == "waiting"), None)
        p = next((x for x in c if S.stav(x) == "paid"), None)
        v = next((x for x in c if stock(x)), None)
        if w:
            duvod, ids = "Čeká na payout (prodáno %s, %s)" % (dd(w.get("saleDate")), w.get("soldWhere") or "?"), [w["id"]]
        elif p:
            duvod, ids = "Prodáno %s (%s)" % (dd(p.get("saleDate")), p.get("soldWhere") or "?"), [p["id"]]
        elif v:
            duvod, ids = "Ve SKLADu je, ale vyřazené (%s / %s)" % (v["condition"], v["location"]), []
        else:
            duvod, ids = "Ve SKLADu není", []
        smazat.append({"nazev": r["name"], "velikost": r["raw"], "sku": " / ".join(sorted(r["skus"])), "ids": ids, "duvod": duvod})
    pridat = []
    for k, items in G.items():
        if k in matched:
            continue
        i = items[0]
        stitky = ["na cestě"] if i["location"] == "Na cestě" else []
        kat = None
        e = KC.get(i["name"])
        if e:
            if e["s"] is None:
                kat = 0
                stitky.append("není v katalogu Released")
            elif ns(i["size"]) in [ns(z) for z in e["s"]]:
                kat = 1
            else:
                kat = 0
                stitky.append("v katalogu je, ale bez tvé velikosti")
        pridat.append({"sku": i["sku"], "nazev": i["name"], "velikost": i["size"] or "OS", "ids": [i["id"]], "kat": kat,
                       "plus": bool(e and e["s"]), "duvod": " · ".join(stitky)})
    pridat.sort(key=lambda a: a["nazev"].lower())
    zmeny = []
    for k, r in matched.items():
        if not any(MISTO in i["platforms"] for i in G[k]):
            zmeny.append({"id": G[k][0]["id"], "platforma": MISTO, "zaskrtnout": True})
    for k, items in G.items():
        if k not in matched and any(MISTO in i["platforms"] for i in items):
            zmeny.append({"id": items[0]["id"], "platforma": MISTO, "zaskrtnout": False})
    for x in sk:
        if stock(x) and not elig(x) and MISTO in x["platforms"] and (nn(x["name"]), ns(x["size"])) not in G:
            zmeny.append({"id": x["id"], "platforma": MISTO, "zaskrtnout": False})
    platby, varovani = [], 0
    for r in R:
        k = next((kk for kk, v in matched.items() if v is r), None)
        g0 = G[k][0] if k else None
        varovani += r["explicit"]
        konk = max(po_(r["price"] - r["dr"]), 0) if r["dr"] else None
        platby.append({"sku": (g0 or {}).get("sku") or (sorted(r["skus"])[0] if r["skus"] else ""), "nazev": g0["name"] if g0 else r["name"],
                       "velikost": r["raw"], "cena": r["price"], "payout": r["po"], "drazsi_o": r["dr"], "konkurent": konk,
                       "ids": [g0["id"]] if g0 else []})
    odsk = sum(1 for z in zmeny if not z["zaskrtnout"])
    pojistka = odsk > STROP_ODSKRTNUTI
    return {"smazat": smazat, "pridat": pridat, "platby": platby, "zmeny": [] if pojistka else zmeny,
            "zmeny_zadrzene": zmeny if pojistka else [], "varovani": varovani, "nabidek": len(R)}


def kc(n):
    return "—" if n is None else f"{int(n):,}".replace(",", " ") + " Kč"


def pro_kluky(x):
    return ("+" if x["plus"] else "") + ((x["sku"] or x["nazev"]) + " " + str(x["velikost"]).replace(" 1/3", ".33").replace(" 2/3", ".67"))


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    rad = lambda x, d="": {"nazev": x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""), "ids": x.get("ids", []), "duvod": d}
    nejde = [x for x in r["pridat"] if x["kat"] == 0]
    drazsi = [x for x in r["platby"] if x["drazsi_o"]]
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Released", "datum": datum,
            "souhrn": [f"Nabídek: {r['nabidek']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                       f"Payout celkem: {kc(sum(x['payout'] for x in r['platby']))}"]
                      + ([f"POZOR: {r['varovani']} nabídek nesedí na payout = cena × 0,77 − 50 (změnily se poplatky?)"] if r["varovani"] else []),
            "sekce": [
                {"nazev": "Přidat na Released", "barva": "pridat", "hromadne": True, "radky": [rad(x, x["duvod"]) for x in r["pridat"] if x["kat"] != 0]},
                {"nazev": "Nejde nalistovat — není v katalogu Released", "barva": "info", "hromadne": True,
                 "poznamka": "Pro kluky: " + "; ".join(pro_kluky(x) for x in nejde) if nejde else "",
                 "radky": [rad(x, x["duvod"]) for x in nejde]},
                {"nazev": "Smazat z Released", "barva": "smazat", "radky": [rad(x, x["duvod"]) for x in r["smazat"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
                {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Payout = cena × 0,77 − 50 Kč.",
                 "radky": [dict(rad(x, "nejlevnější" if not x["drazsi_o"] else "dražší o %s · konkurent dostane %s" % (kc(x["drazsi_o"]), kc(x["konkurent"]))),
                                udaje=[{"popis": "Cena", "hodnota": kc(x["cena"])}, {"popis": "Payout", "hodnota": kc(x["payout"])}])
                           for x in r["platby"]]},
            ]}


def main(argv):
    import prohlizec as P
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    dnes = datetime.date.today().isoformat()
    KC = json.load(open(KATALOG, encoding="utf-8")) if os.path.exists(KATALOG) else {}
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 2500)
        P.prihlas_sam(b, s, JS_TEST, MISTO, WEB, ZAKLAD + "/login")
        with S.pracuji("Čtu nabídky na Released"):
            R = rozeber(s.evaluate(JS_NABIDKY))
        if not R:
            cesta = S.uloz_ladici(SLOZKA, "released_text.txt", s.evaluate("document.body.innerText"))
            raise RuntimeError("Released nevrátil žádnou nabídku. Text stránky je v %s — pošli ho Claudovi. Nic jsem neposlal." % cesta)
        print(f"Released: {len(R)} nabídek")
        Q = k_overeni(R, polozky, KC, dnes)
        if Q:
            print(f"Ověřuji v katalogu {len(Q)} kusů…")
            P.jdi(s, ZAKLAD + "/sell")
            s.wait_for_timeout(2500)
            with S.pracuji("Hledám chybějící modely v katalogu Released"):
                nove = s.evaluate(JS_KATALOG, Q)
            for k, v in nove.items():
                if isinstance(v, list) or v is None:
                    KC[k] = {"s": v, "d": dnes}
            with open(KATALOG, "w", encoding="utf-8") as f:
                json.dump(KC, f, ensure_ascii=False)
    r = vyhodnot(R, polozky, KC, dnes)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['sku'] or '-'} {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}" + (f"  ({x['duvod']})" if x["duvod"] else ""))
    if r["varovani"]:
        print(f"  POZOR: {r['varovani']} nabídek nesedí na payout = cena × 0,77 − 50 (změnily se poplatky?)")
    print("\n================ HOTOVO ================")
    print(f"Released: smazat {len(r['smazat'])} | přidat {sum(1 for x in r['pridat'] if x['kat'] != 0)} "
          f"(+{sum(1 for x in r['pridat'] if x['kat'] == 0)} nejde) | fajfky {len(r['zmeny'])}")
    print(f"Trvalo {int(time.time() - start)} s.")
    drazsi = sum(1 for x in r["platby"] if x["drazsi_o"])
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["nabidek"],
        chybi=[x["ids"][0] for x in r["pridat"] if x["kat"] != 0],
        nejde=[{"id": x["ids"][0], "duvod": x["duvod"]} for x in r["pridat"] if x["kat"] == 0],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}, payout celkem {kc(sum(x['payout'] for x in r['platby']))}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_released.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_released.txt. Pošli screenshot Claudovi.")
