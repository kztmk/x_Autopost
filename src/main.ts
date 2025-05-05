import * as utils from "./utils";
import * as auth from "./auth";
import { uploadMediaToX } from "./media";
import * as twitterApi from "./api/twitter"; // 追加: Twitter API関連のインポート
import { HEADERS, SHEETS } from "./constants";
import { HeaderMap, XAuthInfo } from "./types";
import { logErrorToSheet } from "./utils";

import * as apiv2 from "./apiv2";

// --- PropertiesService と定数 ---
const scriptProperties = PropertiesService.getScriptProperties();
const TRIGGER_INTERVAL_PREFIX = "triggerInterval_";
const DEFAULT_TRIGGER_INTERVAL = 5;
const HANDLER_FUNCTION_NAME = "autoPostToX";

/**
 * トリガーの間隔（分）を PropertiesService から取得します。
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
          Logger.log(
            `Property key ${propertyKey} not found for trigger ${triggerId} handling ${functionName}. Using default interval.`
          );
        }
        // Found the relevant trigger, no need to check others for this function
        break;
      }
    }
  } catch (e: any) {
    Logger.log(
      `Error getting trigger interval for ${functionName}: ${e}. Using default.`
    );
  }
  // Return default if trigger not found, property not found, value invalid, or error occurred
  Logger.log(
    `Using default trigger interval: ${DEFAULT_TRIGGER_INTERVAL} minutes for ${functionName}.`
  );
  return DEFAULT_TRIGGER_INTERVAL;
}

/**
 * Finds the next eligible post to be processed based on schedule and status.
 * @param postsData The full data from the Posts sheet.
 * @param postsHeaderMap A map of header names to column indices for the Posts sheet.
 * @param intervalEnd The end time of the current processing interval.
 * @param cache The script cache service instance.
 * @returns The post object to process (including row data, index, and cache key) or null if no eligible post is found.
 */
function findNextScheduledPost(
  postsData: any[][],
  postsHeaderMap: HeaderMap,
  intervalEnd: Date,
  cache: GoogleAppsScript.Cache.Cache
): { rowData: any[]; rowIndex: number; cacheKey: string } | null {
  const scheduleIndex = postsHeaderMap["postSchedule"];
  const statusIndex = postsHeaderMap["status"];
  const postIdIndex = postsHeaderMap["postId"];
  const idIndex = postsHeaderMap["id"];

  if (
    scheduleIndex === undefined ||
    postIdIndex === undefined ||
    idIndex === undefined
  ) {
    // This case should ideally be caught earlier, but added for safety
    Logger.log(
      "Error in findNextScheduledPost: Required columns missing in header map."
    );
    return null;
  }

  let postsToProcess: { rowData: any[]; rowIndex: number; cacheKey: string }[] =
    [];

  // Process rows from index 1 (skip header)
  for (let i = 1; i < postsData.length; i++) {
    const row = postsData[i];
    const postId = row[postIdIndex];
    const status = statusIndex !== undefined ? row[statusIndex] : null;
    const scheduleValue = row[scheduleIndex];
    const internalId = row[idIndex]?.toString();

    // Skip if already processed, has postId, status is failed, or missing internal ID
    if (postId || status === "failed" || !internalId) {
      continue;
    }

    // Check cache to prevent concurrent processing
    const cacheKey = `post_${internalId}`;
    if (cache.get(cacheKey)) {
      Logger.log(
        `Skipping post ID ${internalId} (row ${
          i + 1
        }) as it's already being processed (cache hit).`
      );
      continue;
    }

    // Parse schedule date
    let scheduleDate: Date | null = null;
    if (scheduleValue instanceof Date && !isNaN(scheduleValue.getTime())) {
      scheduleDate = scheduleValue;
    } else if (
      typeof scheduleValue === "string" &&
      scheduleValue.trim() !== ""
    ) {
      const parsedDate = new Date(scheduleValue);
      if (!isNaN(parsedDate.getTime())) {
        scheduleDate = parsedDate;
      }
    }

    // Check if post is scheduled within the current interval
    if (scheduleDate && scheduleDate <= intervalEnd) {
      postsToProcess.push({
        rowData: row,
        rowIndex: i + 1, // 1-based row index
        cacheKey,
      });
    }
  }

  // Sort posts by schedule (earlier first)
  postsToProcess.sort((a, b) => {
    const dateA = a.rowData[scheduleIndex];
    const dateB = b.rowData[scheduleIndex];
    // Ensure both are valid dates before comparing times
    if (
      dateA instanceof Date &&
      !isNaN(dateA.getTime()) &&
      dateB instanceof Date &&
      !isNaN(dateB.getTime())
    ) {
      return dateA.getTime() - dateB.getTime();
    } else if (dateA instanceof Date && !isNaN(dateA.getTime())) {
      return -1; // Valid date A comes before invalid/missing date B
    } else if (dateB instanceof Date && !isNaN(dateB.getTime())) {
      return 1; // Valid date B comes before invalid/missing date A
    }
    return 0; // Keep order if both are invalid/missing
  });

  // Return the first eligible post
  return postsToProcess.length > 0 ? postsToProcess[0] : null;
}

// --- Main Function ---
async function autoPostToX() {
  try {
    // Main try block starts here
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const postsSheet = ss.getSheetByName(SHEETS.POSTS);
    const postedSheet = ss.getSheetByName(SHEETS.POSTED);
    const errorSheet = ss.getSheetByName(SHEETS.ERRORS);

    if (!postsSheet || !postedSheet || !errorSheet) {
      throw new Error("Required sheets (Posts, Posted, Errors) not found.");
    }

    // 処理に必要なヘッダーとデータを取得
    const postsHeaderRow = postsSheet
      .getRange(1, 1, 1, postsSheet.getLastColumn())
      .getValues()[0];
    const postedHeaderRow = postedSheet
      .getRange(1, 1, 1, postedSheet.getLastColumn())
      .getValues()[0];
    const postsData = postsSheet.getDataRange().getValues();

    if (postsData.length <= 1) {
      Logger.log("No data found in Posts sheet.");
      return; // No data to process
    }

    // Build header index mapping for both sheets
    const postsHeaderMap: HeaderMap = {};
    postsHeaderRow.forEach((header, index) => {
      postsHeaderMap[header as string] = index;
    });

    const postedHeaderMap: HeaderMap = {};
    postedHeaderRow.forEach((header, index) => {
      postedHeaderMap[header as string] = index;
    });

    // Get trigger interval
    const triggerIntervalMinutes = getTriggerIntervalMinutes(
      HANDLER_FUNCTION_NAME
    );
    const now = new Date();
    const intervalEnd = new Date(
      now.getTime() + triggerIntervalMinutes * 60 * 1000
    );

    // Cache to prevent processing the same post ID multiple times concurrently
    const cache = CacheService.getScriptCache();
    let processedInThisRun = false; // Flag to ensure only one post per run

    // Find the next post to process using the new function
    const postToProcess = findNextScheduledPost(
      postsData,
      postsHeaderMap,
      intervalEnd,
      cache
    );

    // Process the found post
    if (postToProcess) {
      const { rowData, rowIndex, cacheKey } = postToProcess;
      let postObject: any = null; // Declare postObject outside the try block

      // Add to cache to prevent concurrent processing
      cache.put(cacheKey, "processing", 60); // Cache for 60 seconds

      try {
        // Map row to object - moved outside try block by user, ensure it's here or before
        postObject = mapRowToObject(rowData, postsHeaderMap);

        // Process the post
        await processPost(
          postObject,
          rowIndex,
          postsSheet,
          postedSheet,
          postsHeaderMap,
          postedHeaderMap
        );

        processedInThisRun = true;
      } catch (e: any) {
        // Log error and continue
        const internalPostId = rowData[postsHeaderMap["id"]] || "N/A"; // Use internal ID if needed
        // Safely access content from postObject, default to 'Content not available'
        const postContent = postObject?.contents ?? "Content not available";
        Logger.log(
          `Error processing post (Internal ID: ${internalPostId}, Row: ${rowIndex}): ${e.message}`
        );
        logErrorToSheet(
          {
            message: e.message,
            stack: e.stack || "",
            context: `autoPostToX - Processing Row ${rowIndex}`,
            timestamp: new Date().toISOString(),
            // postId: postId, // Removed API postId as requested
            postContent: postContent.substring(0, 20), // Keep post content
          },
          "Post Processing Error"
        );

        // Update status to failed
        try {
          const statusIndex = postsHeaderMap["status"];
          if (statusIndex !== undefined) {
            postsSheet.getRange(rowIndex, statusIndex + 1).setValue("failed");
            // Update error message column if it exists
            const errorMsgIndex = postsHeaderMap["errorMessage"];
            if (errorMsgIndex !== undefined) {
              postsSheet
                .getRange(rowIndex, errorMsgIndex + 1)
                .setValue(e.message.substring(0, 500)); // Limit error message length
            }
          }
        } catch (updateError: any) {
          Logger.log(
            `Error updating status to failed for row ${rowIndex}: ${updateError.message}`
          );
          // Log this secondary error as well, including content but not API postId
          logErrorToSheet(
            {
              message: `Failed to update status/error message for row ${rowIndex} after initial error: ${updateError.message}`,
              stack: updateError.stack || "",
              context: "autoPostToX - Status Update Error",
              timestamp: new Date().toISOString(),
              // postId: postId, // Removed API postId here too
              postContent: postContent.substring(0, 20), // Keep post content here too
            },
            "Status Update Error"
          );
        }
      } finally {
        // Remove from cache regardless of success/failure
        cache.remove(cacheKey);
      }
    } else if (!processedInThisRun) {
      Logger.log("No posts scheduled for the current interval.");

      // Check if there are any pending posts left (excluding failed ones)
      let pendingPostsExist = false;
      const postIdIndex = postsHeaderMap["postId"];
      const statusIndex = postsHeaderMap["status"];
      for (let i = 1; i < postsData.length; i++) {
        const row = postsData[i];
        const status = statusIndex !== undefined ? row[statusIndex] : null;
        // Check if postId is empty AND status is not 'failed'
        if (!row[postIdIndex] && status !== "failed") {
          pendingPostsExist = true;
          break;
        }
      }

      if (!pendingPostsExist) {
        Logger.log(
          "No pending posts remaining in the queue. Deleting trigger."
        );
        utils.deleteTriggerByHandler(HANDLER_FUNCTION_NAME);
      }
    }
  } catch (e: any) {
    // Catch errors from the main try block
    Logger.log(
      `Critical error in autoPostToX: ${e.message}\nStack: ${e.stack}`
    );
    // Critical errors likely won't have postContent available
    logErrorToSheet(
      {
        message: e.message,
        stack: e.stack || "",
        context: "autoPostToX",
        timestamp: new Date().toISOString(),
        postContent: "N/A", // Add placeholder for consistency
      },
      "Critical error"
    );
  }
}

/**
 * シート行データをオブジェクトに変換する
 */
function mapRowToObject(rowData: any[], headerMap: HeaderMap): any {
  const obj: any = {};
  Object.keys(headerMap).forEach((header) => {
    const index = headerMap[header];
    if (index !== undefined && index < rowData.length) {
      obj[header] = rowData[index];
    }
  });
  return obj;
}

/**
 * リプライ先のXツイートIDを取得する
 */
async function getReplyToPostId(
  internalId: string,
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postedSheet: GoogleAppsScript.Spreadsheet.Sheet
): Promise<string | null> {
  // Postsシートで検索
  const postsData = postsSheet.getDataRange().getValues();
  const postsHeaders = postsData[0];
  const idIndex = postsHeaders.indexOf("id");
  const postIdIndex = postsHeaders.indexOf("postId");

  if (idIndex !== -1 && postIdIndex !== -1) {
    for (let i = 1; i < postsData.length; i++) {
      if (postsData[i][idIndex] === internalId && postsData[i][postIdIndex]) {
        return postsData[i][postIdIndex];
      }
    }
  }

  // Postedシートで検索
  const postedData = postedSheet.getDataRange().getValues();
  const postedHeaders = postedData[0];
  const postedIdIndex = postedHeaders.indexOf("id");
  const postedPostIdIndex = postedHeaders.indexOf("postId");

  if (postedIdIndex !== -1 && postedPostIdIndex !== -1) {
    for (let i = 1; i < postedData.length; i++) {
      if (
        postedData[i][postedIdIndex] === internalId &&
        postedData[i][postedPostIdIndex]
      ) {
        return postedData[i][postedPostIdIndex];
      }
    }
  }

  return null;
}

/**
 * Postedシート用にデータを整形する
 */
function preparePostedRow(
  postObject: any,
  resultPostId: string,
  resultInReplyToId: string | null,
  postedHeaderMap: HeaderMap
): any[] {
  const postedRow: any[] = [];
  const postedAt = new Date();

  // Define the headers that should be in the Posted sheet
  const expectedHeaders = [
    "id",
    "createdAt",
    "postedAt",
    "postTo",
    "contents",
    "mediaUrls",
    "postSchedule",
    "inReplyToInternal",
    "postId",
    "inReplyToOnX",
    "quoteId",
  ];

  // Fill the row based on the expected headers
  expectedHeaders.forEach((header) => {
    switch (header) {
      case "postedAt":
        postedRow.push(postedAt.toISOString());
        break;
      case "postId":
        postedRow.push(resultPostId);
        break;
      case "inReplyToOnX":
        postedRow.push(resultInReplyToId || "");
        break;
      default:
        // Copy from original post object if exists
        postedRow.push(
          postObject[header] !== undefined ? postObject[header] : ""
        );
        break;
    }
  });

  return postedRow;
}

/**
 * 投稿処理の中心となる関数
 * シート操作と投稿処理（X API呼び出し）を実行する
 */
async function processPost(
  postObject: any,
  rowNum: number,
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postedSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postsHeaderMap: HeaderMap,
  postedHeaderMap: HeaderMap
): Promise<void> {
  // 認証情報の取得
  const authInfo = await auth.getXAuthById(postObject.postTo);
  if (!authInfo) {
    throw new Error(
      `Authentication not found for account ID: ${postObject.postTo}`
    );
  }

  let resultPostId: string | null = null;
  let resultInReplyToId: string | null = null;

  // リポスト処理 (Retweet)
  if (postObject.repostTargetId) {
    Logger.log(
      `Attempting to repost tweet ID: ${postObject.repostTargetId} for account ${postObject.postTo}`
    );
    const success = await twitterApi.repostTweet(
      authInfo,
      postObject.repostTargetId
    );
    if (success) {
      resultPostId = `Reposted:${postObject.repostTargetId}`;
    } else {
      throw new Error(
        `Failed to repost tweet ID: ${postObject.repostTargetId}`
      );
    }
  }
  // 通常投稿処理 (Text, Media, Quote, Reply)
  else {
    Logger.log(
      `Attempting to post tweet for account ${
        postObject.postTo
      }: ${postObject.contents.substring(0, 30)}...`
    );

    // リプライ先の処理
    let replyToTweetId: string | null = null;
    // 直接リプライ先が設定されている場合には、検索しない
    if (postObject.inReplyToOnX) {
      replyToTweetId = postObject.inReplyToOnX;
    } else {
      if (postObject.inReplyToInternal) {
        replyToTweetId = await getReplyToPostId(
          postObject.inReplyToInternal,
          postsSheet,
          postedSheet
        );
        if (!replyToTweetId) {
          throw new Error(
            `Could not find original tweet ID for internal reply ID: ${postObject.inReplyToInternal}`
          );
        }
      }
    }

    // ペイロードの準備
    let content = postObject.contents;
    if (postObject.quoteId) {
      content = content + `\n${postObject.quoteId}`;
    }
    const payload: any = { text: content };

    if (replyToTweetId) {
      payload.reply = { in_reply_to_tweet_id: replyToTweetId };
      resultInReplyToId = replyToTweetId;
    }

    // メディア処理
    if (
      postObject.mediaUrls &&
      postObject.mediaUrls.trim() !== "" &&
      postObject.mediaUrls.trim() !== "[]"
    ) {
      try {
        const mediaIds = await uploadMediaToX(
          postObject.mediaUrls,
          postObject.postTo
        );
        if (mediaIds && mediaIds.length > 0) {
          payload.media = { media_ids: mediaIds };
        } else {
          throw new Error(
            "Media upload returned no IDs despite URLs being present."
          );
        }
      } catch (mediaError: any) {
        throw new Error(`Media processing failed: ${mediaError.message}`);
      }
    }

    // ツイート投稿
    resultPostId = await twitterApi.postTweet(authInfo, payload);
    if (!resultPostId) {
      throw new Error("Tweet posting completed but returned no Post ID.");
    }
  }

  // シートの更新
  if (resultPostId) {
    Logger.log(
      `Success! Post ID: ${resultPostId}. Moving row ${rowNum} to Posted sheet.`
    );

    // Postedシートに行を追加
    const postedRowData = preparePostedRow(
      postObject,
      resultPostId,
      resultInReplyToId,
      postedHeaderMap
    );
    postedSheet.appendRow(postedRowData);

    // Postsシートから行を削除
    postsSheet.deleteRow(rowNum);
  }
}

// Export functions that should be accessible from other modules or via API endpoints
export { autoPostToX, getTriggerIntervalMinutes };
