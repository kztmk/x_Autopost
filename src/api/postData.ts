import {
  PostError,
  XPostData,
  XPostedData,
  PostScheduleUpdate,
  UpdateResult,
  PostDeletion,
  DeleteResult,
  XPostDataInput,
  UpdateInReplyToResult,
} from "../types";

import { SHEETS, HEADERS } from "../constants"; // Import constants

/**
 * 指定された名前のシートを取得し、ない場合は作成してヘッダーを挿入します。
 * 既に存在する場合でもヘッダー行が空なら挿入します。
 *
 * @param {string} sheetName - 取得または作成するシート名
 * @param {ReadonlyArray<string>} headerColumns - ヘッダー列名の配列 (受け入れる型をReadonlyArrayに変更)
 * @return {GoogleAppsScript.Spreadsheet.Sheet} 取得または作成されたシート
 * @throws {Error} シートの作成または操作に失敗した場合
 */
export function getOrCreateSheetWithHeaders(
  sheetName: string,
  headerColumns: ReadonlyArray<string> // Accept ReadonlyArray
): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  // シートが存在しない場合、作成してヘッダーを挿入
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log(`Sheet "${sheetName}" created.`);
    // Spread into a mutable array for appendRow
    sheet.appendRow([...headerColumns]);
    Logger.log(`Header row added to "${sheetName}".`);
    SpreadsheetApp.flush();
  } else {
    // シートが存在する場合、ヘッダー行が存在するかチェック
    if (sheet.getLastRow() === 0) {
      // Spread into a mutable array for appendRow
      sheet.appendRow([...headerColumns]);
      Logger.log(`Header row added to existing empty sheet "${sheetName}".`);
      SpreadsheetApp.flush();
    }
  }

  return sheet;
}

/**
 * 指定された投稿データを POST_QUEUE シートに新しい行として保存します。
 * シートが存在しない場合は作成し、ヘッダー行を挿入します。
 * 保存時にユニークなIDと作成日時を付与します。
 *
 * @param {XPostDataInput} postDataInput - 保存する投稿データオブジェクト。
 * @return {XPostData} 保存された完全なXPostDataオブジェクト。
 * @throws {Error} 必須フィールドが不足している、または書き込みに失敗した場合。
 */
function createPostData(postDataInput: XPostDataInput): XPostData {
  // Pass the readonly array directly
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  if (!postDataInput.postTo || !postDataInput.contents) {
    throw new Error("Missing required fields: postTo and contents.");
  }

  const newId = Utilities.getUuid();
  const createdAt = new Date();

  // Align with HEADERS.POST_HEADERS from constants.ts
  const newPostData: XPostData = {
    id: newId,
    createdAt: createdAt.toISOString(),
    postTo: postDataInput.postTo,
    contents: postDataInput.contents,
    mediaUrls: postDataInput.mediaUrls || "", // Use mediaUrls
    postSchedule: postDataInput.postSchedule || "",
    inReplyToInternal: postDataInput.inReplytoInternal || "",
    postId: postDataInput.postId || "",
    inReplyToOnX: postDataInput.inReplyToOnX || "",
    quoteId: postDataInput.quoteId || "", // Add quoteId
    repostTargetId: postDataInput.repostTargetId || "", // Add repostTargetId
    status: postDataInput.status || "queued", // Default to 'queued' if not specified
    errorMessage: postDataInput.errorMessage || "",
  };

  try {
    // Map values based on the order in HEADERS.POST_HEADERS
    const rowData = HEADERS.POST_HEADERS.map((header) => {
      // Use type assertion for safety
      return newPostData[header as keyof XPostData] ?? "";
    });

    sheet.appendRow(rowData);

    Logger.log(`PostData created with ID: ${newId}`);
    return newPostData;
  } catch (e: any) {
    Logger.log(`Error creating PostData: ${e}`);
    throw new Error(`Failed to save PostData to sheet: ${e.message}`);
  }
}

/**
 * POST_QUEUE シートに保存されている全てのX投稿データを取得します。
 * @return {XPostData[]} 保存されているXPostDataオブジェクトの配列。
 * @throws {Error} シートが見つからない場合。
 */
function fetchPostData(): XPostData[] {
  // Pass the readonly array directly
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  if (values.length <= 1) {
    return []; // No data rows
  }

  // Use HEADERS.POST_HEADERS as the source of truth for headers
  const headers = HEADERS.POST_HEADERS;
  const headerMap: { [key: string]: number } = {};
  headers.forEach((header, index) => {
    headerMap[header] = index;
  });

  const postDataList: XPostData[] = [];
  // Start from row 1 (index 1) to skip header row
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // Map row data to object using headerMap
    const postData: Partial<XPostData> = {};
    headers.forEach((header) => {
      const index = headerMap[header];
      if (index !== undefined && index < row.length) {
        // Assign value to the corresponding key in postData
        (postData as any)[header] = row[index];
      }
    });

    // Basic validation (e.g., check if ID exists)
    if (postData.id) {
      postDataList.push(postData as XPostData);
    } else {
      Logger.log(`Skipping row ${i + 1} due to missing ID or invalid data.`);
    }
  }
  return postDataList;
}

/**
 * 'Posts' シートに保存されている指定されたIDのX投稿データを更新します。
 * 更新データにはIDが含まれている必要があります。createdAtは更新されません。
 *
 * @param {XPostData} postDataToUpdate - 更新する投稿データオブジェクト。
 * @return {XPostData} 更新後の完全なXPostDataオブジェクト。
 * @throws {Error} シートが見つからない、ヘッダーがない、必須のidがない、
 *                 指定されたIDのデータが見つからない、または更新に失敗した場合。
 */
function updatePostData(postDataToUpdate: XPostData): XPostData {
  // Pass the readonly array directly
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  if (values.length <= 1) {
    throw new Error(`Sheet '${SHEETS.POSTS}' is empty or has no data.`);
  }

  // Use HEADERS.POST_HEADERS
  const headers = HEADERS.POST_HEADERS;
  const idIndex = headers.indexOf("id");

  if (idIndex === -1) {
    throw new Error("Header 'id' not found in Posts sheet.");
  }
  if (!postDataToUpdate.id) {
    throw new Error("Missing 'id' in postDataToUpdate.");
  }

  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (values[i][idIndex] === postDataToUpdate.id) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`PostData with ID '${postDataToUpdate.id}' not found.`);
  }

  // Prepare the updated row data based on HEADERS.POST_HEADERS order
  const updatedRow = headers.map((header) => {
    // Use updated value if present, otherwise keep original value
    // Ensure createdAt is not overwritten
    if (header === "createdAt") {
      return values[rowIndex][headers.indexOf(header)];
    }
    return (
      postDataToUpdate[header as keyof XPostData] ??
      values[rowIndex][headers.indexOf(header)] ??
      ""
    );
  });

  try {
    // Update the specific row (rowIndex is 0-based, sheet range is 1-based)
    sheet
      .getRange(rowIndex + 1, 1, 1, updatedRow.length)
      .setValues([updatedRow]);
    Logger.log(`PostData updated for ID: ${postDataToUpdate.id}`);

    // Fetch the updated data to return the complete object (optional, could construct from updatedRow)
    // For simplicity, returning the input object which should reflect the update
    // A more robust approach might re-fetch or construct the object from updatedRow + headers
    return postDataToUpdate; // Or construct a new object based on updatedRow
  } catch (e: any) {
    Logger.log(`Error updating PostData for ID ${postDataToUpdate.id}: ${e}`);
    throw new Error(`Failed to update PostData in sheet: ${e.message}`);
  }
}

/**
 * 'Posts' シートから指定されたIDのX投稿データを削除します。
 * IDが "all" の場合は、指定された postTo に一致する全てのデータ行を削除します。
 *
 * @param {PostDeletion} postDataToDelete - 削除対象のID (または "all") と、"all" の場合は postTo を含むオブジェクト。
 * @return {object} 削除成功を示すメッセージ。全削除の場合は削除件数も含む。
 * @throws {Error} シートが見つからない、必須のid/postToがない、対象IDが見つからない(単一削除時)、
 *                 または削除に失敗した場合。
 */
function deletePostData(postDataToDelete: PostDeletion): DeleteResult {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 削除データにIDが含まれているかチェック
  if (!postDataToDelete || !postDataToDelete.id) {
    throw new Error('Missing required field "id" in the delete request body.');
  }
  const targetId = postDataToDelete.id;

  if (targetId === "all") {
    // --- 全削除処理 ---
    // postTo が指定されているかチェック
    if (!postDataToDelete.postTo) {
      throw new Error(
        'Missing required field "postTo" when deleting all posts.'
      );
    }
    const targetPostTo = postDataToDelete.postTo;

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    // ヘッダー行を取得し、postTo列のインデックスを確認
    if (values.length <= 1) {
      // Check if only header exists or empty
      Logger.log(`Sheet "${SHEETS.POSTS}" is empty or has no data rows.`);
      return {
        id: "all",
        status: "not_found",
        message: `No data rows found in sheet "${SHEETS.POSTS}".`,
      };
    }
    // Use HEADERS.POST_HEADERS to find the index
    const postToColumnIndex = HEADERS.POST_HEADERS.indexOf("postTo");

    if (postToColumnIndex === -1) {
      throw new Error('Cannot find "postTo" column in the sheet header.');
    }

    let rowsToDelete: number[] = [];

    // データ行を検索して対象のpostToを持つ行を特定 (ヘッダー行を除く)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // postTo列が存在し、値が一致するか確認
      if (
        row.length > postToColumnIndex &&
        row[postToColumnIndex] === targetPostTo
      ) {
        rowsToDelete.push(i + 1); // シート上の行番号は配列インデックス+1
      }
    }

    // 削除対象の行がない場合
    if (rowsToDelete.length === 0) {
      Logger.log(
        `No data rows to delete for postTo "${targetPostTo}" in sheet "${SHEETS.POSTS}".`
      );
      return {
        id: "all", // Indicate it was an 'all' request
        status: "not_found",
        message: `No data rows found to delete for postTo "${targetPostTo}".`,
      };
    }

    try {
      // 行番号が大きい順に削除 (後ろから削除しないと行番号が変わる)
      rowsToDelete.sort((a, b) => b - a);
      rowsToDelete.forEach((row) => {
        sheet.deleteRow(row);
      });

      Logger.log(
        `Deleted ${rowsToDelete.length} data rows for postTo "${targetPostTo}" from sheet "${SHEETS.POSTS}".`
      );
      return {
        id: "all", // Indicate it was an 'all' request
        status: "deleted",
        message: `Successfully deleted ${rowsToDelete.length} data rows for postTo "${targetPostTo}".`,
      };
    } catch (e: any) {
      Logger.log(
        `Error during bulk deletion of PostData for postTo "${targetPostTo}": ${e}`
      );
      throw new Error(
        `Failed during bulk deletion of PostData for postTo "${targetPostTo}": ${e.message}`
      );
    }
  } else {
    // --- 単一削除処理 ---
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    // ヘッダー行を取得し、ID列のインデックスを確認
    if (values.length <= 1) {
      throw new Error(`Sheet "${SHEETS.POSTS}" is empty or has no data rows.`);
    }
    // Use HEADERS.POST_HEADERS to find the index
    const idColumnIndex = HEADERS.POST_HEADERS.indexOf("id");

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
      return {
        id: targetId,
        status: "not_found",
        message: `PostData with ID "${targetId}" not found in sheet "${SHEETS.POSTS}". Cannot delete.`,
      };
    }

    // --- 削除実行 ---
    try {
      sheet.deleteRow(sheetRowToDelete);
      Logger.log(
        `PostData with ID "${targetId}" deleted successfully from row ${sheetRowToDelete}.`
      );
      return {
        id: targetId,
        status: "deleted",
        message: `PostData with ID "${targetId}" deleted successfully.`,
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
    HEADERS.POSTED_HEADERS
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
  const postedDataList: XPostedData[] = [];
  for (let i = 1; i < values.length; i++) {
    // i = 1 から開始してヘッダー行をスキップ
    const row = values[i];
    const postedData: Partial<XPostedData> = {};

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
        } else if (header === "postedAt" && value instanceof Date) {
          value = value.toISOString();
        }
        postedData[header] = value;
      }
    }

    // idフィールドが存在し、空でない行のみを結果に含める（任意）
    if (postedData.id) {
      postedDataList.push(postedData as XPostedData);
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
        if (header === "timestamp" && value instanceof Date) {
          value = value.toISOString();
        }
        errorData[header as keyof PostError] = value as string;
      }
    }
    // エラーデータの場合、通常は空行を除外する必要はないが、
    // Timestampが空でない行のみ含めるなどのフィルタリングは可能
    if (errorData["timestamp"]) {
      // Timestampが存在する行のみを追加
      errorDataList.push(errorData);
    } else {
      Logger.log(
        `Skipping row ${i + 1} in ${SHEETS.ERRORS} due to missing timestamp.`
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
        results.push({
          id: targetId,
          status: "updated",
          postSchedule: valueToSet,
        });
        updateCount++;
      } catch (e: any) {
        Logger.log(`Error preparing update for ID "${targetId}": ${e}`);
        results.push({
          id: targetId,
          status: "error",
          postSchedule: "",
          message: e.message,
        });
      }
    } else {
      // IDが見つからなかった場合
      results.push({ id: targetId, status: "not_found", postSchedule: "" });
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
 * 複数の投稿の inReplyToInternal を一括更新します。
 * スレッド投稿のリプライ関係を更新するために使用します。
 *
 * @param {Array<{id: string, inReplyToInternal: string}>} updateRequests - 更新するID と inReplyToInternal のペアの配列
 * @return {Array<{id: string, status: string, message?: string}>} 各更新リクエストの結果
 */
function updateInReplyTo(
  updateRequests: Array<{ id: string; inReplyToInternal: string }>
): UpdateInReplyToResult[] {
  // 共通関数を使用してシート取得または作成
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);

  // 更新リクエストの配列が有効かチェック
  if (!Array.isArray(updateRequests) || updateRequests.length === 0) {
    throw new Error("Invalid or empty update requests array.");
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
  const idColumnIndex = headers.indexOf("id");
  const inReplyToInternalColumnIndex = headers.indexOf("inReplyToInternal");

  // 必要な列が存在するか確認
  if (idColumnIndex === -1) {
    throw new Error('Cannot find "id" column in the sheet header.');
  }
  if (inReplyToInternalColumnIndex === -1) {
    throw new Error(
      'Cannot find "inReplyToInternal" column in the sheet header.'
    );
  }

  // 各リクエストに対する結果を保持する配列
  const results: UpdateInReplyToResult[] = [];

  // 各更新リクエストを処理
  for (const request of updateRequests) {
    const { id, inReplyToInternal } = request;

    // IDが提供されているかチェック
    if (!id) {
      results.push({
        id: id || "unknown",
        status: "error",
        inReplyToInternal: "",
        message: 'Missing required field "id" in update request.',
      });
      continue;
    }

    let rowIndex = -1;
    // 対象IDを持つ行を探す
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (row[idColumnIndex] === id) {
        rowIndex = i;
        break;
      }
    }

    // 対象IDが見つからなかった場合
    if (rowIndex === -1) {
      results.push({
        id: id,
        status: "not_found",
        inReplyToInternal: "",
        message: `PostData with ID "${id}" not found.`,
      });
      continue;
    }

    try {
      // inReplyToInternal フィールドを更新
      sheet
        .getRange(rowIndex + 1, inReplyToInternalColumnIndex + 1)
        .setValue(inReplyToInternal || "");

      results.push({
        id: id,
        status: "updated",
        inReplyToInternal: inReplyToInternal || "",
      });

      Logger.log(
        `inReplyToInternal for post with ID "${id}" updated successfully.`
      );
    } catch (e: any) {
      results.push({
        id: id,
        status: "error",
        inReplyToInternal: "",
        message: `Error updating inReplyToInternal: ${e.message}`,
      });

      Logger.log(`Error updating inReplyToInternal for post ID "${id}": ${e}`);
    }
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

/**
 * 複数の投稿データを一括で 'Posts' シートに保存します。
 *
 * @param {XPostDataInput[]} postsInput - 保存する投稿データオブジェクトの配列。
 * @return {XPostData[]} 保存された完全なXPostDataオブジェクトの配列。
 * @throws {Error} シートが見つからない、必須フィールドが不足している、または書き込みに失敗した場合。
 */
function createMultiplePosts(postsInput: XPostDataInput[]): XPostData[] {
  const sheet = getOrCreateSheetWithHeaders(SHEETS.POSTS, HEADERS.POST_HEADERS);
  const results: XPostData[] = [];
  const rowsToAdd: any[][] = [];

  for (const postInput of postsInput) {
    if (!postInput.postTo || !postInput.contents) {
      // Optionally log or handle invalid inputs differently
      Logger.log(
        `Skipping post due to missing required fields: postTo or contents.`
      );
      continue; // Skip this post
    }

    const newId = Utilities.getUuid();
    const createdAt = new Date();

    const newPostData: XPostData = {
      id: newId,
      createdAt: createdAt.toISOString(),
      postTo: postInput.postTo,
      contents: postInput.contents,
      mediaUrls: postInput.mediaUrls || "", // Corrected: Use mediaUrls
      postSchedule: postInput.postSchedule || "",
      inReplyToInternal: postInput.inReplytoInternal || "",
      postId: postInput.postId || "",
      inReplyToOnX: postInput.inReplyToOnX || "",
      quoteId: postInput.quoteId || "",
      repostTargetId: postInput.repostTargetId || "",
      status: postInput.status || "queued", // Default to 'queued'
      errorMessage: postInput.errorMessage || "", // Include error message if present
    };

    const rowData = HEADERS.POST_HEADERS.map(
      (header) => newPostData[header as keyof XPostData] ?? ""
    );
    rowsToAdd.push(rowData);
    results.push(newPostData); // Add successfully processed data to results
  }

  if (rowsToAdd.length > 0) {
    try {
      // Append all rows at once for better performance
      sheet
        .getRange(
          sheet.getLastRow() + 1,
          1,
          rowsToAdd.length,
          HEADERS.POST_HEADERS.length
        )
        .setValues(rowsToAdd);
      Logger.log(`Created ${rowsToAdd.length} posts successfully.`);
    } catch (e: any) {
      Logger.log(`Error creating multiple PostData entries: ${e}`);
      // Consider how to handle partial success/failure if needed
      throw new Error(
        `Failed to save multiple PostData entries to sheet: ${e.message}`
      );
    }
  }

  return results;
}

// Export functions that should be accessible from other modules
export {
  createPostData,
  fetchPostData,
  updatePostData,
  deletePostData,
  fetchPostedData,
  fetchErrorData,
  updateMultiplePostSchedules,
  createMultiplePosts,
  updateInReplyTo,
  deleteMultiplePostData,
};
