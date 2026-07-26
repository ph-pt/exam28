/* =====================================================================
   engine/state.js — 自動保存する進捗 state(v4.1 §4.2 / §4.3)
   {
     "v": 1, "bankVersion": "M_2026_07_02",
     "boxes": {"M0001": 2}, "last": {"M0001": "2026-07-26"}, "xp": 123
   }
   ・boxes: キーが無いid = 未出題(復習=箱2初期扱い / 予習=未出題別管理)
   ・last : その問題に最後に解答した日(期日計算に使用)
   ===================================================================== */

const STATE_VERSION = 1;

function emptyState(bankVersion){
  return { v: STATE_VERSION, bankVersion: bankVersion || "", boxes: {}, last: {}, xp: 0 };
}

function isValidState(s){
  return !!(s && s.v === STATE_VERSION && s.boxes && typeof s.boxes === "object" &&
            s.last && typeof s.last === "object" && typeof s.xp === "number");
}

/* §4.2 起動時の突合。バンクが成長していれば新規idは「未出題」として扱う。
   未出題は boxes にキーが無い状態そのものなので、追加操作は不要
   (復習側は参照時に箱2として解決する)。現バンクに存在しないidは持ち越さない。 */
function reconcileState(state, bank){
  const ids = new Set((bank.questions || []).map(q => q.id));
  const boxes = {}, last = {};
  Object.keys(state.boxes || {}).forEach(id => { if(ids.has(id)) boxes[id] = state.boxes[id]; });
  Object.keys(state.last  || {}).forEach(id => { if(ids.has(id)) last[id]  = state.last[id]; });
  return { v: STATE_VERSION, bankVersion: bank.bankVersion || "", boxes, last, xp: state.xp || 0 };
}

function loadState(subject, bank){
  const raw = lsGetJSON(keyState(subject));
  if(!isValidState(raw)) return emptyState(bank.bankVersion);
  return reconcileState(raw, bank);
}

function saveState(subject, state){
  return lsSetJSON(keyState(subject), state);
}

/* 解答確定時の state 更新(§4.1: これを呼んだ直後に saveState する) */
function recordAnswer(state, q, ok, mode, today){
  state.boxes[q.id] = nextBox(state.boxes[q.id], ok, mode);
  state.last[q.id]  = dateKey(today || new Date());
  if(ok) state.xp = Math.min((state.xp || 0) + 1, 4095);
  return state;
}

/* §4.3: セーブコードから復元した場合のみ、全問の last を復元日で一括初期化する
   (コードは日付を持たないため。従来挙動と同等) */
function applyRestoredCode(state, parsed, bank, restoreDate){
  const day = dateKey(restoreDate || new Date());
  const last = {};
  Object.keys(parsed.boxes).forEach(id => { last[id] = day; });
  return {
    v: STATE_VERSION,
    bankVersion: bank.bankVersion || "",
    boxes: { ...parsed.boxes },
    last,
    xp: parsed.xp || 0
  };
}
