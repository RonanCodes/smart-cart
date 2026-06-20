#!/usr/bin/env python3
"""
Scrape 50 AH Allerhande + 50 Jumbo Recepten recipes + download images.
"""
import json, os, random, re, sqlite3, sys, time, xml.etree.ElementTree as ET
from datetime import datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__) or ".", "..", "data", "source", "recipes.db"))
IMAGES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__) or ".", "..", "data", "images"))
os.makedirs(IMAGES_DIR, exist_ok=True)

DELAY = 0.5
TIMEOUT = 20
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"}

AH_TERMS = ["pasta", "kip", "salade", "vis", "soep", "ovenschotel", "varken", "vegetarisch", "rundvlees", "aziatisch"]
AH_PAGES = 2

def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)

def get(url, *, headers=None, stream=False):
    h = {**HEADERS, **(headers or {})}
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=h, timeout=TIMEOUT, stream=stream)
            if resp.status_code == 403 and attempt < 2:
                time.sleep(2**attempt); continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt < 2: time.sleep(2**attempt)
            else: raise
    return None

def iso_dur_min(s):
    if not s or not isinstance(s, str): return None
    m = re.match(r"^PT?(?:(?:(\d+)H)?(?:(\d+)M)?|(\d+)S)?$", s.strip())
    if not m: return None
    h, hm, sec = m.groups()
    if h or hm: return (int(h or 0)*60)+int(hm or 0)
    if sec: return 1
    return None

def parse_num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return v
    if isinstance(v, str):
        v = v.strip()
        if not v or v in ("0","0 calories"): return 0
        m = re.search(r"(\d+(?:\.\d+)?)", v.replace(",","."))
        if m: return round(float(m.group(1)))
    return None

def parse_yield(v):
    if not v: return None
    if isinstance(v, list): v = v[0] if v else None
    if isinstance(v, str):
        m = re.search(r"\d+", v)
        if m: return int(m.group(0))
    try: return int(v)
    except: return None

def src_id(url, source):
    if source == "ah":
        m = re.search(r"/R-([^/]+)", url)
        return m.group(1) if m else None
    elif source == "jumbo":
        m = re.search(r"-(\d{6,8})$", url.rstrip("/"))
        return m.group(1) if m else None
    return None

def parse_ings(ingredient_list, recipe_id, cur):
    for raw in ingredient_list:
        raw = (raw or "").strip()
        if not raw: continue
        quantity = None; unit = None; food = raw
        m = re.match(
            r"^([\d.,/¼½¾⅓⅔⅛⅜⅝⅞∞\-\s]+)\s*"
            r"(el|tl|g|kg|ml|l|liter|kop|kopje|kopjes|c|cup|cupjes|"
            r"teen|tenen|stuk|stuks|blik|blikje|blikjes|pak|pakje|pakjes|"
            r"snuf|snufje|takje|bos|bosje|plak|plakje|plakjes|"
            r"theelepel|eetlepel|eetlepels|theelepels|mililiter|milliliter|gram|kilo"
            r")?\s*(.*)", raw, re.IGNORECASE | re.DOTALL)
        if m:
            qs = m.group(1).strip()
            unit = m.group(2) if m.group(2) else None
            food = m.group(3).strip() if m.group(3) else raw
            quantity = parse_num(qs) if qs else None
        cur.execute(
            "INSERT INTO ingredients (recipe_id, raw_text, food, quantity, unit, original_qty) VALUES (?,?,?,?,?,?)",
            (recipe_id, raw, food, quantity, unit, str(quantity) if quantity else None))

# --- JUMBO ---
SITEMAP_URL = "https://www.jumbo.com/recepten/sitemap.xml"

def get_jumbo_urls(count=50):
    log(f"Fetching Jumbo sitemap...")
    resp = get(SITEMAP_URL)
    root = ET.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = []
    for url_elem in root.findall("sm:url", ns):
        loc = url_elem.find("sm:loc", ns)
        if loc is not None and loc.text and "/recepten/" in loc.text:
            urls.append(loc.text.strip())
    random.shuffle(urls)
    log(f"  {len(urls)} in sitemap, selected {count}")
    return urls[:count]

# --- AH ---
def get_ah_urls(count=50):
    collected = set()
    for term in AH_TERMS:
        for page in range(1, AH_PAGES+1):
            if len(collected) >= count: break
            url = f"https://www.ah.nl/allerhande/recepten-zoeken?query={term}&page={page}"
            log(f"  AH search: '{term}' p{page}")
            try:
                resp = get(url)
                soup = BeautifulSoup(resp.text, "lxml")
                for script in soup.find_all("script", type="application/ld+json"):
                    try: data = json.loads(script.string)
                    except: continue
                    if not isinstance(data, dict) or data.get("@type") != "ItemList": continue
                    for item in data.get("itemListElement", []):
                        u = item.get("url")
                        if u and u not in collected and "/recept/" in u:
                            collected.add(u)
                log(f"    Total: {len(collected)}")
            except Exception as e:
                log(f"    Error: {e}")
            time.sleep(DELAY)
        if len(collected) >= count: break
    return list(collected)[:count]

# --- JSON-LD EXTRACTION ---
def find_recipe_ld(soup):
    for script in soup.find_all("script", type="application/ld+json"):
        try: data = json.loads(script.string)
        except: continue
        for item in (data if isinstance(data, list) else [data]):
            if isinstance(item, dict) and item.get("@type") in ("Recipe",):
                return item
    return None

def download_image(url, recipe_id, source, name):
    """Download image and return local path (or None on failure)."""
    if not url: return None
    ext = url.split(".")[-1].split("?")[0].lower()
    if ext not in ("jpg","jpeg","png","webp","gif"):
        ext = "jpg"
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', name)[:60]
    fname = f"{source}_{recipe_id}_{safe_name}.{ext}"
    fpath = os.path.join(IMAGES_DIR, fname)
    if os.path.exists(fpath) and os.path.getsize(fpath) > 1000:
        return fpath
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code == 200 and len(resp.content) > 1000:
            with open(fpath, "wb") as f:
                f.write(resp.content)
            return fpath
    except:
        pass
    return None

def insert_recipe(ld, url, source, cur):
    src_id_val = src_id(url, source) or f"scraped-{int(time.time())}"
    name = ld.get("name", "Unknown")
    desc = ld.get("description", "")
    if isinstance(desc, list): desc = " ".join(desc)

    total_time = iso_dur_min(ld.get("totalTime") or ld.get("cookTime") or "")
    servings = parse_yield(ld.get("recipeYield"))
    nutrition = ld.get("nutrition") or {}
    calories = parse_num(nutrition.get("calories"))
    protein = parse_num(nutrition.get("proteinContent") or nutrition.get("protein"))
    fat = parse_num(nutrition.get("fatContent") or nutrition.get("fat"))
    sat_fat = parse_num(nutrition.get("saturatedFatContent"))
    carbs = parse_num(nutrition.get("carbohydrateContent") or nutrition.get("carbohydrates"))

    image = ld.get("image", "")
    if isinstance(image, list):
        # AH: use largest (last), Jumbo: use first
        image = image[-1] if source == "ah" else image[0]
    if isinstance(image, dict):
        image = image.get("url", "")

    category = ld.get("recipeCategory", "")
    if isinstance(category, list): category = category[0] if category else ""

    diet = ld.get("suitableForDiet", None)
    if isinstance(diet, list): diet = json.dumps(diet) if diet else None
    elif diet: diet = json.dumps([diet])

    keywords = ld.get("keywords", "")
    if isinstance(keywords, list): keywords = ", ".join(keywords)

    rating = ld.get("aggregateRating", {})
    rv = None; rc = None
    if isinstance(rating, dict):
        rv_raw = rating.get("ratingValue")
        if isinstance(rv_raw, (int,float)): rv = rv_raw
        elif isinstance(rv_raw, str): rv = parse_num(rv_raw)
        rc_raw = rating.get("ratingCount")
        if isinstance(rc_raw, (int,float)): rc = int(rc_raw)
        elif isinstance(rc_raw, str): rc = parse_num(rc_raw)
        if rc and rc > 10000: rc = None

    date_pub = ld.get("datePublished", "")

    try:
        cur.execute(
            """INSERT INTO recipes
            (source, source_id, name, name_nl, url, image_url, description,
             total_time_min, servings, calories, protein_g, fat_g, saturated_fat_g,
             carbs_g, cuisine, meal_type, dish_type, category, difficulty,
             diet_labels, health_labels, tags, rating, rating_count, date_published)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (source, src_id_val, name, name, url, image or None,
             (desc or "")[:1000] if desc else None,
             total_time, servings, calories, protein, fat, sat_fat, carbs,
             None, "dinner", None, category or None, None,
             diet, None, keywords or None, rv, rc, date_pub or None))
        recipe_id = cur.lastrowid
        log(f"    √ #{recipe_id}: {name[:50]}")
    except sqlite3.IntegrityError:
        log(f"    - Skipped (dup): {name[:50]}")
        return None, None

    # Ingredients
    ings = ld.get("recipeIngredient", [])
    parse_ings(ings, recipe_id, cur)

    # Instructions
    for idx, step in enumerate(ld.get("recipeInstructions", [])):
        text = step.get("text") if isinstance(step, dict) else step
        if not text or not str(text).strip(): continue
        cur.execute("INSERT INTO instructions (recipe_id, step, text) VALUES (?,?,?)",
                     (recipe_id, idx+1, str(text).strip()))

    # Download image
    local_path = None
    if image:
        local_path = download_image(image, recipe_id, source, name)

    return recipe_id, local_path

def scrape_batch(source, target, urls, cur):
    inserted = 0
    for url in urls:
        if inserted >= target: break
        try:
            log(f"  Fetching {source}: {url[:70]}")
            resp = get(url)
            if not resp: continue
            soup = BeautifulSoup(resp.text, "lxml")
            ld = find_recipe_ld(soup)
            if not ld:
                log(f"    No JSON-LD"); continue
            rid, img_path = insert_recipe(ld, url, source, cur)
            if rid is not None:
                inserted += 1
                if img_path:
                    log(f"      📷 saved: {os.path.basename(img_path)}")
        except Exception as e:
            log(f"    !! Error: {e}")
        time.sleep(DELAY * (1.5 if source == "ah" else 1))
    return inserted

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["ah","jumbo","all"], default="all")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--images-only", action="store_true", help="Only download images for existing rows")
    args = parser.parse_args()

    log(f"DB: {DB_PATH}")
    log(f"Images: {IMAGES_DIR}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    existing = cur.execute(
        "SELECT source, COUNT(*) FROM recipes WHERE source IN ('ah','jumbo') GROUP BY source"
    ).fetchall()
    for s,c in existing: log(f"  Existing {s}: {c}")

    if not args.images_only:
        if args.source in ("all", "jumbo"):
            log("="*60); log("JUMBO")
            urls = get_jumbo_urls(args.count * 2)
            n = scrape_batch("jumbo", args.count, urls, cur)
            conn.commit(); log(f"Jumbo: {n} inserted")
        if args.source in ("all", "ah"):
            log("="*60); log("AH")
            urls = get_ah_urls(args.count * 2)
            n = scrape_batch("ah", args.count, urls, cur)
            conn.commit(); log(f"AH: {n} inserted")

    # Image-only mode: download images for existing rows missing local files
    if args.images_only or not args.images_only:
        log("="*60)
        log("Downloading any missing images...")
        rows = cur.execute(
            "SELECT id, source, image_url, name FROM recipes WHERE source IN ('ah','jumbo') AND image_url IS NOT NULL AND image_url != ''"
        ).fetchall()
        downloaded = 0
        for rid, src, img_url, name in rows:
            path = download_image(img_url, rid, src, name)
            if path: downloaded += 1
        log(f"Images downloaded/synced: {downloaded}")

    # Summary
    counts = cur.execute(
        "SELECT source, COUNT(*) FROM recipes WHERE source IN ('ah','jumbo') GROUP BY source"
    ).fetchall()
    conn.close()
    img_count = len([f for f in os.listdir(IMAGES_DIR) if os.path.isfile(os.path.join(IMAGES_DIR, f))])
    log("="*60)
    for s,c in counts: log(f"  {s}: {c} recipes")
    log(f"  Images on disk: {img_count}")

if __name__ == "__main__":
    main()
