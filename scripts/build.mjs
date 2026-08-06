#!/usr/bin/env node
/**
 * Joins build/catalog.json (produced by transcode.mjs) with site.config.json
 * and emits the static site into public/.
 *
 * Fails loudly on any config slug that has no matching transcoded asset, so a
 * renamed source file can never silently drop a video from the site.
 */
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const p = (...s) => path.join(ROOT, ...s)

const catalog = JSON.parse(await readFile(p('build', 'catalog.json'), 'utf8'))
const config = JSON.parse(await readFile(p('site.config.json'), 'utf8'))

// Videos are served from object storage (see videoBaseUrl); posters stay on
// Pages so a page view doesn't fire 50+ requests at the rate-limited r2.dev
// domain. Clear videoBaseUrl to go back to fully self-hosted video.
const VIDEO_BASE = (config.videoBaseUrl ?? '').replace(/\/$/, '')
const videoUrl = src => (VIDEO_BASE ? `${VIDEO_BASE}/${src.replace(/^media\//, '')}` : src)

const index = new Map(catalog.map(a => [`${a.brand}/${a.slug}`, a]))
const used = new Set()
const errors = []

function resolve(brand, slug, ctx) {
  const key = `${brand}/${slug}`
  const asset = index.get(key)
  if (!asset) {
    errors.push(`${ctx}: no transcoded asset for "${key}"`)
    return null
  }
  used.add(key)
  return asset
}

const sections = config.sections.map(sec => {
  const items = sec.items
    .map(it => {
      const a = resolve(sec.brand, it.slug, `section "${sec.name}"`)
      if (!a) return null
      if (a.type !== 'video') {
        errors.push(`section "${sec.name}": "${it.slug}" is an image, not a video`)
        return null
      }
      return {
        type: 'video',
        title: it.title,
        note: it.note ?? null,
        src: videoUrl(a.src),
        poster: a.poster,
        width: a.width,
        height: a.height,
        duration: a.duration,
      }
    })
    .filter(Boolean)

  const strip = (cfg, ctx) => {
    if (!cfg) return null
    const list = cfg.slugs
      .map(s => {
        const a = resolve(sec.brand, s, `${ctx} in "${sec.name}"`)
        if (!a) return null
        return { type: 'image', title: cfg.title, src: a.src, width: a.width, height: a.height }
      })
      .filter(Boolean)
    return { title: cfg.title, caption: cfg.caption, items: list }
  }

  return {
    brand: sec.brand,
    name: sec.name,
    kicker: sec.kicker,
    blurb: sec.blurb,
    initialCount: sec.initialCount ?? items.length,
    items,
    carousel: strip(sec.carousel, 'carousel'),
    stills: strip(sec.stills, 'stills'),
  }
})

if (errors.length) {
  console.error('Build failed:\n' + errors.map(e => '  - ' + e).join('\n'))
  process.exit(1)
}

const orphans = catalog.filter(a => !used.has(`${a.brand}/${a.slug}`))
if (orphans.length) {
  console.warn(`Note: ${orphans.length} transcoded asset(s) not referenced by site.config.json:`)
  for (const o of orphans) console.warn(`  - ${o.brand}/${o.slug}`)
}

const nFilms = sections.reduce((n, s) => n + s.items.length, 0)
const nStills = sections.reduce(
  (n, s) => n + (s.carousel?.items.length ?? 0) + (s.stills?.items.length ?? 0),
  0,
)

const data = { sections }

// The first film's poster doubles as the social preview image.
const ogImage = sections[0]?.items[0]?.poster ?? ''

const html = (await readFile(p('src', 'index.template.html'), 'utf8'))
  .replaceAll('__TITLE__', config.siteTitle)
  .replaceAll('__DESC__', config.siteSubtitle)
  .replaceAll('__NBRANDS__', String(sections.length))
  .replaceAll('__NFILMS__', String(nFilms))
  .replaceAll('__NSTILLS__', String(nStills))
  .replaceAll('__OGIMAGE__', ogImage)
  .replaceAll('__FOOTER__', `${nFilms} films · ${sections.length} brands`)
  // Use a function replacer so "$&"-style sequences inside the JSON are not
  // treated as replacement patterns, and escape "</" so a string containing
  // "</script>" cannot terminate the inline script block early.
  .replace('/*__DATA_JSON__*/null', () => JSON.stringify(data).replaceAll('</', '<\\/'))

await writeFile(p('public', 'index.html'), html)
await copyFile(p('src', 'styles.css'), p('public', 'styles.css'))
await copyFile(p('src', 'app.js'), p('public', 'app.js'))
// Stop GitHub Pages from running the output through Jekyll.
await writeFile(p('public', '.nojekyll'), '')

console.log(`Built: ${sections.length} sections, ${nFilms} films, ${nStills} stills.`)
