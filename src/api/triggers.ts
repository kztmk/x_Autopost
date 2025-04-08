/**
 * 時間ベースのトリガーを作成する。既存の 'autoPostToX' トリガーは削除される。
 * @param {number} intervalMinutes トリガーの間隔 (分)。1以上の整数。
 * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
 */
function createTimeBasedTrigger(postData) {
  const intervalMinutes = postData.intervalMinutes; // トリガーの間隔 (分)
  var newTriggerId: string | null = null;
  try {
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
      throw new Error(
        "Invalid interval: must be an integer greater than or equal to 1."
      );
    }

    var handlerFunction = "autoPostToX"; // トリガーで実行する関数名
    var deletedExistingCount = 0;

    // 既存の 'autoPostToX' ハンドラ関数を持つトリガーを削除
    var triggers = ScriptApp.getProjectTriggers();
    for (var _i = 0, triggers_1 = triggers; _i < triggers_1.length; _i++) {
      var trigger = triggers_1[_i];
      if (trigger.getHandlerFunction() === handlerFunction) {
        var existingTriggerId = trigger.getUniqueId();
        ScriptApp.deleteTrigger(trigger);
        deletedExistingCount++;
        Logger.log(
          "Deleted existing trigger for "
            .concat(handlerFunction, ": ")
            .concat(existingTriggerId)
        );
      }
    }
    Logger.log(
      "Deleted "
        .concat(
          String(deletedExistingCount),
          " existing trigger(s) for handler '"
        )
        .concat(handlerFunction, "'.")
    );

    // 新しいトリガーを作成
    var newTrigger = ScriptApp.newTrigger(handlerFunction)
      .timeBased()
      .everyMinutes(intervalMinutes)
      .create();
    newTriggerId = newTrigger.getUniqueId();
    Logger.log(
      "Created new time-based trigger "
        .concat(newTriggerId, " to run ")
        .concat(handlerFunction, " every ")
        .concat(intervalMinutes, " minutes.")
    );

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Time-based trigger created successfully for '"
          .concat(handlerFunction, "' to run every ")
          .concat(intervalMinutes, " minutes."),
        intervalMinutes: intervalMinutes,
        handlerFunction: handlerFunction,
        triggerId: newTriggerId,
        deletedExistingCount: deletedExistingCount,
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log("Error creating time-based trigger: ".concat(error));
    // エラーレスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: "Failed to create time-based trigger: ".concat(error.message),
        intervalMinutes: intervalMinutes, // エラー時も入力値を返す
        error: error.toString(),
        triggerId: newTriggerId, // 作成試行中にIDが取れていれば返す (通常はnull)
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * プロジェクトの全てのトリガーを削除する
 * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
 */
function deleteAllTriggers() {
  var deletedCount = 0;
  var triggerDetails: { id: string; handler: string }[] = [];
  try {
    var triggers = ScriptApp.getProjectTriggers();
    deletedCount = triggers.length; // 削除対象の総数

    if (deletedCount === 0) {
      Logger.log("No project triggers found to delete.");
    } else {
      for (var _i = 0, triggers_2 = triggers; _i < triggers_2.length; _i++) {
        var trigger = triggers_2[_i];
        var triggerId = trigger.getUniqueId();
        var handler = trigger.getHandlerFunction();
        triggerDetails.push({ id: triggerId, handler: handler }); // 削除前に情報を記録
        ScriptApp.deleteTrigger(trigger);
        // Logger.log("Deleted trigger: ".concat(triggerId, " (Handler: ").concat(handler, ")")); // 個別ログは冗長かも
      }
      Logger.log(
        "Successfully deleted ".concat(
          String(deletedCount),
          " project trigger(s)."
        )
      );
    }

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Successfully deleted ".concat(
          String(deletedCount),
          " project trigger(s)."
        ),
        deletedCount: deletedCount,
        // deletedTriggers: triggerDetails // 削除したトリガーの詳細を含める場合
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log("Error deleting all triggers: ".concat(error));
    // エラーレスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: "Failed to delete all triggers: ".concat(error.message),
        deletedCount: deletedCount, // エラーまでに削除できた数（不正確かも）
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 指定された関数名に紐づくプロジェクトトリガーが存在するかどうかを確認します。
 * @param {string} functionName 確認したい関数の名前 (例: 'autoPostToX')。
 * @return {boolean} 指定された関数を実行するトリガーが存在すれば true、なければ false。
 * @throws {Error} functionName が指定されていない場合。
 */
export function checkTriggerExists(functionName) {
  if (
    !functionName ||
    typeof functionName !== "string" ||
    functionName.trim() === ""
  ) {
    throw new Error("Missing or invalid required parameter: functionName.");
  }
  functionName = functionName.trim();
  let triggerFound = false;
  let intervalMinites = -1;
  try {
    let isTriggersExists = true;
    const triggers = ScriptApp.getProjectTriggers();
    if (triggers.length === 0) {
      Logger.log("No project triggers found.");
      isTriggersExists = false;
    }

    if (isTriggersExists) {
      Logger.log("Project triggers found.");

      for (const trigger of triggers) {
        if (trigger.getHandlerFunction() === functionName) {
          Logger.log(`Trigger found for function: ${functionName}`);
          // オプション: トリガーのタイプなども確認する場合
          // Logger.log(`Trigger type: ${trigger.getEventType()}, Source: ${trigger.getTriggerSource()}`);
          // 時間ベースのトリガーの場合、interval を取得する
          if (trigger.getEventType() === ScriptApp.EventType.CLOCK) {
            // @ts-ignore  trigger.getMinutes() が存在しないというエラーを回避
            const interval = trigger.getMinutes();
            Logger.log(`Trigger interval: ${interval} minutes`);
            return interval; // 指定された関数を実行するトリガーが見つかった
          }
          return true; // 指定された関数を実行するトリガーが見つかった
        }
      }
    }

    // ループで見つからなかった場合
    if (!triggerFound && isTriggersExists) {
      Logger.log(`No trigger found for function: ${functionName}`);
    }
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        functionName: functionName,
        triggerFound: triggerFound,
        message: triggerFound
          ? "Successfully found trigger".concat(functionName)
          : "No trigger found",
        intervalMinites: intervalMinites > -1 ? intervalMinites : -1, // 時間ベースのトリガーが見つかった場合のみ
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (e: any) {
    Logger.log(`Error checking triggers for function ${functionName}: ${e}`);
    // ScriptApp.getProjectTriggers() でエラーが発生することは稀だが念のたhrow new Error(`Failed to check triggers: ${e.message}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: `Failed to check triggers for function ${functionName}: ${e.message}`,
        error: e.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

export { createTimeBasedTrigger, deleteAllTriggers };
