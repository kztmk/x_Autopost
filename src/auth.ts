// auth.ts (認証関連の関数)

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
 * accountIdを引数にLibrary PropertiesからaccountIdをプレフィックスに持つ4つの変数を取得する。
 *
 * @param {string} accountId 取得したいaccountId
 * @return {object} accountIdに紐づくapiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret
 */
export function getAccountProperties(accountId) {
  const scriptProperties = PropertiesService.getScriptProperties();

  const apiKey = scriptProperties.getProperty(`${accountId}_apiKey`);
  const apiKeySecret = scriptProperties.getProperty(
    `${accountId}_apiKeySecret`
  );
  const apiAccessToken = scriptProperties.getProperty(
    `${accountId}_apiAccessToken`
  );
  const apiAccessTokenSecret = scriptProperties.getProperty(
    `${accountId}_apiAccessTokenSecret`
  );

  return {
    apiKey: apiKey,
    apiKeySecret: apiKeySecret,
    apiAccessToken: apiAccessToken,
    apiAccessTokenSecret: apiAccessTokenSecret,
  };
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
    getAccountProperties(accountId);

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
