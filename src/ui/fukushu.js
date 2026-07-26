/* =====================================================================
   ui/fukushu.js — 🗾ふくしゅうタブ: 科目ドア → 科目ホーム(旅マップ+間口)
   仕様: fukushu §4 / §8-6(マップ画面)、v4.1 §2(各科目は自科目スキンのみ参照)
   ===================================================================== */

function renderSubjectDoors(){
  quiz = null;
  VIEW = { tab:"fukushu", subject:null };
  saveLastView();
  const subs = visibleFukushuSubjects();

  app.innerHTML = `
    ${bannerHtml()}
    ${tabsHtml()}
    <div class="home-title">🗾 ふくしゅうクエスト</div>
    <div class="home-sub">きょうは どの教科にする?</div>
    ${subs.map(s => {
      const w = WORLDS[s];
      const idx = nodeIndexForXp(w.state.xp, w.skin.map);
      const node = w.skin.map.nodes[idx];
      return `<button class="stage-btn door" data-sub="${s}">
        <div class="stage-name">${SUBJECT_ICON[s]} ${SUBJECT_LABEL[s]}</div>
        <div class="stage-desc">${esc(w.skin.title || "")}</div>
        <div class="door-here">いま: ${esc(node.emoji)} ${esc(node.name)}(${idx}/${w.skin.map.nodes.length-1})</div>
      </button>`;
    }).join("")}
    <div class="home-note">きろくは この端末に自動でほぞんされるよ。</div>
    <div class="parent-menu-row"><button class="parent-menu-btn" id="parentMenuBtn">⚙️ おうちの人メニュー</button></div>`;

  bindBanner();
  bindTabs();
  app.querySelectorAll(".door").forEach(b => b.addEventListener("click", () => {
    VIEW = { tab:"fukushu", subject:b.dataset.sub };
    saveLastView();
    applySkinColors(WORLDS[b.dataset.sub].skin);
    renderSubjectHome(b.dataset.sub);
  }));
  document.getElementById("parentMenuBtn").addEventListener("click", () => renderParentMenu());
}

function renderSubjectHome(subject){
  quiz = null;
  VIEW = { tab:"fukushu", subject };
  saveLastView();
  const w = WORLDS[subject];
  const map = w.skin.map;
  const idx = nodeIndexForXp(w.state.xp, map);
  const nodes = map.nodes;
  const node = nodes[idx];
  const atGoal = idx >= nodes.length - 1;
  const pct = Math.round((idx/(nodes.length-1))*100);
  const nextNode = nodes[Math.min(idx+1, nodes.length-1)];

  app.innerHTML = `
    ${bannerHtml()}
    ${tabsHtml()}
    <div class="topbar"><button class="quit-btn" id="backDoors">← 教科をえらぶ</button></div>
    <div class="home-title">${SUBJECT_ICON[subject]} ${esc(w.skin.title || SUBJECT_LABEL[subject])}</div>
    <div class="home-sub">1かい 8もん。ヒントを使ってもOK!<br>${esc(w.skin.writeTip || "ノートに書いてから答えるのがルールだよ ✏️")}</div>

    <div class="map-card">
      <div class="map-label">いま、たびの場所</div>
      <div class="map-here"><div class="map-emoji">${esc(node.emoji)}</div><div class="map-name">${esc(node.name)}</div></div>
      <div class="map-progress-wrap">
        <div class="map-bar-track"><div class="map-bar-fill" style="width:${pct}%"></div></div>
        <div class="map-progress-text"><span>${atGoal ? "🎉 ゴールにとうちゃく!" : `つぎは ${esc(nextNode.emoji)} ${esc(nextNode.name)}`}</span><span>${idx}/${nodes.length-1}</span></div>
      </div>
      ${atGoal ? `<div class="map-goal">${esc(map.goalMessage||"")}</div>` : ""}
    </div>

    <div class="doors-label">きょうは どれにする?</div>
    ${w.cats.map(c => `<button class="stage-btn" data-cat="${esc(c.cat)}">
        <div class="stage-name">${esc(c.icon||"⭐")} ${esc(c.cat)}</div>
        <div class="stage-desc">${esc(c.desc||"")}</div>
      </button>`).join("")}
    <button class="stage-btn omakase" data-cat="">
      <div class="stage-name">🎲 おまかせミックス</div>
      <div class="stage-desc">復習もぜんぶまぜて8問。まよったらこれ!</div>
    </button>

    <div class="home-note">きろくは この端末に自動でほぞんされるよ。</div>
    <div class="parent-menu-row"><button class="parent-menu-btn" id="parentMenuBtn">⚙️ おうちの人メニュー</button></div>`;

  bindBanner();
  bindTabs();
  document.getElementById("backDoors").addEventListener("click", () => renderSubjectDoors());
  app.querySelectorAll(".stage-btn[data-cat]").forEach(b =>
    b.addEventListener("click", () => startQuiz(fukushuCtx(subject), b.dataset.cat || null)));
  document.getElementById("parentMenuBtn").addEventListener("click", () => renderParentMenu());
}

/* ---------- クイズ用コンテキスト ---------- */
function fukushuCtx(subject){
  const w = WORLDS[subject];
  return {
    world: w,
    mode: "fukushu",
    buildSession: (world, cat, today) => buildSessionFukushu(world.liveQs, world.state, cat, today),
    topbarHtml: (world) => {
      const map = world.skin.map;
      const i = nodeIndexForXp(world.state.xp, map);
      const pct = Math.round((i/(map.nodes.length-1))*100);
      return `<div class="journey-mini">
        <span class="em">${esc(map.nodes[i].emoji)}</span>
        <div class="journey-mini-track"><div class="journey-mini-fill" style="width:${pct}%"></div></div>
      </div>`;
    },
    initExtra: (world) => ({ startNodeIdx: nodeIndexForXp(world.state.xp, world.skin.map) }),
    onAnswer: (world, q, ok, s, phase) => phase === "after" ? { banners:"", okHead:"⭕ せいかい!" } : null,
    resultWorldHtml: (world, s) => {
      const nodes = world.skin.map.nodes;
      const newIdx = nodeIndexForXp(world.state.xp, world.skin.map);
      const startIdx = s.extra.startNodeIdx;
      const moved = newIdx - startIdx;
      const atGoal = newIdx >= nodes.length - 1;
      return `<div class="journey-card">
        <div class="journey-move">${moved>0?`${moved}歩 すすんだ!`:"今回はたびの歩数なし。また次回!"}</div>
        <div class="journey-nodes">
          <span>${esc(nodes[startIdx].emoji)}</span>
          ${moved>0?`<span class="journey-arrow">→</span><span>${esc(nodes[newIdx].emoji)}</span>`:""}
        </div>
        <div class="journey-newname">いま: ${esc(nodes[newIdx].name)}${atGoal?" 🎉":""}</div>
        ${atGoal ? `<div class="map-goal" style="margin-top:8px">${esc(world.skin.map.goalMessage||"")}</div>` : ""}
      </div>`;
    },
    goHome: () => renderSubjectHome(subject)
  };
}
