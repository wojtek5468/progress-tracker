"""Build the offline Polish product list from the Open Food Facts export.

Streams the full OFF export (tab-separated, gzip, ~1 GB) and keeps products sold in
Poland that have a name and energy per 100 g. Output is one JSON array per line, sorted
by barcode so weekly rebuilds stay stable:

    [code, name, brand, kcal, protein, fat, carbs, servingG, stores, scans]

scans = how many people scanned it (popularity), used to rank search results.

Data: Open Food Facts, Open Database License (ODbL) 1.0, https://world.openfoodfacts.org

    python3 tools/build_off_pl.py app/data/off-pl.json            # downloads the export
    python3 tools/build_off_pl.py app/data/off-pl.json export.csv.gz
"""
import csv
import gzip
import io
import json
import sys
import urllib.request

EXPORT_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz'
USER_AGENT = 'ProgressTracker/1.0 (https://github.com/wojtek5468/progress-tracker)'
LIMIT = 80000  # keeps the file around 6 MB; the most scanned products win


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, 1) if x == x and x >= 0 else None


def rows(source):
    if source.startswith('http'):
        req = urllib.request.Request(source, headers={'User-Agent': USER_AGENT})
        raw = urllib.request.urlopen(req, timeout=120)
    else:
        raw = open(source, 'rb')
    text = io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding='utf-8', errors='replace', newline='')
    csv.field_size_limit(1 << 30)
    return csv.DictReader(text, delimiter='\t', quoting=csv.QUOTE_NONE)


def main(out_path, source=EXPORT_URL):
    kept = []
    for r in rows(source):
        if 'en:poland' not in (r.get('countries_tags') or ''):
            continue
        name = (r.get('product_name') or r.get('generic_name') or '').strip()
        kcal = num(r.get('energy-kcal_100g'))
        if kcal is None and num(r.get('energy_100g')) is not None:
            kcal = round(num(r.get('energy_100g')) / 4.184, 1)
        code = (r.get('code') or '').strip()
        if not name or kcal is None or kcal > 900 or not code.isdigit():
            continue
        # The export dropped the free-text `brands` column; `brands_en` holds the display name.
        brand = (r.get('brands') or r.get('brands_en') or '').split(',')[0].strip()
        if brand == (r.get('brands_tags') or '').split(',')[0]:
            brand = brand.split(':')[-1].replace('-', ' ').title()  # only a tag like "red-bull" was given
        stores = ', '.join(x.strip() for x in (r.get('stores') or '').split(',')[:3] if x.strip())
        scans = int(num(r.get('unique_scans_n')) or 0)
        kept.append((
            scans,
            [code, name[:120], brand[:60], kcal, num(r.get('proteins_100g')) or 0, num(r.get('fat_100g')) or 0,
             num(r.get('carbohydrates_100g')) or 0, num(r.get('serving_quantity')), stores[:50], scans],
        ))
    kept.sort(key=lambda x: -x[0])
    products = sorted((p for _, p in kept[:LIMIT]), key=lambda p: p[0])
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('[\n')
        f.write(',\n'.join(json.dumps(p, ensure_ascii=False, separators=(',', ':')) for p in products))
        f.write('\n]\n')
    print(f'{len(products)} products from {len(kept)} Polish entries -> {out_path}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
