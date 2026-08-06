# Video Portfolio

Static, video-only showcase grouped by brand. No framework, no runtime deps.

## Layout

```
ads_library/        source masters (git-ignored, local only)
scripts/
  transcode.mjs     ffmpeg: masters -> web MP4 + poster JPEG, writes build/catalog.json
  build.mjs         catalog.json + site.config.json -> public/
src/                page template, styles, app JS
site.config.json    curation: which films appear, in what order, under what title
public/             deployed output (committed; this is what GitHub Pages serves)
```

## Workflow

```bash
node scripts/transcode.mjs   # only needed when ads_library changes; idempotent
node scripts/build.mjs       # regenerate the page
```

`transcode.mjs` skips any output newer than its source, so re-running it after
adding a single video only processes that video.

`build.mjs` fails loudly if `site.config.json` references a slug that has no
transcoded asset, so a renamed source file can't silently drop a film.

## Adding or reordering work

1. Drop files into the relevant `ads_library/<Brand>/` folder.
2. `node scripts/transcode.mjs` — note the new slugs it prints.
3. Add entries to the matching section in `site.config.json`.
4. `node scripts/build.mjs`, then commit and push.

`initialCount` controls how many films a section shows before "Show more".
It is set to 4 everywhere so each brand opens with exactly one full row and no
single brand dominates the page.

## Encoding

H.264 high profile, CRF 26, long edge capped at 1280, AAC 96k, `+faststart`
so playback begins before the file finishes downloading. Posters are pulled
from ~15% into each clip to avoid fade-ins.

## Delivery

Videos are never loaded on page load. Each card renders only its poster
(`loading="lazy"`); the video element is created on hover and torn down on
leave, and the lightbox loads the full file only on click.

## Hosting

Live at https://engineering-gif.github.io/portfolio/ — deployed by
`.github/workflows/deploy.yml` on every push to `main`.

Split hosting:

- **Video** → Cloudflare R2, via `videoBaseUrl` in `site.config.json`. R2 keys
  mirror `public/media/` exactly (`boka/spa.mp4`), so the same tree uploads
  as-is. Clearing `videoBaseUrl` reverts to self-hosted video.
- **Posters, carousel slides, code** → GitHub Pages. Kept off R2 deliberately:
  a page view requests ~50 images, and the current `pub-*.r2.dev` domain is
  rate-limited and not for production.

`public/media/**/*.mp4` is therefore *not* committed — only the 5MB of posters.

### Two gotchas

**Push the right account.** `origin` is `engineering-gif`, but git resolves
credentials via the *active* `gh` account. Before pushing:

```bash
gh auth switch --user engineering-gif
```

Otherwise the push fails with `Permission ... denied to wasay-09`. Note that
Xcode's gitconfig sets `credential.helper=osxkeychain` globally; this repo
overrides it locally with `!gh auth git-credential` so it follows `gh`.

**Large pushes fail on a slow uplink.** Anything over ~20MB in one push dies
with `HTTP 408` / `unexpected disconnect`. `scripts/push-media.sh` exists for
that case — it commits and pushes in ~8MB chunks and is resumable.
