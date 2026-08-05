/* AI 리서치 뉴스 — 클라이언트 검색 (의존성 없음) */

(function () {
  'use strict';

  var input = document.getElementById('sq');
  var results = document.getElementById('search-results');
  var status = document.getElementById('search-status');
  if (!input || !results || !status) return;

  var index = null;
  var pending = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function load() {
    if (index) return Promise.resolve(index);
    return fetch('/search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('index ' + r.status);
        return r.json();
      })
      .then(function (data) {
        index = data;
        return index;
      });
  }

  function score(item, terms) {
    var title = item.t.toLowerCase();
    var titleEn = (item.te || '').toLowerCase();
    var summary = item.s.toLowerCase();
    var summaryEn = (item.se || '').toLowerCase();
    var tags = item.g.concat(item.ge || []).join(' ').toLowerCase();
    var meta = (item.sec + ' ' + item.sub + ' ' + item.r).toLowerCase();
    var total = 0;

    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var hit = 0;
      if (title.indexOf(t) !== -1) hit += 10;
      if (titleEn.indexOf(t) !== -1) hit += 9;
      if (tags.indexOf(t) !== -1) hit += 6;
      if (summary.indexOf(t) !== -1) hit += 3;
      if (summaryEn.indexOf(t) !== -1) hit += 3;
      if (meta.indexOf(t) !== -1) hit += 2;
      if (hit === 0) return 0; // 모든 검색어를 포함해야 한다
      total += hit;
    }
    return total;
  }

  function card(item) {
    return (
      '<article class="card"><a class="card__link" href="' +
      esc(item.u) +
      '">' +
      '<figure class="card__figure"><img src="' +
      esc(item.i) +
      '" alt="" width="1200" height="800" loading="lazy"></figure>' +
      '<div class="card__body">' +
      '<span class="kicker">' +
      esc(item.sec) +
      (item.sub ? '<span class="kicker__sub">' + esc(item.sub) + '</span>' : '') +
      '</span>' +
      '<h3 class="card__title">' +
      esc(item.t) +
      '</h3>' +
      '<p class="card__summary">' +
      esc(item.s) +
      '</p>' +
      '<p class="byline"><span class="byline__name">' +
      esc(item.r) +
      '</span><span>' +
      esc(item.d) +
      '</span></p>' +
      '</div></a></article>'
    );
  }

  function run(q) {
    var query = q.trim().toLowerCase();
    if (!query) {
      results.innerHTML = '';
      status.textContent = '검색어를 입력하세요.';
      return;
    }

    var terms = query.split(/\s+/).filter(Boolean);
    status.textContent = '검색 중…';

    load()
      .then(function (data) {
        var hits = [];
        for (var i = 0; i < data.length; i++) {
          var s = score(data[i], terms);
          if (s > 0) hits.push({ item: data[i], s: s });
        }
        hits.sort(function (a, b) {
          return b.s - a.s;
        });

        if (!hits.length) {
          results.innerHTML = '';
          status.textContent = '‘' + q.trim() + '’에 대한 결과가 없습니다. 다른 검색어를 입력해 보세요.';
          return;
        }

        status.textContent = '‘' + q.trim() + '’ 검색 결과 ' + hits.length + '건';
        results.innerHTML = hits
          .map(function (h) {
            return card(h.item);
          })
          .join('');
      })
      .catch(function () {
        results.innerHTML = '';
        status.textContent = '검색 색인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      });
  }

  input.addEventListener('input', function () {
    clearTimeout(pending);
    var value = input.value;
    pending = setTimeout(function () {
      run(value);
    }, 180);
  });

  var initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    input.value = initial;
    run(initial);
  }
})();
