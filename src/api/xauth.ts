import { XAuthInfo } from "../types";
import { maskSensitive } from "../utils"; // Import the masking function

/**
 * Xの認証情報をプロパティサービスに保存します。
 * @param {XAuthInfo} authInfo - 保存する認証情報オブジェクト。
 *   { accountId: string, apiKey: string, apiKeySecret: string, accessToken: string, accessTokenSecret: string }
 * @return {object} 保存された認証情報（機密情報は除く）または成功メッセージ。
 * @throws {Error} 必須フィールドが不足している場合や保存に失敗した場合。
 */
function createXAuth(authInfo): object {
  // 必須フィールドのチェック
  if (
    !authInfo.accountId ||
    !authInfo.apiKey ||
    !authInfo.apiKeySecret ||
    !authInfo.accessToken ||
    !authInfo.accessTokenSecret
  ) {
    throw new Error("Missing required fields in XAuthInfo.");
  }

  const properties = PropertiesService.getScriptProperties();
  const propKey = `xauth_${authInfo.accountId}`; // アカウントIDをキーの一部にする

  // 既に同じaccountIdが存在するかチェック（上書きしない場合）
  // if (properties.getProperty(propKey)) {
  //   throw new Error(`XAuthInfo for accountId '${authInfo.accountId}' already exists.`);
  // }
  // ※今回は上書きを許容する実装とします。更新は別アクション(update)で行う想定。

  try {
    // オブジェクトをJSON文字列に変換して保存
    properties.setProperty(propKey, JSON.stringify(authInfo));

    Logger.log(`XAuthInfo saved for accountId: ${authInfo.accountId}`);
    // 成功レスポンスとして、機密情報を含まない形で返す例
    return {
      status: "success",
      message: `XAuthInfo for accountId '${authInfo.accountId}' created successfully.`,
      accountId: authInfo.accountId,
    };
  } catch (e: any) {
    Logger.log(
      `Error saving XAuthInfo for accountId ${authInfo.accountId}: ${e}`
    );
    // Errorシートへの記録などをここで行うことも検討
    throw new Error(`Failed to save XAuthInfo: ${e.message}`);
  }
}

/**
 * プロパティに保存されている全てのX認証情報のaccountIdリストを取得します。
 * @return {Array<{accountId: string, note?: string}>} 登録されているX認証情報の公開可能な情報。
 */
function getXAuthAll() {
  const properties = PropertiesService.getScriptProperties();
  const keys = properties.getKeys();
  const authAccountInfo: Array<Pick<XAuthInfo, "accountId" | "note">> = [];
  const prefix = "xauth_"; // 保存時に使用したキーのプレフィックス

  for (const key of keys) {
    if (key.startsWith(prefix)) {
      try {
        // プロパティからJSON文字列を取得しパース
        const authInfoString = properties.getProperty(key);
        if (authInfoString) {
          const authInfo = JSON.parse(authInfoString);
          // accountId が存在すればリストに追加
          if (authInfo && authInfo.accountId) {
            const xauthInfo: Pick<XAuthInfo, "accountId" | "note"> = {
              accountId: authInfo.accountId,
              note: authInfo.note || "", // noteフィールドがあれば追加,
            };

            authAccountInfo.push(xauthInfo);
          } else {
            Logger.log(
              `Property found for key ${key}, but accountId is missing or invalid.`
            );
          }
        }
      } catch (e) {
        Logger.log(`Error parsing or reading property for key ${key}: ${e}`);
        // エラーが発生したキーはスキップします
        continue;
      }
    }
  }

  Logger.log(
    `Retrieved ${authAccountInfo.length} XAuth accounts: [${authAccountInfo
      .map((info) => maskSensitive(info.accountId))
      .join(", ")}]`
  );
  return authAccountInfo;
}

/**
 * 指定されたaccountIdに対応するXの認証情報をプロパティサービスで更新します。
 * 保存済みデータとマージするため、accountId以外のフィールドは省略可能です。
 * 省略された（または空文字の）認証情報フィールドは既存の値を維持します。
 * これによりクライアントへ機密情報を返さなくても備考(note)だけの編集が可能です。
 * @param {Partial<XAuthInfo>} authInfo - 更新する認証情報オブジェクト。accountIdは必須。
 *   { accountId: string, apiKey?: string, apiKeySecret?: string, accessToken?: string, accessTokenSecret?: string, note?: string }
 * @return {object} 更新成功を示すメッセージとaccountId。
 * @throws {Error} accountIdが指定されていない場合、対象のaccountIdが見つからない場合、または更新に失敗した場合。
 */
function updateXAuth(authInfo) {
  // 必須フィールドのチェック (キーとなるaccountIdのみ必須)
  if (!authInfo || !authInfo.accountId) {
    throw new Error(
      "Missing required field: accountId for updating XAuthInfo."
    );
  }

  const properties = PropertiesService.getScriptProperties();
  const propKey = `xauth_${authInfo.accountId}`; // アカウントIDからキーを特定

  // 対象のプロパティを取得 (存在しない場合はエラー)
  const existingAuthInfoString = properties.getProperty(propKey);
  if (!existingAuthInfoString) {
    throw new Error(
      `XAuthInfo for accountId '${authInfo.accountId}' not found. Cannot update.`
    );
  }

  try {
    let existingAuthInfo: { [key: string]: any } = {};
    try {
      existingAuthInfo = JSON.parse(existingAuthInfoString) || {};
    } catch (parseError) {
      Logger.log(
        `Stored XAuthInfo for accountId ${authInfo.accountId} is not valid JSON. Overwriting with new values.`
      );
    }

    // 認証情報4種: 空でない値が送られた場合のみ更新し、それ以外は既存値を維持
    const credentialFields = [
      "apiKey",
      "apiKeySecret",
      "accessToken",
      "accessTokenSecret",
    ];
    const mergedAuthInfo: { [key: string]: any } = {
      ...existingAuthInfo,
      accountId: authInfo.accountId,
    };
    for (const field of credentialFields) {
      const incoming = authInfo[field];
      if (typeof incoming === "string" && incoming.trim() !== "") {
        mergedAuthInfo[field] = incoming;
      }
    }

    // note はフィールドが送られた場合のみ更新（空文字は「備考のクリア」として有効）
    if (authInfo.note !== undefined && authInfo.note !== null) {
      mergedAuthInfo.note = String(authInfo.note);
    }

    // マージ後に認証情報が揃っているか検証（既存データが正常なら常に揃う）
    const missingFields = credentialFields.filter(
      (field) =>
        typeof mergedAuthInfo[field] !== "string" ||
        mergedAuthInfo[field].trim() === ""
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Stored XAuthInfo for accountId '${authInfo.accountId}' is incomplete (missing: ${missingFields.join(", ")}). Re-register all credentials.`
      );
    }

    // マージした認証情報オブジェクトをJSON文字列に変換して上書き保存
    const newAuthInfoString = JSON.stringify(mergedAuthInfo);
    properties.setProperty(propKey, newAuthInfoString);

    Logger.log(`XAuthInfo updated for accountId: ${authInfo.accountId}`);
    // 成功レスポンスとして、機密情報を含まない形で返す
    return {
      status: "success",
      message: `XAuthInfo for accountId '${authInfo.accountId}' updated successfully.`,
      accountId: authInfo.accountId,
    };
  } catch (e: any) {
    Logger.log(
      `Error updating XAuthInfo for accountId ${authInfo.accountId}: ${e}`
    );
    // Errorシートへの記録などをここで行うことも検討
    throw new Error(`Failed to update XAuthInfo: ${e.message}`);
  }
}

/**
 * 指定されたaccountIdに対応するXの認証情報をプロパティサービスから削除します。
 * accountIdが "all" の場合は、全てのX認証情報を削除します。
 * @param {XAuthInfo} authInfo - 削除対象の認証情報を含むオブジェクト。accountIdフィールドが必須。
 *   { accountId: string, ... } // accountIdを使用
 * @return {object} 削除成功を示すメッセージ。全削除の場合は削除件数も含む。
 * @throws {Error} accountIdが指定されていない場合、対象のaccountIdが見つからない場合(単一削除時)、または削除に失敗した場合。
 */
function deleteXAuth(authInfo) {
  // 必須フィールド(accountId)のチェック
  if (!authInfo || !authInfo.accountId) {
    throw new Error(
      "Missing required field: accountId for deleting XAuthInfo."
    );
  }

  const accountId = authInfo.accountId;
  const properties = PropertiesService.getScriptProperties();
  const prefix = "xauth_"; // 保存時に使用したキーのプレフィックス

  if (accountId === "all") {
    // --- 全削除の処理 ---
    let deletedCount = 0;
    const keysToDelete: string[] = [];
    try {
      const allKeys = properties.getKeys();
      for (const key of allKeys) {
        if (key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }

      if (keysToDelete.length === 0) {
        Logger.log("No XAuthInfo found to delete.");
        return {
          status: "success",
          message: "No XAuthInfo found to delete.",
          deletedCount: 0,
        };
      }

      for (const key of keysToDelete) {
        properties.deleteProperty(key);
        deletedCount++;
      }

      Logger.log(`Deleted ${deletedCount} XAuthInfo entries.`);
      return {
        status: "success",
        message: `Successfully deleted all (${deletedCount}) XAuthInfo entries.`,
        deletedCount: deletedCount,
      };
    } catch (e: any) {
      Logger.log(`Error during bulk deletion of XAuthInfo: ${e}`);
      // エラー発生時も、途中まで削除されている可能性がある
      throw new Error(
        `Failed during bulk deletion of XAuthInfo: ${e.message}. ${deletedCount} entries might have been deleted before the error.`
      );
    }
  } else {
    // --- 単一削除の処理 ---
    const propKey = `${prefix}${accountId}`; // アカウントIDからキーを特定

    // 対象のプロパティが存在するか確認 (存在しない場合はエラー)
    if (!properties.getProperty(propKey)) {
      throw new Error(
        `XAuthInfo for accountId '${accountId}' not found. Cannot delete.`
      );
    }

    try {
      // プロパティを削除
      properties.deleteProperty(propKey);

      Logger.log(`XAuthInfo deleted for accountId: ${accountId}`);
      // 成功レスポンス
      return {
        status: "success",
        message: `XAuthInfo for accountId '${accountId}' deleted successfully.`,
        accountId: accountId,
        deletedCount: 1, // 単一削除なので1件
      };
    } catch (e: any) {
      Logger.log(`Error deleting XAuthInfo for accountId ${accountId}: ${e}`);
      // Errorシートへの記録などをここで行うことも検討
      throw new Error(
        `Failed to delete XAuthInfo for accountId ${accountId}: ${e.message}`
      );
    }
  }
}

export { createXAuth, getXAuthAll, updateXAuth, deleteXAuth };
