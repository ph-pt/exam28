/* =====================================================================
   ui/junbi.js — 👑じゅんびタブ: ボスバトル画面・封印・回チップ・討伐記録
   仕様: yoshu §4 / §5 / v4.1 §7.1(サイクル交代確認フロー)
   ===================================================================== */

let bossOneshotLine = null;      // 回解放・新ボス登場など、1回だけ表示する台詞

function yWorld(){ return WORLDS.Y; }
function yKeys(){ const w = yWorld(); return unlockedKeys(w.liveQs, w.cats, w.state.boxes); }
function yUnlockedQs(){ const w = yWorld(); return unlockedQsOf(w.liveQs, yKeys()); }
function ySubjectMastery(cat){
  const w = yWorld();
  return masteryPctOf(yUnlockedQs().filter(q => q.cat === cat), w.state.boxes);
}
function yOverallMastery(){ return masteryPctOf(yUnlockedQs(), yWorld().state.boxes); }
function yHP(){ return bossHP(yUnlockedQs(), yWorld().state.boxes); }
function ySealBroken(cat){ return ySubjectMastery(cat) >= SEAL_THRESHOLD; }
function yAllSealsBroken(){ const w = yWorld(); return w.cats.length>0 && w.cats.every(c => ySealBroken(c.cat)); }

function renderBossHome(msg){
  quiz = null;
  VIEW = { tab:"junbi", subject:"Y" };
  saveLastView();
  const w = yWorld();
  const hp = yHP();
  const boss = w.skin.boss || {};
  const keys = yKeys();
  const allOpen = allKaisUnlocked(w.liveQs, keys);
  const defeated = hp <= 0 && allOpen;            // 全回解放済みのときだけ討伐(yoshu §4)
  const sealedPower = hp <= 0 && !allOpen;
  const enraged = yAllSealsBroken() && !defeated;
  const flavorText = defeated ? ((boss.lines && boss.lines.defeat) || "")
    : bossOneshotLine ? bossOneshotLine
    : sealedPower ? "……ふっ、われにはまだ封印された力が残っておるぞ?(習ったら次の回を解放しよう)"
    : (boss.flavor || "");
  bossOneshotLine = null;

  app.innerHTML = `
    ${bannerHtml()}
    ${tabsHtml()}
    <div class="home-title">⚔️ ${esc(w.skin.title || "テストじゅんびクエスト")}</div>
    <div class="home-sub">1かい 8もん。ヒントを使ってもOK!<br>${esc(w.skin.writeTip || "まずノートに式を書こう。それが「さいしょの一手」!")}</div>

    <div class="boss-card ${defeated?'defeated':''} ${enraged?'enraged':''}">
      <div class="boss-emoji-big">${defeated ? "🏆" : esc(boss.emoji||"👑")}</div>
      <div class="boss-name">${esc(boss.name||"")}</div>
      <div class="boss-flavor">${esc(flavorText)}</div>
      <div class="hp-label">HP</div>
      <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${Math.max(hp,0)}%"></div></div>
      <div class="hp-text">${Math.max(hp,0)} / 100</div>
    </div>

    <div class="seals-row">
      ${w.cats.map(c => {
        const pct = ySubjectMastery(c.cat);
        const broken = pct >= SEAL_THRESHOLD;
        return `<div class="seal-item ${broken?'unlocked':'locked'}">
          <div class="seal-icon">${broken?"🔓":"🔒"} ${esc(c.icon||"")}</div>
          <div class="seal-name">${esc(c.cat)}</div>
          <div class="seal-bar-track"><div class="seal-bar-fill" style="width:${pct}%"></div></div>
          <div class="seal-pct">${pct}%</div>
        </div>`;
      }).join("")}
    </div>

    ${msg ? `<div class="code-msg ${msg.ok?'ok':'ng'}">${esc(msg.text)}</div>` : ""}

    <div class="doors-label">きょうは どれにする?</div>
    ${w.cats.map(c => {
      const ks = kaisOf(w.liveQs, c.cat);
      const chips = ks.length < 2 ? "" : `<div class="kai-row">${ks.map(k => {
        const on = keys.has(c.cat + ":" + k);
        return `<button class="kai-chip ${on?'on':'off'}" data-cat="${esc(c.cat)}" data-kai="${k}" ${on?"disabled":""}>${on?"✅":"🔒"} 回${k}</button>`;
      }).join("")}</div>`;
      return `<div class="stage-group">
        <button class="stage-btn" data-cat="${esc(c.cat)}">
          <div class="stage-name">${esc(c.icon||"⭐")} ${esc(c.cat)}</div>
          <div class="stage-desc">${esc(c.desc||"")}</div>
        </button>${chips}</div>`;
    }).join("")}
    <button class="stage-btn omakase" data-cat="">
      <div class="stage-name">🎲 おまかせミックス</div>
      <div class="stage-desc">4科ぜんぶまぜて8問。まよったらこれ!</div>
    </button>

    <div class="home-note">きろくは この端末に自動でほぞんされるよ。</div>
    <div class="parent-menu-row">
      <button class="parent-menu-btn" id="logBtn">📜 討伐のきろく</button>
      <button class="parent-menu-btn" id="parentMenuBtn">⚙️ おうちの人メニュー</button>
    </div>`;

  bindBanner();
  bindTabs();
  app.querySelectorAll(".stage-btn[data-cat]").forEach(b =>
    b.addEventListener("click", () => startQuiz(junbiCtx(), b.dataset.cat || null)));

  /* 誤タップ防止の2段階解放(1回目=確認、2回目=解放) */
  let armedChip = null;
  app.querySelectorAll(".kai-chip.off").forEach(ch => ch.addEventListener("click", ev => {
    ev.stopPropagation();
    const key = ch.dataset.cat + ":" + ch.dataset.kai;
    if(armedChip !== key){
      armedChip = key;
      ch.textContent = "🗝️ 習ったら もういちどタップ!";
      return;
    }
    unlockKai(ch.dataset.cat, Number(ch.dataset.kai));
    bossOneshotLine = (yWorld().skin.boss && yWorld().skin.boss.lines && yWorld().skin.boss.lines.powerUp)
      || "ふはは! 新しい範囲を引きつれて、われはパワーアップしたぞ!(HPがふえた!)";
    renderBossHome();
  }));
  document.getElementById("logBtn").addEventListener("click", () => renderBossLog());
  document.getElementById("parentMenuBtn").addEventListener("click", () => renderParentMenu());
}

/* ---------- 討伐のきろく ---------- */
function renderBossLog(){
  quiz = null;
  const log = loadBossLog();
  app.innerHTML = `
    ${bannerHtml()}
    <div class="topbar"><button class="quit-btn" id="back">← ホームへ</button></div>
    <div class="home-title" style="font-size:22px">📜 討伐のきろく</div>
    <div class="home-sub">ボスが交代するたびに、ここに記録が残るよ。</div>
    ${log.length===0 ? `<div class="review"><div class="ra">まだきろくがないよ。テストの日が来て次のボスに交代すると、ここに記録されるよ。</div></div>` : ""}
    ${[...log].reverse().map(e => `
      <div class="review">
        <div class="rq">${esc(e.emoji||"")} ${esc(e.bossName||"-")}
          <span class="log-badge ${e.result==='討伐'?'gold':'silver'}">${e.result==='討伐'?'🥇 討伐':'🥈 取り逃がし'}</span>
        </div>
        <div class="ra">テスト日: ${esc(e.testDate||"-")} / さいしゅうマスター率: ${e.mastery}%</div>
      </div>`).join("")}
    <button class="reset-bank-btn" id="back2">← ホームへ</button>`;
  bindBanner();
  document.getElementById("back").addEventListener("click", () => renderBossHome());
  document.getElementById("back2").addEventListener("click", () => renderBossHome());
}

/* ---------- サイクル交代(v4.1 §7.1) ----------
   push経由(起動時検出)・おうちの人メニュー経由のどちらも必ずこの1本を通す(記録漏れ防止) */
function proceedCycleSwitch(newBank){
  const w = yWorld();
  /* (a) 討伐記録を追記。mastery は未解放の回も分母に含む全問題ベース(yoshu §4) */
  saveBossLogEntry(buildBossLogEntry(w.skin, w.bank, w.liveQs, w.state.boxes));
  /* (b) 進捗と解放状態をリセット */
  w.bank = newBank;
  deriveWorld(w);
  w.state = emptyState(newBank.bankVersion);
  saveState("Y", w.state);
  clearUnlocks();
  /* (c) 新バンクを採用し、現在有効な bank_Y を quest_bank_Y にミラー(§7.1 実装要件) */
  mirrorYBank(newBank);
  const boss = w.skin.boss || {};
  bossOneshotLine = (boss.lines && boss.lines.appear) || "あらたなボスが あらわれた!";
}

/* 現在有効な bank_Y を常にミラーしておく(拒否時に旧バンクで継続するため) */
function mirrorYBank(bank){
  writeAdopted(keyBank("Y"), bank, BUILTIN_BANKS.Y.bankVersion);
  WORLDS.Y.bankSource = bank.bankVersion === BUILTIN_BANKS.Y.bankVersion ? "builtin" : "local";
}

function renderCycleSwitchConfirm(newBank, origin){
  quiz = null;
  const w = yWorld();
  const bossName = (w.skin.boss && w.skin.boss.name) || "-";
  const oldMastery = masteryPctOf(w.liveQs, w.state.boxes);

  app.innerHTML = `
    <div class="home-title" style="font-size:22px">⚠️ 新しいボスが あらわれた!</div>
    <div class="confirm-card">
      <p>いまのボス「<b>${esc(bossName)}</b>」との勝負を終わりにして、新しいボスに挑む?</p>
      <p style="margin-top:10px;">いまの進捗(マスター率 <b>${oldMastery}%</b>)はリセットされるよ。討伐のきろくには自動で記録されます。</p>
      <p style="margin-top:10px;">新しいバンク: <b>${esc(newBank.bankVersion||"-")}</b>(テスト日: ${esc(newBank.testDate||"-")})</p>
      <div class="confirm-btns">
        <button class="code-btn" id="confirmYes">うん、挑む!</button>
        <button class="reset-bank-btn" id="confirmNo" style="margin-top:0;">まだ やめておく</button>
      </div>
    </div>`;

  document.getElementById("confirmYes").addEventListener("click", () => {
    proceedCycleSwitch(newBank);
    pendingCycleSwitch = null;
    if(origin === "menu") renderParentMenu({ target:"bank", subject:"Y", ok:true, text:"✅ 新しいボスに交代しました!(討伐のきろくに記録済み)" });
    else { VIEW = { tab:"junbi", subject:"Y" }; saveLastView(); renderBossHome(); }
  });
  document.getElementById("confirmNo").addEventListener("click", () => {
    /* 拒否: 現行バンクで継続。記録は書き換えないので次回起動時に再度確認される(§7.1-3) */
    pendingCycleSwitch = null;
    if(origin === "menu") renderParentMenu({ target:"bank", subject:"Y", ok:false, text:"交代をキャンセルしました。" });
    else { VIEW = { tab:"junbi", subject:"Y" }; saveLastView(); renderBossHome(); }
  });
}

/* ---------- クイズ用コンテキスト ---------- */
function junbiCtx(){
  return {
    world: yWorld(),
    mode: "yoshu",
    buildSession: (world, cat, today) => buildSessionYoshu(yUnlockedQs(), world.state, cat, today),
    topbarHtml: (world) => {
      const hp = yHP();
      const emoji = (world.skin.boss && world.skin.boss.emoji) || "👑";
      return `<div class="hp-mini">
        <span class="em">${esc(emoji)}</span>
        <div class="hp-mini-track"><div class="hp-mini-fill" style="width:${Math.max(hp,0)}%"></div></div>
      </div>`;
    },
    initExtra: () => {
      const start = {};
      yWorld().cats.forEach(c => { start[c.cat] = ySubjectMastery(c.cat); });
      return { startOverallMastery: yOverallMastery(), startSubjMastery: start, sealBreaks: [] };
    },
    onAnswer: (world, q, ok, s, phase, pre) => {
      if(phase === "before") return { preSubjPct: ySubjectMastery(q.cat) };
      const postSubjPct = ySubjectMastery(q.cat);
      const boss = world.skin.boss || {};
      let banners = "";
      if(!ok) return { banners:"", okHead:"⚔️ ヒット!" };

      const dmgLine = pick((boss.lines && boss.lines.damage) || []);
      if(dmgLine) banners += `<div class="boss-react">${esc(boss.emoji||"")} 「${esc(dmgLine)}」</div>`;
      if(q._revenge){
        banners += `<div class="counter-banner">🔥 ${esc((boss.lines&&boss.lines.counter) || "カウンター攻撃! リベンジ成功でクリティカル!!")}</div>`;
      }
      if(pre && pre.preSubjPct < SEAL_THRESHOLD && postSubjPct >= SEAL_THRESHOLD){
        s.extra.sealBreaks.push(q.cat);
        banners += `<div class="sealbreak-banner">✨ ${esc((boss.lines&&boss.lines.sealBreak) || "封印がひとつ解けた!")}(${esc(q.cat)})</div>`;
      }
      return { banners, okHead:"⚔️ ヒット!" };
    },
    resultWorldHtml: (world, s) => {
      const boss = world.skin.boss || {};
      const hpBefore = 100 - s.extra.startOverallMastery;
      const hpAfter = yHP();
      const keys = yKeys();
      const allOpen = allKaisUnlocked(world.liveQs, keys);
      const justDefeated = hpBefore > 0 && hpAfter <= 0 && allOpen;   // 討伐ガード(yoshu §4)
      const guarded = hpAfter <= 0 && !allOpen;
      const sealBreaks = [...new Set(s.extra.sealBreaks)];
      return `<div class="boss-card ${justDefeated?'defeated':''}">
          <div class="boss-emoji-big">${justDefeated ? "🏆" : esc(boss.emoji||"👑")}</div>
          <div class="boss-name">${esc(boss.name||"")}</div>
          <div class="hp-label">HPの変化</div>
          <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${Math.max(hpAfter,0)}%"></div></div>
          <div class="hp-text">${Math.max(hpBefore,0)} → ${Math.max(hpAfter,0)} / 100</div>
          ${justDefeated ? `<div class="defeat-banner">🎉🎊 ${esc((boss.lines&&boss.lines.defeat) || "討伐した!")} 🎊🎉</div>` : ""}
          ${guarded ? `<div class="defeat-banner">まだ封印された力が残っておるぞ?(習ったら次の回を解放しよう)</div>` : ""}
        </div>
        ${sealBreaks.length ? `<div class="sealbreak-banner">✨ ${esc((boss.lines&&boss.lines.sealBreak) || "封印がひとつ解けた!")}(${sealBreaks.map(esc).join("・")})</div>` : ""}`;
    },
    goHome: () => renderBossHome()
  };
}
