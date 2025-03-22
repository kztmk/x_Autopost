// media.js (メディアアップロード)
import {
  generateSignature,
  generateSignatureBaseString,
  getAccountProperties,
} from './auth';
import { logErrorToSheet, sendErrorEmail } from './utils';

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
 * Google DriveのファイルURLからファイルIDを取得する
 * @param url
 * @returns id or
 */
function getFileIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    let fileId = urlObj.pathname.split('/')[3]; // 例: /file/d/ファイルID/view の場合、3番目の要素がファイルID
    if (!fileId) {
      // pathname から取得できない場合は、searchParams から id パラメータを探す
      fileId = urlObj.searchParams.get('id') || '';
    }
    return fileId;
  } catch (e) {
    // URLパースエラーの場合、またはファイルIDが見つからない場合は null を返す
    return null;
  }
}

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

  const { apiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret } =
    getAccountProperties(accountId);

  if (!apiKey || !apiKeySecret || !apiAccessToken || !apiAccessTokenSecret) {
    throw new Error('APIキーまたはアクセストークンが設定されていません');
  }

  for (const url of urls) {
    let mediaId: string | null = null; // 各ファイルごとの mediaId
    try {
      const fileId = getFileIdFromUrl(url);
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

      // blob
      const blob = file.getBlob();
      // BlobをBase64エンコード
      const base64Data = Utilities.base64Encode(blob.getBytes());

      // OAuthパラメータ作成のためheaerの情報を取得
      //const authHeader = generateAuthHeader(accountId, TWITTER_MEDIA_UPLOAD_ENDPOINT);

      // OAuthパラメータ設定（メディアアップロード用）
      const oauthParams = {
        oauth_consumer_key: apiKey,
        oauth_token: apiAccessToken,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: Utilities.base64Encode(
          // @ts-ignore
          Utilities.getSecureRandomBytes(32)
        ).replace(/\W/g, ''),
        oauth_version: '1.0',
      };

      const uploadParams = {
        media_data: base64Data,
        ...oauthParams,
      };

      // 署名キーの作成
      const signingKey = `${encodeURIComponent(
        apiKeySecret
      )}&${encodeURIComponent(apiAccessTokenSecret)}`;

      // 署名ベース文字列の生成
      const signatureBaseString = generateSignatureBaseString(
        'POST',
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
        .join(', ')}`;

      // UrlFetchApp でメディアアップロード API v1.1 を実行
      const options = {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded', // メディアアップロード API v1.1 は x-www-form-urlencoded
        },
        payload: uploadParams, // payload に uploadParams を指定 (UrlFetchApp が自動で x-www-form-urlencoded 形式に変換)
      };

      try {
        const response = UrlFetchApp.fetch(
          TWITTER_MEDIA_UPLOAD_ENDPOINT,
          // @ts-ignore
          options
        ); // APIリクエストを実行
        const json = response.getContentText(); // レスポンスをJSON文字列として取得
        const data = JSON.parse(json); // JSON文字列をJavaScriptオブジェクトにパース
        const mediaId = data.media_id_string; // media_id_string を取得 (メディアID)
        Logger.log(
          `URL "${url}" のファイルをアップロードしました。Media ID:`,
          mediaId
        ); // ログ出力
        mediaIds.push(mediaId); // アップロードされたメディアIDを配列に追加
      } catch (error) {
        Logger.log(
          `URL "${url}" のファイルのメディアアップロードエラー:`,
          error
        ); // エラーログ出力
        throw error; // エラーをthrowして上位関数 (testUploadMediaAndTweet) で処理できるようにする (処理中断)
      }
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
