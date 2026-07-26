/* =====================================================================
   ui/parent.js — おうちの人メニュー(共通1箇所)
   仕様: v4.1 §2 / §3.1 / §4.4 / §6、fukushu §7(2経路更新・doApply共通)
   ・バンク差し替えは科目(M/R/S/K/Y)を選択、スキン差し替えは枠(M/R/S/K/ボス)を選択
   ・セーブコード画面はここに置く(子供の通常導線からは外す)
   ===================================================================== */

const BANK_SLOTS = ["M","R","S","K","Y"];
const SKIN_SLOTS = ["M","R","S","K","BOSS"];
const SKIN_SLOT_LABEL = { M:"算数(ふくしゅう)", R:"理科(ふくしゅう)", S:"社会(ふくしゅう)", K:"国語(ふくしゅう)", BOSS:"じゅんび(ボス)" };

let parentBankSlot = "M";
let parentSkinSlot = "M";

function skinWorldOf(slot){ return slot === "BOSS" ? WORLDS.Y : WORLDS[slot]; }

function renderParentMenu(msg){
  quiz = null;
  const bankMsg = msg && msg.target === "bank" ? msg : null;
  const skinMsg = msg && msg.target === "skin" ? msg : null;

  app.innerHTML = `
    ${bannerHtml()}
    <div class="topbar"><button class="quit-btn" id="back">← もどる</button></div>
    <div class="home-title" style="font-size:22px">⚙️ おうちの人メニュー</div>
    <div class="home-sub">バンク(問題)・スキン(見た目)の更新とセーブコードはここから。子どもの画面には出てきません。</div>

    <div class="map-card">
      <div class="map-label">いまのバンク</div>
      <div class="bank-status">
        ${BANK_SLOTS.map(s => {
          const w = WORLDS[s];
          return `<div>${esc(SUBJECT_LABEL[s])}(${s}): <b>${esc(w.bank.bankVersion||"-")}</b>
            ${w.allQs.length}問(有効 ${w.liveQs.length})・${w.bankSource==="local"?"端末に投入":"内蔵"}</div>`;
        }).join("")}
      </div>
    </div>

    <div class="code-card">
      <div class="code-label">📚 バンクを更新する</div>
      <select id="bankSlot" class="slot-select">
        ${BANK_SLOTS.map(s => `<option value="${s}" ${s===parentBankSlot?"selected":""}>${esc(SUBJECT_LABEL[s])}(${s})</option>`).join("")}
      </select>
      <div class="code-label" style="margin-top:12px;">📂 バンクJSONファイルを開く(かんたん・おすすめ)</div>
      <input type="file" id="bankFile" accept=".json,application/json,text/plain" class="bank-file">
      <div class="code-label" style="margin-top:14px;">📋 またはJSON全文を貼り付け</div>
      <textarea id="bankPaste" class="bank-paste" rows="6" placeholder="ここにバンクJSON全文を貼り付け"></textarea>
      <div class="code-row" style="margin-top:10px;">
        <button class="code-btn" id="applyBankBtn" style="flex:1;">バンクを更新する</button>
      </div>
      ${bankMsg ? `<div class="code-msg ${bankMsg.ok?'ok':'ng'}">${esc(bankMsg.text)}</div>` : ""}
    </div>
    <button class="reset-bank-btn" id="resetBankBtn">🔄 えらんだ科目を内蔵バンクに戻す</button>

    <div class="code-card" style="margin-top:20px;">
      <div class="code-label">🎭 スキンを更新する</div>
      <select id="skinSlot" class="slot-select">
        ${SKIN_SLOTS.map(s => `<option value="${s}" ${s===parentSkinSlot?"selected":""}>${esc(SKIN_SLOT_LABEL[s])}</option>`).join("")}
      </select>
      <div class="skin-status" id="skinStatus"></div>
      <div class="code-label" style="margin-top:12px;">📂 スキンJSONファイルを開く</div>
      <input type="file" id="skinFile" accept=".json,application/json,text/plain" class="bank-file">
      <div class="code-label" style="margin-top:14px;">📋 またはJSON全文を貼り付け</div>
      <textarea id="skinPaste" class="bank-paste" rows="5" placeholder="ここにスキンJSON全文を貼り付け"></textarea>
      <div class="code-row" style="margin-top:10px;">
        <button class="code-btn" id="applySkinBtn" style="flex:1;">スキンを更新する</button>
      </div>
      ${skinMsg ? `<div class="code-msg ${skinMsg.ok?'ok':'ng'}">${esc(skinMsg.text)}</div>` : ""}
    </div>
    <button class="reset-bank-btn" id="resetSkinBtn">🔄 えらんだ枠を内蔵スキンに戻す</button>

    <button class="reset-bank-btn" id="codeScreenBtn" style="margin-top:20px;">🔑 セーブコード(発行・読み込み)</button>`;

  bindBanner();
  document.getElementById("back").addEventListener("click", () => renderCurrentView());
  document.getElementById("codeScreenBtn").addEventListener("click", () => renderSaveCodeScreen());

  const slotSel = document.getElementById("bankSlot");
  slotSel.addEventListener("change", () => { parentBankSlot = slotSel.value; });
  const skinSel = document.getElementById("skinSlot");
  const refreshSkinStatus = () => {
    const w = skinWorldOf(skinSel.value);
    document.getElementById("skinStatus").innerHTML =
      `いま: <b>${esc(w.skin.skinVersion||"-")}</b>(${esc(w.skin.title||"")})・${w.skinSource==="local"?"端末に投入":"内蔵"}`;
  };
  skinSel.addEventListener("change", () => { parentSkinSlot = skinSel.value; refreshSkinStatus(); });
  refreshSkinStatus();

  /* ---------- バンク更新(貼り付け・ファイルの2経路とも doApplyBank を通る) ---------- */
  const doApplyBank = (text) => {
    const sub = parentBankSlot;
    const w = WORLDS[sub];
    const result = validateBankPaste(text, sub, w.allQs.map(q => q.id));
    if(!result.ok){
      renderParentMenu({ target:"bank", ok:false, text:"❌ 更新できませんでした: " + result.reason });
      return;
    }
    if(sub === "Y" && result.bank.bankVersion !== w.bank.bankVersion){
      /* サイクル交代はメニュー経由でも §7.1 と同一処理を通す(記録漏れ防止) */
      renderCycleSwitchConfirm(result.bank, "menu");
      return;
    }
    applyBankToWorld(sub, result.bank);
    renderParentMenu({ target:"bank", ok:true, text: storageAvailable
      ? "✅ 更新しました!(この端末に保存されました)"
      : "✅ 今回のセッションで更新しました(保存はされていません。次回はまた読み込んでね)" });
  };
  document.getElementById("applyBankBtn").addEventListener("click", () => doApplyBank(document.getElementById("bankPaste").value));
  document.getElementById("bankFile").addEventListener("change", ev => readFileInto(ev, doApplyBank, "bank"));

  document.getElementById("resetBankBtn").addEventListener("click", () => {
    const sub = parentBankSlot;
    const builtin = BUILTIN_BANKS[sub];
    if(sub === "Y" && builtin.bankVersion !== WORLDS.Y.bank.bankVersion){
      renderCycleSwitchConfirm(builtin, "menu");
      return;
    }
    clearAdopted(keyBank(sub));
    applyBankToWorld(sub, builtin, true);
    renderParentMenu({ target:"bank", ok:true, text:`🔄 ${SUBJECT_LABEL[sub]}を内蔵バンクに戻しました。` });
  });

  /* ---------- スキン更新 ---------- */
  const doApplySkin = (text) => {
    const slot = parentSkinSlot;
    const result = validateSkinPaste(text, slot === "BOSS" ? "boss" : "fukushu");
    if(!result.ok){
      renderParentMenu({ target:"skin", ok:false, text:"❌ 更新できませんでした: " + result.reason });
      return;
    }
    const w = skinWorldOf(slot);
    w.skin = result.skin;
    w.skinSource = "local";
    writeAdopted(keySkin(slot), result.skin, BUILTIN_SKINS[slot].skinVersion);
    renderParentMenu({ target:"skin", ok:true, text: storageAvailable
      ? "✅ スキンを更新しました!(この端末に保存されました)"
      : "✅ 今回のセッションでスキンを更新しました(保存はされていません)。" });
  };
  document.getElementById("applySkinBtn").addEventListener("click", () => doApplySkin(document.getElementById("skinPaste").value));
  document.getElementById("skinFile").addEventListener("change", ev => readFileInto(ev, doApplySkin, "skin"));

  document.getElementById("resetSkinBtn").addEventListener("click", () => {
    const slot = parentSkinSlot;
    const w = skinWorldOf(slot);
    clearAdopted(keySkin(slot));
    w.skin = BUILTIN_SKINS[slot];
    w.skinSource = "builtin";
    renderParentMenu({ target:"skin", ok:true, text:`🔄 ${SKIN_SLOT_LABEL[slot]}を内蔵スキンに戻しました。` });
  });
}

function readFileInto(ev, cb, what){
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const rd = new FileReader();
  rd.onload  = () => cb(String(rd.result));
  rd.onerror = () => renderParentMenu({ target:what, ok:false, text:"❌ ファイルを読み込めませんでした。" });
  rd.readAsText(f);
}

/* バンクを世界へ適用。進捗は保持し、増えた問題は未出題として扱う(§4.2) */
function applyBankToWorld(sub, bank, isBuiltinReset){
  const w = WORLDS[sub];
  w.bank = bank;
  deriveWorld(w);
  w.state = reconcileState(w.state, bank);
  saveState(sub, w.state);
  if(sub === "Y"){
    mirrorYBank(bank);                                   // §7.1 実装要件
  } else if(isBuiltinReset){
    w.bankSource = "builtin";
  } else {
    writeAdopted(keyBank(sub), bank, BUILTIN_BANKS[sub].bankVersion);
    w.bankSource = bank.bankVersion === BUILTIN_BANKS[sub].bankVersion ? "builtin" : "local";
  }
}

/* ---------- セーブコード画面(§4.4) ---------- */
let codeScreenSubject = "M";

function renderSaveCodeScreen(msg){
  quiz = null;
  const sub = codeScreenSubject;
  const w = WORLDS[sub];
  const mode = sub === "Y" ? "yoshu" : "fukushu";
  const code = makeSaveCode(w.allQs, w.state.boxes, w.state.xp, mode);

  app.innerHTML = `
    ${bannerHtml()}
    <div class="topbar"><button class="quit-btn" id="back">← おうちの人メニューへ</button></div>
    <div class="home-title" style="font-size:22px">🔑 セーブコード</div>
    <div class="home-sub">端末を移るとき・保存が消えたときの復旧用です。ふだんは自動保存されています。</div>

    <select id="codeSlot" class="slot-select">
      ${BANK_SLOTS.map(s => `<option value="${s}" ${s===sub?"selected":""}>${esc(SUBJECT_LABEL[s])}(${s})</option>`).join("")}
    </select>

    <div class="savecode-card">
      <div class="savecode-label">きょうのセーブコード(おうちの人にメモしてもらおう)</div>
      <div class="savecode-text">${esc(code)}</div>
      <div class="savecode-note">${sub==="Y"
        ? "ボス交代をまたぐ復元はできません。"
        : "次回このコードを入れると、たびの続きと復習の記録がもどるよ。"}</div>
    </div>

    <div class="code-card">
      <div class="code-label">📥 コードを読み込む(いまの進捗は上書きされます)</div>
      <div class="code-row">
        <input type="text" class="code-input" id="codeInput" placeholder="V2-260726-..." autocapitalize="characters">
        <button class="code-btn" id="codeBtn">読み込む</button>
      </div>
      ${msg ? `<div class="code-msg ${msg.ok?'ok':'ng'}">${esc(msg.text)}</div>` : ""}
    </div>`;

  bindBanner();
  document.getElementById("back").addEventListener("click", () => renderParentMenu());
  const sel = document.getElementById("codeSlot");
  sel.addEventListener("change", () => { codeScreenSubject = sel.value; renderSaveCodeScreen(); });

  document.getElementById("codeBtn").addEventListener("click", () => {
    const raw = document.getElementById("codeInput").value;
    const parsed = parseSaveCode(raw, w.allQs, mode);
    if(!parsed){
      renderSaveCodeScreen({ ok:false, text:"コードがちがうみたい。もういちど確認してね。" });
      return;
    }
    if(parsed.error === "bank_old"){
      renderSaveCodeScreen({ ok:false, text:"このコードは今のバンクより新しい問題数を含んでいるみたい。アプリのバンクが古いかも。最新バンクを読み込んでね。" });
      return;
    }
    /* §4.3: コード復元のときだけ last を復元日で一括初期化する */
    w.state = applyRestoredCode(w.state, parsed, w.bank, new Date());
    saveState(sub, w.state);
    renderSaveCodeScreen({ ok:true, text:"つづきを読み込んだよ!" + (parsed.version==="V1" ? "(古い形式のコードだったけど読み込めたよ)" : "") });
  });
}
