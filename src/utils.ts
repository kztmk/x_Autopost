// utils.ts (ユーティリティ関数)

// const ERROR_SHEET_NAME = "Errors"; // Use SHEETS.ERRORS instead
const GAS_X_AUTO_POST = "[X Auto Post:エラー報告]";
import { SHEETS, HEADERS } from "./constants"; // Import SHEETS from constants.ts
import { PostError } from "./types"; // Import from types.d.ts and include HEADERS, PostError

// Ensure constants are defined
const scriptProperties = PropertiesService.getScriptProperties();
const TRIGGER_INTERVAL_PREFIX = "triggerInterval_";

/**
 * Tests the sortPostsBySchedule function on the "Posts" sheet.
 */
function testSortPostsSheet(): void {
  Logger.log("--- Starting testSortPostsSheet ---");

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const postsSheet = ss.getSheetByName(SHEETS.POSTS);

    if (!postsSheet) {
      Logger.log(`Error: Sheet "${SHEETS.POSTS}" not found.`);
      Logger.log("--- Finished testSortPostsSheet (with error) ---");
      return;
    }

    Logger.log(`Found sheet: "${postsSheet.getName()}"`);

    // Optional: Log data before sorting
    if (postsSheet.getLastRow() > 1) {
      const dataBefore = postsSheet
        .getRange(2, 1, postsSheet.getLastRow() - 1, postsSheet.getLastColumn())
        .getDisplayValues(); // Use getDisplayValues for easier logging
      Logger.log("Data BEFORE sorting:");
      dataBefore.forEach((row, index) =>
        Logger.log(`Row ${index + 2}: ${row.join(", ")}`)
      );
    } else {
      Logger.log("Sheet has no data rows to sort.");
    }

    // Call the function to sort
    Logger.log("Calling sortPostsBySchedule...");
    sortPostsBySchedule(postsSheet);
    Logger.log("sortPostsBySchedule finished.");

    // Optional: Log data after sorting
    if (postsSheet.getLastRow() > 1) {
      SpreadsheetApp.flush(); // Ensure changes are written before reading again
      const dataAfter = postsSheet
        .getRange(2, 1, postsSheet.getLastRow() - 1, postsSheet.getLastColumn())
        .getDisplayValues(); // Use getDisplayValues for easier logging
      Logger.log("Data AFTER sorting:");
      dataAfter.forEach((row, index) =>
        Logger.log(`Row ${index + 2}: ${row.join(", ")}`)
      );
    }
  } catch (error: any) {
    Logger.log(`An error occurred during the test: ${error.message}`);
    Logger.log(`Stack: ${error.stack}`);
  }

  Logger.log("--- Finished testSortPostsSheet ---");
}

/**
 * Postsシートを投稿時刻 (postSchedule) でソートする。
 * 有効な日付を持つ行を先に、日付順にソートし、日付を持たない行を後に配置する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet ソートするシート
 */
export function sortPostsBySchedule(
  sheet: GoogleAppsScript.Spreadsheet.Sheet | null | undefined
): void {
  if (!sheet) {
    Logger.log(
      "Error in sortPostsBySchedule: Received an invalid sheet object (null or undefined)."
    );
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    // No data rows or only header
    return;
  }

  // Get headers to find the 'postSchedule' column index using HEADERS constant
  // const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]; // No longer needed if using HEADERS
  const postScheduleIndex = HEADERS.POST_HEADERS.indexOf("postSchedule");

  if (postScheduleIndex === -1) {
    Logger.log(
      "Error in sortPostsBySchedule: 'postSchedule' column index not found in HEADERS.POST_HEADERS."
    );
    return;
  }

  // Get data range (excluding header)
  const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const data = dataRange.getValues();

  // Sort the entire data array directly using Infinity for non-dates
  data.sort((a, b) => {
    let dateA: Date | null = null;
    let dateB: Date | null = null;
    const valA = a[postScheduleIndex];
    const valB = b[postScheduleIndex];

    // Attempt to get valid Date object for A
    if (valA instanceof Date && !isNaN(valA.getTime())) {
      dateA = valA;
    } else if (typeof valA === "string" && valA.trim() !== "") {
      const parsedA = new Date(valA);
      if (!isNaN(parsedA.getTime())) {
        dateA = parsedA;
      }
    }

    // Attempt to get valid Date object for B
    if (valB instanceof Date && !isNaN(valB.getTime())) {
      dateB = valB;
    } else if (typeof valB === "string" && valB.trim() !== "") {
      const parsedB = new Date(valB);
      if (!isNaN(parsedB.getTime())) {
        dateB = parsedB;
      }
    }

    // Assign timestamp or Infinity based on validity
    const timeA = dateA ? dateA.getTime() : Infinity;
    const timeB = dateB ? dateB.getTime() : Infinity;

    const comparisonResult = timeA - timeB;

    // --- Detailed Comparison Logging (Keep for verification) ---
    Logger.log(
      `[Sort Compare] valA: ${valA} (ParsedDate: ${
        dateA?.toISOString() || "Invalid"
      }, Time: ${timeA}) | valB: ${valB} (ParsedDate: ${
        dateB?.toISOString() || "Invalid"
      }, Time: ${timeB}) | Result: ${comparisonResult}`
    );

    // Handle cases where both are non-dates (Infinity)
    if (timeA === Infinity && timeB === Infinity) {
      return 0; // Maintain relative order of non-dates
    }

    // Compare the times (finite numbers will always be less than Infinity)
    return timeA - timeB;
  });

  // Write back the sorted data
  if (data.length > 0) {
    // --- Logging before setValues (Keep for verification) ---
    data.forEach((row, index) => {
      Logger.log(
        `  Row ${index + 2}: ${
          row[postScheduleIndex] instanceof Date
            ? row[postScheduleIndex].toISOString() // Log date as ISO string
            : row[postScheduleIndex] // Log non-date as is
        }`
      );
    }); // End of data.forEach loop

    // --- End of logging ---
    // Corrected: Moved setValues outside the forEach loop
    dataRange.setValues(data);
  }
  Logger.log(`[sortPostsBySchedule] Sorted ${data.length} rows.`);
}

/**
 * エラーをスプレッドシートに記録する
 * @param {PostError} errorInfo - エラー情報オブジェクト
 * @param {string} context - エラーが発生したコンテキスト
 */
export function logErrorToSheet(errorInfo: PostError, context: string): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Use SHEETS.ERRORS constant
  const errorSheet =
    ss.getSheetByName(SHEETS.ERRORS) || ss.insertSheet(SHEETS.ERRORS);

  if (errorSheet.getLastRow() === 0) {
    // Use HEADERS.ERROR_HEADERS for consistency
    errorSheet.appendRow([...HEADERS.ERROR_HEADERS]);
  }

  // Map errorInfo properties based on HEADERS.ERROR_HEADERS order
  const errorRow = HEADERS.ERROR_HEADERS.map(
    (header) => errorInfo[header as keyof PostError] ?? ""
  );
  // Ensure context is included if it's part of the header, or adjust logic
  // Assuming 'context' is a header in HEADERS.ERROR_HEADERS
  const contextIndex = HEADERS.ERROR_HEADERS.indexOf("context");
  if (contextIndex !== -1) {
    errorRow[contextIndex] = context; // Overwrite context from errorInfo if needed, or add if separate
  }
  // Ensure timestamp is included
  const timestampIndex = HEADERS.ERROR_HEADERS.indexOf("timestamp");
  if (timestampIndex !== -1 && !errorInfo.timestamp) {
    errorRow[timestampIndex] = new Date().toISOString(); // Add current timestamp if missing
  }

  errorSheet.appendRow(errorRow);
}

/**
 *  リトライ可能なHTTPリクエスト
 * @param {string} url
 * @param {GoogleAppsScript.URL_Fetch.URLFetchRequestOptions} options
 * @param {number} retries
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
export function fetchWithRetries(
  url: string,
  options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions,
  retries: number = 3
): GoogleAppsScript.URL_Fetch.HTTPResponse {
  let response: GoogleAppsScript.URL_Fetch.HTTPResponse | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);

      if (response.getResponseCode() !== 429) {
        return response; // 成功 or 429 以外なら即時 return
      }

      // 429 (Rate Limit) の場合
      if (handleRateLimiting(response)) {
        continue; // sleep 後にリトライ
      }
    } catch (e: any) {
      // ネットワークエラーなど、リトライ可能な場合
      if (attempt < retries - 1) {
        Logger.log(`Attempt ${attempt + 1} failed: ${e}. Retrying...`);
        Utilities.sleep(2000 * (attempt + 1)); // 指数バックオフ (2, 4, 8 秒)
        continue;
      } else {
        // リトライ回数を超えたらエラーをスロー
        throw e;
      }
    }
  }
  // すべてのリトライが失敗
  throw new Error(
    `Request failed after multiple retries. Last response: ${response?.getContentText()}`
  );
}

/**
 * レート制限処理
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} response
 * @returns {boolean} リトライすべきかどうか
 */
function handleRateLimiting(
  response: GoogleAppsScript.URL_Fetch.HTTPResponse
): boolean {
  if (response.getResponseCode() === 429) {
    const headers = response.getHeaders();
    const resetTime = parseInt(headers["x-rate-limit-reset"] as string, 10);

    if (!isNaN(resetTime)) {
      // 待機時間 = リセット時間 - 現在時間 + 5秒 (余裕を持つ)
      const waitTime = Math.max(
        (resetTime - Math.floor(Date.now() / 1000)) * 1000 + 5000,
        0
      ); // 負数にならないように
      Logger.log(`Rate limited. Waiting for ${waitTime / 1000} seconds`);
      Utilities.sleep(waitTime); // スリープ
      return true; // リトライ
    } else {
      Logger.log(
        `Rate limited, but could not determine reset time. Headers: ${JSON.stringify(
          headers
        )}`
      );
      return false; // リトライしない (手動で確認)
    }
  }
  return false;
}

/**
 * Masks a sensitive string, showing only the first 3 characters.
 * If the string is shorter than 3 characters, it returns asterisks.
 * @param {string | null | undefined} value The string to mask.
 * @returns {string} The masked string.
 */
export function maskSensitive(value: string | null | undefined): string {
  if (!value || value.length <= 3) {
    return "***";
  }
  return value.substring(0, 3) + "*".repeat(value.length - 3);
}

// --- Trigger Management ---

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
  }
  return deleted;
}

/**
 * Deletes all triggers and their associated properties.
 * @returns {number} The number of triggers deleted.
 */
function deleteAllTriggers(): number {
  let deletedCount = 0;
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      const triggerId = trigger.getUniqueId();
      const handler = trigger.getHandlerFunction();
      Logger.log(`Deleting trigger: ${triggerId} (Handler: ${handler})`);
      ScriptApp.deleteTrigger(trigger);

      // Delete associated property
      const propertyKey = TRIGGER_INTERVAL_PREFIX + triggerId;
      if (scriptProperties.getProperty(propertyKey)) {
        scriptProperties.deleteProperty(propertyKey);
        Logger.log(`Deleted associated script property: ${propertyKey}`);
      }
      deletedCount++;
    }
    Logger.log(`Successfully deleted ${deletedCount} trigger(s).`);
  } catch (error: any) {
    Logger.log(`Error deleting all triggers: ${error}`);
  }
  return deletedCount;
}

export { deleteTriggerByHandler, deleteAllTriggers };
