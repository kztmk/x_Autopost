var POSTS_SHEET_NAME = 'Posts'; // 必要であれば定義
var MEDIA_FOLDER_NAME = 'X_Post_MediaFiles'; // 画像を保存するフォルダ名

/**
 * メディアファイルをGoogle Driveにアップロードし、共有設定を変更してURLを返す
 * @param {GoogleAppsScript.Events.DoPost} e リクエストパラメータ (e.postData.contents を使用)
 * Payload: { xMediaFileData: [{ filename: string, filedata: string (Base64), mimeType: string }] }
 * @returns {GoogleAppsScript.Content.TextOutput} レスポンス (ファイルIDと表示用URLを含むJSON)
 */
export function uploadMediaFile(e) {
    let file: GoogleAppsScript.Drive.File;
    try {
        // --- 1. リクエストボディの解析と検証 ---
        if (!e.postData || !e.postData.contents) {
            throw new Error('Request body (postData) is missing.');
        }
        var requestBody = JSON.parse(e.postData.contents);

        if (!requestBody.xMediaFileData || !Array.isArray(requestBody.xMediaFileData) || requestBody.xMediaFileData.length === 0) {
            throw new Error('Request body must contain a non-empty xMediaFileData array.');
        }

        var mediaData = requestBody.xMediaFileData[0]; // 最初のファイルデータのみ処理
        var filename = mediaData.filename;
        var base64Data = mediaData.filedata;
        var mimeType = mediaData.mimeType;

        if (!filename || !base64Data || !mimeType) {
            throw new Error('Missing required fields in xMediaFileData[0]: filename, filedata, mimeType.');
        }

        // --- 2. Base64デコードとBlob作成 ---
        var decodedBytes = Utilities.base64Decode(base64Data, Utilities.Charset.UTF_8);
        if (!decodedBytes || decodedBytes.length === 0) {
             throw new Error('Failed to decode base64 data or data is empty.');
        }

        // --- 3. Google Driveフォルダの取得または作成 ---
        var folders = DriveApp.getFoldersByName(MEDIA_FOLDER_NAME);
        var mediaFolder;
        if (folders.hasNext()) {
            mediaFolder = folders.next();
        } else {
            Logger.log("Folder '".concat(MEDIA_FOLDER_NAME, "' not found. Creating it in the root folder."));
            mediaFolder = DriveApp.createFolder(MEDIA_FOLDER_NAME);
        }

        // --- 4. ファイル名の重複チェックと決定 ---
        var newFilename = filename;
        var counter = 1;
        var baseFilename = filename;
        var fileExtension = '';
        var dotIndex = filename.lastIndexOf('.');
        if (dotIndex > 0) {
            baseFilename = filename.slice(0, dotIndex);
            fileExtension = filename.slice(dotIndex);
        }
        while (mediaFolder.getFilesByName(newFilename).hasNext()) {
            newFilename = "".concat(baseFilename, "_").concat(String(counter)).concat(fileExtension);
            counter++;
            if (counter > 100) { // 無限ループ防止
                 throw new Error("Could not generate a unique filename for ".concat(filename, " after 100 attempts."));
            }
        }

        // --- 5. Blob作成とファイル保存 ---
        var blob = Utilities.newBlob(decodedBytes, mimeType, newFilename);
        file = mediaFolder.createFile(blob); // ここで File オブジェクトを取得
        if (!file) {
            throw new Error('Failed to create file in Google Drive.');
        }
        var fileId = file.getId();
        var webViewLink = file.getUrl(); // Driveビューア用リンク (編集権限者向け)

        Logger.log("Media file uploaded: ".concat(newFilename, " (ID: ").concat(fileId, ") to folder ").concat(MEDIA_FOLDER_NAME));

        // --- 6. 共有設定の変更 (Drive API v3を使用) ---
        try {
            // 重要: Drive API v3 の高度なサービスを有効にする必要があります
            Drive.Permissions.create({
                role: 'reader', // 閲覧者権限
                type: 'anyone'  // 誰でも (認証不要)
            }, fileId, {
                //'fields': 'id' // レスポンスでパーミッションIDが必要なら指定
            });
            Logger.log("File permissions updated to 'anyone with the link can view' for ".concat(fileId));
        } catch (permError: any) {
            // パーミッション設定に失敗した場合のエラーハンドリング
            Logger.log("Error setting file permissions for ".concat(fileId, ": ").concat(String(permError)));
            throw new Error("File uploaded, but failed to set public permissions: " + 
                (permError.message || String(permError)));
        }

        // --- 7. 成功レスポンスの生成 ---
        var webContentLink = "https://drive.google.com/uc?export=view&id=" + fileId; // 直接表示用URL (imgのsrcに使える)

        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Media file uploaded and shared successfully.',
            filename: newFilename,    // 実際に保存されたファイル名
            fileId: fileId,           // Google Drive の File ID
            webViewLink: webViewLink, // Google Drive ビューアへのリンク
            webContentLink: webContentLink // 画像表示用の直接リンク
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error: unknown) {
        // --- 8. エラーハンドリング ---
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.log("Error in uploadMediaFile: " + errorMessage);
        
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: "Failed to upload and share media file: " + errorMessage,
            error: String(error),
        })).setMimeType(ContentService.MimeType.JSON);
    }
}
