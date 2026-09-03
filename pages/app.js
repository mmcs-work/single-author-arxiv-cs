let perPage = 20;
const cache = new Map();
let shown = [];
let currentPage = 1;
let renderVersion = 0;

const categories = {};

const form = document.querySelector("#filters");
const paperList = document.querySelector("#papers");
const status = document.querySelector("#status");
const pagination = document.querySelector("#pagination");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const pageLinks = document.querySelector("#page-links");
const pageNumber = document.querySelector("#page-number");
const pageSize = document.querySelector("#page-size");
const pageJump = document.querySelector("#page-jump");
const pageJumpSubmit = document.querySelector("#page-jump-submit");
const exportJson = document.querySelector("#export-json");
const exportMarkdown = document.querySelector("#export-markdown");
const abstractToggle = document.querySelector("#abstract-toggle");
const rssCategory = document.querySelector("#rss-category");
const rssOpen = document.querySelector("#rss-open");
const rssCopy = document.querySelector("#rss-copy");
const rssToggle = document.querySelector("#rss-toggle");
const rssPanel = document.querySelector("#rss-panel");
const themeToggle = document.querySelector("#theme-toggle");

function url(path) { return new URL(path, document.baseURI).href; }
async function data(path) {
  if (!cache.has(path)) {
    const response = await fetch(url(path));
    if (response.status === 404 && path.startsWith("data/months/")) {
      cache.set(path, Promise.resolve([]));
      return cache.get(path);
    }
    if (!response.ok) throw new Error("Archive data is not available yet.");
    cache.set(path, response.json());
  }
  return cache.get(path);
}
function filters() { return Object.fromEntries(new FormData(form)); }
function setRange(days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  form.elements.start.value = start.toISOString().slice(0, 10);
  form.elements.end.value = end.toISOString().slice(0, 10);
  load();
}
function download(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
}
function markdown(records) {
  return records.map(item => `## ${item.title}\n\n- Author: ${item.author}\n- Date: ${item.published.slice(0, 10)}\n- Category: ${item.primary_category}\n- arXiv: ${item.arxiv_url || `https://arxiv.org/abs/${item.arxiv_id}`}\n\n${item.abstract || ""}`).join("\n\n---\n\n");
}
async function completeRecords() {
  if (shown.every(item => item.abstract && item.updated && item.pdf_url)) return shown;
  const months = [...new Set(shown.map(item => item.published.slice(0, 7)))];
  const full = (await Promise.all(months.map(month => data(`data/months/${month}.json`)))).flat();
  const byId = new Map(full.map(item => [item.arxiv_id, item]));
  return shown.map(item => byId.get(item.arxiv_id) || item);
}
function monthRange(start, end) {
  const first = new Date(`${(start || "1990-01").slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${(end || new Date().toISOString()).slice(0, 7)}-01T00:00:00Z`);
  const months = [];
  for (let date = first; date <= last; date.setUTCMonth(date.getUTCMonth() + 1)) months.push(date.toISOString().slice(0, 7));
  return months;
}
function matches(item, active) {
  return (!active.category || item.primary_category === active.category || item.categories.split(",").includes(active.category))
    && (!active.start || item.published.slice(0, 10) >= active.start)
    && (!active.end || item.published.slice(0, 10) <= active.end);
}
function highlight(element, value) {
  const query = form.elements.query.value.trim().toLowerCase();
  const text = value.toLowerCase();
  const first = query ? text.indexOf(query) : -1;
  if (first < 0) { element.textContent = value; return; }
  const fragment = document.createDocumentFragment();
  let start = 0, index = first;
  while (index >= 0) {
    fragment.append(value.slice(start, index));
    const match = document.createElement("mark"); match.textContent = value.slice(index, index + query.length); fragment.append(match);
    start = index + query.length; index = text.indexOf(query, start);
  }
  fragment.append(value.slice(start)); element.replaceChildren(fragment);
}
function card(item) {
  const article = document.createElement("article");
  const title = document.createElement("a");
  title.href = item.arxiv_url || `https://arxiv.org/abs/${item.arxiv_id}`; title.target = "_blank"; title.rel = "noreferrer"; highlight(title, item.title);
  const meta = document.createElement("p"); meta.className = "meta"; highlight(meta, item.author); meta.append(` · ${item.published.slice(0, 10)} · ${item.primary_category}`);
  const abstract = document.createElement("details"); abstract.className = "abstract";
  const summary = document.createElement("summary"); summary.textContent = "Read abstract";
  const text = document.createElement("p"); text.textContent = item.abstract;
  abstract.append(summary, text);
  article.append(title, meta, abstract);
  return article;
}
function updateAbstractToggle() {
  const abstracts = [...paperList.querySelectorAll(".abstract")];
  abstractToggle.parentElement.hidden = !abstracts.length;
  const expanded = abstracts.length && abstracts.every(abstract => abstract.open);
  abstractToggle.textContent = expanded ? "Collapse all" : "Expand all";
  abstractToggle.setAttribute("aria-label", expanded ? "Collapse all abstracts" : "Expand all abstracts");
}
async function pageRecords(page) {
  if (page.every(item => item.abstract)) return page;
  const months = [...new Set(page.map(item => item.published.slice(0, 7)))];
  const full = (await Promise.all(months.map(month => data(`data/months/${month}.json`)))).flat();
  const byId = new Map(full.map(item => [item.arxiv_id, item]));
  return page.map(item => byId.get(item.arxiv_id) || item);
}
async function render() {
  const version = ++renderVersion;
  const pages = Math.ceil(shown.length / perPage);
  const page = shown.slice((currentPage - 1) * perPage, currentPage * perPage);
  if (page.length) status.textContent = "Loading page…";
  const records = await pageRecords(page);
  if (version !== renderVersion) return;
  paperList.replaceChildren(...records.map(card));
  updateAbstractToggle();
  status.textContent = shown.length ? `${shown.length.toLocaleString()} paper${shown.length === 1 ? "" : "s"}.` : "No papers found.";
  pagination.hidden = !shown.length;
  previous.disabled = currentPage === 1;
  next.disabled = currentPage === pages;
  pageNumber.textContent = `Page ${currentPage} of ${pages}`;
  pageJump.max = pages;
  pageJump.value = currentPage;
  pageLinks.replaceChildren();
  const numbers = [...new Set([1, pages, currentPage - 1, currentPage, currentPage + 1].filter(number => number > 0 && number <= pages))].sort((a, b) => a - b);
  numbers.forEach((number, index) => {
    if (index && number > numbers[index - 1] + 1) pageLinks.append("…");
    const link = document.createElement("button");
    link.type = "button"; link.textContent = number; link.className = number === currentPage ? "current" : "";
    link.setAttribute("aria-label", `Page ${number}`);
    if (number === currentPage) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => { currentPage = number; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    pageLinks.append(link);
  });
}
async function load() {
  const active = filters(), query = active.query.trim().toLowerCase(); currentPage = 1; renderVersion += 1; paperList.replaceChildren(); status.textContent = "Loading archive…"; pagination.hidden = true;
  try {
    let records;
    if (query && (active.start || active.end)) {
      const months = monthRange(active.start, active.end);
      records = (await Promise.all(months.map(month => data(`data/months/${month}.json`)))).flat();
    } else if (query && active.category) {
      records = await data(`data/categories/${active.category}.json`);
    } else if (query) {
      records = await data("data/search.json");
    } else if (active.start || active.end) {
      const months = monthRange(active.start, active.end);
      status.textContent = `Loading ${months.length} monthly archive${months.length === 1 ? "" : "s"}…`;
      records = (await Promise.all(months.map(month => data(`data/months/${month}.json`)))).flat();
    } else if (active.category) {
      records = await data(`data/categories/${active.category}.json`);
    } else {
      records = await data("data/search.json");
    }
    shown = records.filter(item => matches(item, active) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query))).sort((a, b) => b.published.localeCompare(a.published));
    render();
  } catch (error) { status.textContent = error.message; }
}
form.addEventListener("submit", event => { event.preventDefault(); load(); });
form.elements.query.addEventListener("input", () => { if (!form.elements.query.value) load(); });
previous.addEventListener("click", () => { currentPage -= 1; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
next.addEventListener("click", () => { currentPage += 1; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
pageSize.addEventListener("change", () => { perPage = Number(pageSize.value); currentPage = 1; render(); });
function jumpToPage() {
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  currentPage = Math.min(pages, Math.max(1, Number(pageJump.value) || 1));
  render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
pageJumpSubmit.addEventListener("click", jumpToPage);
pageJump.addEventListener("keydown", event => { if (event.key === "Enter") jumpToPage(); });
abstractToggle.addEventListener("click", () => {
  const abstracts = [...paperList.querySelectorAll(".abstract")];
  const expand = abstracts.some(abstract => !abstract.open);
  abstracts.forEach(abstract => { abstract.open = expand; });
  updateAbstractToggle();
});
exportJson.addEventListener("click", async () => download("one-author-results.json", JSON.stringify(await completeRecords(), null, 2), "application/json"));
exportMarkdown.addEventListener("click", async () => download("one-author-results.md", markdown(await completeRecords()), "text/markdown"));
document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => setRange(Number(button.dataset.range))));
rssCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(url(rssOpen.getAttribute("href")));
    rssCopy.textContent = "Copied";
    setTimeout(() => { rssCopy.textContent = "Copy link"; }, 1600);
  } catch {
    rssCopy.textContent = "Open to copy";
  }
});
rssToggle.addEventListener("click", () => {
  rssPanel.open = true;
  rssPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
themeToggle.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "" : "dark";
  localStorage.setItem("theme", dark ? "light" : "dark");
  themeToggle.textContent = dark ? "☾" : "☀";
  themeToggle.setAttribute("aria-label", dark ? "Use dark theme" : "Use light theme");
});
if (savedTheme === "dark") { themeToggle.textContent = "☀"; themeToggle.setAttribute("aria-label", "Use light theme"); }
async function initialize() {
  try {
    Object.assign(categories, (await data("data/manifest.json")).categories || {});
    for (const [code, name] of Object.entries(categories)) {
      form.elements.category.add(new Option(`${code} — ${name}`, code));
      rssCategory.add(new Option(`${code} — ${name}`, code));
    }
    rssCategory.addEventListener("change", () => {
      rssOpen.href = rssCategory.value ? `feeds/${rssCategory.value}.xml` : "feed.xml";
    });
    setRange(7);
  } catch (error) { status.textContent = error.message; }
}
initialize();
