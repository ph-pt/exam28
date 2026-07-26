/* =====================================================================
   engine/leitner.js — ライトナー式スケジュールとセッション構成
   仕様: fukushu §4(3/7/21日)/ yoshu §6(圧縮 0/1/3日)/ v4.1 §4.3(問題別 last 基準)
   ===================================================================== */

const INTERVALS = {
  fukushu: { 0:0, 1:3, 2:7, 3:21 },
  yoshu:   { 0:0, 1:1, 2:3,  3:3 }
};

const SESSION_SIZE = 8;
const REVIEW_SLOTS = 4;

/* v4.1 §4.3: 期日 = last[id] + 箱の間隔。last が無い問題は期日計算の対象外(未出題プールへ) */
function isDueByLast(box, lastStr, today, intervals){
  const last = parseDateKey(lastStr);
  if(!last) return false;
  return daysBetween(last, today) >= (intervals[box] ?? 0);
}

/* ---------- ふくしゅう(M/R/S/K)のセッション構成 ----------
   fukushu §4:
     間口(cat)選択時: リベンジ(箱0)は間口に関係なく最大2問混入
       → 期日到来の復習(間口内)→ 残りを間口内から補完(不足時のみ全体から)
     🎲おまかせミックス: 箱0は最大4問
   v4.1 記録4(承認済): 箱0の間口またぎは復習側の現行挙動を据え置く
   箱3も期日到来(21日)で必ず候補に含める(fukushu v2.1 の必須挙動)             */
function buildSessionFukushu(liveQs, state, cat, today, rnd){
  const boxes = state.boxes || {}, last = state.last || {};
  const iv = INTERVALS.fukushu;
  const inCat = q => !cat || q.cat === cat;

  const pool0=[], due1=[], due2=[], due3=[];
  liveQs.forEach(q => {
    const box = boxes[q.id] ?? 2;              // 復習の未出題は箱2扱い(v4.1 記録3)
    if(box === 0) pool0.push(q);               // リベンジは間口に関係なく候補
    else if(box === 1 && inCat(q) && isDueByLast(1, last[q.id], today, iv)) due1.push(q);
    else if(box === 2 && inCat(q) && isDueByLast(2, last[q.id], today, iv)) due2.push(q);
    else if(box === 3 && inCat(q) && isDueByLast(3, last[q.id], today, iv)) due3.push(q);
  });

  const revCap = cat ? 2 : 4;
  const review = [
    ...shuffle(pool0, rnd).slice(0, revCap),
    ...shuffle(due1, rnd), ...shuffle(due2, rnd), ...shuffle(due3, rnd)
  ].slice(0, REVIEW_SLOTS);

  const revengeIds = new Set(pool0.map(q => q.id));
  const usedIds = new Set(review.map(q => q.id));
  const catPool = shuffle(liveQs.filter(q => !usedIds.has(q.id) && inCat(q)), rnd);
  const anyPool = shuffle(liveQs.filter(q => !usedIds.has(q.id) && !inCat(q)), rnd);
  const needed = Math.max(0, SESSION_SIZE - review.length);
  const fill = [...catPool, ...anyPool].slice(0, needed);   // 間口内で足りなければ全体から補完

  return shuffle([...review, ...fill], rnd)
    .map(q => ({ ...q, _revenge: revengeIds.has(q.id) }));
}

/* ---------- じゅんび(Y)のセッション構成 ----------
   yoshu §6 v1.3.1(間口の純粋化):
     間口(科目)を選んだ場合、箱0・期日到来の復習・未出題・補完のすべてを間口内に限定する。
     間口内の解放済み問題が8問に満たない場合はセッションを短縮し、他科目では埋めない。
     🎲おまかせミックス(cat=null)のみ全科目を母数とする。
   優先順: 箱0(最大2/4問)→ 期日到来の復習 → 未出題 → 間口内の残りで補完
   未解放の回の問題は候補に含めない(§5。unlockedQs で渡す)
   「未出題」は boxes[id] が存在しないことで判定(0=直近誤答と明確に区別。v4.1 記録3)  */
function buildSessionYoshu(unlockedQs, state, cat, today, rnd){
  const boxes = state.boxes || {}, last = state.last || {};
  const iv = INTERVALS.yoshu;

  const UQS = unlockedQs.filter(q => !cat || q.cat === cat);   // 先に間口で絞り込む
  const pool0=[], due1=[], due2=[], due3=[], unseen=[];
  UQS.forEach(q => {
    const box = boxes[q.id];
    if(box === undefined) unseen.push(q);
    else if(box === 0) pool0.push(q);
    else if(box === 1 && isDueByLast(1, last[q.id], today, iv)) due1.push(q);
    else if(box === 2 && isDueByLast(2, last[q.id], today, iv)) due2.push(q);
    else if(box === 3 && isDueByLast(3, last[q.id], today, iv)) due3.push(q);
  });

  const revCap = cat ? 2 : 4;
  const review = [
    ...shuffle(pool0, rnd).slice(0, revCap),
    ...shuffle(due1, rnd), ...shuffle(due2, rnd), ...shuffle(due3, rnd)
  ].slice(0, REVIEW_SLOTS);

  const revengeIds = new Set(pool0.map(q => q.id));
  const usedIds = new Set(review.map(q => q.id));
  const needed = Math.max(0, SESSION_SIZE - review.length);
  const fill = shuffle(unseen.filter(q => !usedIds.has(q.id)), rnd).slice(0, needed);

  let session = [...review, ...fill];
  if(session.length < SESSION_SIZE){
    /* 全問マスター済み等で足りない場合は、間口内の残り(期日前の問題)から補完 */
    const usedAll = new Set(session.map(q => q.id));
    session = [...session,
      ...shuffle(UQS.filter(q => !usedAll.has(q.id)), rnd).slice(0, SESSION_SIZE - session.length)];
  }

  return shuffle(session, rnd)
    .map(q => ({ ...q, _revenge: revengeIds.has(q.id) }));
}

/* 正誤確定時の箱遷移。正解→箱+1(上限3)、誤答→箱0 */
function nextBox(curBox, ok, mode){
  const base = curBox === undefined ? (mode === "fukushu" ? 2 : 0) : curBox;
  return ok ? Math.min(base+1, 3) : 0;
}
