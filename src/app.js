/* Video portfolio — rendering, lazy hover-preview, and lightbox. */
(() => {
  'use strict'

  const DATA = window.__DATA__
  const root = document.getElementById('sections')
  const nav = document.getElementById('brandnav')

  // Hover-preview only makes sense with a real pointer; on touch a tap should
  // go straight to the lightbox instead of half-loading an inline preview.
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  const fmtDur = s => {
    const t = Math.round(s)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }

  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props)
    for (const k of [].concat(kids)) if (k) n.append(k)
    return n
  }

  /* ---------------- lightbox ---------------- */

  const lb = document.getElementById('lightbox')
  const lbStage = document.getElementById('lb-stage')
  const lbCaption = document.getElementById('lb-caption')
  const btnPrev = document.getElementById('lb-prev')
  const btnNext = document.getElementById('lb-next')
  const btnClose = document.getElementById('lb-close')

  let playlist = []
  let cursor = 0
  let lastFocus = null

  function renderSlide() {
    const item = playlist[cursor]
    if (!item) return

    lbStage.querySelectorAll('video, img').forEach(n => {
      if (n.tagName === 'VIDEO') n.pause()
      n.remove()
    })

    const wide = item.width > item.height
    lbStage.classList.toggle('is-wide', wide)

    let media
    if (item.type === 'video') {
      media = el('video', {
        src: item.src,
        poster: item.poster,
        controls: true,
        autoplay: true,
        loop: true,
        playsInline: true,
        preload: 'auto',
      })
      media.setAttribute('playsinline', '')
    } else {
      media = el('img', { src: item.src, alt: item.title || '' })
    }
    lbStage.prepend(media)

    lbCaption.innerHTML = ''
    lbCaption.append(el('strong', { textContent: item.title || '' }))
    const sub = [item.brandName, item.note, item.type === 'video' && item.duration ? fmtDur(item.duration) : null]
      .filter(Boolean)
      .join(' · ')
    if (sub) lbCaption.append(document.createTextNode(sub))

    btnPrev.disabled = cursor === 0
    btnNext.disabled = cursor === playlist.length - 1
  }

  function openLightbox(list, index, trigger) {
    playlist = list
    cursor = index
    lastFocus = trigger || document.activeElement
    lb.setAttribute('open', '')
    document.body.style.overflow = 'hidden'
    renderSlide()
    btnClose.focus()
  }

  function closeLightbox() {
    lb.removeAttribute('open')
    document.body.style.overflow = ''
    lbStage.querySelectorAll('video, img').forEach(n => {
      if (n.tagName === 'VIDEO') { n.pause(); n.removeAttribute('src'); n.load() }
      n.remove()
    })
    playlist = []
    if (lastFocus) { lastFocus.focus(); lastFocus = null }
  }

  const step = d => {
    const next = cursor + d
    if (next >= 0 && next < playlist.length) { cursor = next; renderSlide() }
  }

  btnPrev.addEventListener('click', () => step(-1))
  btnNext.addEventListener('click', () => step(1))
  btnClose.addEventListener('click', closeLightbox)
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox() })

  document.addEventListener('keydown', e => {
    if (!lb.hasAttribute('open')) return
    if (e.key === 'Escape') closeLightbox()
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
  })

  /* ---------------- hover preview ---------------- */

  // One shared element would fight with rapid pointer movement across cards, so
  // each card gets its own video, created on demand and torn down on leave.
  function attachPreview(thumb, item) {
    if (!canHover) return
    let vid = null
    let token = 0

    thumb.addEventListener('pointerenter', () => {
      if (vid) return
      const mine = ++token
      vid = el('video', {
        muted: true,
        loop: true,
        playsInline: true,
        preload: 'auto',
        src: item.src,
      })
      vid.setAttribute('muted', '')
      vid.setAttribute('playsinline', '')
      vid.addEventListener('canplay', () => {
        if (mine === token && vid) vid.classList.add('is-ready')
      }, { once: true })
      thumb.append(vid)
      vid.play().catch(() => {})
    })

    thumb.addEventListener('pointerleave', () => {
      token++
      if (!vid) return
      vid.pause()
      vid.removeAttribute('src')
      vid.load()
      vid.remove()
      vid = null
    })
  }

  /* ---------------- cards ---------------- */

  function buildCard(item, list, index) {
    const thumb = el('div', { className: 'thumb' })
    thumb.append(el('img', {
      src: item.poster,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      width: item.width,
      height: item.height,
    }))
    if (item.duration) thumb.append(el('span', { className: 'dur', textContent: fmtDur(item.duration) }))
    attachPreview(thumb, item)

    const meta = el('div', { className: 'card-meta' }, [
      el('div', { className: 'card-title', textContent: item.title }),
      item.note ? el('div', { className: 'card-note', textContent: item.note }) : null,
    ])

    const card = el('button', {
      className: 'card',
      type: 'button',
      title: `Play — ${item.title}`,
    }, [thumb, meta])

    card.addEventListener('click', () => openLightbox(list, index, card))
    return card
  }

  function buildStrip(cfg, items, brandName) {
    const list = items.map(i => ({ ...i, brandName }))
    const strip = el('div', { className: 'strip' })

    list.forEach((item, i) => {
      const slide = el('button', { className: 'slide', type: 'button', title: `View slide ${i + 1}` })
      slide.append(el('img', {
        src: item.src,
        alt: item.title || `Slide ${i + 1}`,
        loading: 'lazy',
        decoding: 'async',
        width: item.width,
        height: item.height,
      }))
      slide.addEventListener('click', () => openLightbox(list, i, slide))
      strip.append(slide)
    })

    return el('div', { className: 'strip-block' }, [
      el('div', { className: 'strip-head' }, [
        el('h3', { textContent: cfg.title }),
        el('span', { className: 'cap', textContent: cfg.caption }),
      ]),
      strip,
    ])
  }

  /* ---------------- sections ---------------- */

  for (const sec of DATA.sections) {
    const items = sec.items.map(i => ({ ...i, brandName: sec.name }))
    const initial = sec.initialCount ?? items.length

    const grid = el('div', { className: 'grid' })
    const cards = items.map((item, i) => {
      const card = buildCard(item, items, i)
      if (i >= initial) card.hidden = true
      grid.append(card)
      return card
    })

    const head = el('div', { className: 'section-head' }, [
      el('div', {}, [
        el('span', { className: 'kicker', textContent: sec.kicker }),
        el('h2', { textContent: sec.name }),
        sec.blurb ? el('p', { className: 'blurb', textContent: sec.blurb }) : null,
      ]),
      el('span', {
        className: 'count',
        textContent: `${items.length} ${items.length === 1 ? 'film' : 'films'}`,
      }),
    ])

    const section = el('section', { className: 'section', id: sec.brand }, [head, grid])

    if (items.length > initial) {
      const hiddenCount = items.length - initial
      const btn = el('button', {
        className: 'more',
        type: 'button',
        textContent: `Show ${hiddenCount} more`,
      })
      btn.addEventListener('click', () => {
        const expanding = cards.some(c => c.hidden)
        cards.forEach((c, i) => { c.hidden = expanding ? false : i >= initial })
        btn.textContent = expanding ? 'Show less' : `Show ${hiddenCount} more`
        if (!expanding) section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      section.append(btn)
    }

    if (sec.carousel) section.append(buildStrip(sec.carousel, sec.carousel.items, sec.name))
    if (sec.stills) section.append(buildStrip(sec.stills, sec.stills.items, sec.name))

    root.append(section)

    nav.append(el('a', { href: `#${sec.brand}`, textContent: sec.name }))
  }

  /* ---------------- nav active state ---------------- */

  const links = new Map([...nav.querySelectorAll('a')].map(a => [a.getAttribute('href').slice(1), a]))
  const seen = new Set()

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) seen.add(e.target.id)
      else seen.delete(e.target.id)
    }
    // Highlight the topmost section currently on screen.
    let active = null
    for (const sec of DATA.sections) {
      if (seen.has(sec.brand)) { active = sec.brand; break }
    }
    for (const [id, a] of links) a.classList.toggle('is-active', id === active)
  }, { rootMargin: '-56px 0px -70% 0px' })

  document.querySelectorAll('.section').forEach(s => io.observe(s))
})()
