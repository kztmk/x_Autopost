import { VERSION } from "../constants";
import { deleteTriggerByHandler, deleteAllTriggers } from "../utils";

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
    deleteTriggerByHandler(handlerFunction);

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
    return {
      status: "success",
      message: `Time-based trigger created successfully for '${handlerFunction}' to run every ${intervalMinutes} minutes.`,
      data: {
        intervalMinutes: intervalMinutes,
        functionName: handlerFunction,
        triggerId: newTriggerId,
        triggerFount: true,
      },
    };
  } catch (error: any) {
    Logger.log(`Error creating time-based trigger: ${error}`);
    // エラーレスポンス
    // Note: もしトリガー作成後にプロパティ保存で失敗した場合、トリガーは残る可能性がある
    return {
      status: "error",
      message: `Failed to create time-based trigger: ${error.message}`,
      intervalMinutes: intervalMinutes, // エラー時も入力値を返す
      error: error.toString(),
      triggerId: newTriggerId, // 作成試行中にIDが取れていれば返す (通常はnull)
    };
  }
}

/**
 * Deletes all triggers and their associated properties.
 * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
 */
function deleteAllTriggersWrapper() {
  try {
    const deletedCount = deleteAllTriggers();
    Logger.log(`Successfully deleted ${deletedCount} triggers.`);
    return {
      status: "success",
      message: `Successfully deleted ${deletedCount} triggers.`,
    };
  } catch (error: any) {
    Logger.log(`Error deleting all triggers: ${error}`);
    return {
      status: "error",
      message: `Failed to delete all triggers: ${error.message}`,
    };
  }
}

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
        version: VERSION,
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

export {
  createTimeBasedTrigger,
  deleteAllTriggersWrapper as deleteAllTriggers,
  checkTriggerExists,
  deleteTriggerByHandler, // Export the new function
};
