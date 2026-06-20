"""Helper module for the checkjebon-rundown notebook.

Ports the core matching logic from checkjebon-js so we can price AH/Jumbo
recipe ingredients against the live supermarkets.json feed.
"""

from __future__ import annotations

import json
import re
import sqlite3
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CHECKJEBON_URL = 'https://www.checkjebon.nl/data/supermarkets.json'
REPO_ROOT = Path(__file__).resolve().parents[1]
RECIPES_DB = REPO_ROOT / 'data' / 'source' / 'recipes.db'

UNIT_PATTERN = re.compile(
    r'([\d\.,]+)\s?(gram|gr|g|kilogram|kilo|kg|k|pond|milliliter|ml|liter|l|deciliter|dl|el|tl)',
    re.I,
)

QTY_UNIT_PREFIX = re.compile(
    r'^(g|kg|ml|l|el|tl|kop|kopjes?|teen|tenen|stuks?|blik(?:je)?|pak(?:je)?|'
    r'snufje|takje|takjes|bos|bosje|plak(?:jes?)?|middelgrote|grote|kleine)\b\.?\s*',
    re.I,
)


@dataclass
class MatchResult:
    query: str
    product_name: str | None
    price: float | None
    amount: str | None
    link: str | None
    is_estimate: bool = False


@dataclass
class RecipePriceResult:
    recipe_id: str
    title: str
    source: str
    ingredient_count: int
    matched_count: int
    total: float
    lines: list[MatchResult]


def fetch_supermarkets() -> list[dict[str, Any]]:
    with urllib.request.urlopen(CHECKJEBON_URL, timeout=90) as resp:
        return json.load(resp)


def clean_raw_text(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r'^[\d./,-]+\s*', '', s)
    s = QTY_UNIT_PREFIX.sub('', s)
    return s.strip() or raw.strip()


def ingredient_query(raw_text: str, food: str | None) -> str:
    base = (food or raw_text).strip()
    if re.match(r'^[\d]', base):
        return clean_raw_text(base)
    if food:
        return clean_raw_text(food)
    return clean_raw_text(raw_text)


def find_product(products: list[dict[str, Any]], query: str) -> dict[str, Any] | None:
    """Best-effort port of checkjebon-js findProduct (word + fuzzy fallback)."""
    search = re.sub(r'^x\s+', '', query.strip(), flags=re.I)
    if not search:
        return None

    patterns = [re.compile(re.escape(part), re.I) for part in search.split() if part]
    matches = [p for p in products if all(pat.search(p['n']) for pat in patterns)]

    if not matches:
        fuzzy = re.compile('.*'.join(re.escape(c) for c in search.replace(' ', '')), re.I)
        matches = [p for p in products if fuzzy.search(p['n'])]

    if not matches:
        return None

    def score(product: dict[str, Any]) -> tuple[int, float]:
        name = product['n']
        match_len = sum(len(m.group(0) or '') for pat in patterns if (m := pat.search(name)))
        return (-match_len, product['p'])

    matches.sort(key=score)
    return matches[0]


def match_ingredient(
    store: dict[str, Any],
    raw_text: str,
    food: str | None,
    all_prices: list[list[dict[str, Any] | None]] | None = None,
    store_index: int | None = None,
) -> MatchResult:
    query = ingredient_query(raw_text, food)
    base_url = store.get('u') or ''
    hit = find_product(store['d'], query)

    if hit:
        link = base_url + hit['l'] if hit.get('l') else None
        return MatchResult(
            query=query,
            product_name=hit['n'],
            price=round(hit['p'], 2),
            amount=hit.get('s'),
            link=link,
        )

    # checkjebon-js fallback: average price from other stores
    if all_prices is not None and store_index is not None:
        prices = [
            other['p']
            for i, other in enumerate(all_prices)
            if i != store_index and other is not None
        ]
        if prices:
            avg = round(sum(prices) / len(prices), 2)
            return MatchResult(
                query=query,
                product_name=None,
                price=avg,
                amount=None,
                link=None,
                is_estimate=True,
            )

    return MatchResult(query=query, product_name=None, price=None, amount=None, link=None)


def load_nl_recipes(
    conn: sqlite3.Connection,
    sources: tuple[str, ...] = ('ah', 'jumbo'),
) -> list[dict[str, Any]]:
    placeholders = ','.join('?' * len(sources))
    rows = conn.execute(
        f"""
        SELECT id, source, source_id, name, category, servings, total_time_min, url
        FROM recipes
        WHERE source IN ({placeholders})
        ORDER BY source, name
        """,
        sources,
    ).fetchall()
    recipes = []
    for rid, source, source_id, name, category, servings, prep, url in rows:
        ings = conn.execute(
            'SELECT raw_text, food FROM ingredients WHERE recipe_id=? ORDER BY id',
            (rid,),
        ).fetchall()
        recipes.append(
            {
                'id': f'{source}-{source_id or rid}',
                'db_id': rid,
                'source': source,
                'title': name,
                'category': category,
                'servings': servings,
                'prep_minutes': prep,
                'url': url,
                'ingredients': [{'raw': r, 'food': f} for r, f in ings],
            }
        )
    return recipes


def price_recipe_at_store(
    recipe: dict[str, Any],
    store: dict[str, Any],
    store_code: str,
    all_stores: list[dict[str, Any]] | None = None,
) -> RecipePriceResult:
    store_index = next(i for i, s in enumerate(all_stores or []) if s['n'] == store_code)
    stores = all_stores or [store]

    per_store_hits: list[list[dict[str, Any] | None]] = []
    for ing in recipe['ingredients']:
        row: list[dict[str, Any] | None] = []
        for s in stores:
            q = ingredient_query(ing['raw'], ing['food'])
            row.append(find_product(s['d'], q))
        per_store_hits.append(row)

    lines: list[MatchResult] = []
    total = 0.0
    matched = 0

    for ing, hits in zip(recipe['ingredients'], per_store_hits):
        line = match_ingredient(store, ing['raw'], ing['food'], hits, store_index)
        lines.append(line)
        if line.price is not None:
            total += line.price
            if line.product_name:
                matched += 1

    return RecipePriceResult(
        recipe_id=recipe['id'],
        title=recipe['title'],
        source=recipe['source'],
        ingredient_count=len(recipe['ingredients']),
        matched_count=matched,
        total=round(total, 2),
        lines=lines,
    )


def compare_recipe_across_stores(
    recipe: dict[str, Any],
    stores: list[dict[str, Any]],
    store_codes: list[str],
) -> list[RecipePriceResult]:
    by_code = {s['n']: s for s in stores}
    return [
        price_recipe_at_store(recipe, by_code[code], code, stores)
        for code in store_codes
        if code in by_code
    ]


def optimal_two_store_plan(
    ingredient_queries: list[str],
    stores: list[dict[str, Any]],
    store_codes: tuple[str, str] = ('ah', 'jumbo'),
) -> dict[str, Any]:
    """Greedy cheapest-store assignment (checkjebon getOptimalShoppingPlan, k=2)."""
    by_code = {s['n']: s for s in stores}
    ah = by_code[store_codes[0]]
    ju = by_code[store_codes[1]]

    rows = []
    total = 0.0
    ah_items = 0
    ju_items = 0

    for q in ingredient_queries:
        ah_hit = find_product(ah['d'], q)
        ju_hit = find_product(ju['d'], q)
        ah_price = ah_hit['p'] if ah_hit else None
        ju_price = ju_hit['p'] if ju_hit else None

        if ah_price is None and ju_price is None:
            rows.append({'query': q, 'store': None, 'price': None, 'product': None})
            continue

        if ju_price is None or (ah_price is not None and ah_price <= ju_price):
            chosen = ('ah', ah_hit, ah_price)
            ah_items += 1
        else:
            chosen = ('jumbo', ju_hit, ju_price)
            ju_items += 1

        store_code, hit, price = chosen
        total += price
        rows.append(
            {
                'query': q,
                'store': store_code,
                'price': round(price, 2),
                'product': hit['n'],
            }
        )

    return {
        'total': round(total, 2),
        'ah_items': ah_items,
        'jumbo_items': ju_items,
        'rows': rows,
    }


def print_table(rows: list[dict[str, Any]], columns: list[str] | None = None) -> None:
    """Pretty-print dict rows without pandas."""
    if not rows:
        print('(empty)')
        return
    cols = columns or list(rows[0].keys())
    widths = {
        c: max(len(c), *(len(str(r.get(c, ''))) for r in rows)) for c in cols
    }
    header = ' | '.join(c.ljust(widths[c]) for c in cols)
    print(header)
    print('-' * len(header))
    for row in rows:
        print(' | '.join(str(row.get(c, '')).ljust(widths[c]) for c in cols))


def print_bar_chart(
    rows: list[dict[str, Any]],
    label_key: str,
    value_key: str,
    *,
    width: int = 40,
    suffix: str = '',
) -> None:
    """ASCII bar chart — no matplotlib required."""
    if not rows:
        return
    max_val = max(float(r[value_key]) for r in rows) or 1.0
    for row in rows:
        val = float(row[value_key])
        bar_len = max(1, round(val / max_val * width)) if val > 0 else 0
        bar = '#' * bar_len
        print(f"{str(row[label_key]):8} {bar} {val}{suffix}")
