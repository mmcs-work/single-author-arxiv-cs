"""Small arXiv API helper shared by the daily static-data updater."""

import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API_URL = "https://export.arxiv.org/api/query"
ATOM = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
TIMEOUT = 60
RETRY_DELAYS = (15, 45, 120)


def text(entry, name):
    return " ".join(entry.findtext(name, default="", namespaces=ATOM).split())


def fetch_category(category, start, end, max_results):
    """Return arXiv API entries for one category and submission-time window."""
    query = f"cat:{category} AND submittedDate:[{start} TO {end}]"
    params = urllib.parse.urlencode(
        {
            "search_query": query,
            "start": 0,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"User-Agent": "single-author-arxiv-cs/1.0 (https://github.com/mmcs-work/single-author-arxiv-cs)"},
    )
    last_error = None
    for delay in (*RETRY_DELAYS, None):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return ET.parse(response).getroot().findall("atom:entry", ATOM)
        except urllib.error.HTTPError as error:
            if error.code != 429 and not 500 <= error.code < 600:
                raise
            last_error = error
        except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError) as error:
            last_error = error
        if delay is None:
            print(f"arXiv request for {category} failed ({last_error}); skipping until the next refresh.", flush=True)
            return []
        print(f"arXiv request for {category} failed ({last_error}); retrying in {delay}s…", flush=True)
        time.sleep(delay)


def paper_from(entry):
    """Return one normalized record, or None unless it has exactly one author."""
    authors = entry.findall("atom:author", ATOM)
    if len(authors) != 1:
        return None

    arxiv_url = text(entry, "atom:id")
    arxiv_id = re.sub(r"v\d+$", "", arxiv_url.split("/abs/", 1)[-1])
    links = {link.get("title"): link.get("href") for link in entry.findall("atom:link", ATOM)}
    categories = [item.get("term") for item in entry.findall("atom:category", ATOM)]
    primary = entry.find("arxiv:primary_category", ATOM)

    return (
        arxiv_id,
        text(entry, "atom:title"),
        text(authors[0], "atom:name"),
        text(entry, "atom:summary"),
        primary.get("term") if primary is not None else categories[0],
        ",".join(categories),
        text(entry, "atom:published"),
        text(entry, "atom:updated"),
        arxiv_url,
        links.get("pdf", f"https://arxiv.org/pdf/{arxiv_id}"),
    )
