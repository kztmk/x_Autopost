// test/testApi.ts

import {
  clearAuthInfo,
  createTimeBasedTrigger,
  deleteAllPostsData,
  deleteAllTriggers,
  deletePostsData,
  getPostsData,
  uploadMediaFile,
  writeAuthInfo,
  writePostsData,
} from '../api'; // api.ts からインポート

/**
 *  各 functionName に対応するテスト関数 (スクリプトエディタから実行)
 */

/**
 * createTrigger のテスト関数
 * @param {string} interval トリガー間隔 (分)
 */
function testCreateTrigger(interval: string) {
  try {
    createTimeBasedTrigger(parseInt(interval));
    Logger.log('testCreateTrigger: トリガー作成処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testCreateTrigger エラー: ${e}`);
  }
}

/**
 * deleteTrigger のテスト関数
 */
function testDeleteTrigger() {
  try {
    deleteAllTriggers();
    Logger.log('testDeleteTrigger: トリガー削除処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testDeleteTrigger エラー: ${e}`);
  }
}

/**
 * clearAuthInfo のテスト関数
 */
function testClearAuthInfo() {
  try {
    clearAuthInfo();
    Logger.log('testClearAuthInfo: 認証情報クリア処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testClearAuthInfo エラー: ${e}`);
  }
}

/**
 * writeAuthInfo のテスト関数
 * @param {string} authInfoJson  XAuthInfoインターフェースに準拠したJSON文字列
 * 例: '{"authInfo": [{"accountId": "testAccount", "apiKey": "YOUR_API_KEY", "apiKeySecret": "YOUR_API_KEY_SECRET", "apiAccessToken": "YOUR_API_ACCESS_TOKEN", "apiAccessTokenSecret": "YOUR_API_ACCESS_TOKEN_SECRET"}]}'
 */
function testWriteAuthInfo(authInfoJson: string) {
  try {
    const e = {
      postData: {
        contents: authInfoJson,
      },
    } as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    writeAuthInfo(e);
    Logger.log('testWriteAuthInfo: 認証情報書き込み処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testWriteAuthInfo エラー: ${e}`);
  }
}

/**
 * deletePostsData のテスト関数
 * @param {string} postsDataJson XPostsDataインターフェースに準拠したJSON文字列 (削除する投稿IDの配列)
 * 例: '{"xPostsData": [{"id": "post1"}, {"id": "post2"}]}'
 */
function testDeletePostsData(postsDataJson: string) {
  try {
    const e = {
      postData: {
        contents: postsDataJson,
      },
    } as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    deletePostsData(e);
    Logger.log('testDeletePostsData: 投稿データ削除処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testDeletePostsData エラー: ${e}`);
  }
}

/**
 * deleteAllPostsData のテスト関数
 */
function testDeleteAllPostsData() {
  try {
    const e = {
      parameter: {
        functionName: 'deleteAllPostsData', // functionName パラメータを渡す
      },
    } as unknown as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    deleteAllPostsData(e);
    Logger.log(
      'testDeleteAllPostsData: 全投稿データ削除処理が正常に終了しました。'
    );
  } catch (e: any) {
    Logger.log(`testDeleteAllPostsData エラー: ${e}`);
  }
}

/**
 * writePostsData のテスト関数
 * @param {string} postsDataJson XPostsDataインターフェースに準拠したJSON文字列 (投稿データの配列)
 * 例: '{"xPostsData": [{"id": "post3", "postSchedule": "2024-01-03T10:00:00Z", "postTo": "account1", "contents": "Test post 3."}]}'
 */
function testWritePostsData(postsDataJson: string) {
  try {
    const e = {
      postData: {
        contents: postsDataJson,
      },
    } as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    writePostsData(e);
    Logger.log(
      'testWritePostsData: 投稿データ書き込み処理が正常に終了しました。'
    );
  } catch (e: any) {
    Logger.log(`testWritePostsData エラー: ${e}`);
  }
}

/**
 * getPostsData のテスト関数
 */
function testGetPostsData() {
  try {
    const e = {
      parameter: {
        functionName: 'getPostsData', // functionName パラメータを渡す
      },
    } as unknown as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    getPostsData(e);
    Logger.log('testGetPostsData: 投稿データ取得処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testGetPostsData エラー: ${e}`);
  }
}

/**
 * uploadMediaFile のテスト関数
 * @param {string} mediaFileJson XMediaFileDataインターフェースに準拠したJSON文字列 (メディアファイルデータ)
 * 例: '{"xMediaFileData": [{"filename": "test.jpg", "filedata": "BASE64_ENCODED_DATA", "mimeType": "image/jpeg"}]}'
 *  **filedata には Base64 エンコードされたファイルデータを入れてください。**
 */
function testUploadMediaFile(mediaFileJson: string) {
  try {
    const e = {
      postData: {
        contents: mediaFileJson,
      },
    } as GoogleAppsScript.Events.DoPost; // 型アサーションで DoPost イベントとして扱う
    uploadMediaFile(e);
    Logger.log(
      'testUploadMediaFile: メディアファイルアップロード処理が正常に終了しました。'
    );
  } catch (e: any) {
    Logger.log(`testUploadMediaFile エラー: ${e}`);
  }
}
