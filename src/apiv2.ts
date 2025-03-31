import { createXAuth, getXAuthAll, updateXAuth, deleteXAuth } from './api/xauth';
import { createPostData, fetchPostData, updatePostData, deletePostData } from './api/postData';
import { createTimeBasedTrigger, deleteAllTriggers } from './api/triggers';
import { uploadMediaFile } from './api/media';
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
      let requestData = {};
      if (e.postData && e.postData.type === "application/json" && e.postData.contents) {
        requestData = JSON.parse(e.postData.contents);
      } else if (e.postData && e.postData.contents) {
         // JSON以外の場合のフォールバック（必要に応じて）
         // requestData = { raw: e.postData.contents };
         // もしくはエラーとする
         throw new Error("Invalid request body format. Expected application/json.");
      }
  
      // targetに基づいて処理を分岐
      switch (target) {
        case 'xauth':
          // actionに基づいてXAuth関連の処理を分岐
          switch (action) {
            case 'create':
              response = createXAuth(requestData);
              statusCode = 201; // Created
              break;
            case 'update':
              response = updateXAuth(requestData);
              break;
            case 'delete':
              response = deleteXAuth(requestData);
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid action '${action}' for target 'xauth'`);
          }
          break;
  
        case 'postData':
          // actionに基づいてPostData関連の処理を分岐
          switch (action) {
            case 'create':
              response = createPostData(requestData);
              statusCode = 201; // Created
              break;
            case 'update':
              response = updatePostData(requestData);
              break;
            case 'delete':
              response = deletePostData(requestData);
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid action '${action}' for target 'postData'`);
          }
          break;
        
        case 'trigger':
          switch (action) {
            case 'create':
              response = createTimeBasedTrigger(requestData);
              statusCode = 201; // Created
              break;
            case 'delete':
              response = deleteAllTriggers();
              break;
            default:
              statusCode = 400; // Bad Request
              throw new Error(`Invalid target '${target}'`);
          }
          break;
  
        case 'media':
          switch (action) {
            case 'upload':
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

      // 成功レスポンス
        return ContentService.createTextOutput(JSON.stringify({ 
            status: 'success', 
            data: response,
            code: statusCode // Include status code in response JSON
          }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error: any) {
      Logger.log(`Error in doPost (action: ${action}, target: ${target}): ${error.message}\nStack: ${error.stack}`);
      // TODO: Errorシートへの記録処理をここに追加する可能性あり
      const errorStatusCode = statusCode !== 200 ? statusCode : 400; // エラー発生前のstatusCodeが400系ならそれを、そうでなければ400をデフォルトにする
      return ContentService.createTextOutput(JSON.stringify({ 
            status: 'error', 
            message: error.message,
            code: errorStatusCode // Include status code in response JSON
          }))
            .setMimeType(ContentService.MimeType.JSON);
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
        case 'xauth':
          // actionに基づいてXAuth関連の処理を分岐
          switch (action) {
            case 'fetch':
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
              throw new Error(`Invalid action '${action}' for target 'xauth' in GET request`);
          }
          break;
  
        case 'postData':
          // actionに基づいてPostData関連の処理を分岐
          switch (action) {
            case 'fetch':
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
              throw new Error(`Invalid action '${action}' for target 'postData' in GET request`);
          }
          break;
  
        default:
          statusCode = 400; // Bad Request
          throw new Error(`Invalid target '${target}' in GET request`);
      }
  
      // 成功レスポンス
        return ContentService.createTextOutput(JSON.stringify({ 
            status: 'success', 
            data: response,
            code: statusCode // Include status code in response JSON
          }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error: any) {
      Logger.log(`Error in doGet (action: ${action}, target: ${target}): ${error.message}\nStack: ${error.stack}`);
      // TODO: Errorシートへの記録処理をここに追加する可能性あり
      const errorStatusCode = statusCode !== 200 ? statusCode : 400;
        return ContentService.createTextOutput(JSON.stringify({ 
            status: 'error', 
            message: error.message,
            code: errorStatusCode // Include status code in response JSON
          }))
            .setMimeType(ContentService.MimeType.JSON);
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