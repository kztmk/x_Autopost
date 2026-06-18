import * as utils from "./utils";
import * as auth from "./auth";
import { uploadMediaToX } from "./media";
import * as twitterApi from "./api/twitter"; // 追加: Twitter API関連のインポート
import { HEADERS, SHEETS } from "./constants";
import { HeaderMap, XAuthInfo } from "./types";
import { logErrorToSheet, deleteTriggerByHandler } from "./utils";
import {
  formatDiscordDateTime,
  sendDiscordPostNotification,
} from "./api/discordNotification";

import * as apiv2 from "./apiv2";

// --- PropertiesService と定数 ---
const scriptProperties = PropertiesService.getScriptProperties();
const TRIGGER_INTERVAL_PREFIX = "triggerInterval_";
const DEFAULT_TRIGGER_INTERVAL = 5;
const HANDLER_FUNCTION_NAME = "autoPostToX";

class ReplyTargetPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyTargetPendingError";
  }
}

class PublishedPostMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedPostMoveError";
  }
}

function normalizeSheetValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function isUsableReplyPostId(value: any): boolean {
  const postId = normalizeSheetValue(value);
  return Boolean(
    postId &&
      postId.toUpperCase() !== "ERROR" &&
      !postId.startsWith("Reposted:")
  );
}

function isProcessedPostId(value: any): boolean {
  const postId = normalizeSheetValue(value);
  return Boolean(postId && postId.toUpperCase() !== "ERROR");
}

function formatScheduleForDiscord(value: any): string {
  if (value instanceof Date) {
    return formatDiscordDateTime(value);
  }
  return normalizeSheetValue(value);
}

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

  const eligibleIds = new Set(
    postsToProcess
      .map((post) => normalizeSheetValue(post.rowData[idIndex]))
      .filter(Boolean)
  );
  const inReplyToInternalIndex = postsHeaderMap["inReplyToInternal"];

  // Return the first post whose parent is not also waiting in this interval.
  for (const post of postsToProcess) {
    const inReplyToInternal =
      inReplyToInternalIndex !== undefined
        ? normalizeSheetValue(post.rowData[inReplyToInternalIndex])
        : "";

    if (inReplyToInternal && eligibleIds.has(inReplyToInternal)) {
      Logger.log(
        `Deferring reply post ${normalizeSheetValue(
          post.rowData[idIndex]
        )} because parent ${inReplyToInternal} is also eligible and should be posted first.`
      );
      continue;
    }

    return post;
  }

  return null;
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
    let postsData = postsSheet.getDataRange().getValues();

    if (postsData.length < 1) {
      Logger.log("No data found in Posts sheet.");
      deleteTriggerByHandler("autoPostToX");
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

    recoverProcessedPosts(
      postsSheet,
      postedSheet,
      postsHeaderMap,
      postedHeaderMap
    );
    postsData = postsSheet.getDataRange().getValues();

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
        const processResult = await processPost(
          postObject,
          rowIndex,
          postsSheet,
          postedSheet,
          postsHeaderMap,
          postedHeaderMap
        );
        sendDiscordPostNotification({
          status: "success",
          accountId: normalizeSheetValue(postObject.postTo),
          internalId: normalizeSheetValue(postObject.id),
          postId: normalizeSheetValue(processResult.postId),
          content: normalizeSheetValue(postObject.contents),
          scheduledAt: formatScheduleForDiscord(postObject.postSchedule),
        });

        processedInThisRun = true;
      } catch (e: any) {
        // Log error and continue
        const internalPostId = rowData[postsHeaderMap["id"]] || "N/A"; // Use internal ID if needed
        // Safely access content from postObject, default to 'Content not available'
        const postContent = postObject?.contents ?? "Content not available";
        Logger.log(
          `Error processing post (Internal ID: ${internalPostId}, Row: ${rowIndex}): ${e.message}`
        );
        if (e instanceof ReplyTargetPendingError) {
          Logger.log(
            `Reply target is still pending for post ${internalPostId}; leaving the row queued for a later run.`
          );
          return;
        }
        if (e instanceof PublishedPostMoveError) {
          logErrorToSheet(
            {
              message: e.message,
              stack: e.stack || "",
              context: `autoPostToX - Moving Published Post Row ${rowIndex}`,
              timestamp: new Date().toISOString(),
              postContent: postContent.substring(0, 20),
            },
            "Published Post Move Error"
          );
          Logger.log(
            `Published post move failed for ${internalPostId}; row was not marked failed because the X post already exists.`
          );
          sendDiscordPostNotification({
            status: "critical",
            accountId: normalizeSheetValue(postObject?.postTo),
            internalId: normalizeSheetValue(internalPostId),
            content: normalizeSheetValue(postObject?.contents),
            scheduledAt: formatScheduleForDiscord(postObject?.postSchedule),
            errorMessage: e.message,
          });
          return;
        }
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
        sendDiscordPostNotification({
          status: "error",
          accountId: normalizeSheetValue(postObject?.postTo),
          internalId: normalizeSheetValue(internalPostId),
          content: normalizeSheetValue(postObject?.contents),
          scheduledAt: formatScheduleForDiscord(postObject?.postSchedule),
          errorMessage: e.message,
        });

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
    sendDiscordPostNotification({
      status: "critical",
      errorMessage: e.message,
    });
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
  const targetInternalId = normalizeSheetValue(internalId);

  // Postedシートで検索
  const postedData = postedSheet.getDataRange().getValues();
  const postedHeaders = postedData[0] || [];
  const postedIdIndex = postedHeaders.indexOf("id");
  const postedPostIdIndex = postedHeaders.indexOf("postId");

  if (postedIdIndex !== -1 && postedPostIdIndex !== -1) {
    for (let i = 1; i < postedData.length; i++) {
      if (
        normalizeSheetValue(postedData[i][postedIdIndex]) ===
          targetInternalId &&
        isUsableReplyPostId(postedData[i][postedPostIdIndex])
      ) {
        return normalizeSheetValue(postedData[i][postedPostIdIndex]);
      }
    }
  }

  // Fallback for rows written with the canonical Posted order under older headers.
  const canonicalPostedIdIndex = HEADERS.POSTED_HEADERS.indexOf("id");
  const canonicalPostedPostIdIndex = HEADERS.POSTED_HEADERS.indexOf("postId");
  if (
    canonicalPostedIdIndex !== postedIdIndex ||
    canonicalPostedPostIdIndex !== postedPostIdIndex
  ) {
    for (let i = 1; i < postedData.length; i++) {
      if (
        normalizeSheetValue(postedData[i][canonicalPostedIdIndex]) ===
          targetInternalId &&
        isUsableReplyPostId(postedData[i][canonicalPostedPostIdIndex])
      ) {
        return normalizeSheetValue(postedData[i][canonicalPostedPostIdIndex]);
      }
    }
  }

  // Postsシートで検索
  const postsData = postsSheet.getDataRange().getValues();
  const postsHeaders = postsData[0] || [];
  const idIndex = postsHeaders.indexOf("id");
  const postIdIndex = postsHeaders.indexOf("postId");

  if (idIndex !== -1 && postIdIndex !== -1) {
    for (let i = 1; i < postsData.length; i++) {
      if (
        normalizeSheetValue(postsData[i][idIndex]) === targetInternalId &&
        isUsableReplyPostId(postsData[i][postIdIndex])
      ) {
        return normalizeSheetValue(postsData[i][postIdIndex]);
      }
    }
  }

  return null;
}

function isPendingInternalPost(
  internalId: string,
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet
): boolean {
  const targetInternalId = normalizeSheetValue(internalId);
  const postsData = postsSheet.getDataRange().getValues();
  const postsHeaders = postsData[0] || [];
  const idIndex = postsHeaders.indexOf("id");
  const postIdIndex = postsHeaders.indexOf("postId");
  const statusIndex = postsHeaders.indexOf("status");

  if (idIndex === -1) {
    return false;
  }

  for (let i = 1; i < postsData.length; i++) {
    if (normalizeSheetValue(postsData[i][idIndex]) !== targetInternalId) {
      continue;
    }

    const status =
      statusIndex !== -1 ? normalizeSheetValue(postsData[i][statusIndex]) : "";
    const postId =
      postIdIndex !== -1 ? normalizeSheetValue(postsData[i][postIdIndex]) : "";

    return !isUsableReplyPostId(postId) && status !== "failed";
  }

  return false;
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
  const postedAt = new Date();
  const headersFromSheet = Object.keys(postedHeaderMap)
    .filter((header) => header)
    .sort((a, b) => postedHeaderMap[a] - postedHeaderMap[b]);
  const targetHeaders =
    headersFromSheet.length > 0 ? headersFromSheet : [...HEADERS.POSTED_HEADERS];

  // Fill the row based on the expected headers
  return targetHeaders.map((header) => {
    switch (header) {
      case "postedAt":
        return postedAt.toISOString();
      case "postId":
        return resultPostId;
      case "inReplyToOnX":
        return resultInReplyToId || "";
      default:
        // Copy from original post object if exists
        return postObject[header] !== undefined ? postObject[header] : "";
    }
  });
}

function appendPostedRowIfMissing(
  postObject: any,
  resultPostId: string,
  resultInReplyToId: string | null,
  postedSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postedHeaderMap: HeaderMap
): void {
  const internalId = normalizeSheetValue(postObject.id);
  const postedData = postedSheet.getDataRange().getValues();
  const postedHeaders = postedData[0] || [];
  const idIndex = postedHeaders.indexOf("id");

  if (internalId && idIndex !== -1) {
    for (let i = 1; i < postedData.length; i++) {
      if (normalizeSheetValue(postedData[i][idIndex]) === internalId) {
        Logger.log(
          `Posted row for internal ID ${internalId} already exists. Skipping append.`
        );
        return;
      }
    }
  }

  const canonicalIdIndex = HEADERS.POSTED_HEADERS.indexOf("id");
  if (internalId && canonicalIdIndex !== idIndex) {
    for (let i = 1; i < postedData.length; i++) {
      if (normalizeSheetValue(postedData[i][canonicalIdIndex]) === internalId) {
        Logger.log(
          `Posted row for internal ID ${internalId} already exists in canonical column order. Skipping append.`
        );
        return;
      }
    }
  }

  const postedRowData = preparePostedRow(
    postObject,
    resultPostId,
    resultInReplyToId,
    postedHeaderMap
  );
  postedSheet.appendRow(postedRowData);
}

function findPostedPostIdByInternalId(
  postedSheet: GoogleAppsScript.Spreadsheet.Sheet,
  internalId: string
): string | null {
  const targetInternalId = normalizeSheetValue(internalId);
  if (!targetInternalId) {
    return null;
  }

  const postedData = postedSheet.getDataRange().getValues();
  const postedHeaders = postedData[0] || [];
  const idIndex = postedHeaders.indexOf("id");
  const postIdIndex = postedHeaders.indexOf("postId");

  if (idIndex !== -1 && postIdIndex !== -1) {
    for (let i = 1; i < postedData.length; i++) {
      if (
        normalizeSheetValue(postedData[i][idIndex]) === targetInternalId &&
        isProcessedPostId(postedData[i][postIdIndex])
      ) {
        return normalizeSheetValue(postedData[i][postIdIndex]);
      }
    }
  }

  const canonicalIdIndex = HEADERS.POSTED_HEADERS.indexOf("id");
  const canonicalPostIdIndex = HEADERS.POSTED_HEADERS.indexOf("postId");
  if (canonicalIdIndex !== idIndex || canonicalPostIdIndex !== postIdIndex) {
    for (let i = 1; i < postedData.length; i++) {
      if (
        normalizeSheetValue(postedData[i][canonicalIdIndex]) ===
          targetInternalId &&
        isProcessedPostId(postedData[i][canonicalPostIdIndex])
      ) {
        return normalizeSheetValue(postedData[i][canonicalPostIdIndex]);
      }
    }
  }

  return null;
}

function updateSourceRowAfterPublish(
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowNum: number,
  postsHeaderMap: HeaderMap,
  resultPostId: string,
  resultInReplyToId: string | null
): void {
  const postIdIndex = postsHeaderMap["postId"];
  if (postIdIndex !== undefined) {
    postsSheet.getRange(rowNum, postIdIndex + 1).setValue(resultPostId);
  }

  const inReplyToOnXIndex = postsHeaderMap["inReplyToOnX"];
  if (inReplyToOnXIndex !== undefined) {
    postsSheet
      .getRange(rowNum, inReplyToOnXIndex + 1)
      .setValue(resultInReplyToId || "");
  }

  const statusIndex = postsHeaderMap["status"];
  if (statusIndex !== undefined) {
    postsSheet.getRange(rowNum, statusIndex + 1).setValue("posted");
  }

  const errorMessageIndex = postsHeaderMap["errorMessage"];
  if (errorMessageIndex !== undefined) {
    postsSheet.getRange(rowNum, errorMessageIndex + 1).setValue("");
  }

  SpreadsheetApp.flush();
}

function deletePostRowByInternalId(
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet,
  internalId: string
): boolean {
  const targetInternalId = normalizeSheetValue(internalId);
  if (!targetInternalId) {
    return false;
  }

  const data = postsSheet.getDataRange().getValues();
  const headers = data[0] || [];
  const idIndex = headers.indexOf("id");
  if (idIndex === -1) {
    return false;
  }

  for (let i = data.length - 1; i >= 1; i--) {
    if (normalizeSheetValue(data[i][idIndex]) === targetInternalId) {
      postsSheet.deleteRow(i + 1);
      return true;
    }
  }

  return false;
}

function recoverProcessedPosts(
  postsSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postedSheet: GoogleAppsScript.Spreadsheet.Sheet,
  postsHeaderMap: HeaderMap,
  postedHeaderMap: HeaderMap
): void {
  const data = postsSheet.getDataRange().getValues();
  const idIndex = postsHeaderMap["id"];
  const postIdIndex = postsHeaderMap["postId"];
  const inReplyToOnXIndex = postsHeaderMap["inReplyToOnX"];

  if (idIndex === undefined || postIdIndex === undefined || data.length <= 1) {
    return;
  }

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const internalId = normalizeSheetValue(row[idIndex]);
    const resultPostId = normalizeSheetValue(row[postIdIndex]);

    if (!internalId) {
      continue;
    }

    const postedPostId = findPostedPostIdByInternalId(postedSheet, internalId);
    if (!isProcessedPostId(resultPostId) && postedPostId) {
      Logger.log(
        `Removing duplicate scheduled row ${internalId} because it already exists in Posted (${postedPostId}).`
      );
      postsSheet.deleteRow(i + 1);
      continue;
    }

    if (!isProcessedPostId(resultPostId)) {
      continue;
    }

    const postObject = mapRowToObject(row, postsHeaderMap);
    const resultInReplyToId =
      inReplyToOnXIndex !== undefined
        ? normalizeSheetValue(row[inReplyToOnXIndex])
        : "";

    Logger.log(
      `Recovering already-published post ${internalId} (${resultPostId}) from Posts to Posted.`
    );
    appendPostedRowIfMissing(
      postObject,
      resultPostId,
      resultInReplyToId || null,
      postedSheet,
      postedHeaderMap
    );
    postsSheet.deleteRow(i + 1);
  }
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
): Promise<{ postId: string | null }> {
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
          if (isPendingInternalPost(postObject.inReplyToInternal, postsSheet)) {
            throw new ReplyTargetPendingError(
              `Reply target is not posted yet for internal reply ID: ${postObject.inReplyToInternal}`
            );
          }
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

    try {
      updateSourceRowAfterPublish(
        postsSheet,
        rowNum,
        postsHeaderMap,
        resultPostId,
        resultInReplyToId
      );

      appendPostedRowIfMissing(
        postObject,
        resultPostId,
        resultInReplyToId,
        postedSheet,
        postedHeaderMap
      );

      if (!deletePostRowByInternalId(postsSheet, postObject.id)) {
        throw new Error(
          `Could not find source row to remove. Internal ID: ${postObject.id}`
        );
      }
    } catch (moveError: any) {
      throw new PublishedPostMoveError(
        `Post was published to X but failed while moving sheet rows. Internal ID: ${postObject.id}, Post ID: ${resultPostId}, Cause: ${moveError.message}`
      );
    }
  }

  return { postId: resultPostId };
}

// Export functions that should be accessible from other modules or via API endpoints
export { autoPostToX, getTriggerIntervalMinutes };
