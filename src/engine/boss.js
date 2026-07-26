/* =====================================================================
   engine/boss.js — じゅんび(Y)固有の導出: HP・マスター率・封印・解放ゲート・討伐記録
   仕様: yoshu §4(v1.2 部分点HP)/ §5(回単位の解放ゲート)
   状態の二重管理をしない原則: HP・各種率は常に箱から導出する
   ===================================================================== */

const SEAL_THRESHOLD = 80;

/* マスター率(封印解除・討伐判定用・厳密定義): 箱2以上のlive問題数 ÷ live問題数 × 100 */
function masteredCount(qs, boxes){
  return qs.filter(q => (boxes[q.id] ?? -1) >= 2).length;
}
function masteryPctOf(qs, boxes){
  return qs.length ? Math.round(masteredCount(qs, boxes) / qs.length * 100) : 0;
}

/* 進捗率(HP用・部分点 v1.2): 箱2以上=1.0pt / 箱1=0.5pt / 箱0・未出題=0pt
   v1.3: 母数は「解放済みの回」の問題のみ */
function progressPct(qs, boxes){
  if(!qs.length) return 0;
  let pts = 0;
  qs.forEach(q => {
    const b = boxes[q.id] ?? -1;
    if(b >= 2) pts += 1;
    else if(b === 1) pts += 0.5;
  });
  return Math.round(pts / qs.length * 100);
}

function bossHP(qs, boxes){ return 100 - progressPct(qs, boxes); }

/* ---------- 回単位の解放ゲート(yoshu §5) ----------
   各科目の回はバンクの kai から自動検出。初期状態は各科目の最初の回のみ解放。
   解放状態は localStorage に保存するが、消えても自己修復する:
     ①各科目の最初の回は常に解放  ②箱に進捗がある回は解放済みとみなす            */
function kaisOf(liveQs, cat){
  return [...new Set(liveQs.filter(q => q.cat === cat).map(q => q.kai))].sort((a,b) => a-b);
}

function loadStoredUnlocks(){
  const v = lsGetJSON(KEY_UNLOCK);
  return Array.isArray(v) ? v : [];
}
function saveStoredUnlocks(list){ lsSetJSON(KEY_UNLOCK, list); }

function unlockedKeys(liveQs, cats, boxes){
  const set = new Set(loadStoredUnlocks());
  cats.forEach(c => { const ks = kaisOf(liveQs, c.cat); if(ks.length) set.add(c.cat + ":" + ks[0]); });
  liveQs.forEach(q => { if(boxes[q.id] !== undefined) set.add(q.cat + ":" + q.kai); });
  return set;
}
function unlockedQsOf(liveQs, keys){ return liveQs.filter(q => keys.has(q.cat + ":" + q.kai)); }
function allKaisUnlocked(liveQs, keys){ return liveQs.every(q => keys.has(q.cat + ":" + q.kai)); }

function unlockKai(cat, kai){
  const list = loadStoredUnlocks();
  const k = cat + ":" + kai;
  if(!list.includes(k)){ list.push(k); saveStoredUnlocks(list); }
}
function clearUnlocks(){ lsRemove(KEY_UNLOCK); }

/* ---------- 討伐記録(quest_boss_log_Y) ----------
   消えても被害なしのキャッシュ扱い。storage不可時はセッション内メモリで代替 */
let bossLogMemory = [];

function loadBossLog(){
  const v = lsGetJSON(KEY_BOSS_LOG);
  return Array.isArray(v) ? v : bossLogMemory;
}

function saveBossLogEntry(entry){
  const log = loadBossLog();
  log.push(entry);
  bossLogMemory = log;
  lsSetJSON(KEY_BOSS_LOG, log);
}

/* サイクル交代時の記録(yoshu §4 / v4.1 §7.1-2a)。
   mastery は未解放の回も分母に含む全問題ベースの厳密値 */
function buildBossLogEntry(skin, bank, liveQs, boxes){
  const finalMastery = masteryPctOf(liveQs, boxes);
  return {
    bossName: (skin.boss && skin.boss.name) || "-",
    emoji:    (skin.boss && skin.boss.emoji) || "",
    testDate: bank.testDate || "-",
    result:   finalMastery >= 100 ? "討伐" : "取り逃がし",
    mastery:  finalMastery
  };
}
