/* =====================================================================
   ui/app.js — 起動シーケンス
   仕様: v4.1 §3.1(採用規則)/ §4(自動保存)/ §7(PWA)/ §7.1(サイクル交代確認)
   ===================================================================== */

/* ---------- 内蔵デフォルト(BANK/SKINブロックが壊れていた場合の緊急用) ---------- */
function emptyBankFor(subject){
  return { bankVersion: "fallback_" + subject, subject, cats: [], questions: [],
           testDate: subject === "Y" ? "2000-01-01" : undefined };
}
const DEFAULT_FUKUSHU_SKIN = {
  skinVersion:"fallback", title:"クエスト",
  colors:{bg:"#EEF4FB",ink:"#26324B",accent:"#FF8A3D",ok:"#2FBF8F",ng:"#F26D6D",star:"#FFC53D"},
  praise:["やったね!","すごい!"], cheer:["おしい! もう一度チャレンジ。"],
  hintPraise:"ヒントを使えたのもナイス判断!",
  writeTip:"まずノートに書こう!",
  map:{type:"journey", nodes:[{name:"スタート",emoji:"🚩"},{name:"ゴール",emoji:"🏁"}], stepPerCorrect:1, goalMessage:"ゴール!"},
  titles:[]
};
const DEFAULT_BOSS_SKIN = {
  skinVersion:"fallback", title:"テストじゅんびクエスト",
  boss:{ name:"れんしゅう魔王", emoji:"👾", flavor:"「とりあえず、れんしゅうからじゃな」",
    lines:{ appear:"さあ、はじめるかの!", damage:["いてて!","ぐぬぬ…"], counter:"カウンター攻撃!",
            sealBreak:"封印がひとつ解けた!", defeat:"まいった〜!", escape:"また今度な〜。" } },
  colors:{bg:"#FFF7EC",ink:"#3A2E2A",accent:"#FF8A3D",ok:"#2FBF8F",ng:"#F26D6D",star:"#FFC53D"},
  praise:["やったね!","すごい!"], cheer:["おしい! もう一度チャレンジ。"],
  hintPraise:"ヒントを使えたのもナイス判断!",
  writeTip:"まずノートに式やことばを書こう!",
  titles:[]
};

const BUILTIN_BANKS = {};
const BUILTIN_SKINS = {};

function parseInjected(raw, label, validate, fallback){
  try{
    const parsed = JSON.parse(raw);
    if(validate(parsed)) return parsed;
    throw new Error("validation failed");
  }catch(e){
    fallbackWarnings.push(`${label}の読み込みに失敗したため、内蔵の簡易データで起動しています。`);
    return fallback;
  }
}

function boot(){
  probeStorage();

  /* 注入された10ブロックを読み込む */
  BUILTIN_BANKS.M = parseInjected(BANK_M_RAW, "算数バンク", b => validateBankObj(b,"M"), emptyBankFor("M"));
  BUILTIN_BANKS.R = parseInjected(BANK_R_RAW, "理科バンク", b => validateBankObj(b,"R"), emptyBankFor("R"));
  BUILTIN_BANKS.S = parseInjected(BANK_S_RAW, "社会バンク", b => validateBankObj(b,"S"), emptyBankFor("S"));
  BUILTIN_BANKS.K = parseInjected(BANK_K_RAW, "国語バンク", b => validateBankObj(b,"K"), emptyBankFor("K"));
  BUILTIN_BANKS.Y = parseInjected(BANK_Y_RAW, "じゅんびバンク", b => validateBankObj(b,"Y"), emptyBankFor("Y"));
  BUILTIN_SKINS.M = parseInjected(SKIN_FUKUSHU_M_RAW, "算数スキン", s => validateSkinObj(s,"fukushu"), DEFAULT_FUKUSHU_SKIN);
  BUILTIN_SKINS.R = parseInjected(SKIN_FUKUSHU_R_RAW, "理科スキン", s => validateSkinObj(s,"fukushu"), DEFAULT_FUKUSHU_SKIN);
  BUILTIN_SKINS.S = parseInjected(SKIN_FUKUSHU_S_RAW, "社会スキン", s => validateSkinObj(s,"fukushu"), DEFAULT_FUKUSHU_SKIN);
  BUILTIN_SKINS.K = parseInjected(SKIN_FUKUSHU_K_RAW, "国語スキン", s => validateSkinObj(s,"fukushu"), DEFAULT_FUKUSHU_SKIN);
  BUILTIN_SKINS.BOSS = parseInjected(SKIN_BOSS_RAW, "ボススキン", s => validateSkinObj(s,"boss"), DEFAULT_BOSS_SKIN);

  const switchedNotices = [];
  let resyncYMirror = false;      // 同版のためサイクル交代不要だが、記録の更新が要る場合

  /* ---------- §3.1 採用規則でバンク・スキンを決める ---------- */
  ["M","R","S","K","Y"].forEach(sub => {
    const isY = sub === "Y";
    const a = adoptResource(
      keyBank(sub), BUILTIN_BANKS[sub],
      b => b.bankVersion,
      b => validateBankObj(b, sub),
      isY                                        // bank_Y の内蔵切替は §7.1 へ回す
    );
    if(a.warning) fallbackWarnings.push(a.warning);
    if(a.switched) switchedNotices.push(SUBJECT_LABEL[sub]);
    WORLDS[sub] = deriveWorld({
      subject: sub,
      mode: isY ? "yoshu" : "fukushu",
      bank: a.value,
      bankSource: a.source,
      skin: null, skinSource: "builtin",
      state: null
    });
    /* §7.1 の発火条件は「内蔵bank_YのbankVersionが"現在有効なbank_Y"と異なる場合」。
       おうちの人メニューで投入したのと同じ版が後から push で内蔵に入っただけのときは
       サイクル交代ではないので、確認を出さずに記録(ミラー)だけ更新して続行する。
       (ここで確認を出すと、中身が同じなのに進捗リセットを迫ることになる) */
    if(isY && a.pendingSwitch){
      if(a.pendingSwitch.bankVersion === a.value.bankVersion) resyncYMirror = true;
      else pendingCycleSwitch = a.pendingSwitch;
    }
  });

  SKIN_SLOTS.forEach(slot => {
    const a = adoptResource(
      keySkin(slot), BUILTIN_SKINS[slot],
      s => s.skinVersion,
      s => validateSkinObj(s, slot === "BOSS" ? "boss" : "fukushu"),
      false
    );
    if(a.warning) fallbackWarnings.push(a.warning);
    const w = skinWorldOf(slot);
    w.skin = a.value;
    w.skinSource = a.source;
  });

  /* ---------- 進捗の読み込み(§4.2 突合つき) ---------- */
  ["M","R","S","K","Y"].forEach(sub => {
    WORLDS[sub].state = loadState(sub, WORLDS[sub].bank);
  });

  /* ---------- §7.1 実装要件: 現在有効な bank_Y は常に quest_bank_Y にミラー ---------- */
  if(!readAdopted(keyBank("Y")) || resyncYMirror) mirrorYBank(WORLDS.Y.bank);

  /* ---------- 自動保存のフック(§4.1) ---------- */
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "hidden") flushAllStates();
  });
  window.addEventListener("pagehide", flushAllStates);

  registerServiceWorker();

  /* ---------- 初期表示 ---------- */
  VIEW = loadLastView();
  if(pendingCycleSwitch){
    /* §7.1-1: 起動時に交代確認。プレイ中には割り込まない */
    renderCycleSwitchConfirm(pendingCycleSwitch, "startup");
  } else {
    renderCurrentView();
  }
  if(switchedNotices.length){
    showToast(`新しいバンクが届いたので切りかえたよ(${switchedNotices.join("・")})`);
  }
}

/* ---------- Service Worker(§7) ---------- */
function registerServiceWorker(){
  /* file:// では SW を使わない(§9-10: SW以外の全機能が動くこと) */
  if(location.protocol !== "http:" && location.protocol !== "https:") return;
  if(!("serviceWorker" in navigator)) return;

  /* 更新適用はユーザーのタップ起点。controllerchange を待ってから1回だけリロードする */
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading) return;
    reloading = true;
    location.reload();
  });

  const offerUpdate = (waiting) => {
    showToast("あたらしいバージョンがあるよ(タップで読みこみ)", () => {
      flushAllStates();
      waiting.postMessage({ type: "SKIP_WAITING" });
    });
  };

  navigator.serviceWorker.register("./sw.js").then(reg => {
    if(reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if(!sw) return;
      sw.addEventListener("statechange", () => {
        /* 既にコントローラがいる=更新。学習中の強制リロードはせずトーストで知らせる */
        if(sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(sw);
      });
    });
  }).catch(() => {});
}

boot();
