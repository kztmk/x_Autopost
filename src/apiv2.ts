import {
  createXAuth,
  getXAuthAll,
  updateXAuth,
  deleteXAuth,
} from "./api/xauth";
import {
  createPostData,
  fetchPostData,
  updatePostData,
  deletePostData,
  fetchPostedData,
  fetchErrorData,
} from "./api/postData";
import {
  checkTriggerExists,
  createTimeBasedTrigger,
  deleteAllTriggers,
} from "./api/triggers";
import { uploadMediaFile } from "./api/media";
import { archiveSheet } from "./api/archive";
import { XAuthInfo, XPostData, PostError, TriggerProps } from "./types";

interface RequestData {
  [key: string]: any; // 任意のキーと値のペアを許可
}

interface ArchiveRequestData {
  filename: string;
}

/**
 * WebアプリへのPOSTリクエストを処理します。
 * actionとtargetパラメータに基づいて処理を分岐し、
 * データの作成、更新、削除を行います。
 * @param {object} e - Apps Scriptのイベントオブジェクト。
 * @return {ContentService.TextOutput} JSON形式のレスポンス。
 */
function doPost(e) {
  let action = e.parameter.action;
  let target = e.parameter.target;
  let response = {};
  let statusCode = 200; // デフォルトのステータスコード

  try {
    // リクエストボディをパース (JSONを期待)
    let requestData: any = {}; // デフォルトではany型として定義

    // requestDataの型を定義

    if (
      e.postData &&
      e.postData.type === "application/json" &&
      e.postData.contents
    ) {
      requestData = JSON.parse(e.postData.contents);
    } else if (e.postData && e.postData.contents) {
      // JSON以外の場合のフォールバック（必要に応じて）
      // requestData = { raw: e.postData.contents };
      // もしくはエラーとする
      throw new Error(
        "Invalid request body format. Expected application/json."
      );
    }

    // action 'archive' の場合を先に処理
    if (action === "archive") {
      let sourceSheetName;
      // target によってアーカイブ対象シート名を決定
      if (target === "posted") {
        sourceSheetName = "Posted";
      } else if (target === "errors") {
        sourceSheetName = "Errors";
      } else {
        statusCode = 400; // Bad Request
        throw new Error(
          `Invalid target '${target}' for action 'archive'. Must be 'posted' or 'errors'.`
        );
      }

      // リクエストボディから新しいシート名を取得 (キーは 'filename')
      const newSheetName = requestData.filename;
      if (
        !newSheetName ||
        typeof newSheetName !== "string" ||
        newSheetName.trim() === ""
      ) {
        statusCode = 400; // Bad Request
        throw new Error(
          "Missing or invalid 'filename' in request body for archiving."
        );
      }

      // アーカイブ関数を呼び出し
      response = archiveSheet(sourceSheetName, newSheetName.trim());
      statusCode = 201; // Created (アーカイブエントリ作成成功)
    } else {
      // targetに基づいて処理を分岐
      switch (target) {
        case "xauth":
          // actionに基づいてXAuth関連の処理を分岐
          switch (action) {
            case "create":
              response = createXAuth(requestData);
              statusCode = 201; // Created
              break;
            case "update":
              response = updateXAuth(requestData);
              break;
            case "delete":
              response = deleteXAuth(requestData);
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid action '${action}' for target 'xauth'`);
          }
          break;

        case "postData":
          // actionに基づいてPostData関連の処理を分岐
          switch (action) {
            case "create":
              response = createPostData(requestData);
              statusCode = 201; // Created
              break;
            case "update":
              response = updatePostData(requestData);
              break;
            case "delete":
              response = deletePostData(requestData);
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(
                `Invalid action '${action}' for target 'postData'`
              );
          }
          break;

        case "trigger":
          switch (action) {
            case "create":
              response = createTimeBasedTrigger(requestData);
              statusCode = 201; // Created
              break;
            case "delete":
              response = deleteAllTriggers();
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid target '${target}'`);
          }
          break;

        case "media":
          switch (action) {
            case "upload":
              response = uploadMediaFile(requestData);
              statusCode = 201; // Created
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid action '${action}' for target 'media'`);
          }
          break;

        default:
          statusCode = 400; // Bad Request
          throw new Error(`Invalid target '${target}'`);
      }
    }

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        data: response,
        code: statusCode, // Include status code in response JSON
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(
      `Error in doPost (action: ${action}, target: ${target}): ${error.message}\nStack: ${error.stack}`
    );
    // TODO: Errorシートへの記録処理をここに追加する可能性あり
    const errorStatusCode = statusCode !== 200 ? statusCode : 400; // エラー発生前のstatusCodeが400系ならそれを、そうでなければ400をデフォルトにする
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.message,
        code: errorStatusCode, // Include status code in response JSON
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * WebアプリへのGETリクエストを処理します。
 * actionとtargetパラメータに基づいて処理を分岐し、
 * データの取得を行います。
 * @param {object} e - Apps Scriptのイベントオブジェクト。
 * @return {ContentService.TextOutput} JSON形式のレスポンス。
 */
function doGet(e) {
  let action = e.parameter.action;
  let target = e.parameter.target;
  let response = {};
  let statusCode = 200; // デフォルト

  try {
    // targetに基づいて処理を分岐
    switch (target) {
      case "xauth":
        // actionに基づいてXAuth関連の処理を分岐
        switch (action) {
          case "fetch":
            response = getXAuthAll(); // 全てのaccountIdリストを取得
            break;
          // case 'getById': // 特定IDで取得する機能が必要な場合
          //   let accountId = e.parameter.accountId;
          //   if (!accountId) {
          //     statusCode = 400;
          //     throw new Error("Missing parameter: accountId");
          //   }
          //   response = getXAuthById(accountId); // 別途getXAuthById関数を実装する必要あり
          //   break;
          default:
            statusCode = 400; // Bad Request
            throw new Error(
              `Invalid action '${action}' for target 'xauth' in GET request`
            );
        }
        break;

      case "postData":
        // actionに基づいてPostData関連の処理を分岐
        switch (action) {
          case "fetch":
            response = fetchPostData(); // 全ての投稿データを取得
            break;
          // case 'getById': // 特定IDで取得する機能が必要な場合
          //   let postId = e.parameter.id;
          //   if (!postId) {
          //     statusCode = 400;
          //     throw new Error("Missing parameter: id");
          //   }
          //   response = getPostDataById(postId); // 別途getPostDataById関数を実装する必要あり
          //   break;

          default:
            statusCode = 400; // Bad Request
            throw new Error(
              `Invalid action '${action}' for target 'postData' in GET request`
            );
        }
        break;

      case "postedData":
        switch (action) {
          case "fetch":
            response = fetchPostedData();
            break;
          // 他に postedData に対するGETアクションがあればここに追加
          // case 'getById':
          //   // ...
          //   break;
          default:
            statusCode = 400;
            throw new Error(
              `Invalid action '${action}' for target 'postedData' in GET request`
            );
        }
        break;

      case "errorData":
        switch (action) {
          case "fetch":
            response = fetchErrorData();
            break;
          // 他に errorData に対するGETアクションがあればここに追加
          default:
            statusCode = 400;
            throw new Error(
              `Invalid action '${action}' for target 'errorData' in GET request`
            );
        }
        break;

      case "trigger":
        switch (action) {
          case "status":
            const functionName = e.parameter.functionName; // 確認したい関数名をパラメータで受け取る
            if (!functionName) {
              statusCode = 400;
              throw new Error("Missing required parameter: functionName.");
            }
            const exists = checkTriggerExists(functionName);
            response = {
              functionName: functionName,
              isTriggerConfigured: exists, // トリガーが設定されているかどうか
            };
            break;
          default:
            statusCode = 400;
            throw new Error(
              `Invalid action '${action}' for target 'trigger' in GET request`
            );
        }
        break;

      default:
        statusCode = 400; // Bad Request
        throw new Error(`Invalid target '${target}' in GET request`);
    }

    // 成功レスポンス
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        data: response,
        code: statusCode, // Include status code in response JSON
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error: any) {
    Logger.log(
      `Error in doGet (action: ${action}, target: ${target}): ${error.message}\nStack: ${error.stack}`
    );
    // TODO: Errorシートへの記録処理をここに追加する可能性あり
    const errorStatusCode = statusCode !== 200 ? statusCode : 400;
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.message,
        code: errorStatusCode, // Include status code in response JSON
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================================================
// 以下に、これまで作成した各機能関数が定義されている想定です。
// createXAuth(authInfo)
// getXAuthAll()
// updateXAuth(authInfo)
// deleteXAuth(authInfo)
// createPostData(postDataInput)
// fetchPostData()
// updatePostData(postDataToUpdate)
// deletePostData(postDataToDelete)
// ==================================================
