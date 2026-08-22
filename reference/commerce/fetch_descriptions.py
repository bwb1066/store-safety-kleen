"""Fetch each product page and pull its description.

Prefers the full "Product Description" block; falls back to <meta name=description>.
"""
import html as htmllib
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
MAX_LEN = 600

DESC_RE = re.compile(
    r'<div[^>]*class="product attribute description"[^>]*>.*?<div class="value"[^>]*>(.*?)</div>',
    re.S)
META_RE = re.compile(r'<meta name="description" content="([^"]*)"')


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


def clean(s):
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = htmllib.unescape(s)
    s = s.replace('\xa0', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return re.sub(r'^Product Description\s*', '', s, flags=re.I).strip()


def truncate(s, n=MAX_LEN):
    if len(s) <= n:
        return s
    cut = s[:n]
    dot = cut.rfind('. ')
    return (cut[:dot + 1] if dot > n * 0.5 else cut.rstrip() + '...').strip()


def describe(p):
    page = fetch(p['productPageUrl'])
    desc = ''
    m = DESC_RE.search(page)
    if m:
        desc = clean(m.group(1))
    if len(desc) < 40:
        mm = META_RE.search(page)
        if mm:
            desc = clean(mm.group(1))
    p['productDescription'] = truncate(desc)
    return p


def main():
    products = json.load(open('products_raw.json'))
    done = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, p in enumerate(ex.map(describe, products), 1):
            done.append(p)
            if i % 25 == 0:
                print(f'{i}/{len(products)}', flush=True)
    json.dump(done, open('products_described.json', 'w'), indent=2)
    missing = [p for p in done if len(p.get('productDescription', '')) < 40]
    print(f'done: {len(done)}  missing/short descriptions: {len(missing)}')


if __name__ == '__main__':
    main()
