import fs from 'node:fs';
import path from 'node:path';

/** Preflight only. Creation must still be exclusive to handle concurrent writers. */
export function requireNewDirectory(directory: string): string {
  const dest = path.resolve(directory);
  if (fs.lstatSync(dest, { throwIfNoEntry: false }))
    throw Object.assign(new Error('Output directory already exists; choose a new path: ' + dest), { code: 'EEXIST' });
  return dest;
}

/** Inputs must be fully validated/rendered first. Existing files and links are never truncated. */
export function writeNewBundle(directory: string, files: Record<string, string>): string {
  const dest = requireNewDirectory(directory);
  const entries = Object.entries(files);
  if (!entries.length || entries.some(([name]) => !name || name === '.' || name === '..' || /[/\\:]/.test(name)))
    throw new Error('Bundle filenames must be nonempty, single path components');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(dest); // Not recursive: another process winning this path causes EEXIST.
  for (const [name, content] of entries)
    fs.writeFileSync(path.join(dest, name), content, { encoding: 'utf8', flag: 'wx' });
  return dest;
}
