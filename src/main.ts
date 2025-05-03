import * as utils from "./utils";
import { getXAuthById } from "./auth";
import { uploadMediaToX } from "./media";
// Correctly import constants from types.d.ts
import { HEADERS, MAIN_HEADERS, SHEETS, HeaderMap } from "./types"; // Import HeaderMap type
import { logErrorToSheet } from "./utils";

// Object.assign(globalThis, api, auth, media, utils); // 'api' is not defined, and this pattern is generally discouraged. Commenting out.

// X API v2のエンドポイント
const TWITTER_API_ENDPOINT = "https://api.twitter.com/2/tweets";
const TWITTER_API_REPOST_ENDPOINT_TEMPLATE =
  "https://api.twitter.com/2/users/{userId}/retweets";

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

    const postsData = postsSheet.getDataRange().getValues();
    if (postsData.length <= 1) {
      Logger.log("No data found in Posts sheet.");
      return; // No data to process
    }
    postsData.shift(); // Remove header row

    // Build row mapping (ID to Row Number)
    const rowMapping: { [key: string]: number } = {};
    postsData.forEach((row, index) => {
      if (row && row[0]) {
        rowMapping[row[0] as string] = index + 2;
      }
    });

    // Postsシートのヘッダーインデックスを取得
    const postsHeaderMap = HEADERS.POST_HEADERS.reduce((map, header, index) => {
      map[header] = index;
      return map;
    }, {} as HeaderMap); // Use HeaderMap type
    const idIndex = postsHeaderMap["id"];
    const createdAtIndex = postsHeaderMap["createdAt"];
    const postToIndex = postsHeaderMap["postTo"];
    const contentIndex = postsHeaderMap["contents"];
    const mediaUrlsIndex = postsHeaderMap["mediaUrls"];
    const scheduleIndex = postsHeaderMap["postSchedule"];
    const inReplyToInternalIndex = postsHeaderMap["inReplyToInternal"];
    const postIdIndex = postsHeaderMap["postId"];
    const inReplyToOnXIndex = postsHeaderMap["inReplyToOnX"];
    const quoteIdIndex = postsHeaderMap["quoteId"];
    const repostTargetIdIndex = postsHeaderMap["repostTargetId"];

    let postMadeInThisRun = false; // Flag to track if any post/repost was made

    for (const postData of postsData) {
      // --- 各投稿データの取得 ---
      const id = postData[idIndex] as string;
      const postScheduleValue = postData[scheduleIndex];
      const postTo = postData[postToIndex] as string;
      const content = postData[contentIndex] as string;
      const mediaUrls = postData[mediaUrlsIndex] as string;
      const inReplyToInternal = postData[inReplyToInternalIndex] as string;
      const postId = postData[postIdIndex] as string;
      const inReplyToOnX =
        inReplyToOnXIndex !== undefined
          ? (postData[inReplyToOnXIndex] as string)
          : "";
      const quoteId =
        quoteIdIndex !== undefined ? (postData[quoteIdIndex] as string) : "";
      const repostTargetId =
        repostTargetIdIndex !== undefined
          ? (postData[repostTargetIdIndex] as string)
          : "";

      // --- Basic Checks ---
      if (!id) {
        Logger.log(`Skipping row with missing ID.`);
        continue;
      }
      const accountId = postTo ? postTo.toLowerCase() : "";
      if (!accountId) {
        Logger.log(`Skipping post ${id} due to missing account ID (postTo).`);
        continue;
      }

      // --- Cache Check ---
      const cache = CacheService.getScriptCache();
      const processingKey = `processing-${id}`;
      if (cache.get(processingKey)) {
        Logger.log(`Post ${id} is already being processed. Skipping.`);
        continue;
      }

      // --- Posted/Error Check ---
      if (postId && postId.trim() !== "" && postId.trim() !== "ERROR") {
        Logger.log(
          `Post ${id} has already been posted (postId: ${postId}). Skipping.`
        );
        continue;
      }
      if (postId && postId.trim() === "ERROR") {
        Logger.log(`Post ${id} previously resulted in an error. Skipping.`);
        continue;
      }

      // --- Schedule Date Check ---
      let scheduleDate: Date | null = null;
      try {
        if (postScheduleValue instanceof Date) {
          scheduleDate = postScheduleValue;
        } else if (
          typeof postScheduleValue === "string" &&
          postScheduleValue.trim() !== ""
        ) {
          scheduleDate = new Date(postScheduleValue);
          if (isNaN(scheduleDate.getTime())) {
            scheduleDate = null;
          }
        }
      } catch (dateError) {
        scheduleDate = null;
      }

      if (!scheduleDate) {
        Logger.log(
          `Skipping post ${id} due to missing or invalid schedule date.`
        );
        continue;
      }

      // --- Time Condition Check ---
      const now = new Date();
      // Get trigger interval dynamically
      const triggerInterval = getTriggerIntervalMinutes(HANDLER_FUNCTION_NAME);
      const futureThreshold = new Date(now.getTime() + triggerInterval * 60000); // Use dynamic interval
      const isPastOrPresent = scheduleDate <= now;
      const isWithinFutureThreshold =
        scheduleDate > now && scheduleDate <= futureThreshold;

      if (isPastOrPresent || isWithinFutureThreshold) {
        Logger.log(
          `Post ${id} scheduled for ${scheduleDate.toISOString()} is eligible...`
        );
        cache.put(processingKey, "true", 600); // Set processing flag

        let actionTaken: "post" | "repost" | "none" = "none";
        let replyToPostId: string | null = null; // Keep replyToPostId in scope for postedRowData

        try {
          // Inner try for post/repost action
          let response: any;

          // --- Repost Check (優先) ---
          if (repostTargetId && /^\d+$/.test(repostTargetId.trim())) {
            const targetTweetId = repostTargetId.trim();
            Logger.log(
              `Attempting to repost tweet ID: ${targetTweetId} for internal ID: ${id}, Account: ${accountId}`
            );
            response = await repostTweet(targetTweetId, accountId);
            actionTaken = "repost";
          }
          // --- Regular Post/Reply/Quote Check ---
          else {
            actionTaken = "post";
            const mediaIds = mediaUrls
              ? await uploadMediaToX(mediaUrls, accountId)
              : [];

            // Determine replyToPostId
            if (inReplyToOnX && /^\d+$/.test(inReplyToOnX.trim())) {
              replyToPostId = inReplyToOnX.trim();
              Logger.log(
                `Using direct numeric value from inReplyToOnX as replyToPostId: ${replyToPostId}`
              );
            } else if (inReplyToInternal && inReplyToInternal.trim() !== "") {
              Logger.log(
                `inReplyToOnX is empty/invalid. Checking inReplyToInternal (${inReplyToInternal})...`
              );
              replyToPostId =
                getReplyToPostId(postedSheet, inReplyToInternal) ||
                getReplyToPostId(postsSheet, inReplyToInternal);
              if (!replyToPostId) {
                Logger.log(
                  `Warning: Could not find reply target post (internal ID: ${inReplyToInternal}) for post ${id}. Posting without reply.`
                );
              } else {
                Logger.log(
                  `Found replyToPostId (${replyToPostId}) for internal ID ${inReplyToInternal}.`
                );
              }
            }

            Logger.log(
              `Attempting to post tweet for ID: ${id}, Account: ${accountId}...`
            );
            response = await postTweet(
              content,
              mediaIds,
              replyToPostId,
              quoteId,
              accountId
            );
          }

          // --- Success Handling ---
          const rowNumber = rowMapping[id];
          if (!rowNumber) {
            throw new Error(
              `Internal consistency error: Row number not found for ID ${id}.`
            );
          }

          let success = false;
          let newPostIdOnX = ""; // For X Post ID or repost confirmation

          if (actionTaken === "post" && response?.data?.id) {
            success = true;
            newPostIdOnX = response.data.id;
            Logger.log(
              `Post successful for ID: ${id}! X Post ID: ${newPostIdOnX}.`
            );
          } else if (
            actionTaken === "repost" &&
            response?.data?.retweeted === true
          ) {
            success = true;
            newPostIdOnX = `Reposted: ${repostTargetId.trim()}`;
            Logger.log(
              `Repost successful for ID: ${id}! Target: ${repostTargetId.trim()}.`
            );
          }

          if (success) {
            const originalRowValues = postsSheet
              .getRange(rowNumber, 1, 1, postsSheet.getLastColumn())
              .getValues()[0];
            const postedRowData = MAIN_HEADERS.POSTED_HEADERS.map((header) => {
              const postHeaderIndex = postsHeaderMap[header];
              if (header === "postedAt") {
                return new Date();
              }
              if (header === "postId") {
                return newPostIdOnX;
              } // X ID or Repost confirmation
              if (header === "inReplyToOnX") {
                return actionTaken === "post" ? replyToPostId || "" : "";
              } // Only relevant for posts
              if (header === "quoteId") {
                return actionTaken === "post" ? quoteId || "" : "";
              } // Only relevant for posts
              if (postHeaderIndex !== undefined) {
                return originalRowValues[postHeaderIndex];
              }
              return "";
            });

            postedSheet.appendRow(postedRowData);
            postsSheet.deleteRow(rowNumber);
            Logger.log(`Moved row for ID: ${id} to Posted sheet.`);
            delete rowMapping[id];
            postMadeInThisRun = true;
            // break; // Optional: Stop after one success per run
          } else {
            throw new Error(
              `${
                actionTaken === "repost" ? "Repost" : "Post"
              } failed. Invalid/error response: ${JSON.stringify(response)}`
            );
          }
        } catch (error: any) {
          // Inner catch for post/repost action
          const context = `X ${
            actionTaken === "repost" ? "Repost" : "Post"
          } Error (Post ID: ${id})`;
          logErrorToSheet(error, context);
          Logger.log(`${context}: ${error.message}\nStack: ${error.stack}`);
          const rowNumber = rowMapping[id];
          if (rowNumber && postIdIndex !== undefined) {
            postsSheet.getRange(rowNumber, postIdIndex + 1).setValue("ERROR");
          } else {
            Logger.log(`Could not mark post ${id} as ERROR in sheet.`);
          }
        } finally {
          // Inner finally
          cache.remove(processingKey);
        }
      } else {
        // Logger.log(`Post ${id} is scheduled for the future. Skipping.`);
      }
    } // End for loop

    // --- Post-loop actions (Inside main try block) ---
    if (postMadeInThisRun) {
      // Check remaining posts for trigger deletion
      const remainingPostsData = postsSheet.getDataRange().getValues().slice(1); // Get fresh data
      let hasRemainingScheduledPosts = false;
      const scheduleIndexAfterLoop = postsHeaderMap["postSchedule"]; // Use map
      if (scheduleIndexAfterLoop !== undefined) {
        for (const row of remainingPostsData) {
          const scheduleVal = row[scheduleIndexAfterLoop];
          if (
            scheduleVal instanceof Date ||
            (typeof scheduleVal === "string" && scheduleVal.trim() !== "")
          ) {
            try {
              const dt = new Date(scheduleVal);
              if (!isNaN(dt.getTime())) {
                hasRemainingScheduledPosts = true;
                break;
              }
            } catch (e) {
              /* ignore */
            }
          }
        }
      } else {
        Logger.log("Warning: Could not find schedule column index after loop.");
        // Assume there might be remaining posts if index is missing
        hasRemainingScheduledPosts = true;
      }

      if (!hasRemainingScheduledPosts) {
        Logger.log("No more scheduled posts found. Deleting trigger.");
        // Ensure deleteTriggerByHandler exists and is correctly imported/available
        if (utils.deleteTriggerByHandler) {
          utils.deleteTriggerByHandler(HANDLER_FUNCTION_NAME);
        } else {
          Logger.log(
            "Warning: utils.deleteTriggerByHandler function not found."
          );
        }
      }

      // Sort Posted sheet
      try {
        const postedHeaderMap = MAIN_HEADERS.POSTED_HEADERS.reduce(
          (map, header, index) => {
            map[header] = index;
            return map;
          },
          {} as HeaderMap
        );
        const postedAtIndex = postedHeaderMap["postedAt"];
        if (postedAtIndex !== undefined && postedSheet.getLastRow() > 1) {
          postedSheet
            .getRange(
              2,
              1,
              postedSheet.getLastRow() - 1,
              postedSheet.getLastColumn()
            )
            .sort({ column: postedAtIndex + 1, ascending: false });
          Logger.log("Sorted Posted sheet by postedAt descending.");
        }
      } catch (sortError: any) {
        Logger.log(`Error sorting Posted sheet: ${sortError}`);
        logErrorToSheet(sortError, "Error sorting Posted sheet");
      }
    } // End if(postMadeInThisRun)
  } catch (e: any) {
    // Main catch block
    Logger.log(
      `Critical error in autoPostToX: ${e.message}\nStack: ${e.stack}`
    );
    logErrorToSheet(e, "Critical error in autoPostToX");
  }
} // End autoPostToX

// ... (postTweet function - ensure signature includes quoteId) ...
async function postTweet(
  content: string,
  mediaIds: string[],
  replyToPostId: string | null,
  quoteId: string | null,
  accountId: string
): Promise<any> {
  const authData = getXAuthById(accountId);
  if (!authData) {
    throw new Error(`Auth data not found for account: ${accountId}`);
  }

  // NOTE: Ensure OAuth functions exist in utils.ts
  const oauthParams = utils.generateOAuthParams(authData.consumerKey);
  const requestBody: any = { text: content };
  if (mediaIds && mediaIds.length > 0) {
    requestBody.media = { media_ids: mediaIds };
  }
  if (replyToPostId) {
    requestBody.reply = { in_reply_to_tweet_id: replyToPostId };
  }
  if (quoteId && quoteId.trim() !== "") {
    requestBody.quote_tweet_id = quoteId.trim();
  }

  const signingKey = utils.generateSigningKey(
    authData.consumerSecret,
    authData.accessTokenSecret
  );
  const signatureBaseString = utils.generateSignatureBaseString(
    "POST",
    TWITTER_API_ENDPOINT,
    oauthParams,
    {}
  );
  const oauthSignature = utils.generateSignature(
    signatureBaseString,
    signingKey
  );
  oauthParams["oauth_signature"] = oauthSignature;
  const authHeader = utils.generateOAuthHeader(oauthParams);

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };

  try {
    const response = utils.fetchWithRetries(TWITTER_API_ENDPOINT, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    let responseJson: any = {};
    try {
      if (responseText) {
        responseJson = JSON.parse(responseText);
      }
    } catch (parseError) {
      Logger.log(
        `Warning: Could not parse post API response JSON: ${responseText}`
      );
    }

    if (responseCode >= 200 && responseCode < 300) {
      Logger.log(`Tweet posted successfully: ${responseJson?.data?.id}`);
      return responseJson;
    } else {
      Logger.log(
        `Tweet post failed. Status: ${responseCode}, Response: ${responseText}`
      );
      throw new Error(
        `X API Error (${responseCode}): ${
          responseJson?.title || "Unknown error"
        } - ${responseJson?.detail || responseText}`
      );
    }
  } catch (error: any) {
    Logger.log("Tweet post error:", error);
    throw error;
  }
}

// ... (getReplyToPostId function - check indices) ...
function getReplyToPostId(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  inReplyToInternal: string
): string | null {
  const idColIndex = HEADERS.POST_HEADERS.indexOf("id");
  const postIdColIndex = HEADERS.POST_HEADERS.indexOf("postId"); // Check against POST_HEADERS for consistency

  if (idColIndex === -1 || postIdColIndex === -1) {
    Logger.log(
      `Error in getReplyToPostId (${sheet.getName()}): Could not find header indices (id or postId).`
    );
    return null;
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][idColIndex] === inReplyToInternal) {
      const foundPostId = data[i][postIdColIndex] as string;
      // Check if postId is valid (not empty, not "ERROR", not a repost confirmation)
      if (
        foundPostId &&
        foundPostId.trim() !== "" &&
        foundPostId.trim() !== "ERROR" &&
        !foundPostId.startsWith("Reposted:")
      ) {
        Logger.log(
          `Found reply target postId: ${foundPostId} for internal ID ${inReplyToInternal} in sheet ${sheet.getName()}`
        );
        return foundPostId;
      } else {
        // Log even if found but invalid, helps debugging if searching multiple sheets
        Logger.log(
          `Found matching internal ID ${inReplyToInternal} in sheet ${sheet.getName()}, but postId column (${postIdColIndex}) is invalid: '${foundPostId}'.`
        );
      }
    }
  }
  return null; // Not found or no valid postId found
}

// --- repostTweet function ---
async function repostTweet(
  targetTweetId: string,
  accountId: string
): Promise<any> {
  const authData = getXAuthById(accountId);
  if (!authData) {
    throw new Error(`Auth data not found for account: ${accountId}`);
  }
  if (!authData.userId) {
    throw new Error(
      `User ID not found in auth data for account: ${accountId}. Cannot repost.`
    );
  }

  const userId = authData.userId;
  const repostEndpoint = TWITTER_API_REPOST_ENDPOINT_TEMPLATE.replace(
    "{userId}",
    userId
  );

  // NOTE: Ensure OAuth functions exist in utils.ts
  const oauthParams = utils.generateOAuthParams(authData.consumerKey);
  const requestBody = { tweet_id: targetTweetId };
  const signingKey = utils.generateSigningKey(
    authData.consumerSecret,
    authData.accessTokenSecret
  );
  const signatureBaseString = utils.generateSignatureBaseString(
    "POST",
    repostEndpoint,
    oauthParams,
    {}
  );
  const oauthSignature = utils.generateSignature(
    signatureBaseString,
    signingKey
  );
  oauthParams["oauth_signature"] = oauthSignature;
  const authHeader = utils.generateOAuthHeader(oauthParams);

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };

  try {
    const response = utils.fetchWithRetries(repostEndpoint, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    let responseJson: any = {};
    try {
      if (responseText) {
        responseJson = JSON.parse(responseText);
      }
    } catch (parseError) {
      Logger.log(
        `Warning: Could not parse repost API response JSON: ${responseText}`
      );
    }

    if (responseCode >= 200 && responseCode < 300) {
      if (responseJson?.data?.retweeted === true) {
        Logger.log(`Repost successful for target tweet: ${targetTweetId}`);
        return responseJson;
      } else {
        throw new Error(
          `Repost API success status (${responseCode}) but unexpected body: ${responseText}`
        );
      }
    } else {
      let errorDetail = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetail = `${errorJson?.title || "Unknown error"} - ${
          errorJson?.detail || responseText
        }`;
      } catch (parseError) {
        /* ignore */
      }
      Logger.log(
        `Repost failed for target ${targetTweetId}. Status: ${responseCode}, Response: ${responseText}`
      );
      throw new Error(
        `X API Error (${responseCode}) during repost: ${errorDetail}`
      );
    }
  } catch (error: any) {
    Logger.log(`Repost error for target ${targetTweetId}:`, error);
    throw error;
  }
}

// Removed declare const SHEETS... as it's imported
