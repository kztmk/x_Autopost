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
        throw new Error("Invalid interval: must be an integer greater than or equal to 1.");
      }
  
      var handlerFunction = 'autoPostToX'; // トリガーで実行する関数名
      var deletedExistingCount = 0;
  
      // 既存の 'autoPostToX' ハンドラ関数を持つトリガーを削除
      var triggers = ScriptApp.getProjectTriggers();
      for (var _i = 0, triggers_1 = triggers; _i < triggers_1.length; _i++) {
          var trigger = triggers_1[_i];
          if (trigger.getHandlerFunction() === handlerFunction) {
              var existingTriggerId = trigger.getUniqueId();
              ScriptApp.deleteTrigger(trigger);
              deletedExistingCount++;
              Logger.log("Deleted existing trigger for ".concat(handlerFunction, ": ").concat(existingTriggerId));
          }
      }
       Logger.log("Deleted ".concat(String(deletedExistingCount), " existing trigger(s) for handler '").concat(handlerFunction, "'."));
  
      // 新しいトリガーを作成
      var newTrigger = ScriptApp.newTrigger(handlerFunction)
          .timeBased()
          .everyMinutes(intervalMinutes)
          .create();
      newTriggerId = newTrigger.getUniqueId();
      Logger.log("Created new time-based trigger ".concat(newTriggerId, " to run ").concat(handlerFunction, " every ").concat(intervalMinutes, " minutes."));
  
      // 成功レスポンス
      return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          message: "Time-based trigger created successfully for '".concat(handlerFunction, "' to run every ").concat(intervalMinutes, " minutes."),
          intervalMinutes: intervalMinutes,
          handlerFunction: handlerFunction,
          triggerId: newTriggerId,
          deletedExistingCount: deletedExistingCount
      })).setMimeType(ContentService.MimeType.JSON);
  
    } catch (error: any) {
      Logger.log("Error creating time-based trigger: ".concat(error));
      // エラーレスポンス
      return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: "Failed to create time-based trigger: ".concat(error.message),
          intervalMinutes: intervalMinutes, // エラー時も入力値を返す
          error: error.toString(),
          triggerId: newTriggerId // 作成試行中にIDが取れていれば返す (通常はnull)
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  /**
   * プロジェクトの全てのトリガーを削除する
   * @returns {GoogleAppsScript.Content.TextOutput} JSONレスポンス
   */
  function deleteAllTriggers() {
    var deletedCount = 0;
    var triggerDetails:{id: string, handler: string}[] = [];
     try {
      var triggers = ScriptApp.getProjectTriggers();
      deletedCount = triggers.length; // 削除対象の総数
  
      if (deletedCount === 0) {
          Logger.log('No project triggers found to delete.');
      } else {
          for (var _i = 0, triggers_2 = triggers; _i < triggers_2.length; _i++) {
              var trigger = triggers_2[_i];
              var triggerId = trigger.getUniqueId();
              var handler = trigger.getHandlerFunction();
              triggerDetails.push({ id: triggerId, handler: handler }); // 削除前に情報を記録
              ScriptApp.deleteTrigger(trigger);
              // Logger.log("Deleted trigger: ".concat(triggerId, " (Handler: ").concat(handler, ")")); // 個別ログは冗長かも
          }
          Logger.log("Successfully deleted ".concat(String(deletedCount), " project trigger(s)."));
      }
  
      // 成功レスポンス
      return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          message: "Successfully deleted ".concat(String(deletedCount), " project trigger(s)."),
          deletedCount: deletedCount,
          // deletedTriggers: triggerDetails // 削除したトリガーの詳細を含める場合
      })).setMimeType(ContentService.MimeType.JSON);
  
     } catch (error: any) {
      Logger.log("Error deleting all triggers: ".concat(error));
      // エラーレスポンス
       return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: "Failed to delete all triggers: ".concat(error.message),
          deletedCount: deletedCount, // エラーまでに削除できた数（不正確かも）
          error: error.toString()
      })).setMimeType(ContentService.MimeType.JSON);
     }
  }

export { createTimeBasedTrigger, deleteAllTriggers };