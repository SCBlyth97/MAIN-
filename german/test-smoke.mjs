/* Headless smoke test for the Deutsch flashcard app.
   Loads index.html + app.js in jsdom, mocks fetch(words.json) and
   localStorage, then drives the real UI to verify the whole flow. */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, f), 'utf8');

let pass = 0, fail = 0;
const ok  = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.error('  ✗ FAIL:', msg); } };

const html  = read('index.html');
const appJs = read('app.js');
const words = JSON.parse(read('words.json'));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://stanleyblyth.com/german/',
});
const { window } = dom;
const { document } = window;

// ---- environment shims ----
const consoleErrors = [];
window.console = { ...console, error: (...a) => { consoleErrors.push(a.join(' ')); }, warn: () => {} };

// jsdom provides a real localStorage when created with a url; just alias it.
const store = window.localStorage;

// fetch -> words.json
window.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => words,
  clone() { return this; },
});

// stub things app.js may touch
window.speechSynthesis = { cancel() {}, speak() {} };
window.SpeechSynthesisUtterance = function () {};
window.scrollTo = () => {};

// Simulate the real Supabase UMD bundle, which defines a GLOBAL `supabase`.
// This is what caused the production "stuck on Loading" crash: app.js's
// top-level `const supabase` collided with this global and threw a parse-time
// SyntaxError. Defining it here means the test exercises that exact condition.
window.supabase = {
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ upsert: async () => ({ error: null }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
};
window.SUPABASE_URL = 'https://example.supabase.co';
window.SUPABASE_ANON_KEY = 'test-anon-key';

const wait = ms => new Promise(r => setTimeout(r, ms));
const visible = el => el && !el.classList.contains('hidden');

(async () => {
  console.log('\n=== Deutsch smoke test ===\n');

  // 0) Static guard: app.js must NOT declare a top-level `const/let/var supabase`.
  // The Supabase UMD CDN bundle defines a global `supabase`; a colliding lexical
  // declaration throws a parse-time SyntaxError in real browsers (but NOT in
  // jsdom, where the global is a configurable property), so guard it at source.
  console.log('0) Source guard');
  ok(!/\b(?:const|let|var)\s+supabase\b/.test(appJs),
     'app.js does not redeclare the global `supabase` identifier');

  // Execute app.js (calls init() at the bottom). Append a test hook so the
  // harness can reach the module-scoped helpers without re-evaluating them.
  const hook = `
    ;window.__test = {
      reloadState: () => { state = loadState(); },
      renderGroupSelector, goBackToGroups, wordHtml
    };`;
  window.eval(appJs + hook);
  await wait(50); // let the async init() settle

  console.log('1) Boot / load');
  ok(consoleErrors.length === 0, 'no console errors during boot (' + (consoleErrors[0] || '') + ')');
  ok(!visible(document.getElementById('loadingScreen')), 'left the Loading screen');
  ok(!visible(document.getElementById('errorScreen')), 'did NOT fall to error screen');
  ok(visible(document.getElementById('groupScreen')), 'home/group screen is visible');

  console.log('2) Home screen content');
  const grid = document.getElementById('groupGrid');
  ok(grid.children.length > 0, `group cards rendered (${grid.children.length})`);
  const expectedGroups = new Set(words.map(w => w.group || 1)).size;
  ok(grid.children.length === expectedGroups, `card count matches group count (${expectedGroups})`);
  ok(document.getElementById('todayTarget').textContent !== '', 'Heute target populated');
  ok(visible(document.getElementById('bottomNav')), 'bottom nav visible on home');
  ok(document.getElementById('todayRing').querySelector('svg') !== null, 'today ring SVG rendered');

  console.log('3) Start a group session');
  grid.children[0].click();
  await wait(20);
  ok(visible(document.getElementById('cardScene')), 'card scene shown after picking a group');
  ok(!visible(document.getElementById('bottomNav')), 'bottom nav hidden during session');
  ok(visible(document.getElementById('backBtn')), 'Home button visible during session');
  const frontWord = document.getElementById('frontWord').textContent.trim();
  ok(frontWord.length > 0, `front word populated ("${frontWord}")`);
  ok(document.getElementById('frontPill').textContent.startsWith('['), 'gender chip looks like [DER]');

  console.log('4) Flip + answer a card (SRS write)');
  const card = document.getElementById('card');
  card.click(); // flip
  await wait(10);
  ok(card.classList.contains('flipped'), 'card flips to back');
  ok(document.getElementById('backEn').textContent.trim().length > 0, 'English translation shown on back');
  document.getElementById('btnRight').click(); // "Knew it"
  await wait(10);
  const saved = JSON.parse(store.getItem('deutsch_state_v1') || '{}');
  const progressCount = Object.keys(saved.progress || {}).length;
  ok(progressCount >= 1, `progress persisted to localStorage (${progressCount} word)`);

  console.log('5) Home button returns to lobby');
  document.getElementById('backBtn').click();
  await wait(20);
  ok(visible(document.getElementById('groupScreen')), 'back on home screen');
  ok(visible(document.getElementById('bottomNav')), 'bottom nav restored');

  console.log('6) Stats screen');
  document.getElementById('navErfolg').click();
  await wait(20);
  ok(visible(document.getElementById('statsScreen')), 'stats screen opens via Erfolg tab');
  ok(document.getElementById('statsGrid').children.length > 0, 'stats grid populated');
  document.getElementById('btnCloseStats').click();
  await wait(20);
  ok(visible(document.getElementById('groupScreen')), 'closing stats returns home');

  console.log('7) Settings sheet');
  document.getElementById('navProfil').click();
  await wait(20);
  ok(!document.getElementById('settingsSheet').classList.contains('hidden'), 'settings sheet opens via Profil tab');
  const before = document.getElementById('stepperVal').textContent;
  document.getElementById('stepperUp').click();
  ok(document.getElementById('stepperVal').textContent !== before, 'new-cards-per-day stepper works');
  document.getElementById('sheetCloseBtn').click();
  await wait(20);

  console.log('8) Weak-words wiring');
  // Force two wrong answers on one word so it becomes "weak", then re-render.
  const id = words[0].id;
  store.setItem('deutsch_state_v1', JSON.stringify({
    ...saved,
    progress: { [id]: { box: 1, due: Date.now(), seen: 3, correct: 0, wrong: 3, streak: 0, lastSeen: Date.now() } },
  }));
  window.__test.reloadState(); window.__test.renderGroupSelector();
  await wait(10);
  const weakBtn = document.getElementById('btnWeakHome');
  ok(!weakBtn.disabled, 'Quick Practice / weak button enabled when weak words exist');
  ok(/extra practice/.test(weakBtn.querySelector('.weak-sub').textContent), 'weak sub-label reflects count');
  weakBtn.click();
  await wait(20);
  ok(visible(document.getElementById('cardScene')), 'weak session starts and shows a card');

  console.log('9) Noun article colouring');
  window.__test.goBackToGroups();
  await wait(10);
  const sampleNoun = words.find(w => /^(der|die|das)\s/i.test(w.de));
  if (sampleNoun) {
    const out = window.__test.wordHtml(sampleNoun);
    ok(/color:#/.test(out), `article in "${sampleNoun.de}" is colour-wrapped`);
  } else {
    ok(true, 'no der/die/das nouns to colour (skipped)');
  }

  console.log('\n=== Result ===');
  console.log(`${pass} passed, ${fail} failed`);
  if (consoleErrors.length) {
    console.log('\nConsole errors captured:');
    consoleErrors.forEach(e => console.log('  -', e));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('Harness crashed:', err); process.exit(2); });
