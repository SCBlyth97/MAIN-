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
const SCHEMA_VERSION = 2;  // bump whenever the persisted state shape changes

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

let allWords      = [];      // full word list loaded from words.json
let sessionWords  = [];      // words for the current group or weak session
let currentGroup  = null;    // active group number; null = selector; '__weak__' = weak session
let state         = {};      // all persisted user data — read/write via loadState/saveState only
let session       = [];      // ordered card queue for the current session
let sessionIdx    = 0;       // index of the next card to show
let currentWord   = null;    // the word currently on screen
let isFlipped     = false;
let isWeakMode    = false;   // true while running a weak-words session
let currentScreen = 'loading'; // tracks the active screen; used by rerenderCurrentScreen()

// Auth (Steps 2–5): currentUser is set by onAuthStateChange; null = guest/offline mode
let currentUser = null;


// ─────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────

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
  statsScreen:   $('statsScreen'),
  statsGrid:     $('statsGrid'),

  // Header
  backBtn:       $('backBtn'),
  progressStrip: $('progressStrip'),
  statsBtn:      $('statsBtn'),

  // Progress strip
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


  // Done / empty / stats screen buttons
  btnMore:          $('btnMore'),
  btnRestart:       $('btnRestart'),
  btnStudyAgain:    $('btnStudyAgain'),
  btnBackFromDone:  $('btnBackFromDone'),
  btnBackFromEmpty: $('btnBackFromEmpty'),
  btnCloseStats:    $('btnCloseStats'),

  // Weak-words entry buttons (home screen and done screen)
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
// SUPABASE CLIENT  (Step 1)
//
// window.supabase  — the UMD bundle from the CDN <script> in index.html
// window.SUPABASE_URL / window.SUPABASE_ANON_KEY — set by config.js
//
// If config.js is missing or has empty values the client stays null and
// the whole app runs in guest-only mode with no auth UI changes.
// ─────────────────────────────────────────────

const supabase = (
  typeof window.supabase !== 'undefined' &&
  window.SUPABASE_URL &&
  window.SUPABASE_ANON_KEY
)
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

// ─────────────────────────────────────────────
// STORAGE HELPERS
//
// ALL reads and writes of user state go through loadState() and saveState().
// No other part of the app should touch localStorage directly.
// Cloud sync hooks live exclusively in these two functions.
// ─────────────────────────────────────────────

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastModified:  null,   // ISO timestamp — set by saveState() on every write
    progress:      {},     // { [wordId]: { box, due, seen, correct, wrong, streak, lastSeen } }
    settings:      { newPerDay: 20 },
    newDay:        { date: '', count: 0 },
    lastStudyDate: null,
    dayStreak:     0
  };
}

// Parse and validate a raw state object from any source (localStorage or Supabase).
// Fills in defaults for missing fields and migrates old schema versions.
// Called by both loadState() and reconcileWithCloud() so the migration runs
// automatically for data coming from either source.
function parseState(parsed) {
  const s = defaultState();
  if (!parsed || typeof parsed !== 'object') return s;

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
  // v2 adds: seen, correct, wrong, streak, lastSeen.
  // We only add missing fields so existing box/due values are untouched.
  const version = parsed.schemaVersion || 1;
  if (version < 2) {
    Object.values(s.progress).forEach(p => {
      if (p.seen     === undefined) p.seen     = 0;
      if (p.correct  === undefined) p.correct  = 0;
      if (p.wrong    === undefined) p.wrong    = 0;
      if (p.streak   === undefined) p.streak   = 0;
      if (p.lastSeen === undefined) p.lastSeen = null;
    });
    // s.schemaVersion is already SCHEMA_VERSION from defaultState().
    // The migrated data is written to storage on the next saveState() call.
  }

  return s;
}

function loadState() {
  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SUPABASE SYNC HOOK — read side                              ║
  // ║                                                              ║
  // ║  This function only reads localStorage so the page renders   ║
  // ║  instantly without waiting for the network. Cloud            ║
  // ║  reconciliation happens in reconcileWithCloud(), which is    ║
  // ║  called by onAuthStateChange once a session is confirmed.    ║
  // ╚══════════════════════════════════════════════════════════════╝
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return parseState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function saveState() {
  // ── Step 1: always write to localStorage first ─────────────────
  // This guarantees guest mode and offline use always work,
  // completely independently of whether Supabase is reachable.
  try {
    state.schemaVersion = SCHEMA_VERSION;
    state.lastModified  = new Date().toISOString(); // timestamp used for reconciliation
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('Deutsch: could not save to localStorage');
  }

  // ── Step 2: fire-and-forget cloud sync (Step 5) ─────────────────
  // Only runs when a user is signed in AND Supabase is configured.
  // We do NOT await this — the UI never waits for the network.
  // If offline or signed out, nothing happens and local progress is safe.
  if (supabase && currentUser) {
    supabase.from('user_progress').upsert({
      user_id:    currentUser.id,
      state:      state,
      updated_at: state.lastModified
    }).then(({ error }) => {
      if (error) console.warn('Deutsch: cloud save failed:', error.message);
    });
  }
}

// ─────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(days) {
  return Date.now() + days * 86400000;
}

// ─────────────────────────────────────────────
// DAILY STUDY STREAK
// ─────────────────────────────────────────────

function updateDayStreak() {
  const today = todayStr();
  if (state.lastStudyDate === today) return;

  const prev = new Date();
  prev.setDate(prev.getDate() - 1);
  const yesterday = prev.toISOString().slice(0, 10);

  if (state.lastStudyDate === yesterday) {
    state.dayStreak = (state.dayStreak || 0) + 1;
  } else {
    state.dayStreak = 1;
  }
  state.lastStudyDate = today;
}

// ─────────────────────────────────────────────
// GROUP SELECTOR
// ─────────────────────────────────────────────

function getGroupNums() {
  return [...new Set(allWords.map(w => w.group || 1))].sort((a, b) => a - b);
}

function getGroupStats(groupNum) {
  const words   = allWords.filter(w => (w.group || 1) === groupNum);
  const total   = words.length;
  const learned = words.filter(w => { const p = state.progress[w.id]; return p && p.box >= 3; }).length;
  const seen    = words.filter(w => state.progress[w.id]).length;
  return { total, learned, seen };
}

function renderGroupSelector() {
  const groupNums = getGroupNums();
  dom.groupGrid.innerHTML = '';

  // Update home subtitle with overall progress
  const totalWords   = allWords.length;
  const learnedWords = allWords.filter(w => { const p = state.progress[w.id]; return p && p.box >= 3; }).length;
  const seenWords    = allWords.filter(w => state.progress[w.id]).length;
  const subtitle = $('homeSubtitle');
  if (subtitle) {
    subtitle.textContent = seenWords === 0
      ? `${totalWords} words across ${groupNums.length} groups`
      : `${learnedWords} of ${totalWords} words learned · ${seenWords} seen`;
  }

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
      statusClass = 'gcard-status-progress';
      statusText  = `${Math.round((learned / total) * 100)}% learned`;
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
  updateWeakButtons();
  showScreen('groups');
}

function openGroup(num) {
  currentGroup = num;
  sessionWords = allWords.filter(w => (w.group || 1) === num);
  isWeakMode   = false;
  dom.backBtn.classList.remove('hidden');
  dom.progressStrip.classList.remove('hidden');
  buildSession();
  if (session.length === 0) { showEmptyScreen(); updateProgressUI(); }
  else showNextCard();
}

function goBackToGroups() {
  currentGroup = null;
  sessionWords = [];
  session      = [];
  sessionIdx   = 0;
  currentWord  = null;
  isFlipped    = false;
  isWeakMode   = false;
  renderGroupSelector();
}

// ─────────────────────────────────────────────
// SESSION BUILDING
// ─────────────────────────────────────────────

function buildSession(forceMore = false) {
  const today    = todayStr();
  const progress = state.progress;

  if (state.newDay.date !== today) state.newDay = { date: today, count: 0 };

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
  const canIntroduce = forceMore
    ? Math.min(cap, newWords.length)
    : Math.max(0, cap - state.newDay.count);

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
// WEAK WORDS
// ─────────────────────────────────────────────

function isWeak(p) {
  return p.wrong >= 2 && p.streak < 2;
}

function getWeakWords() {
  return allWords
    .filter(w => { const p = state.progress[w.id]; return p && isWeak(p); })
    .sort((a, b) => {
      const pa = state.progress[a.id];
      const pb = state.progress[b.id];
      if (pb.wrong !== pa.wrong) return pb.wrong - pa.wrong;
      return pa.streak - pb.streak;
    })
    .slice(0, 20);
}

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

function startWeakSession() {
  const weakWords = getWeakWords();
  if (weakWords.length === 0) return;
  isWeakMode   = true;
  currentGroup = '__weak__';
  sessionWords = weakWords;
  session      = shuffle([...weakWords]);
  sessionIdx   = 0;
  dom.backBtn.classList.remove('hidden');
  dom.progressStrip.classList.remove('hidden');
  showNextCard();
}

// ─────────────────────────────────────────────
// PROGRESS HELPERS
// ─────────────────────────────────────────────

function getStats() {
  const total   = sessionWords.length;
  const learned = sessionWords.filter(w => { const p = state.progress[w.id]; return p && p.box >= 3; }).length;
  const seen    = sessionWords.filter(w => state.progress[w.id]).length;
  return { total, learned, seen };
}

function updateProgressUI() {
  const { total, learned } = getStats();
  const left = session.length - sessionIdx;
  dom.statLearned.textContent  = learned;
  dom.statTotal.textContent    = total;
  dom.statQueue.textContent    = Math.max(0, left);
  dom.progressFill.style.width = (total > 0 ? (learned / total) * 100 : 0).toFixed(1) + '%';
}

// ─────────────────────────────────────────────
// STATS SCREEN
// ─────────────────────────────────────────────

function computeStats() {
  const allProgress  = Object.values(state.progress);
  const wordsSeen    = allWords.filter(w => state.progress[w.id]).length;
  const wordsLearned = allWords.filter(w => { const p = state.progress[w.id]; return p && p.box >= 3; }).length;
  const totalReviews = allProgress.reduce((sum, p) => sum + (p.seen || 0), 0);
  const totalCorrect = allProgress.reduce((sum, p) => sum + (p.correct || 0), 0);
  const accuracy     = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;
  const weakCount    = allWords.filter(w => { const p = state.progress[w.id]; return p && isWeak(p); }).length;
  return { wordsSeen, wordsLearned, totalWords: allWords.length, totalReviews, accuracy, weakCount, dayStreak: state.dayStreak || 0 };
}

function openStats() {
  const s = computeStats();
  const cards = [
    { value: s.wordsSeen,    label: 'Words seen',    colour: 'var(--text)' },
    { value: s.wordsLearned, label: 'Words learned', colour: 'var(--das)'  },
    { value: s.totalReviews, label: 'Total reviews', colour: 'var(--text)' },
    { value: s.accuracy + '%', label: 'Accuracy',    colour: 'var(--verb)' },
    { value: s.weakCount,    label: 'Weak words',    colour: s.weakCount > 0 ? 'var(--die)' : 'var(--das)' },
    { value: s.dayStreak + (s.dayStreak === 1 ? ' day' : ' days'), label: 'Study streak', colour: 'var(--der)' }
  ];
  dom.statsGrid.innerHTML = cards.map(c =>
    `<div class="stat-card"><span class="stat-value" style="color:${c.colour}">${c.value}</span><span class="stat-label">${c.label}</span></div>`
  ).join('');
  dom.backBtn.classList.add('hidden');
  dom.progressStrip.classList.add('hidden');
  showScreen('stats');
}

function closeStats() { goBackToGroups(); }

// ─────────────────────────────────────────────
// SUPABASE AUTH  (Steps 2–5)
// ─────────────────────────────────────────────

// Called once from init(). Sets up the auth state listener.
// onAuthStateChange fires:
//   • on page load, if Supabase finds a saved session in localStorage
//   • when the user lands back on the page after clicking a magic link
//   • after signOut()
function setupAuth() {
  // Always render the initial auth UI, even if supabase is null (shows "not configured")
  updateAuthUI();

  if (!supabase) return; // no config — guest-only mode, nothing more to do

  supabase.auth.onAuthStateChange(async (event, session) => {
    const wasSignedIn = !!currentUser;
    currentUser = session?.user ?? null;

    // Refresh the signed-in / signed-out controls inside the settings sheet
    updateAuthUI();

    // The first time a user becomes signed in during this page load,
    // pull their cloud state and reconcile it with local progress.
    if (currentUser && !wasSignedIn) {
      await reconcileWithCloud();
    }
  });
}

// Render the account section inside the settings sheet (id="authRow").
// Called by onAuthStateChange and whenever we need to refresh it.
function updateAuthUI() {
  const row = $('authRow');
  if (!row) return;

  if (!supabase) {
    // config.js not yet filled in — show a neutral placeholder
    row.innerHTML = `<p class="sync-status" style="padding:4px 0">Sync not configured</p>`;
    return;
  }

  if (currentUser) {
    // Signed in: show the user's email (truncated) and a sign-out button
    row.innerHTML = `
      <div class="setting-row">
        <span class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${currentUser.email}">☁ ${currentUser.email}</span>
        <button class="btn btn-secondary btn-sm" id="btnSignOut">Sign out</button>
      </div>`;
    $('btnSignOut').addEventListener('click', handleSignOut);
  } else {
    // Signed out: invite the user to sign in
    row.innerHTML = `
      <button class="btn btn-secondary btn-full" id="btnOpenSignIn">Sign in to sync</button>`;
    $('btnOpenSignIn').addEventListener('click', openSignInForm);
  }
}

// Replace the auth row with an inline magic-link form.
// No modal or new page — everything happens inside the settings sheet.
function openSignInForm() {
  const row = $('authRow');
  if (!row) return;

  row.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <label class="setting-label">Email</label>
      <input  type="email" id="authEmail" class="login-input"
              placeholder="you@example.com" autocomplete="email" />
      <button class="btn btn-primary" id="btnSendLink">Send magic link</button>
      <p class="sync-status" id="authStatus"></p>
      <button class="btn btn-secondary" id="btnCancelAuth">Cancel</button>
    </div>`;

  $('btnCancelAuth').addEventListener('click', updateAuthUI);
  $('btnSendLink').addEventListener('click', sendMagicLink);
  // Allow pressing Enter in the email field to send the link
  $('authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendMagicLink(); });
  $('authEmail').focus();
}

// Cooldown flag — prevents the user accidentally spamming magic-link emails
let linkCooldown = false;

async function sendMagicLink() {
  if (linkCooldown || !supabase) return;

  const emailEl  = $('authEmail');
  const statusEl = $('authStatus');
  const sendBtn  = $('btnSendLink');
  const email    = emailEl?.value.trim();

  if (!email) {
    if (statusEl) statusEl.textContent = 'Please enter your email address.';
    return;
  }

  if (sendBtn)  sendBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Sending…';

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Redirect back to this exact page after the user clicks the link.
      // This URL must be listed in Supabase → Auth → URL Configuration → Redirect URLs.
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    if (statusEl) statusEl.textContent = `Error: ${error.message}`;
    if (sendBtn)  sendBtn.disabled = false;
    return;
  }

  if (statusEl) statusEl.textContent = '✓ Check your email for the link!';

  // Show a 30-second countdown before allowing a resend
  linkCooldown = true;
  let secs = 30;
  const tick = () => {
    secs--;
    if (sendBtn) sendBtn.textContent = `Resend (${secs}s)`;
    if (secs > 0) {
      setTimeout(tick, 1000);
    } else {
      linkCooldown = false;
      if (sendBtn) { sendBtn.textContent = 'Resend link'; sendBtn.disabled = false; }
    }
  };
  setTimeout(tick, 1000);
}

async function handleSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  // onAuthStateChange fires automatically after signOut() and calls updateAuthUI()
}

// ── Cloud reconciliation (Step 4) ─────────────────────────────────

// Called once when the user becomes signed in. Fetches the cloud row
// and adopts whichever version (local or cloud) has the more recent lastModified.
async function reconcileWithCloud() {
  if (!supabase || !currentUser) return;

  try {
    // maybeSingle() returns { data: null } instead of an error when no row exists
    const { data, error } = await supabase
      .from('user_progress')
      .select('state, updated_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) {
      console.warn('Deutsch: could not fetch cloud state:', error.message);
      return;
    }

    if (!data) {
      // No cloud row yet — first login on this account.
      // Push the user's current local progress so it is not lost.
      await pushToCloud();
      return;
    }

    // Compare ISO timestamps. null is treated as the oldest possible value.
    const cloudTs = data.state?.lastModified ?? null;
    const localTs = state.lastModified ?? null;

    if (cloudTs && (!localTs || cloudTs > localTs)) {
      // Cloud is newer — adopt it and write it locally too so offline works
      state = parseState(data.state); // parseState runs migration if cloud data is old schema
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      rerenderCurrentScreen(); // refresh whatever screen is visible right now
    } else {
      // Local is newer or equal — push it up to the cloud
      await pushToCloud();
    }
  } catch (err) {
    console.warn('Deutsch: reconcileWithCloud failed:', err.message);
  }
}

// Push the current local state to Supabase.
// Awaited in reconcileWithCloud() for correctness; called fire-and-forget by saveState().
async function pushToCloud() {
  if (!supabase || !currentUser) return;
  const { error } = await supabase.from('user_progress').upsert({
    user_id:    currentUser.id,
    state:      state,
    updated_at: state.lastModified || new Date().toISOString()
  });
  if (error) console.warn('Deutsch: pushToCloud failed:', error.message);
}

// After adopting cloud state, refresh whatever screen is currently visible
// so the user sees the new data without reloading the page.
function rerenderCurrentScreen() {
  if      (currentScreen === 'groups') renderGroupSelector();
  else if (currentScreen === 'stats')  openStats();
  // Card/done/empty screens will pick up the new state on the next navigation.
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
  if (sessionIdx >= session.length) { showDoneScreen(); return; }
  showScreen('card');
  showCard(session[sessionIdx]);
  updateProgressUI();
}

// Hide every screen, then reveal just the one requested.
// Also tracks currentScreen so rerenderCurrentScreen() knows what to refresh.
function showScreen(which) {
  currentScreen = which; // remember for rerenderCurrentScreen()

  dom.groupScreen.classList.add('hidden');
  dom.loadingScreen.classList.add('hidden');
  dom.errorScreen.classList.add('hidden');
  dom.cardScene.classList.add('hidden');
  dom.doneScreen.classList.add('hidden');
  dom.emptyScreen.classList.add('hidden');
  dom.statsScreen.classList.add('hidden');

  if (which === 'groups')  dom.groupScreen.classList.remove('hidden');
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
  updateWeakButtons();
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
    p = { box: 1, due: 0, seen: 0, correct: 0, wrong: 0, streak: 0, lastSeen: null };
    state.newDay.count++;
  }

  updateDayStreak();

  p.seen++;
  p.lastSeen = Date.now();

  if (knew) {
    p.correct++;
    p.streak++;
    p.box = Math.min(5, p.box + 1);
    p.due = daysFromNow(BOX_INTERVALS[p.box]);
  } else {
    p.wrong++;
    p.streak = 0;
    p.box = 1;
    p.due = daysFromNow(1);
    session.push(currentWord);
  }

  state.progress[id] = p;
  saveState(); // writes localStorage + fires cloud upsert if signed in

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
  dom.sheetBackdrop.offsetHeight; // force reflow so the CSS transition runs
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

// ─────────────────────────────────────────────
// INITIALISE
// ─────────────────────────────────────────────

async function init() {
  showScreen('loading');
  // Load from localStorage immediately — the page renders without waiting for the network.
  // If a Supabase session exists, reconcileWithCloud() will run in the background
  // after setupAuth() fires onAuthStateChange.
  state = loadState();

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
  setupAuth();         // register onAuthStateChange; does NOT block rendering
  renderGroupSelector();
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

function wireEvents() {
  dom.backBtn.addEventListener('click', goBackToGroups);
  dom.btnBackFromDone.addEventListener('click', goBackToGroups);
  dom.btnBackFromEmpty.addEventListener('click', goBackToGroups);

  dom.btnWeakHome.addEventListener('click', startWeakSession);
  dom.btnWeakDone.addEventListener('click', startWeakSession);

  dom.statsBtn.addEventListener('click', openStats);
  dom.btnCloseStats.addEventListener('click', closeStats);

  dom.btnStudyAgain.addEventListener('click', () => {
    session    = shuffle([...sessionWords]);
    sessionIdx = 0;
    showNextCard();
  });

  dom.card.addEventListener('click', e => {
    if (e.target === dom.btnWrong || e.target === dom.btnRight) return;
    if (e.target === dom.listenBtn || dom.listenBtn.contains(e.target)) return;
    flipCard();
  });
  dom.card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });
  dom.listenBtn.addEventListener('click', e => { e.stopPropagation(); if (currentWord) speak(currentWord.de); });

  dom.btnWrong.addEventListener('click', e => { e.stopPropagation(); answer(false); });
  dom.btnRight.addEventListener('click', e => { e.stopPropagation(); answer(true);  });

  dom.btnMore.addEventListener('click', () => {
    buildSession(true);
    if (session.length === 0) { showEmptyScreen(); updateProgressUI(); }
    else showNextCard();
  });
  dom.btnRestart.addEventListener('click', () => {
    buildSession();
    if (session.length === 0) showEmptyScreen();
    else showNextCard();
  });

  dom.settingsBtn.addEventListener('click', openSettings);
  dom.sheetBackdrop.addEventListener('click', closeSettings);
  dom.sheetCloseBtn.addEventListener('click', closeSettings);
  dom.stepperDown.addEventListener('click', () => changeNewPerDay(-1));
  dom.stepperUp.addEventListener('click',   () => changeNewPerDay(+1));

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
