/* =====================================================================
   engine/savecode.js — セーブコード V2(発行/復元)+ V1 互換読み込み
   仕様: fukushu §5 / v4.1 §4.4
   ・ビット列は retired 含む全問題(ALL_QS)の id 昇順(fukushu §5 教訓・必須確認項目)
   ・payload = 問題数(10bit) + 箱番号(2bit×問題数) + xp(12bit)
   ・v4.1 記録1(承認済): チェックサム算法は全科目 fukushu 版に統一する。
     旧 yoshu 版は sum*31 のハッシュだったが、旧予習コードは §8-3 により移行対象外。
   ・箱の既定値は科目系統ごとに据え置き(v4.1 記録3): 復習=箱2 / 予習=未出題(別管理)
   ===================================================================== */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/* コード上で「箱の指定がない」問題をどう詰めるか。
   fukushu: 未出題=箱2 なので 2 で詰める / yoshu: 未出題は箱と別管理なので 0 で詰める */
const SAVE_PACK_DEFAULT = { fukushu: 2, yoshu: 0 };

function bitsFromInt(n, len){ return (n>>>0).toString(2).padStart(len, "0"); }

/* 状態文字列の各文字コード和 mod 32(fukushu §5) */
function checksum(str){
  let sum = 0;
  for(const ch of str) sum += ch.charCodeAt(0);
  return B32[sum % 32];
}

function todayDateStr(now){
  const d = now || new Date();
  return pad2(d.getFullYear()%100) + pad2(d.getMonth()+1) + pad2(d.getDate());
}

function parseCodeDateStr(dateStr){
  const yy = parseInt(dateStr.slice(0,2),10),
        mm = parseInt(dateStr.slice(2,4),10)-1,
        dd = parseInt(dateStr.slice(4,6),10);
  if(mm<0 || mm>11 || dd<1 || dd>31) return null;
  const d = new Date(2000+yy, mm, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function bitsToB32(bits){
  let b = bits;
  while(b.length % 5 !== 0) b += "0";
  let out = "";
  for(let i=0; i<b.length; i+=5) out += B32[parseInt(b.substr(i,5),2)];
  return out;
}

function b32ToBits(str){
  let bits = "";
  for(const ch of str.toUpperCase()){
    const idx = B32.indexOf(ch);
    if(idx < 0) throw new Error("invalid char");
    bits += bitsFromInt(idx, 5);
  }
  return bits;
}

/* ---------- V1形式(問題数を持たない旧形式。互換読み込み専用。新規発行はしない) ---------- */
function packStateV1(allQs, boxes, xp, mode){
  const dflt = SAVE_PACK_DEFAULT[mode];
  let bits = "";
  allQs.forEach(q => { bits += bitsFromInt(boxes[q.id] ?? dflt, 2); });
  bits += bitsFromInt(Math.min(xp, 4095), 12);
  return bitsToB32(bits);
}

function unpackStateV1(str, allQs){
  const raw = b32ToBits(str);
  const needed = allQs.length*2 + 12;
  if(raw.length < needed) throw new Error("too short");
  const bits = raw.slice(0, needed);
  const boxes = {};
  allQs.forEach((q,i) => { boxes[q.id] = parseInt(bits.substr(i*2,2),2); });
  const xp = parseInt(bits.substr(allQs.length*2, 12), 2);
  return { boxes, xp };
}

/* ---------- V2形式(問題数を10bitで持つ。バンクが増えても古いコードを壊さない) ---------- */
function packStateV2(allQs, boxes, xp, mode){
  const dflt = SAVE_PACK_DEFAULT[mode];
  const n = allQs.length;
  let bits = bitsFromInt(n, 10);
  allQs.forEach(q => { bits += bitsFromInt(boxes[q.id] ?? dflt, 2); });
  bits += bitsFromInt(Math.min(xp, 4095), 12);
  return bitsToB32(bits);
}

function unpackStateV2(str){
  const raw = b32ToBits(str);
  if(raw.length < 10) throw new Error("too short");
  const n = parseInt(raw.substr(0,10), 2);
  const needed = 10 + n*2 + 12;
  if(raw.length < needed) throw new Error("too short");
  const bits = raw.slice(0, needed);
  const codeBoxes = [];
  for(let i=0; i<n; i++) codeBoxes.push(parseInt(bits.substr(10+i*2,2),2));
  const xp = parseInt(bits.substr(10+n*2,12), 2);
  return { n, codeBoxes, xp };
}

/* V2のcodeBoxes(コード作成時点でのid昇順n件)を現在のALL_QSへ写像。
   増えた分(現在の問題数 − n)は「未出題」として初期化する。
   ・fukushu: 未出題=箱2 なので 2 を書き込む
   ・yoshu:   未出題はキー未設定で表現するので書き込まない */
function applyV2Code(decoded, allQs, mode){
  if(decoded.n > allQs.length) return { error: "bank_old" };
  const boxes = {};
  allQs.forEach((q,i) => {
    if(i < decoded.n) boxes[q.id] = decoded.codeBoxes[i];
    else if(mode === "fukushu") boxes[q.id] = 2;
  });
  return { boxes, xp: decoded.xp };
}

function makeSaveCode(allQs, boxes, xp, mode, now){
  const state = packStateV2(allQs, boxes, xp, mode);
  return `V2-${todayDateStr(now)}-${state}${checksum(state)}`;
}

function parseSaveCode(raw, allQs, mode){
  const code = (raw || "").trim().toUpperCase();

  let m = code.match(/^V2-(\d{6})-([A-Z2-7]+)$/);
  if(m){
    const body = m[2];
    if(body.length < 2) return null;
    const state = body.slice(0,-1), chk = body.slice(-1);
    if(checksum(state) !== chk) return null;
    let decoded;
    try{ decoded = unpackStateV2(state); }catch(e){ return null; }
    const applied = applyV2Code(decoded, allQs, mode);
    if(applied.error) return { error: applied.error };
    const savedDate = parseCodeDateStr(m[1]);
    if(!savedDate) return null;
    return { boxes: applied.boxes, xp: applied.xp, savedDate, version: "V2" };
  }

  /* 旧V1コードの互換読み込み。現在の問題数を前提にチェックサム照合するベストエフォート方式 */
  m = code.match(/^V1-(\d{6})-([A-Z2-7]+)$/);
  if(m){
    const body = m[2];
    if(body.length < 2) return null;
    const state = body.slice(0,-1), chk = body.slice(-1);
    if(checksum(state) !== chk) return null;
    let decoded;
    try{ decoded = unpackStateV1(state, allQs); }catch(e){ return null; }
    const savedDate = parseCodeDateStr(m[1]);
    if(!savedDate) return null;
    return { boxes: decoded.boxes, xp: decoded.xp, savedDate, version: "V1" };
  }

  return null;
}
