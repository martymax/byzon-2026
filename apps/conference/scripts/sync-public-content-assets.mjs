import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const staticPublicRoot = join(repositoryRoot, 'static-site', 'public');
const destinationRoot = join(
  repositoryRoot,
  'apps',
  'conference',
  'public',
  'content-assets',
);

const content = JSON.parse(
  await readFile(
    join(repositoryRoot, 'static-site', 'data', 'content.json'),
    'utf8',
  ),
);
const referencedPaths = new Set([
  content.location.image,
  ...content.speakers.list.map((speaker) => speaker.photo),
  ...content.partners.logos.map((partner) => partner.src),
]);
const imagePaths = [...referencedPaths].sort();

for (const sourcePath of imagePaths) {
  if (
    !/^\/assets\/img\/[A-Za-z0-9._/-]+\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(
      sourcePath,
    ) ||
    sourcePath.includes('..') ||
    sourcePath.includes('\\')
  ) {
    throw new TypeError(`Unsafe public content asset path: ${sourcePath}`);
  }
  const source = join(staticPublicRoot, sourcePath.slice(1));
  const metadata = await stat(source);
  if (!metadata.isFile()) {
    throw new TypeError(`Public content asset is not a file: ${sourcePath}`);
  }
  const destination = join(destinationRoot, sourcePath.slice(1));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

process.stdout.write(`Packaged ${imagePaths.length} public content images.\n`);
