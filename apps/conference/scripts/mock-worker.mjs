import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, '..');
const publicDirectory = resolve(appRoot, 'public');
const workerDestination = resolve(publicDirectory, 'mockServiceWorker.js');
const command = process.argv[2];

if (command === 'prepare') {
  const require = createRequire(import.meta.url);
  const workerSource = require.resolve('msw/mockServiceWorker.js');
  await mkdir(publicDirectory, { recursive: true });
  await copyFile(workerSource, workerDestination);
  console.log('Prepared the local MSW worker.');
} else if (command === 'clean') {
  await rm(workerDestination, { force: true });
  console.log('Removed the generated local MSW worker.');
} else {
  console.error('Usage: node scripts/mock-worker.mjs <prepare|clean>');
  process.exitCode = 1;
}
