// remove-lines.js
const fs = require("fs");
const filePath = "dist/code.js";

try {
  // ファイル読み込み
  const data = fs.readFileSync(filePath, "utf8");
  let lines = data.split("\n");

  // ファイルに十分な行数があるか確認（最低でも3行以上必要）
  if (lines.length < 3) {
    console.error("ファイルの行数が足りません。");
    process.exit(1);
  }

  // return __toCommonJS(index_exports); を含む行からファイル末尾までを削除
  // まず行を検索
  let returnLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("return __toCommonJS(index_exports);")) {
      returnLineIndex = i;
      break;
    }
  }

  // 該当行が見つかった場合、その行から末尾までを削除
  if (returnLineIndex !== -1) {
    const removedCount = lines.length - returnLineIndex;
    lines = lines.slice(0, returnLineIndex);
    console.log(
      `${
        returnLineIndex + 1
      }行目の 'return __toCommonJS(index_exports);' から末尾まで ${removedCount}行を削除しました`
    );
  } else {
    console.log(
      "'return __toCommonJS(index_exports);' を含む行が見つかりませんでした"
    );
  }

  // 2行目（インデックス1）を削除
  lines.splice(1, 1);

  // 変更後の内容をファイルに書き戻す
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  console.log(
    "２行目と 'return __toCommonJS(index_exports);' から文末までを削除しました。"
  );
} catch (err) {
  console.error("エラー:", err);
  process.exit(1);
}
