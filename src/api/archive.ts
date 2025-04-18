/**
 * 指定されたシートの内容を、Google Drive上の 'X_Posted_Archive' ファイルに、
 * 指定された名前の新しいシートとしてコピー（アーカイブ）します。
 * アーカイブファイルが存在しない場合は作成します。
 *
 * @param {string} sourceSheetName コピー元のシート名 ('Posted' または 'Errors')。
 * @param {string} newSheetName 新しく作成するシートの名前。
 * @return {object} アーカイブ結果の情報（アーカイブファイルのID、URL、新しいシート名）。
 * @throws {Error} パラメータが不正、ソースシートが見つからない、
 *                 Driveファイルの操作やシートコピーに失敗した場合。
 */
export function archiveSheet(sourceSheetName, newSheetName) {
  const ARCHIVE_FILE_NAME = "X_Posted_Archive";

  // --- 入力チェック ---

  if (
    !sourceSheetName ||
    typeof sourceSheetName !== "string" ||
    (sourceSheetName !== "Posted" && sourceSheetName !== "Errors")
  ) {
    throw new Error(
      'Invalid or missing sourceSheetName. Must be "Posted" or "Errors".'
    );
  }
  if (
    !newSheetName ||
    typeof newSheetName !== "string" ||
    newSheetName.trim() === ""
  ) {
    throw new Error("Missing or invalid required parameter: newSheetName.");
  }
  newSheetName = newSheetName.trim(); // 前後の空白を除去

  // --- ソースシート取得 ---
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(sourceSheetName);
  if (!sourceSheet) {
    throw new Error(
      `Source sheet "${sourceSheetName}" not found in the current spreadsheet.`
    );
  }
  // ソースシートが空の場合は警告を出すか、エラーにする（ここでは警告のみ）
  if (sourceSheet.getLastRow() === 0) {
    Logger.log(
      `Warning: Source sheet "${sourceSheetName}" is empty. Archiving an empty sheet.`
    );
    // return { status: 'warning', message: `Source sheet "${sourceSheetName}" is empty. Nothing to archive.`, newSheetName: newSheetName }; // エラーにする場合は throw new Error(...)
  }

  // --- アーカイブファイルの特定または作成 ---
  let archiveSpreadsheet;
  let isNewArchiveFile = false; // Flag to track if the archive file was newly created
  const files = DriveApp.getFilesByName(ARCHIVE_FILE_NAME);

  if (files.hasNext()) {
    // ファイルが見つかった場合、最初のファイルを使用
    const archiveFile = files.next();
    try {
      archiveSpreadsheet = SpreadsheetApp.openById(archiveFile.getId());
      Logger.log(
        `Found existing archive file: ${ARCHIVE_FILE_NAME} (ID: ${archiveFile.getId()})`
      );
    } catch (e) {
      Logger.log(
        `Error opening existing archive file ${archiveFile.getId()}: ${e}`
      );
      throw new Error(
        `Failed to open the existing archive file "${ARCHIVE_FILE_NAME}". Check permissions or file validity.`
      );
    }
    // 同名ファイルがさらに存在する場合の警告
    if (files.hasNext()) {
      Logger.log(
        `Warning: Multiple files found with the name "${ARCHIVE_FILE_NAME}". Using the first one found.`
      );
    }
  } else {
    // ファイルが見つからない場合、新規作成
    try {
      archiveSpreadsheet = SpreadsheetApp.create(ARCHIVE_FILE_NAME);
      isNewArchiveFile = true; // Mark as newly created
      Logger.log(
        `Archive file "${ARCHIVE_FILE_NAME}" not found. Created a new one (ID: ${archiveSpreadsheet.getId()}).`
      );
    } catch (e) {
      Logger.log(
        `Error creating new archive file "${ARCHIVE_FILE_NAME}": ${e}`
      );
      throw new Error(
        `Failed to create the archive file "${ARCHIVE_FILE_NAME}". Check Drive permissions.`
      );
    }
  }

  // --- シートのコピーとリネーム ---
  try {
    // シートをアーカイブファイルにコピー
    const copiedSheet = sourceSheet.copyTo(archiveSpreadsheet);

    // コピーされたシートの名前を指定された名前に変更
    try {
      copiedSheet.setName(newSheetName);
      SpreadsheetApp.flush(); // 変更を確実に適用
      Logger.log(
        `Sheet "${sourceSheetName}" successfully copied to "${ARCHIVE_FILE_NAME}" as "${newSheetName}".`
      );

      // --- Delete default 'シート1' if the archive file was newly created ---
      if (isNewArchiveFile) {
        try {
          const defaultSheet = archiveSpreadsheet.getSheetByName("シート1");
          // Check if 'シート1' exists and there's more than one sheet total
          if (defaultSheet && archiveSpreadsheet.getSheets().length > 1) {
            archiveSpreadsheet.deleteSheet(defaultSheet);
            Logger.log(
              "Deleted default 'シート1' from the newly created archive file after copying."
            );
          }
        } catch (deleteError) {
          // Log error if deletion fails, but don't stop the overall success
          Logger.log(`Could not delete default 'シート1': ${deleteError}`);
        }
      }
      // ------------------------------------------------------------------

      // --- Delete the original source sheet ---
      try {
        ss.deleteSheet(sourceSheet);
        Logger.log(`Successfully deleted original source sheet "${sourceSheetName}".`);
      } catch (deleteSourceError: any) {
        // Log error if source sheet deletion fails, but consider the archive successful
        Logger.log(`Failed to delete original source sheet "${sourceSheetName}": ${deleteSourceError}`);
        // Optionally, modify the success message or status if source deletion failure is critical
      }
      // ----------------------------------------

      // 成功レスポンスを返す
      return {
        status: "success",
        message: `Sheet "${sourceSheetName}" archived successfully as "${newSheetName}".`,
        archiveFileId: archiveSpreadsheet.getId(),
        archiveFileUrl: archiveSpreadsheet.getUrl(),
        newSheetName: newSheetName,
      };
    } catch (renameError: any) {
      // リネームに失敗した場合（名前の重複など）
      Logger.log(
        `Error renaming the copied sheet to "${newSheetName}" (likely duplicate name): ${renameError}`
      );
      // コピー自体は成功している可能性があるので、コピーされたシートを削除する試み
      try {
        archiveSpreadsheet.deleteSheet(copiedSheet);
      } catch (deleteError) {
        Logger.log(
          `Failed to delete the partially copied sheet after rename error: ${deleteError}`
        );
      }
      throw new Error(
        `Failed to set the new sheet name to "${newSheetName}". A sheet with this name might already exist in the archive file.`
      );
    }
  } catch (copyError: any) {
    Logger.log(
      `Error copying sheet "${sourceSheetName}" to "${ARCHIVE_FILE_NAME}": ${copyError}`
    );
    throw new Error(
      `Failed to copy the sheet to the archive file: ${copyError.message}`
    );
  }
}
