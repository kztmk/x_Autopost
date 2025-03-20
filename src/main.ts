// main.js (メインロジック)
import {
  fetchWithRetries,
  isWithinOneMinute,
  logErrorToSheet,
  sendErrorEmail,
  sortPostsBySchedule,
} from './utils';

import { uploadMediaToX } from './media';
// X API v2のエンドポイント (必要に応じて変更)
const TWITTER_API_ENDPOINT = 'https://api.twitter.com/2/tweets';

/**
 * 1分ごとに実行されるトリガー関数。
 */
async function autoPostToX() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postsSheet = ss.getSheetByName('Posts');

  // Postsシートが存在しない場合はエラーを記録して終了
  try {
    if (!postsSheet) {
      throw new Error('The "Posts" sheet is missing!');
    }
  } catch (e: any) {
    const context = e.message || 'Error initializing sheets';
    logErrorToSheet(e, context);
    const errorMessage = `${context}: ${e.message}`;
    Logger.log(errorMessage);
    sendErrorEmail(errorMessage, 'Post Schedule Error'); // エラーメール送信
    return;
  }

  const postedSheet = ss.getSheetByName('Posted') || ss.insertSheet('Posted'); // Postedシートがない場合は作成
  const errorSheet = ss.getSheetByName('Errors') || ss.insertSheet('Errors'); // Errorsシートがない場合には作成

  // Postedシートがからの場合ヘッダーを作成
  if (postedSheet.getLastRow() === 0) {
    const postsHeader = postsSheet
      .getRange(1, 1, 1, postsSheet.getLastColumn())
      .getValues()[0];
    postedSheet.appendRow(postsHeader);
  }

  // Errorsシートがからの場合ヘッダーを作成
  if (errorSheet.getLastRow() === 0) {
    errorSheet.appendRow([
      'Timestamp',
      'Context',
      'Error Message',
      'Stack Trace',
    ]);
  }

  // Postsシートのデータを投稿時刻順にソート (B列で昇順ソート)
  sortPostsBySchedule(postsSheet);

  const now = new Date();

  // Postsシートのデータを取得 (ヘッダー行を除く)　と行番号をマッピング
  const postsData: any[][] = postsSheet.getDataRange().getValues().slice(1);
  const rowMapping: { [key: string]: number } = {};
  for (let i = 0; i < postsData.length; i++) {
    rowMapping[postsData[i][0] as string] = i + 2; // A列のIDをキー、行番号 (2始まり) を値とする
  }

  for (const postData of postsData) {
    const [
      id,
      postSchedule,
      postTo,
      content,
      mediaUrls,
      inReplyToInternal,
      postId,
      inReplyToOnX,
    ] = postData;
    const accountId = (postTo as string).toLowerCase(); // 小文字に変換
    let scheduleDate: Date;

    // 投稿データ処理の開始を記録 (冪等性のため)
    const cache = CacheService.getScriptCache();
    const processingKey = `processing-${id}`;

    // 処理中の投稿をチェック (冪等性) * 順番を入れ替え
    if (cache.get(processingKey)) {
      Logger.log(`Post ${id} is already being processed. Skipping.`);
      continue;
    }

    try {
      // 投稿スケジュールの変換とエラーハンドリング
      if (postSchedule instanceof Date) {
        scheduleDate = postSchedule;
      } else {
        scheduleDate = new Date(postSchedule as string);
        if (isNaN(scheduleDate.getTime())) {
          // 日付が無効な場合
          throw new Error(`Invalid date format: ${postSchedule}`);
        }
      }
    } catch (e: any) {
      const context = `Post Schedule Error (Post ID: ${id})`;
      logErrorToSheet(e, context);
      const errorMessage = `${context}: ${e.message}`;
      Logger.log(errorMessage);
      sendErrorEmail(errorMessage, 'Post Schedule Error'); // エラーメール送信
      continue; // 次の投稿処理へ * returnでも良い
    }

    // 投稿予定時刻が現在時刻から1分以内かチェック *順番を入れ替え
    if (scheduleDate && isWithinOneMinute(now, scheduleDate) && !postId) {
      cache.put(processingKey, 'true', 600); // 10分間有効 (処理完了時に削除) *ここ

      try {
        // メディアIDを取得 (メディアがある場合)
        const mediaIds = mediaUrls
          ? await uploadMediaToX(mediaUrls as string, accountId)
          : [];

        // リプライ先の投稿IDを取得 (inReplyToInternal がある場合)
        const replyToPostId = inReplyToInternal
          ? getReplyToPostId(postedSheet, inReplyToInternal as string)
          : null; // Postedシートから検索

        // X に投稿
        const response = await postTweet(
          content as string,
          mediaIds,
          replyToPostId,
          accountId
        );

        // 投稿IDを保存、Postedシートへ移動
        if (response && response.data && response.data.id) {
          // 行番号をマッピングから取得
          const rowNumber = rowMapping[id as string];

          if (rowNumber) {
            const postedRow = postsSheet.getRange(
              rowNumber,
              1,
              1,
              postsSheet.getLastColumn()
            );

            // postID と inReplyToOnX を更新
            postedRow.getCell(1, 7).setValue(response.data.id);
            if (replyToPostId) {
              postedRow.getCell(1, 8).setValue(replyToPostId);
            }
            // Posted シートに移動
            postedSheet.appendRow(postedRow.getValues()[0]);
            postsSheet.deleteRow(rowNumber); // deleteRow を使用

            Logger.log(`Post successful! Post ID: ${response.data.id}`);
          } else {
            Logger.log(`Error: Could not find row number for post ID ${id}`); // 行番号が見つからない場合
          }
        } else {
          const errorMessage = `Post failed. Response: ${JSON.stringify(
            response
          )}`;
          Logger.log(errorMessage);
          sendErrorEmail(errorMessage, 'X Post Failed');
        }
      } catch (error: any) {
        const context = `X Post Error (Post ID: ${id})`;
        logErrorToSheet(error, context);
        const errorMessage = `${context}: ${error} \n\nStack Trace:\n ${error.stack}`;
        Logger.log(errorMessage);
        sendErrorEmail(errorMessage, 'X Post Error');
      } finally {
        cache.remove(processingKey); // 処理中フラグを削除 (エラー時も含む)
      }
    }
  }

  // Postedシートを投稿時刻順にソート (B列で昇順ソート)
  sortPostsBySchedule(postedSheet);
}

/**
 * Xにツイートを投稿する。
 * @param {string} content 投稿内容
 * @param {string[]} mediaIds メディアIDの配列 (オプション)
 * @param {string} replyToPostId リプライ先の投稿ID (オプション)
 * @param {string} accountId アカウントID
 * @return {Promise<object>} X APIからのレスポンス
 */
async function postTweet(
  content: string,
  mediaIds: string[],
  replyToPostId: string | null,
  accountId: string
): Promise<any> {
  const payload: any = {
    text: content,
  };

  if (mediaIds && mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds };
  }

  if (replyToPostId) {
    payload.reply = { in_reply_to_tweet_id: replyToPostId }; // リプライ形式を修正
  }

  const authConfig = getAuthConfig(accountId); // accountId を渡す
  if (!authConfig) {
    throw new Error(
      `No authentication information found for account: ${accountId}`
    );
  }
  const bearerToken = authConfig[`${accountId.toLowerCase()}_bearerToken`];

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // エラーレスポンスも取得
  };

  const response = fetchWithRetries(TWITTER_API_ENDPOINT, options);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(
      `Tweet post failed. Status code: ${response.getResponseCode()}, Response: ${response.getContentText()}`
    );
  }
  return JSON.parse(response.getContentText());
}

/**
 * Posts/Postedシートからリプライ先の投稿ID (postId) を取得する。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet シートオブジェクト
 * @param {string} inReplyToInternal リプライ先の投稿のID (A列の値)
 * @return {string} リプライ先の投稿ID (G列の値、見つからない場合は null)
 */
function getReplyToPostId(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  inReplyToInternal: string
): string | null {
  const data: any[][] = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === inReplyToInternal) {
      // A列 (id) を比較
      return data[i][6] as string; // G列 (postId) を返す
    }
  }
  return null; // 見つからない場合
}

/**
 * 時間ベースのトリガーを作成する。
 * @param {number} intervalMinutes トリガーの間隔 (分)
 */
export function createTimeBasedTrigger(intervalMinutes: number): void {
  // 既存のトリガーを削除 (必要に応じて)
  deleteAllTriggers();

  // 新しいトリガーを作成
  ScriptApp.newTrigger('autoPostToX')
    .timeBased()
    .everyMinutes(intervalMinutes)
    .create();

  Logger.log(
    `Created time-based trigger to run autoPostToX every ${intervalMinutes} minutes.`
  );
}

/**
 * すべてのトリガーを削除する
 */
export function deleteAllTriggers(): void {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  Logger.log('Deleted all project triggers');
}
