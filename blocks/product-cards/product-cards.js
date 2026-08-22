import store from '../../scripts/commerce.js';

/**
 * product-cards — a grid of catalog products with specs, availability, and an
 * Add-to-quote action. Reads from the shared commerce store, so it is fully
 * tenant-generic (specs render from each product's `specs` map).
 *
 * Authoring contract — labeled rows (| key | value |), all optional:
 *   | heading  | Shop Absorbents          |  section title
 *   | skus     | 7425, 32073, 1030        |  explicit SKUs, in order
 *   | query    | absorbent sock           |  free-text catalog search
 *   | category | Absorbents               |  filter by category
 *   | limit    | 6                        |  max cards (default 6)
 *   | search   | yes                      |  render a live spec search box
 *
 * @param {Element} el The block element
 */

function readConfig(el) {
  const cfg = {
    heading: '', skus: [], query: '', category: '', limit: 6, search: false,
  };
  [...el.children].forEach((row) => {
    const [keyCell, valCell] = row.children;
    const key = keyCell?.textContent.trim().toLowerCase();
    const val = valCell?.textContent.trim() || '';
    if (key === 'skus') cfg.skus = val.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'limit') cfg.limit = parseInt(val, 10) || 6;
    else if (key === 'search') cfg.search = /^(yes|true|on)$/i.test(val);
    else if (['heading', 'query', 'category'].includes(key)) cfg[key] = val;
  });
  return cfg;
}

/** Up to three non-empty spec values as chips. */
function specChips(product) {
  const wrap = document.createElement('ul');
  wrap.className = 'product-card-specs';
  Object.entries(product.specs || {})
    .filter(([, v]) => v && !/^n\/a$/i.test(v))
    .slice(0, 3)
    .forEach(([k, v]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="product-card-spec-k">${k}</span> ${v}`;
      wrap.append(li);
    });
  return wrap;
}

/** Green "In stock" or an amber lead-time pill. */
function availabilityPill(product) {
  const pill = document.createElement('span');
  pill.className = 'product-card-pill';
  if (product.stock_qty > 0) {
    pill.classList.add('is-stock');
    pill.textContent = 'In stock';
  } else {
    pill.classList.add('is-lead');
    pill.textContent = `${product.lead_time_days}-day lead`;
  }
  return pill;
}

function buildCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';
  card.dataset.sku = product.sku;

  // Link to the dynamic PDP template (?sku=) so browse → product detail works
  // for any catalog product; fall back to the product's own URL if no sku.
  const href = product.product_url
    || (store.pdpUrl && product.sku
      ? `${store.pdpUrl}?sku=${encodeURIComponent(product.sku)}`
      : '#');

  const media = document.createElement('a');
  media.className = 'product-card-media';
  media.href = href;
  media.innerHTML = `<img src="${product.image_url}" alt="" loading="lazy">`;
  media.append(availabilityPill(product));

  const body = document.createElement('div');
  body.className = 'product-card-body';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'product-card-eyebrow';
  eyebrow.textContent = product.category || '';

  const title = document.createElement('h3');
  title.className = 'product-card-title';
  title.innerHTML = `<a href="${href}">${product.name}</a>`;

  const sku = document.createElement('p');
  sku.className = 'product-card-sku';
  sku.textContent = `Stock #${product.sku}`;

  const price = document.createElement('p');
  price.className = 'product-card-price';
  const unit = store.resolvePrice(product, 1);
  price.innerHTML = `<strong>${store.formatPrice(unit)}</strong>`;
  if ((product.price_breaks || []).length) {
    price.insertAdjacentHTML('beforeend', ' <span class="product-card-vol">volume pricing</span>');
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'product-card-add';
  add.textContent = 'Add to quote';
  add.addEventListener('click', async () => {
    await store.addToQuote(product.sku, 1, 'web');
    add.textContent = 'Added ✓';
    add.classList.add('is-added');
    setTimeout(() => {
      add.textContent = 'Add to quote';
      add.classList.remove('is-added');
    }, 1400);
  });

  body.append(eyebrow, title, sku, specChips(product), price, add);
  card.append(media, body);
  return card;
}

export default async function init(el) {
  const cfg = readConfig(el);

  const section = document.createElement('div');
  section.className = 'product-cards-inner';

  if (cfg.heading) {
    const h = document.createElement('h2');
    h.className = 'product-cards-heading';
    h.textContent = cfg.heading;
    section.append(h);
  }

  const grid = document.createElement('div');
  grid.className = 'product-cards-grid';

  const render = async (query) => {
    let products;
    if (cfg.skus.length && !query) {
      // Resolve each SKU via search rather than getProduct: entitlement-gated
      // SKUs come back as an empty result (200) instead of a 404, so an
      // anonymous page load stays free of console errors.
      const resolved = await Promise.all(cfg.skus.map(async (s) => {
        const hits = await store.search({ query: s, limit: 8 });
        return hits.find((p) => String(p.sku) === s) || null;
      }));
      products = resolved.filter(Boolean);
    } else {
      products = await store.search({
        query: query || cfg.query,
        filters: cfg.category ? null : null,
        limit: cfg.limit,
      });
      if (cfg.category) products = products.filter((p) => p.category === cfg.category);
    }
    grid.replaceChildren(...products.map(buildCard));
    if (!products.length) {
      grid.innerHTML = '<p class="product-cards-empty">No matching products in the catalog.</p>';
    }
  };

  if (cfg.search) {
    const form = document.createElement('form');
    form.className = 'product-cards-search';
    form.setAttribute('role', 'search');
    form.innerHTML = '<input type="search" placeholder="Search the catalog — e.g. 55 gallon absorbent" aria-label="Search products">';
    const input = form.querySelector('input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      render(input.value);
    });
    input.addEventListener('input', () => { if (!input.value) render(''); });
    section.append(form);
  }

  section.append(grid);
  el.replaceChildren(section);
  await render('');
}
