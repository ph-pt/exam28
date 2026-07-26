/* =====================================================================
   engine/storage.js — localStorage の可否判定と安全な読み書き
   仕様: v4.1 §3 / §4.1(書き込み失敗時はバナー+セーブコード導線)
   ===================================================================== */

let storageAvailable = false;
let storageWriteFailed = false;      // 一度でも書き込みに失敗したら true(常時バナーの根拠)

function probeStorage(){
  try{
    localStorage.setItem("__quest_probe__", "1");
    localStorage.removeItem("__quest_probe__");
    storageAvailable = true;
  }catch(e){
    storageAvailable = false;
  }
  return storageAvailable;
}

function lsGetJSON(key){
  if(!storageAvailable) return null;
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function lsSetJSON(key, value){
  if(!storageAvailable){ storageWriteFailed = true; return false; }
  try{
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }catch(e){
    storageWriteFailed = true;      // 容量超過など
    return false;
  }
}

function lsRemove(key){
  if(!storageAvailable) return;
  try{ localStorage.removeItem(key); }catch(e){}
}

/* v4.1 §3 のキー */
function keyState(subject){ return "quest_state_" + subject; }
function keyBank(subject){ return "quest_bank_" + subject; }
function keySkin(slot){ return "quest_skin_" + slot; }        // slot: M/R/S/K/BOSS
const KEY_BOSS_LOG  = "quest_boss_log_Y";
const KEY_UNLOCK    = "quest_unlock_Y";
const KEY_LAST_VIEW = "quest_last_view";
