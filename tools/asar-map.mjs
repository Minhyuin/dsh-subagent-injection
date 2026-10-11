// Minimal asar reader: parses the header index and can list or extract entries.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const asarPath = process.argv[2]
const mode = process.argv[3] ?? 'list'
const pattern = process.argv[4] ? new RegExp(process.argv[4], 'i') : null

const fd = readFileSync(asarPath)
// Header: 4 bytes uint32 = 4, then pickle
// Layout: [4 bytes size of header payload][4 bytes json string length][json][padding]
const headerSize = fd.readUInt32LE(12)
const headerJson = fd.toString('utf8', 16, 16 + headerSize)
const index = JSON.parse(headerJson)
const baseOffset = 8 + fd.readUInt32LE(4)

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) walk(entry, path, out)
    else out.push({ path, size: Number(entry.size ?? 0), offset: Number(entry.offset ?? 0) })
  }
  return out
}

const entries = walk(index, '', [])
const matched = pattern ? entries.filter((e) => pattern.test(e.path)) : entries

if (mode === 'list') {
  for (const e of matched) console.log(`${String(e.size).padStart(9)}  ${e.path}`)
  console.log(`# total entries=${entries.length} matched=${matched.length}`)
} else if (mode === 'stat') {
  console.log(JSON.stringify(matched, null, 2))
} else if (mode === 'extract') {
  const destRoot = process.argv[5]
  if (!destRoot) throw new Error('extract requires a destination root')
  let n = 0
  for (const e of matched) {
    const dest = `${destRoot}/${e.path}`
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, fd.subarray(baseOffset + e.offset, baseOffset + e.offset + e.size))
    n++
  }
  console.log(`extracted ${n} files to ${destRoot}`)
} else if (mode === 'read') {
  for (const e of matched) {
    console.log(`\n===== ${e.path} (${e.size} bytes) =====`)
    console.log(fd.toString('utf8', baseOffset + e.offset, baseOffset + e.offset + e.size))
  }
} else if (mode === 'grep') {
  // pattern given as argv[5] for content search, path filter as argv[4]
  const contentRe = new RegExp(process.argv[5], 'i')
  for (const e of matched) {
    if (e.size > 4_000_000) continue
    const text = fd.toString('utf8', baseOffset + e.offset, baseOffset + e.offset + e.size)
    const lines = text.split('\n')
    const hits = []
    lines.forEach((line, i) => {
      if (contentRe.test(line)) hits.push(`${i + 1}:${line.trim().slice(0, 300)}`)
    })
    if (hits.length) {
      console.log(`\n===== ${e.path} =====`)
      for (const h of hits.slice(0, 40)) console.log(h)
      if (hits.length > 40) console.log(`... ${hits.length - 40} more`)
    }
  }
}
