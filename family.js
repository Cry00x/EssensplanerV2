/* Familienplan: gemeinsamer Wochenplan, Einkaufsliste, Budget, Vorschläge und Abstimmungen für mehrere Personen/Geräte.
 *
 * Funktionsweise: Alle Familiendaten liegen als Menge einzelner Einträge { key → {v, t, by} } in EINEM gemeinsamen JSON-Dokument
 * auf einem Speicher, den die Familie selbst festlegt (jede Adresse, die GET und PUT für JSON kann, z. B. Firebase Realtime Database
 * `https://<projekt>.firebasedatabase.app/familie-1.json`). Beim Abgleich wird zuerst geladen, dann Eintrag für Eintrag zusammengeführt
 * (neuerer Zeitstempel gewinnt) und das Ergebnis zurückgeschrieben. So gehen gleichzeitige Änderungen verschiedener Einträge nicht verloren.
 *
 * Rollen (Admin / Mitglied / Gast) werden von dieser App auf jedem Gerät durchgesetzt, auch beim Zusammenführen fremder Änderungen.
 * Das ist KEINE Sicherheitsgrenze gegen jemanden, der den Speicher direkt manipuliert – dafür bräuchte man serverseitige Regeln.
 * Wer die Adresse samt Schlüssel kennt, kann das Dokument lesen und schreiben; deshalb Einladungscode nur an Vertraute geben. */
(function (g) {
  'use strict';
  const ROLES = { admin: 'Admin', member: 'Mitglied', guest: 'Gast' };
  const enc = k => String(k).replace(/[.$#[\]\/%]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  const dec = k => decodeURIComponent(k);
  const b64e = s => { const b = typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64d = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s))); };
  const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  // Was darf wer? (Schlüsselart = Teil vor dem ersten ":")
  const KIND_RULES = {
    meta: ['admin'],                       // Familienname, Budget, Personenzahl
    i: ['admin'],                          // Einladungen
    m: ['admin', 'member', 'guest'],       // Mitgliedseintrag: Detailprüfung unten (eigener Eintrag bzw. Admin)
    p: ['admin', 'member'],                // Wochenplan
    c: ['admin', 'member'],                // Haken in der Einkaufsliste
    x: ['admin', 'member'],                // eigene Artikel der Einkaufsliste
    s: ['admin', 'member'],                // Vorschläge
    v: ['admin', 'member', 'guest']        // Stimmen (nur eigene, siehe unten)
  };
  const kind = k => String(k).split(':')[0];

  function makeFamily(opts) {
    const store = opts.store, doFetch = opts.fetch || ((u, o) => g.fetch(u, o)), now = opts.now || (() => Date.now());
    const F = { status: 'aus', error: null, last: null, listeners: [] };
    const emit = () => F.listeners.forEach(f => { try { f(F); } catch (e) { } });

    const cfg = () => store.get('family', null);
    const doc = () => store.get('famdoc', {});
    const saveDoc = d => store.set('famdoc', d);
    F.config = cfg; F.active = () => !!cfg();
    F.me = () => (cfg() || {}).me || null;

    const val = k => { const e = doc()[k]; return e && e.v !== null && e.v !== undefined ? e.v : undefined; };
    F.get = val;
    F.entries = prefix => { const d = doc(), out = {}; Object.keys(d).forEach(k => { if (k.startsWith(prefix) && d[k].v !== null && d[k].v !== undefined) out[k] = d[k].v; }); return out; };

    // ───── Mitglieder und Rechte ─────
    F.members = () => { const m = F.entries('m:'); return Object.keys(m).map(k => Object.assign({ id: k.slice(2) }, m[k])).sort((a, b) => a.name.localeCompare(b.name, 'de')); };
    F.role = () => { const c = cfg(); if (!c) return null; const m = val('m:' + c.me.id); return m ? m.role : null; };
    F.can = action => {
      const r = F.role(); if (!r) return false;
      return { admin: ['view', 'plan', 'shop', 'propose', 'vote', 'settings', 'members', 'invite'], member: ['view', 'plan', 'shop', 'propose', 'vote'], guest: ['view', 'vote'] }[r].includes(action);
    };
    F.roleLabel = r => ROLES[r] || r;

    /** Darf `by` mit Rolle `role` den Eintrag key=v schreiben (v=null: löschen)? old = bisheriger Wert. */
    function allowed(d, key, v, by) {
      const k = kind(key); if (!KIND_RULES[k]) return false;
      const mem = d['m:' + by] && d['m:' + by].v; const role = mem ? mem.role : null;
      if (k === 'm') {
        const id = key.slice(2), old = d[key] && d[key].v;
        const admins = Object.keys(d).filter(x => x.startsWith('m:') && d[x].v && d[x].v.role === 'admin');
        if (!admins.length && id === by && v && v.role === 'admin') return true; // Gründung: erster Admin legt sich selbst an
        if (role === 'admin') return !(old && old.role === 'admin' && (!v || v.role !== 'admin') && admins.length <= 1); // letzter Admin bleibt
        if (id !== by) return false;                      // nur der eigene Eintrag
        if (old) return v ? v.role === old.role : true;   // Rolle nicht selbst änderbar; Austreten ist erlaubt
        if (!v) return false;
        const inv = d['i:' + v.inv] && d['i:' + v.inv].v; // Neuer Eintrag nur mit gültiger Einladung und deren Rolle
        return !!inv && !inv.revoked && inv.role === v.role;
      }
      if (!role || !KIND_RULES[k].includes(role)) return false;
      if (k === 'v') return key.split(':')[2] === by;     // nur eigene Stimme
      if (k === 's' && v === null && role !== 'admin') { const old = d[key] && d[key].v; return !old || old.by === by; } // Vorschlag löschen: Autor oder Admin
      return true;
    }
    F._allowed = allowed;

    // ───── Schreiben ─────
    /** Lokal schreiben (mit Rechteprüfung). v = null löscht. */
    F.set = (key, v) => {
      const c = cfg(); if (!c) throw new Error('Kein Familienplan aktiv.');
      const d = doc();
      if (!allowed(d, key, v, c.me.id)) throw new Error('Dafür fehlt dir die Berechtigung (' + (ROLES[F.role()] || 'unbekannt') + ').');
      const t = Math.max(now(), ((d[key] && d[key].t) || 0) + 1);
      d[key] = { v: v === undefined ? null : v, t, by: c.me.id }; saveDoc(d); return d[key];
    };

    // ───── Zusammenführen ─────
    /** Führt zwei Dokumente zusammen. Fremde Einträge werden nur übernommen, wenn der Autor sie schreiben durfte. */
    F.merge = function (local, remote) {
      const out = Object.assign({}, local); let changed = false, rejected = 0;
      // Mehrere Durchläufe: Rechte eines Autors ergeben sich erst, wenn sein Mitgliedseintrag übernommen ist
      let pending = Object.keys(remote || {}).filter(k => remote[k] && typeof remote[k].t === 'number');
      for (let pass = 0; pass < 4 && pending.length; pass++) {
        const next = [];
        for (const k of pending) {
          const r = remote[k], l = out[k];
          if (l && (l.t > r.t || (l.t === r.t && String(l.by) >= String(r.by)))) continue;
          if (!allowed(out, k, r.v === undefined ? null : r.v, r.by)) { next.push(k); continue; }
          out[k] = { v: r.v === undefined ? null : r.v, t: r.t, by: r.by }; changed = true;
        }
        if (next.length === pending.length) { rejected = next.length; pending = next; break; }
        pending = next; rejected = next.length;
      }
      return { doc: out, changed, rejected };
    };
    const toWire = d => { const o = {}; Object.keys(d).forEach(k => { o[enc(k)] = d[k]; }); return o; };
    const fromWire = o => { const d = {}; Object.keys(o || {}).forEach(k => { d[dec(k)] = o[k]; }); return d; };
    const urlOf = c => c.url + (c.token ? (c.url.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(c.token) : '');

    /** Abgleich mit dem gemeinsamen Dokument. Rückgabe: { pulled, pushed } oder wirft Error. */
    F.sync = async function () {
      const c = cfg(); if (!c) return { pulled: false, pushed: false };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { F.status = 'offline'; emit(); return { pulled: false, pushed: false, offline: true }; }
      F.status = 'läuft'; F.error = null; emit();
      try {
        const res = await doFetch(urlOf(c), { method: 'GET', cache: 'no-store' });
        if (!res.ok && res.status !== 404) throw new Error('Speicher antwortete mit ' + res.status + (res.status === 401 || res.status === 403 ? ' (Zugriff verweigert – Schlüssel prüfen)' : ''));
        let remote = null; if (res.ok) { const txt = await res.text(); remote = txt && txt !== 'null' ? JSON.parse(txt) : null; }
        const rd = remote && typeof remote === 'object' ? fromWire(remote) : {};
        const m = F.merge(doc(), rd);
        const pulled = m.changed; if (pulled) saveDoc(m.doc);
        // Nur geänderte Einträge hochladen (PATCH) – so überschreiben sich gleichzeitige Änderungen verschiedener Geräte nicht.
        // Unterstützt der Speicher kein PATCH, wird das zusammengeführte Dokument komplett geschrieben (PUT); fehlende Einträge heilen beim nächsten Abgleich.
        const merged = m.doc, diff = {};
        Object.keys(merged).forEach(k => { const r = rd[k]; if (!r || r.t !== merged[k].t || r.by !== merged[k].by) diff[k] = merged[k]; });
        let pushed = false;
        if (Object.keys(diff).length) {
          const head = { 'Content-Type': 'text/plain' };
          let ok = false, status = 0;
          if (remote) { try { const pr = await doFetch(urlOf(c), { method: 'PATCH', body: JSON.stringify(toWire(diff)), headers: head }); ok = pr.ok; status = pr.status; } catch (e) { ok = false; } }
          if (!ok) { const put = await doFetch(urlOf(c), { method: 'PUT', body: JSON.stringify(toWire(merged)), headers: head }); ok = put.ok; status = put.status; }
          if (!ok) throw new Error('Speichern fehlgeschlagen (' + status + (status === 401 || status === 403 ? ', Zugriff verweigert' : '') + ')');
          pushed = true;
        }
        // Wurde ich entfernt?
        const mine = merged['m:' + c.me.id]; if (mine && mine.v === null && mine.by !== c.me.id) F.removed = true; // ausdrücklich von einem Admin entfernt
        F.status = 'ok'; F.last = now(); store.set('famLast', F.last); emit();
        return { pulled, pushed, rejected: m.rejected };
      } catch (e) {
        F.status = 'fehler'; F.error = e.message || String(e); emit(); throw e;
      }
    };
    let timer = null;
    F.schedule = (cb) => { if (!F.active()) return; clearTimeout(timer); timer = setTimeout(() => F.sync().then(r => { if (r && r.pulled && cb) cb(); }).catch(() => { }), opts.delay == null ? 2000 : opts.delay); };

    // ───── Einrichten, Einladen, Beitreten ─────
    F.validUrl = u => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; } };
    F.create = async function (o) {
      const url = F.validUrl(o.url); if (!url) throw new Error('Bitte eine gültige HTTPS-Adresse des gemeinsamen Speichers eintragen.');
      if (!String(o.name || '').trim() || !String(o.myName || '').trim()) throw new Error('Familienname und dein Name werden benötigt.');
      const id = rid(), me = { id: rid(), name: o.myName.trim() };
      store.set('family', { id, name: o.name.trim(), url, token: (o.token || '').trim(), me }); saveDoc({});
      const d = doc(), t = now();
      d.meta = { v: { name: o.name.trim(), budget: o.budget || null, persons: o.persons || null }, t, by: me.id };
      d['m:' + me.id] = { v: { name: me.name, role: 'admin', diet: o.diet || null }, t, by: me.id };
      saveDoc(d);
      try { await F.sync(); } catch (e) { F.leave(); throw e; }
      return F.config();
    };
    /** Einladungscode für eine Rolle erzeugen (nur Admin). Enthält Adresse und Schlüssel – nur an Vertraute weitergeben. */
    F.invite = async function (role) {
      if (!F.can('invite')) throw new Error('Nur Admins können einladen.');
      if (!['member', 'guest', 'admin'].includes(role)) throw new Error('Unbekannte Rolle.');
      const c = cfg(), inv = rid(); F.set('i:' + inv, { role, by: c.me.id, at: now() });
      await F.sync(); // Einladung muss auf dem Server liegen, bevor jemand beitritt
      return b64e(JSON.stringify({ f: c.id, n: c.name, u: c.url, k: c.token, i: inv }));
    };
    F.decodeInvite = code => {
      try { const o = JSON.parse(b64d(String(code).trim().replace(/^.*[?&]join=/, ''))); if (!o.f || !o.u || !o.i || !F.validUrl(o.u)) throw 0; return { id: o.f, name: o.n || 'Familie', url: o.u, token: o.k || '', inv: o.i }; } catch (e) { throw new Error('Der Einladungscode ist ungültig.'); }
    };
    F.revokeInvite = inv => { const x = val('i:' + inv); if (x) F.set('i:' + inv, Object.assign({}, x, { revoked: true })); };
    F.join = async function (code, myName) {
      const o = F.decodeInvite(code); if (!String(myName || '').trim()) throw new Error('Bitte gib deinen Namen ein.');
      if (cfg()) throw new Error('Du bist schon in einem Familienplan. Verlasse ihn zuerst.');
      const me = { id: rid(), name: myName.trim() };
      store.set('family', { id: o.id, name: o.name, url: o.url, token: o.token, me }); saveDoc({});
      try {
        await F.sync(); // Dokument laden, um die Einladung zu prüfen
        const inv = val('i:' + o.inv); if (!inv || inv.revoked) throw new Error('Diese Einladung gilt nicht mehr.');
        // Der eigene Mitgliedseintrag wird mit dem Einladungs-Schlüssel erzeugt
        const d = doc(); d['m:' + me.id] = { v: { name: me.name, role: inv.role, inv: o.inv, diet: null }, t: now(), by: me.id }; saveDoc(d);
        await F.sync();
        const m = val('m:' + me.id); if (!m) throw new Error('Beitritt wurde nicht akzeptiert.');
        const meta = val('meta'); if (meta && meta.name) { const c = cfg(); c.name = meta.name; store.set('family', c); }
      } catch (e) { store.set('family', null); store.set('famdoc', {}); throw e; }
      return cfg();
    };
    F.leave = () => { store.set('family', null); store.set('famdoc', {}); F.status = 'aus'; F.removed = false; emit(); };
    F.removeMember = id => { const c = cfg(); if (id === c.me.id) { const x = val('m:' + id); if (x) F.set('m:' + id, null); return F.sync().catch(() => { }).then(F.leave); } F.set('m:' + id, null); };
    F.setRole = (id, role) => { const x = val('m:' + id); if (!x) throw new Error('Mitglied nicht gefunden.'); F.set('m:' + id, Object.assign({}, x, { role })); };
    F.setMyDiet = diet => { const c = cfg(), x = val('m:' + c.me.id); F.set('m:' + c.me.id, Object.assign({}, x, { diet })); };
    F.setMeta = patch => F.set('meta', Object.assign({}, val('meta') || {}, patch));

    // ───── Gemeinsame Einstellungen ─────
    /** Wirksame Einstellungen: Budget/Personen der Familie; Ernährung = Vereinigung aller Profile (jeder Ausschluss gilt für alle). */
    F.effective = function (base) {
      if (!F.active()) return base;
      const s = JSON.parse(JSON.stringify(base)), meta = val('meta') || {}, mem = F.members();
      if (meta.budget) s.budget = meta.budget;
      s.persons = meta.persons || Math.max(base.persons, 1);
      mem.forEach(m => {
        const d = m.diet; if (!d) return;
        ['laktose', 'fisch', 'pilze', 'kohl'].forEach(k => { if (d.intol && d.intol[k]) s.intol[k] = true; });
        if (d.allowSpicy === false) s.allowSpicy = false;
        (d.unwanted || []).forEach(w => { if (!(s.unwanted || []).some(x => x.toLowerCase() === String(w).toLowerCase())) (s.unwanted = s.unwanted || []).push(w); });
      });
      return s;
    };

    // ───── Plan, Einkaufsliste ─────
    F.putPlan = p => F.set('p:' + p.weekStart, { days: p.days, locked: p.locked || [], persons: p.persons, updatedAt: p.updatedAt || now() });
    F.plans = () => { const e = F.entries('p:'), o = {}; Object.keys(e).forEach(k => { o[k.slice(2)] = Object.assign({ weekStart: k.slice(2) }, e[k]); }); return o; };
    F.setChecked = (week, ing, on) => F.set('c:' + week + ':' + ing, on ? true : null);
    F.checked = week => { const e = F.entries('c:' + week + ':'), o = {}; Object.keys(e).forEach(k => { if (e[k]) o[k.slice(('c:' + week + ':').length)] = true; }); return o; };
    F.setExtras = (week, list) => F.set('x:' + week, list);
    F.extras = week => val('x:' + week) || [];

    // ───── Vorschläge und Abstimmung ─────
    F.propose = (recipeId, note) => { const c = cfg(), id = rid(); F.set('s:' + id, { recipe: recipeId, by: c.me.id, byName: c.me.name, note: note || '', at: now() }); return id; };
    F.vote = (pid, v) => { const c = cfg(); if (!val('s:' + pid)) throw new Error('Vorschlag nicht gefunden.'); F.set('v:' + pid + ':' + c.me.id, v === 'up' || v === 'down' ? v : null); };
    F.removeProposal = pid => { F.set('s:' + pid, null); Object.keys(F.entries('v:' + pid + ':')).forEach(k => { const c = cfg(); if (k.endsWith(':' + c.me.id)) F.set(k, null); }); };
    F.proposals = () => {
      const s = F.entries('s:'), v = F.entries('v:'), me = (cfg() || {}).me || {};
      return Object.keys(s).map(k => {
        const id = k.slice(2), votes = Object.keys(v).filter(x => x.startsWith('v:' + id + ':')).map(x => ({ member: x.split(':')[2], v: v[x] }));
        const up = votes.filter(x => x.v === 'up').length, down = votes.filter(x => x.v === 'down').length;
        return Object.assign({ id, up, down, score: up - down, mine: (votes.find(x => x.member === me.id) || {}).v || null }, s[k]);
      }).sort((a, b) => b.score - a.score || b.at - a.at);
    };
    return F;
  }

  const api = { makeFamily, ROLES, b64e, b64d };
  g.FamilyLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
