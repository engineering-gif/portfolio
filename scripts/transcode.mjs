#!/usr/bin/env node
/**
 * Transcodes every source video in ads_library into web-ready MP4 + poster JPEG.
 * Idempotent: skips outputs that are newer than their source.
 *
 * Output layout:  public/media/<brand-slug>/<asset-slug>.mp4
 *                 public/media/<brand-slug>/<asset-slug>.jpg   (poster)
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const run = promisify(execFile)

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'ads_library')
const OUT = path.join(ROOT, 'public', 'media')

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg'])

// Vertical social video is the dominant format here; cap the long edge at 1280
// so a 1080x1920 master comes down to 720x1280 without upscaling anything.
const MAX_LONG_EDGE = 1280
const CRF = 26

export function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '')
}

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else out.push({ full, rel: path.relative(base, full) })
  }
  return out
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ])
  const j = JSON.parse(stdout)
  const s = j.streams?.[0] ?? {}
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    duration: parseFloat(j.format?.duration ?? '0'),
  }
}

async function isStale(src, dest) {
  if (!existsSync(dest)) return true
  const [a, b] = await Promise.all([stat(src), stat(dest)])
  return a.mtimeMs > b.mtimeMs
}

/** Scale filter that caps the long edge but never upscales, and keeps dims even. */
function scaleFilter(width, height) {
  const long = Math.max(width, height)
  if (long <= MAX_LONG_EDGE) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const factor = MAX_LONG_EDGE / long
  const w = Math.round((width * factor) / 2) * 2
  const h = Math.round((height * factor) / 2) * 2
  return `scale=${w}:${h}`
}

async function transcodeVideo(src, destBase, meta) {
  const vf = scaleFilter(meta.width, meta.height)
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-preset', 'slow',
    '-crf', String(CRF),
    '-pix_fmt', 'yuv420p',
    // Keyframe every 2s keeps seeking snappy without bloating the file.
    '-g', '48',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-movflags', '+faststart',
    `${destBase}.mp4`,
  ], { maxBuffer: 1 << 26 })
}

async function makePoster(src, destBase, meta) {
  // Grab ~15% in: the very first frame is often a fade-in or black.
  const at = Math.max(0.1, Math.min(meta.duration * 0.15, 3))
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', at.toFixed(2),
    '-i', src,
    '-frames:v', '1',
    '-vf', scaleFilter(meta.width, meta.height).replace(/scale=(\d+):(\d+)/, (_, w, h) =>
      `scale=${Math.round(w / 2) * 2}:${Math.round(h / 2) * 2}`),
    '-q:v', '4',
    `${destBase}.jpg`,
  ], { maxBuffer: 1 << 26 })
}

async function convertImage(src, destBase) {
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-vf', "scale='min(1080,iw)':-2",
    '-q:v', '5',
    `${destBase}.jpg`,
  ], { maxBuffer: 1 << 26 })
}

async function main() {
  const files = await walk(SRC)
  const catalog = []
  let done = 0

  const jobs = files.filter(f => {
    const ext = path.extname(f.full).toLowerCase()
    return VIDEO_EXT.has(ext) || IMAGE_EXT.has(ext)
  })

  console.log(`Found ${jobs.length} media files.`)

  for (const f of jobs) {
    const ext = path.extname(f.full).toLowerCase()
    const parts = f.rel.split(path.sep)
    const brand = slugify(parts[0])
    // Preserve sub-grouping (e.g. GlowBack/TikTok/1_Slide) in the slug so
    // carousel frames stay distinguishable and ordered.
    const nameParts = parts.slice(1)
    nameParts[nameParts.length - 1] = path.basename(nameParts.at(-1), ext)
    const slug = slugify(nameParts.join('-')) || 'asset'

    const brandDir = path.join(OUT, brand)
    await mkdir(brandDir, { recursive: true })
    const destBase = path.join(brandDir, slug)

    const isVideo = VIDEO_EXT.has(ext)
    const primary = isVideo ? `${destBase}.mp4` : `${destBase}.jpg`

    try {
      if (isVideo) {
        const meta = await probe(f.full)
        if (await isStale(f.full, primary)) await transcodeVideo(f.full, destBase, meta)
        if (await isStale(f.full, `${destBase}.jpg`)) await makePoster(f.full, destBase, meta)
        const outMeta = await probe(primary)
        catalog.push({
          type: 'video',
          brand,
          slug,
          source: f.rel,
          src: `media/${brand}/${slug}.mp4`,
          poster: `media/${brand}/${slug}.jpg`,
          width: outMeta.width,
          height: outMeta.height,
          duration: Math.round(meta.duration * 10) / 10,
          bytes: (await stat(primary)).size,
        })
      } else {
        if (await isStale(f.full, primary)) await convertImage(f.full, destBase)
        const outMeta = await probe(primary)
        catalog.push({
          type: 'image',
          brand,
          slug,
          source: f.rel,
          src: `media/${brand}/${slug}.jpg`,
          width: outMeta.width,
          height: outMeta.height,
          bytes: (await stat(primary)).size,
        })
      }
    } catch (err) {
      console.error(`FAILED ${f.rel}: ${err.message?.slice(0, 300)}`)
      continue
    }

    done++
    process.stdout.write(`\r[${done}/${jobs.length}] ${f.rel.slice(0, 70).padEnd(72)}`)
  }

  console.log('\nWriting catalog…')
  catalog.sort((a, b) => a.brand.localeCompare(b.brand) || a.slug.localeCompare(b.slug))
  await writeFile(
    path.join(ROOT, 'build', 'catalog.json'),
    JSON.stringify(catalog, null, 2),
  )

  const totalBytes = catalog.reduce((n, c) => n + c.bytes, 0)
  console.log(`Done. ${catalog.length} assets, ${(totalBytes / 1e6).toFixed(1)} MB total.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
