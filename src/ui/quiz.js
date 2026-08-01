/* =====================================================================
   ui/quiz.js — 出題〜判定〜結果(ふくしゅう/じゅんび 共通)
   維持項目(fukushu §8): 段階ヒント2段階 / 誤答時即解説 / 見直しコーナー /
                        writeTip固定表示 / 記録・通信なし
   v4.1 記録2(承認済): セーブコードは結果画面に表示しない(おうちの人メニューへ)
   ===================================================================== */

let quiz = null;

/* ctx: { world, mode, buildSession, topbarHtml, initExtra, onAnswer, resultWorldHtml, goHome } */
function startQuiz(ctx, cat){
  const w = ctx.world;
  const qs = ctx.buildSession(w, cat, new Date());
  if(!qs.length){
    showToast("いま出せる問題がないみたい。ほかの間口をえらんでね。");
    ctx.goHome();
    return;
  }
  quiz = {
    ctx, cat: cat || null, qs, idx:0, input:"", hint:0, answered:false,
    results:[], combo:0, best:0,
    noHintStreak:0, noHintMaxStreak:0, hintCorrectCount:0, revengeWin:false,
    extra: ctx.initExtra ? ctx.initExtra(w) : {}
  };
  renderQ();
}

function renderQ(){
  const s = quiz, w = s.ctx.world, q = s.qs[s.idx];
  s.numeric = isNumericQuestion(q);
  const rail = s.qs.map((_, i) => {
    if(i < s.results.length) return `<span class="${s.results[i].ok?'on':'ng'}">${s.results[i].ok?'⭐':'💧'}</span>`;
    return `<span>⭐</span>`;
  }).join("");
  const catInfo = (w.cats || []).find(c => c.cat === q.cat);

  app.innerHTML = `
    ${bannerHtml()}
    <div class="topbar">
      <button class="quit-btn" id="quit">← やめる</button>
      ${s.ctx.topbarHtml(w)}
      <div class="combo">${s.combo>=2?`🔥${s.combo}れんぞく!`:""}</div>
    </div>
    <div class="rail">${rail}</div>
    <div class="qcard">
      ${q._revenge ? `<div class="revenge-badge">🔥 リベンジ問題!</div>` : ""}
      <div class="qnum">${catInfo?esc(catInfo.icon||""):""} ${esc(q.cat||"")} ・ だい ${s.idx+1} もん / ${s.qs.length}もん</div>
      <div class="qtext">${esc(q.q)}</div>
      ${svgFigureHtml(q, "q")}
      <div class="answer-row">
        ${s.numeric
          ? `<input type="text" class="answer-box" id="ansbox" inputmode="none" autocomplete="off" enterkeyhint="done">`
          : `<input type="text" class="answer-box answer-input" id="ansbox" placeholder="かんじ・かなで にゅうりょく" autocomplete="off" autocapitalize="off" enterkeyhint="done">`}
        <div class="unit">${esc(q.unit_label || "")}</div>
      </div>
      <div class="write-tip">✏️ ${esc(w.skin.writeTip || "まずノートに式を書こう。それが「さいしょの一手」!")}</div>
      <div class="hint-area" id="hintarea">
        <button class="hint-btn" id="hintbtn">💡 ヒントを見る</button>
      </div>
      <div id="fbarea"></div>
    </div>
    ${s.numeric ? `<div class="keypad" id="pad"></div>` : `<button class="next-btn submit-btn" id="submitBtn" disabled>こたえあわせ</button>`}`;

  bindBanner();
  document.getElementById("quit").addEventListener("click", () => { quiz = null; s.ctx.goHome(); });
  document.getElementById("hintbtn").addEventListener("click", showHint);

  /* 数字・テキスト共通: 物理キーボード(PC)から直接入力できるようにinputを購読 */
  const input = document.getElementById("ansbox");
  input.addEventListener("input", () => { quiz.input = input.value; updateAns(); });
  input.addEventListener("keydown", e => {
    if(e.key === "Enter" && quiz.input && quiz.input.trim() && !quiz.answered) check();
  });

  if(s.numeric){ renderPad(); updateAns(); }
  else { document.getElementById("submitBtn").addEventListener("click", check); input.focus(); }
}

function renderPad(){
  const pad = document.getElementById("pad");
  const keys = ["7","8","9","⌫","4","5","6","/","1","2","3",".","0"];
  pad.innerHTML = keys.map(k => `<button class="key ${["⌫","/","."].includes(k)?"fn":""}" data-k="${k}">${k}</button>`).join("")
    + `<button class="key go" id="gobtn">こたえあわせ</button>`;
  pad.querySelectorAll(".key[data-k]").forEach(b => b.addEventListener("click", () => tapKey(b.dataset.k)));
  document.getElementById("gobtn").addEventListener("click", check);
}

/* キーパッドのタップは実際の<input>の値を書き換える(PCからの直接タイプと同じ経路に統一) */
function tapKey(k){
  if(quiz.answered) return;
  const input = document.getElementById("ansbox");
  if(k === "⌫") input.value = input.value.slice(0,-1);
  else if(input.value.length < 8) input.value += k;
  quiz.input = input.value;
  updateAns();
}

function updateAns(){
  const box = document.getElementById("ansbox");
  if(!box) return;
  box.classList.toggle("filled", !!quiz.input);
  box.disabled = quiz.answered;
  if(quiz.numeric){
    const go = document.getElementById("gobtn");
    if(go) go.disabled = !quiz.input || quiz.answered;
  } else {
    const btn = document.getElementById("submitBtn");
    if(btn) btn.disabled = !quiz.input || !quiz.input.trim() || quiz.answered;
  }
}

function showHint(){
  const q = quiz.qs[quiz.idx];
  const area = document.getElementById("hintarea");
  quiz.hint++;
  const bubbles = [];
  if(quiz.hint >= 1) bubbles.push(`<div class="hint-bubble">💡 <b>考え方</b>: ${esc(q.h1)}</div>`);
  if(quiz.hint >= 2) bubbles.push(`<div class="hint-bubble">🧮 <b>式</b>: ${esc(q.h2)}</div>`);
  const btnLabel = quiz.hint === 1 ? "💡 もうひとつヒント(式)" : "";
  area.innerHTML = bubbles.join("") + (btnLabel ? `<div style="margin-top:8px"><button class="hint-btn" id="hintbtn">${btnLabel}</button></div>` : "");
  const nb = document.getElementById("hintbtn");
  if(nb) nb.addEventListener("click", showHint);
}

function check(){
  const s = quiz, w = s.ctx.world, q = s.qs[s.idx];
  if(s.answered || !s.input) return;
  s.answered = true;

  const ok = answerMatches(q, s.input);
  s.results.push({ q, ok, my: s.input, hintUsed: s.hint });

  /* 世界別の前後比較(封印解除の検出など)は onAnswer に委ねる */
  const hook = s.ctx.onAnswer ? s.ctx.onAnswer(w, q, ok, s, "before") : null;

  /* §4.1: 解答確定ごとに state を全量書き込み */
  recordAnswer(w.state, q, ok, s.ctx.mode, new Date());
  saveState(w.subject, w.state);

  const after = s.ctx.onAnswer ? s.ctx.onAnswer(w, q, ok, s, "after", hook) : { banners: "" };

  if(ok){
    s.combo++; s.best = Math.max(s.best, s.combo);
    if(s.hint === 0){ s.noHintStreak++; s.noHintMaxStreak = Math.max(s.noHintMaxStreak, s.noHintStreak); }
    else { s.noHintStreak = 0; s.hintCorrectCount++; }
    if(q._revenge) s.revengeWin = true;
  } else {
    s.combo = 0; s.noHintStreak = 0;
  }

  const fb = document.getElementById("fbarea");
  const last = s.idx === s.qs.length - 1;
  if(ok){
    fb.innerHTML = `<div class="fb ok">
      <div class="fb-head">${(after && after.okHead) || "⭕ せいかい!"} ${esc(pick(w.skin.praise))}</div>
      ${(after && after.banners) || ""}
      ${s.hint === 0 ? "ノーヒントはえらい!" : esc(w.skin.hintPraise)}
      <button class="next-btn" id="next">${last?"けっかを見る 🏁":"つぎの問題へ ▶"}</button></div>`;
  } else {
    /* 誤答時の即解説。図が本質の問題は解説でも図を再掲する(§5.2) */
    fb.innerHTML = `<div class="fb ng"><div class="fb-head">❌ ざんねん…</div>
      正解は <b>${esc(q.ans[0])}${esc(q.unit_label||"")}</b>。${svgFigureHtml(q, "review")}<br>📖 ${esc(q.exp)}<br>${esc(pick(w.skin.cheer))}
      <button class="next-btn" id="next">${last?"けっかを見る 🏁":"つぎの問題へ ▶"}</button></div>`;
  }
  updateAns();
  document.getElementById("next").addEventListener("click", () => {
    if(last) renderResult();
    else { s.idx++; s.input=""; s.hint=0; s.answered=false; renderQ(); }
  });
  fb.scrollIntoView({ behavior:"smooth", block:"end" });
}

function renderResult(){
  const s = quiz, w = s.ctx.world;
  const nOK = s.results.filter(r => r.ok).length, n = s.results.length;
  const stars = nOK===n ? 3 : nOK>=n-2 ? 2 : nOK>=Math.ceil(n/2) ? 1 : 0;
  const emoji = stars===3?"🏆":stars===2?"🎉":stars===1?"💪":"🌱";
  const title = stars===3?"パーフェクト!!":stars===2?"あと少しで満点!":stars===1?"いいペース!":"ここからスタート!";
  const misses = s.results.filter(r => !r.ok);
  s.perfectStage = (nOK === n);

  const stats = {
    noHintMaxStreak: s.noHintMaxStreak,
    hintCorrectCount: s.hintCorrectCount,
    revengeWin: s.revengeWin,
    perfectStage: s.perfectStage
  };
  const earned = earnedTitles(w.skin, stats, w.state.xp);

  flushAllStates();                                  // §4.1 セッション終了時の書き込み

  app.innerHTML = `
    ${bannerHtml()}
    <div class="res-head"><div class="res-emoji">${emoji}</div><div class="res-title">${title}</div></div>
    <div class="res-score"><b>${nOK}</b> / ${n} もん せいかい</div>
    <div class="res-stars">${"🌟".repeat(stars)}${"☆".repeat(3-stars)}</div>
    ${s.best>=3?`<div class="res-score" style="font-size:15px">🔥 さいだい ${s.best}れんぞく正解!</div>`:""}

    ${s.ctx.resultWorldHtml ? s.ctx.resultWorldHtml(w, s) : ""}

    ${earned.length ? `<div class="title-wrap">${earned.map(t=>`<span class="title-badge">🏅 ${esc(t.name)}</span>`).join("")}</div>` : ""}

    ${misses.length?`<div class="review-head">📖 見直しコーナー(ノートで解き直そう)</div>`:""}
    ${misses.map(r=>`<div class="review">
        <div class="rq">Q. ${esc(r.q.q)}</div>
        ${svgFigureHtml(r.q, "review")}
        <div class="ra"><span class="miss">きみの答え: ${esc(r.my)}</span> → 正解: <b>${esc(r.q.ans[0])}${esc(r.q.unit_label||"")}</b><br>${esc(r.q.exp)}</div>
      </div>`).join("")}
    <div class="res-btns">
      <button class="retry" id="retry">もう一回 🔁</button>
      <button class="gohome" id="home">ホームへ</button>
    </div>`;
  bindBanner();
  document.getElementById("retry").addEventListener("click", () => startQuiz(s.ctx, s.cat));
  document.getElementById("home").addEventListener("click", () => { quiz = null; s.ctx.goHome(); });
}
