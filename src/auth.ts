// auth.ts (認証関連の関数)
import { XAuthInfo } from "./types";

// ** 🌟  ここに Google Drive の "X-mediaFiles" フォルダの ID を指定してください 🌟 **
// const TEST_MEDIA_FOLDER_ID = 'YOUR_X_MEDIA_FILES_FOLDER_ID'; // 例: 'xxxxxxxxxxxxxxxxxxxxxxxxx'  <-  実際のフォルダIDに置き換えてください

/**
 * 署名ベース文字列を生成する関数
 * @param {string} method HTTPメソッド (POST)
 * @param {string} url APIエンドポイント URL
 * @param {object} params OAuthパラメータ
 * @return {string} 署名ベース文字列
 */
export function generateSignatureBaseString(method, url, params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return `${method.toUpperCase()}&${encodeURIComponent(
    url
  )}&${encodeURIComponent(sortedParams)}`;
}

/**
 * 署名を生成する関数 (HMAC-SHA1 + Base64エンコード)
 * @param {string} signatureBaseString 署名ベース文字列
 * @param {string} signingKey 署名キー
 * @return {string} 署名 (Base64エンコード済み)
 */
export function generateSignature(signatureBaseString, signingKey) {
  // @ts-ignore  //
  const signature = Utilities.computeHmacSha1Signature(
    signatureBaseString,
    signingKey
  );
  return Utilities.base64Encode(signature);
}

/**
 * 指定されたaccountIdに対応するXの認証情報をプロパティサービスから取得します。
 *
 * @param {string} accountId 取得対象のXアカウントID。
 * @return {XAuthInfo} 見つかったXAuthInfoオブジェクト。
 * @throws {Error} accountIdが指定されていない場合、対象のaccountIdに対応する情報が見つからない場合、
 *                 またはプロパティの読み取り/パースに失敗した場合。
 */
export function getXAuthById(accountId) {
  // accountId のバリデーション
  if (!accountId || typeof accountId !== 'string' || accountId.trim() === '') {
    throw new Error('Invalid or missing accountId provided.');
  }

  const properties = PropertiesService.getScriptProperties();
  const propKey = `xauth_${accountId.trim()}`; // キーを生成 (念のためtrim)

  try {
    const authInfoString = properties.getProperty(propKey);

    // プロパティが存在しない場合
    if (!authInfoString) {
      throw new Error(`XAuthInfo for accountId '${accountId}' not found.`);
    }

    // JSON文字列をパースしてオブジェクトに変換
    const authInfo = JSON.parse(authInfoString);

    // パース結果がオブジェクトであることを念のため確認
    if (typeof authInfo !== 'object' || authInfo === null) {
        throw new Error(`Invalid data format found for accountId '${accountId}'.`);
    }

    Logger.log(`XAuthInfo retrieved for accountId: ${accountId}`);
    return authInfo; // XAuthInfoオブジェクトを返す

  } catch (e: any) {
    // JSON.parseのエラーなどもここで捕捉される
    Logger.log(`Error getting XAuthInfo for accountId ${accountId}: ${e}`);
    // 元のエラーメッセージを含めて再スローするか、より汎用的なメッセージにする
    if (e.message.includes('not found')) {
         throw e; // 見つからないエラーはそのままスロー
    } else {
         throw new Error(`Failed to get or parse XAuthInfo for accountId ${accountId}: ${e.message}`);
    }
  }
}

/**
 * メディアID配列とテキストを指定してツイートを投稿する関数 (v2 API)
 * @param {accountId} string 投稿先ID
 * @param {string} xPostUrl
 */
export function generateAuthHeader(accountId, xPostUrl) {
  // OAuthパラメータの取得
  // LibraryProperties から取得
  const { apiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret } =
    getXAuthById(accountId);

  if (!apiKey || !apiKeySecret || !apiAccessToken || !apiAccessTokenSecret) {
    throw new Error('APIキーまたはアクセストークンが設定されていません');
  }

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_token: apiAccessToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: Utilities.base64Encode(
      // @ts-ignore  //
      Utilities.getSecureRandomBytes(32)
    ).replace(/\W/g, ''),
    oauth_version: '1.0',
  };

  // 署名キーの生成
  const signingKey = `${encodeURIComponent(apiKeySecret)}&${encodeURIComponent(
    apiAccessTokenSecret
  )}`;

  // 署名ベース文字列の生成 (ツイート投稿URLとOAuthパラメータを使用)
  const signatureBaseString = generateSignatureBaseString(
    'POST',
    xPostUrl,
    oauthParams
  ); // ツイートURL, OAuth params のみ署名対象
  const oauthSignature = generateSignature(signatureBaseString, signingKey);

  // OAuth認証ヘッダーの生成
  // @ts-ignore
  const authHeader = `OAuth ${Object.entries({
    ...oauthParams,
    oauth_signature: oauthSignature,
  })
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(', ')}`;

  return authHeader;
}
