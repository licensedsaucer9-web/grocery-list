import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Fill VERSION and PRECACHE into dist/sw.js. The version hashes every shell
// file, so any change yields a new cache name and old shells are purged.
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && f !== 'list.json')
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const precache = ['./', ...files.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const sw = readFileSync(swPath, 'utf8')
        .replace(/const VERSION = 'dev'; \/\*__BUILD_VERSION__\*\//, `const VERSION = '${version}';`)
        .replace(/const PRECACHE = \[\]; \/\*__PRECACHE__\*\//, `const PRECACHE = ${JSON.stringify(precache)};`);
      if (sw.includes('__BUILD_VERSION__') || sw.includes('__PRECACHE__')) {
        throw new Error('sw.js placeholders were not replaced');
      }
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base: '/grocery-list/',
  plugins: [serviceWorkerManifest()],
  test: {
    environment: 'node',
  },
});
