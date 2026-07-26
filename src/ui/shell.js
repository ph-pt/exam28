/* =====================================================================
   ui/shell.js — アプリ外枠: 最上位タブ・トースト・警告バナー・画面遷移
   仕様: v4.1 §2(タブ・科目間で進捗/XP/演出世界は完全分離)
   ===================================================================== */

const app = document.getElementById("app");

const FUKUSHU_SUBJECTS = ["M", "R", "S", "K"];
const SUBJECT_LABEL = { M:"算数", R:"理科", S:"社会", K:"国語", Y:"じゅんび" };
const SUBJECT_ICON  = { M:"🧮", R:"🔬", S:"🗾", K:"📖" };

/* subject -> { subject, mode, bank, skin, bankSource, skinSource, state, allQs, liveQs, cats } */
const WORLDS = {};

let VIEW = { tab: "fukushu", subject: null };     // subject=null はふくしゅうの科目ドア画面
let fallbackWarnings = [];
let pendingCycleSwitch = null;                    // §7.1 起動時確認待ちの新bank_Y

/* ---------- 世界(科目)ごとの派生 ---------- */
function deriveWorld(w){
  w.allQs  = [...(w.bank.questions || [])].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  w.liveQs = w.allQs.filter(q => !q.retired);
  w.cats   = (Array.isArray(w.bank.cats) ? w.bank.cats : []).filter(c => w.liveQs.some(q => q.cat === c.cat));
  return w;
}

function worldOf(subject){ return WORLDS[subject]; }

/* 国語ドアは bank_K が1問以上あるときのみ表示(§2) */
function visibleFukushuSubjects(){
  return FUKUSHU_SUBJECTS.filter(s => s !== "K" || (WORLDS.K && WORLDS.K.liveQs.length > 0));
}

/* ---------- スキン色をCSS変数へ反映(fukushu §3) ---------- */
function applySkinColors(skin){
  const r = document.documentElement.style, c = (skin && skin.colors) || {};
  if(c.bg)     r.setProperty("--paper", c.bg);
  if(c.ink)    r.setProperty("--ink", c.ink);
  if(c.accent) r.setProperty("--orange", c.accent);
  if(c.ok)     r.setProperty("--mint", c.ok);
  if(c.ng)     r.setProperty("--coral", c.ng);
  if(c.star)   r.setProperty("--star", c.star);
}

/* ---------- トースト ---------- */
function showToast(text, onTap){
  const el = document.getElementById("toast");
  if(!el) return;
  el.innerHTML = `<button class="toast-body" type="button">${esc(text)}</button>`;
  el.classList.add("on");
  const dismiss = () => { el.classList.remove("on"); el.innerHTML = ""; };
  el.querySelector(".toast-body").addEventListener("click", () => {
    dismiss();
    if(onTap) onTap();
  });
  if(!onTap) setTimeout(dismiss, 6000);
}

/* ---------- 警告バナー(§4.1: 保存できない環境) ---------- */
function bannerHtml(){
  let html = "";
  if(fallbackWarnings.length){
    html += `<div class="warn-banner">⚠️ ${fallbackWarnings.map(esc).join("<br>")}</div>`;
  }
  if(!storageAvailable || storageWriteFailed){
    html += `<div class="warn-banner save-banner">⚠️ 保存できない環境です。終わったらセーブコードをメモしてね
      <button class="banner-link" id="bannerCodeBtn">🔑 セーブコードを出す</button></div>`;
  }
  return html;
}

function bindBanner(){
  const b = document.getElementById("bannerCodeBtn");
  if(b) b.addEventListener("click", () => renderSaveCodeScreen());
}

/* ---------- 最上位タブ ---------- */
function tabsHtml(){
  return `<div class="tabbar">
    <button class="tab ${VIEW.tab==='junbi'?'on':''}" data-tab="junbi">👑 じゅんび</button>
    <button class="tab ${VIEW.tab==='fukushu'?'on':''}" data-tab="fukushu">🗾 ふくしゅう</button>
  </div>`;
}

function bindTabs(){
  app.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
    const tab = b.dataset.tab;
    if(tab === VIEW.tab) return;
    flushAllStates();                       // §4.1 タブ切替でも書き込み
    VIEW = { tab, subject: tab === "junbi" ? "Y" : null };
    saveLastView();
    renderCurrentView();
  }));
}

/* ---------- 画面遷移 ---------- */
function saveLastView(){ lsSetJSON(KEY_LAST_VIEW, VIEW); }

function loadLastView(){
  const v = lsGetJSON(KEY_LAST_VIEW);
  if(!v || (v.tab !== "junbi" && v.tab !== "fukushu")) return { tab:"fukushu", subject:null };
  if(v.tab === "junbi") return { tab:"junbi", subject:"Y" };
  const sub = v.subject && visibleFukushuSubjects().includes(v.subject) ? v.subject : null;
  return { tab:"fukushu", subject: sub };
}

function renderCurrentView(){
  if(VIEW.tab === "junbi"){
    applySkinColors(WORLDS.Y.skin);
    renderBossHome();
  } else if(VIEW.subject){
    applySkinColors(WORLDS[VIEW.subject].skin);
    renderSubjectHome(VIEW.subject);
  } else {
    applySkinColors(WORLDS.M.skin);
    renderSubjectDoors();
  }
}

/* 全科目の state を書き出す(§4.1 セッション終了・タブ切替・visibilitychange) */
function flushAllStates(){
  Object.keys(WORLDS).forEach(s => { saveState(s, WORLDS[s].state); });
}
