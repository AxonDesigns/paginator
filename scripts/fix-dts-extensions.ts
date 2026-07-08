// tsc's `rewriteRelativeImportExtensions` (see tsconfig.build.json) only rewrites the `.ts` -> `.js`
// specifiers it emits into .js output, not into .d.ts output (a known TypeScript limitation: the
// declaration transformer's module-specifier rewriting only fires for --outFile bundled emit). Left
// alone, dist/**/*.d.ts would reference sibling `.ts` files that are never shipped. This walks the
// build output and rewrites those specifiers to `.js` after tsc runs.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SPECIFIER_RE = /(['"])(\.\.?\/[^'"]+?)\.ts\1/g

async function fixFile(path: string): Promise<void> {
  const contents = await readFile(path, 'utf8')
  const fixed = contents.replace(SPECIFIER_RE, (_match, quote: string, specifier: string) => `${quote}${specifier}.js${quote}`)
  if (fixed !== contents) await writeFile(path, fixed)
}

async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.name.endsWith('.d.ts')) await fixFile(path)
  }
}

await walk(join(import.meta.dirname, '..', 'dist'))
