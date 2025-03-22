// test/testApi.ts
// @ts-nocheck
// import {
//   clearAuthInfo,
//   createTimeBasedTrigger,
//   deleteAllPostsData,
//   deleteAllTriggers,
//   deletePostsData,
//   getPostsData,
//   uploadMediaFile,
//   writeAuthInfo,
//   writePostsData,
// } from '../api'; // api.ts からインポート

/**
 *  各 functionName に対応するテスト関数 (スクリプトエディタから実行)
 */

/**
 * createTrigger のテスト関数
 */
function testCreateTrigger() {
  try {
    createTimeBasedTrigger(5);
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
 */
function testWriteAuthInfo() {
  const authInfoJson =
    '{"authInfo": [{"accountId": "testAccount", "apiKey": "TEST_API_KEY", "apiKeySecret": "TEST_API_KEY_SECRET", "apiAccessToken": "TEST_API_ACCESS_TOKEN", "apiAccessTokenSecret": "TEST_API_ACCESS_TOKEN_SECRET"}]}';
  try {
    const e = {
      postData: {
        contents: authInfoJson,
      },
    } as GoogleAppsScript.Events.DoPost;
    writeAuthInfo(e);
    Logger.log('testWriteAuthInfo: 認証情報書き込み処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testWriteAuthInfo エラー: ${e}`);
  }
}

/**
 * deletePostsData のテスト関数
 */
function testDeletePostsData() {
  const postsDataJson = '{"xPostsData": [{"id": "post1"}]}';
  try {
    const e = {
      postData: {
        contents: postsDataJson,
      },
    } as GoogleAppsScript.Events.DoPost;
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
        functionName: 'deleteAllPostsData',
      },
      postData: {
        contents: '{}',
      },
    } as unknown as GoogleAppsScript.Events.DoPost;
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
 */
function testWritePostsData() {
  const postsDataJson =
    '{"xPostsData": [{"id": "post3", "postSchedule": "2024-01-03T10:00:00Z", "postTo": "account1", "contents": "Test post 3.", "media": ["image1.png"], "inReplyToInternal": ""}]}';
  try {
    const e = {
      postData: {
        contents: postsDataJson,
      },
    } as GoogleAppsScript.Events.DoPost;
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
        functionName: 'getPostsData',
      },
    } as unknown as GoogleAppsScript.Events.DoPost;
    getPostsData(e);
    Logger.log('testGetPostsData: 投稿データ取得処理が正常に終了しました。');
  } catch (e: any) {
    Logger.log(`testGetPostsData エラー: ${e}`);
  }
}

/**
 * uploadMediaFile のテスト関数
 */
function testUploadMediaFile() {
  const mediaFileJson =
    '{"xMediaFileData": [{"filename": "test.jpg", "filedata": "BASE64_ENCODED_DATA", "mimeType": "image/jpeg"}]}';
  try {
    const e = {
      postData: {
        contents: mediaFileJson,
      },
    } as GoogleAppsScript.Events.DoPost;
    uploadMediaFile(e);
    Logger.log(
      'testUploadMediaFile: メディアファイルアップロード処理が正常に終了しました。'
    );
  } catch (e: any) {
    Logger.log(`testUploadMediaFile エラー: ${e}`);
  }
}
