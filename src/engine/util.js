/* =====================================================================
   engine/util.js — 汎用ユーティリティ・日付
   ===================================================================== */

function pad2(n){ return String(n).padStart(2, "0"); }

/* Fisher-Yates。rnd を差し替えられるようにしてテストから決定的に扱えるようにする */
function shuffle(arr, rnd){
  const r = rnd || Math.random;
  const b = [...arr];
  for(let i=b.length-1; i>0; i--){ const j = Math.floor(r()*(i+1)); [b[i],b[j]] = [b[j],b[i]]; }
  return b;
}

function pick(arr, rnd){
  if(!arr || !arr.length) return "";
  const r = rnd || Math.random;
  return arr[Math.floor(r()*arr.length)];
}

/* ---------- 日付(state.last 用の "YYYY-MM-DD") ---------- */
function midnight(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function dateKey(d){
  return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
}

function parseDateKey(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if(!m) return null;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from, to){
  return Math.floor((midnight(to) - midnight(from)) / 86400000);
}

/* HTMLエスケープ。バンクJSONは家庭内で編集されるがUIに素で流し込まないための保険 */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
