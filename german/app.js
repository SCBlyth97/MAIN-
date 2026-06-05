/* ============================================================
   Deutsch — app.js
   Spaced-repetition German flashcard app
   Pure vanilla JS, no frameworks, no build step.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const STORAGE_KEY = 'deutsch_state_v1';

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

let allWords     = [];   // full word list from words.json
let sessionWords = [];   // words for the current group session
let currentGroup = null; // group number currently active (null = on selector)
let state        = {};   // persisted progress + settings
let session      = [];
let sessionIdx   = 0;
let currentWord  = null;
let isFlipped    = false;

// Drill state
let drillWords = [];
let drillIdx   = 0;
let drillRight = 0;
let drillWrong = 0;

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

  // Header
  backBtn:       $('backBtn'),
  progressStrip: $('progressStrip'),

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

  // Drill
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

  // Done/empty
  btnMore:          $('btnMore'),
  btnRestart:       $('btnRestart'),
  btnStudyAgain:    $('btnStudyAgain'),
  btnBackFromDone:  $('btnBackFromDone'),
  btnBackFromEmpty: $('btnBackFromEmpty'),

  // Settings
  settingsBtn:    $('settingsBtn'),
  sheetBackdrop:  $('sheetBackdrop'),
  settingsSheet:  $('settingsSheet'),
  sheetCloseBtn:  $('sheetCloseBtn'),
  stepperDown:    $('stepperDown'),
  stepperUp:      $('stepperUp'),
  stepperVal:     $('stepperVal'),
  resetBtn:       $('resetBtn'),
  resetConfirm:   $('resetConfirm'),
  resetCancelBtn: $('resetCancelBtn'),
  resetConfirmBtn:$('resetConfirmBtn')
};

// ─────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────

function defaultState() {
  return {
    progress: {},
    settings: { newPerDay: 20 },
    newDay:   { date: '', count: 0 }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
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
  showScreen('groups');
}

function openGroup(num) {
  currentGroup = num;
  sessionWords = allWords.filter(w => (w.group || 1) === num);

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

function showScreen(which) {
  dom.groupScreen.classList.add('hidden');
  dom.drillScreen.classList.add('hidden');
  dom.loadingScreen.classList.add('hidden');
  dom.errorScreen.classList.add('hidden');
  dom.cardScene.classList.add('hidden');
  dom.doneScreen.classList.add('hidden');
  dom.emptyScreen.classList.add('hidden');

  if (which === 'groups')  dom.groupScreen.classList.remove('hidden');
  if (which === 'drill')   dom.drillScreen.classList.remove('hidden');
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
    `<p><strong>${total}</strong> words in this group</p>`;
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
    p = { box: 1, due: 0 };
    state.newDay.count++;
  }

  if (knew) {
    p.box = Math.min(5, p.box + 1);
    p.due = daysFromNow(BOX_INTERVALS[p.box]);
  } else {
    p.box = 1;
    p.due = daysFromNow(1);
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
  dom.drillNoun.textContent = word.de.replace(/^(der|die|das)\s+/i, '').trim();
  dom.drillEn.textContent   = word.en;
  dom.drillProgress.textContent = `${drillIdx + 1} / ${drillWords.length}`;
  dom.drillScore.innerHTML  = `✓ ${drillRight} &nbsp; ✗ ${drillWrong}`;
  dom.drillFeedback.className = 'drill-feedback hidden';
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
  renderGroupSelector();
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

function wireEvents() {
  // Back to group selector
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

  // Study again — replay all group words regardless of due dates
  dom.btnStudyAgain.addEventListener('click', () => {
    session    = shuffle([...sessionWords]);
    sessionIdx = 0;
    showNextCard();
  });

  // Card flip
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

  // Done screen
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

  // Settings
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.sheetBackdrop.addEventListener('click', closeSettings);
  dom.sheetCloseBtn.addEventListener('click', closeSettings);
  dom.stepperDown.addEventListener('click', () => changeNewPerDay(-1));
  dom.stepperUp.addEventListener('click',   () => changeNewPerDay(+1));

  // Reset
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

  // Keyboard shortcuts
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
