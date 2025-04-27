// --- PropertiesService を利用するための準備 ---
const scriptProperties = PropertiesService.getScriptProperties();
const TRIGGER_INTERVAL_PREFIX = "triggerInterval_"; // プロパティのキー接頭辞

/**
 * 時間ベースのトリガーを作成する。既存の 'autoPostToX' トリガーは削除される。
 * トリガーIDと間隔を PropertiesService に保存する。
 * @param {object} postData リクエストデータ。intervalMinutes プロパティを含む。
 * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
 */
function createTimeBasedTrigger(postData) {
  const intervalMinutes = postData.intervalMinutes; // トリガーの間隔 (分)
  let newTriggerId: string | null = null;
  const handlerFunction = "autoPostToX"; // トリガーで実行する関数名
  let deletedExistingCount = 0;
  const deletedTriggerIds: string[] = []; // 削除したトリガーIDを保持

  try {
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
      throw new Error(
        "Invalid interval: must be an integer greater than or equal to 1."
      );
    }

    // Log the intervalMinutes value
    Logger.log(`Interval minutes received: ${intervalMinutes}`);

    // 既存の 'autoPostToX' ハンドラ関数を持つトリガーを削除し、関連プロパティも削除
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === handlerFunction) {
        const existingTriggerId = trigger.getUniqueId();
        deletedTriggerIds.push(existingTriggerId); // 削除対象IDを記録
        ScriptApp.deleteTrigger(trigger);
        deletedExistingCount++;
        Logger.log(`Deleted existing trigger: ${existingTriggerId}`);

        // 対応するプロパティも削除
        const propertyKey = TRIGGER_INTERVAL_PREFIX + existingTriggerId;
        if (scriptProperties.getProperty(propertyKey)) {
          scriptProperties.deleteProperty(propertyKey);
          Logger.log(`Deleted script property: ${propertyKey}`);
        }
      }
    }
    Logger.log(
      `Deleted ${deletedExistingCount} existing trigger(s) for handler '${handlerFunction}'.`
    );

    // 新しいトリガーを作成
    const newTrigger = ScriptApp.newTrigger(handlerFunction)
      .timeBased()
      .everyMinutes(intervalMinutes)
      .create();
    newTriggerId = newTrigger.getUniqueId();

    // Log the new trigger ID
    Logger.log(`New trigger created with ID: ${newTriggerId}`);

    // 新しいトリガーIDと間隔を PropertiesService に保存
    const newPropertyKey = TRIGGER_INTERVAL_PREFIX + newTriggerId;
    scriptProperties.setProperty(newPropertyKey, intervalMinutes.toString());

    // Log property setting success
    Logger.log(`Property set: ${newPropertyKey} = ${intervalMinutes}`);

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: `Time-based trigger created successfully for '${handlerFunction}' to run every ${intervalMinutes} minutes.`,
        intervalMinutes: intervalMinutes,
        handlerFunction: handlerFunction,
        triggerId: newTriggerId,
        deletedExistingCount: deletedExistingCount,
        deletedTriggerIds: deletedTriggerIds, // 削除したIDのリストも返す
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error creating time-based trigger: ${error}`);
    // エラーレスポンス
    // Note: もしトリガー作成後にプロパティ保存で失敗した場合、トリガーは残る可能性がある
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: `Failed to create time-based trigger: ${error.message}`,
        intervalMinutes: intervalMinutes, // エラー時も入力値を返す
        error: error.toString(),
        triggerId: newTriggerId, // 作成試行中にIDが取れていれば返す (通常はnull)
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * プロジェクトの全てのトリガーを削除し、関連するプロパティも削除する
 * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
 */
function deleteAllTriggers() {
  let deletedCount = 0;
  const deletedTriggerDetails: { id: string; handler: string }[] = [];
  const deletedPropertyKeys: string[] = [];

  try {
    const triggers = ScriptApp.getProjectTriggers();
    const totalTriggers = triggers.length; // 削除対象の総数

    if (totalTriggers === 0) {
      Logger.log("No project triggers found to delete.");
    } else {
      Logger.log(`Found ${totalTriggers} trigger(s) to delete.`);
      for (const trigger of triggers) {
        const triggerId = trigger.getUniqueId();
        const handler = trigger.getHandlerFunction();
        deletedTriggerDetails.push({ id: triggerId, handler: handler }); // 削除前に情報を記録

        // トリガーを削除
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;

        // 対応するプロパティも削除
        const propertyKey = TRIGGER_INTERVAL_PREFIX + triggerId;
        if (scriptProperties.getProperty(propertyKey)) {
          scriptProperties.deleteProperty(propertyKey);
          deletedPropertyKeys.push(propertyKey);
          Logger.log(`Deleted script property: ${propertyKey}`);
        }
        // Logger.log(`Deleted trigger: ${triggerId} (Handler: ${handler})`); // 個別ログ
      }
      Logger.log(`Successfully deleted ${deletedCount} project trigger(s).`);
      if (deletedPropertyKeys.length > 0) {
        Logger.log(
          `Deleted ${deletedPropertyKeys.length} related script properties.`
        );
      }
    }

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: `Successfully deleted ${deletedCount} project trigger(s).`,
        deletedCount: deletedCount,
        deletedTriggers: deletedTriggerDetails, // 削除したトリガーの詳細を含める
        deletedPropertyKeys: deletedPropertyKeys, // 削除したプロパティキーのリスト
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error deleting all triggers: ${error}`);
    // エラーレスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: `Failed to delete all triggers: ${error.message}`,
        // エラー発生までに削除できたトリガーやプロパティに関する情報は部分的な可能性あり
        partiallyDeletedCount: deletedCount,
        partiallyDeletedTriggers: deletedTriggerDetails,
        partiallyDeletedPropertyKeys: deletedPropertyKeys,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- checkTriggerExists 関数について ---
// この関数は現在のところ PropertiesService を参照していません。
// もしこの関数でもプロパティから間隔を取得したい場合は、以下のように修正できます。
// ただし、`getMinutes()` メソッドは存在しないため、コメントアウトまたは削除し、
// PropertiesService から取得するようにします。

/**
 * 指定された関数名に紐づくプロジェクトトリガーが存在するかどうか、
 * および時間ベースの場合は PropertiesService から設定された間隔（分）を取得します。
 * @param {string} functionName 確認したい関数の名前 (例: 'autoPostToX')。
 * @return {GoogleAppsScript.Content.TextOutput} JSON形式のレスポンス。
 */
function checkTriggerExists(functionName) {
  if (
    !functionName ||
    typeof functionName !== "string" ||
    functionName.trim() === ""
  ) {
    // エラーの場合は例外ではなくJSONレスポンスを返す方が Web アプリとしては一般的
    return {
      status: "error",
      message: "Missing or invalid required parameter: functionName.",
      code: 400,
    };
    // throw new Error("Missing or invalid required parameter: functionName.");
  }
  functionName = functionName.trim();
  let triggerFound = false;
  let intervalMinutes: number | null = null; // 間隔（分）、見つからない場合は null
  let foundTriggerId: string | null = null;

  try {
    const triggers = ScriptApp.getProjectTriggers();
    if (triggers.length === 0) {
      Logger.log("No project triggers found.");
    } else {
      Logger.log(`Checking ${triggers.length} project trigger(s)...`);

      for (const trigger of triggers) {
        if (trigger.getHandlerFunction() === functionName) {
          triggerFound = true;
          foundTriggerId = trigger.getUniqueId();
          Logger.log(
            `Trigger found for function: ${functionName} (ID: ${foundTriggerId})`
          );

          // 時間ベースのトリガーか確認
          if (trigger.getEventType() === ScriptApp.EventType.CLOCK) {
            // PropertiesService から間隔を取得
            const propertyKey = TRIGGER_INTERVAL_PREFIX + foundTriggerId;
            const intervalString = scriptProperties.getProperty(propertyKey);
            if (intervalString) {
              intervalMinutes = parseInt(intervalString, 10);
              Logger.log(
                `Found interval from properties (${propertyKey}): ${intervalMinutes} minutes`
              );
            } else {
              Logger.log(
                `Property key ${propertyKey} not found for trigger ${foundTriggerId}. Interval unknown.`
              );
              // プロパティがない場合の代替処理（例: intervalMinutes は null のままにする）
            }
          } else {
            Logger.log(
              `Trigger ${foundTriggerId} is not a time-based trigger.`
            );
          }
          break; // 最初に見つかったトリガーでチェック終了 (通常、同じハンドラ関数は1つのはず)
        }
      }
    }

    if (!triggerFound && triggers.length > 0) {
      Logger.log(`No trigger found for function: ${functionName}`);
    }

    // 成功レスポンス
    return {
      status: "success",
      data: {
        functionName: functionName,
        triggerFound: triggerFound,
        triggerId: foundTriggerId, // 見つかったトリガーのID
        intervalMinutes: intervalMinutes,
      }, // 時間ベースでプロパティが見つかった場合のみ数値、それ以外は null
      message: triggerFound
        ? `Trigger for function '${functionName}' found.`
        : `No trigger found for function '${functionName}'.`,
      code: 200,
    };
  } catch (e: any) {
    Logger.log(`Error checking triggers for function ${functionName}: ${e}`);
    return {
      status: "error",
      message: `Failed to check triggers for function ${functionName}: ${e.message}`,
      error: e.toString(),
      code: 500, // Internal Server Error
    };
  }
}

/**
 * Deletes the trigger associated with the specified handler function and its property.
 * @param {string} handlerName The name of the handler function (e.g., 'autoPostToX').
 * @returns {boolean} True if a trigger was found and deleted, false otherwise.
 */
function deleteTriggerByHandler(handlerName: string): boolean {
  let deleted = false;
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === handlerName) {
        const triggerId = trigger.getUniqueId();
        Logger.log(
          `Found trigger for handler '${handlerName}' (ID: ${triggerId}). Deleting...`
        );
        ScriptApp.deleteTrigger(trigger);

        // Delete associated property
        const propertyKey = TRIGGER_INTERVAL_PREFIX + triggerId;
        if (scriptProperties.getProperty(propertyKey)) {
          scriptProperties.deleteProperty(propertyKey);
          Logger.log(`Deleted associated script property: ${propertyKey}`);
        }
        deleted = true;
        break; // Assume only one trigger per handler
      }
    }
    if (!deleted) {
      Logger.log(`No trigger found for handler '${handlerName}'.`);
    }
  } catch (error: any) {
    Logger.log(`Error deleting trigger for handler '${handlerName}': ${error}`);
    // Depending on requirements, you might want to re-throw or handle differently
  }
  return deleted;
}

export {
  createTimeBasedTrigger,
  deleteAllTriggers,
  checkTriggerExists,
  deleteTriggerByHandler, // Export the new function
};
