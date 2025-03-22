// remove-lines.js
const fs = require('fs');
const filePath = 'dist/code.js';

try {
  // ファイル読み込み
  const data = fs.readFileSync(filePath, 'utf8');
  let lines = data.split('\n');

  // ファイルに十分な行数があるか確認（最低でも2行以上必要）
  if (lines.length < 2) {
    console.error('ファイルの行数が足りません。');
    process.exit(1);
  }

  // 最後から２行目を削除
  lines.splice(lines.length - 2, 1);

  // 次に2行目（インデックス1）を削除
  lines.splice(1, 1);

  // 変更後の内容をファイルに書き戻す
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log('２行目と最後から２行目を削除しました。');
} catch (err) {
  console.error('エラー:', err);
  process.exit(1);
}
