// api.js (API として公開する関数)
// api.tsの冒頭に追加

interface XApiKey {
  accountId: string;
  apiKey: string;
  apiKeySecret: string;
  apiAccessToken: string;
  apiAccessTokenSecret: string;
}

interface XAuthInfo {
  authInfo: XApiKey[];
}

interface XPostData {
  id: string;
  postSchedule: string;
  postTo: string;
  contents: string;
  media: string[];
  inReplyToInternal: string;
}

interface XPostsData {
  xPostsData: XPostData[];
}

interface XPostTrigger {
  interval: string;
}

interface RDPostData {}

interface XMediaFile {
  filename: string;
  filedata: string;
  mimeType: string;
}

interface XMediaFileData {
  xMediaFileData: XMediaFile[];
}

/**
 * 公開するAPI関数の定義
 * ＠param {XAuthInfo | XPostData | XPostTrigger | RDPostsData} e リクエストパラメータ
 * 
 * リクエストパラメーターは、以下のインターフェースに準拠する必要があります。
 * 
 * interface XApiKey {
 *  accountId: string;
 *  apiKey: string;
 *  apiKeySecret: string;
 *  apiAccessToken: string;
 *  apiAccessTokenSecret: string;
 * }
 *
 * interface XAuthInfo {
 *  authInfo: XApiKey[];
 *  functionName: 'writeAuthInfo';
 * }
 *
 * interface XPostData {
 *  id: string;
 *  postSchedule: string;
 *  postTo: string;
 *  contents: string;
 *  media: string[];
 *  inReplyToInternal: string;
 * }
 * 
 * interface XPostsData {
 *  xPostsData: XPostData[];
 *  functionName: 'writePostsData | deletePostsData';
 * }
 *
 * interface XPostTrigger {
 *  interval: string;
 *  functionName: 'createTrigger' | 'deleteTrigger';
 * }
 *
 * interface  RDPostData {
 *  functionName: 'deleteAllPostsData' | 'getPostsData';
 * }
 *
 * interface XMediaFile {
 *  functionName: 'uploadMediaFile';
 *  filename: string;
 *  filedata: string;
 *  mimeType: string;
 * }
 *
 * interface XMediaFileData {
 *  xMediaFileData: XMediaFile[];
 * }
 *
 * リクエストパラメーターのfunctionNameによって、実行する関数を切り替えます。
 *   1. writeAuthInfo: 認証情報をLibraryPropertyへ保存
 *   2. clearAuthInfo: 認証情報をLibraryPropertyから削除
 *   3. writePostsData: 投稿データをPostsシートに書き込む
 *   4. deletePostsData: Postsシートのデータを削除
 *   5. getPostsData: Postsシートのデータを取得
 *   6. deleteAllPostsData: Postsシートのすべてのデータを削除
 *   7. createTrigger: トリガーを作成
 *   8. deleteTrigger: トリガーを削除
 *   9. uploadMediaFile: メディアファイルをGoogle Driveにアップロード
 *   
 * 
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 
 */

const POSTS_SHEET_NAME = 'Posts';

/**
 * データの入出力をAPIとして公開する
 * @param {object} e リクエストパラメータ
 */
function doPost(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  switch (e.parameter.functionName) {
    case 'createTrigger':
      try {
        createTimeBasedTrigger(parseInt(e.parameter.interval as string));
      } catch (error: any) {
        Logger.log(`Error creating trigger: ${error}`);
        return ContentService.createTextOutput(
          JSON.stringify({
            status: 'error',
            message: 'Failed to create trigger.',
            error: error.toString(),
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'success',
          message: `Time-based trigger created to run every ${e.parameter.interval} minutes.`,
        })
      ).setMimeType(ContentService.MimeType.JSON);

    case 'deleteTrigger':
      try {
        deleteAllTriggers();
      } catch (error: any) {
        Logger.log(`Error deleting trigger: ${error}`);
        return ContentService.createTextOutput(
          JSON.stringify({
            status: 'error',
            message: 'Failed to delete trigger.',
            error: error.toString(),
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'success',
          message: 'Time-based trigger deleted.',
        })
      ).setMimeType(ContentService.MimeType.JSON);

    case 'clearAuthInfo':
      return clearAuthInfo();

    case 'writeAuthInfo':
      return writeAuthInfo(e);

    case 'deletePostsData':
      return deletePostsData(e);

    case 'deleteAllPostsData':
      return deleteAllPostsData(e);

    case 'writePostsData':
      return writePostsData(e);

    case 'getPostsData':
      return getPostsData(e);

    case 'uploadMediaFile':
      return uploadMediaFile(e);

    default:
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'Invalid function parameter.',
        })
      ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Web Appとしてデプロイする
 */
function deployAsWebApp(): string {
  return ScriptApp.getService().getUrl();
}

function createPostsSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
  const postsSheet = ss.insertSheet(POSTS_SHEET_NAME);
  postsSheet
    .getRange('A1:H1')
    .setValues([
      [
        'id',
        'postSchedule',
        'postTo',
        'contents',
        'media',
        'inReplyToInternal',
        'status',
        'errorDetail',
      ],
    ]);
  return postsSheet;
}

/**
 * 認証情報をPropertyに保存する
 * @param {object} e リクエストパラメータ
 * interface XApiKey {
 *  accountId: string;
 *  apiKey: string;
 *  apiKeySecret: string;
 *  apiAccessToken: string;
 *  apiAccessTokenSecret: string;
 * }
 *
 * interface XAuthInfo {
 *  authInfo: XApiKey[];
 *  functionName: 'writeAuthInfo';
 * }
 */
export function writeAuthInfo(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  // ロックを取得 (同時実行制御)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30秒待機
  } catch (e: any) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to acquire lock.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // リクエストボディをパース
    const requestBody: XAuthInfo = JSON.parse(e.postData.contents);

    // リクエストボディが空の場合は全削除
    if (!requestBody.authInfo || !Array.isArray(requestBody.authInfo)) {
      clearAuthInfo();
    } else {
      // 認証情報をLibraryPropertyに保存
      const scriptProperties = PropertiesService.getScriptProperties();
      // 全削除してから保存
      scriptProperties.deleteAllProperties();
      for (const authInfo of requestBody.authInfo) {
        const {
          accountId,
          apiKey,
          apiKeySecret,
          apiAccessToken,
          apiAccessTokenSecret,
        } = authInfo;

        // バリデーション
        if (
          !accountId ||
          !apiKey ||
          !apiKeySecret ||
          !apiAccessToken ||
          !apiAccessTokenSecret
        ) {
          throw new Error(
            'Missing required fields (accountId, apiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret).'
          );
        } else {
          scriptProperties.setProperties(
            {
              [`${accountId}_apiKey`]: apiKey,
              [`${accountId}_apiKeySecret`]: apiKeySecret,
              [`${accountId}_apiAccessToken`]: apiAccessToken,
              [`${accountId}_apiAccessTokenSecret`]: apiAccessTokenSecret,
            },
            false
          );
        }
      }
    }
    // レスポンスを返す
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Authentication settings were successfully saved.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error writing authentication settings: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to write authentication settings.',
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock(); // ロックを解放
  }
}

/**
 * 認証情報をLibraryPropertyから削除する
 *
 */
export function clearAuthInfo(): GoogleAppsScript.Content.TextOutput {
  // ロックを取得 (同時実行制御)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30秒待機
  } catch (e: any) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to acquire lock.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // 認証情報を削除
    const scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.deleteAllProperties();

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Authentication settings were successfully cleared.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error clearing authentication settings: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to clear authentication settings.',
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock(); // ロックを解放
  }
}

/**
 * 投稿データを Posts シートに書き込む
 * @param {object} e リクエストパラメータ
 * interface XPostData {
 *  id: string;
 *  postSchedule: string;
 *  postTo: string;
 *  contents: string;
 *  media: string[];
 *  inReplyToInternal: string;
 * }
 *
 * interface XPostsData {
 *  xPostsData: XPostData[];
 * }
 */
export function writePostsData(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  // ロックを取得
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e: any) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to acquire lock.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const requestBody: XPostsData = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);
    // シートが存在しない場合は作成し、ヘッダー行を追加
    if (!postsSheet) {
      postsSheet = createPostsSheet(ss);
    }

    const xPostsData = requestBody.xPostsData;

    // データが配列であることを確認
    if (!Array.isArray(xPostsData)) {
      throw new Error('Request body must be an array of posts data.');
    }

    // 各投稿データを処理
    const values: any[][] = [];
    for (const postData of xPostsData) {
      const { id, postSchedule, postTo, contents, media, inReplyToInternal } =
        postData;

      // 必須項目をチェック
      if (!id || !postSchedule || !postTo || !contents) {
        throw new Error(
          'Missing required fields (id, postSchedule, postTo, contents).'
        );
      }

      // 日付の形式を変換 (もし文字列で渡される場合)
      const formattedPostSchedule = new Date(postSchedule);

      values.push([
        id,
        formattedPostSchedule,
        postTo,
        contents,
        media,
        inReplyToInternal,
        '',
        '',
      ]);
    }
    //データを書き込み
    postsSheet
      .getRange(postsSheet.getLastRow() + 1, 1, values.length, values[0].length)
      .setValues(values);

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Posts data were successfully written to the Posts sheet.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error writing posts data: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: `Failed to write posts data. ${error}`,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Posts シートのデータを削除する
 * xPostsの配列を受け取り、id が一致する行を削除する
 * @param {object} e リクエストパラメータ
 * interface XPostData {  id: string;  postSchedule: string;  postTo: string;  contents: string;  media: string[];  inReplyToInternal: string;}
 * interface XPostsData {  xPostsData: XPostData[];  functionName: 'writePostsData | deletePostsData';}
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
export function deletePostsData(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  // ロックを取得
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e: any) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to acquire lock.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const requestBody: XPostsData = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);
    // シートが存在しない場合はエラーを返す
    if (!postsSheet) {
      throw new Error('Posts sheet not found.');
    }
    const xPostsData = requestBody;

    // データが配列であることを確認
    if (!Array.isArray(xPostsData)) {
      throw new Error('Request body must be an array of posts data.');
    }

    // 各投稿データを処理
    for (const postData of xPostsData) {
      const { id } = postData;

      // id が一致する行を検索
      const lastRow = postsSheet.getLastRow();
      const dataRange = postsSheet.getRange(1, 1, lastRow - 1, 1);
      const data = dataRange.getValues();
      const rowNumber = data.indexOf(id.toString());

      if (rowNumber !== -1) {
        // id が一致する行を削除
        postsSheet.deleteRow(rowNumber + 2); // ヘッダー行を考慮して +2
      } else {
        Logger.log(`Error: Could not find row number for post ID ${id}`);
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Posts data were successfully deleted from the Posts sheet.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error deleting posts data: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: `Failed to delete posts data. ${error}`,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Posts シートの全データを削除する
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
export function deleteAllPostsData(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  // ロックを取得
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e: any) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to acquire lock.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const sheetName = POSTS_SHEET_NAME;
    const startRow = 2; // 2行目 (B2セルから)
    const startColumn = 2; // 2列目 (B列から)
    const requestBody: RDPostData = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const postsSheet = ss.getSheetByName(sheetName);

    if (!postsSheet) {
      throw new Error('Posts sheet not found.');
    }

    // Posts シートのデータを削除
    if (e.parameter.functionName === 'deleteAllPostsData') {
      const lastRow = postsSheet.getLastRow();
      const lastColumn = postsSheet.getLastColumn();

      const deleteRows = Math.max(0, lastRow - startRow + 1); // 削除する行数 (マイナスにならないように Math.max(0, ...) を使用)
      const deleteColumns = Math.max(0, lastColumn - startColumn + 1); // 削除する列数 (マイナスにならないように Math.max(0, ...) を使用)

      // データ範囲が存在する場合のみ削除処理を実行
      if (deleteRows > 0 && deleteColumns > 0) {
        const deleteRange = postsSheet.getRange(
          startRow,
          startColumn,
          deleteRows,
          deleteColumns
        );

        // 5. レンジの内容を削除 (データのみ削除、書式は保持)
        deleteRange.clearContent();
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Posts data were successfully deleted from the Posts sheet.',
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error deleting posts data: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: `Failed to delete posts data. ${error}`,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Posts シートのデータを取得する
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
export function getPostsData(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);

    // シートが存在しない場合は作成し、ヘッダー行を追加
    if (!postsSheet) {
      postsSheet = createPostsSheet(ss);
    }

    const lastRow = postsSheet.getLastRow();
    const lastColumn = postsSheet.getLastColumn();
    const dataRange = postsSheet.getRange(2, 1, lastRow - 1, lastColumn);
    const data = dataRange.getValues();

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Posts data were successfully retrieved.',
        data: data,
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error getting posts data: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: `Failed to get posts data. ${error}`,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * メディアファイルをGoogle Driveにアップロードする
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
export function uploadMediaFile(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  try {
    const requestBody: XMediaFileData = JSON.parse(e.postData.contents);

    if (
      !requestBody.xMediaFileData ||
      !Array.isArray(requestBody.xMediaFileData)
    ) {
      throw new Error('Request body must contain xMediaFileData array.');
    }

    const mediaData = requestBody.xMediaFileData[0];
    const { filename, filedata, mimeType } = mediaData;

    if (!filename || !filedata || !mimeType) {
      throw new Error(
        'Missing required fields (filename, filedata, mimeType).'
      );
    }

    // Google Driveのルートフォルダを取得
    const rootFolder = DriveApp.getRootFolder();

    // フォルダ名
    const folderName = 'X_Post_MediaFiles';

    // フォルダが存在するか確認
    let folder = DriveApp.getFoldersByName(folderName);
    let mediaFolder;

    if (folder.hasNext()) {
      mediaFolder = folder.next();
    } else {
      // フォルダが存在しない場合は作成
      mediaFolder = DriveApp.createFolder(folderName);
    }

    // ファイル名が重複する場合、連番を追加
    let newFilename = filename;
    let counter = 1;
    while (mediaFolder.getFilesByName(newFilename).hasNext()) {
      const fileExtension = filename.slice(filename.lastIndexOf('.'));
      const baseFilename = filename.slice(0, filename.lastIndexOf('.'));
      newFilename = `${baseFilename}_${counter}${fileExtension}`;
      counter++;
    }

    // Base64データをBlobに変換
    const decodedData = Utilities.base64Decode(filedata);
    const blob = Utilities.newBlob(decodedData, mimeType, newFilename);

    // ファイルをGoogle Driveに保存
    const file = mediaFolder.createFile(blob);

    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Media file uploaded successfully.',
        fileUrl: file.getUrl(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(`Error uploading media file: ${error}`);
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: `Failed to upload media file. ${error}`,
        error: error.toString(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
/**
 * 時間ベースのトリガーを作成する。
 * @param {number} intervalMinutes トリガーの間隔 (分)
 */
export function createTimeBasedTrigger(intervalMinutes: number): void {
  // 既存のトリガーを削除 (必要に応じて)
  deleteAllTriggers();

  // 新しいトリガーを作成
  ScriptApp.newTrigger('autoPostToX')
    .timeBased()
    .everyMinutes(intervalMinutes)
    .create();

  Logger.log(
    `Created time-based trigger to run autoPostToX every ${intervalMinutes} minutes.`
  );
}

/**
 * すべてのトリガーを削除する
 */
export function deleteAllTriggers(): void {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  Logger.log('Deleted all project triggers');
}
