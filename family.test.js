/* Tests Familienplan: zwei/drei simulierte Geräte, Mock-Speicher. node tests/family.test.js */
'use strict';
const { makeFamily } = require('../js/family.js');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const throwsA = async (f) => { try { await f(); return false; } catch (e) { return true; } };

const URL_ = 'https://demo-familie.firebasedatabase.app/fam1.json';
let server = null, calls = [], failMode = null, noPatch = false;
const fetchMock = async (u, o) => {
  o = o || {}; calls.push((o.method || 'GET') + ' ' + u);
  if (failMode) return { ok: false, status: failMode, text: async () => '' };
  if (!u.startsWith(URL_)) return { ok: false, status: 404, text: async () => '' };
  if (o.method === 'PUT') { if (o.headers && o.headers['Content-Type'] !== 'text/plain') throw new Error('Preflight!'); server = o.body; return { ok: true, status: 200, text: async () => o.body }; }
  if (o.method === 'PATCH') { if (noPatch) return { ok: false, status: 405, text: async () => '' }; server = JSON.stringify(Object.assign(JSON.parse(server || '{}'), JSON.parse(o.body))); return { ok: true, status: 200, text: async () => server }; }
  return { ok: true, status: 200, text: async () => (server === null ? 'null' : server) };
};
const mkStore = () => { const m = {}; return { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v === undefined ? null : v)); } }; };
let clock = 1700000000000; const now = () => ++clock;
const dev = () => makeFamily({ store: mkStore(), fetch: fetchMock, now });

(async () => {
  const A = dev(), B = dev(), C = dev();
  console.log('\nGründen und Einladen');
  ok(await throwsA(() => A.create({ name: 'Müller', url: 'http://unsicher.de/x', myName: 'Anna' })), 'HTTP-Adresse wird abgelehnt');
  ok(await throwsA(() => A.create({ name: '', url: URL_, myName: 'Anna' })), 'Name erforderlich');
  await A.create({ name: 'Familie Müller', url: URL_, myName: 'Anna', budget: 140, persons: 4 });
  ok(A.active() && A.role() === 'admin' && A.members().length === 1, 'Anna ist Admin');
  ok(server && JSON.parse(server).meta, 'Dokument liegt auf dem Server');
  ok(!calls.some(c => /Authorization/.test(c)), 'keine Preflight-Header');
  const codeM = await A.invite('member'), codeG = await A.invite('guest');
  ok(typeof codeM === 'string' && !/[+/=]/.test(codeM), 'Einladungscode URL-sicher');
  ok(A.decodeInvite(codeM).url === URL_, 'Code enthält Adresse');
  ok(await throwsA(async () => A.decodeInvite('kaputt')), 'ungültiger Code abgelehnt');
  await B.join(codeM, 'Ben'); await C.join('https://x.de/?join=' + codeG, 'Cleo');
  ok(B.role() === 'member' && C.role() === 'guest', 'Rollen aus Einladung');
  await A.sync(); ok(A.members().length === 3, 'Admin sieht alle 3 Mitglieder');
  ok(await throwsA(() => B.invite('member')), 'Mitglied darf nicht einladen');
  ok(await throwsA(() => B.join(codeM, 'Ben2')), 'schon in einer Familie');

  console.log('\nGemeinsamer Plan und Einkaufsliste');
  B.putPlan({ weekStart: '2026-11-16', days: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], persons: 4 }); await B.sync(); await A.sync();
  ok(A.plans()['2026-11-16'] && A.plans()['2026-11-16'].days[2] === 'c', 'Plan von Ben bei Anna');
  A.setChecked('2026-11-16', 'hack', true); await A.sync(); await B.sync();
  ok(B.checked('2026-11-16').hack === true, 'Haken synchron');
  B.setChecked('2026-11-16', 'hack', false); await B.sync(); await A.sync(); ok(!A.checked('2026-11-16').hack, 'Haken entfernt (Tombstone)');
  A.setExtras('2026-11-16', [{ name: 'Brot', done: false }]); await A.sync(); await C.sync().catch(() => { }); await B.sync();
  ok(B.extras('2026-11-16')[0].name === 'Brot', 'eigene Artikel synchron');
  ok(await throwsA(async () => C.putPlan({ weekStart: '2026-11-23', days: [], persons: 4 })), 'Gast darf Plan nicht ändern');
  ok(await throwsA(async () => C.setChecked('2026-11-16', 'hack', true)), 'Gast darf Liste nicht ändern');

  console.log('\nGleichzeitige Änderungen');
  A.putPlan({ weekStart: '2026-11-23', days: [1, 1, 1, 1, 1, 1, 1], persons: 4 }); B.setChecked('2026-11-16', 'reis', true);
  await A.sync(); await B.sync(); await A.sync();
  ok(A.checked('2026-11-16').reis && B.plans()['2026-11-23'], 'verschiedene Einträge gehen nicht verloren');
  A.putPlan({ weekStart: '2026-11-30', days: ['A'], persons: 4 }); B.putPlan({ weekStart: '2026-11-30', days: ['B'], persons: 4 });
  await A.sync(); await B.sync(); await A.sync(); ok(A.plans()['2026-11-30'].days[0] === 'B' && B.plans()['2026-11-30'].days[0] === 'B', 'gleicher Eintrag: letzte Änderung gewinnt, beide gleich');

  console.log('\nVorschläge und Abstimmung');
  const pid = B.propose('chili-mild', 'Mal wieder?'); await B.sync(); await A.sync(); await C.sync();
  ok(A.proposals().length === 1 && A.proposals()[0].byName === 'Ben', 'Vorschlag sichtbar');
  A.vote(pid, 'up'); C.vote(pid, 'up'); B.vote(pid, 'down');
  await A.sync(); await B.sync(); await C.sync(); await A.sync();
  let pr = A.proposals()[0]; ok(pr.up === 2 && pr.down === 1 && pr.score === 1 && pr.mine === 'up', 'Stimmen gezählt: ' + JSON.stringify([pr.up, pr.down]));
  ok(C.proposals()[0].mine === 'up', 'Gast darf abstimmen');
  C.vote(pid, null); await C.sync(); await A.sync(); ok(A.proposals()[0].up === 1, 'Stimme zurückgezogen');
  ok(await throwsA(async () => C.propose('x', '')), 'Gast darf nichts vorschlagen');
  ok(await throwsA(async () => A.set('v:' + pid + ':' + B.me().id, 'up')), 'fremde Stimme nicht fälschbar');
  ok(await throwsA(async () => C.set('s:' + pid, null)), 'Gast kann Vorschlag nicht löschen');
  A.removeProposal(pid); await A.sync(); await B.sync(); ok(B.proposals().length === 0, 'Admin löscht Vorschlag');

  console.log('\nRollen und Rechte');
  ok(await throwsA(async () => B.setRole(B.me().id, 'admin')), 'Mitglied macht sich nicht zum Admin');
  ok(await throwsA(async () => B.setMeta({ budget: 999 })), 'Mitglied ändert Budget nicht');
  A.setMeta({ budget: 150 }); await A.sync(); await B.sync(); ok(B.get('meta').budget === 150, 'Admin ändert Familienbudget');
  A.setRole(C.me().id, 'member'); await A.sync(); await C.sync(); ok(C.role() === 'member' && C.can('plan'), 'Admin befördert Gast zum Mitglied');
  A.setRole(C.me().id, 'guest'); await A.sync(); await C.sync(); ok(C.role() === 'guest', 'zurück zum Gast');
  ok(await throwsA(async () => A.setRole(A.me().id, 'member')), 'letzter Admin kann sich nicht degradieren');
  // Manipulation direkt am Speicher: Gast schreibt Plan / macht sich zum Admin
  const doc0 = JSON.parse(server), doc = { entries: doc0 }; const cid = C.me().id;
  doc.entries['p:2027-01-04'] = { v: { days: ['hack'], persons: 4 }, t: clock + 5, by: cid };
  doc.entries['m:' + cid] = { v: { name: 'Cleo', role: 'admin', inv: 'x', diet: null }, t: clock + 6, by: cid };
  server = JSON.stringify(doc.entries); await A.sync();
  ok(!A.plans()['2027-01-04'] && A.members().find(m => m.id === cid).role === 'guest', 'manipulierte Einträge werden beim Zusammenführen verworfen');
  // gefälschter Mitgliedseintrag ohne Einladung
  doc.entries['m:fremd'] = { v: { name: 'Eindringling', role: 'member', inv: 'nope' }, t: clock + 9, by: 'fremd' }; server = JSON.stringify(doc.entries); await A.sync();
  ok(!A.members().some(m => m.id === 'fremd'), 'Mitglied ohne gültige Einladung abgelehnt');
  // Einladung widerrufen
  const code2 = await A.invite('member'); const inv2 = A.decodeInvite(code2).inv; A.revokeInvite(inv2); await A.sync();
  const D2 = dev(); ok(await throwsA(() => D2.join(code2, 'Dora')) && !D2.active(), 'widerrufene Einladung funktioniert nicht, nichts bleibt zurück');
  // Entfernen
  A.removeMember(B.me().id); await A.sync(); await B.sync(); ok(B.role() === null && B.removed === true && !B.can('plan'), 'entferntes Mitglied hat keine Rechte');
  ok(await throwsA(async () => B.putPlan({ weekStart: '2027-02-01', days: [], persons: 4 })), 'entferntes Mitglied kann nicht schreiben');
  await C.leave(); ok(!C.active(), 'Austreten');

  console.log('\nErnährungsprofile');
  const base = { persons: 4, budget: 120, intol: { laktose: true, fisch: true, pilze: true, kohl: true }, allowSpicy: true, unwanted: ['Spinat'] };
  A.setMyDiet({ intol: { laktose: true }, allowSpicy: true, unwanted: ['Oliven'] });
  const eff = A.effective(base);
  ok(eff.budget === 150 && eff.persons === 4 && eff.unwanted.includes('Oliven') && eff.unwanted.includes('Spinat') && eff.intol.fisch && eff.intol.pilze && eff.intol.kohl && eff.intol.laktose, 'Familienbudget + vereinigte Ausschlüsse');
  ok(base.budget === 120 && base.unwanted.length === 1, 'Basis-Einstellungen nicht verändert');
  const F3 = dev(); ok(F3.effective(base) === base, 'ohne Familie: unverändert');

  console.log('\nFehler und Offline');
  failMode = 403; ok(await throwsA(() => A.sync()) && /Zugriff verweigert/.test(A.error), 'Zugriff verweigert verständlich: ' + A.error);
  failMode = 500; ok(await throwsA(() => A.sync()) && A.status === 'fehler', 'Serverfehler'); failMode = null;
  A.putPlan({ weekStart: '2027-03-01', days: ['offline'], persons: 4 }); ok(A.plans()['2027-03-01'], 'Offline-Änderung lokal gespeichert'); await A.sync(); ok(JSON.parse(server)['p:2027-03-01'], 'wird später hochgeladen');
  const before = server; calls.length = 0; await A.sync(); ok(server === before && !calls.some(c => c.startsWith('PUT')), 'unveränderter Stand: kein Schreibzugriff');
  const T = makeFamily({ store: mkStore(), fetch: fetchMock, now }); await T.create({ name: 'T', url: URL_ + '?x=1', token: 'geheim', myName: 'T' }).catch(() => { });
  ok(calls.some(c => /x=1&auth=geheim/.test(c)), 'Token als auth-Parameter angehängt');
  console.log('\nSpeicher ohne PATCH / Wettlauf');
  noPatch = true; A.putPlan({ weekStart: '2027-05-03', days: ['n'], persons: 4 }); await A.sync(); ok(JSON.parse(server)['p:2027-05-03'], 'Fallback PUT, wenn PATCH nicht unterstützt wird'); noPatch = false;
  // zwei Geräte laden gleichzeitig, beide schreiben: nichts geht verloren (PATCH)
  const X = dev(), Y = dev(); const cx = await A.invite('member'); const cy = await A.invite('member');
  await Promise.all([X.join(cx, 'Xaver'), Y.join(cy, 'Yvonne')]);
  await A.sync(); ok(A.members().some(m => m.name === 'Xaver') && A.members().some(m => m.name === 'Yvonne'), 'gleichzeitiger Beitritt zweier Geräte geht nicht verloren');
  await Promise.all([X.sync(), Y.sync(), A.sync()]); await Promise.all([X.sync(), Y.sync()]);
  ok(X.role() === 'member' && Y.role() === 'member' && !X.removed && !Y.removed, 'niemand gilt fälschlich als entfernt');
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
