# 그룸일보

한국형 종합 일간지 레이아웃의 정적 뉴스 사이트. 기사 데이터(JSON)만 넣으면 홈·섹션 목록·기사 본문·검색·사이트맵·RSS가 자동 생성된다. 런타임 의존성 없음.

## 실행

```bash
npm run build     # dist/ 생성
npm run dev       # 빌드 후 http://localhost:4173 서빙
```

Node 18+ 필요. 외부 패키지를 설치하지 않는다.

## 구조

```
data/site.json       제호·섹션·발행 정보 등 사이트 설정
data/articles.json   기사 데이터 (이 파일만 바꾸면 사이트 전체가 바뀐다)
src/assets/          CSS·JS (dist 로 그대로 복사됨)
build.mjs            생성기
dist/                빌드 산출물
```

## 기사 추가

`data/articles.json` 에 항목을 추가한다.

```json
{
  "id": "grm20260805001",
  "title": "제목",
  "summary": "목록과 og:description 에 쓰이는 한 문단 요약",
  "section": "society",
  "sub": "환경",
  "reporter": "정한결",
  "publishedAt": "2026-08-05T06:00:00+09:00",
  "tags": ["폭염", "전력수급"],
  "flags": ["lead"],
  "body": ["첫 문단", "둘째 문단"]
}
```

`section` 은 `data/site.json` 의 `sections[].slug` 와 일치해야 한다.

### flags — 홈 배치 결정

| flag | 위치 |
|---|---|
| `lead` | 1면 톱기사 (1건) |
| `headline` | 1면 우측 헤드라인 리스트 (4건) |
| `brief` | 오늘의 브리핑 (3건) |
| `original` | 그룸 오리지널 다크 레일 (6건) |
| `popular` | 많이 본 기사 랭킹 (8건) |
| `opinion` | 오피니언 사이드바 (4건) |
| `media` | 포토·영상 (4건) |

flag 가 없어도 섹션 목록·검색·사이트맵에는 모두 포함된다. 1면 슬롯은 최신순으로 채우고 중복 배치하지 않는다.

## 이미지

기사 이미지는 `id` 를 시드로 한 추상 도형 SVG가 자동 생성된다(`dist/assets/img/<id>.svg`). 사진이 아님을 분명히 하려고 의도적으로 기하 도형만 쓴다. 실제 사진으로 교체하려면 `build.mjs` 의 `imgPath()` 가 기사별 이미지 경로를 반환하도록 바꾸면 된다.

## 색인 정책

**기본값은 색인 전면 차단이다.** `data/articles.json` 이 가상의 예시 기사로 채워져 있기 때문이다.

```bash
node build.mjs                  # robots.txt -> Disallow: /
INDEXABLE=true node build.mjs   # robots.txt -> Allow: / + news 사이트맵 노출
```

`INDEXABLE=true` 는 실제 편집 콘텐츠로 교체한 뒤에만 쓴다. 예시 데이터를 그대로 둔 채 색인을 열면 사실이 아닌 기사가 검색엔진과 AI 크롤러에 수집된다.

HTML `<meta name="robots">` 도 같은 스위치를 따르도록 하려면 `build.mjs` 의 `head()` 에서 `INDEXABLE` 을 참조하도록 바꾼다(현재는 항상 `noindex, nofollow`).

## 생성되는 SEO 자산

- `sitemap.xml` — 전체 URL, `lastmod`/`changefreq`/`priority` 포함
- `sitemap-news.xml` — Google News 규격. 최근 2일치 기사만 포함한다(규격 요구사항)
- `rss.xml` — 최근 30건
- `search-index.json` — 클라이언트 검색용 색인
- 페이지별 canonical, Open Graph, Twitter Card
- JSON-LD: 홈 `WebSite`+`SearchAction`, 섹션 `CollectionPage`, 기사 `NewsArticle`

## 접근성·성능

- 본문 바로가기 링크, `:focus-visible` 아웃라인, `aria-current` 현재 섹션 표시
- `prefers-reduced-motion` 존중
- 이미지 `width`/`height` 명시로 레이아웃 시프트 방지, 리드 이미지 외 `loading="lazy"`
- 반응형: 1024 / 860 / 600px 브레이크포인트

## 알려진 제약

- 본문 폰트(Pretendard, Noto Serif KR)를 CDN에서 불러온다. 오프라인 환경에서는 시스템 폰트로 대체된다.
- 검색은 클라이언트에서 전체 색인을 받아 부분 문자열로 매칭한다. 기사 수가 수천 건을 넘으면 서버 검색으로 옮겨야 한다.
- 페이지네이션이 없다. 섹션 목록은 해당 섹션 기사를 모두 출력한다.
