/* =====================================================================
   ui/svg.js — 図版(SVG)のサニタイズと描画 — v4.2 §5.2
   ・図は「問題の提示専用」。操作・解答には一切使わない
   ・バンク投入時の文字列検査(engine/validate.js の svgFieldError)に加えて、
     描画直前にホワイトリスト方式で組み立て直す二段構え。
     バンクJSONは家庭内で編集されるため、通ってしまった記述があっても
     許可した要素・属性以外は DOM に載らない。
   ・外部参照は禁止(オフライン原則 §7)。href はフラグメント(#id)のみ許可
   ===================================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";

/* 図形・テキスト・マーカーまわりに限定。image/script/foreignObject 等は含めない */
const SVG_ALLOWED_TAGS = new Set([
  "svg","g","defs","title","desc","style",
  "path","line","polyline","polygon","rect","circle","ellipse",
  "text","tspan","marker","use","symbol",
  "linearGradient","radialGradient","stop","clipPath","pattern"
]);

const SVG_ALLOWED_ATTRS = new Set([
  "viewbox","xmlns","preserveaspectratio","width","height","id","class","transform",
  "d","points","x","y","dx","dy","x1","y1","x2","y2","cx","cy","r","rx","ry",
  "fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity",
  "stroke-dasharray","stroke-linecap","stroke-linejoin","stroke-miterlimit",
  "opacity","color","font-size","font-family","font-weight","font-style",
  "text-anchor","dominant-baseline","alignment-baseline","letter-spacing",
  "marker-start","marker-mid","marker-end","orient","refx","refy",
  "markerwidth","markerheight","markerunits","offset","stop-color","stop-opacity",
  "gradientunits","patternunits","clip-path","clip-rule","vector-effect",
  "spreadmethod","fx","fy","overflow","style","xml:space"
]);

/* style 属性・<style> 要素に外部参照や式が紛れていないか */
function svgStyleIsSafe(v){
  return !/url\s*\(|@import|expression\s*\(|javascript\s*:|behavior\s*:/i.test(String(v));
}

function svgCleanNode(src, doc, depth){
  if(depth > 24) return null;                       // 異常に深い入れ子は捨てる
  const tag = src.nodeName.toLowerCase();
  if(!SVG_ALLOWED_TAGS.has(tag)) return null;

  const el = doc.createElementNS(SVG_NS, tag);
  for(const at of Array.from(src.attributes || [])){
    const name = at.name.toLowerCase();
    const val = at.value;
    if(name.startsWith("on")) continue;                       // イベント属性
    if(name === "href" || name === "xlink:href"){
      if(!String(val).trim().startsWith("#")) continue;       // 外部参照は落とす
      el.setAttribute("href", val);
      continue;
    }
    if(!SVG_ALLOWED_ATTRS.has(name)) continue;
    if(name === "style" && !svgStyleIsSafe(val)) continue;
    if(/url\s*\(\s*(?!["']?#)/i.test(val)) continue;          // 外部リソース参照
    el.setAttribute(at.name, val);
  }

  for(const child of Array.from(src.childNodes)){
    if(child.nodeType === 3){                                  // テキスト
      if(tag === "style" && !svgStyleIsSafe(child.nodeValue)) continue;
      el.appendChild(doc.createTextNode(child.nodeValue));
    } else if(child.nodeType === 1){
      const c = svgCleanNode(child, doc, depth+1);
      if(c) el.appendChild(c);
    }
    /* コメント・CDATA・処理命令は捨てる */
  }
  return el;
}

/* 生のSVG文字列 → 安全なSVGマークアップ。使えないときは null */
function sanitizeSvg(raw){
  if(typeof raw !== "string" || !raw.trim()) return null;
  if(typeof DOMParser === "undefined") return null;
  let doc;
  try{ doc = new DOMParser().parseFromString(raw.trim(), "image/svg+xml"); }
  catch(e){ return null; }
  if(!doc || doc.getElementsByTagName("parsererror").length) return null;
  const root = doc.documentElement;
  if(!root || root.nodeName.toLowerCase() !== "svg") return null;

  const out = svgCleanNode(root, document, 0);
  if(!out) return null;

  /* 拡縮の基準として viewBox を必須にする */
  const vb = (out.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if(vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) return null;

  /* 固有サイズを viewBox から与える。こうしておくと CSS 側の
     max-width:100% / height:auto で「小さい図はそのまま・大きい図は縮む」になる。
     width/height を消してしまうと固有サイズが無くなり 0x0 に潰れる。 */
  out.setAttribute("width", String(vb[2]));
  out.setAttribute("height", String(vb[3]));
  out.setAttribute("preserveAspectRatio", out.getAttribute("preserveAspectRatio") || "xMidYMid meet");
  out.setAttribute("xmlns", SVG_NS);
  out.setAttribute("role", "img");
  return out.outerHTML;
}

/* 問題に図版があれば、その描画ブロックを返す。無ければ空文字
   variant: "q"(出題・解説) / "review"(見直しコーナー。小さめに出す) */
function svgFigureHtml(q, variant){
  if(!q || !q.svg) return "";
  let clean = null;
  try{ clean = sanitizeSvg(q.svg); }
  catch(e){ clean = null; }
  if(!clean){
    /* v4.3 §5.2 エンジン側の防御: パース・描画に失敗しても落とさない。
       図なしで問題文のみ表示して続行し、気づけるようコンソールに警告を出す */
    console.warn(`[quest] 図版を描画できませんでした(id: ${q.id})。図なしで表示します。`);
    return "";
  }
  return `<div class="qfig ${variant === "review" ? "qfig-sm" : ""}">${clean}</div>`;
}
