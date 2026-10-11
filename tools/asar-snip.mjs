// Print ±N chars around every regex match inside one asar file. Usage:
//   node tools/asar-snip.mjs <asarPath> <filePathRegex> <contentRegex> [before] [after]
import { readFileSync } from 'node:fs';

const [asarPath, fileRe, contentRe, beforeArg, afterArg] = process.argv.slice(2);
const before = Number(beforeArg ?? 200);
const after = Number(afterArg ?? 200);
const buf = readFileSync(asarPath);
const headerSize = buf.readUInt32LE(12);
const index = JSON.parse(buf.toString('utf8', 16, 16 + headerSize));
const base = 8 + buf.readUInt32LE(4);

function walk(node, prefix, out) {
  for (const [key, value] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (value.files) walk(value, path, out);
    else out.push({ path, size: Number(value.size), offset: Number(value.offset) });
  }
  return out;
}

const entries = walk(index, '', []);
const filePattern = new RegExp(fileRe);
const contentPattern = new RegExp(contentRe, 'g');
for (const entry of entries) {
  if (!filePattern.test(entry.path)) continue;
  if (entry.size > 40_000_000) continue;
  const text = buf.toString('utf8', base + entry.offset, base + entry.offset + entry.size);
  let match;
  let count = 0;
  contentPattern.lastIndex = 0;
  while ((match = contentPattern.exec(text)) !== null) {
    if (count++ > 40) break;
    const start = Math.max(0, match.index - before);
    const end = Math.min(text.length, match.index + match[0].length + after);
    console.log(`\n===== ${entry.path} @${match.index} =====`);
    console.log(text.slice(start, end));
    if (match[0].length === 0) contentPattern.lastIndex += 1;
  }
}
