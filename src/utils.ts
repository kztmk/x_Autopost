// utils.ts (ユーティリティ関数)

// const ERROR_SHEET_NAME = "Errors"; // Use SHEETS.ERRORS instead
const GAS_X_AUTO_POST = "[X Auto Post:エラー報告]";

import { SHEETS, HEADERS, PostError } from "./types"; // Import from types.d.ts and include HEADERS, PostError

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
    data.forEach((row, index) =>
      Logger.log(
        `  Row ${index + 2}: ${
          row[postScheduleIndex] instanceof Date
            ? row[postScheduleIndex].toISOString() // Log date as ISO string
            : row[postScheduleIndex] // Log non-date as is
        }`
      )
    );
    // --- End of logging ---
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

/**
 * Generates a random nonce for OAuth requests.
 * @returns {string} A random string.
 */
function generateNonce(): string {
  return Utilities.base64Encode(
    Math.random().toString(36).substring(2) + Date.now().toString(36)
  ).replace(/[^a-zA-Z0-9]/g, ""); // Ensure alphanumeric
}

/**
 * Generates basic OAuth parameters.
 * @param {string} consumerKey The consumer key.
 * @returns {object} An object containing basic OAuth parameters.
 */
export function generateOAuthParams(consumerKey: string): {
  [key: string]: string;
} {
  return {
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
}

/**
 * Generates the signing key for OAuth 1.0a.
 * @param {string} consumerSecret The consumer secret.
 * @param {string} tokenSecret The access token secret.
 * @returns {string} The signing key.
 */
export function generateSigningKey(
  consumerSecret: string,
  tokenSecret: string
): string {
  return (
    encodeURIComponent(consumerSecret) + "&" + encodeURIComponent(tokenSecret)
  );
}

/**
 * Percent encodes a string according to RFC 3986.
 * @param {string} str The string to encode.
 * @returns {string} The encoded string.
 */
function rfc3986Encode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27");
}

/**
 * Normalizes request parameters for the OAuth signature base string.
 * @param {object} params The parameters to normalize.
 * @returns {string} The normalized parameter string.
 */
function normalizeParams(params: { [key: string]: string }): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${rfc3986Encode(key)}=${rfc3986Encode(params[key])}`)
    .join("&");
}

/**
 * Generates the signature base string for OAuth 1.0a.
 * @param {string} httpMethod The HTTP method (e.g., 'POST', 'GET').
 * @param {string} baseUrl The base URL of the request.
 * @param {object} oauthParams The OAuth parameters.
 * @param {object} requestParams Additional request parameters (query or body).
 * @returns {string} The signature base string.
 */
export function generateSignatureBaseString(
  httpMethod: string,
  baseUrl: string,
  oauthParams: { [key: string]: string },
  requestParams: { [key: string]: string } = {}
): string {
  const allParams = { ...oauthParams, ...requestParams };
  const normalized = normalizeParams(allParams);
  return `${httpMethod.toUpperCase()}&${rfc3986Encode(baseUrl)}&${rfc3986Encode(
    normalized
  )}`;
}

/**
 * Generates the HMAC-SHA1 signature for OAuth 1.0a.
 * @param {string} baseString The signature base string.
 * @param {string} signingKey The signing key.
 * @returns {string} The Base64 encoded signature.
 */
export function generateSignature(
  baseString: string,
  signingKey: string
): string {
  const signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    baseString,
    signingKey
  );
  return Utilities.base64Encode(signatureBytes);
}

/**
 * Generates the OAuth Authorization header string.
 * @param {object} oauthParams The OAuth parameters including the signature.
 * @returns {string} The Authorization header value.
 */
export function generateOAuthHeader(oauthParams: {
  [key: string]: string;
}): string {
  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map(
        (key) => `${rfc3986Encode(key)}="${rfc3986Encode(oauthParams[key])}"`
      )
      .join(", ")
  );
}

// --- Trigger Management ---

/**
 * Deletes all project triggers associated with a specific handler function.
 * @param {string} functionName The name of the handler function whose triggers should be deleted.
 */
export function deleteTriggerByHandler(functionName: string): void {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let deletedCount = 0;
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === functionName) {
        const triggerId = trigger.getUniqueId();
        try {
          ScriptApp.deleteTrigger(trigger);
          Logger.log(
            `Deleted trigger with ID: ${triggerId} for handler: ${functionName}`
          );
          deletedCount++;
        } catch (deleteError: any) {
          Logger.log(
            `Failed to delete trigger ${triggerId} for handler ${functionName}: ${deleteError}`
          );
          // Optionally log to error sheet
          // logErrorToSheet(deleteError, `Failed to delete trigger ${triggerId}`);
        }
      }
    }
    if (deletedCount === 0) {
      Logger.log(`No triggers found for handler function: ${functionName}`);
    }
  } catch (e: any) {
    Logger.log(
      `Error accessing or deleting triggers for handler ${functionName}: ${e}`
    );
    // Optionally log to error sheet
    // logErrorToSheet(e, `Error in deleteTriggerByHandler for ${functionName}`);
  }
}
