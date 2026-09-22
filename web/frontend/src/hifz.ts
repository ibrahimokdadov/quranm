import './hifz.css';
import { HifzListener } from './hifz/listener';
import { RecitationFlow } from './hifz/recitation-flow';
import { RecitationMonitor } from './hifz/recitation-monitor';
import { memorySteps, passMatched, RevisionCoach, type MemoryStep } from './hifz/memorization';
import { RecitationAudio } from './hifz/recitation-audio';
import { displayIssue, lessonSteps, recitationWords, wordOffset, type LessonStep, type Verse } from './hifz/lesson';
import { inPassage, issueLabels, mergeWordProgress, recitedWords, validProgress, wordFeedback } from './hifz/live-feedback';
import type { WordProgressMessage } from './lib/types';
import { splitUthmaniWords } from './lib/quran-words';
import { coverage, emptyProgress, localDay, parseProgress, passageId, recordAttempt, STORAGE_KEY, validPassage,
  type Attempt, type Outcome, type Passage, type PossibleIssue, type Progress, type WordHint } from './hifz/progress';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const mic = icon('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>');
const book = icon('<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>');
const chevron = icon('<path d="m8 10 4 4 4-4"/>');
const PREFS_KEY = 'tilawa-hifz-preferences-v2';
interface Preferences { passage: Passage; review: boolean; oneAtATime: boolean; pause: number | null }
let preferences: Preferences = { passage: { surah: 112, start: 1, end: 4 }, review: false, oneAtATime: true, pause: 8000 };
let verses: Verse[] = [];
let counts = new Map<number, number>();
let progress: Progress = emptyProgress();
let rawProgress: string | null = null;
let storageBlocked = false;
let steps: LessonStep[] = [];
let stepIndex = 0;
let view: 'paths' | 'picker' | 'practice' = 'paths';
let memory: MemoryStep[] = [];
let retryStudy = false;
let memoryBusy = false;
let memoryMessage = '';
let memoryPending: boolean | null = null;
let coach = new RevisionCoach();
let speechTurn = 0;
let pendingCue: PossibleIssue | null = null;
let cueShown: PossibleIssue | null = null;
let cuePlaying = false;
let cueUnavailable = false;
let cueTurn = -1;
const reciter = new RecitationAudio();
const isMemory = () => memory.length > 0;
const visibleStudy = () => isMemory() && (memory[stepIndex]?.stage === 'read' || retryStudy);
let phase: 'ready' | 'starting' | 'listening' | 'finishing' | 'check' | 'complete' = 'ready';
let draft: Attempt | null = null;
let flow: RecitationFlow | null = null;
let monitor: RecitationMonitor | null = null;
let manual = false;
let peeked = false;
let notice = '';
let setupStatus = '';
let liveHint: WordHint | null = null;
let showLiveText = false;
const livePositions = new Map<number, WordProgressMessage>();
let latestPosition: WordProgressMessage | null = null;
let offTrackPosition: WordProgressMessage | undefined;
let progressAt = 0;
let voiceAt = -Infinity;
let lastTextRender = '';
let liveIssue: { issue: PossibleIssue; at: number } | null = null;
let lastLiveRender = '';
let attemptGeneration = 0;
let controlsTimer: ReturnType<typeof setTimeout> | undefined;
const completed = new Set<string>();
const step = () => steps[stepIndex];
const currentVerses = () => verses.filter(v => v.surah === step().passage.surah && v.ayah >= step().passage.start && v.ayah <= step().passage.end);
const title = (p: Passage) => verses.find(v => v.surah === p.surah)?.surah_name_en ?? `Surah ${p.surah}`;
const range = (p: Passage) => p.start === p.end ? `Ayah ${p.start}` : `Ayahs ${p.start}–${p.end}`;

function passageHtml(highlight = false, follow = false, recitedOnly = false): string {
  return currentVerses().map(v => {
    const tokens = recitedOnly ? recitedWords(v, livePositions.get(v.ayah))
      : splitUthmaniWords(v.text_uthmani).map((w, index) => ({ text: w.text, index }));
    if (!tokens.length) return '';
    const words = tokens.map(w => {
      if (!w) return '<span class="recitation-gap" aria-label="Words not yet matched">…</span>';
      const { index } = w;
      const flagged = highlight && draft?.issues.some(i => i.surah === v.surah && i.ayah === v.ayah
        && i.word >= 0 && index >= i.word && index < i.word + (i.words ?? 1));
      if (follow) return `<span data-word="${index}" class="follow-word ${wordFeedback(v, index, livePositions.get(v.ayah), draft?.issues ?? [])}">${escape(w.text)}</span>`;
      return flagged ? `<mark>${escape(w.text)}</mark>` : escape(w.text);
    }).join(' ');
    const numeral = String(v.ayah).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
    return `<p data-ayah="${v.ayah}">${words}<span class="ayah-number">۝${numeral}</span></p>`;
  }).join('');
}

function offTrackHtml(): string {
  const mismatch = monitor?.mismatch;
  if (mismatch?.kind !== 'different' || !offTrackPosition
    || offTrackPosition.surah !== mismatch.detected.surah || offTrackPosition.ayah !== mismatch.detected.ayah) return '';
  const verse = verses.find(v => v.surah === offTrackPosition!.surah && v.ayah === offTrackPosition!.ayah);
  if (!verse) return '';
  const tokens = recitedWords(verse, offTrackPosition);
  if (!tokens.length) return '';
  // Only words actually matched by the listener, never the complete wrong ayah.
  const words = tokens.map(w => w ? `<span data-word="${w.index}">${escape(w.text)}</span>`
    : '<span class="recitation-gap" aria-label="Words not yet matched">…</span>').join(' ');
  return `<p class="off-track" aria-label="Matched words from a different ayah, ${verse.surah}:${verse.ayah}">${words}</p>`;
}

function render(): void {
  const recording = phase === 'listening' || phase === 'finishing';
  document.body.classList.toggle('recording', recording);
  document.querySelectorAll<HTMLElement>('.fade').forEach(el => { el.inert = recording; });
  $('live').hidden = !recording;
  $('live-controls').hidden = phase !== 'listening';
  $('setup-page').hidden = view !== 'picker';
  $('screen').hidden = view === 'picker';
  if (view === 'picker') return;
  if (view === 'paths') {
    $('screen').innerHTML = `<div class="welcome-mark" aria-hidden="true"><img src="/brand/quranm-mark.svg" alt="" width="88" height="88" /></div><p class="eyebrow">Quran + memory</p><h1>Your time with the Quran.</h1>
      <p class="intro">What would you like to do today?</p><div class="path-choices">
      <button class="path-card" data-action="memorize"><span class="path-icon">${book}</span><span><strong>Memorize</strong><small>Read. Repeat. Remember.</small></span><span class="path-arrow" aria-hidden="true">↗</span></button>
      <button class="path-card" data-action="revise"><span class="path-icon">${mic}</span><span><strong>Revise</strong><small>Recite. We’ll follow along.</small></span><span class="path-arrow" aria-hidden="true">↗</span></button></div>
      ${storageBlocked ? '<p class="status error">Saved progress could not be read. Export it from Your passages.</p>' : ''}`;
    return;
  }
  if (recording) {
    // Upcoming words are removed from the idle page and its accessibility tree.
    $('screen').replaceChildren();
    renderHint();
    return;
  }
  if (phase === 'complete') {
    const card = progress.cards[passageId(preferences.passage)];
    $('screen').innerHTML = `<div class="complete-check" aria-hidden="true">✓</div><p class="eyebrow">${isMemory() ? stepIndex >= steps.length ? 'Today’s practice, complete' : 'Practice saved' : 'Revision complete'}</p><h1>A little more familiar.</h1>
      <p class="status">${card && card.due > localDay() ? `Come back ${friendlyDate(card.due)} for a fresh recall.` : 'Your practice is saved. Return for another recall later.'}</p>
      <div class="actions"><button class="primary" data-action="home">Done</button><button class="quiet" data-action="repeat">Practise again</button></div>`;
    return;
  }
  if (isMemory() && phase === 'check' && memoryPending !== null) {
    $('screen').innerHTML = `<h1>Your practice is still here.</h1><p class="status error">${escape(notice)}</p><button class="primary" data-action="save-memory">Save & continue</button>`;
    return;
  }
  const s = step();
  const hidden = (isMemory() ? !visibleStudy() : true) && !peeked;
  const eyebrow = phase === 'check' ? 'Check your recall' : isMemory() ? 'Memorize' : s.kind === 'review' ? 'Revise'
    : s.kind === 'connect' ? 'Now connect the passage' : s.unit ? `Learn · ${stepIndex + 1} of ${steps.length - 1}` : 'Make it familiar';
  const dots = isMemory() ? memoryProgressHtml() : '';
  let body: string;
  if (phase === 'check') {
    const assisted = !!(draft?.hints.length || draft?.textRevealed);
    body = `<div class="quran" lang="ar" dir="rtl">${passageHtml(true)}</div>${evidenceHtml()}
      <div class="actions"><button class="secondary" data-action="repair">Study again</button><button class="primary" data-action="remembered">${assisted ? 'Try without help' : 'Remembered'}</button></div>
      <button class="quiet" data-action="uncertain">Not sure · leave for later</button>
      <p class="caption">${assisted ? 'Help was used. This attempt counts as practice.' : 'Confirm the wording yourself or with your teacher.'}</p>`;
  } else if (phase === 'starting') {
    body = `<div class="closed-text">${mic}<p>Getting ready to listen.</p><span class="status" id="setup-status">${escape(setupStatus || 'Preparing your listener…')}</span></div>
      <button class="secondary" data-action="cancel">Cancel</button>`;
  } else {
    body = hidden
      ? `<div class="closed-text">${mic}<p>Begin when you’re ready.</p></div>`
      : `<div class="quran" lang="ar" dir="rtl">${passageHtml()}</div>`;
    body += `<button class="primary" data-action="start" ${storageBlocked ? 'disabled' : ''}>${mic}${isMemory() ? 'Read aloud' : 'Start revision'}</button>
      <p class="caption">${isMemory() ? 'Read at your pace. We’ll count each matched reading.' : 'Words appear as you recite.'}</p>`;
    if (notice) body += `<button class="quiet" data-action="manual">Continue without a microphone</button>`;
  }
  $('screen').innerHTML = `<p class="eyebrow">${eyebrow}</p>
    <button class="passage-button" data-action="choose" ${phase !== 'ready' ? 'disabled' : ''} aria-label="Change passage"><h1>${escape(title(s.passage))}</h1>${phase === 'ready' ? chevron : ''}</button>
    <p class="reference">${range(s.passage)}</p>${dots}${body}
    ${notice ? `<p class="status error" role="alert">${escape(notice)}</p>` : ''}
    ${storageBlocked ? '<p class="status error">Saved progress could not be read. Export it from Your passages before continuing.</p>' : ''}`;
}

function evidenceHtml(): string {
  if (!draft) return '';
  const missing = coverage(draft.passage, draft.heard);
  const lines = draft.issues.map(i => `${i.surah}:${i.ayah} · ${issueLabels[i.kind] ?? 'Check this place'}`);
  if (draft.listening === 'tilawa' && missing.missing.length) lines.push(`Not confidently followed: ${missing.missing.join(', ')}`);
  if (missing.outside.length) lines.push(`Also heard: ${missing.outside.join(', ')}`);
  if (draft.listening !== 'tilawa') lines.push('This attempt needs your own check; the listener was unavailable.');
  if (!lines.length) return '<p class="caption" style="margin:0 0 24px">Compare the complete passage, including its beginning and ending.</p>';
  return `<details><summary>${draft.issues.length ? `${draft.issues.length} possible ${draft.issues.length === 1 ? 'place' : 'places'} to check` : 'A note from the listener'}</summary><ul>${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul><p>These are suggestions, not a recitation grade.</p></details>`;
}

const listener = new HifzListener({
  status(text) { setupStatus = text; if ($('setup-status')) $('setup-status').textContent = text; },
  heard(ref, confidence) {
    if (!draft) return;
    if (!draft.heard.includes(ref)) draft.heard.push(ref);
    const [surah, ayah] = ref.split(':').map(Number);
    if (verses.some(v => v.surah === surah && v.ayah === ayah)) monitor?.recognized({ surah, ayah }, confidence);
    noteMismatch();
    if (phase === 'listening') renderHint();
  },
  decoded(text) { if (phase === 'listening') monitor?.decoded(text, performance.now()); },
  preamble(complete) {
    if (phase !== 'listening') return;
    monitor?.preamble(complete, performance.now());
    renderHint();
  },
  issue(issue, total) {
    if (!draft) return;
    const mapped = displayIssue(issue, total, verses.find(v => v.surah === issue.surah && v.ayah === issue.ayah));
    if (phase === 'listening' && inPassage(mapped, draft.passage)) noteDifficulty(mapped);
    if (!draft.issues.some(i => i.surah === mapped.surah && i.ayah === mapped.ayah && i.word === mapped.word && i.kind === mapped.kind)) {
      draft.issues.push(mapped);
      if (phase === 'listening' && inPassage(mapped, draft.passage)) {
        liveIssue = { issue: mapped, at: performance.now() };
        liveHint = null;
        renderHint();
      }
    }
  },
  level(level, durationMs) {
    if (phase !== 'listening') return;
    $('orb').style.setProperty('--level', String(level));
    monitor?.audio(level, durationMs, performance.now());
    if (level > .14) {
      if (performance.now() - voiceAt > 900) speechTurn++;
      voiceAt = performance.now(); flow?.voice(voiceAt);
    }
  },
  progress(position) {
    const verse = verses.find(v => v.surah === position.surah && v.ayah === position.ayah);
    if (!draft || !verse || !validProgress(position, verse)) return;
    if (!monitor?.progress(position, performance.now()) || !inPassage(position, draft.passage)) {
      offTrackPosition = mergeWordProgress(offTrackPosition, position);
      noteMismatch();
      if (phase === 'listening') renderHint();
      return;
    }
    if (!monitor.mismatch) {
      offTrackPosition = undefined;
      const help = cueShown ?? pendingCue;
      const corrected = help && position.ayah === help.ayah && position.matched_indices.length
        && (help.word < 0 || (speechTurn > cueTurn && position.matched_indices.includes(help.word - wordOffset(verse))));
      if (corrected) { pendingCue = null; cueShown = null; cueUnavailable = false; }
    }
    listener.expectAyah(monitor.expected);
    const accumulated = mergeWordProgress(livePositions.get(position.ayah), position);
    if (!latestPosition || latestPosition.ayah !== accumulated.ayah || latestPosition.word_index !== accumulated.word_index
      || latestPosition.matched_indices.join(',') !== accumulated.matched_indices.join(',')) progressAt = performance.now();
    livePositions.set(position.ayah, accumulated);
    latestPosition = accumulated;
    flow?.track({ surah: position.surah, ayah: position.ayah, word: position.word_index, matched: position.matched_indices }, performance.now());
    if (liveHint && (position.ayah > liveHint.ayah || (position.ayah === liveHint.ayah && position.word_index > liveHint.word))) liveHint = null;
    if (phase === 'listening' || phase === 'finishing') renderHint();
  },
  failure() {
    if (draft) draft.listening = 'unavailable';
    notice = 'Listening was interrupted. Check this attempt yourself.';
    if (phase === 'listening') { memoryBusy = false; cuePlaying = false; reciter.cancel(); void finish(); }
  },
});

function memoryProgressHtml(): string {
  const fraction = stepIndex / memory.length;
  const label = memory[stepIndex]?.stage === 'read' ? `Read ${memory[stepIndex].round} of 2`
    : memory[stepIndex]?.stage === 'connect' ? 'Bring it together' : 'From memory';
  return `<div class="memory-progress"><div class="progress-ring" role="progressbar" aria-label="Memorization practice" aria-valuemin="0" aria-valuemax="${memory.length}" aria-valuenow="${stepIndex}" style="--progress:${fraction * 360}deg"><span>${stepIndex}<small> / ${memory.length}</small></span></div><span>${label}</span></div>`;
}

function noteDifficulty(issue: PossibleIssue): void {
  if (isMemory() || cuePlaying || phase !== 'listening' || cueTurn === speechTurn) return;
  cueTurn = speechTurn;
  const count = coach.note(issue, speechTurn);
  pendingCue = issue;
  if (count >= 2) {
    cueShown = issue;
    if (draft) draft.textRevealed = true;
  }
}
function noteMismatch(): void {
  if (monitor?.mismatch?.kind === 'different') noteDifficulty({ ...monitor.mismatch.expected, word: -1, kind: 'different_ayah' });
}

async function playCue(issue: PossibleIssue): Promise<void> {
  if (phase !== 'listening' || cuePlaying || memoryBusy || !draft) return;
  const generation = attemptGeneration;
  const target = { surah: issue.surah, ayah: issue.ayah };
  pendingCue = null; cuePlaying = true; cueUnavailable = false;
  draft.hints.push({ ayah: issue.ayah, word: Math.max(0, issue.word) });
  listener.pauseInput(); renderHint();
  const played = await reciter.play(target.surah, target.ayah);
  if (generation !== attemptGeneration || phase !== 'listening') return;
  cueUnavailable = !played;
  // Discard the loudspeaker tail before opening recognition again.
  await new Promise(resolve => setTimeout(resolve, 450));
  if (generation !== attemptGeneration || phase !== 'listening') return;
  try {
    await listener.restart(target);
    if (generation !== attemptGeneration) return;
    voiceAt = -Infinity; speechTurn++; cuePlaying = false; lastLiveRender = ''; renderHint();
  } catch {
    cuePlaying = false; listener.dispose();
    if (draft) draft.listening = 'unavailable';
    notice = 'Listening stopped. You can start again when you’re ready.';
    void finish();
  }
}

async function finishMemoryPass(): Promise<void> {
  if (!isMemory() || phase !== 'listening' || memoryBusy || !draft) return;
  memoryBusy = true;
  try { await listener.checkpoint(); }
  catch { memoryBusy = false; if (draft) draft.listening = 'unavailable'; void finish(); return; }
  if (phase !== 'listening' || !draft) return;
  memoryPending = draft.listening === 'tilawa' && passMatched(step().passage, livePositions, draft.issues, !!monitor?.mismatch);
  draft.finishedAt = new Date().toISOString();
  phase = 'check';
  await advanceMemory();
}

async function advanceMemory(): Promise<void> {
  if (memoryPending === null || !draft) return;
  const matched = memoryPending;
  const stage = memory[stepIndex].stage;
  const independent = !draft.textRevealed && !draft.hints.length;
  const advance = matched && (stage === 'read' || independent);
  if (!save(matched ? independent ? 'independent' : 'assisted' : draft.issues.length ? 'repair' : 'uncertain')) return;
  const generation = attemptGeneration;
  memoryPending = null;
  memoryMessage = matched ? advance ? 'Matched ✓' : 'Matched. Now without looking.' : 'Let’s try that once more.';
  if (advance) stepIndex++;
  retryStudy = !matched;
  if (stepIndex >= steps.length) {
    await listener.stop();
    if (generation !== attemptGeneration) return;
    memoryBusy = false; draft = null; phase = 'complete'; render(); return;
  }
  phase = 'listening';
  $('live').classList.add('between-passes');
  $('memory-meter').innerHTML = memoryProgressHtml();
  $('memory-message').textContent = memoryMessage;
  await new Promise(resolve => setTimeout(resolve, 1700));
  if (generation !== attemptGeneration || phase !== 'listening') return;
  const p = step().passage;
  livePositions.clear(); latestPosition = null; offTrackPosition = undefined; liveIssue = null; liveHint = null;
  lastTextRender = ''; lastLiveRender = ''; progressAt = 0; voiceAt = -Infinity;
  monitor = new RecitationMonitor(p, performance.now());
  flow = new RecitationFlow(p, new Map(currentVerses().map(v => [v.ayah, recitationWords(v).length])), null, performance.now());
  showLiveText = visibleStudy();
  draft = { id: crypto.randomUUID(), passage: { ...p }, mode: 'practice', startedAt: new Date().toISOString(), finishedAt: '',
    outcome: 'uncertain', hints: [], textRevealed: showLiveText, listening: 'tilawa', heard: [], issues: [], unit: step().unit };
  try { await listener.restart({ surah: p.surah, ayah: p.start }); }
  catch { memoryBusy = false; draft.listening = 'unavailable'; void finish(); return; }
  if (generation !== attemptGeneration) return;
  memoryBusy = false; memoryMessage = '';
  $('live').classList.remove('between-passes'); renderHint();
}

async function start(useManual = manual): Promise<void> {
  if (phase !== 'ready' || storageBlocked) return;
  const generation = ++attemptGeneration;
  const s = step();
  manual = useManual;
  notice = '';
  setupStatus = '';
  livePositions.clear(); latestPosition = null; offTrackPosition = undefined; liveIssue = null; lastLiveRender = ''; progressAt = 0; voiceAt = -Infinity;
  memoryBusy = false; memoryMessage = ''; memoryPending = null;
  pendingCue = null; cueShown = null; cuePlaying = false; cueUnavailable = false; cueTurn = -1; speechTurn = 0;
  monitor = null;
  draft = { id: crypto.randomUUID(), passage: { ...s.passage }, mode: s.kind === 'review' ? 'review' : 'practice',
    startedAt: new Date().toISOString(), finishedAt: '', outcome: 'uncertain', hints: [], textRevealed: peeked || visibleStudy(),
    listening: useManual ? 'manual' : 'tilawa', heard: [], issues: [], unit: s.unit };
  phase = 'starting';
  render();
  try {
    // start() creates/resumes the audio context within the button's user gesture.
    if (!useManual) await listener.start({ surah: s.passage.surah, ayah: s.passage.start });
    if (generation !== attemptGeneration) return;
    monitor = new RecitationMonitor(s.passage, performance.now());
    flow = new RecitationFlow(s.passage, new Map(currentVerses().map(v => [v.ayah, recitationWords(v).length])), null, performance.now());
    liveHint = null;
    showLiveText = visibleStudy();
    phase = 'listening';
    render();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  } catch {
    if (generation !== attemptGeneration) return;
    listener.dispose();
    draft = null;
    phase = 'ready';
    notice = 'Could not start listening. Check microphone permission and retry, or practise without it.';
    render();
  }
}

async function finish(): Promise<void> {
  if (phase !== 'listening') return;
  attemptGeneration++; reciter.cancel(); pendingCue = null; cuePlaying = false;
  $('live').classList.remove('between-passes');
  phase = 'finishing';
  showLiveText = false;
  liveHint = null;
  render();
  try { if (!manual) await listener.stop(); }
  catch { if (draft) draft.listening = 'unavailable'; notice = 'The listener could not finish. Check the whole passage yourself.'; }
  if (!draft) return;
  // A temporary recognition delay is not a lasting recitation error. Keep an
  // uncertainty note only when final audio processing still could not recover.
  if (monitor?.mismatch?.kind === 'unmatched') {
    draft.issues.push({ ...monitor.mismatch.expected, word: -1, kind: 'unmatched_recitation' });
  }
  draft.finishedAt = new Date().toISOString();
  phase = 'check';
  if (isMemory()) {
    draft.unit = true;
    if (!save('uncertain')) return;
    draft = null; memoryBusy = false; phase = 'complete';
  }
  render();
  $('screen').querySelector<HTMLElement>('[data-action="remembered"]')?.focus({ preventScroll: true });
}

function renderHint(): void {
  if (!steps.length) return;
  if (memoryBusy) return;
  $('memory-meter').hidden = !isMemory();
  if (isMemory()) $('memory-meter').innerHTML = memoryProgressHtml();
  $('memory-message').hidden = !isMemory();
  $('memory-message').textContent = memoryMessage;
  $('finish-button').textContent = isMemory() ? 'End practice' : 'Finish';
  $('hint').innerHTML = liveHint && !showLiveText ? `<p class="quran" lang="ar" dir="rtl">${escape(recitationWords(currentVerses().find(v => v.ayah === liveHint!.ayah)!)[liveHint.word] ?? '')}</p><p class="caption">Ayah ${liveHint.ayah} · a little help</p>` : '';
  $('hint').hidden = !liveHint || showLiveText;
  const text = $('live-text');
  const html = passageHtml(true, true, !showLiveText) + (isMemory() ? '' : offTrackHtml());
  $('live').classList.toggle('study', visibleStudy());
  const followEnd = text.scrollHeight - text.scrollTop - text.clientHeight < 60;
  text.hidden = !html;
  if (html !== lastTextRender) {
    text.innerHTML = html;
    lastTextRender = html;
    // Keep new recited words in view, but let the reader scroll back themselves.
    if (!showLiveText && followEnd) text.scrollTop = text.scrollHeight;
  }
  text.setAttribute('aria-label', showLiveText ? 'Complete passage' : 'Matched recitation');
  $('text-button').textContent = showLiveText ? 'Hide upcoming' : 'Show text';
  const helpVerse = cueShown && verses.find(v => v.surah === cueShown!.surah && v.ayah === cueShown!.ayah);
  $('focused-help').hidden = !helpVerse;
  $('focused-help').innerHTML = helpVerse ? `<span class="help-label">Let’s practise this part</span><p class="quran" lang="ar" dir="rtl">${escape(recitationWords(helpVerse).join(' '))}</p>` : '';
  $('cue-controls').hidden = !cuePlaying && !cueUnavailable;
  $('cue-button').textContent = cuePlaying ? 'Skip audio' : 'Listen to this ayah';
  renderLiveFeedback();
}

function renderLiveFeedback(): void {
  if (phase !== 'listening' && phase !== 'finishing') return;
  if (memoryBusy) return;
  const now = performance.now();
  const mismatch = !manual && phase === 'listening' ? monitor?.mismatch : null;
  const alert = !mismatch && phase === 'listening' && liveIssue && now - liveIssue.at < 8000 ? liveIssue.issue : null;
  const following = latestPosition && now - progressAt < 3500;
  const hearing = now - voiceAt < 1500;
  const key = JSON.stringify([phase, manual, showLiveText, latestPosition, following, hearing, flow?.atEnd, alert, mismatch, monitor?.opening, draft?.issues.length, cuePlaying, cueUnavailable]);
  if (key === lastLiveRender) return;
  lastLiveRender = key;
  $('orb').classList.toggle('warning', mismatch?.kind === 'unmatched');
  $('orb').classList.toggle('mismatch', !!alert || mismatch?.kind === 'different');
  $('live-mismatch').hidden = !mismatch;
  if (mismatch) {
    $('live-mismatch').classList.toggle('different', mismatch.kind === 'different');
    const expected = `${mismatch.expected.surah}:${mismatch.expected.ayah}`;
    const label = mismatch.kind === 'different' ? 'Try this ayah again' : 'Still listening';
    const reference = mismatch.kind === 'different'
      ? `Return to ${expected}`
      : `Take your time · ${expected}`;
    if ($('mismatch-label').textContent !== label) $('mismatch-label').textContent = label;
    if ($('mismatch-reference').textContent !== reference) $('mismatch-reference').textContent = reference;
    if (mismatch.kind === 'different' && draft
      && !draft.issues.some(i => i.kind === 'different_ayah' && i.surah === mismatch.expected.surah && i.ayah === mismatch.expected.ayah)) {
      draft.issues.push({ ...mismatch.expected, word: -1, kind: 'different_ayah' });
    }
  }
  const matched = latestPosition?.matched_indices.length ?? 0;
  $('live-label').textContent = phase === 'finishing' ? 'Finishing…' : manual ? 'Recite at your own pace'
    : monitor?.opening ? monitor.opening === 'complete' ? 'Bismillah heard' : 'Bismillah'
    : latestPosition ? `Ayah ${latestPosition.ayah} · ${matched} of ${latestPosition.total_words} words followed`
      : `Ayah ${step().passage.start} · ready to listen`;
  const ending = latestPosition?.matched_indices.includes(latestPosition.total_words - 1);
  $('live-status').textContent = phase === 'finishing' ? 'Checking the last words' : manual ? ''
    : mismatch ? hearing ? 'Hearing you · matching words…' : 'Microphone on'
    : monitor?.opening ? monitor.opening === 'complete' ? `Continue with ayah ${step().passage.start}` : 'Listening to the opening…'
    : ending && latestPosition!.ayah < step().passage.end ? `Continue with ayah ${latestPosition!.ayah + 1}`
    : ending ? flow?.atEnd ? 'End reached · pause to finish' : 'End reached · finish when ready'
    : hearing && (!following || !matched) ? 'Hearing you · matching words…'
    : following && matched ? 'Following your recitation'
    : matched ? 'Waiting for your next words' : 'Waiting for your first words';
  const verse = latestPosition && currentVerses().find(v => v.ayah === latestPosition!.ayah);
  $('live-progress').hidden = !verse || manual || phase !== 'listening';
  if (verse && latestPosition) {
    const count = recitationWords(verse).length;
    $('live-progress').setAttribute('aria-label', `Ayah ${verse.ayah}: ${matched} of ${count} words followed`);
    $('live-progress').innerHTML = Array.from({ length: count }, (_, i) => `<i class="${wordFeedback(verse, i + wordOffset(verse), latestPosition!, draft?.issues ?? [])}" aria-hidden="true"></i>`).join('');
  }
  $('live-warning').hidden = !alert;
  if (alert) {
    const label = issueLabels[alert.kind] ?? 'Check this place';
    const reference = `Ayah ${alert.ayah}`;
    if ($('warning-label').textContent !== label) $('warning-label').textContent = label;
    if ($('warning-reference').textContent !== reference) $('warning-reference').textContent = reference;
    $<HTMLButtonElement>('correction-help').hidden = alert.word < 0 || showLiveText;
    $('correction-help').textContent = (alert.words ?? 1) > 1 ? 'Show the ayah' : 'Show the word';
  }
  $('live-review-note').textContent = !alert && !mismatch && draft?.issues.length ? `${draft.issues.length} ${draft.issues.length === 1 ? 'place' : 'places'} to check when you finish` : '';
  $('live-review-note').hidden = true;
  if (cuePlaying) $('live-status').textContent = 'Listen, then your turn';
  if (isMemory()) {
    $('live-progress').hidden = true;
    $('live-label').textContent = `${title(step().passage)} · ${range(step().passage)}`;
    $('live-status').textContent = mismatch ? mismatch.kind === 'different' ? 'Try this ayah again' : 'Listening · take your time'
      : visibleStudy() ? 'Read aloud. Pause at the end.' : memory[stepIndex].stage === 'connect' ? 'Recite the whole passage from memory.' : 'Your turn, without looking.';
    $('live-mismatch').hidden = true; $('live-warning').hidden = true;
  }
}

function correctionHelp(): void {
  if (phase !== 'listening' || !liveIssue || !draft) return;
  const issue = liveIssue.issue;
  const verse = currentVerses().find(v => v.ayah === issue.ayah && v.surah === issue.surah);
  if (!verse || issue.word < 0) return;
  if ((issue.words ?? 1) > 1) {
    showLiveText = true;
    draft.textRevealed = true;
  } else giveHint({ ayah: issue.ayah, word: issue.word - wordOffset(verse) });
  renderHint();
}
function giveHint(position = flow?.hint()): void {
  if (phase !== 'listening' || memoryBusy || cuePlaying || !position || !draft) return;
  draft.hints.push(position);
  liveHint = position;
  renderHint();
}
function revealText(): void {
  if (phase !== 'listening' || memoryBusy || cuePlaying || !draft) return;
  showLiveText = !showLiveText;
  if (showLiveText) draft.textRevealed = true;
  renderHint();
  wakeControls();
}
function wakeControls(): void {
  if (phase !== 'listening') return;
  $('live-controls').classList.add('awake');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => $('live-controls').classList.remove('awake'), 2400);
}
setInterval(() => {
  if (phase !== 'listening') return;
  if (memoryBusy || cuePlaying) return;
  monitor?.tick(performance.now());
  renderLiveFeedback();
  if (isMemory()) {
    const paused = Number.isFinite(voiceAt) && performance.now() - voiceAt >= 1800;
    if ((monitor?.mismatch || draft?.issues.length) && paused) { void finishMemoryPass(); return; }
    if (flow?.tick(performance.now())?.type === 'finish') void finishMemoryPass();
    return;
  }
  if (pendingCue && performance.now() - voiceAt >= 1100) { void playCue(pendingCue); return; }
  if (monitor?.mismatch) return;
  // Let the live indication be read before an automatic finish or pause hint.
  if (liveIssue && performance.now() - liveIssue.at < 4500) return;
  const action = flow?.tick(performance.now());
  if (action?.type === 'hint') giveHint(action.position);
  else if (action?.type === 'finish') void finish();
}, 200);

function save(outcome: Outcome): boolean {
  if (phase !== 'check' || !draft || storageBlocked) return false;
  draft.outcome = outcome;
  const next = recordAttempt(progress, draft);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    progress = next;
    rawProgress = JSON.stringify(next);
    return true;
  } catch {
    notice = 'Progress could not be saved. Free browser storage and retry, or export this attempt from Your passages.';
    render();
    return false;
  }
}
function remembered(): void {
  const assisted = !!(draft?.hints.length || draft?.textRevealed);
  if (!save(assisted ? 'assisted' : 'independent')) return;
  if (assisted) {
    step().kind = 'learn';
    phase = 'ready'; peeked = false; notice = '';
    void start(manual);
  } else if (stepIndex + 1 < steps.length) {
    stepIndex++;
    ready();
  } else nextDue();
}
function ready(): void {
  phase = 'ready'; draft = null; peeked = false; notice = ''; flow = null;
  $('live-controls').classList.remove('awake');
  render();
}
function nextDue(): void {
  completed.add(passageId(step().passage));
  phase = 'complete'; draft = null; render();
}
function choose(p: Passage, review: boolean, oneAtATime = preferences.oneAtATime): void {
  manual = false;
  view = 'practice'; retryStudy = false; coach = new RevisionCoach();
  preferences = { ...preferences, passage: { ...p }, review, oneAtATime };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); } catch { /* Progress saving reports failures separately. */ }
  memory = review ? [] : memorySteps(p);
  steps = review ? lessonSteps(p, true, false) : memory.map(s => ({ passage: s.passage, unit: s.unit, kind: s.stage === 'read' ? 'learn' : 'connect' })); stepIndex = 0;
  ready();
}

function openSetup(): void {
  if (phase === 'starting' || phase === 'listening' || phase === 'finishing' || phase === 'check') return;
  $<HTMLSelectElement>('surah').value = String(preferences.passage.surah);
  $<HTMLInputElement>('from').value = String(preferences.passage.start);
  $<HTMLInputElement>('to').value = String(preferences.passage.end);
  $('setup-mode').textContent = preferences.review ? 'Revise' : 'Memorize';
  updateLimits();
  $('setup-error').hidden = true;
  view = 'picker'; render();
}
function updateLimits(): void {
  const max = String(counts.get(Number($<HTMLSelectElement>('surah').value)) ?? 1);
  $<HTMLInputElement>('from').max = max;
  $<HTMLInputElement>('to').max = max;
}
function friendlyDate(day: string): string {
  const now = localDay();
  if (day <= now) return 'today';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function openLibrary(): void {
  if (phase === 'starting' || phase === 'listening' || phase === 'finishing') return;
  const cards = Object.values(progress.cards).sort((a, b) => a.due.localeCompare(b.due));
  $('library-content').innerHTML = cards.length ? `<div class="library-list">${cards.map(c => `<button class="library-item" data-passage="${passageId(c)}" ${phase === 'check' ? 'disabled' : ''}><span>${escape(title(c))}<small>${range(c)}</small></span><small>${c.due <= localDay() ? 'Ready to review' : friendlyDate(c.due)}</small></button>`).join('')}</div>` : '<p class="status">Your first connected recall will appear here.</p>';
  const recent = progress.attempts.slice(-5).reverse();
  if (recent.length) $('library-content').innerHTML += `<details><summary>Recent practice</summary><ul>${recent.map(a => `<li>${escape(title(a.passage))} · ${range(a.passage)} · ${escape(a.outcome)}${a.unit ? ' (learning unit)' : ''}</li>`).join('')}</ul></details>`;
  $<HTMLButtonElement>('new-passage').disabled = phase === 'check';
  $<HTMLDialogElement>('library').showModal();
}
function exportProgress(): void {
  const data = storageBlocked ? { unreadableProgress: rawProgress } : { ...progress, unsavedAttempt: phase === 'check' ? draft : null };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `tilawa-hifz-${localDay()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('screen').addEventListener('click', event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'start') void start();
  else if (action === 'memorize' || action === 'revise') { preferences.review = action === 'revise'; openSetup(); }
  else if (action === 'home') goHome();
  else if (action === 'save-memory') void advanceMemory();
  else if (action === 'manual') void start(true);
  else if (action === 'choose') openSetup();
  else if (action === 'peek' && phase === 'ready') { peeked = true; render(); }
  else if (action === 'cancel' && phase === 'starting') { attemptGeneration++; listener.dispose(); ready(); }
  else if (action === 'remembered') remembered();
  else if (action === 'repair' && save('repair')) { step().kind = 'learn'; ready(); }
  else if (action === 'uncertain' && save('uncertain')) nextDue();
  else if (action === 'repeat') choose(preferences.passage, preferences.review, true);
});
function goHome(): void {
  if (phase === 'listening' || phase === 'finishing') return;
  attemptGeneration++; reciter.cancel(); listener.dispose();
  phase = 'ready'; draft = null; view = 'paths'; render();
}
$('home').addEventListener('click', goHome);
$('setup-back').addEventListener('click', goHome);
$('cue-button').addEventListener('click', () => {
  if (cuePlaying) reciter.cancel();
  else {
    const ref = cueShown ?? monitor?.expected;
    if (ref) void playCue({ ...ref, word: cueShown?.word ?? -1, kind: 'audio_help' });
  }
});
$('finish-button').addEventListener('click', () => void finish());
$('hint-button').addEventListener('click', () => giveHint());
$('text-button').addEventListener('click', revealText);
$('correction-help').addEventListener('click', correctionHelp);
document.addEventListener('pointermove', wakeControls);
document.addEventListener('pointerdown', wakeControls);
document.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).matches('input,select,textarea') || document.querySelector('dialog[open]')) return;
  wakeControls();
  if (phase === 'listening' && !memoryBusy && !cuePlaying && event.key.toLowerCase() === 'h') { event.preventDefault(); giveHint(); }
  if (phase === 'listening' && event.key.toLowerCase() === 'r') { event.preventDefault(); revealText(); }
  if (event.code === 'Space' && !(event.target as HTMLElement).closest('button,a')) {
    event.preventDefault();
    if (phase === 'listening') void finish();
    else if (phase === 'ready' && view === 'practice') void start();
  }
});
$('library-open').addEventListener('click', openLibrary);
$('new-passage').addEventListener('click', () => { $<HTMLDialogElement>('library').close(); openSetup(); });
$('export').addEventListener('click', exportProgress);
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => $<HTMLDialogElement>(button.dataset.close!).close()));
$('library-content').addEventListener('click', event => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-passage]')?.dataset.passage;
  if (!id || phase === 'check') return;
  $<HTMLDialogElement>('library').close(); choose(progress.cards[id], true, false);
});
$('surah').addEventListener('change', () => { updateLimits(); $<HTMLInputElement>('from').value = '1'; $<HTMLInputElement>('to').value = String(Math.min(3, counts.get(Number($<HTMLSelectElement>('surah').value)) ?? 1)); });
$('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  const p = { surah: Number($<HTMLSelectElement>('surah').value), start: Number($<HTMLInputElement>('from').value), end: Number($<HTMLInputElement>('to').value) };
  if (!validPassage(p, counts)) { $('setup-error').textContent = 'Choose an ordered range within this surah.'; $('setup-error').hidden = false; return; }
  preferences.pause = null;
  choose(p, preferences.review, true);
});
window.addEventListener('pagehide', () => { reciter.cancel(); listener.dispose(); });
window.addEventListener('beforeunload', event => {
  if (phase === 'listening' || phase === 'finishing' || phase === 'check') { event.preventDefault(); event.returnValue = ''; }
});

async function boot(): Promise<void> {
  const response = await fetch('/quran.json');
  if (!response.ok) throw new Error('The Quran text could not be loaded. Refresh to try again.');
  verses = await response.json();
  for (const v of verses) counts.set(v.surah, Math.max(v.ayah, counts.get(v.surah) ?? 0));
  $('surah').innerHTML = verses.filter(v => v.ayah === 1).map(v => `<option value="${v.surah}">${v.surah}. ${escape(v.surah_name_en)} · ${escape(v.surah_name)}</option>`).join('');
  try { rawProgress = localStorage.getItem(STORAGE_KEY); progress = parseProgress(rawProgress, counts); }
  catch { storageBlocked = true; }
  try {
    const saved: Preferences = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved && validPassage(saved.passage, counts) && typeof saved.review === 'boolean' && typeof saved.oneAtATime === 'boolean'
      && [null, 8000, 12000].includes(saved.pause)) preferences = saved;
  } catch { /* An invalid preference cannot overwrite progress. */ }
  steps = lessonSteps(preferences.passage, preferences.review, preferences.oneAtATime);
  render();
  // Retire a legacy service worker so old entry points cannot shadow this page.
  if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => void r.unregister()));
}
void boot().catch(error => { $('screen').innerHTML = `<h1>One moment.</h1><p class="status error">${escape(error.message)}</p><button class="secondary" onclick="location.reload()">Try again</button>`; });
