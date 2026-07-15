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
  updateMultiplePostSchedules,
  deleteMultiplePostData,
  createMultiplePosts,
  updateInReplyTo,
} from "./api/postData";
import {
  checkTriggerExists,
  createTimeBasedTrigger,
  deleteAllTriggers,
} from "./api/triggers";
import { archiveSheet } from "./api/archive";
import { upsertNotificationSettings } from "./api/notificationSettings";
import { sendDiscordTestNotification } from "./api/discordNotification";
import { getXMarketingDashboard, refreshXMarketingDaily, updateXMarketingProspect, upsertXMarketingSettings } from "./api/xMarketing";
import {
  assertProxyAuthorized,
  generateSetupCode,
  getSecurityStatus,
  initializeProxyAuth,
  stripAuthField,
} from "./security";
import {
  XAuthInfo,
  XPostData,
  PostError,
  TriggerProps,
  PostScheduleUpdate,
  XPostDataInput,
} from "./types";

interface RequestData {
  [key: string]: any; // 任意のキーと値のペアを許可
}

interface ArchiveRequestData {
  filename: string;
}

const LOG_SHEET_NAME = "log";

function appendInitializeLog(
  phase: string,
  details: { [key: string]: any } = {}
): void {
  try {
    const logDetails = { ...details };
    if (logDetails.uid) {
      logDetails.uid = maskLogValue(String(logDetails.uid));
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      Logger.log(`initialize log skipped: active spreadsheet not found.`);
      return;
    }

    let sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow([
        "timestamp",
        "phase",
        "action",
        "target",
        "uid",
        "hasSetupCode",
        "setupCodeLength",
        "message",
        "details",
      ]);
    }

    sheet.appendRow([
      new Date(),
      phase,
      logDetails.action || "",
      logDetails.target || "",
      logDetails.uid || "",
      logDetails.hasSetupCode === undefined ? "" : Boolean(logDetails.hasSetupCode),
      logDetails.setupCodeLength || "",
      logDetails.message || "",
      safeStringify(logDetails),
    ]);
  } catch (logError: any) {
    Logger.log(`initialize log failed: ${logError.message}`);
  }
}

function maskLogValue(value: string): string {
  if (value.length <= 8) {
    return "****";
  }

  return `${value.substring(0, 4)}***${value.substring(value.length - 4)}`;
}

function safeStringify(value: any): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 1000 ? `${text.substring(0, 1000)}...` : text;
  } catch (error) {
    return String(value);
  }
}

/**
 * Firebase連携の初回接続に使うセットアップコードを生成します。
 * SpreadsheetメニューまたはApps Scriptエディタから実行し、返されたコードを虎威側に入力してください。
 */
export function generateFirebaseSetupCode(): string {
  return generateSetupCode();
}

/**
 * Spreadsheetを開いたときに虎威連携メニューを追加します。
 */
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("虎威連携")
    .addItem("本人確認コードを生成", "showFirebaseSetupCodeDialog")
    .addToUi();
}

/**
 * 虎威へ入力する本人確認コードを生成し、コピーしやすいダイアログで表示します。
 */
export function showFirebaseSetupCodeDialog(): void {
  const setupCode = generateFirebaseSetupCode();
  const html = HtmlService.createHtmlOutput(
    `
      <div style="font-family: Arial, sans-serif; padding: 16px; color: #202124;">
        <h2 style="font-size: 18px; margin: 0 0 12px;">虎威 本人確認コード</h2>
        <p style="font-size: 13px; line-height: 1.7; margin: 0 0 12px;">
          以下のコードを虎威のプロフィール画面に入力してください。<br>
          このコードの有効期限は10分です。
        </p>
        <input
          id="setupCode"
          type="text"
          readonly
          value="${setupCode}"
          style="box-sizing: border-box; width: 100%; padding: 10px; font-size: 16px; font-family: monospace;"
        />
        <button
          onclick="copyCode()"
          style="margin-top: 12px; padding: 8px 12px; border: 0; border-radius: 4px; background: #1a73e8; color: white; cursor: pointer;"
        >
          コピー
        </button>
        <span id="copyStatus" style="margin-left: 8px; font-size: 12px; color: #188038;"></span>
        <script>
          const input = document.getElementById('setupCode');
          input.focus();
          input.select();

          function copyCode() {
            input.select();
            document.execCommand('copy');
            document.getElementById('copyStatus').textContent = 'コピーしました';
          }
        </script>
      </div>
    `
  )
    .setWidth(460)
    .setHeight(260);

  SpreadsheetApp.getUi().showModalDialog(html, "虎威 本人確認コード");
}

/**
 * WebアプリへのPOSTリクエストを処理します。
 * actionとtargetパラメータに基づいて処理を分岐し、
 * データの作成、更新、削除を行います。
 * @param {object} e - Apps Scriptのイベントオブジェクト。
 * @return {ContentService.TextOutput} JSON形式のレスポンス。
 */
export function doPost(e) {
  let action = e.parameter.action;
  let target = e.parameter.target;
  let response = {};
  let statusCode = 200; // デフォルトのステータスコード

  try {
    const isInitializeRequest =
      target === "security" && action === "initialize";
    if (isInitializeRequest) {
      appendInitializeLog("received", {
        action,
        target,
        contentType: e.postData?.type || "",
        hasBody: Boolean(e.postData?.contents),
        bodyLength: e.postData?.contents?.length || 0,
      });
    }

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

    if (target === "security" && action === "initialize") {
      appendInitializeLog("parsed", {
        action,
        target,
        uid: requestData.uid,
        hasSetupCode: Boolean(requestData.setupCode),
        setupCodeLength: requestData.setupCode
          ? String(requestData.setupCode).length
          : 0,
      });
      response = initializeProxyAuth(requestData);
      appendInitializeLog("initialized", {
        action,
        target,
        uid: requestData.uid,
        hasSetupCode: Boolean(requestData.setupCode),
        setupCodeLength: requestData.setupCode
          ? String(requestData.setupCode).length
          : 0,
        initializedAt: (response as any).initializedAt || "",
      });
      statusCode = 201;
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "success",
          data: response,
          code: statusCode,
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    statusCode = 401;
    assertProxyAuthorized(e, action, target, requestData, "POST");
    statusCode = 200;
    requestData = stripAuthField(requestData);

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
            case "updateSchedules":
              // 配列データの取得
              let updatesArray;
              if (
                requestData.scheduleUpdates &&
                Array.isArray(requestData.scheduleUpdates)
              ) {
                updatesArray = requestData.scheduleUpdates;
              } else if (Array.isArray(requestData)) {
                updatesArray = requestData;
              } else {
                statusCode = 400; // Bad Request
                throw new Error(
                  `Request body must contain a scheduleUpdates array or be an array directly. Received: ${JSON.stringify(
                    requestData
                  )}`
                );
              }

              // 配列の各要素が必要なプロパティを持っているか確認
              for (const update of updatesArray) {
                if (!update.id || !(typeof update.postSchedule === "string")) {
                  statusCode = 400;
                  throw new Error(
                    `Each update must have id and postSchedule properties. Invalid item: ${JSON.stringify(
                      update
                    )}`
                  );
                }
              }

              const updates: PostScheduleUpdate[] = updatesArray;
              response = updateMultiplePostSchedules(updates);
              break;
            case "deleteMultiple":
              // 配列データの取得
              let deleteArray;
              if (
                requestData.idsToDelete &&
                Array.isArray(requestData.idsToDelete)
              ) {
                deleteArray = requestData.idsToDelete;
              } else if (Array.isArray(requestData)) {
                deleteArray = requestData;
              } else {
                statusCode = 400; // Bad Request
                throw new Error(
                  `Request body must contain a deleteItems array or be an array directly. Received: ${JSON.stringify(
                    requestData
                  )}`
                );
              }

              // 配列の各要素が必要なプロパティを持っているか確認
              for (const item of deleteArray) {
                if (!item.id) {
                  statusCode = 400;
                  throw new Error(
                    `Each item must have an id property. Invalid item: ${JSON.stringify(
                      item
                    )}`
                  );
                }
              }

              response = deleteMultiplePostData(deleteArray);
              break;
            case "createMultiple":
              // 配列データの取得
              let createArray;
              if (requestData.posts && Array.isArray(requestData.posts)) {
                createArray = requestData.posts;
              } else if (Array.isArray(requestData)) {
                createArray = requestData;
              } else {
                statusCode = 400; // Bad Request
                throw new Error(
                  `Request body must contain a posts array or be an array directly. Received: ${JSON.stringify(
                    requestData
                  )}`
                );
              }

              // 配列の各要素の基本検証（最低限のプロパティチェック）
              for (const post of createArray) {
                if (!post.postTo || !post.contents) {
                  statusCode = 400;
                  throw new Error(
                    `Each post must have postSchedule, postTo, and contents properties. Invalid post: ${JSON.stringify(
                      post
                    )}`
                  );
                }
              }

              const postDataArray: XPostDataInput[] = createArray;
              response = createMultiplePosts(postDataArray);
              statusCode = 201; // Created
              break;
            case "updateInReplyTo":
              // 配列データの取得
              let updateReplyArray;
              if (requestData.threads && Array.isArray(requestData.threads)) {
                updateReplyArray = requestData.threads;
              } else if (Array.isArray(requestData)) {
                updateReplyArray = requestData;
              } else {
                statusCode = 400; // Bad Request
                throw new Error(
                  `Request body must contain an updates array or be an array directly. Received: ${JSON.stringify(
                    requestData
                  )}`
                );
              }

              // 配列の各要素が必要なプロパティを持っているか確認
              for (const item of updateReplyArray) {
                if (!item.id || typeof item.inReplyToInternal !== "string") {
                  statusCode = 400;
                  throw new Error(
                    `Each update must have id and inReplyToInternal properties. Invalid item: ${JSON.stringify(
                      item
                    )}`
                  );
                }
              }

              response = updateInReplyTo(updateReplyArray);
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
              statusCode = 201; // OK
              break;
            case "getStatus":
              response = checkTriggerExists(e.parameter.functionName);
              statusCode = 201; // OK
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid target '${target}'`);
          }
          break;

        case "notificationSettings":
          switch (action) {
            case "upsert":
              response = upsertNotificationSettings(requestData);
              break;
            case "test":
              response = sendDiscordTestNotification(requestData?.webhookUrl);
              break;
            default:
              statusCode = 400;
              throw new Error(
                `Invalid action '${action}' for target 'notificationSettings'`
              );
          }
          break;

        case "xMarketing":
          switch (action) {
            case "upsertSettings": response = upsertXMarketingSettings(requestData); break;
            case "refresh": response = refreshXMarketingDaily(); break;
            case "updateProspect": response = updateXMarketingProspect(requestData); break;
            default: statusCode = 400; throw new Error(`Invalid action '${action}' for target 'xMarketing'`);
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
    if (target === "security" && action === "initialize") {
      appendInitializeLog("error", {
        action,
        target,
        message: error.message,
        stack: error.stack,
      });
    }
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
export function doGet(e) {
  let action = e.parameter.action;
  let target = e.parameter.target;
  let response = {};
  let statusCode = 200; // デフォルト

  try {
    if (target === "security" && action === "status") {
      response = getSecurityStatus();
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "success",
          data: response,
          code: statusCode,
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    statusCode = 401;
    assertProxyAuthorized(e, action, target, {}, "GET");
    statusCode = 200;

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
              isTriggerConfigured: exists,
            };
            break;
          default:
            statusCode = 400;
            throw new Error(
              `Invalid action '${action}' for target 'trigger' in GET request`
            );
        }
        break;

      case "xMarketing":
        if (action === "fetch") response = getXMarketingDashboard(e.parameter);
        else { statusCode = 400; throw new Error(`Invalid action '${action}' for target 'xMarketing' in GET request`); }
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
