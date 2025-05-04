/**
 * Twitter/X API との通信を担当するモジュール
 */

import * as auth from "../auth";
import { XAuthInfo } from "../types";
import * as utils from "../utils";

// X API v2のエンドポイント
const TWITTER_API_ENDPOINT = "https://api.twitter.com/2/tweets";
const TWITTER_API_REPOST_ENDPOINT_TEMPLATE =
  "https://api.twitter.com/2/users/{userId}/retweets";

/**
 * X APIを使用してツイートを投稿する
 * @param {XAuthInfo} authInfo - X認証情報
 * @param {object} payload - リクエストボディ
 * @returns {Promise<string>} 投稿成功時はツイートID、失敗時はnull
 */
export async function postTweet(
  authInfo: XAuthInfo,
  payload: any
): Promise<string> {
  const url = TWITTER_API_ENDPOINT;

  // OAuth1.0aのパラメータを用意
  const oauthParams = auth.generateOAuthParams(
    authInfo.apiKey,
    authInfo.accessToken
  );

  // 署名キーの生成
  const signingKey = auth.generateSigningKey(
    authInfo.apiKeySecret,
    authInfo.accessTokenSecret
  );

  // 署名ベース文字列の生成
  const signatureBaseString = auth.generateSignatureBaseString(
    "POST",
    url,
    oauthParams
  );

  // 署名の生成
  const signature = auth.generateSignature(signatureBaseString, signingKey);

  // OAuthヘッダーの生成
  const authHeader = auth.generateOAuthHeader({
    ...oauthParams,
    oauth_signature: signature,
  });

  // リクエストオプションの設定
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: authHeader,
    },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  };

  try {
    // リクエストを送信
    const response = utils.fetchWithRetries(url, options, 3);

    if (response.getResponseCode() === 201) {
      const responseData = JSON.parse(response.getContentText());
      Logger.log(
        `Tweet posted successfully. Tweet ID: ${responseData.data.id}`
      );
      return responseData.data.id;
    } else {
      const errorText = response.getContentText();
      Logger.log(
        `Failed to post tweet: ${response.getResponseCode()}, ${errorText}`
      );
      throw new Error(
        `Failed to post tweet: ${response.getResponseCode()}, ${errorText}`
      );
    }
  } catch (e: any) {
    Logger.log(`Exception when posting tweet: ${e.message}`);
    throw new Error(`Exception when posting tweet: ${e.message}`);
  }
}

/**
 * X APIを使用してリポスト（リツイート）を行う
 * @param {XAuthInfo} authInfo - X認証情報
 * @param {string} tweetId - リポスト対象のツイートID
 * @returns {Promise<boolean>} 成功時はtrue、失敗時はfalse
 */
export async function repostTweet(
  authInfo: XAuthInfo,
  tweetId: string
): Promise<boolean> {
  if (!tweetId) {
    throw new Error("Tweet ID is required for reposting");
  }

  // Find or get user ID from auth info
  const userId = await getUserId(authInfo);
  if (!userId) {
    throw new Error("User ID not found for the account");
  }

  const url = TWITTER_API_REPOST_ENDPOINT_TEMPLATE.replace("{userId}", userId);

  // OAuth1.0aのパラメータを用意
  const oauthParams = auth.generateOAuthParams(
    authInfo.apiKey,
    authInfo.accessToken
  );

  // 署名キーの生成
  const signingKey = auth.generateSigningKey(
    authInfo.apiKeySecret,
    authInfo.accessTokenSecret
  );

  // 署名ベース文字列の生成
  const signatureBaseString = auth.generateSignatureBaseString(
    "POST",
    url,
    oauthParams
  );

  // 署名の生成
  const signature = auth.generateSignature(signatureBaseString, signingKey);

  // OAuthヘッダーの生成
  const authHeader = auth.generateOAuthHeader({
    ...oauthParams,
    oauth_signature: signature,
  });

  // リクエストオプションの設定
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: authHeader,
    },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      tweet_id: tweetId,
    }),
  };

  try {
    // リクエストを送信
    const response = utils.fetchWithRetries(url, options, 3);

    if (response.getResponseCode() === 200) {
      Logger.log(`Tweet reposted successfully. Tweet ID: ${tweetId}`);
      return true;
    } else {
      const errorText = response.getContentText();
      Logger.log(
        `Failed to repost tweet: ${response.getResponseCode()}, ${errorText}`
      );
      throw new Error(
        `Failed to repost tweet: ${response.getResponseCode()}, ${errorText}`
      );
    }
  } catch (e: any) {
    Logger.log(`Exception when reposting tweet: ${e.message}`);
    throw new Error(`Exception when reposting tweet: ${e.message}`);
  }
}

/**
 * XAuthInfo からユーザーIDを取得する
 * キャッシュを使用して効率的にユーザーIDを管理する
 */
export async function getUserId(authInfo: XAuthInfo): Promise<string | null> {
  // Check if User ID is cached
  const cache = CacheService.getScriptCache();
  const cacheKey = `twitter_user_id_${authInfo.accountId}`;
  const cachedUserId = cache.get(cacheKey);

  if (cachedUserId) {
    return cachedUserId;
  }

  // If not cached, call the Twitter API to get user information
  const url = "https://api.twitter.com/2/users/me";

  // OAuth1.0aのパラメータを用意
  const oauthParams = auth.generateOAuthParams(
    authInfo.apiKey,
    authInfo.accessToken
  );

  // 署名キーの生成
  const signingKey = auth.generateSigningKey(
    authInfo.apiKeySecret,
    authInfo.accessTokenSecret
  );

  // 署名ベース文字列の生成
  const signatureBaseString = auth.generateSignatureBaseString(
    "GET",
    url,
    oauthParams
  );

  // 署名の生成
  const signature = auth.generateSignature(signatureBaseString, signingKey);

  // OAuthヘッダーの生成
  const authHeader = auth.generateOAuthHeader({
    ...oauthParams,
    oauth_signature: signature,
  });

  // リクエストオプションの設定
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "get",
    headers: {
      Authorization: authHeader,
    },
    muteHttpExceptions: true,
  };

  try {
    // リクエストを送信
    const response = utils.fetchWithRetries(url, options, 3);

    if (response.getResponseCode() === 200) {
      const responseData = JSON.parse(response.getContentText());
      const userId = responseData.data.id;

      if (userId) {
        // Cache the user ID for future use
        cache.put(cacheKey, userId, 21600); // Cache for 6 hours
        return userId;
      }
    }

    Logger.log(
      `Failed to get user information: ${response.getResponseCode()}, ${response.getContentText()}`
    );
    return null;
  } catch (e: any) {
    Logger.log(`Exception when getting user information: ${e.message}`);
    return null;
  }
}
