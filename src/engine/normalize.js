/* =====================================================================
   engine/normalize.js — 入力モード自動判定と答え合わせ用の正規化
   仕様: fukushu §6(予習エンジンも同一実装)
   ===================================================================== */

/* 全ての正答候補が数値/分数のときだけ数字キーパッドモード。
   それ以外(漢字・かな回答)はテキスト入力モード */
function isNumericQuestion(q){
  return q.ans.every(a => /^-?\d+(\.\d+)?$/.test(a) || /^\d+\/\d+$/.test(a));
}

function normZen(s){
  return s.replace(/[０-９．／]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0));
}

function norm(s, numeric){
  const z = normZen(s);
  if(numeric){
    return z.replace(/[\s。、点円個こ回人gkmcページ]/g, "").trim();
  }
  /* テキストモード: 空白・句読点を除去し、カタカナ→ひらがなに折り畳んで比較
     (「すいさんかカルシウム」のようなかな交じり入力を正解にするため。答え側にも同じ正規化がかかる) */
  return z.replace(/[\s。、！？!?]/g, "")
          .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0)-0x60))
          .trim();
}

function answerMatches(q, input){
  const numeric = isNumericQuestion(q);
  const okSet = new Set(q.ans.map(a => norm(a, numeric)));
  return okSet.has(norm(input, numeric));
}
