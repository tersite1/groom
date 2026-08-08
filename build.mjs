#!/usr/bin/env node
/**
 * 카이일보 정적 사이트 빌더
 *
 * data/site.json + data/articles.json -> dist/
 *   - 홈, 섹션 목록, 기사 본문, 검색, 404
 *   - sitemap.xml, sitemap-news.xml, rss.xml, robots.txt, search-index.json
 *
 * 실행: npm run build
 */

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

const site = JSON.parse(await readFile(path.join(ROOT, 'data/site.json'), 'utf8'));
const articles = JSON.parse(await readFile(path.join(ROOT, 'data/articles.json'), 'utf8'));
const INDEXABLE = process.env.INDEXABLE == null
  ? site.indexable === true
  : process.env.INDEXABLE === 'true';

/* ------------------------------------------------------------------ 유틸 */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attr = (s = '') => esc(s).replace(/'/g, '&#39;');

/** 문자열 -> 안정적인 정수 시드 */
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const sectionBySlug = new Map(site.sections.map((s) => [s.slug, s]));
const sectionOf = (a) => sectionBySlug.get(a.section) ?? { slug: a.section, name: a.section, hue: 210 };

const byDateDesc = (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt);
const has = (a, flag) => Array.isArray(a.flags) && a.flags.includes(flag);

const sorted = [...articles].sort(byDateDesc);
const latestDate = new Date(sorted[0].publishedAt);

const KST = 'Asia/Seoul';

const kstFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const kstWeekday = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, weekday: 'short' });

function kstParts(d) {
  return Object.fromEntries(kstFormat.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
}

function fmtDate(d) {
  const p = kstParts(d);
  return `${p.year}년 ${Number(p.month)}월 ${Number(p.day)}일 (${kstWeekday.format(new Date(d))})`;
}

function fmtDateTime(d) {
  const p = kstParts(d);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

function isoDate(d) {
  return new Date(d).toISOString();
}

/** 창간일 기준 발행 호수 */
function issueNumber(d) {
  const start = new Date(`${site.founded}T00:00:00+09:00`);
  const days = Math.floor((new Date(d) - start) / 86400000);
  return Math.max(1, days + 1);
}

const url = (p) => `${site.url.replace(/\/$/, '')}${p}`;
const absoluteUrl = (p) => /^https?:\/\//i.test(p) ? p : url(p.startsWith('/') ? p : `/${p}`);
const articlePath = (a) => `/article/${a.id}.html`;
const sectionPath = (s) => `/section/${s.slug}.html`;
const subsectionId = (s, index) => `${s.slug}-topic-${index + 1}`;

/* ------------------------------------------------- 플레이스홀더 일러스트 */

/**
 * 기사별 추상 도형 이미지를 생성한다.
 * 사진이 아님을 분명히 하려고 의도적으로 기하학 패턴만 사용한다.
 */
function placeholder(a, w = 1200, h = 800) {
  const sec = sectionOf(a);
  const s = seed(a.id);
  // 블루 계열로 통일하고 섹션별로 색조만 미세하게 움직인다.
  const base = 208 + ((sec.hue % 7) - 3) * 4;
  const l1 = 22 + (s % 10);
  const l2 = 58 + (s % 17);
  const rot = (s % 4) * 90;
  const variant = s % 4;

  const c1 = `hsl(${base} 68% ${l1}%)`;
  const c2 = `hsl(${base - 12} 74% ${l2}%)`;
  const c3 = `hsl(${base + 14} 82% ${Math.min(88, l2 + 18)}%)`;

  let shapes = '';
  if (variant === 0) {
    shapes = `
      <circle cx="${w * 0.72}" cy="${h * 0.34}" r="${h * 0.42}" fill="${c2}" opacity=".85"/>
      <circle cx="${w * 0.3}" cy="${h * 0.74}" r="${h * 0.3}" fill="${c3}" opacity=".55"/>`;
  } else if (variant === 1) {
    shapes = `
      <rect x="${w * 0.08}" y="${h * 0.16}" width="${w * 0.42}" height="${h * 0.68}" fill="${c2}" opacity=".9"/>
      <rect x="${w * 0.56}" y="${h * 0.34}" width="${w * 0.36}" height="${h * 0.5}" fill="${c3}" opacity=".6"/>`;
  } else if (variant === 2) {
    shapes = `
      <path d="M0 ${h} L${w * 0.5} ${h * 0.18} L${w} ${h} Z" fill="${c2}" opacity=".9"/>
      <path d="M${w * 0.35} ${h} L${w * 0.78} ${h * 0.42} L${w} ${h * 0.9} Z" fill="${c3}" opacity=".6"/>`;
  } else {
    shapes = `
      <g transform="rotate(${rot} ${w / 2} ${h / 2})">
        <rect x="${w * 0.1}" y="${h * 0.42}" width="${w * 0.8}" height="${h * 0.16}" fill="${c2}"/>
        <rect x="${w * 0.1}" y="${h * 0.64}" width="${w * 0.52}" height="${h * 0.16}" fill="${c3}" opacity=".7"/>
        <circle cx="${w * 0.24}" cy="${h * 0.26}" r="${h * 0.13}" fill="${c3}" opacity=".8"/>
      </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${attr(sec.name)} 기사 이미지 자리">
  <rect width="${w}" height="${h}" fill="${c1}"/>
  ${shapes}
  <!-- 카드마다 표시 비율이 달라(3:2, 1:1, 4:5, 16:9) 텍스트를 넣으면 object-fit: cover 에 잘린다.
       편집 이미지라는 표기는 기사 본문의 figcaption 과 푸터 고지가 담당한다. -->
</svg>`;
}

function imageData(a) {
  const value = a.image;
  if (typeof value === 'string') return { src: value };
  if (value && typeof value === 'object' && (value.src || value.url)) return { ...value, src: value.src || value.url };
  return { src: `/assets/img/${a.id}.svg` };
}

const imgPath = (a) => imageData(a).src;
const publisherLogo = () => {
  const configured = typeof site.logo === 'object' ? site.logo.src || site.logo.url : site.logo;
  return absoluteUrl(configured || '/assets/img/og-default.svg');
};

function authorData(a) {
  if (a.author && typeof a.author === 'object') return a.author;
  const authorKey = a.authorId || (typeof a.author === 'string' ? a.author : a.reporter);
  const configured = Array.isArray(site.authors)
    ? site.authors.find((x) => x.name === a.reporter || x.id === authorKey)
    : site.authors?.[authorKey];
  return configured || { name: a.reporter };
}

function authorLabel(a) {
  const author = authorData(a);
  const type = author.type || author['@type'] || 'Person';
  return `${author.name || a.reporter}${type === 'Organization' ? '' : ' 기자'}`;
}

/* ------------------------------------------------------------- 레이아웃 */

function head({ title, description, canonical, image, imageAlt, type = 'website', extraJsonLd, keywords, articleTags, indexable = true, publishedAt, modifiedAt, articleAuthor, articleSection }) {
  const fullTitle = title === site.name ? (site.seoTitle || `${site.name} — ${site.tagline}`) : `${title} - ${site.name}`;
  const desc = description || site.description;
  const img = absoluteUrl(image || '/assets/img/og-default.svg');
  const keywordList = [...new Set([...(keywords || site.keywords), ...(site.keywordsEn || [])])];
  const articleTagList = [...new Set(articleTags || [])];
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(desc)}">
<meta name="keywords" content="${attr(keywordList.join(','))}">
<meta name="author" content="${attr(articleAuthor || site.name)}">
<meta name="robots" content="${INDEXABLE && indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">
<link rel="canonical" href="${attr(url(canonical))}">
<meta property="og:locale" content="${attr(site.locale)}">
<meta property="og:locale:alternate" content="en_US">
<meta property="og:site_name" content="${attr(site.name)}">
<meta property="og:type" content="${attr(type)}">
<meta property="og:url" content="${attr(url(canonical))}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:image" content="${attr(img)}">
${imageAlt ? `<meta property="og:image:alt" content="${attr(imageAlt)}">` : ''}
${type === 'article' && publishedAt ? `<meta property="article:published_time" content="${attr(isoDate(publishedAt))}">` : ''}
${type === 'article' && modifiedAt ? `<meta property="article:modified_time" content="${attr(isoDate(modifiedAt))}">` : ''}
${type === 'article' && articleAuthor ? `<meta property="article:author" content="${attr(articleAuthor)}">` : ''}
${type === 'article' && articleSection ? `<meta property="article:section" content="${attr(articleSection)}">` : ''}
${type === 'article' ? articleTagList.map((keyword) => `<meta property="article:tag" content="${attr(keyword)}">`).join('\n') : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(fullTitle)}">
<meta name="twitter:description" content="${attr(desc)}">
<meta name="twitter:image" content="${attr(img)}">
${imageAlt ? `<meta name="twitter:image:alt" content="${attr(imageAlt)}">` : ''}
<meta name="theme-color" content="#0A4DA6">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml" sizes="any">
<link rel="alternate" type="application/rss+xml" title="${attr(site.name)} RSS" href="/rss.xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&display=swap">
<link rel="stylesheet" href="/assets/css/style.css">
${extraJsonLd ? `<script type="application/ld+json">${JSON.stringify(extraJsonLd)}</script>` : ''}`;
}

function nameplate(dateForIssue) {
  const d = dateForIssue || latestDate;
  return `<div class="nameplate">
  <div class="wrap nameplate__inner">
    <a class="brand" href="/" aria-label="${attr(site.name)} 홈">
      <span class="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" width="40" height="40"><rect width="40" height="40" rx="5" fill="currentColor"/><path d="M11 12h18v4.6H15.8v6.8H25v-3.1h-5.4v-4.4H29V28H11z" fill="#fff"/></svg>
      </span>
      <span class="brand__text">
        <strong class="brand__name">${esc(site.name)}</strong>
        <span class="brand__tagline">${esc(site.tagline)}</span>
      </span>
    </a>
    <dl class="issue">
      <div class="issue__row"><dt>발행</dt><dd><time datetime="${attr(isoDate(d))}">${esc(fmtDate(d))}</time></dd></div>
      <div class="issue__row"><dt>호수</dt><dd>제 ${issueNumber(d).toLocaleString('ko-KR')} 호</dd></div>
    </dl>
    <form class="topsearch" action="/search.html" method="get" role="search">
      <label class="sr-only" for="q">기사 검색</label>
      <input type="search" id="q" name="q" placeholder="검색어를 입력하세요" autocomplete="off">
      <button type="submit">검색</button>
    </form>
  </div>
</div>`;
}

function gnb(active) {
  const items = site.sections
    .map(
      (s) =>
        `<li><a href="${sectionPath(s)}"${s.slug === active ? ' aria-current="page"' : ''}>${esc(s.name)}</a></li>`
    )
    .join('');
  return `<nav class="gnb" aria-label="섹션 메뉴">
  <div class="wrap gnb__inner">
    <ul class="gnb__list">${items}</ul>
    <a class="gnb__rss" href="/rss.xml">RSS</a>
  </div>
</nav>`;
}

/** 설정에 실제 원고가 있을 때만 신뢰·편집 정책 페이지를 만든다. */
function infoPages() {
  const candidates = [
    ['about', '회사 소개'],
    ['editorialPolicy', '편집 원칙'],
    ['corrections', '정정·반론 정책'],
  ];
  return candidates.flatMap(([key, fallbackTitle]) => {
    const value = site[key];
    if (!value) return [];
    const content = typeof value === 'string' ? value : value.content || value.body;
    if (!content || (Array.isArray(content) && !content.length)) return [];
    return [{
      slug: key === 'editorialPolicy' ? 'editorial-policy' : key,
      title: typeof value === 'object' && value.title ? value.title : fallbackTitle,
      description: typeof value === 'object' && value.description ? value.description : `${site.name} ${fallbackTitle}`,
      content: Array.isArray(content) ? content : [content],
      modifiedAt: typeof value === 'object' ? value.modifiedAt : undefined,
    }];
  });
}

function footer() {
  const cols = site.sections
    .map(
      (s) => `<div class="sitemap__col">
      <h3 class="sitemap__head"><a href="${sectionPath(s)}">${esc(s.name)}</a></h3>
      <ul class="sitemap__list">${s.children.map((c, index) => `<li><a href="${sectionPath(s)}#${subsectionId(s, index)}">${esc(c)}</a></li>`).join('')}</ul>
    </div>`
    )
    .join('');

  const m = site.masthead;
  const info = Object.entries(m)
    .map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`)
    .join('');

  const policyLinks = infoPages()
    .map((p) => `<a href="/${p.slug}.html">${esc(p.title)}</a>`)
    .join(' · ');

  return `<footer class="site-footer">
  <div class="wrap">
    <nav class="sitemap" aria-label="전체 메뉴">${cols}</nav>
    <div class="colophon">
      <a class="colophon__brand" href="/">${esc(site.name)}</a>
      ${policyLinks ? `<nav class="colophon__policies" aria-label="언론사 안내">${policyLinks}</nav>` : ''}
      <div class="colophon__info">${info}</div>
      <p class="colophon__notice">${esc(site.demoNotice)}</p>
      <p class="colophon__copy">© ${new Date(latestDate).getFullYear()} ${esc(site.publisher)}. ${esc(site.copyrightNotice || '원문 출처와 편집 원칙에 따라 콘텐츠를 제공합니다.')}</p>
    </div>
  </div>
</footer>`;
}

function page({ title, description, canonical, image, imageAlt, type, extraJsonLd, keywords, articleTags, active, body, bodyClass = '', indexable = true, publishedAt, modifiedAt, articleAuthor, articleSection }) {
  return `<!DOCTYPE html>
<html lang="${attr(site.language)}">
<head>
${head({ title, description, canonical, image, imageAlt, type, extraJsonLd, keywords, articleTags, indexable, publishedAt, modifiedAt, articleAuthor, articleSection })}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">본문 바로가기</a>
<header class="site-header">
${nameplate()}
${gnb(active)}
</header>
<main id="main">
${body}
</main>
${footer()}
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

/* ------------------------------------------------------------- 카드 조각 */

/**
 * 카드 전체가 하나의 <a>로 감싸이므로 여기서는 링크를 만들지 않는다.
 * 앵커 중첩은 허용되지 않아 파서가 바깥 링크를 조기에 닫아버린다.
 */
function kicker(a) {
  const sec = sectionOf(a);
  return `<span class="kicker">${esc(sec.name)}${a.sub ? `<span class="kicker__sub">${esc(a.sub)}</span>` : ''}</span>`;
}

function timeTag(a, cls = 'byline__time') {
  return `<time class="${cls}" datetime="${attr(isoDate(a.publishedAt))}">${esc(fmtDateTime(a.publishedAt))}</time>`;
}

function cardLead(a) {
  return `<article class="lead">
  <a class="lead__link" href="${articlePath(a)}">
    <figure class="lead__figure">
      <img src="${imgPath(a)}" alt="" width="1200" height="800" fetchpriority="high">
    </figure>
    <div class="lead__body">
      ${kicker(a)}
      <h2 class="lead__title">${esc(a.title)}</h2>
      <p class="lead__summary">${esc(a.summary)}</p>
      <p class="byline"><span class="byline__name">${esc(authorLabel(a))}</span>${timeTag(a)}</p>
    </div>
  </a>
</article>`;
}

function cardHeadline(a) {
  return `<article class="hl">
  <a class="hl__link" href="${articlePath(a)}">
    <img class="hl__thumb" src="${imgPath(a)}" alt="" width="1200" height="800" loading="lazy">
    <div class="hl__body">
      ${kicker(a)}
      <h3 class="hl__title">${esc(a.title)}</h3>
    </div>
  </a>
</article>`;
}

function cardStandard(a, { summary = true } = {}) {
  return `<article class="card">
  <a class="card__link" href="${articlePath(a)}">
    <figure class="card__figure"><img src="${imgPath(a)}" alt="" width="1200" height="800" loading="lazy"></figure>
    <div class="card__body">
      ${kicker(a)}
      <h3 class="card__title">${esc(a.title)}</h3>
      ${summary ? `<p class="card__summary">${esc(a.summary)}</p>` : ''}
      <p class="byline"><span class="byline__name">${esc(authorLabel(a))}</span>${timeTag(a)}</p>
    </div>
  </a>
</article>`;
}

function cardOriginal(a) {
  return `<article class="orig">
  <a class="orig__link" href="${articlePath(a)}">
    <figure class="orig__figure"><img src="${imgPath(a)}" alt="" width="1200" height="800" loading="lazy"></figure>
    ${kicker(a)}
    <h3 class="orig__title">${esc(a.title)}</h3>
    <p class="orig__summary">${esc(a.summary)}</p>
  </a>
</article>`;
}

function cardRanked(a, i) {
  return `<li class="rank__item">
  <a class="rank__link" href="${articlePath(a)}">
    <span class="rank__num" aria-hidden="true">${i + 1}</span>
    <span class="sr-only">${i + 1}위</span>
    <span class="rank__body">
      <span class="rank__title">${esc(a.title)}</span>
      <span class="rank__meta">${esc(sectionOf(a).name)}</span>
    </span>
  </a>
</li>`;
}

function cardOpinion(a) {
  return `<article class="op">
  <a class="op__link" href="${articlePath(a)}">
    <span class="op__cat">${esc(a.sub)}</span>
    <h3 class="op__title">${esc(a.title)}</h3>
    <span class="op__name">${esc(authorLabel(a))}</span>
  </a>
</article>`;
}

function cardMedia(a) {
  return `<article class="media">
  <a class="media__link" href="${articlePath(a)}">
    <figure class="media__figure"><img src="${imgPath(a)}" alt="" width="1200" height="800" loading="lazy"></figure>
    <h3 class="media__title">${esc(a.title)}</h3>
  </a>
</article>`;
}

function blockHead(title, moreHref, moreLabel = '전체보기') {
  return `<div class="block__head">
  <h2 class="block__title">${esc(title)}</h2>
  ${moreHref ? `<a class="block__more" href="${moreHref}">${esc(moreLabel)}</a>` : ''}
</div>`;
}

/* ----------------------------------------------------------------- 홈 */

function renderHome() {
  const home = site.home || {};
  const used = new Set();
  const take = (list, n) => {
    const out = [];
    for (const a of list) {
      if (out.length >= n) break;
      if (used.has(a.id)) continue;
      used.add(a.id);
      out.push(a);
    }
    return out;
  };

  const lead = take(sorted.filter((a) => has(a, 'lead')), 1)[0] ?? sorted[0];
  const pinnedHeadlines = (home.pinnedArticleIds || [])
    .map((id) => articles.find((article) => article.id === id))
    .filter(Boolean);
  const headlines = take([...pinnedHeadlines, ...sorted.filter((a) => has(a, 'headline'))], 4);
  const briefs = take(sorted.filter((a) => has(a, 'brief')), 3);
  const originals = sorted.filter((a) => has(a, 'original')).slice(0, 6);
  const popular = sorted.filter((a) => has(a, 'popular')).slice(0, 8);
  const opinions = sorted.filter((a) => has(a, 'opinion')).slice(0, 4);
  const medias = sorted.filter((a) => has(a, 'media')).slice(0, 4);
  const featureSection = sectionBySlug.get(home.featureSection || 'local');
  const features = featureSection ? sorted.filter((a) => a.section === featureSection.slug).slice(0, 4) : [];

  const secCols = (home.columns || ['economy', 'industry', 'society']).map((slug) => {
    const s = sectionBySlug.get(slug);
    const list = sorted.filter((a) => a.section === slug).slice(0, 4);
    if (!list.length) return '';
    return `<div class="seccol">
      <h3 class="seccol__head"><a href="${sectionPath(s)}">${esc(s.name)}</a></h3>
      ${cardStandard(list[0], { summary: false })}
      <ul class="seccol__list">${list.slice(1).map((a) => `<li><a href="${articlePath(a)}">${esc(a.title)}</a></li>`).join('')}</ul>
    </div>`;
  }).join('');

  const body = `
<section class="block front" aria-label="1면">
  <div class="wrap front__inner">
    ${cardLead(lead)}
    <div class="front__side">
      <h2 class="sr-only">주요 기사</h2>
      ${headlines.map(cardHeadline).join('')}
    </div>
  </div>
</section>

<section class="block brief-block">
  <div class="wrap">
    ${blockHead('오늘의 브리핑')}
    <div class="grid-3">${briefs.map((a) => cardStandard(a)).join('')}</div>
  </div>
</section>

<section class="block original-block">
  <div class="wrap">
    <div class="block__head block__head--invert">
      <h2 class="block__title">${esc(home.originalTitle || '그룸 오리지널')}</h2>
      <span class="block__note">${esc(home.originalNote || '시간을 들여 확인한 기사')}</span>
    </div>
    <div class="orig__rail">${originals.map(cardOriginal).join('')}</div>
  </div>
</section>

<section class="block">
  <div class="wrap split">
    <div class="split__main">
      ${blockHead('많이 본 기사')}
      <ol class="rank">${popular.map(cardRanked).join('')}</ol>
    </div>
    <aside class="split__side">
      ${blockHead(home.analysisTitle || '오피니언', sectionBySlug.get(home.analysisSection || 'opinion') ? sectionPath(sectionBySlug.get(home.analysisSection || 'opinion')) : null)}
      <div class="op__list">${opinions.map(cardOpinion).join('')}</div>
    </aside>
  </div>
</section>

<section class="block band">
  <div class="wrap">
    ${blockHead('섹션별 최신')}
    <div class="grid-3">${secCols}</div>
  </div>
</section>

<section class="block">
  <div class="wrap">
    ${blockHead(home.mediaTitle || '포토·영상', sectionBySlug.get(home.mediaSection || 'photo') ? sectionPath(sectionBySlug.get(home.mediaSection || 'photo')) : null)}
    <div class="grid-4">${medias.map(cardMedia).join('')}</div>
  </div>
</section>

<section class="block">
  <div class="wrap">
    ${blockHead(home.featureTitle || '전국', featureSection ? sectionPath(featureSection) : null)}
    <div class="grid-4">${features.map((a) => cardStandard(a, { summary: false })).join('')}</div>
  </div>
</section>`;

  const alternateNames = [...new Set([site.nameEn, new URL(site.url).hostname].filter(Boolean))];

  return page({
    title: site.name,
    description: site.description,
    canonical: '/',
    active: null,
    body,
    bodyClass: 'is-home',
    extraJsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsMediaOrganization',
          '@id': `${site.url.replace(/\/$/, '')}/#organization`,
          name: site.publisher || site.name,
          ...(alternateNames.length ? { alternateName: alternateNames } : {}),
          url: url('/'),
          logo: { '@type': 'ImageObject', url: publisherLogo(), width: 512, height: 512 },
          ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
        },
        {
          '@type': 'WebSite',
          '@id': `${site.url.replace(/\/$/, '')}/#website`,
          name: site.name,
          ...(alternateNames.length ? { alternateName: alternateNames } : {}),
          url: url('/'),
          description: site.description,
          ...(site.descriptionEn ? { abstract: site.descriptionEn } : {}),
          inLanguage: site.language,
          publisher: { '@id': `${site.url.replace(/\/$/, '')}/#organization` },
          potentialAction: {
            '@type': 'SearchAction',
            target: `${site.url.replace(/\/$/, '')}/search.html?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
      ],
    },
  });
}

/* ------------------------------------------------------------ 섹션 목록 */

function renderSection(s) {
  const list = sorted.filter((a) => a.section === s.slug);
  const [top, ...rest] = list;

  const body = `
<section class="block sec-hero">
  <div class="wrap">
    <nav class="crumb" aria-label="현재 위치"><a href="/">홈</a><span aria-hidden="true">›</span><span>${esc(s.name)}</span></nav>
    <h1 class="sec-title">${esc(s.name)}</h1>
    ${s.nameEn ? `<p class="sec-title-en" lang="en">${esc(s.nameEn)}</p>` : ''}
    <ul class="sec-subs">${s.children.map((c, index) => `<li id="${subsectionId(s, index)}">${esc(c)}</li>`).join('')}</ul>
  </div>
</section>
${top ? `<section class="block"><div class="wrap">${cardLead(top)}</div></section>` : ''}
<section class="block">
  <div class="wrap">
    ${rest.length ? `<div class="grid-3">${rest.map((a) => cardStandard(a)).join('')}</div>` : '<p class="empty">등록된 기사가 없습니다.</p>'}
  </div>
</section>`;

  return page({
    title: s.name,
    description: `${site.name} ${s.name} 기사 목록.`,
    canonical: sectionPath(s),
    active: s.slug,
    keywords: [s.name, ...(s.nameEn ? [s.nameEn] : []), ...s.children, ...(s.childrenEn || [])],
    body,
    indexable: s.indexable !== false,
    extraJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${s.name} - ${site.name}`,
      ...(s.nameEn ? { alternateName: `${s.nameEn} - ${site.nameEn || site.name}` } : {}),
      url: url(sectionPath(s)),
      inLanguage: site.language,
    },
  });
}

/* ------------------------------------------------------------ 기사 본문 */

function renderArticle(a) {
  const sec = sectionOf(a);
  const image = imageData(a);
  const author = authorData(a);
  const modifiedAt = a.modifiedAt || a.updatedAt;
  const sources = Array.isArray(a.sources) ? a.sources : [];
  const articleTags = [...new Set([...(a.tags ?? []), ...(a.tagsEn ?? [])])];
  const seriesArticles = a.series
    ? articles
      .filter((item) => item.series === a.series)
      .sort((left, right) => new Date(left.publishedAt) - new Date(right.publishedAt))
    : [];
  const seriesTitle = a.series === 'philip-conference' ? '컨퍼런스 활동 연대표' : '관련 연재';
  // 같은 섹션·태그를 우선 배치하고, 4건이 안 되면 최신 기사로 채운다.
  const picked = new Map();
  for (const x of sorted) {
    if (x.id === a.id) continue;
    if (x.section === a.section || x.tags?.some((t) => a.tags?.includes(t))) picked.set(x.id, x);
    if (picked.size >= 4) break;
  }
  for (const x of sorted) {
    if (picked.size >= 4) break;
    if (x.id !== a.id) picked.set(x.id, x);
  }
  const related = [...picked.values()];

  const body = `
<article class="art">
  <div class="wrap art__wrap">
    <header class="art__head">
      <nav class="crumb" aria-label="현재 위치">
        <a href="/">홈</a><span aria-hidden="true">›</span>
        <a href="${sectionPath(sec)}">${esc(sec.name)}</a>
        ${a.sub ? `<span aria-hidden="true">›</span><span>${esc(a.sub)}</span>` : ''}
      </nav>
      <h1 class="art__title">${esc(a.title)}</h1>
      <p class="art__summary">${esc(a.summary)}</p>
      ${a.titleEn ? `<p class="art__title-en" lang="en">${esc(a.titleEn)}</p>` : ''}
      ${a.summaryEn ? `<p class="art__summary-en" lang="en">${esc(a.summaryEn)}</p>` : ''}
      <div class="art__meta">
        <span class="art__reporter">${esc(authorLabel(a))}</span>
        <span class="art__dot" aria-hidden="true">·</span>
        <time datetime="${attr(isoDate(a.publishedAt))}">입력 ${esc(fmtDateTime(a.publishedAt))}</time>
        ${modifiedAt ? `<span class="art__dot" aria-hidden="true">·</span><time datetime="${attr(isoDate(modifiedAt))}">수정 ${esc(fmtDateTime(modifiedAt))}</time>` : ''}
      </div>
    </header>

    <figure class="art__figure${image.fit === 'contain' ? ' art__figure--contain' : ''}">
      <img src="${attr(imgPath(a))}" alt="${attr(image.alt || a.imageAlt || a.alt || '')}" width="${attr(image.width || 1200)}" height="${attr(image.height || 800)}">
      ${(image.caption || a.imageCaption || a.caption || image.credit || a.imageCredit || a.credit || !a.image) ? `<figcaption>${esc(image.caption || a.imageCaption || a.caption || (!a.image ? '기사 내용과 직접 관련 없는 이미지 자리입니다.' : ''))}${image.credit || a.imageCredit || a.credit ? `${image.caption || a.imageCaption || a.caption ? ' · ' : ''}${esc(image.credit || a.imageCredit || a.credit)}` : ''}</figcaption>` : ''}
    </figure>

    <div class="art__body">
      ${a.body.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
    </div>

    ${a.keyQuote ? `<blockquote class="art__keyquote">${esc(a.keyQuote)}</blockquote>` : ''}

    ${seriesArticles.length > 1 ? `<aside class="art__timeline" aria-labelledby="article-timeline"><h2 id="article-timeline">${esc(seriesTitle)}</h2><ol>${seriesArticles.map((item) => `<li${item.id === a.id ? ' aria-current="page"' : ''}><a href="${articlePath(item)}"><strong>${esc(item.timelineLabel || fmtDate(item.publishedAt))}</strong><span>${esc(item.timelineSummary || item.title)}</span></a></li>`).join('')}</ol></aside>` : ''}

    ${sources.length ? `<aside class="art__sources" aria-labelledby="article-sources"><h2 id="article-sources">자료·출처</h2><ul>${sources.map((source) => {
      const item = typeof source === 'string' ? { url: source, title: source } : source;
      const href = item.url || item.href;
      if (!href) return `<li>${esc(item.title || item.name || item.label || '')}</li>`;
      return `<li><a href="${attr(href)}" rel="noopener noreferrer">${esc(item.title || item.name || item.label || href)}</a>${item.publisher ? ` — ${esc(item.publisher)}` : ''}</li>`;
    }).join('')}</ul></aside>` : ''}

    ${a.tags?.length ? `<ul class="art__tags">${a.tags.map((t) => `<li><a href="/search.html?q=${encodeURIComponent(t)}">#${esc(t)}</a></li>`).join('')}</ul>` : ''}

    <p class="art__notice">${esc(a.disclaimer || site.demoNotice)}</p>
  </div>
</article>

${related.length ? `<section class="block band">
  <div class="wrap">
    ${blockHead('관련 기사')}
    <div class="grid-4">${related.map((r) => cardStandard(r, { summary: false })).join('')}</div>
  </div>
</section>` : ''}`;

  return page({
    title: a.title,
    description: a.summary,
    canonical: articlePath(a),
    image: imgPath(a),
    imageAlt: image.alt || a.imageAlt || a.alt,
    type: 'article',
    keywords: [...articleTags, sec.name, ...(sec.nameEn ? [sec.nameEn] : [])],
    articleTags,
    publishedAt: a.publishedAt,
    modifiedAt: modifiedAt || a.publishedAt,
    articleAuthor: author.name || a.reporter,
    articleSection: sec.name,
    active: sec.slug,
    body,
    bodyClass: 'is-article',
    extraJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: a.title,
      ...(a.titleEn ? { alternativeHeadline: a.titleEn } : {}),
      description: a.summary,
      ...(a.summaryEn ? { abstract: a.summaryEn } : {}),
      inLanguage: site.language,
      datePublished: isoDate(a.publishedAt),
      dateModified: isoDate(modifiedAt || a.publishedAt),
      articleSection: sec.name,
      keywords: articleTags.join(', '),
      mainEntityOfPage: { '@type': 'WebPage', '@id': url(articlePath(a)) },
      image: [absoluteUrl(imgPath(a))],
      author: {
        '@type': author.type || author['@type'] || 'Person',
        name: author.name || a.reporter,
        ...(author.url ? { url: absoluteUrl(author.url) } : {}),
      },
      publisher: {
        '@type': 'NewsMediaOrganization',
        '@id': `${site.url.replace(/\/$/, '')}/#organization`,
        name: site.publisher || site.name,
        url: url('/'),
        logo: { '@type': 'ImageObject', url: publisherLogo(), width: 512, height: 512 },
      },
      ...(sources.length ? { citation: sources.map((source) => typeof source === 'string' ? source : source.url || source.href).filter(Boolean) } : {}),
    },
  });
}

/* --------------------------------------------------------------- 검색 */

function renderSearch() {
  const body = `
<section class="block">
  <div class="wrap search">
    <h1 class="sec-title">검색</h1>
    <form class="search__form" role="search" onsubmit="return false;">
      <label class="sr-only" for="sq">검색어</label>
      <input type="search" id="sq" name="q" placeholder="제목·요약·태그에서 찾기" autocomplete="off">
    </form>
    <p class="search__status" id="search-status" role="status">검색어를 입력하세요.</p>
    <div class="grid-3" id="search-results"></div>
  </div>
</section>`;
  return page({
    title: '검색',
    description: `${site.name} 기사 검색.`,
    canonical: '/search.html',
    active: null,
    body,
    bodyClass: 'is-search',
    indexable: false,
  });
}

function render404() {
  const body = `
<section class="block">
  <div class="wrap notfound">
    <p class="notfound__code">404</p>
    <h1 class="sec-title">요청하신 페이지를 찾을 수 없습니다</h1>
    <p class="notfound__desc">주소가 바뀌었거나 삭제된 기사일 수 있습니다.</p>
    <p><a class="btn" href="/">홈으로 이동</a></p>
  </div>
</section>`;
  return page({ title: '페이지를 찾을 수 없습니다', canonical: '/404.html', active: null, body, indexable: false });
}

function renderInfoPage(info) {
  const body = `<article class="art"><div class="wrap art__wrap">
    <header class="art__head"><nav class="crumb" aria-label="현재 위치"><a href="/">홈</a><span aria-hidden="true">›</span><span>${esc(info.title)}</span></nav><h1 class="art__title">${esc(info.title)}</h1></header>
    <div class="art__body">${info.content.map((p) => `<p>${esc(p)}</p>`).join('\n')}</div>
  </div></article>`;
  return page({ title: info.title, description: info.description, canonical: `/${info.slug}.html`, body });
}

/* ---------------------------------------------------- robots / sitemap */

/**
 * 비공개 빌드에서는 전체 색인을 차단한다.
 * 운영 설정 또는 INDEXABLE=true 빌드에서는 공개 기사만 색인한다.
 */
function robotsTxt() {
  if (!INDEXABLE) {
    return `# ${site.name}
# 비공개 검수용 빌드입니다.
# 검색엔진 및 AI 크롤러의 접근을 전면 차단합니다.

User-agent: *
Disallow: /

Sitemap: ${url('/sitemap.xml')}
Sitemap: ${url('/sitemap-news.xml')}
`;
  }
  return `# ${site.name}
User-agent: *
Allow: /

Sitemap: ${url('/sitemap.xml')}
Sitemap: ${url('/sitemap-news.xml')}
`;
}

function sitemapXml() {
  if (!INDEXABLE) return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`;
  const entries = [
    { loc: url('/'), lastmod: isoDate(latestDate), changefreq: 'hourly', priority: '1.0' },
    ...site.sections.filter((s) => s.indexable !== false).map((s) => {
      const list = sorted.filter((a) => a.section === s.slug);
      return {
        loc: url(sectionPath(s)),
        lastmod: isoDate(list[0]?.publishedAt ?? latestDate),
        changefreq: 'hourly',
        priority: '0.8',
      };
    }),
    ...sorted.map((a) => ({
      loc: url(articlePath(a)),
      lastmod: isoDate(a.modifiedAt || a.updatedAt || a.publishedAt),
      changefreq: 'daily',
      priority: '0.6',
    })),
    ...infoPages().map((p) => ({
      loc: url(`/${p.slug}.html`),
      lastmod: isoDate(p.modifiedAt || latestDate),
      changefreq: 'monthly',
      priority: '0.5',
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${esc(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
}

/** Google News 사이트맵은 최근 2일치만 포함하는 것이 규격이다. */
function newsSitemapXml() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 2 * 86400000);
  const recent = INDEXABLE
    ? sorted.filter((a) => new Date(a.publishedAt) >= cutoff && new Date(a.publishedAt) <= now).slice(0, 1000)
    : [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${recent
  .map(
    (a) => `  <url>
    <loc>${esc(url(articlePath(a)))}</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(site.name)}</news:name>
        <news:language>${esc(site.language)}</news:language>
      </news:publication>
      <news:publication_date>${isoDate(a.publishedAt)}</news:publication_date>
      <news:title>${esc(a.title)}</news:title>
    </news:news>
  </url>`
  )
  .join('\n')}
</urlset>
`;
}

function rssXml() {
  const items = sorted
    .slice(0, 30)
    .map(
      (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${esc(url(articlePath(a)))}</link>
      <guid isPermaLink="true">${esc(url(articlePath(a)))}</guid>
      <description>${esc(a.summary)}</description>
      <category>${esc(sectionOf(a).name)}</category>
      <dc:creator>${esc(authorData(a).name || a.reporter)}</dc:creator>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
    </item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)}</title>
    <link>${esc(site.url)}</link>
    <atom:link href="${esc(url('/rss.xml'))}" rel="self" type="application/rss+xml"/>
    <description>${esc(site.description)}</description>
    <language>${esc(site.language)}</language>
    <lastBuildDate>${new Date(latestDate).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function searchIndexJson() {
  return JSON.stringify(
    sorted.map((a) => ({
      id: a.id,
      t: a.title,
      te: a.titleEn ?? '',
      s: a.summary,
      se: a.summaryEn ?? '',
      sec: sectionOf(a).name,
      sub: a.sub ?? '',
      r: authorData(a).name || a.reporter,
      d: fmtDateTime(a.publishedAt),
      u: articlePath(a),
      i: imgPath(a),
      g: a.tags ?? [],
      ge: a.tagsEn ?? [],
    }))
  );
}

/* ---------------------------------------------------------------- 빌드 */

async function write(rel, content) {
  const dest = path.join(DIST, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, content, 'utf8');
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

if (existsSync(path.join(SRC, 'assets'))) {
  await cp(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true });
}
if (existsSync(path.join(SRC, 'public'))) {
  await cp(path.join(SRC, 'public'), DIST, { recursive: true });
}

// 페이지
await write('index.html', renderHome());
for (const s of site.sections) await write(`section/${s.slug}.html`, renderSection(s));
for (const a of articles) await write(`article/${a.id}.html`, renderArticle(a));
for (const info of infoPages()) await write(`${info.slug}.html`, renderInfoPage(info));
await write('search.html', renderSearch());
await write('404.html', render404());

// 이미지
for (const a of articles) {
  if (imgPath(a) === `/assets/img/${a.id}.svg`) await write(`assets/img/${a.id}.svg`, placeholder(a));
}
await write(
  'assets/img/og-default.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0A4DA6"/>
  <circle cx="980" cy="150" r="300" fill="#57ABEA" opacity=".45"/>
  <text x="90" y="330" font-family="'Noto Serif KR', serif" font-size="104" font-weight="900" fill="#fff">${esc(site.name)}</text>
  <text x="96" y="400" font-family="system-ui, sans-serif" font-size="34" fill="#CFE4F7">${esc(site.tagline)}</text>
</svg>`
);
await write(
  'assets/img/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect width="96" height="96" rx="18" fill="#0A4DA6"/><path d="M22 18h16v25l21-25h20L52 48l28 30H59L38 54v24H22z" fill="#fff"/></svg>`
);
await write(
  'assets/img/logo-square.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${attr(site.name)}"><rect width="512" height="512" rx="84" fill="#0A4DA6"/><circle cx="400" cy="105" r="128" fill="#57ABEA" opacity=".45"/><path d="M116 94h86v134L315 94h106L275 255l150 163H312L202 288v130h-86z" fill="#fff"/></svg>`
);

// 피드/색인
await write('robots.txt', robotsTxt());
await write('sitemap.xml', sitemapXml());
await write('sitemap-news.xml', newsSitemapXml());
await write('rss.xml', rssXml());
await write('search-index.json', searchIndexJson());

console.log(`빌드 완료 -> dist/`);
console.log(`  기사 ${articles.length}건 · 섹션 ${site.sections.length}개`);
console.log(`  색인 정책: ${INDEXABLE ? 'Allow (INDEXABLE=true)' : 'Disallow (데모 기본값)'}`);
