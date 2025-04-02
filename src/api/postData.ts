import { PostError, XPostData } from "../types";

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
  const SHEET_NAME = "Posts";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  // ヘッダー定義 (シートの列の順番)
  const headerColumns = [
    "id",
    "createdAt",
    "postTo",
    "media",
    "postSchedule",
    "inReplytoInternal",
    "postId",
    "inReplyToOnX",
  ];

  // シートが存在しない場合、作成してヘッダーを挿入
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log(`Sheet "${SHEET_NAME}" created.`);
    sheet.appendRow(headerColumns);
    Logger.log(`Header row added to "${SHEET_NAME}".`);
    // シートが非常に大きい場合や権限の問題でフリーズすることがあるため、念のためflush
    SpreadsheetApp.flush();
  } else {
    // シートが存在する場合、ヘッダー行が存在するかチェック (シートが空の場合のみヘッダーを追加)
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headerColumns);
      Logger.log(`Header row added to existing empty sheet "${SHEET_NAME}".`);
      SpreadsheetApp.flush();
    }
    // オプション: 1行目が存在し、それが期待するヘッダーかどうかの厳密なチェックが必要な場合は、ここに追加します。
    // 例:
    // const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    // if (JSON.stringify(currentHeaders) !== JSON.stringify(headerColumns)) {
    //   // ヘッダーが異なる場合の処理 (エラーにする、上書きするなど)
    //   Logger.log("Warning: Existing header does not match the expected header.");
    //   // throw new Error("Existing header mismatch in Posts sheet.");
    // }
  }

  // 必須フィールドの簡易チェック (必要に応じて追加)
  if (!postDataInput.postTo || !postDataInput.postSchedule) {
    throw new Error("Missing required fields: postTo and postSchedule.");
  }

  // --- データ準備 ---
  const newId = Utilities.getUuid(); // ユニークIDを生成
  const createdAt = new Date(); // 現在日時を取得

  // XPostDataオブジェクトを完成させる
  const newPostData = {
    id: newId,
    createdAt: createdAt.toISOString(), // ISO 8601形式の文字列で保存
    postTo: postDataInput.postTo,
    media: postDataInput.media || "", // mediaがない場合は空文字列
    postSchedule: postDataInput.postSchedule,
    inReplytoInternal: postDataInput.inReplytoInternal || "", // 未指定なら空文字列
    postId: postDataInput.postId || "", // 初期値は空文字列
    inReplyToOnX: postDataInput.inReplyToOnX || "", // 初期値は空文字列
  };

  // --- シートへの書き込み ---
  try {
    // ヘッダーの順番に合わせて値の配列を作成
    const rowData = headerColumns.map((header) => {
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
  const SHEET_NAME = "Posts";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // シートが存在しない場合は明確なエラーを返す
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
    // もしシートが存在しないことをデータ無しと同義として扱うなら、以下のように空配列を返すことも可能
    // Logger.log(`Sheet "${SHEET_NAME}" not found. Returning empty array.`);
    // return [];
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEET_NAME}".`);
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
    `Fetched ${postDataList.length} post data entries from sheet "${SHEET_NAME}".`
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
  const SHEET_NAME = "Posts";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

  // 更新データにIDが含まれているかチェック
  if (!postDataToUpdate || !postDataToUpdate.id) {
    throw new Error('Missing required field "id" in the update data.');
  }
  const targetId = postDataToUpdate.id;

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // ヘッダー行を取得し、列名とインデックスのマッピングを作成
  if (values.length === 0) {
    throw new Error(`Sheet "${SHEET_NAME}" is empty or header row is missing.`);
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
      `PostData with ID "${targetId}" not found in sheet "${SHEET_NAME}".`
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
  const SHEET_NAME = "Posts";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

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
        `Sheet "${SHEET_NAME}" is empty or header row is missing.`
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
        `No data rows to delete for accountId "${targetAccountId}" in sheet "${SHEET_NAME}".`
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
        `Deleted ${rowsToDelete.length} data rows for accountId "${targetAccountId}" from sheet "${SHEET_NAME}".`
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
        `Sheet "${SHEET_NAME}" is empty or header row is missing.`
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
        `PostData with ID "${targetId}" not found in sheet "${SHEET_NAME}". Cannot delete.`
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
  const SHEET_NAME = "Posted"; // 対象シート名を変更
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // Postedシートがない場合もエラーとする（main.tsで作成されるはずだが念のため）
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEET_NAME}".`);
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
        `Skipping row ${i + 1} in ${SHEET_NAME} due to missing or empty id.`
      );
    }
  }

  Logger.log(
    `Fetched ${postedDataList.length} posted data entries from sheet "${SHEET_NAME}".`
  );
  return postedDataList;
}

/**
 * 'Errors' シートに記録されている全ての エラーデータを取得します。
 * @return {object[]} 保存されているエラーデータオブジェクトの配列。データがない場合は空配列。
 * @throws {Error} シートが見つからない場合。
 */
function fetchErrorData() {
  const SHEET_NAME = "Errors"; // 対象シート名を指定
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // Errorsシートがない場合もエラーとする（main.tsで作成されるはずだが念のため）
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // データがヘッダー行のみ、または全くない場合
  if (values.length <= 1) {
    Logger.log(`No data rows found in sheet "${SHEET_NAME}".`);
    return []; // データ行がないので空配列を返す
  }

  // ヘッダー行を取得 (最初の行)
  // Errorsシートのヘッダーは main.ts で定義済み ['Timestamp', 'Context', 'Error Message', 'Stack Trace']
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
        `Skipping row ${i + 1} in ${SHEET_NAME} due to missing Timestamp.`
      );
    }
  }

  Logger.log(
    `Fetched ${errorDataList.length} error data entries from sheet "${SHEET_NAME}".`
  );
  return errorDataList;
}

export {
  createPostData,
  fetchPostData,
  updatePostData,
  deletePostData,
  fetchPostedData,
  fetchErrorData,
};
