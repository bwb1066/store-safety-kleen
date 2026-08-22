/**
 * banner — a full-width promo / notification strip.
 *
 * Authored either as page content OR as the first section of the nav header
 * fragment (site-wide). When it lives in the header, header.js lifts it into a
 * full-width bar above the utility nav; this block only handles content styling
 * and publishing its (dynamic) height, which the header adds to its own.
 *
 * Authoring contract (one cell of rich text; the last link is the CTA):
 *   | banner |
 *   | Save on ... (NP250) [Shop Now](/x) |
 *
 * @param {Element} el The block element
 */
export default function init(el) {
  const inner = el.querySelector(':scope > div > div') || el.querySelector(':scope > div');
  if (inner) inner.classList.add('banner-inner');

  // Style the trailing link as the banner CTA.
  const links = el.querySelectorAll('a');
  const cta = links[links.length - 1];
  if (cta) {
    cta.classList.remove('btn', 'btn-primary', 'btn-secondary');
    cta.classList.add('banner-cta');
    cta.parentElement?.classList.remove('btn-group', 'button-container');
  }

  // Publish the banner's height so the header sizes itself to include it.
  const setHeight = () => {
    document.body.style.setProperty('--banner-height', `${el.offsetHeight}px`);
  };
  requestAnimationFrame(setHeight);
  window.addEventListener('resize', setHeight);
}
