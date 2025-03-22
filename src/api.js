"use strict";
// api.js (API として公開する関数)
// api.tsの冒頭に追加
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuthInfo = writeAuthInfo;
exports.clearAuthInfo = clearAuthInfo;
exports.writePostsData = writePostsData;
exports.deletePostsData = deletePostsData;
exports.deleteAllPostsData = deleteAllPostsData;
exports.getPostsData = getPostsData;
exports.uploadMediaFile = uploadMediaFile;
exports.createTimeBasedTrigger = createTimeBasedTrigger;
exports.deleteAllTriggers = deleteAllTriggers;
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
var POSTS_SHEET_NAME = 'Posts';
/**
 * データの入出力をAPIとして公開する
 * @param {object} e リクエストパラメータ
 */
function doPost(e) {
    switch (e.parameter.functionName) {
        case 'createTrigger':
            try {
                createTimeBasedTrigger(parseInt(e.parameter.interval));
            }
            catch (error) {
                Logger.log("Error creating trigger: ".concat(error));
                return ContentService.createTextOutput(JSON.stringify({
                    status: 'error',
                    message: 'Failed to create trigger.',
                    error: error.toString(),
                })).setMimeType(ContentService.MimeType.JSON);
            }
            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                message: "Time-based trigger created to run every ".concat(e.parameter.interval, " minutes."),
            })).setMimeType(ContentService.MimeType.JSON);
        case 'deleteTrigger':
            try {
                deleteAllTriggers();
            }
            catch (error) {
                Logger.log("Error deleting trigger: ".concat(error));
                return ContentService.createTextOutput(JSON.stringify({
                    status: 'error',
                    message: 'Failed to delete trigger.',
                    error: error.toString(),
                })).setMimeType(ContentService.MimeType.JSON);
            }
            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Time-based trigger deleted.',
            })).setMimeType(ContentService.MimeType.JSON);
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
            return ContentService.createTextOutput(JSON.stringify({
                status: 'error',
                message: 'Invalid function parameter.',
            })).setMimeType(ContentService.MimeType.JSON);
    }
}
/**
 * Web Appとしてデプロイする
 */
function deployAsWebApp() {
    return ScriptApp.getService().getUrl();
}
function createPostsSheet(ss) {
    var postsSheet = ss.insertSheet(POSTS_SHEET_NAME);
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
function writeAuthInfo(e) {
    var _a;
    // ロックを取得 (同時実行制御)
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000); // 30秒待機
    }
    catch (e) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to acquire lock.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    try {
        // リクエストボディをパース
        var requestBody = JSON.parse(e.postData.contents);
        // リクエストボディが空の場合は全削除
        if (!requestBody.authInfo || !Array.isArray(requestBody.authInfo)) {
            clearAuthInfo();
        }
        else {
            // 認証情報をLibraryPropertyに保存
            var scriptProperties = PropertiesService.getScriptProperties();
            // 全削除してから保存
            scriptProperties.deleteAllProperties();
            for (var _i = 0, _b = requestBody.authInfo; _i < _b.length; _i++) {
                var authInfo = _b[_i];
                var accountId = authInfo.accountId, apiKey = authInfo.apiKey, apiKeySecret = authInfo.apiKeySecret, apiAccessToken = authInfo.apiAccessToken, apiAccessTokenSecret = authInfo.apiAccessTokenSecret;
                // バリデーション
                if (!accountId ||
                    !apiKey ||
                    !apiKeySecret ||
                    !apiAccessToken ||
                    !apiAccessTokenSecret) {
                    throw new Error('Missing required fields (accountId, apiKey, apiKeySecret, apiAccessToken, apiAccessTokenSecret).');
                }
                else {
                    scriptProperties.setProperties((_a = {},
                        _a["".concat(accountId, "_apiKey")] = apiKey,
                        _a["".concat(accountId, "_apiKeySecret")] = apiKeySecret,
                        _a["".concat(accountId, "_apiAccessToken")] = apiAccessToken,
                        _a["".concat(accountId, "_apiAccessTokenSecret")] = apiAccessTokenSecret,
                        _a), false);
                }
            }
        }
        // レスポンスを返す
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Authentication settings were successfully saved.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error writing authentication settings: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to write authentication settings.',
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    finally {
        lock.releaseLock(); // ロックを解放
    }
}
/**
 * 認証情報をLibraryPropertyから削除する
 *
 */
function clearAuthInfo() {
    // ロックを取得 (同時実行制御)
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000); // 30秒待機
    }
    catch (e) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to acquire lock.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    try {
        // 認証情報を削除
        var scriptProperties = PropertiesService.getScriptProperties();
        scriptProperties.deleteAllProperties();
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Authentication settings were successfully cleared.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error clearing authentication settings: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to clear authentication settings.',
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    finally {
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
function writePostsData(e) {
    // ロックを取得
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
    }
    catch (e) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to acquire lock.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    try {
        var requestBody = JSON.parse(e.postData.contents);
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);
        // シートが存在しない場合は作成し、ヘッダー行を追加
        if (!postsSheet) {
            postsSheet = createPostsSheet(ss);
        }
        var xPostsData = requestBody.xPostsData;
        // データが配列であることを確認
        if (!Array.isArray(xPostsData)) {
            throw new Error('Request body must be an array of posts data.');
        }
        // 各投稿データを処理
        var values = [];
        for (var _i = 0, xPostsData_1 = xPostsData; _i < xPostsData_1.length; _i++) {
            var postData = xPostsData_1[_i];
            var id = postData.id, postSchedule = postData.postSchedule, postTo = postData.postTo, contents = postData.contents, media = postData.media, inReplyToInternal = postData.inReplyToInternal;
            // 必須項目をチェック
            if (!id || !postSchedule || !postTo || !contents) {
                throw new Error('Missing required fields (id, postSchedule, postTo, contents).');
            }
            // 日付の形式を変換 (もし文字列で渡される場合)
            var formattedPostSchedule = new Date(postSchedule);
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
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Posts data were successfully written to the Posts sheet.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error writing posts data: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to write posts data. ".concat(error),
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    finally {
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
function deletePostsData(e) {
    // ロックを取得
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
    }
    catch (e) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to acquire lock.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    try {
        var requestBody = JSON.parse(e.postData.contents);
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);
        // シートが存在しない場合はエラーを返す
        if (!postsSheet) {
            throw new Error('Posts sheet not found.');
        }
        var xPostsData = requestBody;
        // データが配列であることを確認
        if (!Array.isArray(xPostsData)) {
            throw new Error('Request body must be an array of posts data.');
        }
        // 各投稿データを処理
        for (var _i = 0, xPostsData_2 = xPostsData; _i < xPostsData_2.length; _i++) {
            var postData = xPostsData_2[_i];
            var id = postData.id;
            // id が一致する行を検索
            var lastRow = postsSheet.getLastRow();
            var dataRange = postsSheet.getRange(1, 1, lastRow - 1, 1);
            var data = dataRange.getValues();
            var rowNumber = data.indexOf(id.toString());
            if (rowNumber !== -1) {
                // id が一致する行を削除
                postsSheet.deleteRow(rowNumber + 2); // ヘッダー行を考慮して +2
            }
            else {
                Logger.log("Error: Could not find row number for post ID ".concat(id));
            }
        }
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Posts data were successfully deleted from the Posts sheet.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error deleting posts data: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to delete posts data. ".concat(error),
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    finally {
        lock.releaseLock();
    }
}
/**
 * Posts シートの全データを削除する
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
function deleteAllPostsData(e) {
    // ロックを取得
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
    }
    catch (e) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Failed to acquire lock.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    try {
        var sheetName = POSTS_SHEET_NAME;
        var startRow = 2; // 2行目 (B2セルから)
        var startColumn = 2; // 2列目 (B列から)
        var requestBody = JSON.parse(e.postData.contents);
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var postsSheet = ss.getSheetByName(sheetName);
        if (!postsSheet) {
            throw new Error('Posts sheet not found.');
        }
        // Posts シートのデータを削除
        if (e.parameter.functionName === 'deleteAllPostsData') {
            var lastRow = postsSheet.getLastRow();
            var lastColumn = postsSheet.getLastColumn();
            var deleteRows = Math.max(0, lastRow - startRow + 1); // 削除する行数 (マイナスにならないように Math.max(0, ...) を使用)
            var deleteColumns = Math.max(0, lastColumn - startColumn + 1); // 削除する列数 (マイナスにならないように Math.max(0, ...) を使用)
            // データ範囲が存在する場合のみ削除処理を実行
            if (deleteRows > 0 && deleteColumns > 0) {
                var deleteRange = postsSheet.getRange(startRow, startColumn, deleteRows, deleteColumns);
                // 5. レンジの内容を削除 (データのみ削除、書式は保持)
                deleteRange.clearContent();
            }
        }
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Posts data were successfully deleted from the Posts sheet.',
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error deleting posts data: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to delete posts data. ".concat(error),
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    finally {
        lock.releaseLock();
    }
}
/**
 * Posts シートのデータを取得する
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
function getPostsData(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var postsSheet = ss.getSheetByName(POSTS_SHEET_NAME);
        // シートが存在しない場合は作成し、ヘッダー行を追加
        if (!postsSheet) {
            postsSheet = createPostsSheet(ss);
        }
        var lastRow = postsSheet.getLastRow();
        var lastColumn = postsSheet.getLastColumn();
        var dataRange = postsSheet.getRange(2, 1, lastRow - 1, lastColumn);
        var data = dataRange.getValues();
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Posts data were successfully retrieved.',
            data: data,
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error getting posts data: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to get posts data. ".concat(error),
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
}
/**
 * メディアファイルをGoogle Driveにアップロードする
 * @param {object} e リクエストパラメータ
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス
 */
function uploadMediaFile(e) {
    try {
        var requestBody = JSON.parse(e.postData.contents);
        if (!requestBody.xMediaFileData ||
            !Array.isArray(requestBody.xMediaFileData)) {
            throw new Error('Request body must contain xMediaFileData array.');
        }
        var mediaData = requestBody.xMediaFileData[0];
        var filename = mediaData.filename, filedata = mediaData.filedata, mimeType = mediaData.mimeType;
        if (!filename || !filedata || !mimeType) {
            throw new Error('Missing required fields (filename, filedata, mimeType).');
        }
        // Google Driveのルートフォルダを取得
        var rootFolder = DriveApp.getRootFolder();
        // フォルダ名
        var folderName = 'X_Post_MediaFiles';
        // フォルダが存在するか確認
        var folder = DriveApp.getFoldersByName(folderName);
        var mediaFolder = void 0;
        if (folder.hasNext()) {
            mediaFolder = folder.next();
        }
        else {
            // フォルダが存在しない場合は作成
            mediaFolder = DriveApp.createFolder(folderName);
        }
        // ファイル名が重複する場合、連番を追加
        var newFilename = filename;
        var counter = 1;
        while (mediaFolder.getFilesByName(newFilename).hasNext()) {
            var fileExtension = filename.slice(filename.lastIndexOf('.'));
            var baseFilename = filename.slice(0, filename.lastIndexOf('.'));
            newFilename = "".concat(baseFilename, "_").concat(counter).concat(fileExtension);
            counter++;
        }
        // Base64データをBlobに変換
        var decodedData = Utilities.base64Decode(filedata);
        var blob = Utilities.newBlob(decodedData, mimeType, newFilename);
        // ファイルをGoogle Driveに保存
        var file = mediaFolder.createFile(blob);
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Media file uploaded successfully.',
            fileUrl: file.getUrl(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
    catch (error) {
        Logger.log("Error uploading media file: ".concat(error));
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to upload media file. ".concat(error),
            error: error.toString(),
        })).setMimeType(ContentService.MimeType.JSON);
    }
}
/**
 * 時間ベースのトリガーを作成する。
 * @param {number} intervalMinutes トリガーの間隔 (分)
 */
function createTimeBasedTrigger(intervalMinutes) {
    // 既存のトリガーを削除 (必要に応じて)
    deleteAllTriggers();
    // 新しいトリガーを作成
    ScriptApp.newTrigger('autoPostToX')
        .timeBased()
        .everyMinutes(intervalMinutes)
        .create();
    Logger.log("Created time-based trigger to run autoPostToX every ".concat(intervalMinutes, " minutes."));
}
/**
 * すべてのトリガーを削除する
 */
function deleteAllTriggers() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var _i = 0, triggers_1 = triggers; _i < triggers_1.length; _i++) {
        var trigger = triggers_1[_i];
        ScriptApp.deleteTrigger(trigger);
    }
    Logger.log('Deleted all project triggers');
}
