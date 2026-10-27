"""Download one catalog photo per demo product into public/products.

Wikimedia Commons thumbnails, saved as JPEG on a white background.
Run from the repo root:  backend\\.venv\\Scripts\\python.exe backend\\scripts\\fetch_product_images.py
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "products"
UA = "RetailEdgeCatalog/1.0 (local demo store catalog; educational)"

# Commons File: titles. None means "search" using the query in SEARCH.
FILES: dict[str, str | None] = {
    "prod-01": "Alpro almond milk.jpg",
    "prod-02": "Sourdough.jpg",
    "prod-03": "Makhana.jpg",
    "prod-04": "Yoghurt.jpg",
    "prod-05": "Coffee_beans.jpg",
    "prod-06": "HK Watsons Herbal Hair Shampoo.JPG",
    "prod-c01": "Banana-Single.jpg",
    "prod-c02": "Red_Apple.jpg",
    "prod-c03": "Mango_and_cross_section.jpg",
    "prod-c04": "Tomato_je.jpg",
    "prod-c05": "Onions.jpg",
    "prod-c06": "Spinach_leaves.jpg",
    "prod-c07": "Milk products.jpg",
    "prod-c08": "Glass_of_milk.jpg",
    "prod-c09": "Bottle_of_milk.jpg",
    "prod-c10": "Yogurt.jpg",
    "prod-c11": "Butter.jpg",
    "prod-c12": "Paneer.jpg",
    "prod-c13": "Cheese.jpg",
    "prod-c14": "White_bread.jpg",
    "prod-c15": "Whole_wheat_bread.jpg",
    "prod-c16": "Eggs_in_carton.jpg",
    "prod-c17": "Cornflakes.jpg",
    "prod-c18": "Strawberry_jam.jpg",
    "prod-c19": "Basmati Rice India, raw.jpg",
    "prod-c20": "Rice Grains 1.jpg",
    "prod-c21": "Wheat_flour.jpg",
    "prod-c22": "Split pigeon peas.jpg",
    "prod-c23": "Sunflower_oil.jpg",
    "prod-c24": "Salt_shaker_on_white_background.jpg",
    "prod-c25": "Sugar cubes.jpg",
    "prod-c26": "Dove shampoo bottle.jpg",
    "prod-c27": "Head & Shoulders shampoo bottle.jpg",
    "prod-c28": "Toothpaste.jpg",
    "prod-c29": "Soap.jpg",
    "prod-c30": "Laundry detergent 1.jpg",
    "prod-c31": "Joy pot and pan detergent.jpg",
    "prod-c32": "Blue bucket with Bruce hardwood floor cleaner.jpg",
    "prod-c33": "Potato_chips.jpg",
    "prod-c34": "Namkeen.jpg",
    "prod-c35": "Biscuits.jpg",
    "prod-c36": "Instant_noodles.jpg",
    "prod-c37": "Milk_chocolate.jpg",
    "prod-c38": "Tea_leaves.jpg",
    "prod-c39": "Instant_coffee.jpg",
    "prod-c40": "Orange_juice.jpg",
    "prod-c41": "15-09-26-RalfR-WLC-0098 - Coca-Cola glass bottle (Germany).jpg",
    "prod-c42": "Water_bottle.jpg",
    "prod-c43": "Olive_oil.jpg",
}

SEARCH = {
    "prod-01": "almond milk glass",
    "prod-06": "herbal shampoo bottle",
    "prod-c27": "antidandruff shampoo bottle",
    "prod-c30": "laundry detergent powder box",
    "prod-c31": "dishwash bar soap",
}


def api(params: dict) -> dict:
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)


def thumb_for(titles: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i : i + 40]
        data = api(
            {
                "action": "query",
                "titles": "|".join(f"File:{t}" for t in chunk),
                "prop": "imageinfo",
                "iiprop": "url|mime",
                "iiurlwidth": "640",
                "format": "json",
            }
        )
        for page in data["query"]["pages"].values():
            if "missing" in page or "imageinfo" not in page:
                continue
            info = page["imageinfo"][0]
            mime = info.get("mime", "")
            if not mime.startswith("image/") or mime == "image/svg+xml":
                continue
            url = info.get("thumburl") or info.get("url")
            found[page["title"].removeprefix("File:")] = url
    return found


def search_file(query: str) -> str | None:
    data = api(
        {
            "action": "query",
            "list": "search",
            "srsearch": f"{query} filetype:bitmap",
            "srnamespace": "6",
            "srlimit": "8",
            "format": "json",
        }
    )
    skip = ("logo", "icon", "map", "diagram", "flag", "coat of arms", "svg")
    for hit in data.get("query", {}).get("search", []):
        title = hit["title"].removeprefix("File:")
        low = title.lower()
        if any(word in low for word in skip):
            continue
        if low.endswith((".jpg", ".jpeg", ".png", ".webp")):
            return title
    return None


def save_jpeg(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read(2_500_000)
        extra = response.read(1)
        if extra:
            raise RuntimeError(f"image larger than 2.5MB: {url}")
    image = Image.open(BytesIO(raw)).convert("RGBA")
    image.thumbnail((640, 640))
    canvas = Image.new("RGB", image.size, (255, 255, 255))
    canvas.paste(image, mask=image.split()[-1])
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "JPEG", quality=86, optimize=True)


def main() -> None:
    resolved: dict[str, str] = {}
    for pid, title in FILES.items():
        if title:
            resolved[pid] = title
        else:
            found = search_file(SEARCH[pid])
            if not found:
                raise SystemExit(f"no commons file for {pid} ({SEARCH[pid]})")
            resolved[pid] = found
            print(f"search {pid} -> {found}")

    pending = {pid: title for pid, title in resolved.items() if not (OUT / f"{pid}.jpg").exists()}
    urls = thumb_for(list(dict.fromkeys(pending.values()))) if pending else {}
    missing = [title for title in resolved.values() if title.replace("_", " ") not in urls and title not in urls]
    # API normalizes underscores to spaces in the returned title.
    by_key = {name.replace(" ", "_").lower(): url for name, url in urls.items()}
    by_key.update({name.lower(): url for name, url in urls.items()})

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for pid, title in resolved.items():
        url = urls.get(title) or urls.get(title.replace("_", " ")) or by_key.get(title.lower())
        if not url:
            print("MISSING URL", pid, title)
            continue
        dest = OUT / f"{pid}.jpg"
        if dest.exists() and dest.stat().st_size > 4000:
            written.append(f"{pid} cached {dest.stat().st_size} {title}")
            continue
        try:
            time.sleep(0.4)
            save_jpeg(url, dest)
        except Exception as exc:
            print("FAIL", pid, title, exc)
            continue
        written.append(f"{pid} {dest.stat().st_size} {title}")
    print(f"wrote {len(written)} / {len(resolved)}")
    if missing:
        print("unresolved titles", missing)
    print("\n".join(written))


if __name__ == "__main__":
    main()
