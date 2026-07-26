/* =====================================================================
   engine/titles.js — 称号判定とマップ計算
   仕様: fukushu §3
   ・称号condはエンジン実装済みの条件名のみ使用可
     (noHintStreakN / hintCorrectN / revengeWin / perfectStage / totalCorrectN)
   ・称号は永続化せず、セッション内スタッツ+累計xpで毎回判定(「今回獲得」表示)
   ===================================================================== */

function condMet(cond, stats, totalXp){
  if(cond.startsWith("noHintStreak")) return stats.noHintMaxStreak >= parseInt(cond.replace("noHintStreak",""),10);
  if(cond.startsWith("hintCorrect"))  return stats.hintCorrectCount >= parseInt(cond.replace("hintCorrect",""),10);
  if(cond === "revengeWin")   return !!stats.revengeWin;
  if(cond === "perfectStage") return !!stats.perfectStage;
  if(cond.startsWith("totalCorrect")) return totalXp >= parseInt(cond.replace("totalCorrect",""),10);
  return false;
}

function earnedTitles(skin, stats, totalXp){
  return (skin.titles || []).filter(t => condMet(t.cond, stats, totalXp));
}

/* map.nodes は最大60。総正解数(xp)で現在地を算出 */
function nodeIndexForXp(xp, map){
  const nodes = map.nodes;
  const step = map.stepPerCorrect || 1;
  return Math.min(Math.floor(xp / step), nodes.length - 1);
}
