#!/usr/bin/env node
/* =====================================================================
   build.mjs — 注入ビルド(Node、依存パッケージなし)
   仕様: spec/spec_quest_v4_1.md §1
   ・banks/ skins/ のJSONを src/index.template.html のマーカー位置へ文字列注入
   ・src/engine/*.js + src/ui/*.js を APP_JS マーカーへ連結注入
   ・実行時fetchはしない(オフライン耐性と file:// 互換のため)
   ・出力: dist/index.html(単一HTML)+ manifest.json / sw.js / アイコン
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC   = join(ROOT, "src");
const DIST  = join(ROOT, "dist");

/* マーカー名 → 供給元ファイル(§1: 10ブロック) */
const DATA_BLOCKS = [
  ["BANK_M",          "banks/bank_M.json"],
  ["BANK_R",          "banks/bank_R.json"],
  ["BANK_S",          "banks/bank_S.json"],
  ["BANK_K",          "banks/bank_K.json"],
  ["BANK_Y",          "banks/bank_Y.json"],
  ["SKIN_FUKUSHU_M",  "skins/skin_fukushu_M.json"],
  ["SKIN_FUKUSHU_R",  "skins/skin_fukushu_R.json"],
  ["SKIN_FUKUSHU_S",  "skins/skin_fukushu_S.json"],
  ["SKIN_FUKUSHU_K",  "skins/skin_fukushu_K.json"],
  ["SKIN_BOSS",       "skins/skin_boss.json"]
];

const ENGINE_FILES = [
  "util.js", "normalize.js", "savecode.js", "leitner.js",
  "validate.js", "storage.js", "state.js", "adopt.js", "boss.js", "titles.js"
];
const UI_FILES = [
  "shell.js", "quiz.js", "fukushu.js", "junbi.js", "parent.js", "app.js"
];

const read = p => readFileSync(join(ROOT, p), "utf8");

/* テンプレートリテラルへ安全に埋め込むためのエスケープ */
function escapeForTemplateLiteral(s){
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function injectBlock(html, name, jsonText){
  const re = new RegExp(
    "/\\*==" + name + "_START==\\*/[\\s\\S]*?/\\*==" + name + "_END==\\*/"
  );
  if(!re.test(html)) throw new Error(`マーカー ${name} がテンプレートに見つかりません`);
  const body =
    `/*==${name}_START==*/\n` +
    `const ${name}_RAW = \`\n${escapeForTemplateLiteral(jsonText)}\n\`;\n` +
    `/*==${name}_END==*/`;
  return html.replace(re, () => body);
}

/* ---------- アイコン生成(node:zlib のみで最小PNGを書き出す) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for(let n=0; n<256; n++){
    let c = n;
    for(let k=0; k<8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = -1;
  for(let i=0; i<buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data){
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/* 5角の星の内側にあるかを判定(点in多角形) */
function starMask(size){
  const cx = size/2, cy = size/2 * 1.04, R = size*0.34, r = R*0.42;
  const pts = [];
  for(let i=0; i<10; i++){
    const rad = (i % 2 === 0) ? R : r;
    const a = -Math.PI/2 + i*Math.PI/5;
    pts.push([cx + rad*Math.cos(a), cy + rad*Math.sin(a)]);
  }
  return (x, y) => {
    let inside = false;
    for(let i=0, j=pts.length-1; i<pts.length; j=i++){
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function makeIconPng(size){
  const bg = [0xFF, 0x8A, 0x3D];      // --orange
  const fg = [0xFF, 0xFF, 0xFF];
  const inStar = starMask(size);
  const radius = size * 0.22;         // 角丸
  const rows = [];
  for(let y=0; y<size; y++){
    const row = Buffer.alloc(1 + size*4);
    row[0] = 0;                       // filter: none
    for(let x=0; x<size; x++){
      /* 角丸の外は透明 */
      const dx = Math.max(radius - x, x - (size - radius), 0);
      const dy = Math.max(radius - y, y - (size - radius), 0);
      const outside = Math.hypot(dx, dy) > radius;
      const c = inStar(x + 0.5, y + 0.5) ? fg : bg;
      const o = 1 + x*4;
      row[o] = c[0]; row[o+1] = c[1]; row[o+2] = c[2]; row[o+3] = outside ? 0 : 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- ビルド本体 ---------- */
function build(){
  let html = read("src/index.template.html");

  for(const [name, file] of DATA_BLOCKS){
    const text = read(file);
    try{ JSON.parse(text); }
    catch(e){ throw new Error(`${file} が JSON として不正です: ${e.message}`); }
    html = injectBlock(html, name, text.trim());
  }

  const parts = [
    ...ENGINE_FILES.map(f => `/* ===== src/engine/${f} ===== */\n` + readFileSync(join(SRC, "engine", f), "utf8")),
    ...UI_FILES.map(f     => `/* ===== src/ui/${f} ===== */\n`     + readFileSync(join(SRC, "ui", f), "utf8"))
  ];
  if(!html.includes("/*==APP_JS==*/")) throw new Error("マーカー APP_JS がテンプレートに見つかりません");
  html = html.replace("/*==APP_JS==*/", () => parts.join("\n\n"));

  if(existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "index.html"), html, "utf8");

  /* SWのキャッシュ名に使う版(中身が変われば必ず変わる=更新トーストの発火源) */
  const version = createHash("sha256").update(html).digest("hex").slice(0, 12);

  const manifest = {
    name: "クエスト",
    short_name: "クエスト",
    description: "ふくしゅう(算数・理科・社会・国語)と じゅんび(テスト対策)の学習クエスト",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EEF4FB",
    theme_color: "#FF8A3D",
    lang: "ja",
    icons: [
      { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
    ]
  };
  writeFileSync(join(DIST, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const sw = read("src/sw.template.js").replace(/__CACHE_VERSION__/g, version);
  writeFileSync(join(DIST, "sw.js"), sw, "utf8");

  for(const size of [180, 192, 512]){
    writeFileSync(join(DIST, `icon-${size}.png`), makeIconPng(size));
  }
  writeFileSync(join(DIST, ".nojekyll"), "", "utf8");

  const kb = (Buffer.byteLength(html, "utf8")/1024).toFixed(1);
  console.log(`dist/index.html を生成しました (${kb} KB / version ${version})`);
  for(const [name, file] of DATA_BLOCKS){
    const o = JSON.parse(read(file));
    const n = Array.isArray(o.questions) ? `${o.questions.length}問` : (o.skinVersion || "-");
    console.log(`  ${name.padEnd(16)} ← ${file.padEnd(32)} ${o.bankVersion || o.skinVersion} ${Array.isArray(o.questions) ? n : ""}`);
  }
}

build();
