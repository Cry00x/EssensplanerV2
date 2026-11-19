/* Erweiterungen der Oberfläche: Rezeptimport aus dem Internet, Familienplan, Foto-/Import-Einstellungen.
 * Hängt sich über window.App (app.js) ein und ersetzt nichts Bestehendes. */
(function () {
  'use strict';
  const A = window.App, Fam = A.Fam, S = A.S, E = A.E, D = A.D, esc = A.esc, $ = A.$;
  const money = n => A.money(n);
  const imp = { draft: null, url: '', via: '' };
  const proxies = () => { const p = (S.get('importProxy', '') || '').trim(); return p ? [p].concat(Importer.DEFAULT_PROXIES) : Importer.DEFAULT_PROXIES; };

  // ───────────── Rezeptimport ─────────────
  function importSheet(msg, url, html) {
    const top = A.st.sheets[A.st.sheets.length - 1]; if (top && top.dataset.imp) A.closeSheet();
    const el = A.openSheet(`<h2 class="sheet-title">Rezept aus dem Internet</h2>
      <p class="muted small">Füge den Link zu einem Rezept ein (z. B. Chefkoch, Lecker, EAT SMARTER, Rezeptwelt). Zutaten, Schritte, Portionen und Zeit werden gelesen, auf 4 Personen umgerechnet und an deine Ernährungsregeln angepasst. Die Quelle bleibt gespeichert.</p>
      ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
      <form data-form="import-url" class="form"><label class="field col"><span>Link zum Rezept</span><input name="url" type="url" inputmode="url" required placeholder="https://www.chefkoch.de/rezepte/…" value="${esc(url || '')}" autocomplete="off"></label>
        <button class="btn primary big-btn" type="submit">Rezept laden</button></form>
      <p class="muted small">Browser dürfen fremde Seiten nur über einen Vermittlungsdienst (Proxy) laden. Dabei sieht der Dienst, welchen Link du öffnest. Wer das nicht möchte, nutzt unten den Quelltext oder die manuelle Eingabe.</p>
      <details ${html ? 'open' : ''}><summary>Klappt nicht? Seitenquelltext einfügen</summary>
        <form data-form="import-html" class="form"><p class="muted small">Seite im Browser öffnen → Quelltext anzeigen (Mac: ⌥⌘U; iPhone: Lesezeichen-Trick oder Desktop) → alles kopieren und hier einfügen.</p>
        <input name="url" type="url" placeholder="Link der Seite (für die Quellenangabe)" value="${esc(url || '')}"><textarea name="html" rows="5" placeholder="&lt;html&gt; …" required>${esc(html || '')}</textarea>
        <button class="btn big-btn" type="submit">Aus Quelltext lesen</button></form></details>
      <button class="btn big-btn" data-act="new-recipe-from-import">✍️ Stattdessen manuell eingeben</button>`, 'tall');
    el.dataset.imp = '1';
  }
  function previewSheet(draft, url) {
    const c = A.ctx(), tmp = A.st.sheets[A.st.sheets.length - 1]; if (tmp && tmp.dataset.imp) A.closeSheet();
    imp.draft = draft; imp.url = url;
    const b = Importer.buildRecipe(c, draft, {}), r = b.recipe;
    const ings = r.ings.map(([id, a]) => { const i = c.ing[id] || b.newIng[id]; return `<li><span>${E.fmtAmount(a, i.u, i.u === 'Stk')}</span> ${esc(i.n)}${b.newIng[id] ? ' <small>(neu, Preis unbekannt)</small>' : ''}</li>`; }).join('');
    const el = A.openSheet(`<h2 class="sheet-title">Import prüfen</h2>
      <form data-form="import-save" class="form">
      ${b.dup ? `<div class="alert">⚠ ${esc(b.dup.reason)} („${esc(b.dup.recipe.name)}“). Du kannst trotzdem speichern.</div>` : ''}
      ${b.violations.length ? `<div class="alert">Passt nicht zu deinen Einstellungen: ${esc(b.violations.join(', '))}. Das Rezept wird gespeichert, aber nicht automatisch geplant.</div>` : ''}
      <label class="field col"><span>Name</span><input name="name" required value="${esc(r.name)}"></label>
      <p class="muted small">Quelle: ${esc(draft.source.site || url || 'Einfügung')} · ${draft.servings ? `Original für ${draft.servings} Portionen → umgerechnet auf 4` : 'Portionenangabe fehlt, 4 angenommen'} · ${r.time} Min</p>
      ${b.notes.length ? `<div class="alert">Laktosefrei angepasst:\n${b.notes.map(esc).join('\n')}</div>` : ''}
      ${b.unknown.length ? `<div class="alert">Preis unbekannt für: ${b.unknown.map(esc).join(', ')}. Diese Zutaten zählen mit 0 € im Budget (Preis später unter „Einzelpreise“ möglich).</div>` : ''}
      <div class="field col"><span>Küchenrichtung</span><div class="chips wrap">${D.CUISINES.map(k => `<label class="chip chk"><input type="checkbox" name="cuisine" value="${k}" ${r.cuisines.includes(k) ? 'checked' : ''}><span>${esc(A.cuisineLabel(k))}</span></label>`).join('')}</div></div>
      <h3>Zutaten (4 Personen)</h3><ul class="ings">${ings}</ul>
      <h3>Zubereitung</h3><ol class="steps">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${draft.image ? `<label class="switch"><span><b>Originalbild der Seite verwenden</b><small>Nur wenn du die Rechte dafür hast oder die Seite es erlaubt. Sonst wird ein frei lizenziertes Foto gesucht – oder du lädst später ein eigenes hoch.</small></span><input type="checkbox" name="useimg"><i></i></label>` : ''}
      <button class="btn primary big-btn" type="submit">Rezept speichern</button></form>`, 'tall');
    el.dataset.imp = '2';
  }
  A.acts['import-recipe'] = () => importSheet();
  A.acts['new-recipe-from-import'] = () => { A.closeSheet(true); A.recipeEditor(null); };
  A.forms['import-url'] = async f => {
    const url = Importer.validUrl(f.elements.url.value); if (!url) { A.toast('Bitte einen gültigen Link eingeben'); return; }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Lade …';
    try {
      const r = await Importer.fetchHtml(url, { proxies: proxies() });
      const d = Importer.fromHtml(r.html, url);
      if (!d) { importSheet('Auf dieser Seite wurde kein lesbares Rezept gefunden. Du kannst den Quelltext einfügen oder das Rezept manuell eingeben.', url); return; }
      previewSheet(d, url);
    } catch (e) { importSheet(e.message + ' Versuche den Quelltext einzufügen oder das Rezept manuell einzugeben.', url); }
  };
  A.forms['import-html'] = f => {
    const url = Importer.validUrl(f.elements.url.value) || '';
    const d = Importer.fromHtml(f.elements.html.value, url);
    if (!d) { importSheet('Im eingefügten Text wurde kein Rezept gefunden (es fehlen die Rezeptdaten der Seite).', url, f.elements.html.value); return; }
    previewSheet(d, url);
  };
  A.forms['import-save'] = async f => {
    const c = A.ctx(), d = Object.assign({}, imp.draft, { name: f.elements.name.value.trim() || imp.draft.name });
    const b = Importer.buildRecipe(c, d, { useImage: !!(f.elements.useimg && f.elements.useimg.checked) });
    const cu = [...f.querySelectorAll('input[name=cuisine]:checked')].map(x => x.value); if (cu.length) b.recipe.cuisines = cu;
    if (b.notes.length) b.recipe.notes = b.notes;
    if (S.recipes().some(r => r.id === b.recipe.id)) b.recipe.id += '-' + Date.now().toString(36).slice(-3);
    S.set('customIng', Object.assign({}, S.get('customIng', {}), b.newIng));
    await S.putRecipe(b.recipe); A.touch(); Images.ensure([b.recipe], true);
    A.closeSheet(true); A.st.tab = 'recipes'; A.st.recipeFilter = { q: '', type: 'own', ing: '', cuisine: '' }; A.render();
    A.toast(b.violations.length ? 'Gespeichert – wird aber nicht automatisch geplant' : 'Rezept importiert', 3500);
  };

  // ───────────── Fotos & Import: Einstellungen ─────────────
  function settingsPhotos(c) {
    const st = Images.stats(c.recipes);
    return `<section class="card"><h3>Fotos & Import</h3>
      <p class="muted small">Rezeptfotos werden beim ersten Start automatisch aus frei lizenzierten Quellen (Wikimedia Commons) gesucht, geprüft und dauerhaft dem Rezept zugeordnet. Stand: <b>${st.ok}</b> von ${st.total} Rezepten mit Foto${st.similar ? ` (davon ${st.similar} als „Beispielfoto“ ähnlicher Gerichte gekennzeichnet)` : ''}${st.none ? `, ${st.none} ohne passendes Foto` : ''}${st.pending ? `, ${st.pending} werden noch gesucht` : ''}. Nicht gefunden = neutraler Platzhalter; du kannst bei jedem Rezept ein eigenes Foto hochladen.</p>
      <label class="field col"><span>Pexels-Schlüssel (optional, kostenlos auf pexels.com/api)</span><input type="password" data-act="imgcfg" data-k="pexelsKey" value="${esc(Images.cfg.pexelsKey || '')}" autocomplete="off" placeholder="für mehr Treffer bei Alltagsgerichten"></label>
      <label class="field col"><span>Eigener Proxy für den Rezeptimport (optional, <code>{url}</code> als Platzhalter)</span><input type="url" data-act="impproxy" value="${esc(S.get('importProxy', ''))}" placeholder="https://mein-proxy.example/?u={url}"></label>
      <div class="row-actions"><button class="btn" data-act="photos-retry">🔍 Fehlende Fotos erneut suchen</button><button class="btn" data-act="import-recipe">🔗 Rezept importieren</button></div></section>`;
  }
  A.acts['photos-retry'] = () => { const c = A.ctx(); Images.retryFailed(c.recipes.filter(r => !r.photo)); A.toast('Suche gestartet – Fotos erscheinen nach und nach'); setTimeout(A.render, 4000); };
  A.changes.imgcfg = t => { Images.saveCfg({ pexelsKey: t.value.trim() }); A.toast(t.value.trim() ? 'Schlüssel gespeichert' : 'Schlüssel entfernt'); };
  A.changes.impproxy = t => { const v = t.value.trim(); if (v && !/\{url\}/.test(v)) { A.toast('Der Proxy braucht den Platzhalter {url}', 4000); return; } S.set('importProxy', v); A.toast('Gespeichert'); };

  // ───────────── Familienplan ─────────────
  const ROLE_OPTS = [['admin', 'Admin'], ['member', 'Mitglied'], ['guest', 'Gast']];
  const DIETS = [['laktose', 'Laktosefrei'], ['fisch', 'Kein Fisch/Meeresfrüchte'], ['pilze', 'Keine Pilze'], ['kohl', 'Kein Brokkoli/Kohl']];
  function settingsFamily() {
    if (!Fam.active()) return `<section class="card"><h3>👪 Familienplan</h3>
      <p class="muted small">Plane gemeinsam: ein Wochenplan, eine Einkaufsliste und ein Budget für alle, mit Vorschlägen und Abstimmung. Alle Geräte nutzen einen gemeinsamen Online-Speicher (z. B. kostenlose Firebase Realtime Database) – ohne Einrichtung bleibt alles nur auf diesem Gerät.</p>
      <div class="row-actions"><button class="btn primary" data-act="fam-create">Familie gründen</button><button class="btn" data-act="fam-join">Mit Code beitreten</button></div></section>`;
    const me = Fam.me(), mem = Fam.members(), admin = Fam.can('members'), meM = mem.find(m => m.id === me.id) || {}, diet = meM.diet || {}, dI = diet.intol || {};
    return `<section class="card"><h3>👪 ${esc((Fam.get('meta') || {}).name || Fam.config().name)}</h3>
      <p class="muted small">Du bist <b>${esc(me.name)}</b> (${esc(Fam.roleLabel(Fam.role()) || 'entfernt')}). Admin: alles · Mitglied: Plan, Liste, Vorschläge, Abstimmen · Gast: ansehen und abstimmen.</p>
      <div class="list tight">${mem.map(m => `<div class="alt member"><span class="alt-b"><b>${esc(m.name)}${m.id === me.id ? ' (du)' : ''}</b><small>${esc(Fam.roleLabel(m.role))}${m.diet ? ' · eigenes Ernährungsprofil' : ''}</small></span>
        ${admin && m.id !== me.id ? `<select data-act="fam-role" data-id="${esc(m.id)}" aria-label="Rolle von ${esc(m.name)}">${ROLE_OPTS.map(([k, l]) => `<option value="${k}"${m.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="icon-btn" data-act="fam-remove" data-id="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">${A.ICO.trash}</button>` : ''}</div>`).join('')}</div>
      ${admin ? `<div class="row-actions"><button class="btn" data-act="fam-invite" data-role="member">✉️ Mitglied einladen</button><button class="btn" data-act="fam-invite" data-role="guest">Gast einladen</button></div>` : ''}
      <h3>Mein Ernährungsprofil</h3><p class="muted small">Gilt zusätzlich zu den Regeln der anderen: Jeder Ausschluss wird für den gemeinsamen Plan übernommen.</p>
      ${DIETS.map(([k, l]) => `<label class="switch"><span><b>${l}</b></span><input type="checkbox" data-act="fam-diet" data-k="${k}" ${dI[k] ? 'checked' : ''}><i></i></label>`).join('')}
      <label class="field col"><span>Meine unerwünschten Lebensmittel (Komma-getrennt)</span><input type="text" data-act="fam-unwanted" value="${esc((diet.unwanted || []).join(', '))}" placeholder="z. B. Oliven"></label>
      <div class="row-actions"><button class="btn" data-act="fam-sync">🔄 Jetzt abgleichen</button><button class="btn danger" data-act="fam-leave">Familie verlassen</button></div>
      <p class="muted small" id="famState">Status: ${esc(Fam.status)}${Fam.last || S.get('famLast', 0) ? ' · zuletzt ' + new Date(Fam.last || S.get('famLast')).toLocaleString('de-DE') : ''}${Fam.error ? ' · ' + esc(Fam.error) : ''}</p></section>`;
  }
  A.settingsExtra = c => settingsFamily() + settingsPhotos(c);

  A.acts['fam-create'] = () => A.openSheet(`<h2 class="sheet-title">Familie gründen</h2>
    <form data-form="fam-create" class="form">
    <label class="field col"><span>Name der Familie</span><input name="name" required placeholder="z. B. Familie Müller"></label>
    <label class="field col"><span>Dein Name</span><input name="myName" required placeholder="z. B. Anna"></label>
    <label class="field col"><span>Adresse des gemeinsamen Speichers (HTTPS, JSON, GET + PUT)</span><input name="url" type="url" required placeholder="https://<projekt>-default-rtdb.europe-west1.firebasedatabase.app/familie.json"></label>
    <label class="field col"><span>Zugangsschlüssel (optional, wird als ?auth= angehängt)</span><input name="token" type="password" autocomplete="off"></label>
    <p class="muted small">Tipp: In der Firebase-Konsole eine „Realtime Database“ anlegen und die Adresse mit <code>/familie.json</code> eintragen. Wer Adresse und Schlüssel kennt, kann die Daten lesen und schreiben – Einladungscodes nur an Vertraute weitergeben. Rollen werden in der App durchgesetzt, sind aber kein Schutz gegen direkten Zugriff auf den Speicher.</p>
    <div class="formerr" id="famErr" role="alert"></div><button class="btn primary big-btn" type="submit">Gründen</button></form>`, 'tall');
  A.forms['fam-create'] = async f => {
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const s = A.settingsRaw(); await Fam.create({ name: f.elements.name.value, myName: f.elements.myName.value, url: f.elements.url.value, token: f.elements.token.value, budget: s.budget, persons: s.persons, diet: { intol: s.intol, allowSpicy: s.allowSpicy, unwanted: s.unwanted } });
      A.applyFamily(); A.closeSheet(true); A.toast('Familienplan gegründet. Lade jetzt Mitglieder ein.', 4000); A.render();
    } catch (e) { $('#famErr').textContent = e.message; btn.disabled = false; }
  };
  A.acts['fam-join'] = () => { const el = A.openSheet(`<h2 class="sheet-title">Familie beitreten</h2>
    <form data-form="fam-join" class="form">
    <label class="field col"><span>Einladungscode</span><textarea name="code" rows="3" required placeholder="Code oder Einladungslink einfügen"></textarea></label>
    <label class="field col"><span>Dein Name</span><input name="myName" required></label>
    <div class="formerr" id="famErr" role="alert"></div><button class="btn primary big-btn" type="submit">Beitreten</button></form>`, 'tall');
    const q = new URLSearchParams(location.search).get('join'); if (q) el.querySelector('textarea').value = q; };
  A.forms['fam-join'] = async f => {
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { await Fam.join(f.elements.code.value, f.elements.myName.value); A.applyFamily(); A.closeSheet(true); A.toast('Du bist dabei: ' + Fam.config().name, 4000); A.render(); }
    catch (e) { $('#famErr').textContent = e.message; btn.disabled = false; }
  };
  A.acts['fam-invite'] = async t => {
    try {
      const code = await Fam.invite(t.dataset.role), link = location.origin + location.pathname + '?join=' + code;
      A.textSheet('Einladung (' + Fam.roleLabel(t.dataset.role) + ')', link, 'Schicke diesen Link oder den Code an die Person. Er enthält die Adresse und den Schlüssel des gemeinsamen Speichers – nur an Vertraute weitergeben.');
    } catch (e) { A.toast(e.message, 4000); }
  };
  A.acts['fam-sync'] = () => A.famSync(false);
  A.acts['fam-leave'] = async () => { if (await A.askConfirm('Familienplan auf diesem Gerät verlassen? Deine lokalen Pläne bleiben erhalten.', 'Verlassen')) { await Fam.removeMember(Fam.me().id); A.render(); A.toast('Familienplan verlassen'); } };
  A.acts['fam-remove'] = async t => { if (await A.askConfirm('Dieses Mitglied aus der Familie entfernen?', 'Entfernen')) { try { Fam.removeMember(t.dataset.id); await Fam.sync(); } catch (e) { A.toast(e.message, 4000); } A.render(); } };
  A.changes['fam-role'] = async t => { try { Fam.setRole(t.dataset.id, t.value); await Fam.sync(); A.toast('Rolle geändert'); } catch (e) { A.toast(e.message, 4000); } A.render(); };
  function saveDiet(fn) { const m = Fam.members().find(x => x.id === Fam.me().id) || {}, d = JSON.parse(JSON.stringify(m.diet || { intol: {}, unwanted: [] })); fn(d); try { Fam.setMyDiet(d); A.touch(); } catch (e) { A.toast(e.message, 4000); } A.render(); }
  A.changes['fam-diet'] = t => saveDiet(d => { d.intol = d.intol || {}; d.intol[t.dataset.k] = t.checked; });
  A.changes['fam-unwanted'] = t => saveDiet(d => { d.unwanted = t.value.split(',').map(x => x.trim()).filter(Boolean); });

  // Vorschläge und Abstimmung (Startseite)
  A.homeExtra = c => {
    if (!Fam.active()) return '';
    const props = Fam.proposals(); if (!props.length) return '';
    const can = Fam.can('vote'), plan = Fam.can('plan');
    return `<section class="card"><strong>🗳 Vorschläge der Familie</strong><div class="list tight">${props.map(p => {
      const r = c.recipeMap[p.recipe]; if (!r) return '';
      return `<div class="prop"><button class="alt" data-act="open" data-id="${esc(r.id)}">${Images.tag(r, 'pic')}<span class="alt-b"><b>${esc(r.name)}</b><small>von ${esc(p.byName || '?')}${p.note ? ' · „' + esc(p.note) + '“' : ''}</small></span></button>
        <div class="vote-row"><button class="chip${p.mine === 'up' ? ' on' : ''}" data-act="fam-vote" data-id="${esc(p.id)}" data-v="up" ${can ? '' : 'disabled'} aria-label="Dafür">👍 ${p.up}</button>
        <button class="chip${p.mine === 'down' ? ' on' : ''}" data-act="fam-vote" data-id="${esc(p.id)}" data-v="down" ${can ? '' : 'disabled'} aria-label="Dagegen">👎 ${p.down}</button>
        ${plan ? `<button class="chip" data-act="fam-accept" data-id="${esc(p.id)}" data-rid="${esc(r.id)}">In den Plan</button>` : ''}
        ${plan || p.by === Fam.me().id ? `<button class="chip" data-act="fam-unprop" data-id="${esc(p.id)}" aria-label="Vorschlag entfernen">✕</button>` : ''}</div></div>`;
    }).join('')}</div></section>`;
  };
  A.acts['fam-vote'] = async t => { try { const p = Fam.proposals().find(x => x.id === t.dataset.id); Fam.vote(t.dataset.id, p && p.mine === t.dataset.v ? null : t.dataset.v); A.touch(); } catch (e) { A.toast(e.message, 3500); } A.render(); };
  A.acts['fam-unprop'] = t => { try { Fam.removeProposal(t.dataset.id); A.touch(); } catch (e) { A.toast(e.message, 3500); } A.render(); };
  A.acts['fam-accept'] = t => {
    if (!A.canPlan()) return; const p = A.plan(); if (!p) { A.toast('Erstelle zuerst einen Wochenplan.'); return; }
    const c = A.ctx(), id = t.dataset.rid; A.st.acceptPid = t.dataset.id;
    A.openSheet(`<h2 class="sheet-title">Für welchen Tag?</h2><div class="list tight">${E.DAYS.map((d, i) => { const r0 = c.recipeMap[p.days[i]], dup = E.canPlace(p, i, id); return `<button class="alt" data-act="pick" data-day="${i}" data-id="${esc(id)}"${dup ? ' disabled' : ''}><span class="alt-b"><b>${d}</b><small>${dup ? esc(dup) : 'ersetzt: ' + esc(r0 ? r0.name : '–')}</small></span></button>`; }).join('')}</div>`);
  };
  A.acts['fam-propose'] = t => {
    try { Fam.propose(t.dataset.id, ''); A.touch(); A.toast('Vorschlag an die Familie gesendet'); Fam.sync().then(() => A.render()).catch(() => { }); A.closeSheet(true); A.st.tab = 'home'; A.render(); } catch (e) { A.toast(e.message, 3500); }
  };
  A.sheetExtra = (r) => (Fam.active() && Fam.can('propose') ? `<div class="row-actions"><button class="btn" data-act="fam-propose" data-id="${esc(r.id)}">👪 Für Familie vorschlagen</button></div>` : '');
})();
