"""Second pass: pull the real list price + GA4 category off each PDP.

Prices come from the GA4 dataLayer item object embedded in the page:
  {"item_id":"1030","item_name":"...","price":110,"item_category":"Socks",
   "item_category2":"Absorbents",...}
"""
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'

PRICE_RE = re.compile(r'"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)')
CAT1_RE = re.compile(r'"item_category"\s*:\s*"([^"]*)"')
CAT2_RE = re.compile(r'"item_category2"\s*:\s*"([^"]*)"')
ID_RE = re.compile(r'"item_id"\s*:\s*"([^"]*)"')


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


def enrich(p):
    page = fetch(p['productPageUrl'])
    pm = PRICE_RE.search(page)
    p['listPrice'] = float(pm.group(1)) if pm else None
    c1 = CAT1_RE.search(page)
    c2 = CAT2_RE.search(page)
    im = ID_RE.search(page)
    p['gaCategory'] = c1.group(1) if c1 else ''
    p['gaCategory2'] = c2.group(1) if c2 else ''
    p['itemId'] = im.group(1) if im else ''
    return p


def main():
    products = json.load(open('products_described.json'))
    done = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, p in enumerate(ex.map(enrich, products), 1):
            done.append(p)
            if i % 50 == 0:
                print(f'{i}/{len(products)}', flush=True)
    json.dump(done, open('products_priced.json', 'w'), indent=2)
    priced = [p for p in done if p.get('listPrice')]
    print(f'done: {len(done)}  with real price: {len(priced)}')
    if priced:
        vals = sorted(p['listPrice'] for p in priced)
        print(f'price range: ${vals[0]:.2f} - ${vals[-1]:.2f}  median ${vals[len(vals)//2]:.2f}')


if __name__ == '__main__':
    main()
