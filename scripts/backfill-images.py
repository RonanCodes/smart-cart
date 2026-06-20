
import sqlite3, sys, os, json, time, re
import requests
from bs4 import BeautifulSoup

DB = "data/source/recipes.db"
IMAGES_DIR = "data/images"
os.makedirs(IMAGES_DIR, exist_ok=True)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"}

conn = sqlite3.connect(DB)
cur = conn.cursor()

# Get old recipes missing image_url
rows = cur.execute("""
    SELECT id, source, url, name FROM recipes 
    WHERE (source='ah' AND id < 1000) OR (source='jumbo' AND id < 1000)
    ORDER BY source, id
""").fetchall()

print(f"Backfilling {len(rows)} recipes...")

downloaded = 0
for rid, source, url, name in rows:
    try:
        print(f"  [{source}] #{rid}: {name[:40]}", flush=True)
        resp = requests.get(url, headers=HEADERS, timeout=20)
        soup = BeautifulSoup(resp.text, "lxml")
        
        # Find Recipe JSON-LD
        img_url = None
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
            except:
                continue
            for item in (data if isinstance(data, list) else [data]):
                if isinstance(item, dict) and item.get("@type") == "Recipe":
                    img = item.get("image", "")
                    if isinstance(img, list):
                        img = img[-1] if source == "ah" else img[0]
                    if isinstance(img, dict):
                        img = img.get("url", "")
                    if img:
                        img_url = img
                        break
            if img_url:
                break
        
        if img_url:
            # Update DB
            cur.execute("UPDATE recipes SET image_url = ? WHERE id = ?", (img_url, rid))
            
            # Download image
            safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', name)[:60]
            ext = img_url.split(".")[-1].split("?")[0].lower()
            if ext not in ("jpg","jpeg","png","webp","gif"): ext = "jpg"
            fname = f"{source}_{rid}_{safe_name}.{ext}"
            fpath = os.path.join(IMAGES_DIR, fname)
            
            img_resp = requests.get(img_url, headers=HEADERS, timeout=20)
            if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                with open(fpath, "wb") as f:
                    f.write(img_resp.content)
                downloaded += 1
                print(f"    ✅ img: {os.path.basename(fpath)}", flush=True)
            else:
                print(f"    ⚠️  download failed for {img_url[:60]}", flush=True)
        else:
            print(f"    ⚠️  no image found in JSON-LD", flush=True)
            
    except Exception as e:
        print(f"    ❌ error: {e}", flush=True)
    
    time.sleep(0.5)

conn.commit()
conn.close()
print(f"\nDone! {downloaded} images downloaded.")
