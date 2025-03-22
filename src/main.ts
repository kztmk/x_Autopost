// main.js (メインロジック)
import {
  isWithinOneMinute,
  logErrorToSheet,
  sendErrorEmail,
  sortPostsBySchedule,
} from './utils';

import { uploadMediaToX } from './media';

import {
  generateSignature,
  generateSignatureBaseString,
  getAccountProperties,
} from './auth';

import * as api from './api';
import * as auth from './auth';
import * as media from './media';
import * as testApi from './test/testApi';
import * as utils from './utils';

// 各モジュールのエクスポートをグローバルに割り当てる
Object.assign(globalThis, api, auth, media, testApi, utils);

// X API v2のエンドポイント (必要に応じて変更)
const TWITTER_API_ENDPOINT = 'https://api.twitter.com/2/tweets';

const POSTS_SHEET_NAME = 'Posts';
const POSTED_SHEET_NAME = 'Posted';
const ERRORS_SHEET_NAME = 'Errors';

/**
 * 1分ごとに実行されるトリガー関数。
 */
async function autoPostToX() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);

  // Postsシートが存在しない場合はエラーを記録して終了
  try {
    if (!postsSheet) {
      throw new Error(`The "${POSTS_SHEET_NAME}" sheet is missing!`);
    }
  } catch (e: any) {
    const context = e.message || 'Error initializing sheets';
    logErrorToSheet(e, context);
    const errorMessage = `${context}: ${e.message}`;
    Logger.log(errorMessage);
    sendErrorEmail(errorMessage, 'Post Schedule Error'); // エラーメール送信
    return;
  }

  const postedSheet =
    ss.getSheetByName(POSTED_SHEET_NAME) || ss.insertSheet(POSTED_SHEET_NAME); // Postedシートがない場合は作成
  const errorSheet =
    ss.getSheetByName(ERRORS_SHEET_NAME) || ss.insertSheet(ERRORS_SHEET_NAME); // Errorsシートがない場合には作成

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
        let replyToPostId = inReplyToInternal
          ? getReplyToPostId(postedSheet, inReplyToInternal as string)
          : null; // Postedシートから検索

        // Postedシートにない場合には Posts シートから検索
        if (!replyToPostId && inReplyToInternal) {
          replyToPostId = getReplyToPostId(
            postsSheet,
            inReplyToInternal as string
          );
        }

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
  const { apiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret } =
    getAccountProperties(accountId);

  if (!apiKey || !apiKeySecret || !apiAccessToken || !apiAccessTokenSecret) {
    throw new Error('APIキーまたはアクセストークンが設定されていません');
  }

  // 1. OAuthパラメーターの設定（ツイート投稿API V2）
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_token: apiAccessToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: Utilities.base64Encode(
      // @ts-ignore
      Utilities.getSecureRandomBytes(32)
    ).replace(/\W/g, ''), // ランダムなnonce値 (Base64エンコード)
    oauth_version: '1.0',
  };

  // 2. リクエストボディ（ポスト API V２用）
  const requestBody: any = {
    text: Text,
    media: { media_ids: mediaIds },
  };

  // 3. 署名キーの生成
  const signingKey = `${encodeURIComponent(apiKeySecret)}&${encodeURIComponent(
    apiAccessTokenSecret
  )}`;

  // 4. 署名ベース文字列の生成 (ツイート投稿URLとOAuthパラメータを使用)
  const signatureBaseString = generateSignatureBaseString(
    'POST',
    TWITTER_API_ENDPOINT,
    oauthParams
  ); // ツイート投稿URL, OAuth params のみ署名対象 (request body は署名対象外)
  const oauthSignature = generateSignature(signatureBaseString, signingKey); // 署名を生成

  // 5. OAuth認証ヘッダーの生成
  // @ts-ignore
  const authHeader = `OAuth ${Object.entries({
    ...oauthParams,
    oauth_signature: oauthSignature,
  })
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(', ')}`;

  // 6. UrlFetchApp でツイート投稿 API v2 を実行
  const options = {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json', // ツイート投稿 API v2 は application/json
    },
    payload: JSON.stringify(requestBody), // リクエストボディをJSON文字列に変換
  };

  try {
    // @ts-ignore
    const response = UrlFetchApp.fetch(tweetUrl, options); // APIリクエストを実行
    const responseJson = JSON.parse(response.getContentText()); // レスポンスをJSONオブジェクトに変換
    Logger.log(`ツイートが投稿されました:${responseJson.data.id}`); // ログ出力
    return responseJson; // レスポンスを返す
  } catch (error) {
    Logger.log('ツイート投稿エラー:', error); // エラーログ出力
  }
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
