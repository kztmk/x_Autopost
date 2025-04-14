// media.js (メディアアップロード)
import {
  generateSignature,
  generateSignatureBaseString,
  getXAuthById,
} from "./auth";
import { logErrorToSheet, sendErrorEmail } from "./utils";
import * as utils from "./utils"; // Assuming fetchWithRetries is in utils

const TWITTER_MEDIA_UPLOAD_ENDPOINT =
  "https://upload.twitter.com/1.1/media/upload.json";

// X (Twitter) がサポートするメディアタイプと拡張子のマッピング (必要に応じて更新)
const SUPPORTED_MEDIA_TYPES: { [key: string]: string } = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
  // 'video/quicktime': 'mov', // 状況により追加
};

/**
 * Google DriveのファイルをXにアップロードし、メディアIDの配列を返す。(シンプルアップロード)
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
  let mediaObjects: { fileId: string; [key: string]: any }[] = []; // Define type for parsed objects

  try {
    // Parse the JSON string into an array of objects
    if (mediaUrls && mediaUrls.trim() !== "" && mediaUrls.trim() !== "[]") {
      mediaObjects = JSON.parse(mediaUrls);
      if (!Array.isArray(mediaObjects)) {
        throw new Error("Parsed mediaUrls is not an array.");
      }
    }
  } catch (e: any) {
    throw new Error(`Failed to parse mediaUrls JSON: ${e.message}`);
  }

  // If no valid media objects, return empty array
  if (mediaObjects.length === 0) {
    Logger.log("No media objects found to upload.");
    return [];
  }

  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } =
    getXAuthById(accountId);

  // This check should now work correctly
  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error("APIキーまたはアクセストークンが設定されていません");
  }

  // Iterate through the parsed media objects
  for (const mediaObject of mediaObjects) {
    let mediaId: string | null = null; // Each file's mediaId
    const fileId = mediaObject.fileId; // Get fileId directly from the object

    try {
      // Validate fileId
      if (!fileId || typeof fileId !== "string" || fileId.trim() === "") {
        throw new Error(
          `Invalid or missing fileId in media object: ${JSON.stringify(
            mediaObject
          )}`
        );
      }

      // Get the file using the fileId
      const file = DriveApp.getFileById(fileId);
      const fileSize = file.getSize();
      const mediaType = file.getMimeType();

      // メディアタイプのチェック
      if (!SUPPORTED_MEDIA_TYPES[mediaType]) {
        throw new Error(
          `Unsupported media type: ${mediaType} for file ID: ${fileId}`
        );
      }

      // blob
      const blob = file.getBlob();
      // BlobをBase64エンコード // <-- No longer needed for multipart
      // const base64Data = Utilities.base64Encode(blob.getBytes());

      // OAuthパラメータ設定（メディアアップロード用）
      const oauthParams = {
        oauth_consumer_key: apiKey,
        oauth_token: accessToken, // Use accessToken
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: Utilities.base64Encode(
          Math.random().toString() + Date.now().toString()
        ), // Use simpler nonce generation
        oauth_version: "1.0",
      };

      // 署名キーの作成
      const signingKey = `${encodeURIComponent(
        apiKeySecret
      )}&${encodeURIComponent(accessTokenSecret)}`; // Use accessTokenSecret

      // 署名ベース文字列の生成
      const signatureBaseString = generateSignatureBaseString(
        "POST",
        TWITTER_MEDIA_UPLOAD_ENDPOINT,
        oauthParams
      );
      // 署名の生成
      const oauthSignature = generateSignature(signatureBaseString, signingKey);

      // OAuth認証ヘッダーの生成
      // @ts-ignore
      const authHeader = `OAuth ${Object.entries({
        ...oauthParams,
        oauth_signature: oauthSignature,
      })
        .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
        .join(", ")}`;

      // UrlFetchApp でメディアアップロード API v1.1 を実行 (Multipart)
      const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: "post",
        headers: {
          Authorization: authHeader,
          // Remove Content-Type header; UrlFetchApp sets it for multipart when payload contains Blob
        },
        payload: {
          // Send the raw Blob directly
          media: blob,
          // OAuth params are in the header, not payload for multipart
        },
        muteHttpExceptions: true,
      };

      // --- Remove the previous detailed logging block if it's too verbose now ---
      // Logger.log(`[Media Upload Debug] ...`);

      try {
        const response = UrlFetchApp.fetch(
          TWITTER_MEDIA_UPLOAD_ENDPOINT,
          options
        );
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();

        if (responseCode >= 200 && responseCode < 300) {
          const data = JSON.parse(responseText);
          mediaId = data.media_id_string; // Assign to the loop-scoped mediaId
          if (!mediaId) {
            throw new Error(
              "media_id_string not found in successful response."
            );
          }
          Logger.log(
            `File ID "${fileId}" uploaded successfully. Media ID: ${mediaId}`
          );
          mediaIds.push(mediaId);
        } else {
          // Handle API errors
          Logger.log(
            `Media upload failed for File ID "${fileId}". Status: ${responseCode}, Response: ${responseText}`
          );
          // Try parsing error response
          let errorDetail = responseText;
          try {
            const errorJson = JSON.parse(responseText);
            errorDetail = errorJson?.errors?.[0]?.message || responseText;
          } catch (parseError) {
            // Ignore if response is not JSON
          }
          throw new Error(
            `X Media API Error (${responseCode}): ${errorDetail}`
          );
        }
      } catch (error: any) {
        // Catch specific API call errors
        Logger.log(
          `Error during media upload API call for File ID "${fileId}":`,
          error
        );
        // Re-throw to be caught by the outer try-catch for logging to sheet/email
        throw error;
      }
    } catch (error: any) {
      // Catch errors related to getting file, parsing, or the API call re-throw
      const context = `Media Upload Error (File ID: ${
        fileId || "N/A"
      }, Account: ${accountId})`;
      logErrorToSheet(error, context); // エラーシートに記録
      const errorMessage = `${context}: ${error.message} \nStack: ${
        error.stack || "N/A"
      }`; // Use error.message and stack
      Logger.log(errorMessage);
      sendErrorEmail(errorMessage, "Media Upload Error"); //エラーメール送信
      // Decide if one failure should stop all uploads or just skip the failed one
      // Currently, it stops all by re-throwing. To skip, remove the throw below.
      throw error; // Re-throw to stop processing further media objects on error
      // Logger.log(`Skipping upload for File ID "${fileId}" due to error.`); // Log skipping if not re-throwing
    }
  } // End of for loop

  return mediaIds;
}
