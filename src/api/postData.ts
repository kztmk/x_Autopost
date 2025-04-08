import {
  PostError,
  XPostData,
  PostScheduleUpdate,
  UpdateResult,
  PostDeletion,
  DeleteResult,
} from "../types";

// シート名の定数
export const SHEETS = {
  POSTS: "Posts",
  POSTED: "Posted",
  ERRORS: "Errors",
};

// シート別のヘッダー定義
export const HEADERS = {
  // Posts/Postedシート共通のヘッダー列
  POST_HEADERS: [
    "id",
    "createdAt",
    "postTo",
    "contents",
    "media",
    "postSchedule",
    "inReplytoInternal",
    "postId",
    "inReplyToOnX",
  ],

  POSTED_HEADERS: [
    "id",
    "createdAt",
    "postTo",
    "contents",
    "media",
    "postSchedule",
    "inReplytoInternal",
    "postId",
    "inReplyToOnX",
    "postedAt",
  ],
  // Errorsシート用のヘッダー列
  ERROR_HEADERS: ["Timestamp", "Context", "Error Message", "Stack Trace"],
};

/**
 * 指定された名前のシートを取得し、ない場合は作成してヘッダーを挿入します。
 * 既に存在する場合でもヘッダー行が空なら挿入します。
 *
 * @param {string} sheetName - 取得または作成するシート名
 * @param {string[]} headerColumns - ヘッダー列名の配列
 * @return {GoogleAppsScript.Spreadsheet.Sheet} 取得または作成されたシート
 * @throws {Error} シートの作成または操作に失敗した場合
 */
export function getOrCreateSheetWithHeaders(
  sheetName: string,
  headerColumns: string[]
): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  // シートが存在しない場合、作成してヘッダーを挿入
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log(`Sheet "${sheetName}" created.`);
    sheet.appendRow(headerColumns);
    Logger.log(`Header row added to "${sheetName}".`);
    // シートが非常に大きい場合や権限の問題でフリーズすることがあるため、念のためflush
    SpreadsheetApp.flush();
  } else {
    // シートが存在する場合、ヘッダー行が存在するかチェック (シートが空の場合のみヘッダーを追加)
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headerColumns);
      Logger.log(`Header row added to existing empty sheet "${sheetName}".`);
      SpreadsheetApp.flush();
    }
  }

  return sheet;
}

/**
 * 指定された投稿データを 'Posts' シートに新しい行として保存します。
 * シートが存在しない場合は作成し、ヘッダー行を挿入します。
 * 保存時にユニークなIDと作成日時を付与します。
 *
 * @param {XPostData} postDataInput - 保存する投稿データオブジェクト。idとcreatedAtは含まない。
 *   {
 *     postTo: string,
 *     media: string, // JSONをstringifyした文字列
 *     postSchedule: string,
 *     inReplytoInternal?: string, // オプショナル
 *     // postId, inReplyToOnX は初期保存時には通常含まれない
 *   }
 * @return {object} 保存された完全なXPostDataオブジェクト（id, createdAtを含む）。
 * @throws {Error} 必須フィールドが不足している、または書き込みに失敗した場合。
 */
function createPostData(postDataInput) {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 必須フィールドの簡易チェック (必要に応じて追加)
  if (!postDataInput.postTo || !postDataInput.contents) {
    throw new Error("Missing required fields: postTo and content.");
  }

  // --- データ準備 ---
  const newId = Utilities.getUuid(); // ユニークIDを生成
  const createdAt = new Date(); // 現在日時を取得

  // XPostDataオブジェクトを完成させる
  const newPostData = {
    id: newId,
    createdAt: createdAt.toISOString(), // ISO 8601形式の文字列で保存
    postTo: postDataInput.postTo,
    contents: postDataInput.contents,
    media: postDataInput.media || "", // mediaがない場合は空文字列
    postSchedule: postDataInput.postSchedule,
    inReplytoInternal: postDataInput.inReplytoInternal || "", // 未指定なら空文字列
    postId: postDataInput.postId || "", // 初期値は空文字列
    inReplyToOnX: postDataInput.inReplyToOnX || "", // 初期値は空文字列
  };

  // --- シートへの書き込み ---
  try {
    // ヘッダーの順番に合わせて値の配列を作成
    const rowData = HEADERS.POST_HEADERS.map((header) => {
      return newPostData[header] !== undefined ? newPostData[header] : ""; // 未定義の場合は空文字
    });

    sheet.appendRow(rowData);

    Logger.log(`PostData created with ID: ${newId}`);
    // 保存した完全なデータを返す
    return newPostData;
  } catch (e: any) {
    Logger.log(`Error creating PostData: ${e}`);
    // Errorシートへの記録などを検討
    throw new Error(`Failed to save PostData to sheet: ${e.message}`);
  }
}

/**
 * 'Posts' シートに保存されている全てのX投稿データを取得します。
 * @return {XPostData[]} 保存されているXPostDataオブジェクトの配列。データがない場合は空配列。
 * @throws {Error} シートが見つからない場合。
 */
function fetchPostData() {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEETS.POSTS}".`);
    return []; // データ行がないので空配列を返す
  }

  // ヘッダー行を取得 (最初の行)
  const headers = values[0].map((header) => String(header).trim()); // ヘッダー名を文字列に変換し、前後の空白を削除

  // データ行 (ヘッダーを除く) をオブジェクトの配列に変換
  const postDataList: XPostData[] = [];
  for (let i = 1; i < values.length; i++) {
    // i = 1 から開始してヘッダー行をスキップ
    const row = values[i];
    const postData: XPostData = {};

    // ヘッダーに基づいてオブジェクトを構築
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      // ヘッダー名が空でないことを確認
      if (header) {
        let value = j < row.length ? row[j] : ""; // 行に対応するデータがあれば取得、なければ空文字

        // createdAt列の値がDateオブジェクトの場合、ISO文字列に変換
        // (createPostDataでISO文字列として保存しているため、通常は文字列のはずだが念のため)
        if (header === "createdAt" && value instanceof Date) {
          value = value.toISOString();
        }
        // 他に特定の型変換が必要な場合はここに追加 (例: 数値に変換したい列など)

        postData[header] = value;
      }
    }

    // idフィールドが存在し、空でない行のみを結果に含める（任意：空行などを除外する場合）
    if (postData.id) {
      postDataList.push(postData);
    } else {
      Logger.log(`Skipping row ${i + 1} due to missing or empty id.`);
    }
  }

  Logger.log(
    `Fetched ${postDataList.length} post data entries from sheet "${SHEETS.POSTS}".`
  );
  return postDataList;
}

/**
 * 'Posts' シートに保存されている指定されたIDのX投稿データを更新します。
 * 更新データにはIDが含まれている必要があります。createdAtは更新されません。
 *
 * @param {XPostData} postDataToUpdate - 更新する投稿データオブジェクト。idフィールドが必須。
 *   {
 *     id: string, // 必須: 更新対象のID
 *     postTo?: string,
 *     media?: string,
 *     postSchedule?: string,
 *     inReplytoInternal?: string,
 *     postId?: string,
 *     inReplyToOnX?: string,
 *     // createdAt は更新対象外
 *   }
 * @return {object} 更新後の完全なXPostDataオブジェクト。
 * @throws {Error} シートが見つからない、ヘッダーがない、必須のidがない、
 *                 指定されたIDのデータが見つからない、または更新に失敗した場合。
 */
function updatePostData(postDataToUpdate) {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 更新データにIDが含まれているかチェック
  if (!postDataToUpdate || !postDataToUpdate.id) {
    throw new Error('Missing required field "id" in the update data.');
  }
  const targetId = postDataToUpdate.id;

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // ヘッダー行を取得し、列名とインデックスのマッピングを作成
  if (values.length === 0) {
    throw new Error(
      `Sheet "${SHEETS.POSTS}" is empty or header row is missing.`
    );
  }
  const headers = values[0].map((header) => String(header).trim());
  const headerMap = {};
  headers.forEach((header, index) => {
    if (header) {
      // 空のヘッダー名は無視
      headerMap[header] = index;
    }
  });

  // ID列とcreatedAt列のインデックスを確認
  const idColumnIndex = headerMap["id"];
  const createdAtColumnIndex = headerMap["createdAt"]; // createdAtを保持するためにインデックスを取得
  if (idColumnIndex === undefined) {
    throw new Error('Cannot find "id" column in the sheet header.');
  }

  let targetRowIndex = -1; // 見つかった行のインデックス (0-based in values array)
  let originalCreatedAt = null; // 元のcreatedAt値を保持する変数

  // データ行を検索して対象IDを見つける (ヘッダー行を除く)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // ID列が存在し、値が一致するか確認
    if (row.length > idColumnIndex && row[idColumnIndex] === targetId) {
      targetRowIndex = i;
      // 元のcreatedAt値を取得（存在すれば）
      if (
        createdAtColumnIndex !== undefined &&
        row.length > createdAtColumnIndex
      ) {
        originalCreatedAt = row[createdAtColumnIndex];
      }
      break; // 見つかったらループを抜ける
    }
  }

  // 対象IDが見つからなかった場合
  if (targetRowIndex === -1) {
    throw new Error(
      `PostData with ID "${targetId}" not found in sheet "${SHEETS.POSTS}".`
    );
  }

  // --- 更新処理 ---
  try {
    // 更新後の行データ配列を作成 (ヘッダーの順番に合わせる)
    const newRowValues = headers.map((header) => {
      const headerKey = header; // マップのキーはヘッダー名そのもの

      if (headerKey === "createdAt") {
        // createdAt は元の値を保持（見つかっていれば）、なければ空文字
        return originalCreatedAt !== null ? originalCreatedAt : "";
      } else if (postDataToUpdate.hasOwnProperty(headerKey)) {
        // 更新データにキーが存在すればその値を使用
        return postDataToUpdate[headerKey];
      } else {
        // 更新データにキーが存在しない場合、元の値を保持 (部分更新に対応する場合)
        // または、常に postDataToUpdate で全置き換えなら undefined -> '' とする
        const originalValueIndex = headerMap[headerKey];
        if (
          originalValueIndex !== undefined &&
          values[targetRowIndex].length > originalValueIndex
        ) {
          return values[targetRowIndex][originalValueIndex]; // 元の値を返す
        } else {
          return ""; // 元の値もなければ空文字
        }
        // 備考: 完全な置き換え（postDataToUpdateにないフィールドは空にする）なら以下のようになる:
        // return postDataToUpdate.hasOwnProperty(headerKey) ? postDataToUpdate[headerKey] : '';
      }
    });

    // シート上の該当行を更新 (行番号は 1-based なので +1 する)
    const targetSheetRow = targetRowIndex + 1;
    sheet
      .getRange(targetSheetRow, 1, 1, newRowValues.length)
      .setValues([newRowValues]);

    Logger.log(`PostData with ID "${targetId}" updated successfully.`);

    // 更新後のデータをオブジェクトとして再構築して返す
    const updatedPostData = {};
    headers.forEach((header, index) => {
      if (header) {
        updatedPostData[header] = newRowValues[index];
      }
    });
    return updatedPostData;
  } catch (e: any) {
    Logger.log(`Error updating PostData with ID "${targetId}": ${e}`);
    throw new Error(`Failed to update PostData: ${e.message}`);
  }
}

/**
 * 'Posts' シートから指定されたIDのX投稿データを削除します。
 * IDが "all" の場合は、ヘッダーを除く全てのデータ行を削除します。
 *
 * @param {XPostData} postDataToDelete - 削除対象のIDを含むオブジェクト。idフィールドが必須。
 *   { id: string } // idフィールドのみ使用
 * @return {object} 削除成功を示すメッセージ。全削除の場合は削除件数も含む。
 * @throws {Error} シートが見つからない、必須のidがない、対象IDが見つからない(単一削除時)、
 *                 または削除に失敗した場合。
 */
function deletePostData(postDataToDelete) {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 削除データにIDが含まれているかチェック
  if (!postDataToDelete || !postDataToDelete.id) {
    throw new Error('Missing required field "id" in the delete request body.');
  }
  const targetId = postDataToDelete.id;

  if (targetId === "all") {
    // --- 全削除処理 ---
    // accountIdを取得
    if (!postDataToDelete.accountId) {
      throw new Error(
        'Missing required field "accountId" in the delete request body.'
      );
    }
    const targetAccountId = postDataToDelete.accountId;

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    // ヘッダー行を取得し、accountId列のインデックスを確認
    if (values.length === 0) {
      throw new Error(
        `Sheet "${SHEETS.POSTS}" is empty or header row is missing.`
      );
    }
    const headers = values[0].map((header) => String(header).trim());
    const accountIdColumnIndex = headers.indexOf("accountId");

    if (accountIdColumnIndex === -1) {
      throw new Error('Cannot find "accountId" column in the sheet header.');
    }

    let rowsToDelete: number[] = [];

    // データ行を検索して対象のaccountIdを持つ行を特定 (ヘッダー行を除く)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // accountId列が存在し、値が一致するか確認
      if (
        row.length > accountIdColumnIndex &&
        row[accountIdColumnIndex] === targetAccountId
      ) {
        rowsToDelete.push(i + 1); // シート上の行番号は配列インデックス+1
      }
    }

    // 削除対象の行がない場合
    if (rowsToDelete.length === 0) {
      Logger.log(
        `No data rows to delete for accountId "${targetAccountId}" in sheet "${SHEETS.POSTS}".`
      );
      return {
        status: "success",
        message: `No data rows found to delete for accountId "${targetAccountId}".`,
        deletedCount: 0,
      };
    }

    try {
      // 行番号が大きい順に削除 (後ろから削除しないと行番号が変わる)
      rowsToDelete.sort((a, b) => b - a);
      rowsToDelete.forEach((row) => {
        sheet.deleteRow(row);
      });

      Logger.log(
        `Deleted ${rowsToDelete.length} data rows for accountId "${targetAccountId}" from sheet "${SHEETS.POSTS}".`
      );
      return {
        status: "success",
        message: `Successfully deleted ${rowsToDelete.length} data rows for accountId "${targetAccountId}".`,
        deletedCount: rowsToDelete.length,
      };
    } catch (e: any) {
      Logger.log(
        `Error during bulk deletion of PostData for accountId "${targetAccountId}": ${e}`
      );
      throw new Error(
        `Failed during bulk deletion of PostData for accountId "${targetAccountId}": ${e.message}`
      );
    }
  } else {
    // --- 単一削除処理 ---
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    // ヘッダー行を取得し、ID列のインデックスを確認
    if (values.length === 0) {
      throw new Error(
        `Sheet "${SHEETS.POSTS}" is empty or header row is missing.`
      );
    }
    const headers = values[0].map((header) => String(header).trim());
    const idColumnIndex = headers.indexOf("id");

    if (idColumnIndex === -1) {
      throw new Error('Cannot find "id" column in the sheet header.');
    }

    let sheetRowToDelete = -1; // 見つかった行のシート上の行番号 (1-based)

    // データ行を検索して対象IDを見つける (ヘッダー行を除く)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // ID列が存在し、値が一致するか確認
      if (row.length > idColumnIndex && row[idColumnIndex] === targetId) {
        sheetRowToDelete = i + 1; // シート上の行番号は配列インデックス+1
        break; // 見つかったらループを抜ける
      }
    }

    // 対象IDが見つからなかった場合
    if (sheetRowToDelete === -1) {
      throw new Error(
        `PostData with ID "${targetId}" not found in sheet "${SHEETS.POSTS}". Cannot delete.`
      );
    }

    // --- 削除実行 ---
    try {
      sheet.deleteRow(sheetRowToDelete);
      Logger.log(
        `PostData with ID "${targetId}" deleted successfully from row ${sheetRowToDelete}.`
      );
      return {
        status: "success",
        message: `PostData with ID "${targetId}" deleted successfully.`,
        deletedId: targetId,
        deletedCount: 1,
      };
    } catch (e: any) {
      Logger.log(`Error deleting PostData with ID "${targetId}": ${e}`);
      throw new Error(`Failed to delete PostData: ${e.message}`);
    }
  }
}

/**
 * 'Posted' シートに保存されている全ての投稿済みデータを取得します。
 * @return {XPostData[]} 保存されている投稿済みデータオブジェクトの配列。データがない場合は空配列。
 * @throws {Error} シートが見つからない場合。
 */
function fetchPostedData() {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(
    SHEETS.POSTED,
    HEADERS.POST_HEADERS
  );

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEETS.POSTED}".`);
    return []; // データ行がないので空配列を返す
  }

  // ヘッダー行を取得 (最初の行)
  const headers = values[0].map((header) => String(header).trim()); // ヘッダー名を文字列に変換し、前後の空白を削除

  // データ行 (ヘッダーを除く) をオブジェクトの配列に変換
  const postedDataList: XPostData[] = [];
  for (let i = 1; i < values.length; i++) {
    // i = 1 から開始してヘッダー行をスキップ
    const row = values[i];
    const postedData: XPostData = {};

    // ヘッダーに基づいてオブジェクトを構築
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      // ヘッダー名が空でないことを確認
      if (header) {
        let value = j < row.length ? row[j] : ""; // 行に対応するデータがあれば取得、なければ空文字

        // 特定の型変換が必要な場合はここに追加 (例: createdAt列がDateオブジェクトの場合)
        if (header === "createdAt" && value instanceof Date) {
          value = value.toISOString();
        } else if (header === "postSchedule" && value instanceof Date) {
          // postScheduleもDateオブジェクトの場合があるかもしれないので変換
          value = value.toISOString();
        }
        postedData[header] = value;
      }
    }

    // idフィールドが存在し、空でない行のみを結果に含める（任意）
    if (postedData.id) {
      postedDataList.push(postedData);
    } else {
      Logger.log(
        `Skipping row ${i + 1} in ${SHEETS.POSTED} due to missing or empty id.`
      );
    }
  }

  Logger.log(
    `Fetched ${postedDataList.length} posted data entries from sheet "${SHEETS.POSTED}".`
  );
  return postedDataList;
}

/**
 * 'Errors' シートに記録されている全ての エラーデータを取得します。
 * @return {object[]} 保存されているエラーデータオブジェクトの配列。データがない場合は空配列。
 * @throws {Error} シートが見つからない場合。
 */
function fetchErrorData() {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(
    SHEETS.ERRORS,
    HEADERS.ERROR_HEADERS
  );

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEETS.ERRORS}".`);
    return []; // データ行がないので空配列を返す
  }

  // ヘッダー行を取得 (最初の行)
  const headers = values[0].map((header) => String(header).trim());

  // データ行 (ヘッダーを除く) をオブジェクトの配列に変換
  const errorDataList: PostError[] = [];
  for (let i = 1; i < values.length; i++) {
    // i = 1 から開始してヘッダー行をスキップ
    const row = values[i];
    const errorData: PostError = {
      timestamp: "",
      context: "",
      message: "",
      stack: "",
    };

    // ヘッダーに基づいてオブジェクトを構築
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      // ヘッダー名が空でないことを確認
      if (header) {
        let value = j < row.length ? row[j] : ""; // 行に対応するデータがあれば取得、なければ空文字

        // Timestamp列がDateオブジェクトの場合、ISO文字列に変換
        if (header === "Timestamp" && value instanceof Date) {
          value = value.toISOString();
        }
        errorData[header] = value;
      }
    }
    // エラーデータの場合、通常は空行を除外する必要はないが、
    // Timestampが空でない行のみ含めるなどのフィルタリングは可能
    if (errorData["Timestamp"]) {
      // Timestampが存在する行のみを追加
      errorDataList.push(errorData);
    } else {
      Logger.log(
        `Skipping row ${i + 1} in ${SHEETS.ERRORS} due to missing Timestamp.`
      );
    }
  }

  Logger.log(
    `Fetched ${errorDataList.length} error data entries from sheet "${SHEETS.ERRORS}".`
  );
  return errorDataList;
}

/**
 * 'Posts' シートの複数行の postSchedule を一括で更新します。
 *
 * @param {PostScheduleUpdate[]} updates - 更新する投稿のIDと新しいpostScheduleの配列, postScheduleが空欄の場合はクリア。
 * @return {UpdateResult[]} 各更新試行の結果の配列。
 * @throws {Error} シートが見つからない、ヘッダーがない、または予期せぬエラーが発生した場合。
 */
function updateMultiplePostSchedules(
  updates: PostScheduleUpdate[]
): UpdateResult[] {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 更新データが空の場合は何もせずに終了
  if (!updates || updates.length === 0) {
    Logger.log("No updates provided for post schedules.");
    return [];
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // ヘッダー行を取得し、列名とインデックスのマッピングを作成
  if (values.length === 0) {
    throw new Error(
      `Sheet "${SHEETS.POSTS}" is empty or header row is missing.`
    );
  }
  const headers = values[0].map((header) => String(header).trim());
  const headerMap: { [key: string]: number } = {};
  headers.forEach((header, index) => {
    if (header) {
      headerMap[header] = index;
    }
  });

  // ID列とpostSchedule列のインデックスを確認
  const idColumnIndex = headerMap["id"];
  const postScheduleColumnIndex = headerMap["postSchedule"];
  if (idColumnIndex === undefined) {
    throw new Error('Cannot find "id" column in the sheet header.');
  }
  if (postScheduleColumnIndex === undefined) {
    throw new Error('Cannot find "postSchedule" column in the sheet header.');
  }

  // IDをキー、行インデックス(0-based in values array)を値とするMapを作成
  const idRowIndexMap = new Map<string, number>();
  for (let i = 1; i < values.length; i++) {
    // ヘッダー行(i=0)を除く
    const rowId = values[i][idColumnIndex];
    if (rowId !== undefined && rowId !== null && rowId !== "") {
      idRowIndexMap.set(String(rowId), i);
    }
  }

  const results: UpdateResult[] = [];
  let updateCount = 0;

  // 更新データをループし、シートデータ配列(values)を直接変更
  for (const update of updates) {
    const targetId = update.id;
    const newSchedule = update.postSchedule; // TODO: 必要であればここで日付形式のバリデーションを追加

    const rowIndex = idRowIndexMap.get(targetId);

    if (rowIndex !== undefined) {
      // 行が見つかった場合
      try {
        const valueToSet =
          newSchedule === "" ||
          newSchedule === null ||
          newSchedule === undefined
            ? ""
            : newSchedule;
        // values 配列内の該当セルの値を更新
        values[rowIndex][postScheduleColumnIndex] = valueToSet;
        results.push({ id: targetId, status: "updated" });
        updateCount++;
      } catch (e: any) {
        Logger.log(`Error preparing update for ID "${targetId}": ${e}`);
        results.push({ id: targetId, status: "error", message: e.message });
      }
    } else {
      // IDが見つからなかった場合
      results.push({ id: targetId, status: "not_found" });
    }
  }

  // 更新があった場合のみシートに書き込む
  if (updateCount > 0) {
    try {
      // dataRange (シート全体) に変更を書き戻す
      // 注意: シートが大きい場合、パフォーマンスに影響する可能性があります。
      // より最適化するには、変更があった行の範囲だけを特定して setValues する必要がありますが、実装が複雑になります。
      dataRange.setValues(values);
      Logger.log(
        `Successfully updated ${updateCount} post schedules in sheet "${SHEETS.POSTS}".`
      );
    } catch (e: any) {
      Logger.log(`Error writing updated schedules back to sheet: ${e}`);
      // 書き込みエラーが発生した場合、成功したはずの更新結果をエラーとしてマークし直すか検討
      throw new Error(`Failed to write updates to sheet: ${e.message}`);
    }
  } else {
    Logger.log("No matching IDs found to update.");
  }

  return results;
}

/**
 * 'Posts' シートから指定されたIDリストに一致する複数行を一括で削除します。
 *
 * @param {PostDeletion[]} deletions - 削除する投稿のIDの配列。
 * @return {DeleteResult[]} 各削除試行の結果の配列。
 * @throws {Error} シートが見つからない、ヘッダーがない、または予期せぬエラーが発生した場合。
 */
function deleteMultiplePostData(deletions: PostDeletion[]): DeleteResult[] {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 削除データが空の場合は何もせずに終了
  if (!deletions || deletions.length === 0) {
    Logger.log("No deletions provided.");
    return [];
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // ヘッダー行を取得し、列名とインデックスのマッピングを作成
  if (values.length === 0) {
    throw new Error(
      `Sheet "${SHEETS.POSTS}" is empty or header row is missing.`
    );
  }
  const headers = values[0].map((header) => String(header).trim());
  const headerMap: { [key: string]: number } = {};
  headers.forEach((header, index) => {
    if (header) {
      headerMap[header] = index;
    }
  });

  // ID列のインデックスを確認
  const idColumnIndex = headerMap["id"];
  if (idColumnIndex === undefined) {
    throw new Error('Cannot find "id" column in the sheet header.');
  }

  const results: DeleteResult[] = [];
  const rowsToDelete: number[] = []; // 削除対象のシート上の行番号(1-based)を格納
  const idToRowMap = new Map<string, number>(); // IDと行番号のマッピング

  // シートデータを走査してIDと行番号(1-based)のマップを作成
  for (let i = 1; i < values.length; i++) {
    // ヘッダー行(i=0)を除く
    const rowId = values[i][idColumnIndex];
    if (rowId !== undefined && rowId !== null && rowId !== "") {
      idToRowMap.set(String(rowId), i + 1); // iは0-based indexなので、行番号は i + 1
    }
  }

  // 削除対象のIDリストをループし、削除する行番号を特定
  const deletionIds = new Set(deletions.map((d) => d.id)); // 処理済みIDを管理しやすくするためSetを使用
  for (const idToDelete of deletionIds) {
    const rowNumber = idToRowMap.get(idToDelete);
    if (rowNumber !== undefined) {
      rowsToDelete.push(rowNumber);
    } else {
      results.push({ id: idToDelete, status: "not_found" });
    }
  }

  // 削除対象行がない場合はここで終了
  if (rowsToDelete.length === 0) {
    Logger.log("No matching rows found to delete.");
    return results; // not_found の結果だけが含まれる
  }

  // --- 削除実行 ---
  // 行番号が大きい順にソート（後ろから削除しないとインデックスがずれる）
  rowsToDelete.sort((a, b) => b - a);

  let deletedCount = 0;
  const processedIds = new Set<string>(); // 削除試行したIDを記録

  try {
    for (const rowNumber of rowsToDelete) {
      // 該当行番号に対応するIDを逆引き（効率は良くないが確実性のため）
      let currentId = "";
      for (const [id, rn] of idToRowMap.entries()) {
        if (rn === rowNumber) {
          currentId = id;
          break;
        }
      }

      if (currentId && !processedIds.has(currentId)) {
        // まだ処理していないIDか確認
        processedIds.add(currentId); // 処理済みとしてマーク
        try {
          sheet.deleteRow(rowNumber);
          results.push({ id: currentId, status: "deleted" });
          deletedCount++;
        } catch (deleteError: any) {
          Logger.log(
            `Error deleting row ${rowNumber} (ID: ${currentId}): ${deleteError}`
          );
          results.push({
            id: currentId,
            status: "error",
            message: deleteError.message,
          });
        }
      }
    }
    Logger.log(
      `Attempted to delete ${rowsToDelete.length} rows. Successfully deleted ${deletedCount} rows.`
    );
  } catch (e: any) {
    // このレベルのエラーは通常発生しにくいが念のため
    Logger.log(`Unexpected error during bulk deletion process: ${e}`);
    // 既に results に含まれていないIDに対してエラーを追加するか検討
    throw new Error(`Failed during bulk deletion process: ${e.message}`);
  }

  // results 配列を ID でソートして返すとクライアント側で扱いやすいかもしれない (任意)
  // results.sort((a, b) => a.id.localeCompare(b.id));

  return results;
}

export {
  createPostData,
  fetchPostData,
  updatePostData,
  deletePostData,
  fetchPostedData,
  fetchErrorData,
  updateMultiplePostSchedules,
  deleteMultiplePostData,
};
