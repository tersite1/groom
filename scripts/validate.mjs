#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['build.mjs'], {
  cwd: root,
  env: { ...process.env, INDEXABLE: 'true' },
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr || result.stdout);

const read = (rel) => readFile(path.join(root, 'dist', rel), 'utf8');
async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}
const site = JSON.parse(await readFile(path.join(root, 'data/site.json'), 'utf8'));
const articles = JSON.parse(await readFile(path.join(root, 'data/articles.json'), 'utf8'));
const index = await read('index.html');
const search = await read('search.html');
const notFound = await read('404.html');
const robots = await read('robots.txt');
const sitemap = await read('sitemap.xml');
const news = await read('sitemap-news.xml');
const searchIndex = JSON.parse(await read('search-index.json'));
const imageSources = articles.map((article) => typeof article.image === 'string' ? article.image : article.image?.src);

assert.equal(site.name, '그룸일보');
assert.equal(new Set(imageSources).size, articles.length, 'every article must have a unique image');
const imageHashes = new Map();
for (const [index, src] of imageSources.entries()) {
  assert.ok(src?.startsWith('/assets/img/'), `article image must be local: ${articles[index].id}`);
  const bytes = await readFile(path.join(root, 'dist', src.slice(1)));
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.ok(!imageHashes.has(hash), `duplicate image content: ${articles[index].id} and ${imageHashes.get(hash)}`);
  imageHashes.set(hash, articles[index].id);
}

assert.match(index, /name="robots" content="index, follow, max-image-preview:large"/);
assert.match(index, /property="og:locale:alternate" content="en_US"/);
assert.match(search, /name="robots" content="noindex, nofollow"/);
assert.match(notFound, /name="robots" content="noindex, nofollow"/);
assert.doesNotMatch(robots, /Crawl-delay/i);
assert.doesNotMatch(robots, /^Disallow:/m, 'noindex pages must remain crawlable so robots meta can be read');
assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
assert.match(robots, /Sitemap: .*\/sitemap-news\.xml/);
const sitemapLocs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
assert.ok(!sitemapLocs.some((loc) => ['/search.html', '/404.html'].includes(new URL(loc).pathname)));
assert.equal(new Set(sitemapLocs).size, sitemapLocs.length, 'sitemap URLs must be unique');
for (const loc of sitemapLocs) {
  const rel = new URL(loc).pathname === '/' ? 'index.html' : new URL(loc).pathname.slice(1);
  const html = await read(rel);
  assert.match(html, /name="robots" content="index, follow, max-image-preview:large"/);
  assert.ok(html.includes(`<link rel="canonical" href="${loc}">`), `${rel} canonical mismatch`);
}

const newsDates = [...news.matchAll(/<news:publication_date>(.*?)<\/news:publication_date>/g)].map((m) => new Date(m[1]));
assert.ok(newsDates.length <= 1000);
const now = Date.now();
for (const date of newsDates) {
  assert.ok(date.getTime() <= now && date.getTime() >= now - 2 * 86400000, 'news sitemap date outside two-day window');
}

for (const article of articles) {
  const html = await read(`article/${article.id}.html`);
  const jsonText = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
  assert.ok(jsonText, `missing JSON-LD: ${article.id}`);
  const json = JSON.parse(jsonText);
  assert.equal(json['@type'], 'NewsArticle');
  assert.equal(json.dateModified, new Date(article.modifiedAt || article.updatedAt || article.publishedAt).toISOString());
  assert.ok(json.author?.name && json.author?.['@type']);
  assert.ok(json.publisher?.logo?.url);
  assert.match(html, /property="article:published_time"/);
  assert.match(html, /property="article:modified_time"/);
  if (article.image) {
    const src = typeof article.image === 'string' ? article.image : article.image.src || article.image.url;
    assert.ok(html.includes(`src="${src}"`), `article image not rendered: ${article.id}`);
    await assert.rejects(access(path.join(root, 'dist', 'assets', 'img', `${article.id}.svg`)));
  }
  if (article.sources?.length) assert.match(html, /자료·출처/);
  assert.ok(sitemapLocs.includes(`${site.url.replace(/\/$/, '')}/article/${article.id}.html`));
  assert.equal(searchIndex.filter((item) => item.id === article.id).length, 1);
  if (article.titleEn || article.summaryEn || article.tagsEn?.length) {
    assert.equal(json.alternativeHeadline, article.titleEn);
    assert.equal(json.abstract, article.summaryEn);
    assert.match(html, /lang="en"/);
    const item = searchIndex.find((candidate) => candidate.id === article.id);
    assert.equal(item.te, article.titleEn);
    assert.equal(item.se, article.summaryEn);
    assert.deepEqual(item.ge, article.tagsEn);
  }
}

for (const section of site.sections.filter((item) => item.indexable === false)) {
  const html = await read(`section/${section.slug}.html`);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.ok(!sitemapLocs.includes(`${site.url.replace(/\/$/, '')}/section/${section.slug}.html`));
}

for (const rel of (await walk(path.join(root, 'dist'))).filter((file) => file.endsWith('.html'))) {
  const html = await read(rel);
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const raw = match[1];
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    const pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
    const target = pathname === '/' ? 'index.html' : pathname.slice(1);
    await access(path.join(root, 'dist', target));
  }
}

assert.match(index, /"NewsMediaOrganization"/);
for (const id of site.home?.pinnedArticleIds || []) {
  assert.ok(index.includes(`/article/${id}.html`), `pinned homepage article missing: ${id}`);
}
const sourcedExpansion = articles.filter((article) => article.id.startsWith('groom'));
assert.ok(sourcedExpansion.length >= 50, 'expected at least 50 externally sourced expansion articles');
assert.equal(
  new Set(sourcedExpansion.map((article) => article.publishedAt.slice(0, 10))).size,
  sourcedExpansion.length,
  'expansion article dates must be unique',
);
const publicationDays = articles.map((article) => article.publishedAt.slice(0, 10));
const uniquePublicationDays = new Set(publicationDays);
assert.ok(
  uniquePublicationDays.size >= Math.ceil(articles.length * 0.8),
  'article publication dates must be distributed across the archive',
);
const publicationSpan = Math.max(...articles.map((article) => new Date(article.publishedAt)))
  - Math.min(...articles.map((article) => new Date(article.publishedAt)));
assert.ok(publicationSpan >= 180 * 86400000, 'article archive must span at least 180 days');
console.log(`SEO 검증 통과: canonical ${sitemapLocs.length}개, 뉴스 ${newsDates.length}개, 기사 ${articles.length}건`);
