const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// メインエントリーポイント - 1つのファイルにまとめるためのインデックスファイルを作成
const createIndexFile = () => {
  // 一時的なインデックスファイルを作成
  const indexContent = `
// 一時的なインデックスファイル - すべてのモジュールを1つにまとめる
import * as main from "./main";
import * as apiv2 from "./apiv2";
import * as auth from "./auth";
import * as media from "./media";
import * as utils from "./utils";
import * as postData from "./api/postData";
import * as triggers from "./api/triggers";
import * as twitter from "./api/twitter";
import * as xauth from "./api/xauth";
import * as archive from "./api/archive";

// すべてのモジュールをエクスポート
export { 
  main, apiv2, auth, media, utils,
  postData, triggers, twitter, xauth, archive
};
`;

  const indexPath = path.join(__dirname, "src", "index.ts");
  fs.writeFileSync(indexPath, indexContent, "utf8");
  return indexPath;
};

// 一時インデックスファイルを作成
const indexPath = createIndexFile();

esbuild
  .build({
    entryPoints: [indexPath], // 単一のエントリポイントを使用
    bundle: true,
    format: "iife",
    globalName: "MyApp",
    outfile: "dist/code.js",
    treeShaking: false, // GASでは全関数が必要なので無効化
    minify: false,
    footer: {
      js: `
// すべての関数をグローバルスコープにエクスポート
Object.assign(this, MyApp);
`,
    },
  })
  .then(() => {
    console.log("Bundle completed successfully.");

    // ビルド後に一時インデックスファイルを削除
    try {
      fs.unlinkSync(indexPath);
      console.log("Temporary index file cleaned up.");
    } catch (err) {
      console.error("Error cleaning up temporary index file:", err);
    }
  })
  .catch((err) => {
    console.error("Build failed:", err);

    // エラー時も一時インデックスファイルを削除しておく
    try {
      if (fs.existsSync(indexPath)) {
        fs.unlinkSync(indexPath);
      }
    } catch (cleanupErr) {
      console.error("Error cleaning up temporary index file:", cleanupErr);
    }

    process.exit(1);
  });
