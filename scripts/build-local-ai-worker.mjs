import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('public/local-ai', { recursive: true });
await build({
  entryPoints: ['lib/local-ai.worker.ts'], outfile: 'public/local-ai/worker.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  legalComments: 'linked', logLevel: 'info',
});
await copyFile('node_modules/@mlc-ai/web-llm/LICENSE', 'public/local-ai/WEBLLM-LICENSE.txt');
await copyFile('node_modules/loglevel/LICENSE-MIT', 'public/local-ai/LOGLEVEL-LICENSE.txt');
