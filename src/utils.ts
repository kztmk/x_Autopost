// utils.js (ユーティリティ関数)

const ERROR_SHEET_NAME = 'Errors';
const GAS_X_AUTO_POST = '[X Auto Post:エラー報告]';

/**
 * Postsシートを投稿時刻 (postSchedule) でソートする。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet ソートするシート
 */
export function sortPostsBySchedule(
  sheet: GoogleAppsScript.Spreadsheet.Sheet
): void {
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
      .sort({ column: 2, ascending: true });
  }
}

/**
 * 2つの日付が1分以内かどうかをチェックする。
 *
 * @param {Date} date1
 * @param {Date} date2
 * @return {boolean} 1分以内なら true, そうでなければ false
 */
export function isWithinOneMinute(now: Date, scheduleDate: Date): boolean {
  const diff = scheduleDate.getTime() - now.getTime();
  return diff > 0 && diff <= 60000; // 60000ミリ秒 = 1分
}

/**
 * エラーメールを送信する関数
 * @param {string} body メール本文
 * @param {string} subject メール件名
 */
export function sendErrorEmail(body: string, subject: string): void {
  const emailAddress = Session.getActiveUser()?.getEmail(); // 実行ユーザーのメールアドレスを取得
  if (!emailAddress) return; // メールアドレスが取得できない場合は終了

  MailApp.sendEmail({
    to: emailAddress,
    subject: `${GAS_X_AUTO_POST} ${subject}`,
    body: body,
  });
}

/**
 * エラーをスプレッドシートに記録する
 * @param {Error} error
 * @param {string} context
 */
export function logErrorToSheet(error: Error, context: string): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errorSheet =
    ss.getSheetByName(ERROR_SHEET_NAME) || ss.insertSheet(ERROR_SHEET_NAME);

  if (errorSheet.getLastRow() === 0) {
    errorSheet.appendRow([
      'Timestamp',
      'Context',
      'Error Message',
      'Stack Trace',
    ]);
  }

  errorSheet.appendRow([new Date(), context, error.message, error.stack]);
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
  let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
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
    `Request failed after multiple retries. Last response: ${response.getContentText()}`
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
    const resetTime = parseInt(headers['x-rate-limit-reset'] as string, 10);

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
