"""Crawl Safety-Kleen category pages and extract product listings.

Only fetches pretty category/product URLs (robots.txt disallows /catalog/ and
any query-string URL, which rules out ?p= pagination -- so page 1 per category).
"""
import html as htmllib
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
BASE = 'https://store.safety-kleen.com'

TOPS = [
    'absorbent', 'bulk-products', 'cleaning-products', 'household-hazardous-waste',
    'lube-oil-products', 'pfas-tests', 'recycling-kits', 'storage-handling',
]


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode('utf-8', 'replace')
        except (urllib.error.URLError, TimeoutError, OSError):
            if i == tries - 1:
                return ''
            time.sleep(2 * (i + 1))
    return ''


ITEM_RE = re.compile(r'<li[^>]*class="[^"]*product-item[^"]*"(.*?)</li>', re.S)
LINK_RE = re.compile(r'<a class="product-item-link"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)
IMG_RE = re.compile(r'class="product-image-photo"[^>]*src="([^"]+)"')
SKU_RE = re.compile(r'<span>SKU\s*-\s*([^<]+)</span>')


def clean(s):
    return re.sub(r'\s+', ' ', htmllib.unescape(re.sub(r'<[^>]+>', '', s))).strip()


def parse_category(url):
    page = fetch(url)
    out = []
    for chunk in ITEM_RE.findall(page):
        lm = LINK_RE.search(chunk)
        if not lm:
            continue
        im = IMG_RE.search(chunk)
        sm = SKU_RE.search(chunk)
        out.append({
            'productName': clean(lm.group(2)),
            'productPageUrl': lm.group(1).split('?')[0],
            'productImageUrl': im.group(1).split('?')[0].replace('&amp;', '&') if im else '',
            'sku': clean(sm.group(1)) if sm else '',
            'category': url.split('/en_us/')[1].replace('.html', ''),
        })
    return url, out


def main():
    cats = [f'{BASE}/en_us/{t}.html' for t in TOPS]
    cats += [ln.strip() for ln in open('leaf_cats.txt') if ln.strip()]
    cats = sorted(set(cats))

    products = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for url, items in ex.map(parse_category, cats):
            print(f'{len(items):4d}  {url}', flush=True)
            for p in items:
                products.setdefault(p['productPageUrl'], p)

    print(f'\nunique products: {len(products)}')
    with open('products_raw.json', 'w') as f:
        json.dump(list(products.values()), f, indent=2)


if __name__ == '__main__':
    main()
