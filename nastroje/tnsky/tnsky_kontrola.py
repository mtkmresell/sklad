# -*- coding: utf-8 -*-
"""
Tnsky kontrola pro MTKM.Store (Gabro).

Otevře Inventory na sell.tnsky.cz v prohlížeči kontrol (prohlizec.py),
přihlásí se sám heslem ze Správce pověření Windows (poprvé se zeptá), přečte z tabulky aktivní nabídky
a porovná je se skladem z cloudu. Výsledek pošle do aplikace SKLAD. —
fajfky, okno Kontroly listingů a Report. Pravidla i párování jsou ze
skillu „tnsky-kontrola" (jeho kontrola.py; skill zůstává jako záloha).

Na Tnsky nic nemění. Data jen z tabulky na stránce — žádné tokeny ani
API stránky (pravidlo ze skillu). Do reportu nejdou údaje o účtu.

Spuštění: SPUSTIT_tnsky.bat   (pošle samo; --nahled jen ukáže)
V repozitáři: nastroje/tnsky/tnsky_kontrola.py, hlídá to test/test-kontrolyprohlizec.js.
"""
import sys, os, re, json, time, traceback, unicodedata, collections

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SLOZKA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SLOZKA)
sys.path.insert(0, os.path.dirname(SLOZKA))
import sklad_firestore as S  # noqa: E402

MISTO = "Tnsky"
WEB = "https://sell.tnsky.cz/inventory"
VYSTUP = os.path.join(SLOZKA, "vysledek_tnsky.json")
ALIAS = {
    "Corteiz x V.A.A. Virgil Abloh Tee White": "Corteiz V.A.A. Tee White",
    "Nike x NOCTA Canada X2 World Cup 2026 Soccer Borealist L/S Goalkeeper Jersey Black":
        "Nike x NOCTA Canada X2 World Cup 2026 Soccer Borealist L/S Goalkeeper Jersey",
}
MATCH_CATS = {"sneakers", "obleceni", "alternate", "hotwheels", "pokemon"}   # co se páruje s nabídkami
ADD_CATS = {"sneakers", "obleceni"}                                          # co jde do Přidat
STROP_ODSKRTNUTI = 10

# Ze skillu: filtr Active, 100 řádků, cena z placeholderu pole, kontrola počtu proti patičce
JS_TEST = "!!document.querySelector('tbody tr') || !!document.querySelector('[role=combobox]')"
JS_NABIDKY = r"""async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const k=e=>{['pointerdown','mousedown','pointerup','mouseup'].forEach(t=>e.dispatchEvent(new (t[0]=='p'?PointerEvent:MouseEvent)(t,{bubbles:true})));e.click()};const btn=re=>[...document.querySelectorAll('button,[role=combobox]')].find(b=>re.test(b.innerText.trim()));
for(let i=0;i<20&&!btn(/^All Statuses$|^Active/);i++)await w(500);
if(btn(/^All Statuses$/)){k(btn(/^All Statuses$/));await w(500);const o=[...document.querySelectorAll('[role=option],[cmdk-item],div')].find(e=>e.children.length<4&&e.innerText&&e.innerText.trim()==='Active');if(!o)return {chyba:'volba Active nenalezena'};k(o);await w(800);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await w(300);}
const rp=btn(/^10$|^25$|^50$/);if(rp){k(rp);await w(500);const o=[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.trim()==='100');if(o){k(o);}await w(1800);}
const radky=()=>[...document.querySelectorAll('tbody tr')].map(tr=>{const td=[...tr.querySelectorAll('td')];const c=td.map(x=>x.innerText.replace(/\s+/g,' ').trim());if(c[3]!=='Active')return null;const L=td[0].innerText.split('\n').map(s=>s.trim()).filter(Boolean);const inp=tr.querySelector('input');const ml=((c[5]||'').match(/Market Low:\s*(\d+)/)||[])[1]||'';const sku=(L[1]||'—').split(' / ')[0].replace(/\.\.\.$/,'');const img=tr.querySelector('img');return [L[0],sku,c[1],inp?inp.placeholder:'',ml,img?img.src:'']}).filter(Boolean);
const pata=()=>(document.body.innerText.match(/(\d+)–(\d+) of (\d+)/)||[]);
// tlačítko „další stránka“: podle popisku, podle znaku, jinak poslední povolené tlačítko u patičky „1–100 of 111“
const vypnute=b=>b.disabled||b.getAttribute('aria-disabled')==='true'||/disabled/.test(b.className||'');
const patka=()=>{let e=[...document.querySelectorAll('p,span,div')].find(x=>x.children.length===0&&/\d+–\d+ of \d+/.test(x.textContent));for(let i=0;e&&i<4&&e.querySelectorAll('button').length<2;i++)e=e.parentElement;return e;};
const dalsi=()=>{const B=[...document.querySelectorAll('button,a[role=button]')];
  let b=B.find(b=>/next|další|dalsi/i.test((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+b.textContent.trim())&&!vypnute(b));
  if(!b)b=B.find(b=>/^[›»>→]$/.test(b.textContent.trim())&&!vypnute(b));
  if(!b){const p=patka();if(p){const T=[...p.querySelectorAll('button')].filter(b=>!/^\d+$/.test(b.textContent.trim()));const z=T[T.length-1];if(z&&!vypnute(z))b=z;}}
  return b;};
const out=radky();
// víc než 100 aktivních → další stránky tabulky (tlačítko „další“ v patičce)
for(let st=0;st<10;st++){const f=pata();if(!f[3]||+f[2]>=+f[3])break;
  const dal=dalsi();if(!dal)break;
  const pred=f[1];k(dal);for(let i=0;i<20&&pata()[1]===pred;i++)await w(300);await w(600);out.push(...radky());}
const foot=pata();const p=patka();return {radky:out,celkem:foot[3]?+foot[3]:null,pata:p?p.outerHTML.slice(0,6000):''}}"""


def payout(cena):
    return round(cena * 0.8)


def doporucena(ml):
    return ((ml - 1 - 90) // 100) * 100 + 90


def nn(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("air jordan", "jordan").replace("(women's)", "w").replace("(w)", "w").replace("(gs)", "gs")
    return re.sub(r"[^a-z0-9]", "", s)


def ns(s):
    s = str(s or "").strip().lower().replace(" ", "").replace("1/3", ".33").replace("2/3", ".67")
    return {"uni": "os", "onesize": "os", "one-size": "os", "": "os"}.get(s, s)


def spatny(x):
    return (x.get("condition") or "").lower() == "poskozene" or x.get("location") in ("Zrušeno", "Vráceno", "Poškozené")


def nacti_nabidky():
    import prohlizec as P
    with P.Prohlizec() as b:
        s = b.otevri(WEB, 3000)
        P.prihlas_sam(b, s, JS_TEST, MISTO, WEB, "https://sell.tnsky.cz/login")
        for pokus in range(2):
            r = s.evaluate(JS_NABIDKY)
            if r and not r.get("chyba") and (r.get("celkem") is None or r["celkem"] == len(r["radky"])):
                break
            P.jdi(s, WEB)
            s.wait_for_timeout(3000)
    if not r or r.get("chyba"):
        raise RuntimeError("Tnsky: %s" % ((r or {}).get("chyba") or "tabulka se nenačetla"))
    if r.get("celkem") is not None and r["celkem"] != len(r["radky"]):
        S.uloz_ladici(SLOZKA, "tnsky_paticka.html", r.get("pata") or "")
        raise RuntimeError("Tnsky: aktivních je %s, načetlo se %d (další stránku tabulky se nepodařilo otevřít). Patička je v debug/tnsky_paticka.html — pošli ji Claudovi."
                           % (r["celkem"], len(r["radky"])))
    return [{"nazev": x[0], "sku": "" if x[1] == "—" else x[1], "velikost": x[2],
             "cena": int(re.sub(r"\D", "", x[3]) or 0), "ml": int(x[4]) if x[4] else None, "obrazek": x[5]}
            for x in r["radky"]]


def vyhodnot(nabidky, polozky):
    vse = [x for x in polozky if x and x.get("type") != "bulk"]
    sk = [x for x in vse if S.stav(x) == "stock"]
    ok = [x for x in sk if x.get("category") in MATCH_CATS and not spatny(x)]
    byname, bysku, G = collections.defaultdict(list), collections.defaultdict(list), collections.OrderedDict()
    for x in ok:
        byname[(nn(x.get("name")), ns(x.get("size")))].append(x)
        if x.get("sku"):
            bysku[(x["sku"], ns(x.get("size")))].append(x)
        G.setdefault((x.get("sku") or nn(x.get("name")), ns(x.get("size"))), []).append(x)
    smazat, platby, listed, delsku = [], [], [], set()
    for t in nabidky:
        jm = ALIAS.get(t["nazev"], t["nazev"])
        hit = byname.get((nn(jm), ns(t["velikost"])))
        if not hit and t["sku"]:
            hit = bysku.get((t["sku"], ns(t["velikost"])))
        ml = t["ml"]
        o = t["cena"] - ml if ml and t["cena"] > ml else 0
        rec = doporucena(ml) if o else None
        platby.append(dict(t, ids=[hit[0]["id"]] if hit else [], nazev_sklad=hit[0].get("name") if hit else t["nazev"],
                           payout=payout(t["cena"]), drazsi_o=o, doporucena=rec, payout_doporucena=payout(rec) if rec else None))
        if hit:
            listed.append(hit)
            continue
        duvod, kus = "Ve SKLADu vůbec není", None
        stejny = lambda x: (t["sku"] and x.get("sku") == t["sku"]) or nn(x.get("name")) == nn(jm)
        for x in vse:
            if not stejny(x):
                continue
            if ns(x.get("size")) == ns(t["velikost"]):
                st = S.stav(x)
                if st == "paid":
                    duvod, kus = "Prodáno ve SKLADu", x["id"]
                elif st == "waiting":
                    duvod, kus = "Ve SKLADu v Čeká (prodáno)", x["id"]
                elif spatny(x):
                    duvod = "Ve SKLADu: " + (x.get("location") or "poškozené")
                break
            elif S.stav(x) == "stock" and not spatny(x):
                duvod = "Skladem jen vel. %s — asi špatná velikost" % x.get("size")
                delsku.add(t["sku"])
        smazat.append(dict(t, duvod=duvod, ids=[kus] if kus else []))
    lk = {(x.get("sku") or nn(x.get("name")), ns(x.get("size"))) for hit in listed for x in hit}
    pridat, videno = [], set()
    for x in ok:
        if x.get("category") not in ADD_CATS:
            continue
        k = (x.get("sku") or nn(x.get("name")), ns(x.get("size")))
        if k in lk or k in videno:
            continue
        videno.add(k)
        pridat.append({"nazev": x.get("name"), "velikost": x.get("size") or "", "sku": x.get("sku") or "", "ids": [x["id"]],
                       "duvod": "na cestě" if x.get("location") == "Na cestě" else ""})
    pridat.sort(key=lambda r: ((r["nazev"] or "").lower(), r["velikost"]))
    zmeny = []
    for k, g in G.items():
        on, tick = k in lk, any(MISTO in (x.get("platforms") or []) for x in g)
        if on and not tick:
            zmeny.append({"id": g[0]["id"], "platforma": MISTO, "zaskrtnout": True})
        if tick and not on and g[0].get("sku") not in delsku:
            zmeny.append({"id": g[0]["id"], "platforma": MISTO, "zaskrtnout": False})
    for x in sk:
        if spatny(x) and MISTO in (x.get("platforms") or []):
            zmeny.append({"id": x["id"], "platforma": MISTO, "zaskrtnout": False})
    odsk = sum(1 for z in zmeny if not z["zaskrtnout"])
    pojistka = odsk > STROP_ODSKRTNUTI
    return {"smazat": smazat, "pridat": pridat, "platby": platby, "zmeny": [] if pojistka else zmeny,
            "zmeny_zadrzene": zmeny if pojistka else [], "nabidek": len(nabidky)}


def kc(n):
    return "—" if n is None else f"{int(n):,}".replace(",", " ") + " Kč"


def sestav_report(r, datum, polozky):
    kus = {p.get("id"): p for p in polozky if p}
    radek = lambda x, d="": {"nazev": x.get("nazev_sklad") or x["nazev"], "velikost": x["velikost"], "sku": x.get("sku", ""),
                             "ids": x.get("ids", []), "obrazek": x.get("obrazek", ""), "duvod": d}
    drazsi = sorted([x for x in r["platby"] if x["drazsi_o"]], key=lambda x: -x["drazsi_o"])
    return {"misto": MISTO, "skupina": MISTO, "nadpis": "Kontrola Tnsky", "datum": datum,
            "souhrn": [f"Aktivních: {r['nabidek']}", f"Nejlevnější u {len(r['platby']) - len(drazsi)} z {len(r['platby'])}",
                       "Katalog Tnsky neověřen"]
                      + ([f"POZOR: {len(r['zmeny_zadrzene'])} změn fajfek zadrženo — víc než {STROP_ODSKRTNUTI} odškrtnutí"] if r["zmeny_zadrzene"] else []),
            "sekce": [
                {"nazev": "Přidat na Tnsky", "barva": "pridat", "hromadne": True, "radky": [radek(x, x["duvod"]) for x in r["pridat"]]},
                {"nazev": "Smazat z Tnsky", "barva": "smazat", "radky": [radek(x, x["duvod"]) for x in r["smazat"]]},
                {"nazev": "Fajfky ve SKLADu", "barva": "fajfky",
                 "radky": [{"nazev": (kus.get(z["id"]) or {}).get("name", "?"), "velikost": (kus.get(z["id"]) or {}).get("size", ""),
                            "ids": [z["id"]], "duvod": "Zaškrtnuto" if z["zaskrtnout"] else "Odškrtnuto"} for z in r["zmeny"]]},
                {"nazev": "Nejsi nejlevnější", "barva": "opravit",
                 "radky": [dict(radek(x, f"tvoje {kc(x['cena'])} · Market Low {kc(x['ml'])} · o {kc(x['drazsi_o'])} dráž"),
                                udaje=[{"popis": "Nastav", "hodnota": kc(x["doporucena"])},
                                       {"popis": "Payout", "hodnota": kc(x["payout_doporucena"])}]) for x in drazsi]},
                {"nazev": "Payouty", "barva": "info", "hromadne": True, "poznamka": "Fee 20 %.",
                 "radky": [dict(radek(x, "nejlevnější" if not x["drazsi_o"] else "nejsi nejlevnější"),
                                udaje=[{"popis": "Cena", "hodnota": kc(x["cena"])}, {"popis": "Payout", "hodnota": kc(x["payout"])}])
                           for x in r["platby"]]},
            ]}


def main(argv):
    start = time.time()
    token = S.prihlas()
    data, polozky = S.nacti_sklad(token)
    print(f"Sklad z cloudu: {len(S.skladem(polozky))} kusů skladem")
    nabidky = nacti_nabidky()
    print(f"Tnsky: {len(nabidky)} aktivních nabídek")
    r = vyhodnot(nabidky, polozky)
    datum = S._iso_ted()
    with open(VYSTUP, "w", encoding="utf-8") as f:
        json.dump(dict(r, datum=datum), f, ensure_ascii=False, indent=1)
    for x in r["smazat"]:
        print(f"  SMAZAT   {x['nazev']} {x['velikost']}  ({x['duvod']})")
    for x in r["pridat"]:
        print(f"  PŘIDAT   {x['nazev']} {x['velikost']}")
    drazsi = sum(1 for x in r["platby"] if x["drazsi_o"])
    print("\n================ HOTOVO ================")
    print(f"Tnsky: smazat {len(r['smazat'])} | přidat {len(r['pridat'])} | fajfky {len(r['zmeny'])} | dražší {drazsi}")
    print(f"Trvalo {int(time.time() - start)} s.")
    S.dokonci_kontrolu(token, data, polozky, r["zmeny"], sestav_report(r, datum, polozky), dict(
        misto=MISTO, web=WEB, datum=datum, inzeratu=r["nabidek"], chybi=[x["ids"][0] for x in r["pridat"]],
        smazat=[x["ids"][0] for x in r["smazat"] if x["ids"]],
        neni_ve_skladu=[{"nazev": x["nazev"], "velikost": x["velikost"], "odkaz": WEB} for x in r["smazat"] if not x["ids"]],
        poznamka=f"nejlevnější u {len(r['platby']) - drazsi} z {len(r['platby'])}"), argv)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:
        print("\n!!! CHYBA:", e)
        with open(os.path.join(SLOZKA, "chyba_tnsky.txt"), "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print("Detail chyby je v chyba_tnsky.txt. Pošli screenshot Claudovi.")
