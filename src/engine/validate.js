/* =====================================================================
   engine/validate.js — バンク/スキンのバリデーション
   仕様: v4.1 §6(fukushu §7 を土台に科目分岐)/ yoshu §8
   ・不合格は更新拒否+理由表示、現行バンク維持(全科目共通)
   ===================================================================== */

const YOSHU_REQUIRED_CATS = ["算数", "国語", "社会", "理科"];

/* ---------- 図版(SVG)の検査 — v4.2 §5.2 / §6 ----------
   svg は任意フィールド。無い問題は従来どおり(後方互換)。
   ここは文字列レベルの門前払い。描画直前にはホワイトリスト方式の
   サニタイズ(ui/quiz.js の sanitizeSvg)がもう一段かかる。
   不合格なら理由文字列、問題なければ null を返す。                    */
function svgFieldError(svg){
  if(svg === undefined || svg === null) return null;          // 未指定はOK
  if(typeof svg !== "string") return "svgは文字列で指定してください";
  const s = svg.trim();
  if(!s) return "svgが空です";
  if(!/^<svg[\s>]/i.test(s))  return "svgは <svg で始まる必要があります";
  if(!/<\/svg>$/i.test(s))    return "svgは </svg> で終わる必要があります";
  if(/<script[\s>]/i.test(s)) return "svgに script は含められません";
  if(/<foreignObject[\s>]/i.test(s)) return "svgに foreignObject は含められません";
  if(/<\s*(iframe|embed|object|animate|set)[\s>]/i.test(s)) return "svgに埋め込み・アニメーション要素は含められません";
  if(/\son[a-z]+\s*=/i.test(s)) return "svgにイベント属性(on*)は含められません";
  if(/javascript\s*:/i.test(s)) return "svgに javascript: は含められません";

  /* 外部参照の禁止(オフライン原則 §7)。フラグメント参照(#id)のみ許可 */
  const refs = s.match(/(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi) || [];
  for(const r of refs){
    const v = (/(["'])([\s\S]*?)\1/.exec(r) || [])[2] || "";
    if(!v.trim().startsWith("#")) return "svgに外部参照(href)は含められません";
  }
  if(/url\s*\(\s*["']?\s*(?!#)/i.test(s)) return "svgに外部リソース参照(url())は含められません";
  return null;
}

/* 起動時の構造チェック(内蔵バンク・localStorageキャッシュの読み込み用)。
   §5 の空バンク bank_K を通すため questions は空配列を許容する
   (おうちの人メニューからの投入では validateBankPaste が 1問以上を要求する) */
function validateBankObj(b, subject){
  if(!b || typeof b !== "object") return false;
  if(b.subject !== subject) return false;
  if(!Array.isArray(b.cats)) return false;
  if(!Array.isArray(b.questions)) return false;
  return b.questions.every(q =>
    q && q.id && q.q && q.cat && Array.isArray(q.ans) && q.ans.length > 0 &&
    svgFieldError(q.svg) === null);          // v4.2: 壊れた/危険な図版を持つバンクは採用しない
}

function validateSkinObj(s, kind){
  if(!s || !s.colors || !Array.isArray(s.praise) || !Array.isArray(s.cheer)) return false;
  if(!s.hintPraise) return false;                       // ヒント称賛文化(fukushu §3 必須要件)
  if(kind === "boss"){
    return !!(s.boss && s.boss.name && s.boss.emoji && s.boss.lines &&
      s.boss.lines.appear && Array.isArray(s.boss.lines.damage) && s.boss.lines.damage.length > 0 &&
      s.boss.lines.sealBreak && s.boss.lines.defeat && s.boss.lines.escape);
  }
  return !!(s.map && Array.isArray(s.map.nodes) && s.map.nodes.length > 0 && Array.isArray(s.titles));
}

/* ans規則の共通判定。テキスト解答は2表記以上が必要かどうかを返す
   ・K(国語)は全問スキップ(v4.1 §5: 読み=ひらがな1種 / 書き=漢字1種)
   ・Y は cat が「国語」の問題のみスキップ(yoshu §2 v1.1 の例外) */
function ansNeedsTwoForms(q, subject){
  if(isNumericQuestion(q)) return false;
  if(subject === "K") return false;
  if(subject === "Y" && q.cat === "国語") return false;
  return true;
}

/* ---------- M/R/S/K(永続バンク) ---------- */
function validateBankPasteFukushu(text, subject, existingIds){
  let c;
  try{ c = JSON.parse(text); }
  catch(e){ return { ok:false, reason:"JSONとして読み取れませんでした。貼り付け内容を確認してください。" }; }

  if(!c || typeof c !== "object") return { ok:false, reason:"バンクの形式が正しくありません。" };
  if(c.subject !== subject){
    return { ok:false, reason:`subjectが一致しません(この枠は "${subject}" 用です)。` };
  }
  if(!Array.isArray(c.questions) || c.questions.length === 0){
    return { ok:false, reason:"questions配列が見つかりません(1問以上必要です)。" };
  }
  if(!Array.isArray(c.cats) || c.cats.length === 0){
    return { ok:false, reason:"cats(間口の定義)がありません。" };
  }

  const catNames = new Set(c.cats.map(x => x && x.cat));
  const idRe = new RegExp("^" + subject + "\\d{4}$");
  const ids = [];
  for(const q of c.questions){
    if(!q || !q.id || !idRe.test(q.id)){
      return { ok:false, reason:`不正なid形式があります: ${q && q.id}(${subject}+4桁の形式にしてください)` };
    }
    if(!q.cat) return { ok:false, reason:`catが未設定の問題があります(id: ${q.id})。` };
    if(!catNames.has(q.cat)){
      return { ok:false, reason:`catsに定義されていないcatがあります(id: ${q.id} / cat: ${q.cat})。` };
    }
    if(!Array.isArray(q.ans) || q.ans.length === 0){
      return { ok:false, reason:`ansが未設定の問題があります(id: ${q.id})。` };
    }
    if(ansNeedsTwoForms(q, subject) && q.ans.length < 2){
      return { ok:false, reason:`テキスト回答は漢字+ひらがな等、2種類以上のans表記が必要です(id: ${q.id})。` };
    }
    const svgErr = svgFieldError(q.svg);
    if(svgErr) return { ok:false, reason:`${svgErr}(id: ${q.id})。` };
    ids.push(q.id);
  }

  const idSet = new Set(ids);
  if(idSet.size !== ids.length) return { ok:false, reason:"idが重複しています。" };

  /* id永続: 既存idの欠落は禁止(外したい場合は retired で残置) */
  const missing = (existingIds || []).filter(id => !idSet.has(id));
  if(missing.length){
    return { ok:false, reason:`既存のidが欠落しています(削除は禁止・外したい場合はretiredで対応): ${missing.slice(0,5).join("、")}${missing.length>5?" 他":""}` };
  }

  /* 新規idは既存の続き番号 */
  const numSuffix = id => parseInt(id.slice(subject.length), 10);
  const existingMax = (existingIds || []).length ? Math.max(...existingIds.map(numSuffix)) : 0;
  const badNew = ids.filter(id => !(existingIds || []).includes(id) && numSuffix(id) <= existingMax);
  if(badNew.length){
    return { ok:false, reason:`新規idは既存の続き番号にしてください(番号が既存以下のid: ${badNew.slice(0,5).join("、")})。` };
  }

  return { ok:true, bank:c };
}

/* ---------- Y(サイクル使い捨てバンク) ---------- */
function validateBankPasteYoshu(text){
  let c;
  try{ c = JSON.parse(text); }
  catch(e){ return { ok:false, reason:"JSONとして読み取れませんでした。貼り付け内容を確認してください。" }; }

  if(!c || typeof c !== "object") return { ok:false, reason:"バンクの形式が正しくありません。" };
  if(c.subject !== "Y"){
    return { ok:false, reason:`subjectが一致しません(この枠は "Y"(4科統合)用です)。` };
  }
  if(!c.testDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.testDate)){
    return { ok:false, reason:"testDateがISO日付(YYYY-MM-DD形式)で設定されていません。" };
  }
  if(!Array.isArray(c.questions) || c.questions.length === 0){
    return { ok:false, reason:"questions配列が見つかりません。" };
  }
  if(!Array.isArray(c.cats) || !YOSHU_REQUIRED_CATS.every(rc => c.cats.some(x => x && x.cat === rc))){
    return { ok:false, reason:"catsに4科(算数・国語・社会・理科)すべてが定義されている必要があります。" };
  }

  const idRe = /^Y\d{4}$/;
  const idSet = new Set();
  for(const q of c.questions){
    if(!q || !q.id || !idRe.test(q.id)){
      return { ok:false, reason:`不正なid形式があります: ${q && q.id}(Y+4桁の形式にしてください)` };
    }
    if(idSet.has(q.id)) return { ok:false, reason:`idが重複しています: ${q.id}` };
    idSet.add(q.id);
    if(!q.cat || !YOSHU_REQUIRED_CATS.includes(q.cat)){
      return { ok:false, reason:`catが4科(算数/国語/社会/理科)のいずれでもない問題があります(id: ${q.id})。` };
    }
    if(!Array.isArray(q.ans) || q.ans.length === 0){
      return { ok:false, reason:`ansが未設定の問題があります(id: ${q.id})。` };
    }
    if(ansNeedsTwoForms(q, "Y") && q.ans.length < 2){
      return { ok:false, reason:`テキスト回答は漢字+ひらがな等、2種類以上のans表記が必要です(id: ${q.id})。国語の漢字問題のみ1種可。` };
    }
    const svgErr = svgFieldError(q.svg);
    if(svgErr) return { ok:false, reason:`${svgErr}(id: ${q.id})。` };
  }
  /* サイクル使い捨てのため既存バンクとの連続性チェックは行わない(yoshu §8) */
  return { ok:true, bank:c };
}

function validateBankPaste(text, subject, existingIds){
  return subject === "Y"
    ? validateBankPasteYoshu(text)
    : validateBankPasteFukushu(text, subject, existingIds);
}

function validateSkinPaste(text, kind){
  let c;
  try{ c = JSON.parse(text); }
  catch(e){ return { ok:false, reason:"JSONとして読み取れませんでした。貼り付け内容を確認してください。" }; }
  if(!validateSkinObj(c, kind)){
    return { ok:false, reason: kind === "boss"
      ? "スキンの必須項目(boss.name/emoji/lines、colors、praise、cheer、hintPraise)が不足しています。"
      : "スキンの必須項目(colors、praise、cheer、hintPraise、map.nodes、titles)が不足しています。" };
  }
  return { ok:true, skin:c };
}
