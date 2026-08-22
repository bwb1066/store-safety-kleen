"""Emit the upload-ready catalog: exactly {productName, productPageUrl,
productImageUrl, productDescription}.

Products whose page carried no description get one derived from their own name
and category -- no invented specs, claims, or numbers.
"""
import json
import re

ps = json.load(open('products_described.json'))

CAT_LABEL = {
    'a-cleaning-products': 'Cleaning Products',
    'absorbent': 'Absorbents',
    'bulk-products': 'Bulk Products',
    'household-hazardous-waste': 'Household Hazardous Waste',
    'lube-oil-products': 'Lubricants & Fluids',
    'pfas-tests': 'PFAS Tests',
    'recycling-kits': 'Recycling Kits',
    'storage-handling': 'Storage & Handling',
}


def label(cat):
    parts = cat.split('/')
    top = CAT_LABEL.get(parts[0], parts[0].replace('-', ' ').title())
    if len(parts) > 1:
        leaf = parts[-1].replace('-', ' ').title()
        return f'{top} — {leaf}'
    return top


derived = []
catalog = []
for p in ps:
    desc = p.get('productDescription', '').strip()
    name = p['productName']
    if len(desc) < 40:
        # Restate name + shelf location only; nothing here is invented.
        base = re.sub(r'\s*\([^)]*\)\s*$', '', name).strip()
        desc = (f'{base} from Safety-Kleen, listed under {label(p["category"])}. '
                f'Refer to the product page for full specifications and pack sizes.')
        derived.append(name)
    catalog.append({
        'productName': name,
        'productPageUrl': p['productPageUrl'],
        'productImageUrl': p['productImageUrl'],
        'productDescription': desc,
    })

with open('product-catalog.json', 'w') as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)

with open('product-catalog.min.json', 'w') as f:
    json.dump(catalog, f, separators=(',', ':'), ensure_ascii=False)

import os
print(f'products:            {len(catalog)}')
print(f'scraped descriptions:{len(catalog) - len(derived)}')
print(f'derived descriptions:{len(derived)}')
print(f'pretty size:         {os.path.getsize("product-catalog.json") / 1024:.0f} KB')
print(f'minified size:       {os.path.getsize("product-catalog.min.json") / 1024:.0f} KB')
print('\nderived:')
for d in derived:
    print('  -', d)
