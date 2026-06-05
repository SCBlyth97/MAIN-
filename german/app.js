/* ============================================================
   Deutsch — app.js
   Spaced-repetition German flashcard app
   Pure vanilla JS, no frameworks, no build step.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
// SUPABASE CONFIG
// ─────────────────────────────────────────────

const SUPABASE_URL = 'https://wnwwnkfbclrdgtmnhul.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IG_F4wtfW3G0U3o4yQ37HQ_IyRK6a3t';
const SUPABASE_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

let currentUser = null; // { username } once logged in
let syncTimer   = null;

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sbFetchUser(username) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&select=username,password_hash,progress`,
    { headers: SUPABASE_HEADERS }
  );
  if (!res.ok) throw new Error(`DB error ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function sbCreateUser(username, passwordHash) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ username, password_hash: passwordHash, progress: {} })
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes('duplicate') || body.includes('unique')) throw new Error('Username already taken.');
    throw new Error(`Could not create account (${res.status})`);
  }
}

async function sbSyncProgress(username, progress) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}`,
    {
      method: 'PATCH',
      headers: { ...SUPABASE_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ progress, updated_at: new Date().toISOString() })
    }
  );
  if (!res.ok) console.warn('Deutsch: sync failed', res.status);
}

function scheduleSyncProgress() {
  if (!currentUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    sbSyncProgress(currentUser.username, state.progress)
      .then(() => setSyncStatus('Synced'))
      .catch(() => setSyncStatus('Sync failed'));
  }, 2000);
  setSyncStatus('Saving…');
}

function setSyncStatus(msg) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = msg;
}

// ─────────────────────────────────────────────
// LOGIN UI
// ─────────────────────────────────────────────

function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('hidden');
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function wireLoginUI() {
  const tabs      = document.querySelectorAll('.login-tab');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const form      = document.getElementById('loginForm');
  const errorEl   = document.getElementById('loginError');
  let mode = 'login'; // 'login' | 'register'

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
      submitBtn.textContent = mode === 'login' ? 'Log In' : 'Create Account';
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('inputUsername').value.trim();
    const password = document.getElementById('inputPassword').value;

    errorEl.classList.add('hidden');
    if (!username || !password) {
      errorEl.textContent = 'Please enter a username and password.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (username.length < 2) {
      errorEl.textContent = 'Username must be at least 2 characters.';
      errorEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';

    try {
      const hash = await hashPassword(password);

      if (mode === 'login') {
        const user = await sbFetchUser(username);
        if (!user) throw new Error('Username not found.');
        if (user.password_hash !== hash) throw new Error('Incorrect password.');
        // Load cloud progress into state
        if (user.progress && typeof user.progress === 'object') {
          state.progress = user.progress;
          saveState();
        }
      } else {
        await sbCreateUser(username, hash);
      }

      currentUser = { username };
      localStorage.setItem('deutsch_user', username);
      updateAccountUI();
      hideLoginOverlay();
      buildSession();
      if (session.length === 0) {
        showEmptyScreen();
        updateProgressUI();
      } else {
        showNextCard();
        wireEvents();
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong.';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'Log In' : 'Create Account';
    }
  });
}

function updateAccountUI() {
  const el = document.getElementById('accountUsername');
  if (el && currentUser) el.textContent = currentUser.username;
}

function logout() {
  currentUser = null;
  localStorage.removeItem('deutsch_user');
  state = defaultState();
  saveState();
  location.reload();
}

// ─────────────────────────────────────────────
// PLACEHOLDER DATA
// These 8 words are used ONLY when words.json
// cannot be fetched (offline / not yet provided).
// Replace words.json with the real dataset; this
// fallback keeps the app functional during dev.
// ─────────────────────────────────────────────
const FALLBACK_WORDS = [
  {
    id: 'gehen', group: 1, type: 'verb',
    de: 'gehen', en: 'to go',
    forms: 'geht · ging · ist gegangen',
    example: 'Ich gehe nach Hause.',
    exampleEn: "I'm going home."
  },
  {
    id: 'hund', group: 1, type: 'der',
    de: 'der Hund', en: 'dog',
    forms: 'die Hunde',
    example: 'Der Hund schläft.',
    exampleEn: 'The dog is sleeping.'
  },
  {
    id: 'frau', group: 1, type: 'die',
    de: 'die Frau', en: 'woman / wife',
    forms: 'die Frauen',
    example: 'Die Frau liest ein Buch.',
    exampleEn: 'The woman is reading a book.'
  },
  {
    id: 'kind', group: 1, type: 'das',
    de: 'das Kind', en: 'child',
    forms: 'die Kinder',
    example: 'Das Kind spielt im Garten.',
    exampleEn: 'The child is playing in the garden.'
  },
  {
    id: 'essen', group: 2, type: 'verb',
    de: 'essen', en: 'to eat',
    forms: 'isst · aß · hat gegessen',
    example: 'Wir essen zusammen.',
    exampleEn: 'We are eating together.'
  },
  {
    id: 'wasser', group: 2, type: 'das',
    de: 'das Wasser', en: 'water',
    forms: 'die Wasser (rarely used)',
    example: 'Ich trinke Wasser.',
    exampleEn: 'I am drinking water.'
  },
  {
    id: 'sprechen', group: 2, type: 'verb',
    de: 'sprechen', en: 'to speak',
    forms: 'spricht · sprach · hat gesprochen',
    example: 'Er spricht Deutsch.',
    exampleEn: 'He speaks German.'
  },
  {
    id: 'stadt', group: 2, type: 'die',
    de: 'die Stadt', en: 'city / town',
    forms: 'die Städte',
    example: 'Berlin ist eine große Stadt.',
    exampleEn: 'Berlin is a big city.'
  }
];

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const STORAGE_KEY = 'deutsch_state_v1';

// Leitner box intervals in days
const BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 9, 5: 21 };

// Type → accent colour
const TYPE_COLOUR = {
  der:  '#6aa0ff',
  die:  '#f0697f',
  das:  '#57c08a',
  verb: '#b39bf2'
};

// Type → gender reminder text (for nouns on back face)
const GENDER_LABEL = {
  der: '♂ masculine (der)',
  die: '♀ feminine (die)',
  das: '⬡ neuter (das)'
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let allWords   = [];   // full word list loaded from words.json
let state      = {};   // persisted state (progress, settings, newDay)
let session    = [];   // current session queue (word objects)
let sessionIdx = 0;    // pointer into session
let currentWord = null;
let isFlipped  = false;

// ─────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  // Screens
  loadingScreen: $('loadingScreen'),
  errorScreen:   $('errorScreen'),
  errorDetail:   $('errorDetail'),
  cardScene:     $('cardScene'),
  doneScreen:    $('doneScreen'),
  doneStats:     $('doneStats'),
  emptyScreen:   $('emptyScreen'),
  emptyStats:    $('emptyStats'),

  // Progress strip
  statLearned:   $('statLearned'),
  statTotal:     $('statTotal'),
  statQueue:     $('statQueue'),
  progressFill:  $('progressFill'),

  // Card elements
  card:          $('card'),
  frontBar:      $('frontBar'),
  frontPill:     $('frontPill'),
  frontWord:     $('frontWord'),
  listenBtn:     $('listenBtn'),
  backBar:       $('backBar'),
  backPill:      $('backPill'),
  backWord:      $('backWord'),
  backForms:     $('backForms'),
  backEn:        $('backEn'),
  backExDe:      $('backExDe'),
  backExEn:      $('backExEn'),
  genderNote:    $('genderNote'),
  btnWrong:      $('btnWrong'),
  btnRight:      $('btnRight'),

  // Done/empty
  btnMore:       $('btnMore'),
  btnRestart:    $('btnRestart'),

  // Settings
  settingsBtn:   $('settingsBtn'),
  sheetBackdrop: $('sheetBackdrop'),
  settingsSheet: $('settingsSheet'),
  sheetCloseBtn: $('sheetCloseBtn'),
  stepperDown:   $('stepperDown'),
  stepperUp:     $('stepperUp'),
  stepperVal:    $('stepperVal'),
  resetBtn:      $('resetBtn'),
  resetConfirm:  $('resetConfirm'),
  resetCancelBtn:$('resetCancelBtn'),
  resetConfirmBtn:$('resetConfirmBtn')
};

// ─────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────

function defaultState() {
  return {
    progress: {},          // { [id]: { box: 1..5, due: timestamp } }
    settings: { newPerDay: 20 },
    newDay:   { date: '', count: 0 }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Merge defaults to handle missing keys gracefully
    const s = defaultState();
    if (parsed.progress && typeof parsed.progress === 'object') s.progress = parsed.progress;
    if (parsed.settings && typeof parsed.settings.newPerDay === 'number') {
      s.settings.newPerDay = Math.max(1, Math.min(200, parsed.settings.newPerDay));
    }
    if (parsed.newDay && parsed.newDay.date) s.newDay = parsed.newDay;
    return s;
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('Deutsch: could not save state to localStorage');
  }
  scheduleSyncProgress();
}

// ─────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function daysFromNow(days) {
  return Date.now() + days * 86400000;
}

// ─────────────────────────────────────────────
// SESSION BUILDING
// ─────────────────────────────────────────────

/**
 * Build the session queue for this run.
 * = due words (shuffled) + today's new words (in group/order)
 *
 * @param {boolean} forceMore  If true, introduce one extra batch of new cards
 *                             beyond the daily cap (used by "Pull in more" button).
 */
function buildSession(forceMore = false) {
  const today = todayStr();
  const progress = state.progress;

  // Reset daily new-card counter when the date has changed
  if (state.newDay.date !== today) {
    state.newDay = { date: today, count: 0 };
  }

  const dueWords = [];
  const seenIds  = new Set(Object.keys(progress));

  // 1. Collect words that are due for review
  for (const word of allWords) {
    const p = progress[word.id];
    if (p && p.due <= Date.now()) {
      dueWords.push(word);
    }
  }

  // 2. Shuffle due words
  shuffle(dueWords);

  // 3. Collect new words (not yet seen), sorted by group then original order
  const newWords = allWords
    .filter(w => !seenIds.has(w.id))
    .sort((a, b) => (a.group || 99) - (b.group || 99));

  const cap = state.settings.newPerDay;
  const alreadyNew = state.newDay.count;
  const canIntroduce = forceMore
    ? Math.min(cap, newWords.length)  // allow a fresh batch
    : Math.max(0, cap - alreadyNew);

  const todaysNew = newWords.slice(0, canIntroduce);

  if (forceMore) {
    state.newDay.count = 0; // reset so the batch counts fresh
  }

  // 4. Interleave: due words first, then new cards interspersed every ~5
  session = interleave(dueWords, todaysNew);
  sessionIdx = 0;
}

/** Fisher-Yates shuffle (in-place, returns array) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Interleave new cards into due cards approximately every 5 slots.
 * If there are no due cards, just return new cards in order.
 */
function interleave(due, newCards) {
  if (!due.length) return [...newCards];
  if (!newCards.length) return [...due];

  const result = [];
  let ni = 0;
  for (let i = 0; i < due.length; i++) {
    result.push(due[i]);
    if ((i + 1) % 5 === 0 && ni < newCards.length) {
      result.push(newCards[ni++]);
    }
  }
  // Append any remaining new cards at the end
  while (ni < newCards.length) result.push(newCards[ni++]);
  return result;
}

// ─────────────────────────────────────────────
// PROGRESS HELPERS
// ─────────────────────────────────────────────

function getStats() {
  const total   = allWords.length;
  const learned = allWords.filter(w => {
    const p = state.progress[w.id];
    return p && p.box >= 3;
  }).length;
  const seen = Object.keys(state.progress).length;
  return { total, learned, seen };
}

function updateProgressUI() {
  const { total, learned } = getStats();
  const left = session.length - sessionIdx;

  dom.statLearned.textContent = learned;
  dom.statTotal.textContent   = total;
  dom.statQueue.textContent   = Math.max(0, left);

  const pct = total > 0 ? (learned / total) * 100 : 0;
  dom.progressFill.style.width = pct.toFixed(1) + '%';
}

// ─────────────────────────────────────────────
// CARD RENDERING
// ─────────────────────────────────────────────

function applyTypeStyle(bar, pill, type) {
  const colour = TYPE_COLOUR[type] || TYPE_COLOUR.verb;
  bar.style.background  = colour;
  pill.style.background = colour;
  pill.textContent      = type;
}

function showCard(word) {
  currentWord = word;
  isFlipped = false;
  dom.card.classList.remove('flipped');

  const colour = TYPE_COLOUR[word.type] || TYPE_COLOUR.verb;

  // ── Front ──
  applyTypeStyle(dom.frontBar, dom.frontPill, word.type);
  dom.frontWord.textContent = word.de;

  // ── Back ──
  applyTypeStyle(dom.backBar, dom.backPill, word.type);
  dom.backWord.textContent  = word.de;
  dom.backForms.textContent = word.forms || '';
  dom.backEn.textContent    = word.en;
  dom.backExDe.textContent  = word.example   || '';
  dom.backExEn.textContent  = word.exampleEn || '';

  // Gender reminder for nouns
  const gLabel = GENDER_LABEL[word.type];
  if (gLabel) {
    dom.genderNote.textContent = gLabel;
    dom.genderNote.classList.remove('hidden');
  } else {
    dom.genderNote.classList.add('hidden');
  }
}

function flipCard() {
  if (!currentWord) return;
  isFlipped = !isFlipped;
  dom.card.classList.toggle('flipped', isFlipped);
}

// ─────────────────────────────────────────────
// SESSION NAVIGATION
// ─────────────────────────────────────────────

function showNextCard() {
  if (sessionIdx >= session.length) {
    showDoneScreen();
    return;
  }
  showScreen('card');
  showCard(session[sessionIdx]);
  updateProgressUI();
}

function showScreen(which) {
  // Hide all
  dom.loadingScreen.classList.add('hidden');
  dom.errorScreen.classList.add('hidden');
  dom.cardScene.classList.add('hidden');
  dom.doneScreen.classList.add('hidden');
  dom.emptyScreen.classList.add('hidden');

  if (which === 'loading') dom.loadingScreen.classList.remove('hidden');
  if (which === 'error')   dom.errorScreen.classList.remove('hidden');
  if (which === 'card')    dom.cardScene.classList.remove('hidden');
  if (which === 'done')    dom.doneScreen.classList.remove('hidden');
  if (which === 'empty')   dom.emptyScreen.classList.remove('hidden');
}

function showDoneScreen() {
  const { total, learned, seen } = getStats();
  dom.doneStats.innerHTML =
    `<p><strong>${seen}</strong> words seen</p>` +
    `<p><strong>${learned}</strong> words learned (box ≥ 3)</p>` +
    `<p><strong>${total}</strong> words in total</p>`;
  showScreen('done');
  updateProgressUI();
}

function showEmptyScreen() {
  const { total, learned, seen } = getStats();
  dom.emptyStats.innerHTML =
    `<p><strong>${seen}</strong> words seen</p>` +
    `<p><strong>${learned}</strong> words learned (box ≥ 3)</p>` +
    `<p><strong>${total}</strong> total words</p>`;
  showScreen('empty');
}

// ─────────────────────────────────────────────
// ANSWER HANDLING
// ─────────────────────────────────────────────

function answer(knew) {
  if (!currentWord) return;
  const id = currentWord.id;
  let p = state.progress[id];

  if (!p) {
    // First time seeing this card — initialise
    p = { box: 1, due: 0 };
    // Count toward today's new card quota
    state.newDay.count++;
  }

  if (knew) {
    // Move up one box (max 5)
    p.box = Math.min(5, p.box + 1);
    p.due = daysFromNow(BOX_INTERVALS[p.box]);
  } else {
    // Reset to box 1
    p.box = 1;
    p.due = daysFromNow(1);
    // Re-queue at the back of the current session so it reappears this session
    session.push(currentWord);
  }

  state.progress[id] = p;
  saveState();

  sessionIdx++;
  showNextCard();
}

// ─────────────────────────────────────────────
// SPEECH (Web Speech API)
// ─────────────────────────────────────────────

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'de-DE';
  utt.rate = 0.9;
  window.speechSynthesis.speak(utt);
}

// ─────────────────────────────────────────────
// SETTINGS SHEET
// ─────────────────────────────────────────────

function openSettings() {
  dom.stepperVal.textContent = state.settings.newPerDay;
  dom.resetConfirm.classList.add('hidden');

  dom.sheetBackdrop.classList.remove('hidden');
  // Force reflow so the transition fires
  dom.sheetBackdrop.offsetHeight;
  dom.sheetBackdrop.classList.add('visible');

  dom.settingsSheet.classList.remove('hidden');
  dom.settingsSheet.offsetHeight;
  dom.settingsSheet.classList.add('visible');
}

function closeSettings() {
  dom.sheetBackdrop.classList.remove('visible');
  dom.settingsSheet.classList.remove('visible');

  // Wait for transition then hide from DOM flow
  setTimeout(() => {
    dom.sheetBackdrop.classList.add('hidden');
    dom.settingsSheet.classList.add('hidden');
  }, 320);
}

function changeNewPerDay(delta) {
  const val = Math.max(1, Math.min(200, state.settings.newPerDay + delta));
  state.settings.newPerDay = val;
  dom.stepperVal.textContent = val;
  saveState();
}

// ─────────────────────────────────────────────
// INITIALISE
// ─────────────────────────────────────────────

async function init() {
  showScreen('loading');
  state = loadState();

  // Load words — try words.json first, fall back to hardcoded placeholder
  try {
    const res = await fetch('./words.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Empty or invalid words.json');
    allWords = data;
  } catch (err) {
    console.warn('Deutsch: could not load words.json, using fallback data.', err);
    allWords = FALLBACK_WORDS;
  }

  // Check for saved session
  const savedUser = localStorage.getItem('deutsch_user');
  if (savedUser) {
    // Re-verify user still exists and pull latest progress
    try {
      const user = await sbFetchUser(savedUser);
      if (user) {
        currentUser = { username: savedUser };
        if (user.progress && typeof user.progress === 'object' && Object.keys(user.progress).length > 0) {
          state.progress = user.progress;
          saveState();
        }
        updateAccountUI();
      } else {
        localStorage.removeItem('deutsch_user');
      }
    } catch {
      // Offline — continue with local state
      currentUser = { username: savedUser };
      updateAccountUI();
    }
  }

  wireLoginUI();

  if (!currentUser) {
    showScreen('loading'); // keep loading hidden behind overlay
    showLoginOverlay();
    return;
  }

  buildSession();

  if (session.length === 0) {
    showEmptyScreen();
    updateProgressUI();
  } else {
    showNextCard();
  }
  wireEvents();
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

function wireEvents() {
  // ── Card flip (click or keyboard Enter/Space) ──
  dom.card.addEventListener('click', e => {
    // Don't flip when pressing answer buttons
    if (e.target === dom.btnWrong || e.target === dom.btnRight) return;
    // Don't flip from the listen button
    if (e.target === dom.listenBtn || dom.listenBtn.contains(e.target)) return;
    flipCard();
  });

  dom.card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flipCard();
    }
  });

  // ── Listen button — speak German aloud ──
  dom.listenBtn.addEventListener('click', e => {
    e.stopPropagation(); // prevent card flip
    if (currentWord) speak(currentWord.de);
  });

  // ── Answer buttons ──
  dom.btnWrong.addEventListener('click', e => { e.stopPropagation(); answer(false); });
  dom.btnRight.addEventListener('click', e => { e.stopPropagation(); answer(true);  });

  // ── Done screen ──
  dom.btnMore.addEventListener('click', () => {
    buildSession(true); // force more new cards
    if (session.length === 0) {
      showEmptyScreen();
      updateProgressUI();
    } else {
      showNextCard();
    }
  });

  dom.btnRestart.addEventListener('click', () => {
    buildSession();
    if (session.length === 0) {
      showEmptyScreen();
    } else {
      showNextCard();
    }
  });

  // ── Account ──
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) accountBtn.addEventListener('click', openSettings);

  // ── Settings ──
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.sheetBackdrop.addEventListener('click', closeSettings);
  dom.sheetCloseBtn.addEventListener('click', closeSettings);

  dom.stepperDown.addEventListener('click', () => changeNewPerDay(-1));
  dom.stepperUp.addEventListener('click',   () => changeNewPerDay(+1));

  // ── Reset ──
  dom.resetBtn.addEventListener('click', () => {
    dom.resetConfirm.classList.remove('hidden');
  });
  dom.resetCancelBtn.addEventListener('click', () => {
    dom.resetConfirm.classList.add('hidden');
  });
  dom.resetConfirmBtn.addEventListener('click', () => {
    state = defaultState();
    saveState();
    closeSettings();
    buildSession();
    if (session.length === 0) {
      showEmptyScreen();
      updateProgressUI();
    } else {
      showNextCard();
    }
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    // Only when card is visible and flipped (back showing)
    if (!isFlipped) return;
    if (e.key === 'ArrowLeft'  || e.key === '1') answer(false);
    if (e.key === 'ArrowRight' || e.key === '2') answer(true);
  });
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
init();
