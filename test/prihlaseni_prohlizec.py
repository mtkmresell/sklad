# Skutečný prohlížeč a samostatné přihlášení (prohlizec.prihlas_sam) proti zkušebním
# formulářům: bez tlačítka, s tlačítkem, dvoukrokový, špatné uložené heslo, už přihlášený.
# Spouští test/test-prihlasenisam.js.
import sys, os, json, threading, http.server, urllib.parse, types
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'nastroje'))
# Stránky: /login1 (Rails: user[email] + user[password]), /login2 (dvoukrok), /data (přihlášeno?)
STAV = {'prihlasen': False}
STRANKY = {
 '/login1': '<form method=post action=/prihlas><input type=email name="user[email]" id=user_email><input type=password name="user[password]"></form>',
 '/login3': '<form method=post action=/prihlas><input type=email name="user[email]"><input type=password name="user[password]"><button type=submit>Přihlásit</button></form>',
 '/login2': '<div id=k1><input name=identifier type=text autocomplete=username id=em></div><script>document.getElementById("em").addEventListener("keydown",e=>{if(e.key==="Enter"){document.body.insertAdjacentHTML("beforeend","<form method=post action=/prihlas><input type=hidden name=\\"user[email]\\" value=\\""+e.target.value+"\\"><input type=password name=\\"user[password]\\"></form>")}})</script>',
}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == '/data':
            body = '<table><tbody><tr><td>ok</td></tr></tbody></table>' if STAV['prihlasen'] else '<p>login</p>'
        else:
            body = STRANKY.get(self.path, 'x')
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body.encode())
    def do_POST(self):
        d = urllib.parse.parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
        STAV['prihlasen'] = d.get('user[email]') == ['gabro@x.cz'] and d.get('user[password]') == ['tajne']
        STAV['posledni'] = d
        self.send_response(302); self.send_header('Location', '/data'); self.end_headers()
srv = http.server.HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d' % srv.server_port
import prohlizec as P
# skutečný Chromium z prostředí místo Chrome/Edge
import tempfile
P.PROFIL = tempfile.mkdtemp(prefix='prohl-')
puvodni = P.Prohlizec.__enter__
def enter(self):
    from playwright.sync_api import sync_playwright
    self._pw = sync_playwright().start()
    self._ctx = self._pw.chromium.launch_persistent_context(P.PROFIL, executable_path=os.environ.get('PROHLIZEC_CHROMIUM') or None, headless=True)
    return self
P.Prohlizec.__enter__ = enter
S = types.ModuleType('sklad_firestore'); ulozeno, zapomenuto = [], []
hesla = {'heslo': 'tajne'}
S.prihlaseni_webu = lambda m: ('gabro@x.cz', hesla['heslo'], hesla.get('nove', True))
S.uloz_prihlaseni_webu = lambda m, e, h: ulozeno.append(m)
S.zapomen_prihlaseni_webu = lambda m: zapomenuto.append(m)
sys.modules['sklad_firestore'] = S
TEST = "!!document.querySelector('tbody tr')"
vysl = {}
import builtins; builtins.input = lambda *a: ''
with P.Prohlizec() as b:
    for jm, login in (('jednokrok', '/login1'), ('dvoukrok', '/login2'), ('s_tlacitkem', '/login3')):
        STAV['prihlasen'] = False
        s = b.otevri(U + '/data', 200)
        try:
            ok = P.prihlas_sam(b, s, TEST, jm, U + '/data', U + login)
        except Exception as e:
            ok = 'CHYBA ' + str(e)
        vysl[jm] = {'ok': ok, 'prihlasen': STAV['prihlasen'], 'ulozeno': list(ulozeno)}
    # špatné heslo (uložené) → zapomene a zeptá se znovu; podruhé správně
    STAV['prihlasen'] = False; ulozeno.clear()
    pokusy = iter([('spatne', False), ('tajne', True)])
    def pw(m):
        h, nove = next(pokusy); return ('gabro@x.cz', h, nove)
    S.prihlaseni_webu = pw
    s = b.otevri(U + '/data', 200)
    ok = P.prihlas_sam(b, s, TEST, 'spatne', U + '/data', U + '/login1')
    vysl['spatne_heslo'] = {'ok': ok, 'zapomenuto': zapomenuto, 'ulozeno': ulozeno}
    # už přihlášený → nic nevyplňuje
    S.prihlaseni_webu = lambda m: (_ for _ in ()).throw(AssertionError('nemělo se ptát'))
    s = b.otevri(U + '/data', 200)
    vysl['uz_prihlasen'] = P.prihlas_sam(b, s, TEST, 'x', U + '/data', U + '/login1')
print(json.dumps(vysl, ensure_ascii=False, indent=1))
