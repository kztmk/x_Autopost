// main.js (メインロジック)
import { logErrorToSheet, sortPostsBySchedule } from "./utils";

import { uploadMediaToX } from "./media";
import { deleteTriggerByHandler } from "./api/triggers";

import {
  generateSignature,
  generateSignatureBaseString,
  getXAuthById,
} from "./auth";

import * as api from "./apiv2";
import * as auth from "./auth";
import * as media from "./media";
import * as utils from "./utils";

// 共通関数と定数をインポート
import { getOrCreateSheetWithHeaders, SHEETS, HEADERS } from "./api/postData";

// 各モジュールのエクスポートをグローバルに割り当てる
Object.assign(globalThis, api, auth, media, utils);

// X API v2のエンドポイント (必要に応じて変更)
const TWITTER_API_ENDPOINT = "https://api.twitter.com/2/tweets";

// main.ts固有のヘッダー定義（必要な場合のみ）
const MAIN_HEADERS = {
  // Postedシート用のヘッダー列（postedAt列を追加）
  POSTED_HEADERS: [
    "id",
    "createdAt",
    "postTo",
    "contents",
    "media",
    "postSchedule",
    "inReplytoInternal",
    "postId",
    "inReplyToOnX",
    "postedAt",
  ],
};

// --- PropertiesService と定数 (関数の外、または共通ライブラリで定義) ---
const scriptProperties = PropertiesService.getScriptProperties();
const TRIGGER_INTERVAL_PREFIX = "triggerInterval_"; // トリガー作成/削除時と合わせる
const DEFAULT_TRIGGER_INTERVAL = 5; // プロパティが見つからない場合のデフォルト間隔 (分)
const HANDLER_FUNCTION_NAME = "autoPostToX"; // 対象のハンドラ関数名

/**
 * 現在実行中の指定されたハンドラ関数のトリガーの間隔（分）を PropertiesService から取得します。
 * 見つからない場合や値が無効な場合はデフォルト値を返します。
 * @param {string} functionName トリガーのハンドラ関数名
 * @returns {number} トリガーの実行間隔 (分)
 */
function getTriggerIntervalMinutes(functionName: string): number {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === functionName) {
        const triggerId = trigger.getUniqueId();
        const propertyKey = TRIGGER_INTERVAL_PREFIX + triggerId;
        const intervalString = scriptProperties.getProperty(propertyKey);
        if (intervalString) {
          const interval = parseInt(intervalString, 10);
          if (!isNaN(interval) && interval > 0) {
            Logger.log(
              `Found trigger interval for ${functionName} (ID: ${triggerId}): ${interval} minutes from properties.`
            );
            return interval;
          } else {
            Logger.log(
              `Invalid interval value found in properties for key ${propertyKey}: '${intervalString}'. Using default.`
            );
          }
        } else {
          // プロパティが存在しない場合（手動設定など）
          Logger.log(
            `Property key ${propertyKey} not found for trigger ${triggerId} handling ${functionName}. Using default interval.`
          );
        }
        // 最初に見つかった該当ハンドラのトリガーを採用 (通常は1つのはず)
        break;
      }
    }
    // ループで見つからなかった場合（＝指定関数を実行するトリガーがない）
    Logger.log(
      `No active trigger found for handler function '${functionName}'. Using default interval.`
    );
  } catch (e: any) {
    Logger.log(
      `Error getting trigger interval for ${functionName}: ${e}. Using default interval.`
    );
  }
  // デフォルト値を返す
  Logger.log(
    `Using default trigger interval: ${DEFAULT_TRIGGER_INTERVAL} minutes for ${functionName}.`
  );
  return DEFAULT_TRIGGER_INTERVAL;
}

// --- 修正後の autoPostToX 関数 ---
async function autoPostToX() {
  let postMadeInThisRun = false; // Flag to track if a post was made
  let hasScheduledPosts = false; // Flag to track if there are scheduled posts
  try {
    // --- シート取得 (変更なし) ---
    const postsSheet = getOrCreateSheetWithHeaders(
      SHEETS.POSTS,
      HEADERS.POST_HEADERS
    );
    const postedSheet = getOrCreateSheetWithHeaders(
      SHEETS.POSTED,
      MAIN_HEADERS.POSTED_HEADERS
    );
    // const errorSheet = getOrCreateSheetWithHeaders(SHEETS.ERRORS, HEADERS.ERROR_HEADERS); // logErrorToSheet 内で処理

    // --- Postsシートのソート (変更なし) ---
    sortPostsBySchedule(postsSheet);

    const now = new Date();
    const nowTime = now.getTime();

    // --- トリガー間隔と投稿閾値時刻の計算 ---
    const triggerIntervalMinutes = getTriggerIntervalMinutes(
      HANDLER_FUNCTION_NAME
    );
    const thresholdMinutes = triggerIntervalMinutes + 1; // トリガー間隔 + 1分
    const thresholdTime = nowTime + thresholdMinutes * 60 * 1000; // 投稿対象とする未来の時刻上限
    Logger.log(
      `Current time: ${now.toISOString()}, Trigger Interval: ${triggerIntervalMinutes} min, Posting Threshold: Now + ${thresholdMinutes} min (${new Date(
        thresholdTime
      ).toISOString()})`
    );

    // --- Postsシートのデータ取得と行マッピング (変更なし) ---
    const postsData: any[][] = postsSheet.getDataRange().getValues().slice(1);
    const rowMapping: { [key: string]: number } = {};
    postsData.forEach((row, index) => {
      if (row && row[0]) {
        // IDが存在することを確認
        rowMapping[row[0] as string] = index + 2; // A列のIDをキー、行番号 (2始まり) を値とする
      }
    });

    // Postsシートのヘッダーインデックスを取得 (列の順序に依存しないように)
    const postsHeaderMap = HEADERS.POST_HEADERS.reduce((map, header, index) => {
      map[header] = index;
      return map;
    }, {} as { [key: string]: number });
    const idIndex = postsHeaderMap[HEADERS.POST_HEADERS[0]]; // Assuming ID is the first header
    const createdAtIndex = postsHeaderMap[HEADERS.POST_HEADERS[1]]; // CreatedAt
    const postToIndex = postsHeaderMap[HEADERS.POST_HEADERS[2]];
    const contentIndex = postsHeaderMap[HEADERS.POST_HEADERS[3]];
    const mediaUrlsIndex = postsHeaderMap[HEADERS.POST_HEADERS[4]];
    const scheduleIndex = postsHeaderMap[HEADERS.POST_HEADERS[5]];
    const inReplyToInternalIndex = postsHeaderMap[HEADERS.POST_HEADERS[6]];
    const postIdIndex = postsHeaderMap[HEADERS.POST_HEADERS[7]]; // 投稿済みIDの列
    // const inReplyToOnXIndex = postsHeaderMap[HEADERS.POST_HEADERS[8]]; // Postsシートには基本的に無い想定だが念のため

    for (const postData of postsData) {
      // --- 各投稿データの取得 (インデックス使用) ---
      const id = postData[idIndex] as string;
      const postScheduleValue = postData[scheduleIndex];
      const postTo = postData[postToIndex] as string;
      const content = postData[contentIndex] as string;
      const mediaUrls = postData[mediaUrlsIndex] as string;
      const inReplyToInternal = postData[inReplyToInternalIndex] as string;
      const postId = postData[postIdIndex] as string; // 投稿済みかどうかのチェック用
      // const inReplyToOnX = postData[inReplyToOnXIndex]; // これはPostedシートで管理

      // --- IDがないデータはスキップ ---
      if (!id) {
        Logger.log(`Skipping row with missing ID.`);
        continue;
      }

      const accountId = postTo ? postTo.toLowerCase() : ""; // アカウントID（小文字）
      let scheduleDate: Date | null = null;

      // --- 冪等性のためのキャッシュチェック (変更なし) ---
      const cache = CacheService.getScriptCache();
      const processingKey = `processing-${id}`;
      if (cache.get(processingKey)) {
        Logger.log(`Post ${id} is already being processed. Skipping.`);
        continue;
      }

      // --- 1. 投稿済みチェック ---
      if (postId) {
        // Logger.log(`Post ${id} already posted (ID: ${postId}). Skipping.`); // 通常はログ不要
        continue;
      }

      // --- 2. 有効な投稿予定時刻かチェック ---
      try {
        if (
          postScheduleValue instanceof Date &&
          !isNaN(postScheduleValue.getTime())
        ) {
          scheduleDate = postScheduleValue;
        } else if (
          typeof postScheduleValue === "string" &&
          postScheduleValue.trim() !== ""
        ) {
          scheduleDate = new Date(postScheduleValue.trim());
          if (isNaN(scheduleDate.getTime())) {
            throw new Error(`Invalid date string: "${postScheduleValue}"`);
          }
        } else {
          throw new Error(`Missing or invalid Post Schedule value.`);
        }
      } catch (e: any) {
        const context = `Post Schedule Error (Post ID: ${id})`;
        logErrorToSheet(e, context);
        const errorMessage = `${context}: ${e.message}`;
        Logger.log(errorMessage);
        // sendErrorEmail(errorMessage, "Post Schedule Error"); // 必要であればメール通知
        continue; // 次の投稿へ
      }

      // --- 3. 時刻条件チェック ---
      if (scheduleDate) {
        const scheduleTime = scheduleDate.getTime();
        const isPastOrPresent = scheduleTime <= nowTime;
        const isWithinFutureThreshold =
          scheduleTime > nowTime && scheduleTime <= thresholdTime;

        // 投稿対象かどうか
        if (isPastOrPresent || isWithinFutureThreshold) {
          Logger.log(
            `Post ${id} scheduled for ${scheduleDate.toISOString()} is eligible for posting. Reason: ${
              isPastOrPresent ? "Past/Present" : "Within Future Threshold"
            }`
          );

          // 処理中フラグを立てる
          cache.put(processingKey, "true", 600); // 10分間

          try {
            // --- メディアアップロード (変更なし) ---
            const mediaIds = mediaUrls
              ? await uploadMediaToX(mediaUrls, accountId)
              : [];

            // --- リプライ先ID取得 (改善) ---
            let replyToPostId: string | null = null;
            if (inReplyToInternal) {
              // まずPostedシートから検索
              replyToPostId = getReplyToPostId(postedSheet, inReplyToInternal);
              // 見つからなければPostsシートからも検索 (同一バッチ内のリプライ用)
              if (!replyToPostId) {
                replyToPostId = getReplyToPostId(postsSheet, inReplyToInternal);
                if (replyToPostId) {
                  Logger.log(
                    `Found replyToPostId (${replyToPostId}) for internal ID ${inReplyToInternal} in Posts sheet.`
                  );
                }
              }
              if (!replyToPostId) {
                Logger.log(
                  `Warning: Could not find reply target post (internal ID: ${inReplyToInternal}) for post ${id}. Posting without reply.`
                );
                // エラーにする場合はここで throw new Error(...)
              }
            }

            // --- Xへ投稿 (変更なし) ---
            Logger.log(
              `Attempting to post tweet for ID: ${id}, Account: ${accountId}, Content: "${content.substring(
                0,
                50
              )}...", Media: ${mediaIds.length > 0}, ReplyTo: ${
                replyToPostId || "None"
              }`
            );
            const response = await postTweet(
              content,
              mediaIds,
              replyToPostId,
              accountId
            );

            // --- 投稿成功後の処理 (改善) ---
            if (response && response.data && response.data.id) {
              const newPostIdOnX = response.data.id;
              const rowNumber = rowMapping[id];

              if (rowNumber) {
                // 元の行データを取得
                const originalRowValues = postsSheet
                  .getRange(rowNumber, 1, 1, postsSheet.getLastColumn())
                  .getValues()[0];

                // Postedシートに追加するデータを作成 (MAIN_HEADERS.POSTED_HEADERS 順)
                const postedRowData = MAIN_HEADERS.POSTED_HEADERS.map(
                  (header) => {
                    const postHeaderIndex = postsHeaderMap[header];
                    if (header === "postedAt") {
                      return new Date(); // 投稿日時
                    } else if (header === "postId") {
                      return newPostIdOnX; // Xでの投稿ID
                    } else if (header === "inReplyToOnX") {
                      return replyToPostId || ""; // Xでのリプライ先ID
                    } else if (postHeaderIndex !== undefined) {
                      // Postsシートに対応する列があればその値
                      return originalRowValues[postHeaderIndex];
                    } else {
                      return ""; // 対応する列がなければ空文字
                    }
                  }
                );

                // Postedシートに追加
                postedSheet.appendRow(postedRowData);
                // Postsシートから削除
                postsSheet.deleteRow(rowNumber);

                Logger.log(
                  `Post successful for ID: ${id}! X Post ID: ${newPostIdOnX}. Moved to Posted sheet.`
                );

                // rowMappingから削除された行のエントリを削除（必須ではないが整合性のため）
                delete rowMapping[id];
                // 後続の行番号を更新する必要があるが、このループではもう使わない想定
                postMadeInThisRun = true; // 投稿が成功したフラグを立てる
                break;
              } else {
                // rowMappingにIDがない場合 (通常は起こらないはず)
                throw new Error(
                  `Internal consistency error: Row number not found in mapping for supposedly existing post ID ${id}.`
                );
              }
            } else {
              // APIレスポンスが不正な場合
              throw new Error(
                `Post failed. Invalid response from X API: ${JSON.stringify(
                  response
                )}`
              );
            }
          } catch (error: any) {
            const context = `X Post Error (Post ID: ${id})`;
            logErrorToSheet(error, context);
            const errorMessage = `${context}: ${error.message} \nStack: ${error.stack}`;
            Logger.log(errorMessage);
            //sendErrorEmail(errorMessage, "X Post Error"); // エラーメール送信
            // エラーが発生しても次の投稿へ進む (キャッシュはfinallyで削除)
          } finally {
            // 処理中フラグを削除
            cache.remove(processingKey);
          }
        } else {
          // 投稿対象外 (未来すぎる)
          Logger.log(
            `Post ${id} scheduled for ${scheduleDate.toISOString()} is not yet due. Skipping.`
          ); // 通常ログ不要
          break;
        }
      } // end if(scheduleDate)
    } // end of for loop

    // --- Check if any scheduled posts remain in the Posts sheet ---
    const remainingPostsData = postsSheet.getDataRange().getValues().slice(1); // Get fresh data after potential deletions
    const scheduleIndexAfterLoop = postsHeaderMap[HEADERS.POST_HEADERS[5]]; // Get schedule index again

    for (const row of remainingPostsData) {
      const scheduleValue = row[scheduleIndexAfterLoop];
      if (
        scheduleValue &&
        scheduleValue instanceof Date &&
        !isNaN(scheduleValue.getTime())
      ) {
        // Found a row with a valid schedule date
        hasScheduledPosts = true;
        break; // No need to check further
      } else if (
        typeof scheduleValue === "string" &&
        scheduleValue.trim() !== ""
      ) {
        // Also consider valid date strings
        const parsedDate = new Date(scheduleValue.trim());
        if (!isNaN(parsedDate.getTime())) {
          hasScheduledPosts = true;
          break;
        }
      }
    }

    // --- Delete trigger if no scheduled posts are left ---
    if (!hasScheduledPosts && remainingPostsData.length > 0) {
      // Check if sheet is not empty but has no scheduled posts
      Logger.log(
        "No remaining posts with valid schedules found. Attempting to delete the autoPostToX trigger."
      );
      const deleted = deleteTriggerByHandler(HANDLER_FUNCTION_NAME);
      if (deleted) {
        Logger.log(
          "Successfully deleted the autoPostToX trigger as no scheduled posts remain."
        );
      } else {
        Logger.log(
          "Could not delete the autoPostToX trigger (might not exist or error occurred)."
        );
      }
    } else if (remainingPostsData.length === 0) {
      Logger.log(
        "Posts sheet is empty. Attempting to delete the autoPostToX trigger."
      );
      const deleted = deleteTriggerByHandler(HANDLER_FUNCTION_NAME);
      if (deleted) {
        Logger.log(
          "Successfully deleted the autoPostToX trigger as the Posts sheet is empty."
        );
      } else {
        Logger.log(
          "Could not delete the autoPostToX trigger (might not exist or error occurred)."
        );
      }
    } else {
      Logger.log(
        "Scheduled posts still exist or sheet is empty. Trigger remains active."
      );
    }

    // --- Postedシートのソート (変更なし) ---
    // Only sort if a post might have been added
    if (postMadeInThisRun) {
      sortPostsBySchedule(postedSheet);
    }
    Logger.log("Finished autoPostToX cycle.");
  } catch (e: any) {
    // --- 全体エラーハンドリング (変更なし) ---
    const context = "Critical Error in autoPostToX function";
    logErrorToSheet(e, context);
    const errorMessage = `${context}: ${e.message} \nStack: ${e.stack}`;
    Logger.log(errorMessage);
    // sendErrorEmail(errorMessage, "X Autopost System Critical Error");
  }
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
  // Use the correct property names based on the logged object
  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } =
    getXAuthById(accountId);

  // This check should now work correctly
  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error("APIキーまたはアクセストークンが設定されていません");
  }

  // 1. OAuthパラメーターの設定（ツイート投稿API V2）
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_token: accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: Utilities.base64Encode(
      Math.random().toString() + Date.now().toString()
    ),
    oauth_version: "1.0",
  };

  // 2. リクエストボディ（ポスト API V２用）
  const requestBody: any = {
    text: content, // Use the 'content' parameter here
  };
  // Add media only if mediaIds exist and are not empty
  if (mediaIds && mediaIds.length > 0) {
    requestBody.media = { media_ids: mediaIds };
  }
  // Add reply settings if replyToPostId exists
  if (replyToPostId) {
    requestBody.reply = { in_reply_to_tweet_id: replyToPostId };
  }

  // 3. 署名キーの生成
  const signingKey = `${encodeURIComponent(apiKeySecret)}&${encodeURIComponent(
    accessTokenSecret
  )}`;

  // 4. 署名ベース文字列の生成 (ツイート投稿URLとOAuthパラメータを使用)
  const signatureBaseString = generateSignatureBaseString(
    "POST",
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
    .join(", ")}`;

  // 6. UrlFetchApp でツイート投稿 API v2 を実行
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json", // ツイート投稿 API v2 は application/json
    },
    payload: JSON.stringify(requestBody), // リクエストボディをJSON文字列に変換
    muteHttpExceptions: true, // Prevent exceptions for non-2xx responses
  };

  try {
    // Use fetchWithRetries for resilience
    const response = utils.fetchWithRetries(TWITTER_API_ENDPOINT, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    const responseJson = JSON.parse(responseText); // Try parsing JSON regardless of code

    if (responseCode >= 200 && responseCode < 300) {
      Logger.log(`Tweet posted successfully: ${responseJson?.data?.id}`); // ログ出力
      return responseJson; // レスポンスを返す
    } else {
      // Handle API errors more gracefully
      Logger.log(
        `Tweet post failed. Status: ${responseCode}, Response: ${responseText}`
      );
      // Throw a more informative error
      throw new Error(
        `X API Error (${responseCode}): ${
          responseJson?.title || "Unknown error"
        } - ${responseJson?.detail || responseText}`
      );
    }
  } catch (error: any) {
    Logger.log("Tweet post error:", error); // エラーログ出力
    // Re-throw the error so it can be caught by autoPostToX
    throw error;
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
      Logger.log(
        `Found reply target postId: ${data[i][7]} for internal ID ${inReplyToInternal}`
      );
      return data[i][7] as string; // G列 (postId) を返す
    }
  }
  return null; // 見つからない場合
}
