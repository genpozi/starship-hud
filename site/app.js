/**
 * STELLARIS-7 // landing enhancements.
 * Progressive: the page is fully usable with JavaScript disabled.
 * Gallery links open the full-resolution capture in an in-page lightbox
 * instead of navigating away.
 */
(() => {
  const shots = Array.from(document.querySelectorAll('.gallery .shot'))
  if (!shots.length) return

  const box = document.createElement('div')
  box.className = 'lightbox'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Screenshot viewer')
  box.hidden = true
  box.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close">&times;</button>' +
    '<img alt="" />'
  document.body.appendChild(box)

  const img = box.querySelector('img')
  const close = box.querySelector('.lightbox-close')
  let opener = null

  function open(href, alt, el) {
    opener = el
    img.src = href
    img.alt = alt
    box.hidden = false
    document.body.style.overflow = 'hidden'
    close.focus()
  }

  function dismiss() {
    box.hidden = true
    img.removeAttribute('src')
    document.body.style.overflow = ''
    if (opener) opener.focus()
  }

  shots.forEach((shot) => {
    shot.addEventListener('click', (ev) => {
      ev.preventDefault()
      const thumb = shot.querySelector('img')
      open(shot.getAttribute('href'), thumb ? thumb.alt : '', shot)
    })
  })

  close.addEventListener('click', dismiss)
  box.addEventListener('click', (ev) => { if (ev.target === box) dismiss() })
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !box.hidden) dismiss()
  })
})()
