"""Familienplan im Browser: zwei Geräte (getrennte Browser-Kontexte) teilen sich einen nachgebauten Firebase-Speicher.
Aufruf: python3 tests/family-ui.test.py [url] [screenshot-ordner]"""
import sys, json, re
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
fails, passed = [], 0
def check(c, m):
    global passed
    if c: passed += 1
    else: fails.append(m); print('  ✗', m)
FAM = {'body': 'null'}
def firebase(route):
    r = route.request
    if r.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    if r.method == 'PUT': FAM['body'] = r.post_data
    if r.method == 'PATCH':
        d = {} if FAM['body'] == 'null' else json.loads(FAM['body']); d.update(json.loads(r.post_data)); FAM['body'] = json.dumps(d)
    route.fulfill(body=FAM['body'], content_type='application/json', headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
def dev(b):
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='de-DE', service_workers='block')
    c.route('https://demo-fam.firebasedatabase.app/**', firebase)
    c.route('https://commons.wikimedia.org/**', lambda r: r.fulfill(json={'query': {'pages': {}}}))
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(URL); pg.wait_for_selector('.tab'); return c, pg, errs
def close_sheets(pg): pg.evaluate("document.querySelectorAll('.sheet-wrap').forEach(e=>e.remove());document.body.classList.remove('noscroll');__app.st.sheets.length=0")
with sync_playwright() as p:
    b = p.chromium.launch()
    ca, A, ea = dev(b); cb, B, eb = dev(b); cc, C, ec = dev(b)
    A.click('.tab[data-id=settings]'); A.click('[data-act=fam-create]'); A.wait_for_selector('form[data-form=fam-create]')
    A.fill('[name=name]', 'Familie Test'); A.fill('[name=myName]', 'Anna'); A.fill('[name=url]', 'http://unsicher.de/x.json'); A.click('form[data-form=fam-create] button[type=submit]')
    check('HTTPS' in A.locator('#famErr').inner_text(), 'unsichere Adresse wird abgelehnt')
    A.fill('[name=url]', 'https://demo-fam.firebasedatabase.app/fam.json'); A.click('form[data-form=fam-create] button[type=submit]'); A.wait_for_selector('.member', timeout=8000)
    check('Admin' in A.locator('.card h3').filter(has_text='Familie Test').locator('xpath=..').inner_text(), 'Familie gegründet, Anna ist Admin')
    if SHOT: A.screenshot(path=f'{SHOT}/family.png', full_page=True)
    A.click('[data-act=fam-invite][data-role=member]'); A.wait_for_selector('#copyArea'); link = A.locator('#copyArea').input_value(); close_sheets(A)
    A.click('[data-act=fam-invite][data-role=guest]'); A.wait_for_selector('#copyArea'); glink = A.locator('#copyArea').input_value(); close_sheets(A)
    check('?join=' in link and link != glink, 'Einladungslinks erzeugt')
    # Ben tritt bei
    B.click('.tab[data-id=settings]'); B.click('[data-act=fam-join]'); B.wait_for_selector('form[data-form=fam-join]')
    B.fill('[name=code]', 'kaputt'); B.fill('[name=myName]', 'Ben'); B.click('form[data-form=fam-join] button[type=submit]'); B.wait_for_timeout(300)
    check('ungültig' in B.locator('#famErr').inner_text(), 'ungültiger Code wird erklärt')
    B.fill('[name=code]', link); B.click('form[data-form=fam-join] button[type=submit]'); B.wait_for_selector('.member', timeout=8000)
    check(B.locator('.member').count() == 2 and 'Mitglied' in B.locator('.settings-x, .card').filter(has_text='Du bist').first.inner_text(), 'Ben ist Mitglied')
    # Cleo als Gast
    C.click('.tab[data-id=settings]'); C.click('[data-act=fam-join]'); C.fill('[name=code]', glink); C.fill('[name=myName]', 'Cleo'); C.click('form[data-form=fam-join] button[type=submit]'); C.wait_for_selector('.member', timeout=8000)
    check('Gast' in C.locator('.card').filter(has_text='Du bist').first.inner_text(), 'Cleo ist Gast')
    # Ben erzeugt neuen Plan → bei Anna nach Abgleich sichtbar
    B.click('.tab[data-id=plan]'); B.click('.sticky-actions [data-act=generate]'); B.wait_for_timeout(300)
    plan_b = B.locator('.day-title').all_inner_texts()
    B.evaluate("__app.App.famSync(true)"); B.wait_for_timeout(600)
    A.click('.tab[data-id=plan]'); A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(800)
    check(A.locator('.day-title').all_inner_texts() == plan_b, 'gemeinsamer Wochenplan kommt bei Anna an')
    # Gast darf Plan nicht ändern, aber ansehen
    C.click('.tab[data-id=plan]'); C.evaluate("__app.App.famSync(true)"); C.wait_for_timeout(800)
    check(C.locator('.day-title').all_inner_texts() == plan_b, 'Gast sieht den Plan')
    C.click('.sticky-actions [data-act=generate]'); C.wait_for_timeout(300)
    check(C.locator('.day-title').all_inner_texts() == plan_b and 'darfst' in C.locator('.toast').last.inner_text(), 'Gast kann Plan nicht ändern')
    # Einkaufsliste gemeinsam
    B.click('.tab[data-id=shop]'); B.locator('.item .box').first.click(); B.wait_for_timeout(200); B.evaluate("__app.App.famSync(true)"); B.wait_for_timeout(600)
    A.click('.tab[data-id=shop]'); A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(800)
    check(A.locator('.item.done').count() == 1, 'Abhaken bei Ben erscheint bei Anna')
    C.click('.tab[data-id=shop]'); C.evaluate("__app.App.famSync(true)"); C.wait_for_timeout(800); C.locator('.item .box').nth(2).click(); C.wait_for_timeout(200)
    check(C.locator('.item.done').count() == 1 and 'ansehen' in C.locator('.toast').last.inner_text(), 'Gast kann Liste nicht ändern')
    # Vorschlag + Abstimmung
    B.click('.tab[data-id=recipes]'); B.fill('#recipeQ', 'Lasagne'); B.locator('.rcard').first.click(); B.wait_for_selector('[data-act=fam-propose]'); B.click('[data-act=fam-propose]'); B.wait_for_timeout(900)
    check(B.locator('.prop').count() == 1, 'Vorschlag erscheint auf der Startseite')
    A.click('.tab[data-id=home]'); A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(900)
    check(A.locator('.prop').count() == 1, 'Vorschlag bei Anna sichtbar')
    A.click('[data-act=fam-vote][data-v=up]'); A.wait_for_timeout(200); check('1' in A.locator('[data-act=fam-vote][data-v=up]').inner_text(), 'Anna stimmt ab')
    A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(600)
    C.click('.tab[data-id=home]'); C.evaluate("__app.App.famSync(true)"); C.wait_for_timeout(900); C.click('[data-act=fam-vote][data-v=up]'); C.wait_for_timeout(200)
    check('on' in C.locator('[data-act=fam-vote][data-v=up]').get_attribute('class') and C.locator('[data-act=fam-accept]').count() == 0, 'Gast darf abstimmen, aber nicht in den Plan übernehmen')
    C.evaluate("__app.App.famSync(true)"); C.wait_for_timeout(600); A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(700)
    check('2' in A.locator('[data-act=fam-vote][data-v=up]').inner_text(), 'Stimmen werden zusammengezählt (2 dafür)')
    if SHOT: A.screenshot(path=f'{SHOT}/vote.png')
    A.click('[data-act=fam-accept]'); A.wait_for_selector('.alt[data-act=pick]'); A.locator('.alt[data-act=pick]').nth(2).click(); A.wait_for_timeout(500)
    check(A.locator('.prop').count() == 0, 'Vorschlag nach Übernahme in den Plan entfernt')
    # Ernährungsprofil: Ben schließt „Oliven“ aus → gilt für alle
    B.click('.tab[data-id=settings]'); B.fill('[data-act=fam-unwanted]', 'Oliven'); B.press('[data-act=fam-unwanted]', 'Tab'); B.wait_for_timeout(300); B.evaluate("__app.App.famSync(true)"); B.wait_for_timeout(500)
    A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(700)
    check('Oliven' in A.evaluate("__app.App.settings().unwanted.join(',')"), 'Ernährungsprofil von Ben gilt im Plan von Anna')
    # Rechte: Ben (Mitglied) darf Budget nicht ändern
    B.fill('[data-k=budget]', '999'); B.press('[data-k=budget]', 'Tab'); B.wait_for_timeout(300)
    check('Admin' in B.locator('.toast').last.inner_text(), 'Mitglied kann Familienbudget nicht ändern')
    A.click('.tab[data-id=settings]'); A.fill('[data-k=budget]', '150'); A.press('[data-k=budget]', 'Tab'); A.wait_for_timeout(300); A.evaluate("__app.App.famSync(true)"); A.wait_for_timeout(500)
    B.evaluate("__app.App.famSync(true)"); B.wait_for_timeout(700)
    check(B.evaluate("__app.App.settings().budget") == 150, 'Admin-Budget gilt für alle')
    # Mitglied entfernen
    A.click('.tab[data-id=settings]'); A.wait_for_timeout(200)
    A.locator('[data-act=fam-remove]').first.click(); A.click('[data-ans="1"]'); A.wait_for_timeout(900)
    check(A.locator('.member').count() == 2, 'Admin entfernt Mitglied')
    check(not [e for e in ea + eb + ec if e], f'Keine JS-Fehler: {(ea+eb+ec)[:3]}')
    b.close()
print(f'\n{passed} bestanden, {len(fails)} fehlgeschlagen'); sys.exit(1 if fails else 0)
