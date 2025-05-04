// auth.ts (認証関連の関数)
import { XAuthInfo } from "./types";
import { maskSensitive } from "./utils"; // Import the masking function

/**
 * RFC 3986準拠のパーセントエンコーディング
 * @param {string} str エンコードする文字列
 * @returns {string} エンコードされた文字列
 */
export function rfc3986Encode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27");
}

/**
 * Generates a random nonce for OAuth requests.
 * @returns {string} A random string.
 */
export function generateNonce(): string {
  // Utilities.getSecureRandomBytes is not available in Apps Script types, use UUID instead
  return Utilities.getUuid().replace(/-/g, "");
}

/**
 * OAuth1.0aパラメータを生成する関数
 * @param {string} consumerKey Consumer key
 * @param {string} accessToken Access token
 * @returns {{ [key: string]: string }} OAuth パラメータオブジェクト
 */
export function generateOAuthParams(
  consumerKey: string,
  accessToken: string
): { [key: string]: string } {
  return {
    oauth_consumer_key: consumerKey,
    oauth_token: accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: generateNonce(),
    oauth_version: "1.0",
  };
}

/**
 * 署名キーを生成する関数
 * @param {string} consumerSecret Consumer secret
 * @param {string} tokenSecret Token secret
 * @return {string} 署名キー
 */
export function generateSigningKey(
  consumerSecret: string,
  tokenSecret: string
): string {
  return `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(
    tokenSecret
  )}`;
}

/**
 * 署名ベース文字列を生成する関数
 * @param {string} method HTTPメソッド (POST, GETなど)
 * @param {string} url APIエンドポイント URL
 * @param {{ [key: string]: string }} params OAuthパラメータとリクエストパラメータを結合したもの
 * @return {string} 署名ベース文字列
 */
export function generateSignatureBaseString(
  method: string,
  url: string,
  params: { [key: string]: string }
): string {
  // パラメータをキーでソートし、RFC3986エンコードして結合
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${rfc3986Encode(key)}=${rfc3986Encode(params[key])}`)
    .join("&");

  // メソッド、URL、パラメータ文字列を結合
  return `${method.toUpperCase()}&${rfc3986Encode(url)}&${rfc3986Encode(
    sortedParams
  )}`;
}

/**
 * 署名を生成する関数 (HMAC-SHA1 + Base64エンコード)
 * @param {string} signatureBaseString 署名ベース文字列
 * @param {string} signingKey 署名キー (Consumer Secret と Access Token Secret から生成)
 * @return {string} 署名 (Base64エンコード済み)
 */
export function generateSignature(
  signatureBaseString: string,
  signingKey: string
): string {
  const signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    signatureBaseString,
    signingKey
  );
  return Utilities.base64Encode(signatureBytes);
}

/**
 * OAuth認証ヘッダーを生成する関数
 * @param {object} oauthParams OAuthパラメータ (oauth_signatureを含む)
 * @return {string} OAuth認証ヘッダー
 */
export function generateOAuthHeader(oauthParams: {
  [key: string]: string;
}): string {
  return `OAuth ${Object.entries(oauthParams)
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(", ")}`;
}

/**
 * 指定されたaccountIdに対応するXの認証情報をプロパティサービスから取得します。
 *
 * @param {string} accountId 取得対象のXアカウントID。
 * @return {XAuthInfo} 見つかったXAuthInfoオブジェクト。
 * @throws {Error} accountIdが指定されていない場合、対象のaccountIdに対応する情報が見つからない場合、
 *                 またはプロパティの読み取り/パースに失敗した場合。
 */
export function getXAuthById(accountId: string): XAuthInfo {
  // accountId のバリデーション
  if (!accountId || typeof accountId !== "string" || accountId.trim() === "") {
    throw new Error("Invalid or missing accountId provided.");
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
    const authInfo: Partial<XAuthInfo> = JSON.parse(authInfoString); // Parse as partial first

    // 必須プロパティの存在チェック
    if (
      typeof authInfo !== "object" ||
      authInfo === null ||
      !authInfo.apiKey ||
      !authInfo.apiKeySecret ||
      !authInfo.accessToken ||
      !authInfo.accessTokenSecret
      // userId はオプションかもしれないのでチェックしない
    ) {
      throw new Error(
        `Invalid or incomplete data format found for accountId '${accountId}'. Required fields missing.`
      );
    }

    // Log masked sensitive information
    Logger.log(
      `XAuthInfo retrieved for ${accountId}: ${JSON.stringify({
        ...authInfo,
        apiKey: maskSensitive(authInfo.apiKey),
        apiKeySecret: maskSensitive(authInfo.apiKeySecret),
        accessToken: maskSensitive(authInfo.accessToken),
        accessTokenSecret: maskSensitive(authInfo.accessTokenSecret),
      })}`
    );
    // Cast to XAuthInfo after validation
    return authInfo as XAuthInfo;
  } catch (e: any) {
    // JSON.parseのエラーなどもここで捕捉される
    Logger.log(`Error getting XAuthInfo for accountId ${accountId}: ${e}`);
    // 元のエラーメッセージを含めて再スローするか、より汎用的なメッセージにする
    if (
      e.message.includes("not found") ||
      e.message.includes("Required fields missing")
    ) {
      throw e; // Specific errors are re-thrown
    } else {
      throw new Error(
        `Failed to get or parse XAuthInfo for accountId ${accountId}: ${e.message}`
      );
    }
  }
}
