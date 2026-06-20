#!/usr/bin/env python3
"""Regenerate checkjebon-rundown.ipynb (stdlib only, no pandas)."""
import json
from pathlib import Path

cells = []

def md(text: str) -> None:
    lines = text.split('\n')
    cells.append({
        'cell_type': 'markdown',
        'metadata': {},
        'source': [l + '\n' for l in lines[:-1]] + ([lines[-1]] if lines[-1] else []),
    })

def code(text: str) -> None:
    lines = text.split('\n')
    cells.append({
        'cell_type': 'code',
        'metadata': {},
        'source': [l + '\n' for l in lines[:-1]] + ([lines[-1]] if lines[-1] else []),
        'outputs': [],
        'execution_count': None,
    })

md("""# Checkjebon x Smart Cart recipe rundown

Uses **Python stdlib only** — no pandas or matplotlib.

```bash
pip install jupyter
cd notebooks
jupyter notebook checkjebon-rundown.ipynb
```
""")

code("""import sqlite3

from checkjebon_rundown import (
    CHECKJEBON_URL,
    RECIPES_DB,
    compare_recipe_across_stores,
    fetch_supermarkets,
    load_nl_recipes,
    optimal_two_store_plan,
    price_recipe_at_store,
    print_bar_chart,
    print_table,
)

print('Recipes DB:', RECIPES_DB, 'exists:', RECIPES_DB.exists())
print('Checkjebon feed:', CHECKJEBON_URL)
""")

md('## 1. Load Checkjebon catalogue')

code("""stores = fetch_supermarkets()
store_rows = sorted(
    [{'code': s['n'], 'name': s['c'], 'products': len(s.get('d') or [])} for s in stores],
    key=lambda r: r['products'],
    reverse=True,
)
print_table(store_rows)
""")

md('## 2. Load AH + Jumbo recipes')

code("""conn = sqlite3.connect(RECIPES_DB)
recipes = load_nl_recipes(conn)
conn.close()

from collections import Counter
print('By source:', dict(Counter(r['source'] for r in recipes)))
print_table([
    {'id': r['id'], 'source': r['source'], 'title': r['title'][:36], 'ings': len(r['ingredients'])}
    for r in recipes[:8]
])
""")

md('## 3. Match rate by supermarket')

code("""from checkjebon_rundown import find_product, ingredient_query

unique_queries = sorted({
    ingredient_query(i['raw'], i['food'])
    for r in recipes
    for i in r['ingredients']
    if ingredient_query(i['raw'], i['food'])
})

by_code = {s['n']: s for s in stores}
match_rows = []
for code in ['ah', 'jumbo', 'plus', 'dirk', 'lidl', 'aldi']:
    if code not in by_code:
        continue
    matched = sum(1 for q in unique_queries if find_product(by_code[code]['d'], q))
    match_rows.append({
        'store': code,
        'matched': matched,
        'total': len(unique_queries),
        'match_pct': round(100 * matched / len(unique_queries), 1),
    })

match_rows.sort(key=lambda r: r['match_pct'], reverse=True)
print_table(match_rows)
print_bar_chart(match_rows, 'store', 'match_pct', suffix='%')
""")

md('## 4. Price one AH hoofdgerecht')

code("""demo = next(r for r in recipes if r['source'] == 'ah' and (r['category'] or '') == 'hoofdgerecht')
results = compare_recipe_across_stores(demo, stores, ['ah', 'jumbo'])
print('Recipe:', demo['title'])
print_table([
    {'store': c, 'total': r.total, 'matched': f"{r.matched_count}/{r.ingredient_count}"}
    for c, r in zip(['ah', 'jumbo'], results)
])
""")

code("""detail = []
for store_code, result in zip(['ah', 'jumbo'], results):
    for line in result.lines:
        detail.append({
            'store': store_code,
            'query': line.query[:24],
            'product': (line.product_name or '')[:30],
            'price': line.price,
        })
print_table(detail)
""")

md('## 5. All AH recipes — Jumbo cheaper?')

code("""batch = []
for r in recipes:
    if r['source'] != 'ah':
        continue
    ah = price_recipe_at_store(r, by_code['ah'], 'ah', stores)
    ju = price_recipe_at_store(r, by_code['jumbo'], 'jumbo', stores)
    if not ah.ingredient_count:
        continue
    batch.append({
        'id': r['id'],
        'title': r['title'][:38],
        'ah': ah.total,
        'jumbo': ju.total,
        'save': round(ah.total - ju.total, 2),
    })
batch.sort(key=lambda r: r['save'], reverse=True)
print('Jumbo cheaper on:', sum(1 for r in batch if r['jumbo'] < r['ah']), '/', len(batch))
print_table(batch[:10])
""")

md('## 6. Seven-day week totals')

code("""week = batch[:7]
week_totals = {
    'ah_week_eur': round(sum(r['ah'] for r in week), 2),
    'jumbo_week_eur': round(sum(r['jumbo'] for r in week), 2),
    'savings_eur': round(sum(r['save'] for r in week), 2),
}
print(week_totals)
print_table(week, ['title', 'ah', 'jumbo', 'save'])
""")

md('## 7. Split basket (cheapest per ingredient)')

code("""recipe_by_id = {r['id']: r for r in recipes}
week_recipes = [recipe_by_id[r['id']] for r in week]
all_queries = sorted({
    ingredient_query(i['raw'], i['food'])
    for r in week_recipes
    for i in r['ingredients']
})
plan = optimal_two_store_plan(all_queries, stores)
print('Split total EUR:', plan['total'])
print('AH items:', plan['ah_items'], 'Jumbo items:', plan['jumbo_items'])
print_table(plan['rows'][:12], ['query', 'store', 'price', 'product'])
""")

md('## 8. Live demo\n\nOpen `/week` in the app — price strip + **make it cheaper** use `src/lib/pricing/`.')

nb = {
    'nbformat': 4,
    'nbformat_minor': 5,
    'metadata': {
        'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
        'language_info': {'name': 'python', 'version': '3.11.0'},
    },
    'cells': cells,
}

out = Path(__file__).with_name('checkjebon-rundown.ipynb')
out.write_text(json.dumps(nb, indent=1) + '\n')
print('Wrote', out, 'with', len(cells), 'cells')
