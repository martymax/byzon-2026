import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = join(appRoot, '.next/standalone/node_modules/.pnpm');
const packages = (await readdir(store)).filter((name) =>
  name.startsWith('sharp@'),
);
assert(packages.length > 0, 'Standalone output must contain Sharp');

for (const name of packages) {
  // Load the packaged copy explicitly, so a working development installation
  // cannot hide missing native libraries in the deployed artifact.
  const sharp = require(join(store, name, 'node_modules/sharp'));
  const bytes = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 0, g: 120, b: 180, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
}

process.stdout.write('Standalone image encoding and decoding passed.\n');
