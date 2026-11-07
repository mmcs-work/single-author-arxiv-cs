"""Build same-origin JSON data for the static GitHub Pages archive."""

import argparse
import json
import os
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "pages" / "data"
PAGES = DATA.parent
SITE_URL = os.environ.get("SITE_URL", "https://mmcs-work.github.io/single-author-arxiv-cs").rstrip("/")
sys.path.insert(0, str(ROOT))
from config import CATEGORIES
COLUMNS = (
    "arxiv_id", "title", "author", "abstract", "primary_category", "categories",
    "published", "updated", "arxiv_url", "pdf_url",
)


def record(row):
    return dict(zip(COLUMNS, row))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def write_feed(path, title, records):
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = title
    ET.SubElement(channel, "link").text = SITE_URL
    ET.SubElement(channel, "description").text = "Single-author arXiv papers."
    for record in sort(records)[:1000]:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = record["title"]
        ET.SubElement(item, "link").text = record["arxiv_url"]
        ET.SubElement(item, "guid", isPermaLink="true").text = record["arxiv_url"]
        published = datetime.fromisoformat(record["published"].replace("Z", "+00:00"))
        ET.SubElement(item, "pubDate").text = format_datetime(published)
        ET.SubElement(item, "description").text = record["abstract"]
    tree = ET.ElementTree(rss)
    ET.indent(tree, space="  ")
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else []


def sort(records):
    return sorted(records, key=lambda item: (item["published"], item["arxiv_id"]), reverse=True)


def full_records(database):
    with sqlite3.connect(database) as connection:
        rows = connection.execute(f"SELECT {', '.join(COLUMNS)} FROM papers")
        return [record(row) for row in rows]


def recent_records(days):
    from config import CATEGORIES
    from fetch import fetch_category, paper_from

    now = datetime.now(timezone.utc)
    first_day = (now - timedelta(days=days - 1)).date()
    found = {}
    for index, category in enumerate(CATEGORIES):
        if index:
            time.sleep(3)
        for entry in fetch_category(category, f"{first_day:%Y%m%d}0000", f"{now:%Y%m%d%H%M}", 2000):
            paper = paper_from(entry)
            if paper:
                found[paper[0]] = record(paper)
    return list(found.values())


def merge(path, additions):
    records = {item["arxiv_id"]: item for item in read_json(path)}
    records.update({item["arxiv_id"]: item for item in additions})
    write_json(path, sort(records.values()))


def search_rows(records):
    return [
        {key: item[key] for key in ("arxiv_id", "title", "author", "primary_category", "categories", "published")}
        for item in sort(records)
    ]


def rebuild(records):
    by_month, by_category = defaultdict(list), defaultdict(list)
    for item in records:
        by_month[item["published"][:7]].append(item)
        for category in item["categories"].split(","):
            if category in CATEGORIES:
                by_category[category].append(item)
    for month, items in by_month.items():
        write_json(DATA / "months" / f"{month}.json", sort(items))
    for category, items in by_category.items():
        write_json(DATA / "categories" / f"{category}.json", sort(items))
        write_feed(PAGES / "feeds" / f"{category}.xml", f"One Author — {CATEGORIES[category]}", items)
    write_json(DATA / "latest.json", sort(records)[:100])
    write_feed(PAGES / "feed.xml", "One Author — latest papers", records)
    write_json(DATA / "search.json", search_rows(records))
    write_json(DATA / "manifest.json", {
        "records": len(records),
        "months": sorted(by_month),
        "categories": CATEGORIES,
        "updated": datetime.now(timezone.utc).isoformat(),
    })


def refresh(records):
    index_path = DATA / "search.json"
    index = {item["arxiv_id"]: item for item in read_json(index_path)}
    additions = [item for item in records if item["arxiv_id"] not in index]
    if not additions:
        return 0

    by_month, by_category = defaultdict(list), defaultdict(list)
    for item in additions:
        by_month[item["published"][:7]].append(item)
        for category in item["categories"].split(","):
            if category in CATEGORIES:
                by_category[category].append(item)
    for month, items in by_month.items():
        merge(DATA / "months" / f"{month}.json", items)
    for category, items in by_category.items():
        merge(DATA / "categories" / f"{category}.json", items)
        category_records = read_json(DATA / "categories" / f"{category}.json")
        write_feed(PAGES / "feeds" / f"{category}.xml", f"One Author — {CATEGORIES[category]}", category_records)
    latest = {item["arxiv_id"]: item for item in read_json(DATA / "latest.json")}
    latest.update({item["arxiv_id"]: item for item in additions})
    write_json(DATA / "latest.json", sort(latest.values())[:100])
    write_feed(PAGES / "feed.xml", "One Author — latest papers", latest.values())
    index.update({item["arxiv_id"]: item for item in search_rows(additions)})
    write_json(index_path, sort(index.values()))
    manifest_path = DATA / "manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {}
    manifest.update({
        "records": len(index),
        "categories": CATEGORIES,
        "updated": datetime.now(timezone.utc).isoformat(),
    })
    write_json(manifest_path, manifest)
    return len(additions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--database", type=Path)
    source.add_argument("--recent", action="store_true")
    parser.add_argument("--days", type=int, default=2)
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be positive")
    records = recent_records(args.days) if args.recent else full_records(args.database)
    if args.recent:
        added = refresh(records)
        print(f"Found {len(records):,} recent record(s); added {added:,} new record(s).")
    else:
        rebuild(records)
        print(f"Wrote static data for {len(records):,} record(s).")


if __name__ == "__main__":
    main()
