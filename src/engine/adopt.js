/* =====================================================================
   engine/adopt.js — バンク・スキンの採用規則(v4.1 §3.1)
   bankVersion の新旧比較(順序判定)は行わない。等値判定のみで決める。

   localStorage の値の形: { data: <bank|skin>, builtinVersion: "<投入時点の内蔵version>" }

   起動時:
     1. 投入なし                                   → 内蔵を使用
     2. 投入あり & 内蔵version == 記録されたversion → 投入を使用(再起動をまたいで有効)
     3. 投入あり & 内蔵versionが記録と異なる        → 内蔵に切替+投入解除+トースト通知
   例外: bank_Y の 3 は無条件に実行せず、§7.1 のサイクル交代確認フローへ回す
   ===================================================================== */

function readAdopted(storageKey){
  const stored = lsGetJSON(storageKey);
  if(!stored || typeof stored !== "object" || !stored.data) return null;
  return stored;
}

function writeAdopted(storageKey, data, builtinVersion){
  return lsSetJSON(storageKey, { data, builtinVersion });
}

function clearAdopted(storageKey){ lsRemove(storageKey); }

/**
 * @param storageKey  quest_bank_* / quest_skin_*
 * @param builtin     内蔵リソース
 * @param versionOf   リソース→version文字列
 * @param isValid     リソース→boolean(壊れたキャッシュを弾く)
 * @param deferSwitch true なら規則3を実行せず pendingSwitch を返す(bank_Y 用)
 * @returns { value, source:"builtin"|"local", switched, pendingSwitch, warning }
 */
function adoptResource(storageKey, builtin, versionOf, isValid, deferSwitch){
  const builtinVersion = versionOf(builtin);
  const stored = readAdopted(storageKey);

  if(!stored){
    return { value: builtin, source: "builtin", switched: false, pendingSwitch: null, warning: null };
  }
  if(!isValid(stored.data)){
    clearAdopted(storageKey);
    return { value: builtin, source: "builtin", switched: false, pendingSwitch: null,
             warning: "保存されていたデータが壊れていたため、内蔵版で起動しています。" };
  }
  if(stored.builtinVersion === builtinVersion){
    return { value: stored.data, source: "local", switched: false, pendingSwitch: null, warning: null };
  }
  /* 内蔵が push で更新された */
  if(deferSwitch){
    return { value: stored.data, source: "local", switched: false, pendingSwitch: builtin, warning: null };
  }
  clearAdopted(storageKey);
  return { value: builtin, source: "builtin", switched: true, pendingSwitch: null, warning: null };
}
