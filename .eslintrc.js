module.exports = {
  env: {
    browser: true, // ブラウザ環境 (DOM API など) を有効にする (Apps Script の UI 関連処理などで必要になる場合がある)
    es6: true, // ES6 (ECMAScript 2015) 以降の構文を有効にする
    'googleappsscript/googleappsscript': true, // googleappsscript 環境を有効にする (global 変数などを認識させる)
  },
  plugins: [
    'googleappsscript', // googleappsscript プラグインを有効にする
  ],
  extends: [
    'eslint:recommended', // ESLint の推奨ルールセットを適用
  ],
  parserOptions: {
    ecmaVersion: 2018, // ECMAScript のバージョン (2018 = ES9)
    sourceType: 'script', // モジュール形式ではないスクリプトとして解析 (Apps Script は基本スクリプト形式)
  },
  rules: {
    // 必要に応じてルールを追加・変更 (例: console.log() を禁止する場合)
    // "no-console": "warn",
  },
};
