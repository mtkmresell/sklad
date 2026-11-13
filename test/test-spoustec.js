// Test: spouštěč kontrol (nastroje/spoustec.py, KONTROLY.pyw).
//
// Spouštěč pouští kontroly bez okna — i sám po zapnutí PC, kdy u počítače
// nikdo nesedí. Nesmí proto nikdy čekat na klávesnici (kontrola, která by
// chtěla heslo nebo Enter, musí skončit hláškou „Potřeba přihlásit“),
// dvě kontroly přes prohlížeč kontrol nesmí běžet naráz (sdílejí profil)
// a restart PC chvíli po běhu nesmí pouštět všechno znovu.
// Kontroly se tu nahrazují malými skripty ve vlastní složce; skutečné
// kontroly se jen najdou a zkontroluje se, co o nich spouštěč ví.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

let selhalo = 0, proslo = 0;
function shoda(popis, a, b) { ok(popis, JSON.stringify(a) === JSON.stringify(b), 'čekáno ' + JSON.stringify(b) + '\n  dostal ' + JSON.stringify(a)); }
function ok(popis, podminka, detail) {
  if (podminka) proslo++;
  else { selhalo++; console.log('FAIL: ' + popis + (detail === undefined ? '' : '\n  ' + detail)); }
}
function sekce(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length))); }

const NASTROJE = path.resolve(__dirname, '..', 'nastroje');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spoustec-'));

// Falešné kontroly: zapíšou, kdy běžely a co dostaly v prostředí
const FALESNA = (telo, prohlizec) => `# -*- coding: utf-8 -*-
import os, sys, time, json
MISTO = "${'${MISTO}'}"
${prohlizec ? '# používá P.Prohlizec( jako skutečné kontroly' : ''}
SL = os.path.dirname(os.path.abspath(__file__))
def zapis(co):
    with open(os.path.join(SL, 'stopa.txt'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(co) + '\\n')
zapis({'start': time.time(), 'rezim': os.environ.get('SKLAD_PROHLIZEC', ''), 'bez_ptani': os.environ.get('SKLAD_BEZ_PTANI')})
${telo}
zapis({'konec': time.time()})
`;
const OK = (souhrn, cekat) => `time.sleep(${cekat || 0.6})
print("  Čtu nabídky…", file=sys.stderr, flush=True)
print("\\n================ HOTOVO ================")
print("${souhrn}")
print("Posláno. Aplikace to převezme.")`;

function kontrola(koren, klic, misto, telo, prohlizec) {
  const sl = path.join(koren, klic);
  fs.mkdirSync(sl, { recursive: true });
  fs.writeFileSync(path.join(sl, klic + '_kontrola.py'), FALESNA(telo, prohlizec).replace('${MISTO}', misto));
  fs.writeFileSync(path.join(sl, 'SPUSTIT_' + klic + '.bat'), '@echo off\r\n');
}

const KOREN = path.join(tmp, 'kontroly');
kontrola(KOREN, 'alfa', 'Alfa', OK('Alfa: přidat 1 | smazat 0'));
kontrola(KOREN, 'beta', 'Beta', OK('Beta: přidat 0 | smazat 2'));
kontrola(KOREN, 'gama', 'Gama', OK('Gama: vše sedí'));
kontrola(KOREN, 'klavesnice', 'Klávesnice', `try:
    input()
    print("dostal jsem Enter")
except EOFError:
    print("\\n!!! CHYBA: Potřeba přihlásit: nikdo u klávesnice")`);
kontrola(KOREN, 'pada', 'Padá', 'raise SystemExit("rozbitý import")');
kontrola(KOREN, 'prohl1', 'Prohl1', OK('Prohl1: ok', 0.8), true);
kontrola(KOREN, 'prohl2', 'Prohl2', OK('Prohl2: ok', 0.8), true);
// Cloudflare: bez okna se nepřihlásí, s oknem mimo obrazovku ano
kontrola(KOREN, 'mrak', 'Mrak', `if os.environ.get('SKLAD_PROHLIZEC') == 'skryty':
    print("\\n!!! CHYBA: Potřeba přihlásit: na Mrak se v prohlížeči kontrol musíš přihlásit.")
else:
${OK('Mrak: ok', 0.2).split('\n').map(r => '    ' + r).join('\n')}`, true);
kontrola(KOREN, 'wtb', 'WTB Market', OK('WTB: nic'));
fs.mkdirSync(path.join(KOREN, 'debug'));          // složka bez kontroly se nebere

const RIDIC = `
import sys, os, json, time, threading, io
sys.path.insert(0, sys.argv[1])
import spoustec as S
koren, tmp = sys.argv[2], sys.argv[3]
out = {}

# 1) Skutečné kontroly v nastroje/
sk = S.najdi_kontroly(sys.argv[1])
out['skutecne'] = [{k: v for k, v in x.items() if k in ('klic', 'nazev', 'prohlizec', 'rucni')} for x in sk]
out['skutecne_bat'] = all(os.path.exists(x['bat']) for x in sk)

# 2) Rozbor výpisu
R = S.rozeber_vystup
out['rozbor'] = {
  'ok': R("x\\n================ HOTOVO ================\\n\\nAlfa: přidat 1\\nPosláno. Aplikace…", 0),
  'nahled': R("================ HOTOVO ================\\nAlfa: přidat 1\\nJen náhled, nic se neposlalo.", 0),
  'chyba': R("!!! CHYBA: Web vrátil 502\\nDetail chyby je v chyba.txt", 0),
  'prihlasit': R("!!! CHYBA: Potřeba přihlásit: k Sellect nemám uložené heslo.", 0),
  'kod': R("Traceback…\\nModuleNotFoundError: No module named 'x'", 1),
  'nic': R("", 0),
}

# 3) Spustit vše na falešných kontrolách
stav = os.path.join(tmp, 'stav.json')
sp = S.Spoustec(koren, stav, soubezne=3)
out['nalezene'] = [(k['klic'], k['prohlizec'], bool(k['rucni'])) for k in sp.kontroly]
konec = threading.Event()
souhrny = []
t0 = time.time()
sp.spust_vse(lambda sh: (souhrny.append(sh), konec.set()))
out['dobehlo'] = konec.wait(60)
out['trvalo'] = time.time() - t0
out['souhrn'] = souhrny[0] if souhrny else None
out['stav'] = sp.stav
def stopa(k):
    p = os.path.join(koren, k, 'stopa.txt')
    return [json.loads(r) for r in open(p, encoding='utf-8')] if os.path.exists(p) else []
out['stopy'] = {k['klic']: stopa(k['klic']) for k in sp.kontroly}
out['vypis_alfa'] = open(os.path.join(koren, 'alfa', S.VYPIS), encoding='utf-8').read()
out['ulozeny'] = json.load(open(stav, encoding='utf-8'))

# 4) Druhý běh: Mrak si pamatuje okno mimo obrazovku
for k in sp.kontroly:
    p = os.path.join(koren, k['klic'], 'stopa.txt')
    if os.path.exists(p): os.remove(p)
t = sp.spust('mrak'); t.join(30)
out['mrak2'] = stopa('mrak')
out['mrak2_stav'] = sp.s('mrak')

# 5) Po zapnutí PC
sp2 = S.Spoustec(koren, stav)
volano = []
out['po_hned'] = sp2.po_zapnuti(cekej_na_sit=lambda: volano.append(1) or True)
out['po_hned_bezi'] = sp2.vse_bezi
sp2.stav['posledni_vse'] = time.time() - 3 * 3600
out['po_bez_site'] = sp2.po_zapnuti(cekej_na_sit=lambda: False)
konec2 = threading.Event()
out['po_pozde'] = sp2.po_zapnuti(lambda sh: konec2.set(), cekej_na_sit=lambda: True)
out['po_pozde_dobehlo'] = konec2.wait(60)

# 6) Rozběhnutá kontrola po zavření okna není rozběhnutá
json.dump({'kontroly': {'alfa': {'stav': 'bezi'}}}, open(stav, 'w'))
out['po_padu'] = S.Spoustec(koren, stav).s('alfa').get('stav')

# 7) Zastavit jednu kontrolu
pomala = os.path.join(koren, 'gama', 'gama_kontrola.py')
open(pomala, 'w', encoding='utf-8').write('import time\\nprint("start", flush=True)\\ntime.sleep(30)\\n')
sp3 = S.Spoustec(koren, os.path.join(tmp, 'stav3.json'))
t = sp3.spust('gama')
for _ in range(100):
    if 'gama' in sp3.procesy: break
    time.sleep(0.05)
time.sleep(0.3)
t1 = time.time(); sp3.zastav('gama'); t.join(10)
out['zastaveno'] = {'stav': sp3.s('gama'), 'za': time.time() - t1}

# 8) Limit běhu
k = [x for x in sp3.kontroly if x['klic'] == 'gama'][0]
kod, text = S.spust_kontrolu(k, limit_s=1)
out['limit'] = S.rozeber_vystup(text, kod)

# 9) Příkaz do registru
cil = os.path.join(tmp, 'Můj disk', 'KONTROLY.pyw')
os.makedirs(os.path.dirname(cil), exist_ok=True)
open(cil, 'w', encoding='utf-8').write('import sys\\nprint("ARGV", sys.argv[1:])\\n')
out['registr'] = S.prikaz_po_zapnuti(r'C:\\\\Python\\\\pythonw.exe', cil)

# 10) Zámek proti dvěma oknům
z1 = S.jediny(47999)
z2 = S.jediny(47999)
out['zamek'] = [z1 is not None, z2 is None]
z1.close()

print('###' + json.dumps(out, ensure_ascii=False, default=str))
`;
fs.writeFileSync(path.join(tmp, 'ridic.py'), RIDIC);

function python(args, env, timeout) {
  return new Promise(res => execFile('python3', args, { cwd: tmp, env: Object.assign({ PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1', LOCALAPPDATA: tmp }, env || {}), timeout: timeout || 120000 },
    (err, so, se) => res({ err, out: String(so) + String(se) })));
}
function json(out) {
  const i = out.lastIndexOf('###');
  try { return i >= 0 ? JSON.parse(out.slice(i + 3).split('\n')[0]) : null; } catch (e) { return null; }
}

(async () => {
  const r = await python(['-I', path.join(tmp, 'ridic.py'), NASTROJE, KOREN, tmp]);
  const j = json(r.out);
  if (!j) { console.log(r.out.slice(-3000)); ok('ovladač doběhl', false); return konec(); }

  sekce('1) skutečné kontroly');
  const sk = Object.fromEntries(j.skutecne.map(x => [x.klic, x]));
  const slozky = fs.readdirSync(NASTROJE).filter(d => fs.existsSync(path.join(NASTROJE, d, d + '_kontrola.py')));
  ok('najde každou kontrolu ve složce', j.skutecne.length === slozky.length && slozky.length >= 15, j.skutecne.length + ' / ' + slozky.length);
  ok('jména míst ze skriptů', sk.bazos && sk.bazos.nazev === 'Bazoš' && sk.thebeast.nazev === 'TheBeast' && sk.wtb.nazev === 'WTB Market', JSON.stringify([sk.bazos, sk.thebeast, sk.wtb]));
  const sProhl = j.skutecne.filter(x => x.prohlizec).map(x => x.klic).sort().join(',');
  ok('kontroly přes prohlížeč kontrol se poznají', sProhl === 'adonio,facebook,hypeboost,klekt,released,sneakerstore,tnsky', sProhl);
  ok('jen WTB je ruční (schránka)', j.skutecne.filter(x => x.rucni).map(x => x.klic).join(',') === 'wtb');
  ok('každá kontrola má SPUSTIT_*.bat (tlačítko V okně)', j.skutecne_bat);

  sekce('2) rozbor výpisu');
  const R = j.rozbor;
  ok('hotovo + posláno = ok', R.ok.stav === 'ok' && R.ok.souhrn === 'Alfa: přidat 1' && R.ok.poslano, JSON.stringify(R.ok));
  ok('náhled = ok, ale nic se neposlalo', R.nahled.stav === 'ok' && !R.nahled.poslano);
  ok('!!! CHYBA s kódem 0 je chyba', R.chyba.stav === 'chyba' && R.chyba.zprava === 'Web vrátil 502');
  ok('Potřeba přihlásit = přihlásit', R.prihlasit.stav === 'prihlasit');
  ok('pád s kódem ≠ 0 je chyba s posledním řádkem', R.kod.stav === 'chyba' && /ModuleNotFoundError/.test(R.kod.zprava));
  ok('prázdný výpis není ok', R.nic.stav === 'chyba');

  sekce('3) Spustit vše');
  const st = j.stav.kontroly, S = j.stopy;
  ok('doběhlo', j.dobehlo, j.trvalo);
  ok('složka bez kontroly se nebere', !j.nalezene.some(x => x[0] === 'debug'));
  ok('ruční WTB se nespustí', !S.wtb.length && !st.wtb);
  for (const k of ['alfa', 'beta', 'gama', 'prohl1', 'prohl2'])
    ok(k + ' ok se souhrnem a posláno', st[k] && st[k].stav === 'ok' && st[k].poslano && st[k].souhrn.startsWith(k[0].toUpperCase() + k.slice(1)), JSON.stringify(st[k]));
  ok('kontroly dostanou SKLAD_BEZ_PTANI=1', Object.values(S).flat().filter(x => 'bez_ptani' in x).every(x => x.bez_ptani === '1'));
  ok('input() nečeká — stdin je zavřený, skončí Potřeba přihlásit', st.klavesnice.stav === 'prihlasit', JSON.stringify(st.klavesnice));
  ok('padající kontrola je chyba', st.pada.stav === 'chyba' && /rozbitý import/.test(st.pada.zprava), JSON.stringify(st.pada));
  const iv = k => [S[k][0].start, S[k][S[k].length - 1].konec];
  const prekryv = (a, b) => iv(a)[0] < iv(b)[1] && iv(b)[0] < iv(a)[1];
  ok('kontroly přes prohlížeč nikdy naráz', !prekryv('prohl1', 'prohl2') && !prekryv('prohl1', 'mrak') && !prekryv('prohl2', 'mrak'));
  ok('kontroly bez prohlížeče běží naráz', prekryv('alfa', 'beta') && prekryv('beta', 'gama'));
  ok('prohlížeč běží skrytý', S.prohl1[0].rezim === 'skryty' && S.alfa[0].rezim === '');
  ok('Mrak: skrytý nepustí → znovu s oknem mimo obrazovku', S.mrak.filter(x => 'rezim' in x).map(x => x.rezim).join(',') === 'skryty,mimo' && st.mrak.stav === 'ok', JSON.stringify(S.mrak));
  ok('spouštěč si okno mimo obrazovku u Mraku zapamatuje', j.stav.rezim.mrak === 'mimo' && !j.stav.rezim.prohl1);
  ok('souhrn pro oznámení', j.souhrn && j.souhrn.prihlasit === 1 && j.souhrn.chyba === 1 && j.souhrn.bezi === 0, JSON.stringify(j.souhrn));
  ok('výpis běhu v posledni_beh.txt', /HOTOVO/.test(j.vypis_alfa) && /Čtu nabídky/.test(j.vypis_alfa));
  ok('stav se uloží (spoustec.json)', j.ulozeny.posledni_vse > 0 && j.ulozeny.kontroly.alfa.stav === 'ok');

  sekce('4) zapamatovaný režim');
  ok('Mrak podruhé rovnou mimo obrazovku, jen jednou', j.mrak2.filter(x => 'rezim' in x).map(x => x.rezim).join(',') === 'mimo' && j.mrak2_stav.stav === 'ok', JSON.stringify(j.mrak2));

  sekce('5) po zapnutí PC');
  ok('chvíli po běhu se nespouští nic', /nespouští/.test(j.po_hned || '') && !j.po_hned_bezi, j.po_hned);
  ok('bez internetu se nespouští a řekne se to', /internet/.test(j.po_bez_site || ''));
  ok('po odstupu se pustí všechno', j.po_pozde === null && j.po_pozde_dobehlo);

  sekce('6–8) pád okna, zastavení, limit');
  ok('rozběhnutá kontrola po zavření okna → Nedoběhlo', j.po_padu === 'nevi');
  ok('Zastavit ukončí kontrolu hned', j.zastaveno.stav.stav === 'nevi' && j.zastaveno.za < 5, JSON.stringify(j.zastaveno));
  ok('zaseklá kontrola se po limitu ukončí', j.limit.stav === 'chyba' && /ukončil/.test(j.limit.zprava), JSON.stringify(j.limit));

  sekce('9) spuštění po zapnutí (registr)');
  ok('příkaz pouští pythonw s --po-zapnuti', j.registr.startsWith('"C:\\\\Python\\\\pythonw.exe" -c "') && j.registr.includes('--po-zapnuti'), j.registr);
  // Kód z registru opravdu funguje (i s diakritikou a mezerou v cestě) a čeká na Disk
  const kod = j.registr.slice(j.registr.indexOf('-c "') + 4, -1);
  const r9 = await python(['-c', kod]);
  ok('kód z registru spustí KONTROLY.pyw s --po-zapnuti', /ARGV \['--po-zapnuti'\]/.test(r9.out), r9.out);
  ok('v kódu nejsou uvozovky, které by rozbily příkaz', !kod.includes('"'));
  ok('na Disk Google se čeká, než se připojí', /os\.path\.exists\(p\)/.test(kod) && /time\.sleep/.test(kod));

  sekce('10) jedno okno');
  ok('druhý spouštěč nevznikne', j.zamek[0] && j.zamek[1]);

  sekce('11) kontroly se nikdy neptají, když je pouští spouštěč');
  const r11 = await python(['-I', '-c', `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(NASTROJE)})
import sklad_firestore as S, prohlizec as P
out = {}
try:
    S.prihlaseni_webu('Sellect'); out['heslo'] = 'zeptalo se'
except S.ChybaSkladu as e:
    out['heslo'] = str(e)
os.environ['SKLAD_PROHLIZEC'] = 'skryty'
out['skryty'] = P.Prohlizec().viditelny
os.environ['SKLAD_PROHLIZEC'] = 'mimo'
b = P.Prohlizec(); out['mimo'] = [b.viditelny, b.rezim]
del os.environ['SKLAD_PROHLIZEC']
out['bat'] = P.Prohlizec().viditelny
P._ok_pockej = lambda *a, **k: False
class Str:
    def wait_for_timeout(self, ms): pass
try:
    P.Prohlizec().prihlaseni(Str(), 'x', 'Klekt'); out['okno'] = 'zeptalo se'
except P.ChybaProhlizece as e:
    out['okno'] = str(e)
print('###' + json.dumps(out, ensure_ascii=False))
`], { SKLAD_BEZ_PTANI: '1' }, 20000);
  const j11 = json(r11.out) || {};
  ok('heslo k webu: místo otázky „Potřeba přihlásit“', /^Potřeba přihlásit/.test(j11.heslo || ''), r11.out);
  ok('prohlížeč: místo Enteru „Potřeba přihlásit“', /^Potřeba přihlásit/.test(j11.okno || ''), j11.okno);
  ok('SKLAD_PROHLIZEC=skryty → bez okna', j11.skryty === false);
  ok('SKLAD_PROHLIZEC=mimo → okno (mimo obrazovku)', j11.mimo && j11.mimo[0] === true && j11.mimo[1] === 'mimo');
  ok('bez proměnné (SPUSTIT_*.bat) okno vidět je', j11.bat === true);
  const pr = fs.readFileSync(path.join(NASTROJE, 'prohlizec.py'), 'utf8');
  ok('okno mimo obrazovku se opravdu posune', /--window-position=-\d+,-\d+/.test(pr));

  sekce('12) soubory a okno');
  const kod12 = fs.readFileSync(path.join(NASTROJE, 'spoustec.py'), 'utf8');
  ok('spouštěč sám nikdy nečeká na klávesnici', !/\binput\(|getpass/.test(kod12));
  ok('kontroly běží bez černého okna', /CREATE_NO_WINDOW|NO_WINDOW = 0x08000000/.test(kod12) && /creationflags=NO_WINDOW/.test(kod12));
  ok('KONTROLY.pyw spouští spoustec.main', /spoustec\.main\(/.test(fs.readFileSync(path.join(NASTROJE, 'KONTROLY.pyw'), 'utf8')));
  ok('stav mimo Google Disk (LOCALAPPDATA)', /LOCALAPPDATA/.test(kod12));
  ok('spouštěč není na webu (.assetsignore)', /nastroje/.test(fs.readFileSync(path.join(__dirname, '..', '.assetsignore'), 'utf8')));
  /* Tiché okno (majitel, 13. 11. 2026): jen ukazuje, že program běží.
     Nevyskočí (startuje na liště), křížek ho jen schová a ovládat se
     v něm nedá nic — to je ve SKLADu. */
  const okno = (kod12.match(/def okno_stavu[\s\S]*?\n\ndef /) || [''])[0];
  ok('okno startuje schované na liště', /root\.iconify\(\)/.test(okno) && !/root\.deiconify\(\)\s*\n\s*root\.lift\(\)\s*\n\s*obnov\(\)/.test(okno));
  ok('křížek okno jen schová, kontroly jedou dál', /WM_DELETE_WINDOW", root\.iconify/.test(okno));
  ok('v okně se nic nespouští (ovládání je ve SKLADu)', !/\.spust\(|spust_vse\(|v_okne\(/.test(okno));
  ok('bez tkinteru jede spouštěč bez okna', /except ImportError:\s*\n\s*ag\.bez_konce\(\)/.test(kod12));
  const r12 = await python(['-I', '-c', `
import sys, json, time
sys.path.insert(0, ${JSON.stringify(NASTROJE)})
import spoustec as S
sp = S.Spoustec(${JSON.stringify(KOREN)}, ${JSON.stringify(path.join(tmp, 'stav12.json'))})
class A: chyba = ''; posledni_zapis = 0
out = {'klid': S.popis_stavu(sp, A())}
sp.s('alfa').update(stav='bezi', radek='Čtu nabídky…'); sp.s('beta').update(stav='ceka')
out['bezi'] = S.popis_stavu(sp, A())
sp.s('alfa').update(stav='chyba'); sp.s('beta').update(stav='ok')
a = A(); a.chyba = 'Nejde se spojit s Googlem'
out['chyba'] = S.popis_stavu(sp, a)
print('###' + json.dumps(out, ensure_ascii=False))
`]);
  const j12 = json(r12.out) || {};
  ok('okno v klidu: čeká na pokyn ze SKLADu', /čekám na pokyn ze SKLADu/.test((j12.klid || [])[0]) && (j12.klid || [])[5] === false, JSON.stringify(j12.klid));
  ok('okno při běhu: co běží a co dělá, kolečko se točí', /Běží Alfa · čeká 1/.test((j12.bezi || [])[0]) && /Alfa: Čtu nabídky/.test((j12.bezi || [])[1]) && (j12.bezi || [])[5] === true, JSON.stringify(j12.bezi));
  ok('okno řekne, co chce pozornost i výpadek spojení', /Pozornost chce: Alfa/.test((j12.chyba || [])[1]) && /Googlem/.test((j12.chyba || [])[2]), JSON.stringify(j12.chyba));

  sekce('13) pokyny z aplikace');
  const r13 = await python(['-I', '-c', `
import sys, os, json, time
sys.path.insert(0, ${JSON.stringify(NASTROJE)})
import spoustec as S
koren, tmp = ${JSON.stringify(KOREN)}, ${JSON.stringify(tmp)}
open(os.path.join(koren, 'gama', 'gama_kontrola.py'), 'w', encoding='utf-8').write(open(os.path.join(koren, 'alfa', 'alfa_kontrola.py'), encoding='utf-8').read())
ted = lambda s=0: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
class Mrak:
    def __init__(self):
        self.p, self.zapisy, self.smazane, self.chyba, self.nesmaz = [], [], [], None, False
    def prikazy(self):
        if self.chyba: raise Exception(self.chyba)
        return [x for x in self.p if x[0] not in self.smazane]
    def zapis_stav(self, o):
        self.zapisy.append(o)
    def smaz_prikaz(self, j):
        if self.nesmaz: raise Exception('403')
        self.smazane.append(j)
out = {}
sp = S.Spoustec(koren, os.path.join(tmp, 'stav13.json'))
m = Mrak(); ag = S.Agent(sp, m)
m.p = [('prikaz_a', {'co': 'spust', 'klic': 'alfa', 'kdy': ted()}),
       ('prikaz_stary', {'co': 'spust', 'klic': 'beta', 'kdy': ted(-20 * 60)}),
       ('prikaz_zly', {'co': 'cmd /c del', 'klic': 'alfa', 'kdy': ted()}),
       ('prikaz_cesta', {'co': 'spust', 'klic': '../../evil', 'kdy': ted()}),
       ('prikaz_bezcasu', {'co': 'spust', 'klic': 'gama'})]
ag.krok()
out['smazane'] = sorted(m.smazane)
out['alfa_bezi'] = sp.bezi('alfa')
out['beta'] = sp.s('beta').get('stav'); out['gama'] = sp.s('gama').get('stav')
for _ in range(100):
    if not sp.bezi(): break
    time.sleep(0.1)
out['alfa'] = sp.s('alfa').get('stav')
out['zapis1'] = m.zapisy[0] if m.zapisy else None
n = len(m.zapisy)
ag.krok(); out['bez_zmeny_nezapise'] = len(m.zapisy) - n
ag.posledni_zapis -= S.TEP_S + 1
ag.krok(); out['tep'] = len(m.zapisy) - n
# pokyn, který se nepodaří smazat, se neprovede dvakrát
m.nesmaz = True
if os.path.exists(os.path.join(koren, 'beta', 'stopa.txt')): os.remove(os.path.join(koren, 'beta', 'stopa.txt'))
m.p = [('prikaz_b', {'co': 'spust', 'klic': 'beta', 'kdy': ted()})]
ag.krok()
for _ in range(100):
    if not sp.bezi(): break
    time.sleep(0.1)
ag.krok()
out['beta_behu'] = len([1 for r in open(os.path.join(koren, 'beta', 'stopa.txt'), encoding='utf-8') if 'start' in r]) if os.path.exists(os.path.join(koren, 'beta', 'stopa.txt')) else 0
# výpadek cloudu agenta neshodí
m.chyba = 'Nejde se spojit s Googlem'
ag.krok(); out['chyba'] = ag.chyba
m.chyba = None; ag.krok(); out['chyba_po'] = ag.chyba
# zastavit vše a po_zapnuti (mimo Windows nic nezapíše)
m.nesmaz = False
m.p = [('prikaz_z', {'co': 'zastav', 'klic': None, 'kdy': ted()})]
ag.krok(); out['zastaveno'] = sp.zastaveno
print('###' + json.dumps(out, ensure_ascii=False, default=str))
`]);
  const j13 = json(r13.out) || {};
  if (!json(r13.out)) console.log(r13.out.slice(-2000));
  shoda('všechny pokyny se po vyřízení smažou', j13.smazane, ['prikaz_a', 'prikaz_bezcasu', 'prikaz_cesta', 'prikaz_stary', 'prikaz_zly']);
  ok('Spustit z aplikace kontrolu pustí', j13.alfa_bezi && j13.alfa === 'ok', JSON.stringify(j13));
  ok('starý pokyn (PC bylo vypnuté) se neprovede', !j13.beta);
  ok('pokyn bez času se neprovede', !j13.gama);
  ok('neznámý pokyn ani cizí cesta nic nespustí', !j13.beta && !j13.gama);
  const k1 = (j13.zapis1 || {}).kontroly || [];
  ok('stav pro aplikaci: kontroly s klíčem, jménem a stavem', k1.length >= 9 && k1.every(k => k.klic && k.nazev && 'stav' in k), JSON.stringify(k1[0]));
  ok('stav nese čas a jestli se spouští po zapnutí', j13.zapis1 && 'po_zapnuti' in j13.zapis1 && /^\d{4}-\d\d-\d\dT/.test(j13.zapis1.tep || ''), JSON.stringify(j13.zapis1).slice(0, 200));
  ok('bez změny se stav nezapisuje pořád', j13.bez_zmeny_nezapise === 0, j13.bez_zmeny_nezapise);
  ok('ale aspoň jednou za TEP_S (aplikace pozná zapnuté PC)', j13.tep === 1, j13.tep);
  ok('nesmazaný pokyn se neprovede dvakrát', j13.beta_behu === 1, j13.beta_behu);
  ok('výpadek cloudu spouštěč neshodí a pak se vzpamatuje', /Googlem/.test(j13.chyba) && j13.chyba_po === '', JSON.stringify([j13.chyba, j13.chyba_po]));
  ok('Zastavit vše z aplikace', j13.zastaveno === true);

  sekce('14) cloud: jen pc, jen pokyny');
  const http = require('http');
  const volani = [];
  const server = http.createServer((req, res) => {
    let t = ''; req.on('data', c => t += c); req.on('end', () => {
      volani.push({ m: req.method, u: req.url, a: req.headers.authorization, t });
      const posli = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.includes('/zakazano/')) return posli(403, {});
      if (req.method === 'GET') return posli(200, { documents: [
        { name: 'x/spoustec/pc', fields: { tep: { stringValue: 'x' } } },
        { name: 'x/spoustec/prikaz_ab1', fields: { co: { stringValue: 'vse' }, kdy: { stringValue: '2026-11-13T10:00:00Z' } } }] });
      posli(200, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const r14 = await python(['-I', '-c', `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(NASTROJE)})
import spoustec as S, sklad_firestore as SF
c = S.Cloud(prihlaseni=lambda: 'TOKEN')
out = {'prikazy': c.prikazy()}
c.zapis_stav({'tep': 'T', 'kontroly': [{'klic': 'alfa', 'stav': 'ok'}]})
c.smaz_prikaz('prikaz_ab1')
try:
    c.smaz_prikaz('pc'); out['smaz_pc'] = 'smazal'
except ValueError:
    out['smaz_pc'] = 'odmítnuto'
SF.FS_BASE = SF.FS_BASE.replace('/fs', '/zakazano/fs')
try:
    c.prikazy(); out['403'] = ''
except SF.ChybaSkladu as e:
    out['403'] = str(e)
print('###' + json.dumps(out, ensure_ascii=False))
`], { SKLAD_FS_BASE: 'http://127.0.0.1:' + port + '/fs', SKLAD_AUTH_URL: 'http://127.0.0.1:' + port + '/auth' });
  server.close();
  const j14 = json(r14.out) || {};
  if (!json(r14.out)) console.log(r14.out.slice(-1500));
  shoda('pokyny se čtou jen prikaz_… (pc ne)', j14.prikazy, [['prikaz_ab1', { co: 'vse', kdy: '2026-11-13T10:00:00Z' }]]);
  const zapisy = volani.filter(v => v.m !== 'GET');
  shoda('zapisuje se jen spoustec/pc a maže jen pokyn', zapisy.map(v => v.m + ' ' + v.u.replace(/\?.*/, '')),
    ['PATCH /fs/users/p6JKNhfrbmZYaF8OIBxgd9durmq2/spoustec/pc', 'DELETE /fs/users/p6JKNhfrbmZYaF8OIBxgd9durmq2/spoustec/prikaz_ab1']);
  ok('s tokenem', volani.every(v => v.a === 'Bearer TOKEN'));
  ok('smazat jde jen pokyn, ne stav', j14.smaz_pc === 'odmítnuto');
  ok('nepublikovaná pravidla se řeknou naplno', /blok spoustec/.test(j14['403'] || ''), j14['403']);
  ok('spouštěč do skladu nezapisuje', !/sklad\//.test(fs.readFileSync(path.join(NASTROJE, 'spoustec.py'), 'utf8').replace(/sklad_firestore|sklad\.mtkm/g, '')));

  sekce('15) dvojklik, když už spouštěč běží');
  const r15 = await python(['-I', '-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(NASTROJE)})
import spoustec as S
z = S.jediny()
otevreno = []
S.otevri_aplikaci = lambda: otevreno.append(1)
kod = S.main([])
print('###' + json.dumps({'kod': kod, 'otevreno': len(otevreno), 'adresa': S.ADRESA_APLIKACE}))
`]);
  const j15 = json(r15.out) || {};
  ok('druhý spouštěč nevznikne, jen se otevře aplikace na okně kontrol', j15.kod === 0 && j15.otevreno === 1 && /#kontroly$/.test(j15.adresa || ''), r15.out.slice(-400));

  konec();
})();

function konec() {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${proslo} prošlo, ${selhalo} selhalo`);
  process.exit(selhalo ? 1 : 0);
}
