/* ============================================================
   Deutsch — app.js
   Spaced-repetition German flashcard app
   Pure vanilla JS, no frameworks, no build step.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const STORAGE_KEY    = 'deutsch_state_v1';
const SCHEMA_VERSION = 2;  // bump this whenever the persisted state shape changes

const BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 9, 5: 21 };

const TYPE_COLOUR = {
  der:  '#6aa0ff',
  die:  '#f0697f',
  das:  '#57c08a',
  verb: '#b39bf2'
};

const GENDER_LABEL = {
  der: '♂ masculine (der)',
  die: '♀ feminine (die)',
  das: '⬡ neuter (das)'
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let allWords     = [];   // full word list loaded from words.json
let sessionWords = [];   // words for the current group or weak session
let currentGroup = null; // active group number; null = on selector; '__weak__' = weak session
let state        = {};   // all persisted user data — read/write via loadState()/saveState() only
let session      = [];   // ordered card queue for the current session
let sessionIdx   = 0;    // index of the next card to show
let currentWord  = null; // the word currently on screen
let isFlipped    = false;
let isWeakMode   = false; // true while running a weak-words session

// Drill state (gender drill only — separate from main session)
let drillWords = [];
let drillIdx   = 0;
let drillRight = 0;
let drillWrong = 0;

// ─────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────

// Shorthand so we don't write document.getElementById everywhere
const $ = id => document.getElementById(id);

const dom = {
  // Screens
  groupScreen:   $('groupScreen'),
  groupGrid:     $('groupGrid'),
  loadingScreen: $('loadingScreen'),
  errorScreen:   $('errorScreen'),
  errorDetail:   $('errorDetail'),
  cardScene:     $('cardScene'),
  doneScreen:    $('doneScreen'),
  doneStats:     $('doneStats'),
  emptyScreen:   $('emptyScreen'),
  emptyStats:    $('emptyStats'),
  statsScreen:   $('statsScreen'),   // new stats screen
  statsGrid:     $('statsGrid'),     // grid inside the stats screen

  // Header
  backBtn:       $('backBtn'),
  progressStrip: $('progressStrip'),
  statsBtn:      $('statsBtn'),      // 📊 button in the header

  // Progress strip numbers and bar
  statLearned:   $('statLearned'),
  statTotal:     $('statTotal'),
  statQueue:     $('statQueue'),
  progressFill:  $('progressFill'),

  // Flashcard faces
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

  // Gender drill
  drillScreen:      $('drillScreen'),
  drillActive:      $('drillActive'),
  drillResults:     $('drillResults'),
  drillProgress:    $('drillProgress'),
  drillScore:       $('drillScore'),
  drillNoun:        $('drillNoun'),
  drillEn:          $('drillEn'),
  drillFeedback:    $('drillFeedback'),
  drillBtnDer:      $('drillBtnDer'),
  drillBtnDie:      $('drillBtnDie'),
  drillBtnDas:      $('drillBtnDas'),
  drillResultIcon:  $('drillResultIcon'),
  drillResultTitle: $('drillResultTitle'),
  drillResultSub:   $('drillResultSub'),
  btnDrillAgain:    $('btnDrillAgain'),
  btnBackFromDrill: $('btnBackFromDrill'),

  // Done / empty screen buttons
  btnMore:          $('btnMore'),
  btnRestart:       $('btnRestart'),
  btnStudyAgain:    $('btnStudyAgain'),
  btnBackFromDone:  $('btnBackFromDone'),
  btnBackFromEmpty: $('btnBackFromEmpty'),
  btnCloseStats:    $('btnCloseStats'),

  // Weak-words entry buttons (one on home screen, one on done screen)
  btnWeakHome:    $('btnWeakHome'),
  btnWeakDone:    $('btnWeakDone'),

  // Settings sheet
  settingsBtn:     $('settingsBtn'),
  sheetBackdrop:   $('sheetBackdrop'),
  settingsSheet:   $('settingsSheet'),
  sheetCloseBtn:   $('sheetCloseBtn'),
  stepperDown:     $('stepperDown'),
  stepperUp:       $('stepperUp'),
  stepperVal:      $('stepperVal'),
  resetBtn:        $('resetBtn'),
  resetConfirm:    $('resetConfirm'),
  resetCancelBtn:  $('resetCancelBtn'),
  resetConfirmBtn: $('resetConfirmBtn')
};

// ─────────────────────────────────────────────
// STORAGE HELPERS  (Step 1)
//
// ALL reads and writes of user state go through loadState() and saveState().
// No other part of the app should call localStorage directly.
// These two functions are the seam for future Supabase cloud sync —
// see the comment blocks inside each function.
// ─────────────────────────────────────────────

function defaultState() {
  // The canonical empty state. Every field the app might read must have a safe default here.
  return {
    schemaVersion: SCHEMA_VERSION,
    lastModified:  null,   // ISO timestamp — set by saveState() on every write
    progress:      {},     // keyed by word id: { box, due, seen, correct, wrong, streak, lastSeen }
    settings:      { newPerDay: 20 },
    newDay:        { date: '', count: 0 },
    lastStudyDate: null,   // which calendar day the user last answered a card (Step 5)
    dayStreak:     0       // consecutive study days (Step 5)
  };
}

function loadState() {
  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SUPABASE SYNC HOOK — wire cloud sync here, nowhere else     ║
  // ║                                                              ║
  // ║  When Supabase is added:                                     ║
  // ║  1. After reading localStorage, also fetch the row from      ║
  // ║     supabase.from('user_progress').select().single()         ║
  // ║  2. Compare cloud.lastModified vs local.lastModified.        ║
  // ║  3. Return whichever is newer (last-write-wins).             ║
  // ║  4. If cloud row is null (first login), migrate the local    ║
  // ║     state to the cloud by calling saveState() once.          ║
  // ║                                                              ║
  // ║  The rest of the app reads state ONLY through this function, ║
  // ║  so no other code needs to change.                           ║
  // ╚══════════════════════════════════════════════════════════════╝
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const s = defaultState();

    // Restore each field defensively, falling back to defaults when data is missing or wrong type
    if (parsed.progress && typeof parsed.progress === 'object')           s.progress      = parsed.progress;
    if (parsed.settings && typeof parsed.settings.newPerDay === 'number') {
      s.settings.newPerDay = Math.max(1, Math.min(200, parsed.settings.newPerDay));
    }
    if (parsed.newDay     && parsed.newDay.date)          s.newDay        = parsed.newDay;
    if (typeof parsed.dayStreak     === 'number')         s.dayStreak     = parsed.dayStreak;
    if (typeof parsed.lastStudyDate === 'string')         s.lastStudyDate = parsed.lastStudyDate;
    if (typeof parsed.lastModified  === 'string')         s.lastModified  = parsed.lastModified;

    // ── Schema migration: v1 → v2 ──────────────────────────────────
    // v1 stored only { box, due } per word.
    // v2 adds tracking fields: seen, correct, wrong, streak, lastSeen.
    // We only add missing fields — existing box and due values are left untouched.
    const version = parsed.schemaVersion || 1;
    if (version < 2) {
      Object.values(s.progress).forEach(p => {
        if (p.seen     === undefined) p.seen     = 0;
        if (p.correct  === undefined) p.correct  = 0;
        if (p.wrong    === undefined) p.wrong    = 0;
        if (p.streak   === undefined) p.streak   = 0;
        if (p.lastSeen === undefined) p.lastSeen = null;
      });
      // s.schemaVersion is already SCHEMA_VERSION (2) from defaultState().
      // The migrated data will be persisted on the next saveState() call.
    }

    return s;
  } catch {
    return defaultState();
  }
}

function saveState() {
  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SUPABASE SYNC HOOK — wire cloud sync here, nowhere else     ║
  // ║                                                              ║
  // ║  When Supabase is added, after localStorage.setItem add:     ║
  // ║    if (currentUser) {                                        ║
  // ║      supabase.from('user_progress').upsert({                 ║
  // ║        user_id:    currentUser.id,                           ║
  // ║        state:      state,                                    ║
  // ║        updated_at: state.lastModified                        ║
  // ║      }).then();  // fire-and-forget; errors are non-fatal    ║
  // ║    }                                                         ║
  // ║                                                              ║
  // ║  The rest of the app writes state ONLY through this          ║
  // ║  function, so only this function needs to change.            ║
  // ╚══════════════════════════════════════════════════════════════╝
  try {
    state.schemaVersion = SCHEMA_VERSION;
    state.lastModified  = new Date().toISOString(); // stamp every save for sync reconciliation
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('Deutsch: could not save state to localStorage');
  }
}

// ─────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10); // e.g. "2026-06-13"
}

function daysFromNow(days) {
  return Date.now() + days * 86400000; // convert days to milliseconds
}

// ─────────────────────────────────────────────
// DAILY STUDY STREAK  (Step 5)
// ─────────────────────────────────────────────

// Call this on every answer. It only does real work once per calendar day —
// if lastStudyDate is already today it returns immediately (cheap no-op).
function updateDayStreak() {
  const today = todayStr();
  if (state.lastStudyDate === today) return; // already recorded activity for today

  // Calculate yesterday's date string to check for a consecutive day
  const prev = new Date();
  prev.setDate(prev.getDate() - 1);
  const yesterday = prev.toISOString().slice(0, 10);

  if (state.lastStudyDate === yesterday) {
    // Studied yesterday → extend the streak
    state.dayStreak = (state.dayStreak || 0) + 1;
  } else {
    // Gap of two or more days (or first-ever session) → reset to 1
    state.dayStreak = 1;
  }
  state.lastStudyDate = today;
  // Note: saveState() is called immediately after this by answer(), so no save needed here.
}

// ─────────────────────────────────────────────
// GROUP SELECTOR
// ─────────────────────────────────────────────

function getGroupNums() {
  const nums = [...new Set(allWords.map(w => w.group || 1))].sort((a, b) => a - b);
  return nums;
}

function getGroupStats(groupNum) {
  const words   = allWords.filter(w => (w.group || 1) === groupNum);
  const total   = words.length;
  const learned = words.filter(w => {
    const p = state.progress[w.id];
    return p && p.box >= 3;
  }).length;
  const seen = words.filter(w => state.progress[w.id]).length;
  return { total, learned, seen };
}

function renderGroupSelector() {
  const groupNums = getGroupNums();
  dom.groupGrid.innerHTML = '';

  groupNums.forEach(num => {
    const { total, learned, seen } = getGroupStats(num);
    const firstIdx = allWords.findIndex(w => (w.group || 1) === num);
    const lastIdx  = firstIdx + total - 1;
    const range    = `Words ${firstIdx + 1}–${lastIdx + 1}`;

    let statusClass = 'gcard-status-new';
    let statusText  = 'Not started';
    if (learned === total) {
      statusClass = 'gcard-status-done';
      statusText  = '✓ Complete';
    } else if (seen > 0) {
      const pct = Math.round((learned / total) * 100);
      statusClass = 'gcard-status-progress';
      statusText  = `${pct}% learned`;
    }

    const card = document.createElement('button');
    card.className = 'group-card';
    card.innerHTML = `
      <span class="gcard-num">Group ${num}</span>
      <span class="gcard-range">${range}</span>
      <span class="gcard-status ${statusClass}">${statusText}</span>
    `;
    card.addEventListener('click', () => openGroup(num));
    dom.groupGrid.appendChild(card);
  });

  dom.backBtn.classList.add('hidden');
  dom.progressStrip.classList.add('hidden');
  updateWeakButtons(); // refresh the count shown on the weak-words button
  showScreen('groups');
}

function openGroup(num) {
  currentGroup = num;
  sessionWords = allWords.filter(w => (w.group || 1) === num);
  isWeakMode   = false;

  dom.backBtn.classList.remove('hidden');
  dom.progressStrip.classList.remove('hidden');

  buildSession();

  if (session.length === 0) {
    showEmptyScreen();
    updateProgressUI();
  } else {
    showNextCard();
  }
}

function goBackToGroups() {
  currentGroup = null;
  sessionWords = [];
  session      = [];
  sessionIdx   = 0;
  currentWord  = null;
  isFlipped    = false;
  isWeakMode   = false; // clear the weak-mode flag
  renderGroupSelector();
}

// ─────────────────────────────────────────────
// SESSION BUILDING
// ─────────────────────────────────────────────

function buildSession(forceMore = false) {
  const today    = todayStr();
  const progress = state.progress;

  if (state.newDay.date !== today) {
    state.newDay = { date: today, count: 0 };
  }

  const dueWords = [];
  const seenIds  = new Set(Object.keys(progress));

  for (const word of sessionWords) {
    const p = progress[word.id];
    if (p && p.due <= Date.now()) dueWords.push(word);
  }

  shuffle(dueWords);

  const newWords = sessionWords
    .filter(w => !seenIds.has(w.id))
    .sort((a, b) => (a.group || 99) - (b.group || 99));

  const cap          = state.settings.newPerDay;
  const alreadyNew   = state.newDay.count;
  const canIntroduce = forceMore
    ? Math.min(cap, newWords.length)
    : Math.max(0, cap - alreadyNew);

  const todaysNew = newWords.slice(0, canIntroduce);
  if (forceMore) state.newDay.count = 0;

  session    = interleave(dueWords, todaysNew);
  sessionIdx = 0;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function interleave(due, newCards) {
  if (!due.length)      return [...newCards];
  if (!newCards.length) return [...due];
  const result = [];
  let ni = 0;
  for (let i = 0; i < due.length; i++) {
    result.push(due[i]);
    if ((i + 1) % 5 === 0 && ni < newCards.length) result.push(newCards[ni++]);
  }
  while (ni < newCards.length) result.push(newCards[ni++]);
  return result;
}

// ─────────────────────────────────────────────
// WEAK WORDS  (Step 4)
// ─────────────────────────────────────────────

// A word is "weak" if the user has answered it wrong at least twice
// and has not yet followed that with two correct answers in a row (streak < 2).
function isWeak(p) {
  return p.wrong >= 2 && p.streak < 2;
}

// Returns up to 20 weak words, ranked by worst-first:
//   primary:   most wrong answers first (hardest words)
//   secondary: lowest current streak first (least recently recovered)
function getWeakWords() {
  return allWords
    .filter(w => {
      const p = state.progress[w.id];
      return p && isWeak(p);
    })
    .sort((a, b) => {
      const pa = state.progress[a.id];
      const pb = state.progress[b.id];
      if (pb.wrong !== pa.wrong) return pb.wrong - pa.wrong; // higher wrong count → first
      return pa.streak - pb.streak;                          // lower streak → first
    })
    .slice(0, 20);
}

// Update the label and disabled/enabled state of both weak-words buttons.
// Called whenever a screen containing a weak button is (re)rendered.
function updateWeakButtons() {
  const count = getWeakWords().length;
  [dom.btnWeakHome, dom.btnWeakDone].forEach(btn => {
    if (!btn) return;
    const sub = btn.querySelector('.drill-entry-sub');
    if (count === 0) {
      btn.disabled    = true;
      sub.textContent = 'No weak words right now';
    } else {
      btn.disabled    = false;
      sub.textContent = `${count} word${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} extra practice`;
    }
  });
}

// Start a focused review of the user's weakest words.
// Unlike a normal group session, this bypasses due-date scheduling —
// weak words are shown regardless of when they're next due.
function startWeakSession() {
  const weakWords = getWeakWords();
  if (weakWords.length === 0) return;

  isWeakMode   = true;
  currentGroup = '__weak__'; // sentinel so goBackToGroups() still resets correctly
  sessionWords = weakWords;

  // Shuffle directly — we skip buildSession() because weak mode ignores due dates
  session    = shuffle([...weakWords]);
  sessionIdx = 0;

  dom.backBtn.classList.remove('hidden');
  dom.progressStrip.classList.remove('hidden');
  showNextCard();
}

// ─────────────────────────────────────────────
// PROGRESS HELPERS
// ─────────────────────────────────────────────

function getStats() {
  const total   = sessionWords.length;
  const learned = sessionWords.filter(w => {
    const p = state.progress[w.id];
    return p && p.box >= 3;
  }).length;
  const seen = sessionWords.filter(w => state.progress[w.id]).length;
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
// STATS SCREEN  (Step 6)
// ─────────────────────────────────────────────

// Compute all displayable stats from the current state and the word list.
function computeStats() {
  const allProgress = Object.values(state.progress);

  // Words the user has seen at least once
  const wordsSeen    = allWords.filter(w => state.progress[w.id]).length;

  // Words that have reached box 3 or higher (the "learned" threshold)
  const wordsLearned = allWords.filter(w => {
    const p = state.progress[w.id];
    return p && p.box >= 3;
  }).length;

  // Sum the per-word 'seen' counter — this counts card reviews, not unique words
  const totalReviews = allProgress.reduce((sum, p) => sum + (p.seen || 0), 0);
  const totalCorrect = allProgress.reduce((sum, p) => sum + (p.correct || 0), 0);

  // Accuracy: percentage of all reviews that were answered correctly
  const accuracy = totalReviews > 0
    ? Math.round((totalCorrect / totalReviews) * 100)
    : 0;

  // How many words currently meet the weak-word criteria
  const weakCount = allWords.filter(w => {
    const p = state.progress[w.id];
    return p && isWeak(p);
  }).length;

  return {
    wordsSeen,
    wordsLearned,
    totalWords:  allWords.length,
    totalReviews,
    accuracy,
    weakCount,
    dayStreak: state.dayStreak || 0
  };
}

// Build the stats screen content and display it.
function openStats() {
  const s = computeStats();

  // Each entry becomes a compact card: a big coloured number with a label below it.
  // The colour gives a quick visual cue — green = good, red = needs attention, etc.
  const cards = [
    { value: s.wordsSeen,    label: 'Words seen',    colour: 'var(--text)' },
    { value: s.wordsLearned, label: 'Words learned', colour: 'var(--das)'  },
    { value: s.totalReviews, label: 'Total reviews', colour: 'var(--text)' },
    { value: s.accuracy + '%', label: 'Accuracy',    colour: 'var(--verb)' },
    {
      value:  s.weakCount,
      label:  'Weak words',
      colour: s.weakCount > 0 ? 'var(--die)' : 'var(--das)' // red if any weak, green if none
    },
    {
      value:  s.dayStreak + (s.dayStreak === 1 ? ' day' : ' days'),
      label:  'Study streak',
      colour: 'var(--der)'
    }
  ];

  // Render each stat as a small HTML card inside the grid container
  dom.statsGrid.innerHTML = cards.map(c =>
    `<div class="stat-card">
       <span class="stat-value" style="color:${c.colour}">${c.value}</span>
       <span class="stat-label">${c.label}</span>
     </div>`
  ).join('');

  dom.backBtn.classList.add('hidden');
  dom.progressStrip.classList.add('hidden');
  showScreen('stats');
}

// Return from the stats screen to the group selector.
function closeStats() {
  goBackToGroups();
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
  isFlipped   = false;
  dom.card.classList.remove('flipped');

  applyTypeStyle(dom.frontBar, dom.frontPill, word.type);
  dom.frontWord.textContent = word.de;

  applyTypeStyle(dom.backBar, dom.backPill, word.type);
  dom.backWord.textContent  = word.de;
  dom.backForms.textContent = word.forms || '';
  dom.backEn.textContent    = word.en;
  dom.backExDe.textContent  = word.example   || '';
  dom.backExEn.textContent  = word.exampleEn || '';

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

// Hide every screen then reveal just the one requested.
// Keeping all the show/hide logic here means adding a new screen only requires
// two lines here — one to hide, one to show.
function showScreen(which) {
  dom.groupScreen.classList.add('hidden');
  dom.drillScreen.classList.add('hidden');
  dom.loadingScreen.classList.add('hidden');
  dom.errorScreen.classList.add('hidden');
  dom.cardScene.classList.add('hidden');
  dom.doneScreen.classList.add('hidden');
  dom.emptyScreen.classList.add('hidden');
  dom.statsScreen.classList.add('hidden');

  if (which === 'groups')  dom.groupScreen.classList.remove('hidden');
  if (which === 'drill')   dom.drillScreen.classList.remove('hidden');
  if (which === 'loading') dom.loadingScreen.classList.remove('hidden');
  if (which === 'error')   dom.errorScreen.classList.remove('hidden');
  if (which === 'card')    dom.cardScene.classList.remove('hidden');
  if (which === 'done')    dom.doneScreen.classList.remove('hidden');
  if (which === 'empty')   dom.emptyScreen.classList.remove('hidden');
  if (which === 'stats')   dom.statsScreen.classList.remove('hidden');
}

function showDoneScreen() {
  const { total, learned, seen } = getStats();
  dom.doneStats.innerHTML =
    `<p><strong>${seen}</strong> words seen</p>` +
    `<p><strong>${learned}</strong> words learned (box ≥ 3)</p>` +
    `<p><strong>${total}</strong> words in this group</p>`;
  updateWeakButtons(); // refresh the count now that this session's answers are all saved
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
// ANSWER HANDLING  (Steps 3 + 5)
// ─────────────────────────────────────────────

function answer(knew) {
  if (!currentWord) return;
  const id = currentWord.id;
  let p = state.progress[id];

  if (!p) {
    // First time seeing this word — initialise all tracking fields to zero
    p = { box: 1, due: 0, seen: 0, correct: 0, wrong: 0, streak: 0, lastSeen: null };
    state.newDay.count++;
  }

  // ── Step 5: record that the user studied today ─────────────────
  // This is a no-op if lastStudyDate is already today, so it's safe
  // and cheap to call on every single answer.
  updateDayStreak();

  // ── Step 3: update per-word tracking stats ─────────────────────
  p.seen++;
  p.lastSeen = Date.now();

  if (knew) {
    p.correct++;
    p.streak++;                              // extend consecutive-correct run
    p.box = Math.min(5, p.box + 1);         // move up the Leitner box
    p.due = daysFromNow(BOX_INTERVALS[p.box]);
  } else {
    p.wrong++;
    p.streak = 0;                            // wrong answer resets the streak to zero
    p.box = 1;                               // drop back to box 1
    p.due = daysFromNow(1);
    session.push(currentWord);               // re-queue for later in this session
  }

  state.progress[id] = p;
  saveState(); // persists to localStorage (and later to Supabase via the hook in saveState)

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

  // The sheet slides up from below — we need to remove 'hidden' first, then
  // trigger a reflow (offsetHeight), then add 'visible' so the CSS transition runs.
  dom.sheetBackdrop.classList.remove('hidden');
  dom.sheetBackdrop.offsetHeight;
  dom.sheetBackdrop.classList.add('visible');

  dom.settingsSheet.classList.remove('hidden');
  dom.settingsSheet.offsetHeight;
  dom.settingsSheet.classList.add('visible');
}

function closeSettings() {
  dom.sheetBackdrop.classList.remove('visible');
  dom.settingsSheet.classList.remove('visible');
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
// GENDER DRILL
// ─────────────────────────────────────────────

function startDrill() {
  const nouns = allWords.filter(w => ['der', 'die', 'das'].includes(w.type)).slice(0, 50);
  drillWords = shuffle([...nouns]);
  drillIdx   = 0;
  drillRight = 0;
  drillWrong = 0;
  dom.backBtn.classList.remove('hidden');
  dom.progressStrip.classList.add('hidden');
  dom.drillActive.classList.remove('hidden');
  dom.drillResults.classList.add('hidden');
  showScreen('drill');
  renderDrillWord();
}

function renderDrillWord() {
  const word = drillWords[drillIdx];
  dom.drillNoun.textContent     = word.de.replace(/^(der|die|das)\s+/i, '').trim();
  dom.drillEn.textContent       = word.en;
  dom.drillProgress.textContent = `${drillIdx + 1} / ${drillWords.length}`;
  dom.drillScore.innerHTML      = `✓ ${drillRight} &nbsp; ✗ ${drillWrong}`;
  dom.drillFeedback.className   = 'drill-feedback hidden';
  dom.drillFeedback.textContent = '';
  [dom.drillBtnDer, dom.drillBtnDie, dom.drillBtnDas].forEach(btn => {
    btn.disabled  = false;
    btn.className = 'drill-btn';
  });
}

function handleDrillAnswer(chosen) {
  const word    = drillWords[drillIdx];
  const correct = word.type;
  const isRight = chosen === correct;

  [dom.drillBtnDer, dom.drillBtnDie, dom.drillBtnDas].forEach(btn => btn.disabled = true);

  const chosenBtn  = $('drillBtn' + chosen[0].toUpperCase() + chosen.slice(1));
  const correctBtn = $('drillBtn' + correct[0].toUpperCase() + correct.slice(1));

  if (isRight) {
    drillRight++;
    chosenBtn.classList.add('drill-correct');
    dom.drillFeedback.textContent = 'Correct! ✓';
    dom.drillFeedback.className   = 'drill-feedback drill-ok';
  } else {
    drillWrong++;
    chosenBtn.classList.add('drill-wrong');
    correctBtn.classList.add('drill-correct');
    const noun = word.de.replace(/^(der|die|das)\s+/i, '').trim();
    dom.drillFeedback.textContent = `It's ${correct} ${noun}`;
    dom.drillFeedback.className   = 'drill-feedback drill-bad';
  }

  setTimeout(() => {
    drillIdx++;
    if (drillIdx >= drillWords.length) showDrillResults();
    else renderDrillWord();
  }, isRight ? 550 : 1100);
}

function showDrillResults() {
  const pct = Math.round((drillRight / drillWords.length) * 100);
  dom.drillActive.classList.add('hidden');
  dom.drillResults.classList.remove('hidden');
  dom.drillResultIcon.textContent  = pct >= 80 ? '🎯' : pct >= 50 ? '💪' : '📚';
  dom.drillResultTitle.textContent = `${drillRight} / ${drillWords.length} correct`;
  dom.drillResultSub.textContent   = `${pct}% accuracy`;
}

// ─────────────────────────────────────────────
// INITIALISE
// ─────────────────────────────────────────────

async function init() {
  showScreen('loading');
  state = loadState(); // load (and migrate) saved state before anything else renders

  try {
    const res = await fetch('./words.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Empty or invalid words.json');
    allWords = data;
  } catch (err) {
    dom.errorDetail.textContent = err.message;
    showScreen('error');
    return;
  }

  wireEvents();
  renderGroupSelector();
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

function wireEvents() {
  // Navigation — back to group selector
  dom.backBtn.addEventListener('click', goBackToGroups);
  dom.btnBackFromDone.addEventListener('click', goBackToGroups);
  dom.btnBackFromEmpty.addEventListener('click', goBackToGroups);
  dom.btnBackFromDrill.addEventListener('click', goBackToGroups);

  // Gender drill
  $('btnStartDrill').addEventListener('click', startDrill);
  dom.btnDrillAgain.addEventListener('click', startDrill);
  [dom.drillBtnDer, dom.drillBtnDie, dom.drillBtnDas].forEach(btn => {
    btn.addEventListener('click', () => handleDrillAnswer(btn.dataset.gender));
  });

  // Weak-words sessions — same handler wired to both the home and done screen buttons
  dom.btnWeakHome.addEventListener('click', startWeakSession);
  dom.btnWeakDone.addEventListener('click', startWeakSession);

  // Stats screen
  dom.statsBtn.addEventListener('click', openStats);
  dom.btnCloseStats.addEventListener('click', closeStats);

  // "Study again" — replay all words in the current group/session ignoring due dates
  dom.btnStudyAgain.addEventListener('click', () => {
    session    = shuffle([...sessionWords]);
    sessionIdx = 0;
    showNextCard();
  });

  // Card flip — clicking anywhere on the card except the answer buttons or Hören toggles it
  dom.card.addEventListener('click', e => {
    if (e.target === dom.btnWrong || e.target === dom.btnRight) return;
    if (e.target === dom.listenBtn || dom.listenBtn.contains(e.target)) return;
    flipCard();
  });

  dom.card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  dom.listenBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (currentWord) speak(currentWord.de);
  });

  dom.btnWrong.addEventListener('click', e => { e.stopPropagation(); answer(false); });
  dom.btnRight.addEventListener('click', e => { e.stopPropagation(); answer(true);  });

  // Done screen — extra study options
  dom.btnMore.addEventListener('click', () => {
    buildSession(true); // forceMore = true pulls in new cards beyond today's cap
    if (session.length === 0) { showEmptyScreen(); updateProgressUI(); }
    else showNextCard();
  });

  dom.btnRestart.addEventListener('click', () => {
    buildSession();
    if (session.length === 0) showEmptyScreen();
    else showNextCard();
  });

  // Settings sheet
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.sheetBackdrop.addEventListener('click', closeSettings);
  dom.sheetCloseBtn.addEventListener('click', closeSettings);
  dom.stepperDown.addEventListener('click', () => changeNewPerDay(-1));
  dom.stepperUp.addEventListener('click',   () => changeNewPerDay(+1));

  // Progress reset — two-step confirmation to prevent accidental data loss
  dom.resetBtn.addEventListener('click', () => dom.resetConfirm.classList.remove('hidden'));
  dom.resetCancelBtn.addEventListener('click', () => dom.resetConfirm.classList.add('hidden'));
  dom.resetConfirmBtn.addEventListener('click', () => {
    state = defaultState();
    saveState();
    closeSettings();
    if (currentGroup !== null) {
      buildSession();
      if (session.length === 0) { showEmptyScreen(); updateProgressUI(); }
      else showNextCard();
    } else {
      renderGroupSelector();
    }
  });

  // Keyboard shortcuts: only active when the card back face is showing
  document.addEventListener('keydown', e => {
    if (!isFlipped) return;
    if (e.key === 'ArrowLeft'  || e.key === '1') answer(false);
    if (e.key === 'ArrowRight' || e.key === '2') answer(true);
  });
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
init();
