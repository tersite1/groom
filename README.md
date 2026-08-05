# AI 리서치 뉴스

논문·공식 연구자료 등 1차 출처를 연결하는 AI 연구·안전 전문 정적 뉴스 사이트. 기사 데이터(JSON)로 홈·섹션·기사·검색·사이트맵·뉴스 사이트맵·RSS를 생성하며 런타임 의존성이 없다.

## 실행

```bash
npm run build     # dist/ 생성
npm run dev       # 빌드 후 http://localhost:4173 서빙
npm test          # INDEXABLE=true 빌드 후 SEO 불변조건 검증
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
  "modifiedAt": "2026-08-05T08:00:00+09:00",
  "image": {
    "src": "/assets/img/report.webp",
    "alt": "연구 결과를 검토하는 연구진",
    "caption": "연구진이 안전성 평가 결과를 검토하고 있다.",
    "credit": "그룸일보"
  },
  "sources": [{ "title": "연구 보고서", "url": "https://example.org/report" }],
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

flag가 없어도 모든 기사는 섹션 목록·검색·사이트맵에 포함된다. 1면 슬롯은 최신순으로 채운다.

## 이미지

기사에 `image`(문자열 경로 또는 위 예시 객체)를 지정하면 해당 WebP/JPEG/PNG 경로를 카드, 본문, Open Graph, JSON-LD에서 그대로 사용한다. `image`가 없는 기사에만 `dist/assets/img/<id>.svg` 대체 이미지가 생성된다. `sources`는 기사 하단에 실제 링크로 표시된다.

## 색인 정책

운영 설정은 `data/site.json`의 `indexable`로 관리하며 현재는 공개 기사 색인이 활성화돼 있다. 모든 기사는 동일한 색인 정책과 SEO 메타데이터를 적용받는다.

```bash
npm run build                    # site.json의 indexable 정책으로 빌드(현재 운영값 true)
INDEXABLE=false node build.mjs   # 로컬 검수·비공개 미리보기: 전체 noindex/Disallow
INDEXABLE=true node build.mjs    # 운영 강제값: 공개 기사 색인 + 뉴스 사이트맵 노출
```

환경변수가 없으면 `data/site.json`의 `indexable`을 따른다. 공개 빌드에서는 기사 유형과 관계없이 동일한 `NewsArticle`·사이트맵·RSS 정책을 적용한다.

HTML `<meta name="robots">`도 같은 스위치를 따른다. 검색과 404는 `INDEXABLE=true`에서도 항상 `noindex, nofollow`이며 사이트맵에서 제외된다.

## 생성되는 SEO 자산

- `sitemap.xml` — 전체 URL, `lastmod`/`changefreq`/`priority` 포함
- `sitemap-news.xml` — Google News 규격. 최근 2일치 기사만 포함한다(규격 요구사항)
- `rss.xml` — 최근 30건
- `search-index.json` — 클라이언트 검색용 색인
- 페이지별 canonical, Open Graph, Twitter Card
- JSON-LD: 홈 `WebSite`+`SearchAction`, 섹션 `CollectionPage`, 기사 `NewsArticle`
- JSON-LD: 홈 `NewsMediaOrganization`, 기사별 수정일·저자 프로필·대표 이미지·발행사 로고 지원
- 모든 기사에 동일한 `NewsArticle` 구조화 데이터와 canonical·대표 이미지·저자·발행사 정보를 적용
- 선택적 `titleEn`·`summaryEn`·`tagsEn`을 화면, JSON-LD, 메타 키워드, 내부 검색에 함께 반영

`site.json`에 `about`, `editorialPolicy`, `corrections` 원고(문자열, 배열 또는 `{ title, description, body }`)를 넣으면 해당 안내 페이지가 푸터와 사이트맵에 자동 추가된다. 설정에 없는 조직 이력이나 정책은 생성하지 않는다. `authors` 설정(배열 또는 객체)에 `name`, `type`, `url`을 두면 기사 JSON-LD 저자 프로필에도 반영된다.

## 접근성·성능

- 본문 바로가기 링크, `:focus-visible` 아웃라인, `aria-current` 현재 섹션 표시
- `prefers-reduced-motion` 존중
- 이미지 `width`/`height` 명시로 레이아웃 시프트 방지, 리드 이미지 외 `loading="lazy"`
- 반응형: 1024 / 860 / 600px 브레이크포인트

## 알려진 제약

- 본문 폰트(Pretendard, Noto Serif KR)를 CDN에서 불러온다. 오프라인 환경에서는 시스템 폰트로 대체된다.
- 검색은 클라이언트에서 전체 색인을 받아 부분 문자열로 매칭한다. 기사 수가 수천 건을 넘으면 서버 검색으로 옮겨야 한다.
- 페이지네이션이 없다. 섹션 목록은 해당 섹션 기사를 모두 출력한다.
