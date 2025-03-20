// media.js (メディアアップロード)
import { getAuthConfig } from './auth';
import { fetchWithRetries, logErrorToSheet, sendErrorEmail } from './utils';

const TWITTER_MEDIA_UPLOAD_ENDPOINT =
  'https://upload.twitter.com/1.1/media/upload.json';

// X (Twitter) がサポートするメディアタイプと拡張子のマッピング (必要に応じて更新)
const SUPPORTED_MEDIA_TYPES: { [key: string]: string } = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  // 'video/quicktime': 'mov', // 状況により追加
};

/**
 * Google DriveのファイルをXにアップロードし、メディアIDの配列を返す。(チャンクアップロード)
 *
 * @param {string[]} mediaUrls Google DriveのファイルURLの配列
 * @param {string} accountId アカウントID (小文字)
 * @return {Promise<string[]>} メディアIDの配列
 */
export async function uploadMediaToX(
  mediaUrls: string,
  accountId: string
): Promise<string[]> {
  const mediaIds: string[] = [];
  const urls = mediaUrls.split(',').filter((url) => url.trim() !== ''); // 空のURLを除外

  for (const url of urls) {
    let mediaId: string | null = null; // 各ファイルごとの mediaId
    try {
      const fileId = url.match(/[-\w]{25,}/);
      if (!fileId) {
        throw new Error(`Invalid Google Drive URL: ${url}`);
      }

      const file = DriveApp.getFileById(fileId[0]);
      const fileSize = file.getSize();
      const mediaType = file.getMimeType();

      // メディアタイプのチェック
      if (!SUPPORTED_MEDIA_TYPES[mediaType]) {
        throw new Error(`Unsupported media type: ${mediaType}`);
      }

      // 1. INIT
      mediaId = await initMediaUpload(fileSize, mediaType, accountId);

      // 2. APPEND (チャンクに分割してアップロード) 効率化のため UrlFetchApp.fetch を直接利用
      const chunkSize = 5 * 1024 * 1024; // 5MBチャンク (Twitter APIの制限に合わせる)

      // blobを直接扱わずFileオブジェクトからストリーム的に読み込む (効率化のため)
      for (let offset = 0; offset < fileSize; offset += chunkSize) {
        const chunkBlob = file
          .getBlob()
          .getDataAsString()
          .substring(offset / 2, offset / 2 + chunkSize / 2); //getDataAsString().substringで効率化
        const encodedChunk = Utilities.base64Encode(chunkBlob);

        const appendOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions =
          {
            method: 'post',
            headers: {
              Authorization: `Bearer ${
                getAuthConfig(accountId)[`${accountId}_bearerToken`]
              }`, // accountId を渡す
            },
            payload: {
              command: 'APPEND',
              media_id: mediaId,
              media_data: encodedChunk,
              segment_index: offset / chunkSize,
            },
            muteHttpExceptions: true,
          };

        const appendResponse = fetchWithRetries(
          TWITTER_MEDIA_UPLOAD_ENDPOINT,
          appendOptions
        );
        const appendStatus = appendResponse.getResponseCode();
        if (appendStatus < 200 || appendStatus >= 300) {
          const errorText = appendResponse.getContentText();
          throw new Error(
            `APPEND failed (status ${appendStatus}): ${errorText}`
          );
        }
        Logger.log(
          `Uploaded ${offset + encodedChunk.length} / ${fileSize} bytes`
        );
      }

      // 3. FINALIZE
      await finalizeMediaUpload(mediaId, accountId);

      // 4. STATUS (処理完了まで待機)
      await checkMediaStatus(mediaId, accountId);

      mediaIds.push(mediaId);
      Logger.log(`Media uploaded and finalized. Media ID: ${mediaId}`);
    } catch (error: any) {
      const context = `Media Upload Error (URL: ${url}, Media ID: ${
        mediaId || 'N/A'
      })`;
      logErrorToSheet(error, context); // エラーシートに記録
      const errorMessage = `${context}: ${error} \n Stack Trace:\n ${error.stack} `;
      Logger.log(errorMessage);
      sendErrorEmail(errorMessage, 'Media Upload Error'); //エラーメール送信
      throw error; // エラーを再スローして、呼び出し元(autoPostToX)で処理
    }
  }

  return mediaIds;
}

/**
 * メディアアップロードを初期化 (INIT).
 * @param {number} fileSize
 * @param {string} mediaType
 * @param {string} accountId
 * @returns {Promise<string>} mediaId
 */
async function initMediaUpload(
  fileSize: number,
  mediaType: string,
  accountId: string
): Promise<string> {
  const initOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${
        getAuthConfig(accountId)[`${accountId}_bearerToken`]
      }`, // accountId を渡す
    },
    payload: {
      command: 'INIT',
      total_bytes: fileSize,
      media_type: mediaType,
      media_category: 'tweet_image', // 必要に応じて (例: tweet_video, tweet_gif)
    },
    muteHttpExceptions: true, // エラー時もレスポンスを取得
  };

  const initResponse = fetchWithRetries(
    TWITTER_MEDIA_UPLOAD_ENDPOINT,
    initOptions
  );
  const initStatus = initResponse.getResponseCode();
  if (initStatus < 200 || initStatus >= 300) {
    const errorText = initResponse.getContentText();
    throw new Error(`INIT failed (status ${initStatus}): ${errorText}`);
  }

  const initJson = JSON.parse(initResponse.getContentText());

  if (!initJson.media_id_string) {
    throw new Error(
      `INIT failed: media_id_string not found in response. Response: ${initResponse.getContentText()}`
    );
  }
  return initJson.media_id_string;
}

/**
 * メディアアップロードを完了 (FINALIZE).
 * @param {string} mediaId
 * @param {string} accountId
 * @returns {Promise<void>}
 */
async function finalizeMediaUpload(
  mediaId: string,
  accountId: string
): Promise<void> {
  const finalizeOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${
        getAuthConfig(accountId)[`${accountId}_bearerToken`]
      }`, // accountId を渡す
    },
    payload: {
      command: 'FINALIZE',
      media_id: mediaId,
    },
    muteHttpExceptions: true,
  };

  const finalizeResponse = fetchWithRetries(
    TWITTER_MEDIA_UPLOAD_ENDPOINT,
    finalizeOptions
  );
  const finalizeStatus = finalizeResponse.getResponseCode();
  if (finalizeStatus < 200 || finalizeStatus >= 300) {
    const errorText = finalizeResponse.getContentText();
    throw new Error(`FINALIZE failed (status ${finalizeStatus}): ${errorText}`);
  }
}

/**
 * メディアの処理状態を確認する (STATUS).
 *
 * @param {string} mediaId メディアID
 * @param {string} accountId アカウントID
 * @returns {Promise<void>}
 */
async function checkMediaStatus(
  mediaId: string,
  accountId: string
): Promise<void> {
  let processingInfo: any = { state: 'pending' };
  let checkAfterMs = 1000; // 初回は1秒後にチェック

  while (
    processingInfo.state === 'pending' ||
    processingInfo.state === 'in_progress'
  ) {
    // GAS の await は Utilities.sleep() で代用
    await new Promise((resolve) => Utilities.sleep(checkAfterMs));

    const statusOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'get',
      headers: {
        Authorization: `Bearer ${
          getAuthConfig(accountId)[`${accountId}_bearerToken`]
        }`, // accountId を渡す
      },
      muteHttpExceptions: true,
    };

    const statusResponse = fetchWithRetries(
      `${TWITTER_MEDIA_UPLOAD_ENDPOINT}?command=STATUS&media_id=${mediaId}`,
      statusOptions
    );
    const statusJson = JSON.parse(statusResponse.getContentText());

    processingInfo = statusJson.processing_info;

    if (!processingInfo) {
      Logger.log(
        `STATUS check: processing_info not found. Response: ${statusResponse.getContentText()}`
      );
      return; // 処理情報がない場合は終了 (エラーではない)
    }

    if (processingInfo.state === 'failed') {
      throw new Error(
        `Media processing failed: ${processingInfo.error.message}`
      );
    }

    checkAfterMs = processingInfo.check_after_secs * 1000 || checkAfterMs * 2; // 指数バックオフ
    Logger.log(
      `Media processing status: ${processingInfo.state}, checking again in ${
        checkAfterMs / 1000
      } seconds`
    );
  }
  Logger.log(`Media processing completed. state: ${processingInfo.state}`);
}
