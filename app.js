
(() => {
  "use strict";

  const QUESTIONS = Array.isArray(window.ENGLISH_GRAMMAR_QUESTIONS) ? window.ENGLISH_GRAMMAR_QUESTIONS : [];
  const STORAGE_KEY = "englishGrammar12.state.v1";
  const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 90];
  const VOICE_FORMATS = new Set(["FB", "OR", "EC", "EJ", "JE", "MX"]);
  const mainView = document.getElementById("mainView");
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");
  const toast = document.getElementById("toast");

  const questionById = new Map(QUESTIONS.map(q => [q.id, q]));
  const unitMap = new Map();
  QUESTIONS.forEach(q => {
    if (!unitMap.has(q.unitCode)) unitMap.set(q.unitCode, {name:q.unit, questions:[]});
    unitMap.get(q.unitCode).questions.push(q);
  });

  let activeView = "home";
  let currentQuestion = null;
  let selectedChoice = null;
  let selectedTokens = [];
  let selectedWordIndices = [];
  let lastTranscript = "";
  let recognition = null;
  let installPrompt = null;

  const state = loadState();

  function defaultState() {
    return {
      version: 1,
      profile: {
        userId: "student-" + Math.random().toString(36).slice(2, 10),
        name: "",
        startedAt: new Date().toISOString()
      },
      settings: {
        dailyCount: 12,
        voiceFirst: true,
        showUnitName: true,
        speechRate: 0.92,
        syncUrl: ""
      },
      stats: {
        totalAnswered: 0,
        correct: 0,
        almost: 0,
        wrong: 0,
        streak: 0,
        bestStreak: 0,
        lastStudyDate: null,
        completedDays: []
      },
      questionState: {},
      subcategoryState: {},
      history: [],
      session: null,
      lastNewCursor: 0
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const loaded = JSON.parse(raw);
      return mergeDefaults(defaultState(), loaded);
    } catch (error) {
      console.error(error);
      return defaultState();
    }
  }

  function mergeDefaults(base, loaded) {
    return {
      ...base,
      ...loaded,
      profile: {...base.profile, ...(loaded.profile || {})},
      settings: {...base.settings, ...(loaded.settings || {})},
      stats: {...base.stats, ...(loaded.stats || {})},
      questionState: loaded.questionState || {},
      subcategoryState: loaded.subcategoryState || {},
      history: Array.isArray(loaded.history) ? loaded.history : [],
      session: loaded.session || null
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error(error);
      showToast("保存領域が不足しました。記録をバックアップしてください。");
    }
  }

  function dateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(dateString, days) {
    const d = new Date(`${dateString}T12:00:00`);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }

  function daysBetween(a, b) {
    if (!a || !b) return Infinity;
    const da = new Date(`${a}T12:00:00`);
    const db = new Date(`${b}T12:00:00`);
    return Math.round((db - da) / 86400000);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeEnglish(value) {
    let text = String(value || "").toLowerCase().trim()
      .replace(/[’‘]/g, "'")
      .replace(/\bcan't\b/g, "cannot")
      .replace(/\bwon't\b/g, "will not")
      .replace(/\bshan't\b/g, "shall not")
      .replace(/\bn't\b/g, " not")
      .replace(/\bi'm\b/g, "i am")
      .replace(/\byou're\b/g, "you are")
      .replace(/\bhe's\b/g, "he is")
      .replace(/\bshe's\b/g, "she is")
      .replace(/\bit's\b/g, "it is")
      .replace(/\bwe're\b/g, "we are")
      .replace(/\bthey're\b/g, "they are")
      .replace(/\bi've\b/g, "i have")
      .replace(/\byou've\b/g, "you have")
      .replace(/\bwe've\b/g, "we have")
      .replace(/\bthey've\b/g, "they have")
      .replace(/\bi'd\b/g, "i would")
      .replace(/\byou'd\b/g, "you would")
      .replace(/\bhe'd\b/g, "he would")
      .replace(/\bshe'd\b/g, "she would")
      .replace(/\bwe'd\b/g, "we would")
      .replace(/\bthey'd\b/g, "they would")
      .replace(/\bi'll\b/g, "i will")
      .replace(/\byou'll\b/g, "you will")
      .replace(/\bhe'll\b/g, "he will")
      .replace(/\bshe'll\b/g, "she will")
      .replace(/\bwe'll\b/g, "we will")
      .replace(/\bthey'll\b/g, "they will")
      .replace(/[.,!?;:"“”()[\]{}]/g, " ")
      .replace(/\s+/g, " ");
    return text;
  }

  function normalizeJapanese(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[、。！？,.!?\s「」『』（）()・]/g, "");
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array.from({length:b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const curr = [i];
      for (let j = 1; j <= b.length; j++) {
        curr[j] = Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j < curr.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    if (!a && !b) return 1;
    const max = Math.max(a.length, b.length, 1);
    return 1 - levenshtein(a, b) / max;
  }

  function tokenF1(answer, expected) {
    const a = normalizeEnglish(answer).split(" ").filter(Boolean);
    const e = normalizeEnglish(expected).split(" ").filter(Boolean);
    if (!a.length || !e.length) return 0;
    const remaining = [...e];
    let match = 0;
    a.forEach(token => {
      const index = remaining.indexOf(token);
      if (index >= 0) {
        match++;
        remaining.splice(index, 1);
      }
    });
    const precision = match / a.length;
    const recall = match / e.length;
    return precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  }

  const criticalEnglish = new Set([
    "not","never","no","have","has","had","been","being","will","would","should",
    "must","may","might","can","could","cannot","to","if","unless","than","as",
    "who","whom","whose","which","that","where","when","why"
  ]);

  function missingCriticalWords(answer, expected) {
    const a = new Set(normalizeEnglish(answer).split(" "));
    const e = normalizeEnglish(expected).split(" ");
    return e.filter(t => criticalEnglish.has(t) && !a.has(t));
  }

  function gradeText(question, userAnswer) {
    const candidates = [question.answer, question.standardEnglish, question.standardJapanese, ...(question.alternatives || [])]
      .filter(Boolean);
    if (!String(userAnswer || "").trim()) return {result:"wrong", score:0, reason:"回答が入力されていません。"};

    if (question.format === "EJ") {
      const user = normalizeJapanese(userAnswer);
      let best = 0;
      candidates.forEach(c => {
        const expected = normalizeJapanese(c);
        best = Math.max(best, similarity(user, expected));
      });
      if (best >= 0.88) return {result:"correct", score:best};
      if (best >= 0.64) return {result:"almost", score:best, reason:"意味は近いですが、訳し落としや表現の違いがあります。"};
      return {result:"wrong", score:best, reason:"主語・時制・修飾関係をもう一度確認しましょう。"};
    }

    const user = normalizeEnglish(userAnswer);
    let best = 0;
    let bestCandidate = candidates[0] || "";
    candidates.forEach(c => {
      const expected = normalizeEnglish(c);
      const combined = Math.max(similarity(user, expected), tokenF1(user, expected));
      if (combined > best) {
        best = combined;
        bestCandidate = c;
      }
    });
    const missing = missingCriticalWords(userAnswer, bestCandidate);
    if (best >= 0.94 && missing.length === 0) return {result:"correct", score:best};
    if (best >= 0.78 && missing.length <= 1) {
      return {result:"almost", score:best, reason:missing.length ? `重要語「${missing[0]}」を確認しましょう。` : "語形・冠詞・語順を少し確認しましょう。"};
    }
    return {result:"wrong", score:best, reason:missing.length ? `重要語「${missing.join("・")}」が不足しています。` : "文法の形と語順を確認しましょう。"};
  }

  function getQuestionState(id) {
    if (!state.questionState[id]) {
      state.questionState[id] = {
        seen:false, attempts:0, correct:0, almost:0, wrong:0,
        stage:0, nextDue:null, lastResult:null, lastAt:null
      };
    }
    return state.questionState[id];
  }

  function getSubcategoryState(code) {
    if (!state.subcategoryState[code]) {
      const sample = QUESTIONS.find(q => q.subcategoryCode === code);
      state.subcategoryState[code] = {
        code,
        name: sample?.subcategory || code,
        unit: sample?.unit || "",
        attempts:0, correct:0, almost:0, wrong:0,
        reasonAttempts:0, reasonCorrect:0, explanationSuccess:0,
        recent:[], lastAt:null
      };
    }
    return state.subcategoryState[code];
  }

  function isWeakSubcategory(code) {
    const s = getSubcategoryState(code);
    const today = dateKey();
    const wrong7 = s.recent.filter(x => x.result === "wrong" && daysBetween(x.date, today) <= 7).length;
    const wrong30 = s.recent.filter(x => x.result === "wrong" && daysBetween(x.date, today) <= 30).length;
    return wrong7 >= 2 || wrong30 >= 3;
  }

  function masteryScore(code) {
    const s = getSubcategoryState(code);
    if (!s.attempts) return 0;
    const base = (s.correct + s.almost * 0.45) / s.attempts * 75;
    const reason = s.reasonAttempts ? s.reasonCorrect / s.reasonAttempts * 15 : 0;
    const explain = Math.min(10, s.explanationSuccess * 3.34);
    return Math.max(0, Math.min(100, Math.round(base + reason + explain)));
  }

  function dueQuestions() {
    const today = dateKey();
    return QUESTIONS.filter(q => {
      const qs = state.questionState[q.id];
      return qs?.seen && qs.nextDue && qs.nextDue <= today;
    }).sort((a,b) => {
      const ad = state.questionState[a.id].nextDue || "";
      const bd = state.questionState[b.id].nextDue || "";
      return ad.localeCompare(bd) || a.difficulty - b.difficulty;
    });
  }

  function unseenQuestions() {
    return QUESTIONS.filter(q => !state.questionState[q.id]?.seen)
      .sort((a,b) => a.unitCode - b.unitCode || a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  }

  function weakQuestions() {
    const weakCodes = new Set(
      Object.keys(state.subcategoryState).filter(isWeakSubcategory)
    );
    return QUESTIONS.filter(q => weakCodes.has(q.subcategoryCode) && state.questionState[q.id]?.seen);
  }

  function pickUnique(target, pool, count, origin, predicate = () => true) {
    const selected = new Set(target.map(x => x.id));
    for (const q of pool) {
      if (target.length >= count) break;
      if (!selected.has(q.id) && predicate(q)) {
        target.push({id:q.id, origin});
        selected.add(q.id);
      }
    }
  }

  function buildSession(mode = "daily") {
    const dailyCount = Number(state.settings.dailyCount) || 12;
    const tasks = [];
    const due = dueQuestions();
    const unseen = unseenQuestions();
    const weak = weakQuestions();

    if (mode === "weak") {
      pickUnique(tasks, weak, dailyCount, "苦手");
      pickUnique(tasks, due, dailyCount, "復習");
      pickUnique(tasks, unseen, dailyCount, "新規");
    } else if (mode === "unit") {
      const unitCode = Number(state.pendingUnitCode);
      const pool = QUESTIONS.filter(q => q.unitCode === unitCode)
        .sort((a,b) => (state.questionState[a.id]?.seen ? 1 : 0) - (state.questionState[b.id]?.seen ? 1 : 0) || a.difficulty - b.difficulty);
      pickUnique(tasks, pool, dailyCount, "単元");
    } else {
      pickUnique(tasks, due, 4, "復習");
      pickUnique(tasks, unseen, Math.min(dailyCount, tasks.length + 3), "新規");

      const newSubcats = new Set(tasks.filter(t => t.origin === "新規").map(t => questionById.get(t.id)?.subcategoryCode));
      const confirmations = QUESTIONS.filter(q =>
        newSubcats.has(q.subcategoryCode) &&
        !tasks.some(t => t.id === q.id)
      );
      pickUnique(tasks, confirmations, Math.min(dailyCount, tasks.length + 2), "確認");

      const voicePool = [...weak, ...due, ...unseen].filter(q => VOICE_FORMATS.has(q.format));
      pickUnique(tasks, voicePool, Math.min(dailyCount, tasks.length + 2), "音声");

      const structurePool = [...due, ...unseen, ...QUESTIONS].filter(q => q.format === "ST");
      pickUnique(tasks, structurePool, Math.min(dailyCount, tasks.length + 1), "文構造");

      pickUnique(tasks, weak, dailyCount, "苦手");
      pickUnique(tasks, due, dailyCount, "復習");
      pickUnique(tasks, unseen, dailyCount, "新規");
      pickUnique(tasks, QUESTIONS, dailyCount, "補充");
    }

    return {
      date: dateKey(),
      mode,
      tasks: tasks.slice(0, dailyCount),
      index: 0,
      answered: 0,
      completed: false,
      results: {correct:0, almost:0, wrong:0}
    };
  }

  function startSession(mode = "daily", unitCode = null) {
    if (mode === "unit") state.pendingUnitCode = unitCode;
    if (mode === "daily" && state.session && state.session.date === dateKey() && !state.session.completed && state.session.tasks?.length) {
      renderStudy();
      return;
    }
    state.session = buildSession(mode);
    saveState();
    renderStudy();
  }

  function currentTask() {
    return state.session?.tasks?.[state.session.index] || null;
  }

  function renderStudy() {
    activeView = "study";
    updateNav();
    const session = state.session;
    if (!session || session.completed || session.index >= session.tasks.length) {
      completeSession();
      return;
    }
    const task = currentTask();
    const q = questionById.get(task.id);
    if (!q) {
      session.index++;
      saveState();
      renderStudy();
      return;
    }
    currentQuestion = q;
    selectedChoice = null;
    selectedTokens = [];
    selectedWordIndices = [];
    lastTranscript = "";

    const progress = session.tasks.length ? (session.index / session.tasks.length) * 100 : 0;
    const unitChip = state.settings.showUnitName ? `<span class="chip">${escapeHTML(q.unit)}</span>` : "";
    mainView.innerHTML = `
      <div class="session-header">
        <div class="progress-track" style="flex:1"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="session-count">${session.index + 1} / ${session.tasks.length}</div>
      </div>
      <section class="question-card">
        <div class="question-meta">
          ${unitChip}
          <span class="chip">${escapeHTML(q.formatLabel)}</span>
          <span class="chip level">Lv.${q.difficulty}</span>
          <span class="chip review">${escapeHTML(task.origin)}</span>
        </div>
        <p class="instruction">${escapeHTML(q.instruction)}</p>
        <div class="question-text">${escapeHTML(q.prompt)}</div>
        ${q.stimulus ? `<div class="stimulus">${escapeHTML(q.stimulus)}</div>` : ""}
        <div id="answerArea">${answerAreaHTML(q)}</div>
        <button id="submitAnswer" class="primary-button" ${q.format === "MC" ? "disabled" : ""}>確認する</button>
        <button id="skipUnclear" class="secondary-button" style="margin-top:10px">音声を聞き取れない／あとで答える</button>
        <div id="feedbackArea"></div>
      </section>`;
    bindQuestionEvents(q);
  }

  function answerAreaHTML(q) {
    if (q.format === "MC") {
      return `<div class="choice-grid">${q.choices.map((c,i) =>
        `<button class="choice-button" data-choice="${i+1}"><strong>${i+1}.</strong> ${escapeHTML(c)}</button>`
      ).join("")}</div>`;
    }
    if (q.format === "ST") {
      const tokens = q.standardEnglish.split(/\s+/);
      return `
        <div class="selected-words" id="selectedPhrase">選んだ語句がここに表示されます</div>
        <div class="word-bank">${tokens.map((t,i) =>
          `<button class="sentence-token" data-token-index="${i}">${escapeHTML(t)}</button>`
        ).join("")}</div>
        <button id="clearTokens" class="secondary-button" type="button">選択を解除</button>`;
    }
    if (q.format === "OR") {
      const words = q.stimulus.split("/").map(x => x.trim()).filter(Boolean);
      return `
        <div class="selected-words" id="selectedPhrase">語句を順番にタップしてください</div>
        <div class="word-bank">${words.map((t,i) =>
          `<button class="word-token" data-word-index="${i}">${escapeHTML(t)}</button>`
        ).join("")}</div>
        ${textVoiceArea(q)}
        <button id="clearTokens" class="secondary-button" type="button">並べ替えを解除</button>`;
    }
    return textVoiceArea(q);
  }

  function textVoiceArea(q) {
    const lang = q.format === "EJ" ? "日本語" : "英語";
    return `
      <textarea id="textAnswer" class="answer-box" placeholder="${lang}で回答してください"></textarea>
      <div class="answer-tools">
        <button id="micButton" class="mic-button" type="button">🎙️ 音声で回答</button>
        <button id="clearAnswer" class="secondary-button" type="button">入力を消す</button>
      </div>
      <p id="speechStatus" class="muted tiny">マイクが使えない場合は文字で入力できます。</p>`;
  }

  function bindQuestionEvents(q) {
    document.querySelectorAll("[data-choice]").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-choice]").forEach(b => b.classList.remove("selected"));
        button.classList.add("selected");
        selectedChoice = Number(button.dataset.choice);
        document.getElementById("submitAnswer").disabled = false;
      });
    });

    document.querySelectorAll("[data-token-index]").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.tokenIndex);
        if (selectedTokens.includes(index)) {
          selectedTokens = selectedTokens.filter(x => x !== index);
          button.classList.remove("selected");
        } else {
          selectedTokens.push(index);
          button.classList.add("selected");
        }
        const phrase = selectedTokens.map(i => q.standardEnglish.split(/\s+/)[i]).join(" ");
        document.getElementById("selectedPhrase").textContent = phrase || "選んだ語句がここに表示されます";
      });
    });

    document.querySelectorAll("[data-word-index]").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.wordIndex);
        if (selectedWordIndices.includes(index)) return;
        selectedWordIndices.push(index);
        button.classList.add("used");
        const words = q.stimulus.split("/").map(x => x.trim()).filter(Boolean);
        const answer = selectedWordIndices.map(i => words[i]).join(" ");
        document.getElementById("selectedPhrase").textContent = answer;
        const textArea = document.getElementById("textAnswer");
        if (textArea) textArea.value = answer;
      });
    });

    document.getElementById("clearTokens")?.addEventListener("click", () => {
      selectedTokens = [];
      selectedWordIndices = [];
      document.querySelectorAll(".sentence-token,.word-token").forEach(b => b.classList.remove("selected","used"));
      const phrase = document.getElementById("selectedPhrase");
      if (phrase) phrase.textContent = q.format === "OR" ? "語句を順番にタップしてください" : "選んだ語句がここに表示されます";
      const textArea = document.getElementById("textAnswer");
      if (textArea) textArea.value = "";
    });

    document.getElementById("clearAnswer")?.addEventListener("click", () => {
      const area = document.getElementById("textAnswer");
      if (area) area.value = "";
    });

    document.getElementById("micButton")?.addEventListener("click", () => startRecognition(q));
    document.getElementById("submitAnswer").addEventListener("click", () => submitCurrentAnswer(q));
    document.getElementById("skipUnclear").addEventListener("click", () => recordUnclear(q));
  }

  function submitCurrentAnswer(q) {
    let grade;
    let submitted = "";
    if (q.format === "MC") {
      submitted = String(selectedChoice || "");
      grade = selectedChoice === q.correctChoice
        ? {result:"correct", score:1}
        : {result:"wrong", score:0, reason:"選択した理由と文法の目印を確認しましょう。"};
    } else if (q.format === "ST") {
      const tokens = q.standardEnglish.split(/\s+/);
      submitted = selectedTokens.map(i => tokens[i]).join(" ");
      const expected = normalizeEnglish(q.tapTarget);
      const actual = normalizeEnglish(submitted);
      grade = actual === expected
        ? {result:"correct", score:1}
        : actual && (expected.includes(actual) || actual.includes(expected))
          ? {result:"almost", score:0.75, reason:"範囲をもう少し正確に選びましょう。"}
          : {result:"wrong", score:0, reason:"文の中で指定された働きをする語句を確認しましょう。"};
    } else {
      submitted = document.getElementById("textAnswer")?.value || lastTranscript || "";
      grade = gradeText(q, submitted);
    }
    processResult(q, submitted, grade);
  }

  function processResult(q, submitted, grade) {
    const feedbackArea = document.getElementById("feedbackArea");
    document.getElementById("submitAnswer").disabled = true;
    document.getElementById("skipUnclear").disabled = true;
    document.querySelectorAll("button.choice-button,.word-token,.sentence-token").forEach(b => b.disabled = true);
    document.getElementById("micButton")?.setAttribute("disabled","disabled");

    const today = dateKey();
    const qs = getQuestionState(q.id);
    const ss = getSubcategoryState(q.subcategoryCode);
    qs.seen = true;
    qs.attempts++;
    qs.lastResult = grade.result;
    qs.lastAt = new Date().toISOString();
    ss.attempts++;
    ss.lastAt = qs.lastAt;
    ss.recent.push({date:today,result:grade.result});
    ss.recent = ss.recent.filter(x => daysBetween(x.date, today) <= 90).slice(-80);

    state.stats.totalAnswered++;
    state.session.answered++;
    state.session.results[grade.result]++;

    if (grade.result === "correct") {
      qs.correct++;
      ss.correct++;
      state.stats.correct++;
      qs.stage = Math.min(REVIEW_INTERVALS.length, qs.stage + 1);
      const interval = REVIEW_INTERVALS[Math.max(0, qs.stage - 1)] || 90;
      qs.nextDue = addDays(today, interval);
    } else if (grade.result === "almost") {
      qs.almost++;
      ss.almost++;
      state.stats.almost++;
      qs.nextDue = addDays(today, 1);
      queueRedo(q, "惜しい");
    } else {
      qs.wrong++;
      ss.wrong++;
      state.stats.wrong++;
      qs.stage = Math.max(0, qs.stage - 1);
      qs.nextDue = addDays(today, 1);
      queueRedo(q, "やり直し");
    }

    state.history.unshift({
      at:new Date().toISOString(), date:today, questionId:q.id,
      subcategoryCode:q.subcategoryCode, format:q.format,
      submitted, result:grade.result, score:grade.score || 0
    });
    state.history = state.history.slice(0, 1800);
    saveState();

    const label = grade.result === "correct" ? "正解" : grade.result === "almost" ? "惜しい" : "要復習";
    const cls = grade.result === "correct" ? "good" : grade.result === "almost" ? "almost" : "bad";
    const requiresReason = grade.result !== "correct" || isWeakSubcategory(q.subcategoryCode);
    feedbackArea.innerHTML = `
      <div class="feedback ${cls}">
        <h3>${label}</h3>
        ${grade.reason ? `<p>${escapeHTML(grade.reason)}</p>` : ""}
        <p><strong>正解：</strong>${escapeHTML(q.answer)}</p>
        <div class="explanation-box">
          <strong>判断の目印：</strong>${escapeHTML(q.marker)}<br>
          <strong>考え方：</strong>${escapeHTML(q.explanation)}<br>
          <strong>使う形：</strong>${escapeHTML(q.form)}
        </div>
        <div id="reasonArea"></div>
        <button id="nextQuestion" class="primary-button" style="margin-top:14px" ${requiresReason ? "disabled" : ""}>${grade.result === "correct" ? "次の問題へ" : "理由を確認して次へ"}</button>
      </div>`;

    if (grade.result !== "correct" || isWeakSubcategory(q.subcategoryCode)) {
      renderReasonTraining(q);
    }
    document.getElementById("nextQuestion").addEventListener("click", advanceSession);
  }

  function queueRedo(q, origin) {
    const session = state.session;
    const remaining = session.tasks.slice(session.index + 1);
    const already = remaining.some(t => t.id === q.id);
    if (!already) session.tasks.push({id:q.id, origin});
    const alternative = QUESTIONS.find(x =>
      x.subcategoryCode === q.subcategoryCode &&
      x.id !== q.id &&
      !session.tasks.some(t => t.id === x.id)
    );
    if (alternative) session.tasks.push({id:alternative.id, origin:"類題"});
  }

  function renderReasonTraining(q) {
    const area = document.getElementById("reasonArea");
    if (!area) return;
    area.innerHTML = `
      <div class="reason-panel">
        <h3>なぜこの形になりますか？</h3>
        <p>${escapeHTML(q.reasonQuestion)}</p>
        <div class="choice-grid">
          ${q.reasonChoices.map((choice,i) =>
            `<button class="choice-button reason-choice" data-reason="${i+1}"><strong>${i+1}.</strong> ${escapeHTML(choice)}</button>`
          ).join("")}
        </div>
        <div id="reasonFeedback"></div>
      </div>`;
    document.querySelectorAll("[data-reason]").forEach(button => {
      button.addEventListener("click", () => {
        const choice = Number(button.dataset.reason);
        const ss = getSubcategoryState(q.subcategoryCode);
        ss.reasonAttempts++;
        if (choice === q.reasonCorrect) {
          ss.reasonCorrect++;
          button.classList.add("correct");
          document.querySelectorAll("[data-reason]").forEach(b => b.disabled = true);
          const nextButton = document.getElementById("nextQuestion");
          if (nextButton) nextButton.disabled = false;
          document.getElementById("reasonFeedback").innerHTML = `
            <div class="feedback good">
              <strong>理由も正解です。</strong>
              <p>${escapeHTML(q.explanation)}</p>
              <button id="explainVoiceButton" class="mic-button" type="button">🎙️ 短く説明する</button>
              <textarea id="explainText" class="answer-box" placeholder="例：${escapeHTML(q.speechModel)}"></textarea>
              <button id="checkExplanation" class="secondary-button" type="button">説明を確認</button>
              <p id="explanationResult" class="tiny"></p>
            </div>`;
          document.getElementById("explainVoiceButton").addEventListener("click", () => startExplanationRecognition(q));
          document.getElementById("checkExplanation").addEventListener("click", () => checkExplanation(q));
        } else {
          button.classList.add("wrong");
          document.getElementById("reasonFeedback").innerHTML = `<p class="feedback bad">もう一度、判断の目印「${escapeHTML(q.marker)}」を見て考えましょう。</p>`;
        }
        saveState();
      });
    });
  }

  function conceptMatch(transcript, concepts) {
    const normalized = normalizeJapanese(transcript) + normalizeEnglish(transcript);
    if (!concepts?.length) return false;
    const hits = concepts.filter(c => {
      const nj = normalizeJapanese(c);
      const ne = normalizeEnglish(c);
      return (nj && normalized.includes(nj)) || (ne && normalized.includes(ne));
    }).length;
    return hits >= Math.max(1, Math.ceil(concepts.length * 0.5));
  }

  function checkExplanation(q) {
    const text = document.getElementById("explainText")?.value || "";
    const ok = conceptMatch(text, q.concepts) || similarity(normalizeJapanese(text), normalizeJapanese(q.speechModel)) >= 0.58;
    const result = document.getElementById("explanationResult");
    if (ok) {
      const ss = getSubcategoryState(q.subcategoryCode);
      ss.explanationSuccess++;
      result.textContent = "説明できています。";
      result.style.color = "var(--good)";
      saveState();
    } else {
      result.textContent = `「${q.marker}」「${q.explanation}」を含めて短く説明してみましょう。`;
      result.style.color = "var(--warn)";
    }
  }

  function recordUnclear(q) {
    state.history.unshift({
      at:new Date().toISOString(), date:dateKey(), questionId:q.id,
      subcategoryCode:q.subcategoryCode, format:q.format,
      submitted:"", result:"unclear", score:0
    });
    state.history = state.history.slice(0,1800);
    state.session.tasks.push({id:q.id, origin:"再回答"});
    saveState();
    showToast("成績には含めず、後でもう一度出題します。");
    advanceSession();
  }

  function advanceSession() {
    state.session.index++;
    saveState();
    if (state.session.index >= state.session.tasks.length) completeSession();
    else renderStudy();
  }

  function completeSession() {
    if (!state.session) {
      renderHome();
      return;
    }
    state.session.completed = true;
    const today = dateKey();
    if (!state.stats.completedDays.includes(today)) state.stats.completedDays.push(today);
    state.stats.completedDays = state.stats.completedDays.slice(-500);
    const last = state.stats.lastStudyDate;
    if (!last) state.stats.streak = 1;
    else if (last === today) state.stats.streak = Math.max(1, state.stats.streak);
    else if (daysBetween(last, today) === 1) state.stats.streak++;
    else state.stats.streak = 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    state.stats.lastStudyDate = today;
    saveState();

    const r = state.session.results;
    mainView.innerHTML = `
      <section class="hero">
        <h1>今日の学習、完了です</h1>
        <p>間違えた問題は翌日以降の復習にも自動で入ります。</p>
        <div class="hero-stats">
          <div class="hero-stat"><strong>${r.correct}</strong><small>正解</small></div>
          <div class="hero-stat"><strong>${r.almost}</strong><small>惜しい</small></div>
          <div class="hero-stat"><strong>${r.wrong}</strong><small>要復習</small></div>
        </div>
      </section>
      <section class="card">
        <h2>連続学習 ${state.stats.streak}日</h2>
        <p class="muted">今日の学習記録を保存しました。</p>
        <button id="backHome" class="primary-button">ホームへ戻る</button>
      </section>`;
    document.getElementById("backHome").addEventListener("click", renderHome);
  }

  function renderHome() {
    activeView = "home";
    updateNav();
    const seen = Object.values(state.questionState).filter(x => x.seen).length;
    const due = dueQuestions().length;
    const weak = Object.keys(state.subcategoryState).filter(isWeakSubcategory).length;
    const ongoing = state.session && state.session.date === dateKey() && !state.session.completed;
    const accuracy = state.stats.totalAnswered
      ? Math.round(state.stats.correct / state.stats.totalAnswered * 100)
      : 0;
    mainView.innerHTML = `
      <section class="hero">
        <h1>${greeting()}、今日も12問</h1>
        <p>答えを選ぶだけでなく、英文を作り、理由を説明できる力を育てます。</p>
        <div class="hero-stats">
          <div class="hero-stat"><strong>${state.stats.streak}</strong><small>連続日数</small></div>
          <div class="hero-stat"><strong>${seen}</strong><small>学習済み</small></div>
          <div class="hero-stat"><strong>${accuracy}%</strong><small>正答率</small></div>
        </div>
      </section>
      <section class="card">
        <h2>今日の学習</h2>
        <p class="muted">復習 ${due}問待ち・苦手小分類 ${weak}件</p>
        <button id="startDaily" class="primary-button">${ongoing ? "続きから始める" : "今日の12問を始める"}</button>
      </section>
      <div class="grid-2">
        <section class="card metric"><strong>${QUESTIONS.length - seen}</strong><small>未学習問題</small></section>
        <section class="card metric"><strong>${due}</strong><small>本日の復習</small></section>
      </div>
      <section class="card">
        <h3>学習の仕組み</h3>
        <p class="muted tiny">新規3問＋確認2問＋復習4問＋音声2問＋文構造1問を基本に、自動調整します。</p>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.round(seen / QUESTIONS.length * 100)}%"></div></div>
        <p class="tiny muted">全体進捗 ${seen} / ${QUESTIONS.length}問</p>
      </section>`;
    document.getElementById("startDaily").addEventListener("click", () => startSession("daily"));
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 11) return "おはようございます";
    if (hour < 18) return "こんにちは";
    return "こんばんは";
  }

  function renderUnits() {
    activeView = "units";
    updateNav();
    const rows = [...unitMap.entries()].sort((a,b) => a[0] - b[0]).map(([code,unit]) => {
      const seen = unit.questions.filter(q => state.questionState[q.id]?.seen).length;
      const scores = [...new Set(unit.questions.map(q => q.subcategoryCode))].map(masteryScore);
      const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
      return `<div class="unit-row">
        <div>
          <div class="unit-title">${code}. ${escapeHTML(unit.name)}</div>
          <div class="tiny muted">${seen}/${unit.questions.length}問・習熟度 ${avg}%</div>
          <div class="progress-track" style="margin-top:7px"><div class="progress-fill" style="width:${seen/unit.questions.length*100}%"></div></div>
        </div>
        <button class="secondary-button unit-start" data-unit="${code}" style="width:auto">学習</button>
      </div>`;
    }).join("");
    mainView.innerHTML = `<section class="card"><h2>全28単元</h2>${rows}</section>`;
    document.querySelectorAll(".unit-start").forEach(b => b.addEventListener("click", () => startSession("unit", Number(b.dataset.unit))));
  }

  function renderWeak() {
    activeView = "weak";
    updateNav();
    const weakCodes = Object.keys(state.subcategoryState).filter(isWeakSubcategory)
      .sort((a,b) => masteryScore(a) - masteryScore(b));
    const rows = weakCodes.map(code => {
      const s = getSubcategoryState(code);
      return `<div class="weak-row">
        <div><div class="unit-title">${escapeHTML(s.name)}</div><div class="tiny muted">${escapeHTML(s.unit)}・誤答 ${s.wrong}回</div></div>
        <span class="score-pill weak">${masteryScore(code)}%</span>
      </div>`;
    }).join("");
    mainView.innerHTML = `
      <section class="card">
        <h2>苦手文法</h2>
        ${rows || `<div class="empty">繰り返し間違えている小分類はありません。</div>`}
        <button id="startWeak" class="primary-button" ${weakCodes.length ? "" : "disabled"}>苦手12問を学習</button>
      </section>`;
    document.getElementById("startWeak").addEventListener("click", () => startSession("weak"));
  }

  function renderReport() {
    activeView = "report";
    updateNav();
    const total = state.stats.totalAnswered;
    const accuracy = total ? Math.round(state.stats.correct / total * 100) : 0;
    const seen = Object.values(state.questionState).filter(x => x.seen).length;
    const subScores = Object.keys(state.subcategoryState).map(masteryScore);
    const avgMastery = subScores.length ? Math.round(subScores.reduce((a,b)=>a+b,0)/subScores.length) : 0;
    const recent = state.history.slice(0,20).map(h => {
      const q = questionById.get(h.questionId);
      const mark = h.result === "correct" ? "○" : h.result === "almost" ? "△" : h.result === "wrong" ? "×" : "－";
      return `<div class="history-row">
        <div><div class="unit-title">${escapeHTML(q?.subcategory || h.subcategoryCode)}</div><div class="tiny muted">${new Date(h.at).toLocaleString("ja-JP")}・${escapeHTML(q?.formatLabel || h.format)}</div></div>
        <span class="score-pill ${h.result === "wrong" ? "weak" : ""}">${mark}</span>
      </div>`;
    }).join("");
    mainView.innerHTML = `
      <div class="grid-2">
        <section class="card metric"><strong>${seen}</strong><small>学習済み問題</small></section>
        <section class="card metric"><strong>${accuracy}%</strong><small>正答率</small></section>
        <section class="card metric"><strong>${avgMastery}%</strong><small>平均習熟度</small></section>
        <section class="card metric"><strong>${state.stats.bestStreak}</strong><small>最長連続日数</small></section>
      </div>
      <section class="card">
        <h2>保護者向け記録</h2>
        <p class="muted tiny">学習記録はこの端末に保存されます。定期的にバックアップしてください。</p>
        <div class="button-row">
          <button id="exportBackup" class="secondary-button">記録を保存</button>
          <button id="exportCsv" class="secondary-button">CSVレポート</button>
        </div>
        <input id="importFile" type="file" accept=".json" hidden>
        <button id="importBackup" class="secondary-button" style="margin-top:10px">記録を復元</button>
      </section>
      <section class="card"><h2>最近の回答</h2>${recent || `<div class="empty">まだ学習記録がありません。</div>`}</section>`;
    document.getElementById("exportBackup").addEventListener("click", exportBackup);
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
    document.getElementById("importBackup").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", importBackup);
  }

  function renderSettings() {
    modalContent.innerHTML = `
      <h2>設定</h2>
      <div class="setting-row"><div><strong>1日の問題数</strong><div class="tiny muted">基本は12問です</div></div>
        <select id="dailyCount"><option value="10">10問</option><option value="12">12問</option><option value="15">15問</option></select></div>
      <div class="setting-row"><div><strong>音声回答を優先</strong></div><input id="voiceFirst" type="checkbox"></div>
      <div class="setting-row"><div><strong>問題中に単元名を表示</strong></div><input id="showUnitName" type="checkbox"></div>
      <div class="setting-row"><div><strong>Google Apps Script同期URL</strong><div class="tiny muted">空欄なら端末内だけに保存</div></div></div>
      <input id="syncUrl" type="url" value="${escapeHTML(state.settings.syncUrl)}" placeholder="https://script.google.com/macros/s/.../exec">
      <div class="button-row">
        <button id="cloudSave" class="secondary-button">クラウド保存</button>
        <button id="cloudLoad" class="secondary-button">クラウド読込</button>
      </div>
      <details><summary>データ管理</summary>
        <p class="tiny muted">リセットすると、この端末の学習履歴が削除されます。</p>
        <button id="resetData" class="danger-button">学習記録をリセット</button>
      </details>`;
    document.getElementById("dailyCount").value = String(state.settings.dailyCount);
    document.getElementById("voiceFirst").checked = state.settings.voiceFirst;
    document.getElementById("showUnitName").checked = state.settings.showUnitName;
    ["dailyCount","voiceFirst","showUnitName","syncUrl"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => {
        state.settings.dailyCount = Number(document.getElementById("dailyCount").value);
        state.settings.voiceFirst = document.getElementById("voiceFirst").checked;
        state.settings.showUnitName = document.getElementById("showUnitName").checked;
        state.settings.syncUrl = document.getElementById("syncUrl").value.trim();
        saveState();
      });
    });
    document.getElementById("cloudSave").addEventListener("click", saveCloud);
    document.getElementById("cloudLoad").addEventListener("click", loadCloud);
    document.getElementById("resetData").addEventListener("click", resetData);
    modal.showModal();
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    downloadBlob(blob, `英文法12_学習記録_${dateKey()}.json`);
  }

  function exportCsv() {
    const header = ["日時","問題ID","単元","小分類","形式","判定","回答"];
    const lines = [header, ...state.history.map(h => {
      const q = questionById.get(h.questionId);
      return [h.at,h.questionId,q?.unit || "",q?.subcategory || "",q?.formatLabel || h.format,h.result,h.submitted || ""];
    })].map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(","));
    downloadBlob(new Blob(["\ufeff"+lines.join("\n")], {type:"text/csv;charset=utf-8"}), `英文法12_学習レポート_${dateKey()}.csv`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        const merged = mergeDefaults(defaultState(), incoming);
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, merged);
        saveState();
        showToast("学習記録を復元しました。");
        renderHome();
      } catch {
        showToast("バックアップファイルを読み込めませんでした。");
      }
    };
    reader.readAsText(file);
  }

  async function saveCloud() {
    const url = document.getElementById("syncUrl").value.trim();
    if (!url) return showToast("同期URLを入力してください。");
    try {
      const response = await fetch(url, {
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"save",userId:state.profile.userId,state})
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "save failed");
      showToast("クラウドへ保存しました。");
    } catch (error) {
      console.error(error);
      showToast("クラウド保存に失敗しました。");
    }
  }

  async function loadCloud() {
    const url = document.getElementById("syncUrl").value.trim();
    if (!url) return showToast("同期URLを入力してください。");
    try {
      const response = await fetch(`${url}?action=load&userId=${encodeURIComponent(state.profile.userId)}`);
      const result = await response.json();
      if (!result.ok || !result.state) throw new Error(result.error || "load failed");
      const merged = mergeDefaults(defaultState(), result.state);
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, merged);
      state.settings.syncUrl = url;
      saveState();
      showToast("クラウドから読み込みました。");
      modal.close();
      renderHome();
    } catch (error) {
      console.error(error);
      showToast("クラウド読込に失敗しました。");
    }
  }

  function resetData() {
    if (!confirm("学習記録をすべて削除します。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  function startRecognition(q) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("このブラウザでは音声認識を利用できません。文字で回答してください。");
      return;
    }
    if (recognition) {
      try { recognition.stop(); } catch {}
      recognition = null;
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = q.format === "EJ" ? "ja-JP" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    const mic = document.getElementById("micButton");
    const status = document.getElementById("speechStatus");
    mic?.classList.add("listening");
    if (mic) mic.textContent = "■ 聞き取り中";
    if (status) status.textContent = "話し終わると自動で止まります。";
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join(" ");
      lastTranscript = transcript;
      const area = document.getElementById("textAnswer");
      if (area) area.value = transcript;
    };
    recognition.onerror = () => {
      showToast("音声を認識できませんでした。成績には含めません。");
    };
    recognition.onend = () => {
      mic?.classList.remove("listening");
      if (mic) mic.textContent = "🎙️ 音声で回答";
      if (status) status.textContent = lastTranscript ? `認識結果：${lastTranscript}` : "文字入力でも回答できます。";
      recognition = null;
    };
    recognition.start();
  }

  function startExplanationRecognition(q) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return showToast("文字で説明してください。");
    const rec = new SpeechRecognition();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.onresult = event => {
      const text = Array.from(event.results).map(r => r[0].transcript).join("");
      const area = document.getElementById("explainText");
      if (area) area.value = text;
    };
    rec.onerror = () => showToast("音声を認識できませんでした。文字で説明できます。");
    rec.start();
  }

  function speakCurrentQuestion() {
    const q = currentQuestion;
    if (!q || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const text = [q.instruction, q.prompt, q.stimulus].filter(Boolean).join(" ");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[ぁ-んァ-ヶ一-龠]/.test(text) ? "ja-JP" : "en-US";
    utterance.rate = Number(state.settings.speechRate) || 0.92;
    speechSynthesis.speak(utterance);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function updateNav() {
    document.querySelectorAll(".nav-button").forEach(b => {
      b.classList.toggle("active", b.dataset.view === activeView);
    });
  }

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "home") renderHome();
      if (view === "units") renderUnits();
      if (view === "weak") renderWeak();
      if (view === "report") renderReport();
    });
  });
  document.getElementById("homeButton").addEventListener("click", renderHome);
  document.getElementById("settingsButton").addEventListener("click", renderSettings);
  document.getElementById("speakQuestionButton").addEventListener("click", speakCurrentQuestion);
  document.getElementById("modalClose").addEventListener("click", () => modal.close());
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }

  if (!QUESTIONS.length) {
    mainView.innerHTML = `<div class="empty">問題データを読み込めませんでした。</div>`;
  } else {
    renderHome();
  }
})();
