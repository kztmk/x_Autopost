const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'MyApp',
    outfile: 'dist/code.js',
    treeShaking: false, // API経由なら無効化が可能
    minify: false,
  })
  .catch(() => process.exit(1));
