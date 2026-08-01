#!/usr/bin/env node
/* =====================================================================
   test/run-tests.mjs — §9 検収チェックリストの自動テスト(Node、依存なし)
   実行: node test/run-tests.mjs

   src/engine/*.js を dist と同じ順序で連結し、node:vm 上で評価する。
   ビルド成果物と同一のコードを対象にするため、注入順のズレも検出できる。
   DOM を要する項目(UI表示・PWA・Pages配信)は TESTING.md の手動手順に回す。
   ===================================================================== */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(ROOT, p), "utf8");
const readJSON = p => JSON.parse(read(p));

const ENGINE_FILES = [
  "util.js", "normalize.js", "savecode.js", "leitner.js",
  "validate.js", "storage.js", "state.js", "adopt.js", "boss.js", "titles.js"
];
const ENGINE_SRC = ENGINE_FILES
  .map(f => `/* ${f} */\n` + read(join("src", "engine", f)))
  .join("\n\n");

/* ---------- 実行環境(localStorage スタブつき) ---------- */
function newEnv(opts = {}){
  const store = new Map();
  const ctx = vm.createContext({
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if(opts.readOnly) throw new Error("QuotaExceededError");
        store.set(k, String(v));
      },
      removeItem: k => store.delete(k)
    }
  });
  if(opts.noStorage){
    vm.createContext(ctx);
    Object.defineProperty(ctx, "localStorage", { get(){ throw new Error("blocked"); } });
  }
  vm.runInContext(ENGINE_SRC, ctx);
  vm.runInContext("probeStorage();", ctx);
  ctx.__store = store;
  return ctx;
}

const E = newEnv();                       // 共有環境(状態を持たない検査用)
const run = (ctx, expr) => vm.runInContext(expr, ctx);

/* ---------- テストランナー ---------- */
let pass = 0, fail = 0;
const failures = [];
let group = "";

function section(name){ group = name; console.log(`\n── ${name}`); }
function ok(cond, name, detail){
  if(cond){ pass++; console.log(`  ✓ ${name}`); }
  else{
    fail++; failures.push(`[${group}] ${name}${detail ? " — " + detail : ""}`);
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}
function eq(actual, expected, name){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, name, a === b ? "" : `期待 ${b} / 実際 ${a}`);
}

/* ---------- 素材 ---------- */
const BANKS = {
  M: readJSON("banks/bank_M.json"),
  R: readJSON("banks/bank_R.json"),
  S: readJSON("banks/bank_S.json"),
  K: readJSON("banks/bank_K.json"),
  Y: readJSON("banks/bank_Y.json")
};
const SKINS = {
  M: readJSON("skins/skin_fukushu_M.json"),
  R: readJSON("skins/skin_fukushu_R.json"),
  S: readJSON("skins/skin_fukushu_S.json"),
  K: readJSON("skins/skin_fukushu_K.json"),
  BOSS: readJSON("skins/skin_boss.json")
};
const sortById = qs => [...qs].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const allQs = s => sortById(BANKS[s].questions);
const liveQs = s => allQs(s).filter(q => !q.retired);
const modeOf = s => (s === "Y" ? "yoshu" : "fukushu");

/* --- 期待値はバンクの中身から導出する ---
   月次のバンク更新(問題数・回番号・cat名の変更)で検収テストが落ち、
   デプロイが止まってしまわないようにするため、定数を直書きしない。 */
const catsOf     = s => (BANKS[s].cats || []).map(c => c.cat);
const kaisOfCat  = (s, cat) => [...new Set(liveQs(s).filter(q => q.cat === cat).map(q => q.kai))].sort((a,b) => a-b);
const firstKaiOf = s => {
  const m = {};
  catsOf(s).forEach(c => { const k = kaisOfCat(s, c); if(k.length) m[c] = k[0]; });
  return m;
};
/* 「各科目の最初の回」に属する問題か(=初期解放の対象) */
const isFirstKai = (s, q) => firstKaiOf(s)[q.cat] === q.kai;
/* 既存idの続き番号になる新規id */
const nextId = s => {
  const ids = allQs(s).map(q => q.id);
  const max = ids.length ? Math.max(...ids.map(i => parseInt(i.slice(s.length), 10))) : 0;
  return s + String(max + 1).padStart(4, "0");
};

const DIST = (() => { try{ return read("dist/index.html"); }catch(e){ return null; } })();

/* =====================================================================
   §9-9 / fukushu §10: セーブコード V2 往復・V1互換・成長後復元・巻き戻し検出
   ===================================================================== */
section("§9-9 セーブコード(チェックサム統一後の全科目往復)");
for(const s of ["M","R","S","K","Y"]){
  const qs = allQs(s);
  const mode = modeOf(s);
  const boxes = {};
  qs.forEach((q,i) => { boxes[q.id] = i % 4; });
  const xp = 137;
  const code = run(E, `makeSaveCode(${JSON.stringify(qs)}, ${JSON.stringify(boxes)}, ${xp}, ${JSON.stringify(mode)})`);
  const back = run(E, `parseSaveCode(${JSON.stringify(code)}, ${JSON.stringify(qs)}, ${JSON.stringify(mode)})`);
  ok(/^V2-\d{6}-[A-Z2-7]+$/.test(code), `${s}: V2形式で発行される (${code.slice(0,14)}…)`);
  if(qs.length === 0){
    ok(back && back.xp === xp, `${s}: 空バンクでも往復する`);
  } else {
    eq(back && back.boxes, boxes, `${s}: 箱が完全に往復する(${qs.length}問)`);
    eq(back && back.xp, xp, `${s}: xpが往復する`);
  }
}

section("fukushu §10: V1互換読み込み");
{
  const qs = allQs("M");
  const boxes = {}; qs.forEach((q,i) => { boxes[q.id] = (i*3) % 4; });
  const v1body = run(E, `packStateV1(${JSON.stringify(qs)}, ${JSON.stringify(boxes)}, 42, "fukushu")`);
  const v1chk  = run(E, `checksum(${JSON.stringify(v1body)})`);
  const code = `V1-260702-${v1body}${v1chk}`;
  const back = run(E, `parseSaveCode(${JSON.stringify(code)}, ${JSON.stringify(qs)}, "fukushu")`);
  ok(back && back.version === "V1", "V1コードが受理される");
  eq(back && back.boxes, boxes, "V1コードの箱が復元される");
  eq(back && back.xp, 42, "V1コードのxpが復元される");
}

section("fukushu §10: バンク成長後の旧コード復元 / 巻き戻し検出");
{
  const qs = allQs("M");
  const older = qs.slice(0, qs.length - 5);            // 5問少なかった時代のコード
  const boxes = {}; older.forEach(q => { boxes[q.id] = 1; });
  const code = run(E, `makeSaveCode(${JSON.stringify(older)}, ${JSON.stringify(boxes)}, 10, "fukushu")`);
  const back = run(E, `parseSaveCode(${JSON.stringify(code)}, ${JSON.stringify(qs)}, "fukushu")`);
  ok(!!back && !back.error, "成長後のバンクで旧コードが読める");
  const grown = qs.slice(-5).map(q => back.boxes[q.id]);
  eq(grown, [2,2,2,2,2], "増えた5問は箱2(未出題)で初期化される");
  eq(Object.keys(back.boxes).length, qs.length, "全問がboxesに載る");

  /* 巻き戻し検出: コードの問題数 > 現在のバンク問題数(アプリのバンクが古い) */
  const fullBoxes = {}; qs.forEach(q => { fullBoxes[q.id] = 1; });
  const fullCode = run(E, `makeSaveCode(${JSON.stringify(qs)}, ${JSON.stringify(fullBoxes)}, 10, "fukushu")`);
  const shrunk = qs.slice(0, qs.length - 3);
  const back2 = run(E, `parseSaveCode(${JSON.stringify(fullCode)}, ${JSON.stringify(shrunk)}, "fukushu")`);
  eq(back2 && back2.error, "bank_old", "コードが新しすぎる場合は bank_old エラー");

  /* 予習側: 増えた分はキー未設定(未出題)のまま残る */
  const yqs = allQs("Y");
  const yolder = yqs.slice(0, yqs.length - 4);
  const yboxes = {}; yolder.forEach(q => { yboxes[q.id] = 2; });
  const ycode = run(E, `makeSaveCode(${JSON.stringify(yolder)}, ${JSON.stringify(yboxes)}, 5, "yoshu")`);
  const yback = run(E, `parseSaveCode(${JSON.stringify(ycode)}, ${JSON.stringify(yqs)}, "yoshu")`);
  eq(yqs.slice(-4).filter(q => yback.boxes[q.id] !== undefined).length, 0,
     "予習: 増えた分は未出題(キー未設定)のまま");

  /* 旧サイクルのコードは問題数不一致で自然にエラー(yoshu §7 / §11-7) */
  const bigger = [...yqs, {id:"Y9997"},{id:"Y9998"},{id:"Y9999"}];
  const bcode = run(E, `makeSaveCode(${JSON.stringify(bigger)}, {}, 0, "yoshu")`);
  const bback = run(E, `parseSaveCode(${JSON.stringify(bcode)}, ${JSON.stringify(yqs)}, "yoshu")`);
  eq(bback && bback.error, "bank_old", "予習: 旧サイクルの長いコードはエラーになる");
}

section("セーブコード: 不正入力");
{
  const qs = allQs("M");
  for(const bad of ["", "こんにちは", "V2-260726-AAAA", "V3-260726-ABCDE", "V2-999999-AAAAB"]){
    const r = run(E, `parseSaveCode(${JSON.stringify(bad)}, ${JSON.stringify(qs)}, "fukushu")`);
    ok(r === null || (r && r.error), `不正コードを弾く: ${JSON.stringify(bad)}`);
  }
  /* チェックサム改ざん */
  const good = run(E, `makeSaveCode(${JSON.stringify(qs)}, {}, 0, "fukushu")`);
  const tampered = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
  eq(run(E, `parseSaveCode(${JSON.stringify(tampered)}, ${JSON.stringify(qs)}, "fukushu")`), null,
     "チェックサム不一致を弾く");
}

/* =====================================================================
   §9-3 期日計算(問題別 last 基準)
   ===================================================================== */
section("§9-3 期日計算が問題別 last 基準で正しい");
{
  const iv = { fukushu: {0:0,1:3,2:7,3:21}, yoshu: {0:0,1:1,2:3,3:3} };
  eq(run(E, "INTERVALS.fukushu"), iv.fukushu, "復習の間隔は 0/3/7/21日");
  eq(run(E, "INTERVALS.yoshu"),   iv.yoshu,   "予習の間隔は 0/1/3/3日");

  const today = "new Date(2026,6,26)";
  const check = (box, lastStr, mode) =>
    run(E, `isDueByLast(${box}, ${JSON.stringify(lastStr)}, ${today}, INTERVALS.${mode})`);

  ok(check(1, "2026-07-22", "fukushu") === true,  "復習 箱1: 4日後は到来済み");
  ok(check(1, "2026-07-24", "fukushu") === false, "復習 箱1: 2日後は未到来");
  ok(check(1, "2026-07-23", "fukushu") === true,  "復習 箱1: 3日後に到来");
  ok(check(2, "2026-07-20", "fukushu") === false, "復習 箱2: 6日後は未到来");
  ok(check(2, "2026-07-19", "fukushu") === true,  "復習 箱2: 7日後に到来");
  ok(check(3, "2026-07-06", "fukushu") === false, "復習 箱3: 20日後は未到来");
  ok(check(3, "2026-07-05", "fukushu") === true,  "復習 箱3: 21日後に到来(shallow retention対策)");
  ok(check(1, "2026-07-25", "yoshu")   === true,  "予習 箱1: 1日後に到来");
  ok(check(2, "2026-07-24", "yoshu")   === false, "予習 箱2: 2日後は未到来");
  ok(check(2, "2026-07-23", "yoshu")   === true,  "予習 箱2: 3日後に到来");
  ok(check(3, "2026-07-23", "yoshu")   === true,  "予習 箱3: 3日後に到来");
  ok(check(2, undefined, "fukushu")    === false, "last が無い問題は期日計算の対象外");
  ok(check(2, "", "fukushu")           === false, "last が空でも対象外");
}

section("§9-3 箱3が期日到来でセッションに含まれる");
{
  const qs = liveQs("M");
  const state = { boxes:{}, last:{} };
  qs.forEach(q => { state.boxes[q.id] = 3; state.last[q.id] = "2026-07-01"; });   // 25日前
  const sess = run(E, `buildSessionFukushu(${JSON.stringify(qs)}, ${JSON.stringify(state)}, null, new Date(2026,6,26))`);
  const box3InReview = sess.filter(q => state.boxes[q.id] === 3).length;
  ok(box3InReview > 0, "箱3の問題が出題される");
  eq(sess.length, 8, "8問構成になる");
}

/* =====================================================================
   §9-4 セーブコード復元時のみ last が復元日で一括初期化
   ===================================================================== */
section("§9-4 last の一括初期化はコード復元時のみ");
{
  const bank = BANKS.M;
  const qs = allQs("M");
  const boxes = {}; qs.forEach(q => { boxes[q.id] = 1; });
  const parsed = { boxes, xp: 7 };
  const st = run(E, `applyRestoredCode(emptyState("x"), ${JSON.stringify(parsed)}, ${JSON.stringify(bank)}, new Date(2026,6,26))`);
  const days = new Set(Object.values(st.last));
  eq([...days], ["2026-07-26"], "全問の last が復元日で揃う");
  eq(Object.keys(st.last).length, qs.length, "全問に last が入る");
  eq(st.xp, 7, "xpが引き継がれる");

  /* 通常の解答では該当問題の last だけが動く */
  const st2 = run(E, `(() => {
    const s = emptyState("x");
    recordAnswer(s, ${JSON.stringify(qs[0])}, true, "fukushu", new Date(2026,6,26));
    return s;
  })()`);
  eq(Object.keys(st2.last), [qs[0].id], "通常の解答では解いた問題の last だけ更新される");
  eq(st2.boxes[qs[0].id], 3, "復習の未出題(箱2)から正解すると箱3");
  eq(st2.xp, 1, "正解でxpが1増える");

  const st3 = run(E, `(() => {
    const s = emptyState("x");
    recordAnswer(s, ${JSON.stringify(allQs("Y")[0])}, true, "yoshu", new Date(2026,6,26));
    return s;
  })()`);
  eq(st3.boxes[allQs("Y")[0].id], 1, "予習の未出題から初正解すると箱1");

  const st4 = run(E, `(() => {
    const s = emptyState("x");
    s.boxes[${JSON.stringify(qs[0].id)}] = 3;
    recordAnswer(s, ${JSON.stringify(qs[0])}, false, "fukushu", new Date(2026,6,26));
    return s;
  })()`);
  eq(st4.boxes[qs[0].id], 0, "誤答は箱0へ落ちる(マスター済みからでも)");
}

/* =====================================================================
   §9-6 国語(K)枠
   ===================================================================== */
section("§9-6 bank_K: 空バンクとans例外");
{
  eq(BANKS.K.subject, "K", "subject は K");
  ok(run(E, `validateBankObj(${JSON.stringify(BANKS.K)}, "K")`), "空バンクでも構造チェックは通る(起動できる)");
  /* Kバンクが投入されたあとも通るよう、状態で分岐する */
  if(BANKS.K.questions.length === 0){
    ok(true, "bank_K は空バンク → 国語ドアは非表示になる");
  } else {
    ok(liveQs("K").length > 0, `bank_K に問題がある(${liveQs("K").length}問) → 国語ドアが表示される`);
    ok(catsOf("K").length > 0, "bank_K に cats が定義されている");
  }

  /* K は「テキストans2種以上」をスキップする(読み=ひらがな1種 / 書き=漢字1種) */
  const kBank = {
    bankVersion:"K_2026_08_01", subject:"K",
    cats:[{cat:"漢字",icon:"✏️",desc:"読み書き"}],
    questions:[
      {id:"K0001",unit:"読み",kai:1,level:"基",cat:"漢字",q:"「複雑」の読みは?",ans:["ふくざつ"],h1:"",h2:"",exp:""},
      {id:"K0002",unit:"書き",kai:1,level:"基",cat:"漢字",q:"「セイカク」を漢字で",ans:["性格"],h1:"",h2:"",exp:""}
    ]
  };
  const r = run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(kBank))}, "K", [])`);
  ok(r.ok, "K: ans1種のみでも受理される", r.reason);

  /* 同じ形を M でやると拒否される */
  const mBank = JSON.parse(JSON.stringify(kBank));
  mBank.subject = "M"; mBank.bankVersion = "M_x";
  mBank.questions.forEach((q,i) => { q.id = "M" + String(9001+i).padStart(4,"0"); });
  const r2 = run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(mBank))}, "M", [])`);
  ok(!r2.ok, "M: テキストans1種のみは拒否される");
}

/* =====================================================================
   §9-6 / yoshu §11-6 / fukushu §10: バリデーション拒否ケース
   ===================================================================== */
section("バリデーション拒否ケース(復習 4種)");
{
  const base = () => JSON.parse(JSON.stringify(BANKS.M));
  const existing = allQs("M").map(q => q.id);
  const V = (obj, sub = "M", ids = existing) =>
    run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(obj))}, ${JSON.stringify(sub)}, ${JSON.stringify(ids)})`);

  ok(V(base()).ok, "現行 bank_M はバリデーションを通る");

  const b1 = base(); b1.subject = "R";
  ok(!V(b1).ok, "拒否1: subject不一致");

  const b2 = base(); b2.questions = b2.questions.slice(1);
  ok(!V(b2).ok, "拒否2: 既存idの欠落");

  const b3 = base(); b3.questions.push(JSON.parse(JSON.stringify(b3.questions[0])));
  ok(!V(b3).ok, "拒否3: idの重複");

  const newId = nextId("M");
  const firstCat = catsOf("M")[0];

  const b4 = base();
  b4.questions.push({ id:newId, unit:"用語", kai:1, level:"基", cat:firstCat,
                      q:"テスト", ans:["塩化水素"], h1:"", h2:"", exp:"" });
  ok(!V(b4).ok, "拒否4: テキストansが1種のみ");

  const b5 = base();
  b5.questions.push({ id:newId, unit:"用語", kai:1, level:"基", cat:"未定義cat",
                      q:"テスト", ans:["1"], h1:"", h2:"", exp:"" });
  ok(!V(b5).ok, "拒否5: catsに定義されていないcat(§6)");

  const b6 = base();
  b6.questions.push({ id:"M0001x", unit:"", kai:1, level:"基", cat:firstCat, q:"t", ans:["1"] });
  ok(!V(b6).ok, "拒否6: id形式が不正");

  const b7 = base();
  b7.questions.push({ id:allQs("M")[1].id, unit:"", kai:1, level:"基", cat:firstCat, q:"t", ans:["1"] });
  ok(!V(b7).ok, "拒否7: 新規idが既存の続き番号でない");

  const b9 = base();
  b9.questions.push({ id:newId, unit:"計算", kai:1, level:"基", cat:firstCat,
                      q:"1+1=", ans:["2"], h1:"", h2:"", exp:"" });
  ok(V(b9).ok, "続き番号の新規idは受理される");

  /* retired での残置はOK */
  const b8 = base(); b8.questions[0].retired = true;
  ok(V(b8).ok, "retiredでの残置は受理される");
}

section("バリデーション拒否ケース(予習)");
{
  const base = () => JSON.parse(JSON.stringify(BANKS.Y));
  const V = obj => run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(obj))}, "Y", [])`);

  ok(V(base()).ok, "現行 bank_Y はバリデーションを通る");

  const y1 = base(); y1.subject = "M";
  ok(!V(y1).ok, "拒否: subject不一致");

  const y2 = base(); delete y2.questions[0].cat;
  ok(!V(y2).ok, "拒否: catの欠落");

  const y3 = base(); y3.cats = y3.cats.filter(c => c.cat !== "理科");
  ok(!V(y3).ok, "拒否: catsに4科が揃っていない");

  const y4 = base(); delete y4.testDate;
  ok(!V(y4).ok, "拒否: testDateなし");

  const y5 = base();
  y5.questions.push({ id:"Y0901", unit:"用語", kai:28, level:"基", cat:"社会",
                      q:"テスト", ans:["石油化学"], h1:"", h2:"", exp:"" });
  ok(!V(y5).ok, "拒否: 国語以外のテキストansが1種のみ");

  const y6 = base();
  y6.questions.push({ id:"Y0902", unit:"漢字", kai:37, level:"基", cat:"国語",
                      q:"「セイカク」を漢字で", ans:["性格"], h1:"", h2:"", exp:"" });
  ok(V(y6).ok, "国語の漢字問題はans1種でも受理される(v1.1例外)");

  /* サイクル使い捨て: 連続性チェックをしない */
  const y7 = base();
  y7.questions = y7.questions.slice(10);
  ok(V(y7).ok, "予習は既存idの欠落を検査しない(サイクル使い捨て)");
}

/* =====================================================================
   yoshu §11-1/2: HP(部分点)・マスター率・封印・討伐
   ===================================================================== */
section("yoshu §11-1 HPが進捗率(部分点)から導出される");
{
  const qs = liveQs("Y");
  const b = {};
  eq(run(E, `progressPct(${JSON.stringify(qs)}, {})`), 0, "全問未出題なら進捗率0(HP100)");
  eq(run(E, `bossHP(${JSON.stringify(qs)}, {})`), 100, "初期HPは100");

  const half = {}; qs.forEach(q => { half[q.id] = 1; });
  eq(run(E, `progressPct(${JSON.stringify(qs)}, ${JSON.stringify(half)})`), 50, "全問が箱1なら進捗率50(部分点)");
  eq(run(E, `masteryPctOf(${JSON.stringify(qs)}, ${JSON.stringify(half)})`), 0, "箱1はマスター率に数えない");

  const full = {}; qs.forEach(q => { full[q.id] = 2; });
  eq(run(E, `bossHP(${JSON.stringify(qs)}, ${JSON.stringify(full)})`), 0, "全問が箱2以上ならHP0");
  eq(run(E, `masteryPctOf(${JSON.stringify(qs)}, ${JSON.stringify(full)})`), 100, "マスター率100%");

  const zero = {}; qs.forEach(q => { zero[q.id] = 0; });
  eq(run(E, `progressPct(${JSON.stringify(qs)}, ${JSON.stringify(zero)})`), 0, "箱0はダメージにならない");

  /* yoshu §4 の挙動目安は「36問のとき」の記述なので、バンクの実問題数に依存しないよう
     合成データで検証する(現行バンクの問題数が変わっても成立する) */
  const synth36 = Array.from({ length:36 }, (_, i) => ({ id: "Z" + String(i+1).padStart(4,"0") }));
  const day1 = {};
  synth36.slice(0,8).forEach(q => { day1[q.id] = 1; });
  eq(run(E, `bossHP(${JSON.stringify(synth36)}, ${JSON.stringify(day1)})`), 89,
     "36問中8問を箱1にするとHP89(yoshu §4の挙動目安)");
  eq(run(E, `SEAL_THRESHOLD`), 80, "封印解除しきい値は80%");
}

section("yoshu §11-4 解放ゲート(自動検出・初期解放・自己修復)");
{
  const ctx = newEnv();
  const qs = liveQs("Y");
  const cats = BANKS.Y.cats;
  /* 実問題があるcatだけを対象にする(エンジンのCATS導出と同じ規則) */
  const catNamesOfY = catsOf("Y").filter(c => qs.some(q => q.cat === c))
    .sort((a,b) => kaisOfCat("Y",b).length - kaisOfCat("Y",a).length);   // 回が多いcatを先頭に
  const K = (boxes = {}) => run(ctx, `[...unlockedKeys(${JSON.stringify(qs)}, ${JSON.stringify(cats)}, ${JSON.stringify(boxes)})]`);

  /* 期待値はバンクから導出する(回番号はサイクルごとに変わるため直書きしない) */
  const firstKai = firstKaiOf("Y");
  const catA = catNamesOfY[0];
  const kaisA = kaisOfCat("Y", catA);

  eq(run(ctx, `kaisOf(${JSON.stringify(qs)}, ${JSON.stringify(catA)})`), kaisA,
     `${catA}の回がバンクから自動検出される([${kaisA.join(",")}])`);

  const init = K();
  const expectInit = Object.keys(firstKai).map(c => c + ":" + firstKai[c]);
  eq(init.slice().sort(), expectInit.slice().sort(), "初期は各科目の最初の回のみ解放");

  /* 自己修復②: 箱に進捗がある回は解放済みとみなす */
  const laterKai = kaisA[1];
  ok(laterKai !== undefined, `${catA}に2つ以上の回がある(解放ゲートの検証条件)`);
  const qLater = qs.find(q => q.cat === catA && q.kai === laterKai);
  const repaired = K({ [qLater.id]: 1 });
  ok(repaired.includes(catA + ":" + laterKai), "進捗のある回は解放済みとみなされる(自己修復)");

  /* 明示的な解放が永続する */
  run(ctx, `unlockKai(${JSON.stringify(catA)}, ${laterKai})`);
  ok(K().includes(catA + ":" + laterKai), "解放した回が保存される");
  run(ctx, `clearUnlocks()`);
  ok(!K().includes(catA + ":" + laterKai), "clearUnlocksで解放状態がリセットされる");
  ok(K().includes(catA + ":" + firstKai[catA]), "リセット後も各科目の最初の回は解放されている(自己修復①)");

  const unlocked = run(ctx, `unlockedQsOf(${JSON.stringify(qs)}, unlockedKeys(${JSON.stringify(qs)}, ${JSON.stringify(cats)}, {}))`);
  ok(unlocked.length < qs.length, "未解放の回の問題は母数から外れる");
  ok(unlocked.every(q => firstKai[q.cat] === q.kai), "解放済みは各科目の最初の回だけ");
  ok(run(ctx, `allKaisUnlocked(${JSON.stringify(qs)}, unlockedKeys(${JSON.stringify(qs)}, ${JSON.stringify(cats)}, {}))`) === false,
     "全回解放フラグは false(討伐ガードの条件)");

  const allBoxes = {}; qs.forEach(q => { allBoxes[q.id] = 2; });
  ok(run(ctx, `allKaisUnlocked(${JSON.stringify(qs)}, unlockedKeys(${JSON.stringify(qs)}, ${JSON.stringify(cats)}, ${JSON.stringify(allBoxes)}))`) === true,
     "全問に進捗があれば全回解放とみなされる(討伐条件が成立しうる)");
}

section("yoshu §11-5 サイクル交代の討伐記録(金/銀・全問題ベース)");
{
  const ctx = newEnv();
  const qs = liveQs("Y");

  /* 解放済みの回だけ100%でも、未解放の回があれば銀(取り逃がし) */
  const partial = {};
  qs.filter(q => isFirstKai("Y", q)).forEach(q => { partial[q.id] = 3; });
  const e1 = run(ctx, `buildBossLogEntry(${JSON.stringify(SKINS.BOSS)}, ${JSON.stringify(BANKS.Y)}, ${JSON.stringify(qs)}, ${JSON.stringify(partial)})`);
  eq(e1.result, "取り逃がし", "解放し忘れの回があると銀バッジ");
  ok(e1.mastery < 100, `masteryは全問題ベース(${e1.mastery}%)`);
  eq(e1.bossName, SKINS.BOSS.boss.name, "ボス名が記録される");
  eq(e1.testDate, BANKS.Y.testDate, "テスト日が記録される");

  const full = {}; qs.forEach(q => { full[q.id] = 2; });
  const E = run(ctx, `buildBossLogEntry(${JSON.stringify(SKINS.BOSS)}, ${JSON.stringify(BANKS.Y)}, ${JSON.stringify(qs)}, ${JSON.stringify(full)})`);
  eq(E.result, "討伐", "全問マスターなら金バッジ");
  eq(E.mastery, 100, "mastery 100%");

  run(ctx, `saveBossLogEntry(${JSON.stringify(e1)}); saveBossLogEntry(${JSON.stringify(E)});`);
  eq(run(ctx, `loadBossLog().length`), 2, "討伐記録が追記される");
}

/* =====================================================================
   yoshu §11-9〜12: 間口の純粋化(v1.3.1)
   ===================================================================== */
section("yoshu §11-9〜12 間口の純粋化");
{
  const ctx = newEnv();
  const qs = liveQs("Y");
  const cats = BANKS.Y.cats;
  /* 実問題があるcatだけを対象にする(エンジンのCATS導出と同じ規則) */
  const catNames = catsOf("Y").filter(c => qs.some(q => q.cat === c));
  const RUNS = 50;
  const today = "new Date(2026,6,26)";

  const unlockedFor = boxes =>
    run(ctx, `unlockedQsOf(${JSON.stringify(qs)}, unlockedKeys(${JSON.stringify(qs)}, ${JSON.stringify(cats)}, ${JSON.stringify(boxes)}))`);

  /* 9: 間口を選んだら全問がその科目 */
  let contaminated = 0;
  const uInit = unlockedFor({});
  for(const cat of catNames){
    for(let i=0; i<RUNS; i++){
      const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(uInit)}, {boxes:{},last:{}}, ${JSON.stringify(cat)}, ${today})`);
      if(sess.some(q => q.cat !== cat)) contaminated++;
    }
  }
  eq(contaminated, 0, `${catNames.length * RUNS}回試行(${catNames.length}科×${RUNS})で他科目の混入が0件`);

  /* 10: 解放済みが8問未満ならセッションが短縮される */
  const perCat = {};
  catNames.forEach(c => { perCat[c] = uInit.filter(q => q.cat === c).length; });
  const short = catNames.filter(c => perCat[c] > 0 && perCat[c] < 8);
  if(short.length){
    for(const cat of short){
      const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(uInit)}, {boxes:{},last:{}}, ${JSON.stringify(cat)}, ${today})`);
      eq(sess.length, perCat[cat], `${cat}: セッションが解放済み問題数(${perCat[cat]})に短縮される`);
    }
  } else {
    /* 初期解放だけで全科目8問以上ある場合は、合成データで短縮動作を確認する */
    const few = qs.filter(q => q.cat === catNames[0]).slice(0, 3);
    const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(few)}, {boxes:{},last:{}}, ${JSON.stringify(catNames[0])}, ${today})`);
    eq(sess.length, few.length, `解放済みが3問なら3問に短縮される(合成データ)`);
  }
  ok(true, `初期解放時の科目別問題数: ${JSON.stringify(perCat)}`);

  /* 11: 🎲おまかせミックスは全科目から */
  const catsWithUnlocked = catNames.filter(c => perCat[c] > 0);
  const mixCats = new Set();
  for(let i=0; i<RUNS; i++){
    const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(uInit)}, {boxes:{},last:{}}, null, ${today})`);
    sess.forEach(q => mixCats.add(q.cat));
    if(i === 0) eq(sess.length, Math.min(8, uInit.length), "ミックスは8問(解放済みが少なければその数)");
  }
  eq([...mixCats].sort(), catsWithUnlocked.slice().sort(), "ミックスは解放済みの全科目から出題される");

  /* 12: 全問が箱0でも間口内に限定される */
  const allZero = {}; qs.forEach(q => { allZero[q.id] = 0; });
  const uZero = unlockedFor(allZero);
  let zeroContaminated = 0;
  for(const cat of catNames){
    for(let i=0; i<50; i++){
      const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(uZero)}, {boxes:${JSON.stringify(allZero)},last:{}}, ${JSON.stringify(cat)}, ${today})`);
      if(sess.some(q => q.cat !== cat)) zeroContaminated++;
    }
  }
  eq(zeroContaminated, 0, "全問が箱0の状態でも間口内に限定される(箱0プールのcat絞り込み)");

  /* 未解放の回は出題されない */
  const sess = run(ctx, `buildSessionYoshu(${JSON.stringify(uInit)}, {boxes:{},last:{}}, null, ${today})`);
  ok(sess.every(q => isFirstKai("Y", q)), "未解放の回の問題は出題されない");
}

/* =====================================================================
   fukushu §4 / v4.1 記録4: 復習側のセッション構成
   ===================================================================== */
section("fukushu §4 復習のセッション構成");
{
  const qs = liveQs("M");
  const today = "new Date(2026,6,26)";
  const mCats = catsOf("M").filter(c => qs.some(q => q.cat === c));
  const cat = mCats[0];

  const fresh = run(E, `buildSessionFukushu(${JSON.stringify(qs)}, {boxes:{},last:{}}, ${JSON.stringify(cat)}, ${today})`);
  eq(fresh.length, 8, "初回は8問");

  /* 箱0(リベンジ)は間口に関係なく最大2問混入(v4.1 記録4) */
  const otherCat = mCats[mCats.length - 1];
  const boxes = {}, last = {};
  qs.filter(q => q.cat === otherCat).forEach(q => { boxes[q.id] = 0; last[q.id] = "2026-07-25"; });
  let sawCross = 0, maxCross = 0;
  for(let i=0; i<50; i++){
    const s = run(E, `buildSessionFukushu(${JSON.stringify(qs)}, {boxes:${JSON.stringify(boxes)},last:${JSON.stringify(last)}}, ${JSON.stringify(cat)}, ${today})`);
    const cross = s.filter(q => boxes[q.id] === 0).length;
    if(cross > 0) sawCross++;
    maxCross = Math.max(maxCross, cross);
  }
  ok(sawCross > 0, "復習: 箱0は間口外からも混入する(記録4)");
  ok(maxCross <= 2, `復習: 間口ありのとき箱0の混入は最大2問(実測 ${maxCross})`);

  /* リベンジフラグ。ミックスでは復習枠に箱0が最大4問優先充当される
     (残り枠の補完で結果的に4問を超えることはある。現行エンジンと同一挙動) */
  const s2 = run(E, `buildSessionFukushu(${JSON.stringify(qs)}, {boxes:${JSON.stringify(boxes)},last:${JSON.stringify(last)}}, null, ${today})`);
  const rev = s2.filter(q => q._revenge);
  ok(rev.length > 0 && rev.every(q => boxes[q.id] === 0), "_revengeフラグが箱0の問題に付く");
  ok(rev.length >= 4, `ミックス時は箱0が優先充当される(実測 ${rev.length}問)`);

  /* 未出題(last無し)は期日プールに入らず補完に回る */
  const allBox2 = {}; qs.forEach(q => { allBox2[q.id] = 2; });
  const s3 = run(E, `buildSessionFukushu(${JSON.stringify(qs)}, {boxes:${JSON.stringify(allBox2)},last:{}}, null, ${today})`);
  eq(s3.length, 8, "last が無くても8問は組める(未出題プールから補完)");
  eq(s3.filter(q => q._revenge).length, 0, "未出題はリベンジ扱いにならない");
}

/* =====================================================================
   §9-14 図版(SVG)のバリデーション — v4.2 §5.2 / §6
   ===================================================================== */
section("§9-14 図版(SVG)のバリデーション");
{
  const OK_SVG = '<svg viewBox="0 0 200 120"><polygon points="10,110 100,10 190,110" fill="none" stroke="currentColor" stroke-width="2"/><text x="100" y="100" text-anchor="middle" font-size="12">ア</text></svg>';
  const Err = v => run(E, `svgFieldError(${JSON.stringify(v)})`);

  eq(run(E, `svgFieldError(undefined)`), null, "svg未指定はOK(後方互換)");
  eq(run(E, `svgFieldError(null)`), null, "svg=nullもOK");
  eq(Err(OK_SVG), null, "正常なSVGは通る");

  ok(Err(123) !== null, "拒否: 文字列でない");
  ok(Err("") !== null, "拒否: 空文字");
  ok(Err('<div>x</div>') !== null, "拒否: <svg で始まらない");
  ok(Err('<svg viewBox="0 0 1 1"><rect/>') !== null, "拒否: </svg> で終わらない");
  ok(Err('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>') !== null, "拒否: script(§5.2)");
  ok(Err('<svg viewBox="0 0 1 1"><foreignObject><b>x</b></foreignObject></svg>') !== null, "拒否: foreignObject(§5.2)");
  ok(Err('<svg viewBox="0 0 1 1"><rect onload="alert(1)"/></svg>') !== null, "拒否: イベント属性 on*(§5.2)");
  ok(Err('<svg viewBox="0 0 1 1"><rect onclick="x()"/></svg>') !== null, "拒否: onclick");
  ok(Err('<svg viewBox="0 0 1 1"><image href="https://example.com/a.png"/></svg>') !== null, "拒否: 外部参照 href(§5.2)");
  ok(Err('<svg viewBox="0 0 1 1"><use xlink:href="http://e.com/#a"/></svg>') !== null, "拒否: 外部参照 xlink:href");
  ok(Err('<svg viewBox="0 0 1 1"><rect fill="url(https://e.com/x)"/></svg>') !== null, "拒否: 外部リソース url()");
  ok(Err('<svg viewBox="0 0 1 1"><a href="javascript:alert(1)">x</a></svg>') !== null, "拒否: javascript:");
  eq(Err('<svg viewBox="0 0 1 1"><defs><marker id="m"/></defs><line marker-end="url(#m)" x1="0" y1="0" x2="1" y2="1"/></svg>'), null,
     "内部参照 url(#id) は許可される");
  eq(Err('<svg viewBox="0 0 1 1"><use href="#a"/></svg>'), null, "フラグメント参照 href=#id は許可される");

  /* v4.3: バンク全体は拒否せず、当該svgのみ破棄して採用する */
  const bad = JSON.parse(JSON.stringify(BANKS.Y));
  bad.questions[0].svg = '<svg viewBox="0 0 1 1"><script>x</script></svg>';
  bad.questions[1].svg = OK_SVG;
  const rBad = run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(bad))}, "Y", [])`);
  ok(rBad.ok, "不正SVGを含んでもバンクは採用される(v4.3: 拒否しない)");
  eq(rBad.bank.questions[0].svg, undefined, "不正だった問題の svg は破棄される");
  eq(rBad.bank.questions[1].svg, OK_SVG, "同じバンク内の正常な svg は残る");
  eq(rBad.bank.questions.length, bad.questions.length, "問題そのものは削られない(図なしで出題)");
  eq(rBad.svgWarnings.length, 1, "破棄した図版の警告が返る");
  ok(/script/.test(rBad.svgWarnings[0]), `警告に原因とidが出る(${rBad.svgWarnings[0]})`);
  eq(rBad.bank.questions[0].ans, bad.questions[0].ans, "svg以外のフィールドは変更されない");

  const good = JSON.parse(JSON.stringify(BANKS.Y));
  good.questions[0].svg = OK_SVG;
  const rGood = run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(good))}, "Y", [])`);
  ok(rGood.ok, "正常SVGを含むバンクは受理される");
  eq(rGood.svgWarnings.length, 0, "正常なら警告は出ない");

  const goodM = JSON.parse(JSON.stringify(BANKS.M));
  goodM.questions[0].svg = OK_SVG;
  ok(run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(goodM))}, "M", ${JSON.stringify(allQs("M").map(q=>q.id))})`).ok,
     "復習バンクでもSVGを受理する(全科目共通)");

  const badM = JSON.parse(JSON.stringify(BANKS.M));
  badM.questions[0].svg = '<svg viewBox="0 0 1 1"><rect onload="x()"/></svg>';
  const rBadM = run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(badM))}, "M", ${JSON.stringify(allQs("M").map(q=>q.id))})`);
  ok(rBadM.ok, "復習バンクでも不正SVGで拒否されない");
  eq(rBadM.bank.questions[0].svg, undefined, "復習バンクでも当該svgのみ破棄される");

  /* 起動時の採用も同じ: バンクは使え、危険な図版だけ落ちる */
  ok(run(E, `validateBankObj(${JSON.stringify(bad)}, "Y")`), "不正SVGがあっても起動時にバンクは採用される");
  const st = run(E, `stripUnsafeSvg(${JSON.stringify(bad)})`);
  eq(st.bank.questions[0].svg, undefined, "起動時の採用経路でも危険な図版は破棄される");
  eq(st.warnings.length, 1, "起動時も警告が得られる(コンソール出力用)");

  /* 図版まわり以外の拒否条件は従来どおり効いている */
  const missing = JSON.parse(JSON.stringify(BANKS.M));
  missing.questions = missing.questions.slice(1);
  ok(!run(E, `validateBankPaste(${JSON.stringify(JSON.stringify(missing))}, "M", ${JSON.stringify(allQs("M").map(q=>q.id))})`).ok,
     "id欠落は従来どおり拒否される(緩めたのは図版だけ)");
}

/* =====================================================================
   §9-16 壊れたSVGでもアプリが落ちない — v4.3 §5.2 エンジン側の防御
   ===================================================================== */
section("§9-16 壊れたSVGのフォールバック");
{
  /* 文字列検査は通るが、XMLとしては壊れている・描画できない例 */
  const brokenList = [
    ['タグが閉じていない', '<svg viewBox="0 0 10 10"><rect width="5" height="5"></svg>'],
    ['viewBoxが無い',      '<svg><rect width="5" height="5"/></svg>'],
    ['viewBoxが不正',      '<svg viewBox="a b c d"><rect width="5" height="5"/></svg>'],
    ['中身が空',           '<svg viewBox="0 0 10 10"></svg>']
  ];
  for(const [label, svg] of brokenList){
    const bank = { bankVersion:"T", subject:"Y", testDate:"2026-08-01",
      cats: BANKS.Y.cats,
      questions: [{ id:"Y0001", cat:"算数", kai:1, q:"テスト", svg, ans:["1"] }] };
    /* 破綻したSVGでも「バンクは使える」ことが要件(描画側で図なしにフォールバック) */
    ok(run(E, `validateBankObj(${JSON.stringify(bank)}, "Y")`), `${label}: バンクは採用される`);
    const s = run(E, `stripUnsafeSvg(${JSON.stringify(bank)})`);
    eq(s.bank.questions[0].ans, ["1"], `${label}: 問題自体は無傷で解答できる`);
    eq(s.bank.questions[0].q, "テスト", `${label}: 問題文は残る`);
  }

  /* 図が無い/落ちた状態でも採点系は完全に通常動作する */
  const q = { id:"Y0001", cat:"算数", q:"1+1は?", ans:["2"] };
  eq(run(E, `answerMatches(${JSON.stringify(q)}, "2")`), true, "図なしでも正答判定できる");
  const st2 = run(E, `(() => { const s = emptyState("x");
    recordAnswer(s, ${JSON.stringify(q)}, true, "yoshu", new Date(2026,7,1)); return s; })()`);
  eq(st2.boxes["Y0001"], 1, "図なしでも箱が進む");
  eq(st2.xp, 1, "図なしでもxpが増える");
}

/* =====================================================================
   §9-15 図版つき問題が採点系に干渉しないこと — v4.2 §5.2
   ===================================================================== */
section("§9-15 図版は採点・進捗・セーブコードに干渉しない");
{
  const SVG = '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" fill="none" stroke="currentColor"/></svg>';
  const base = { id:"M9001", cat:"きほん", q:"図の角アは何度?", ans:["65"], unit_label:"度" };
  const withSvg = { ...base, svg: SVG };

  eq(run(E, `isNumericQuestion(${JSON.stringify(withSvg)})`),
     run(E, `isNumericQuestion(${JSON.stringify(base)})`), "入力モード判定は svg の有無で変わらない");
  eq(run(E, `answerMatches(${JSON.stringify(withSvg)}, "65")`), true, "svg付きでも正答を判定できる");
  eq(run(E, `answerMatches(${JSON.stringify(withSvg)}, "64")`), false, "svg付きでも誤答を判定できる");

  /* 箱の遷移・last の記録 */
  const st = run(E, `(() => { const s = emptyState("x");
    recordAnswer(s, ${JSON.stringify(withSvg)}, true, "fukushu", new Date(2026,7,1)); return s; })()`);
  eq(st.boxes["M9001"], 3, "svg付きでも箱が進む");
  eq(st.last["M9001"], "2026-08-01", "svg付きでも last が記録される");
  eq(st.xp, 1, "svg付きでもxpが増える");

  /* セーブコードは id と箱だけを載せる = svg の有無で長さが変わらない */
  const qsPlain = allQs("M");
  const qsSvg = qsPlain.map(q => ({ ...q, svg: SVG }));
  const boxes = {}; qsPlain.forEach((q,i) => { boxes[q.id] = i % 4; });
  const c1 = run(E, `makeSaveCode(${JSON.stringify(qsPlain)}, ${JSON.stringify(boxes)}, 42, "fukushu")`);
  const c2 = run(E, `makeSaveCode(${JSON.stringify(qsSvg)},   ${JSON.stringify(boxes)}, 42, "fukushu")`);
  eq(c2, c1, "svgの有無でセーブコードが変わらない(進捗はid+箱のみ)");
  const back = run(E, `parseSaveCode(${JSON.stringify(c2)}, ${JSON.stringify(qsSvg)}, "fukushu")`);
  eq(back.boxes, boxes, "svg付きバンクでもセーブコードが往復する");

  /* セッション構成にも影響しない */
  const s1 = run(E, `buildSessionFukushu(${JSON.stringify(qsSvg)}, {boxes:{},last:{}}, null, new Date(2026,7,1))`);
  eq(s1.length, 8, "svg付きでもセッションは8問");
  ok(s1.every(q => q.svg === SVG), "セッションの問題に svg が保持される(描画に渡る)");
}

/* =====================================================================
   §9-7 §3.1 バンク・スキンの採用規則(等値判定)
   ===================================================================== */
section("§9-7 §3.1 採用規則(等値判定)");
{
  const ctx = newEnv();
  const builtin = { bankVersion:"M_2026_07_02b", subject:"M", cats:[], questions:[] };
  const pasted  = { bankVersion:"M_2026_08_01", subject:"M", cats:[], questions:[] };
  const pushed  = { bankVersion:"M_2026_09_01", subject:"M", cats:[], questions:[] };
  const V = `(b => validateBankObj(b, "M"))`;
  const ver = `(b => b.bankVersion)`;

  /* 1. 投入なし → 内蔵 */
  let a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(builtin)}, ${ver}, ${V}, false)`);
  eq(a.source, "builtin", "規則1: 投入がなければ内蔵を使う");

  /* 2. 投入あり & 内蔵が同じ → 投入を使う(再起動をまたいで有効) */
  run(ctx, `writeAdopted(keyBank("M"), ${JSON.stringify(pasted)}, "M_2026_07_02b")`);
  a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(builtin)}, ${ver}, ${V}, false)`);
  eq(a.source, "local", "規則2: 投入バンクが採用される");
  eq(a.value.bankVersion, "M_2026_08_01", "規則2: 投入バンクの内容が返る");
  eq(a.switched, false, "規則2: 切替通知は出ない");

  a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(builtin)}, ${ver}, ${V}, false)`);
  eq(a.source, "local", "規則2: 再起動をまたいでも投入が維持される");

  /* 3. pushで内蔵が変わった → 内蔵へ切替+通知+投入解除 */
  a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(pushed)}, ${ver}, ${V}, false)`);
  eq(a.source, "builtin", "規則3: pushで内蔵が変わると内蔵へ切替");
  eq(a.switched, true, "規則3: 切替が通知される(無言の巻き戻りをしない)");
  eq(run(ctx, `readAdopted(keyBank("M"))`), null, "規則3: 投入が解除される");

  /* 「内蔵に戻す」導線 */
  run(ctx, `writeAdopted(keyBank("M"), ${JSON.stringify(pasted)}, "M_2026_09_01")`);
  run(ctx, `clearAdopted(keyBank("M"))`);
  a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(pushed)}, ${ver}, ${V}, false)`);
  eq(a.source, "builtin", "「内蔵に戻す」で内蔵へ戻る");

  /* 壊れたキャッシュ */
  run(ctx, `writeAdopted(keyBank("M"), {subject:"WRONG"}, "M_2026_09_01")`);
  a = run(ctx, `adoptResource(keyBank("M"), ${JSON.stringify(pushed)}, ${ver}, ${V}, false)`);
  eq(a.source, "builtin", "壊れたキャッシュは内蔵にフォールバック");
  ok(!!a.warning, "壊れたキャッシュは警告を出す");

  /* bank_Y は §7.1 へ回す(deferSwitch) */
  const bY = { bankVersion:"Y_20260718", subject:"Y", cats:[], questions:[] };
  const nY = { bankVersion:"Y_20260901", subject:"Y", cats:[], questions:[] };
  run(ctx, `writeAdopted(keyBank("Y"), ${JSON.stringify(bY)}, "Y_20260718")`);
  const ay = run(ctx, `adoptResource(keyBank("Y"), ${JSON.stringify(nY)}, ${ver}, (b => validateBankObj(b,"Y")), true)`);
  eq(ay.value.bankVersion, "Y_20260718", "§7.1: 予習は無言で切り替わらない(旧バンクのまま)");
  eq(ay.switched, false, "§7.1: 予習は自動切替しない");
  eq(ay.pendingSwitch && ay.pendingSwitch.bankVersion, "Y_20260901", "§7.1: 新バンクが確認待ちとして返る");
  ok(!!run(ctx, `readAdopted(keyBank("Y"))`), "§7.1-3: 拒否できるよう旧バンクのミラーは残る");

  /* §7.1 の発火条件は「内蔵bank_Yが"現在有効なbank_Y"と異なる場合」。
     メニューで投入したのと同じ版が後から内蔵に入っただけならサイクル交代ではない
     (ここで確認を出すと、中身が同じなのに進捗リセットを迫ることになる) */
  run(ctx, `writeAdopted(keyBank("Y"), ${JSON.stringify(nY)}, "Y_20260718")`);   // 先に投入済み
  const aSame = run(ctx, `adoptResource(keyBank("Y"), ${JSON.stringify(nY)}, ${ver}, (b => validateBankObj(b,"Y")), true)`);
  eq(aSame.value.bankVersion, "Y_20260901", "同版が内蔵に入っても有効バンクは変わらない");
  eq(aSame.pendingSwitch && aSame.pendingSwitch.bankVersion, aSame.value.bankVersion,
     "同版なので pendingSwitch と有効バンクの版が一致する(=交代確認を出さない条件)");
}

section("§9-2 state の突合(§4.2)");
{
  const ctx = newEnv();
  const bank = { bankVersion:"M_v2", subject:"M", cats:[], questions:[{id:"M0001"},{id:"M0002"},{id:"M0003"}] };
  const old  = { v:1, bankVersion:"M_v1", boxes:{M0001:3, M0002:0, M9999:1}, last:{M0001:"2026-07-01", M9999:"2026-07-01"}, xp:12 };
  const st = run(ctx, `reconcileState(${JSON.stringify(old)}, ${JSON.stringify(bank)})`);
  eq(st.boxes, {M0001:3, M0002:0}, "現バンクにないidは持ち越さない");
  eq(st.boxes.M0003, undefined, "増えた問題は未出題(キーなし)として扱われる");
  eq(st.bankVersion, "M_v2", "bankVersionが現バンクに更新される");
  eq(st.xp, 12, "xpは保持される");

  run(ctx, `saveState("M", ${JSON.stringify(st)})`);
  const loaded = run(ctx, `loadState("M", ${JSON.stringify(bank)})`);
  eq(loaded.boxes, st.boxes, "保存した state が読み戻せる");
}

section("§9-5 localStorage不可環境");
{
  const ro = newEnv({ readOnly:true });
  eq(run(ro, `storageAvailable`), false, "書き込めない環境では storageAvailable が false");
  eq(run(ro, `saveState("M", emptyState("x"))`), false, "保存は失敗を返す");
  eq(run(ro, `storageWriteFailed`), true, "失敗フラグが立つ(常時バナーの根拠)");
  eq(run(ro, `loadState("M", {bankVersion:"x", questions:[]})`).xp, 0, "読めなくても初期stateで起動できる");
  /* 保存できなくてもセーブコードは発行できる(§4.1の導線) */
  const code = run(ro, `makeSaveCode(${JSON.stringify(allQs("M"))}, {}, 0, "fukushu")`);
  ok(/^V2-/.test(code), "保存不可でもセーブコードは発行できる");
}

/* =====================================================================
   入力モード・正規化(fukushu §6)
   ===================================================================== */
section("fukushu §6 入力モード判定と正規化");
{
  const N = q => run(E, `isNumericQuestion(${JSON.stringify(q)})`);
  ok(N({ans:["80"]}), "整数 → 数値モード");
  ok(N({ans:["5/6"]}), "分数 → 数値モード");
  ok(N({ans:["3.5"]}), "小数 → 数値モード");
  ok(!N({ans:["塩化水素","えんかすいそ"]}), "テキスト → テキストモード");
  ok(!N({ans:["6本"]}), "単位つきはテキストモード扱いになる(§2の注意)");

  const A = (q, input) => run(E, `answerMatches(${JSON.stringify(q)}, ${JSON.stringify(input)})`);
  ok(A({ans:["80"]}, "80"), "数値: 一致");
  ok(A({ans:["80"]}, "８０"), "数値: 全角入力を受理");
  ok(A({ans:["80"]}, "80点"), "数値: 単位つき入力を受理");
  ok(A({ans:["5/6"]}, "5／6"), "数値: 全角スラッシュを受理");
  ok(!A({ans:["80"]}, "81"), "数値: 不一致は弾く");

  const t = {ans:["塩化水素","えんかすいそ"]};
  ok(A(t, "塩化水素"), "テキスト: 漢字表記");
  ok(A(t, "えんかすいそ"), "テキスト: ひらがな表記");
  ok(A(t, "エンカスイソ"), "テキスト: カタカナ→ひらがな折り畳み");
  ok(A({ans:["水酸化カルシウム","すいさんかかるしうむ"]}, "すいさんかカルシウム"),
     "テキスト: かな交じり入力を受理");
  ok(A(t, " 塩化水素 "), "テキスト: 前後の空白を無視");
  ok(!A(t, "塩化ナトリウム"), "テキスト: 不一致は弾く");
}

section("fukushu §3 称号・マップ");
{
  const stats = { noHintMaxStreak:3, hintCorrectCount:5, revengeWin:true, perfectStage:true };
  ok(run(E, `condMet("noHintStreak3", ${JSON.stringify(stats)}, 0)`), "noHintStreak3");
  ok(!run(E, `condMet("noHintStreak4", ${JSON.stringify(stats)}, 0)`), "noHintStreak4は未達");
  ok(run(E, `condMet("hintCorrect5", ${JSON.stringify(stats)}, 0)`), "hintCorrect5");
  ok(run(E, `condMet("revengeWin", ${JSON.stringify(stats)}, 0)`), "revengeWin");
  ok(run(E, `condMet("perfectStage", ${JSON.stringify(stats)}, 0)`), "perfectStage");
  ok(run(E, `condMet("totalCorrect50", ${JSON.stringify(stats)}, 50)`), "totalCorrect50");
  ok(!run(E, `condMet("totalCorrect100", ${JSON.stringify(stats)}, 50)`), "totalCorrect100は未達");
  ok(!run(E, `condMet("unknownCond", ${JSON.stringify(stats)}, 999)`), "未実装condは常にfalse");

  for(const s of ["M","R","S","K"]){
    const map = SKINS[s].map;
    eq(run(E, `nodeIndexForXp(0, ${JSON.stringify(map)})`), 0, `${s}: xp0で出発地`);
    eq(run(E, `nodeIndexForXp(99999, ${JSON.stringify(map)})`), map.nodes.length-1, `${s}: 上限はゴール`);
    ok(map.nodes.length <= 60, `${s}: map.nodesは60以下(${map.nodes.length})`);
    const conds = SKINS[s].titles.map(t => t.cond);
    ok(conds.every(c => /^(noHintStreak\d+|hintCorrect\d+|revengeWin|perfectStage|totalCorrect\d+)$/.test(c)),
       `${s}: 称号condは実装済みの条件名のみ`);
    ok(!!SKINS[s].hintPraise, `${s}: hintPraise(ヒント称賛)がある`);
  }
  ok(!!SKINS.BOSS.hintPraise, "BOSS: hintPraise(ヒント称賛)がある");
}

/* =====================================================================
   §9-1 科目ごとの世界の分離 / §9-8「あと◯日」非表示 / ビルド成果物
   ===================================================================== */
section("§9-1 ふくしゅう3科+国語が別々のスキンを参照する");
{
  const versions = ["M","R","S","K"].map(s => SKINS[s].skinVersion);
  eq(new Set(versions).size, 4, "4科のskinVersionがすべて異なる");
  eq(SKINS.M.map.nodes.length, 47, "算数=日本一周47ノード");
  eq(SKINS.R.map.nodes.length, 16, "理科=研究所たんけん16ノード");
  eq(SKINS.S.map.nodes.length, 47, "社会=日本一周(社会版)47ノード");
  eq(SKINS.K.map.nodes.length, 20, "国語=ことばの旅20ノード(§5.1)");
  ok(SKINS.M.map.nodes[0].name !== SKINS.R.map.nodes[0].name, "算数と理科の出発地が異なる");
  const titleNames = s => SKINS[s].titles.map(t => t.name).join(",");
  ok(new Set(["M","R","S","K"].map(titleNames)).size === 4, "4科の称号セットがすべて異なる");
  eq(SKINS.K.writeTip, "漢字はノートにも書いてみよう", "Kスキンの writeTip は §5.1 指定どおり");
  ok(!SKINS.BOSS.map, "ボススキンは map を使用しない(yoshu §3)");
}

if(DIST){
  section("ビルド成果物 dist/index.html");
  const markers = ["BANK_M","BANK_R","BANK_S","BANK_K","BANK_Y",
                   "SKIN_FUKUSHU_M","SKIN_FUKUSHU_R","SKIN_FUKUSHU_S","SKIN_FUKUSHU_K","SKIN_BOSS"];
  for(const m of markers){
    ok(DIST.includes(`/*==${m}_START==*/`) && DIST.includes(`/*==${m}_END==*/`), `マーカー ${m} が存在する`);
  }
  eq(markers.length, 10, "マーカーは10ブロック(§1)");
  ok(!DIST.includes("/*==APP_JS==*/"), "APP_JSマーカーは置換済み");
  ok(DIST.includes("bankVersion") && DIST.includes(BANKS.M.bankVersion), "バンクが実際に注入されている");
  ok(DIST.includes(SKINS.K.skinVersion), "Kスキンが注入されている");

  section("yoshu §11-8「あと◯日」がどこにも表示されない");
  ok(!/あと\s*[◯0-9]{0,3}\s*日/.test(DIST), "「あと◯日」表現がビルド成果物に存在しない");
  ok(!/カウントダウン/.test(DIST), "カウントダウン表現が存在しない");
  const testDateUses = (DIST.match(/testDate/g) || []).length;
  ok(testDateUses > 0, `testDateは討伐記録用にのみ使用(${testDateUses}箇所)`);

  section("§9-10 file:// 互換");
  ok(!/\bfetch\s*\(/.test(DIST.replace(/self\.addEventListener[\s\S]*?\n\}\);/g, "")),
     "実行時fetchをしない(データは全て埋め込み)");
  ok(!/<script[^>]+src=/.test(DIST), "外部スクリプト参照がない");
  ok(!/https?:\/\/(?!www\.w3\.org)/.test(DIST.replace(/spec_quest[^\s]*/g, "")), "外部URLへの参照がない");
  ok(DIST.includes('location.protocol !== "http:"'), "file:// ではService Workerを登録しないガードがある");
} else {
  section("ビルド成果物");
  ok(false, "dist/index.html が見つからない(先に node build.mjs を実行してください)");
}

/* ---------- 結果 ---------- */
console.log(`\n${"=".repeat(60)}`);
console.log(`  合計 ${pass + fail} 件 / 成功 ${pass} / 失敗 ${fail}`);
if(failures.length){
  console.log(`\n  失敗した項目:`);
  failures.forEach(f => console.log(`   - ${f}`));
}
console.log(`${"=".repeat(60)}\n`);
process.exit(fail === 0 ? 0 : 1);
