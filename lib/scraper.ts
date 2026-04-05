'use client';

// CORS 프록시를 통해 학교 홈페이지 HTML을 브라우저에서 직접 가져옴
// 데이터는 로컬에서만 처리됨

const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

export interface ScrapeResult {
  text: string;
  tables: string[][][];
  imageUrls: string[];
}

export async function scrapeSchedule(boardUrl: string, postUrl?: string): Promise<ScrapeResult> {
  // 직접 게시물 URL이 있으면 바로 그 페이지에서 추출
  if (postUrl?.trim()) {
    const html = await fetchWithProxy(postUrl);
    const doc = parseHtml(html);
    removeNoise(doc);
    return extract(doc, postUrl);
  }

  // 게시판 목록 페이지에서 최신 게시물 자동 탐지
  const html = await fetchWithProxy(boardUrl);
  const doc = parseHtml(html);
  removeNoise(doc);

  const latestLink = findLatestPostLink(doc, boardUrl);
  if (latestLink) {
    try {
      const postHtml = await fetchWithProxy(latestLink);
      const postDoc = parseHtml(postHtml);
      removeNoise(postDoc);
      const result = extract(postDoc, latestLink);
      if (result.text.length > 100 || result.tables.length > 0 || result.imageUrls.length > 0) return result;
    } catch { /* 실패 시 현재 페이지로 진행 */ }
  }

  return extract(doc, boardUrl);
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function removeNoise(doc: Document) {
  const remove = ['script', 'style', 'nav', 'header', 'footer',
    '.gnb', '.lnb', '.snb', '#header', '#footer', '#nav',
    '.visual', '.main-visual', '.slide', '.slider', '.banner', '.banners',
    '.swiper', '.carousel', '.hero', '.top-banner', '.main-banner',
    '#visual', '#banner', '#slider', '.rolling', '.notice-slide'];
  remove.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });
}

function extract(doc: Document, baseUrl = ''): ScrapeResult {
  const tables = extractTables(doc);
  const text = extractText(doc);
  const imageUrls = extractImages(doc, baseUrl);
  return { text, tables, imageUrls };
}

/** 주간학습안내 이미지 URL 추출 */
function extractImages(doc: Document, baseUrl: string): string[] {
  const contentSelectors = [
    '.board-view-content', '.bbs-view-content', '.board_view', '.view-content',
    '.read-content', '.cont_area', '.board_cont', '.article-body',
    '#content .view', '.view_cont', 'td.content', '.ql-editor', '.fr-view',
    '#content', '.content', 'article', 'main',
  ];

  // 본문 영역에서 먼저 탐색
  for (const sel of contentSelectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const imgs = extractImgUrls(el, baseUrl);
    if (imgs.length > 0) return imgs;
  }

  // 전체 페이지에서 탐색 (본문 못 찾은 경우)
  return extractImgUrls(doc.body, baseUrl);
}

// 장식용 이미지 URL 패턴 (로고, 배너, 배경 등)
const DECO_URL_PATTERNS = /logo|banner|bg_|background|icon|button|btn_|arrow|bullet|pixel|spacer|blank|common|layout/i;

function extractImgUrls(root: Element | null, baseUrl: string): string[] {
  if (!root) return [];
  const urls: string[] = [];
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') ?? '';
    if (!src) return;
    // data URI 제외
    if (src.startsWith('data:')) return;
    // 장식용 URL 패턴 제외
    if (DECO_URL_PATTERNS.test(src)) return;
    // 작은 아이콘/로고 제외 (width/height 속성 있을 때만)
    const wAttr = img.getAttribute('width');
    const hAttr = img.getAttribute('height');
    if (wAttr && parseInt(wAttr) < 100) return;
    if (hAttr && parseInt(hAttr) < 100) return;
    const resolved = resolveUrl(src, baseUrl);
    urls.push(resolved);
  });
  return urls;
}

function extractTables(doc: Document): string[][][] {
  const result: string[][][] = [];
  doc.querySelectorAll('table').forEach(table => {
    const rows: string[][] = [];
    table.querySelectorAll('tr').forEach(tr => {
      const cells: string[] = [];
      tr.querySelectorAll('td, th').forEach(td => {
        cells.push((td.textContent ?? '').replace(/\s+/g, ' ').trim());
      });
      if (cells.some(c => c.length > 0)) rows.push(cells);
    });
    if (rows.length >= 2) result.push(rows);
  });
  return result;
}

function extractText(doc: Document): string {
  const selectors = [
    '.board-view-content', '.bbs-view-content', '.board_view', '.view-content',
    '.read-content', '.cont_area', '.board_cont', '.article-body',
    '#content .view', '.view_cont', 'td.content', '.ql-editor', '.fr-view',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text.length > 50) return text;
    }
  }
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function findLatestPostLink(doc: Document, baseUrl: string): string | null {
  const selectors = [
    'table.board-list tbody tr:first-child a',
    'table.bbs-list tbody tr:first-child a',
    '.board_list tbody tr:first-child a',
    '.bbs_list tbody tr:first-child a',
    'table tbody tr:first-child td.title a',
    'table tbody tr:first-child td a',
    '.list-content li:first-child a',
    'ul.board-list li:first-child a',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const href = el?.getAttribute('href');
    if (href && !isJsHref(href)) return resolveUrl(href, baseUrl);
  }

  // 주간학습안내 키워드로 href 링크 찾기
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    const text = a.textContent ?? '';
    const href = a.getAttribute('href');
    if (href && !isJsHref(href) && ['주간학습', '주간안내', '학습안내'].some(kw => text.includes(kw))) {
      return resolveUrl(href, baseUrl);
    }
  }

  // onclick 기반 한국 학교 CMS 대응 (JavaScript 네비게이션)
  for (const a of Array.from(doc.querySelectorAll('a[onclick], td[onclick]'))) {
    const onclick = a.getAttribute('onclick') ?? '';
    // location.href = '...' 패턴
    const locMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (locMatch && !isJsHref(locMatch[1])) return resolveUrl(locMatch[1], baseUrl);
    // window.open('...') 패턴
    const winMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
    if (winMatch && !isJsHref(winMatch[1])) return resolveUrl(winMatch[1], baseUrl);
  }

  return null;
}

function isJsHref(href: string): boolean {
  return href === '#' || href.startsWith('javascript:') || href === '';
}

async function fetchWithProxy(url: string): Promise<string> {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      // EUC-KR 인코딩 대응
      const utf8 = new TextDecoder('utf-8').decode(buffer);
      if (/[가-힣]/.test(utf8)) return utf8;
      try { return new TextDecoder('euc-kr').decode(buffer); } catch { return utf8; }
    } catch { /* 다음 프록시 시도 */ }
  }
  throw new Error('페이지를 가져올 수 없습니다. URL을 확인하거나 잠시 후 다시 시도해주세요.');
}

function resolveUrl(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}
