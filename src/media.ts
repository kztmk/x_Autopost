import {
  generateSignature,
  generateSignatureBaseString,
  getXAuthById,
} from "./auth";
import { logErrorToSheet } from "./utils";
// import * as utils from "./utils"; // Assuming fetchWithRetries is in utils - Consider using if needed

const TWITTER_MEDIA_UPLOAD_ENDPOINT =
  "https://upload.twitter.com/1.1/media/upload.json";
const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunk size (adjust as needed, max 5MB recommended)

// X (Twitter) がサポートするメディアタイプと拡張子のマッピング (必要に応じて更新)
const SUPPORTED_MEDIA_TYPES: { [key: string]: string } = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
  // 'video/quicktime': 'mov', // 状況により追加
};

// --- Helper Function for Simple Upload (Images, GIFs) ---
async function _uploadSimpleMedia(
  accountId: string,
  blob: GoogleAppsScript.Base.Blob,
  mediaType: string
): Promise<string> {
  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } =
    getXAuthById(accountId);
  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      `[Simple Upload] APIキーまたはアクセストークンが設定されていません (Account: ${accountId})`
    );
  }

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_token: accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: Utilities.getUuid(), // Use UUID for nonce
    oauth_version: "1.0",
  };

  const signingKey = `${encodeURIComponent(apiKeySecret)}&${encodeURIComponent(
    accessTokenSecret
  )}`;
  const signatureBaseString = generateSignatureBaseString(
    "POST",
    TWITTER_MEDIA_UPLOAD_ENDPOINT,
    oauthParams // Simple upload doesn't include extra params in signature base
  );
  const oauthSignature = generateSignature(signatureBaseString, signingKey);

  const authHeader = `OAuth ${Object.entries({
    ...oauthParams,
    oauth_signature: oauthSignature,
  })
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(", ")}`;

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    headers: {
      Authorization: authHeader,
    },
    payload: {
      media: blob,
    },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(TWITTER_MEDIA_UPLOAD_ENDPOINT, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    const data = JSON.parse(responseText);
    const mediaId = data.media_id_string;
    if (!mediaId) {
      throw new Error(
        "[Simple Upload] media_id_string not found in successful response."
      );
    }
    return mediaId;
  } else {
    let errorDetail = responseText;
    try {
      const errorJson = JSON.parse(responseText);
      errorDetail = errorJson?.errors?.[0]?.message || responseText;
    } catch (parseError) {
      /* ignore */
    }
    throw new Error(
      `[Simple Upload] X Media API Error (${responseCode}): ${errorDetail}`
    );
  }
}

// --- Helper Function for Chunked Upload (Videos) ---
async function _uploadChunkedVideo(
  accountId: string,
  blob: GoogleAppsScript.Base.Blob,
  mediaType: string,
  fileSize: number
): Promise<string> {
  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } =
    getXAuthById(accountId);
  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      `[Chunked Upload] APIキーまたはアクセストークンが設定されていません (Account: ${accountId})`
    );
  }
  const signingKey = `${encodeURIComponent(apiKeySecret)}&${encodeURIComponent(
    accessTokenSecret
  )}`;

  // 1. INIT
  let mediaId: string;
  try {
    const initParams = {
      command: "INIT",
      total_bytes: fileSize.toString(),
      media_type: mediaType,
      media_category: "tweet_video", // Assuming video is for tweets
    };
    const initOauthParams = {
      oauth_consumer_key: apiKey,
      oauth_token: accessToken,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: Utilities.getUuid(),
      oauth_version: "1.0",
      ...initParams, // Include command params in signature base for INIT
    };
    const initSignatureBaseString = generateSignatureBaseString(
      "POST",
      TWITTER_MEDIA_UPLOAD_ENDPOINT,
      initOauthParams
    );
    const initOauthSignature = generateSignature(
      initSignatureBaseString,
      signingKey
    );
    const initAuthHeader = `OAuth ${Object.entries({
      ...initOauthParams,
      oauth_signature: initOauthSignature,
    })
      .filter(([key]) => key.startsWith("oauth_")) // Only include oauth params in header
      .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
      .join(", ")}`;

    const initOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      headers: {
        Authorization: initAuthHeader,
        "Content-Type": "application/x-www-form-urlencoded", // Required for INIT
      },
      payload: initParams, // Send params as payload
      muteHttpExceptions: true,
    };

    Logger.log(
      `[Chunked Upload INIT] Requesting with params: ${JSON.stringify(
        initParams
      )}`
    );
    const initResponse = UrlFetchApp.fetch(
      TWITTER_MEDIA_UPLOAD_ENDPOINT,
      initOptions
    );
    const initResponseCode = initResponse.getResponseCode();
    const initResponseText = initResponse.getContentText();
    Logger.log(
      `[Chunked Upload INIT] Response: ${initResponseCode} - ${initResponseText}`
    );

    if (initResponseCode < 200 || initResponseCode >= 300) {
      throw new Error(`INIT failed (${initResponseCode}): ${initResponseText}`);
    }
    const initData = JSON.parse(initResponseText);
    mediaId = initData.media_id_string;
    if (!mediaId) {
      throw new Error("INIT successful but media_id_string not found.");
    }
    Logger.log(`[Chunked Upload INIT] Success. Media ID: ${mediaId}`);
  } catch (error: any) {
    throw new Error(`[Chunked Upload INIT] Error: ${error.message}`);
  }

  // 2. APPEND
  const fileBytes = blob.getBytes();
  let segmentIndex = 0;
  for (let i = 0; i < fileSize; i += CHUNK_SIZE) {
    const chunk = Utilities.newBlob(
      fileBytes.slice(i, i + CHUNK_SIZE),
      mediaType
    );

    try {
      const appendParams = {
        command: "APPEND",
        media_id: mediaId,
        segment_index: segmentIndex.toString(),
      };
      const appendOauthParams = {
        oauth_consumer_key: apiKey,
        oauth_token: accessToken,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: Utilities.getUuid(),
        oauth_version: "1.0",
        // command, media_id, segment_index are NOT included in signature base for multipart APPEND
      };
      const appendSignatureBaseString = generateSignatureBaseString(
        "POST",
        TWITTER_MEDIA_UPLOAD_ENDPOINT,
        appendOauthParams // Only OAuth params here
      );
      const appendOauthSignature = generateSignature(
        appendSignatureBaseString,
        signingKey
      );
      const appendAuthHeader = `OAuth ${Object.entries({
        ...appendOauthParams,
        oauth_signature: appendOauthSignature,
      })
        .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
        .join(", ")}`;

      const appendPayload = {
        ...appendParams,
        media: chunk, // Add the actual chunk data here
      };

      const appendOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: "post",
        headers: {
          Authorization: appendAuthHeader,
          // Content-Type: multipart/form-data is set automatically by UrlFetchApp
        },
        payload: appendPayload,
        muteHttpExceptions: true,
      };

      Logger.log(
        `[Chunked Upload APPEND] Uploading segment ${segmentIndex} for Media ID: ${mediaId}`
      );
      const appendResponse = UrlFetchApp.fetch(
        TWITTER_MEDIA_UPLOAD_ENDPOINT,
        appendOptions
      );
      const appendResponseCode = appendResponse.getResponseCode();
      const appendResponseText = appendResponse.getContentText(); // Log response text for debugging
      Logger.log(
        `[Chunked Upload APPEND] Response: ${appendResponseCode} - ${appendResponseText}`
      );

      if (appendResponseCode < 200 || appendResponseCode >= 300) {
        // Consider adding retry logic here for transient errors
        throw new Error(
          `APPEND failed for segment ${segmentIndex} (${appendResponseCode}): ${appendResponseText}`
        );
      }
      Logger.log(
        `[Chunked Upload APPEND] Segment ${segmentIndex} uploaded successfully.`
      );
      segmentIndex++;
      Utilities.sleep(500); // Add a small delay between chunks if needed
    } catch (error: any) {
      throw new Error(
        `[Chunked Upload APPEND] Error on segment ${segmentIndex}: ${error.message}`
      );
    }
  }

  // 3. FINALIZE
  try {
    const finalizeParams = {
      command: "FINALIZE",
      media_id: mediaId,
    };
    const finalizeOauthParams = {
      oauth_consumer_key: apiKey,
      oauth_token: accessToken,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: Utilities.getUuid(),
      oauth_version: "1.0",
      ...finalizeParams, // Include command params in signature base for FINALIZE
    };
    const finalizeSignatureBaseString = generateSignatureBaseString(
      "POST",
      TWITTER_MEDIA_UPLOAD_ENDPOINT,
      finalizeOauthParams
    );
    const finalizeOauthSignature = generateSignature(
      finalizeSignatureBaseString,
      signingKey
    );
    const finalizeAuthHeader = `OAuth ${Object.entries({
      ...finalizeOauthParams,
      oauth_signature: finalizeOauthSignature,
    })
      .filter(([key]) => key.startsWith("oauth_")) // Only include oauth params in header
      .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
      .join(", ")}`;

    const finalizeOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      headers: {
        Authorization: finalizeAuthHeader,
        "Content-Type": "application/x-www-form-urlencoded", // Required for FINALIZE
      },
      payload: finalizeParams,
      muteHttpExceptions: true,
    };

    Logger.log(`[Chunked Upload FINALIZE] Requesting for Media ID: ${mediaId}`);
    const finalizeResponse = UrlFetchApp.fetch(
      TWITTER_MEDIA_UPLOAD_ENDPOINT,
      finalizeOptions
    );
    const finalizeResponseCode = finalizeResponse.getResponseCode();
    const finalizeResponseText = finalizeResponse.getContentText();
    Logger.log(
      `[Chunked Upload FINALIZE] Response: ${finalizeResponseCode} - ${finalizeResponseText}`
    );

    if (finalizeResponseCode < 200 || finalizeResponseCode >= 300) {
      throw new Error(
        `FINALIZE failed (${finalizeResponseCode}): ${finalizeResponseText}`
      );
    }
    const finalizeData = JSON.parse(finalizeResponseText);

    // Handle potential processing delay (optional - basic check here)
    if (finalizeData.processing_info) {
      Logger.log(
        `[Chunked Upload FINALIZE] Media processing initiated: ${JSON.stringify(
          finalizeData.processing_info
        )}`
      );
      // You might need to implement polling using the STATUS command here
      // For now, assume FINALIZE success means the ID is usable shortly
      Utilities.sleep(5000); // Wait 5 seconds as a simple measure
    }

    const finalMediaId = finalizeData.media_id_string;
    if (!finalMediaId) {
      throw new Error(
        "FINALIZE successful but media_id_string not found in final response."
      );
    }
    Logger.log(
      `[Chunked Upload FINALIZE] Success. Final Media ID: ${finalMediaId}`
    );
    return finalMediaId; // Return the finalized media ID
  } catch (error: any) {
    throw new Error(`[Chunked Upload FINALIZE] Error: ${error.message}`);
  }
}

/**
 * Google DriveのファイルをXにアップロードし、メディアIDの配列を返す。
 * 画像/GIFはシンプルアップロード、動画はチャンクアップロードを使用。
 *
 * @param {string} mediaUrls JSON string representing an array of media objects, each with a fileId.
 * @param {string} accountId アカウントID (小文字)
 * @return {Promise<string[]>} メディアIDの配列
 */
export async function uploadMediaToX(
  mediaUrls: string, // This is now a JSON string
  accountId: string
): Promise<string[]> {
  const mediaIds: string[] = [];
  let mediaObjects: { fileId: string; [key: string]: any }[] = [];

  try {
    if (mediaUrls && mediaUrls.trim() !== "" && mediaUrls.trim() !== "[]") {
      mediaObjects = JSON.parse(mediaUrls);
      if (!Array.isArray(mediaObjects)) {
        throw new Error("Parsed mediaUrls is not an array.");
      }
    }
  } catch (e: any) {
    throw new Error(`Failed to parse mediaUrls JSON: ${e.message}`);
  }

  if (mediaObjects.length === 0) {
    Logger.log("No media objects found to upload.");
    return [];
  }

  // Check auth keys once before the loop (though helpers check again)
  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } =
    getXAuthById(accountId);
  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      `[Main Function] APIキーまたはアクセストークンが設定されていません (Account: ${accountId})`
    );
  }

  for (const mediaObject of mediaObjects) {
    const fileId = mediaObject.fileId;
    let currentMediaId: string | null = null;

    const file = DriveApp.getFileById(fileId);
    const fileSize = file.getSize();
    const mediaType = file.getMimeType();
    const blob = file.getBlob();

    try {
      if (!fileId || typeof fileId !== "string" || fileId.trim() === "") {
        throw new Error(
          `Invalid or missing fileId in media object: ${JSON.stringify(
            mediaObject
          )}`
        );
      }

      Logger.log(
        `Processing File ID: ${fileId}, Type: ${mediaType}, Size: ${fileSize}`
      );

      if (!SUPPORTED_MEDIA_TYPES[mediaType]) {
        throw new Error(
          `Unsupported media type: ${mediaType} for file ID: ${fileId}`
        );
      }

      // --- Choose upload method based on media type ---
      if (mediaType.startsWith("video/")) {
        Logger.log(`Using Chunked Upload for ${fileId}`);
        currentMediaId = await _uploadChunkedVideo(
          accountId,
          blob,
          mediaType,
          fileSize
        );
      } else {
        Logger.log(`Using Simple Upload for ${fileId}`);
        currentMediaId = await _uploadSimpleMedia(accountId, blob, mediaType);
      }
      // ------------------------------------------------

      if (currentMediaId) {
        Logger.log(
          `File ID "${fileId}" uploaded successfully. Media ID: ${currentMediaId}`
        );
        mediaIds.push(currentMediaId);
      } else {
        // This case should ideally be handled by errors within helpers
        throw new Error(
          `Upload completed but no Media ID returned for File ID: ${fileId}`
        );
      }
    } catch (error: any) {
      const context = `Media Upload Error (File ID: ${
        fileId || "N/A"
      }, Account: ${accountId}, Type: ${mediaType || "N/A"})`;
      logErrorToSheet(error, context); // Log to sheet
      const errorMessage = `${context}: ${error.message} \nStack: ${
        error.stack || "N/A"
      }`;
      Logger.log(errorMessage); // Log to Apps Script logger

      // Decide whether to stop all uploads or skip the failed one.
      // Currently stops all by re-throwing. To skip, comment out the throw.
      throw new Error(
        `Failed to upload media for File ID ${fileId}: ${error.message}`
      ); // Re-throw to stop processing
      // Logger.log(`Skipping upload for File ID "${fileId}" due to error.`); // Uncomment to skip instead
    }
    Utilities.sleep(1000); // Add delay between processing files if needed
  } // End of for loop

  Logger.log(
    `Finished uploading media. Total successful uploads: ${mediaIds.length}`
  );
  return mediaIds;
}
