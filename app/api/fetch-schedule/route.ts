import Anthropic from '@anthropic-ai/sdk';
import { load } from 'cheerio';
import { NextRequest, NextResponse } from 'next/server';
import { DAYS, WeeklySchedule } from '@/lib/types';

type CheerioRoot = ReturnType<typeof load>;

const PE_KEYWORDS = ['체육', '체조', '스포츠', '수영'];

// ────────────────────────────────────────────
// 메인 핸들러
// ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const debug: string[] = [];
  try {
    const { boardUrl, postUrl: directPostUrl, childId, grade, className } = await req.json();
    if (!boardUrl && !directPostUrl) return NextResponse.json({ error: 'URL이 필요합니다.' }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 });

    // 직접 게시물 URL이 있으면 바로 그 페이지 분석
    if (directPostUrl?.trim()) {
      debug.push(`[직접URL] ${directPostUrl}`);
      const html = await fetchHtml(directPostUrl);
      const $d = load(html);
      const imageUrls = extractImageUrls($d, directPostUrl);
      const tableText = extractTableText($d);
      const bodyText = extractBodyText($d);
      debug.push(`[직접URL] 이미지 ${imageUrls.length}개 / 표 ${tableText.length}자`);
      debug.push(`[직접URL] 이미지: ${imageUrls.slice(0, 3).join(' | ') || '없음'}`);
      const client0 = new Anthropic();
      let s: WeeklySchedule;
      if (imageUrls.length > 0) {
        const r = await tryVisionAnalysis(client0, imageUrls, childId, grade, className);
        s = r ? { ...r, sourceUrl: directPostUrl, imageUrls } : await textAnalysis(client0, tableText || bodyText, childId, grade, className);
        if (!r) { s.sourceUrl = directPostUrl; s.imageUrls = imageUrls; }
      } else {
        s = await textAnalysis(client0, tableText || bodyText, childId, grade, className);
        s.sourceUrl = directPostUrl;
      }
      return NextResponse.json({ ...s, debug });
    }

    // 1. 게시판 목록 페이지 가져오기 (AJAX JSON 먼저 시도)
    debug.push(`[1] 게시판 fetch: ${boardUrl}`);
    const ajaxPostUrl = await tryAjaxBoardList(boardUrl, debug);
    if (ajaxPostUrl) {
      debug.push(`[1] AJAX로 게시물 URL 획득: ${ajaxPostUrl}`);
      const postHtmlDirect = await fetchHtml(ajaxPostUrl);
      const $direct = load(postHtmlDirect);
      const imageUrlsDirect = extractImageUrls($direct, ajaxPostUrl);
      const tableTextDirect = extractTableText($direct);
      const bodyTextDirect = extractBodyText($direct);
      debug.push(`[direct] 이미지 ${imageUrlsDirect.length}개 / 표텍스트 ${tableTextDirect.length}자`);
      const client2 = new Anthropic();
      let schedule2: WeeklySchedule;
      if (imageUrlsDirect.length > 0) {
        const r = await tryVisionAnalysis(client2, imageUrlsDirect, childId, grade, className);
        schedule2 = r ? { ...r, sourceUrl: ajaxPostUrl, imageUrls: imageUrlsDirect } : await textAnalysis(client2, tableTextDirect || bodyTextDirect, childId, grade, className);
        if (!r) { schedule2.sourceUrl = ajaxPostUrl; schedule2.imageUrls = imageUrlsDirect; }
      } else {
        schedule2 = await textAnalysis(client2, tableTextDirect || bodyTextDirect, childId, grade, className);
        schedule2.sourceUrl = ajaxPostUrl;
      }
      return NextResponse.json({ ...schedule2, debug });
    }
    const boardHtml = await fetchHtml(boardUrl);
    debug.push(`[1] 완료 (${boardHtml.length}자)`);
    const $ = load(boardHtml);

    // 2. 스크립트 안에서 boardSeq / AJAX URL 탐지
    const scriptContent = $('script').toArray()
      .map(el => $(el).html() ?? '')
      .join('\n');
    // boardSeq 숫자 후보
    const seqMatches = [...scriptContent.matchAll(/boardSeq[='":\s]+(\d{5,})/gi)].map(m => m[1]);
    // fn_egov / getBoardList 같은 AJAX 패턴
    const ajaxMatches = [...scriptContent.matchAll(/['"]([^'"]*getBoardList[^'"]*|[^'"]*boardCnts[^'"]*\.do[^'"]*)['"]/gi)].map(m => m[1]).slice(0, 5);
    debug.push(`[2] 스크립트 boardSeq 후보: ${seqMatches.slice(0, 5).join(', ') || '없음'}`);
    debug.push(`[2] 스크립트 AJAX URL 후보: ${ajaxMatches.join(' | ') || '없음'}`);
    // HTML 전체에서 view.do 링크 탐색 (boardSeq=숫자 있는 것만)
    const viewLinks = (boardHtml.match(/\/boardCnts\/view\.do\?[^"'\s]*boardSeq=\d+[^"'\s]*/g) ?? []).slice(0, 5);
    debug.push(`[2] HTML 내 view.do 링크: ${viewLinks.join(' | ') || '없음'}`);

    // 2. 이번 주 주간학습안내 게시물 링크 찾기
    // HTML raw에서 view.do 링크 직접 추출 (cheerio가 못 찾는 경우 대비)
    const rawViewUrl = viewLinks[0] ? resolveUrl(viewLinks[0], boardUrl) : null;
    const postUrl = findThisWeekPostUrl($, boardUrl) ?? findLatestPostUrl($, boardUrl) ?? rawViewUrl;
    debug.push(`[2] 게시물 URL: ${postUrl ?? '(탐지 실패 — 게시판 페이지로 진행)'}`);
    const targetUrl = postUrl ?? boardUrl;

    // 3. 게시물 페이지 가져오기
    const postHtml = postUrl ? await fetchHtml(postUrl) : boardHtml;
    const $post = load(postHtml);
    debug.push(`[3] 게시물 HTML (${postHtml.length}자)`);

    // 4. 콘텐츠 추출
    const imageUrls = extractImageUrls($post, targetUrl);
    const tableText = extractTableText($post);
    const bodyText = extractBodyText($post);
    debug.push(`[4] 이미지 ${imageUrls.length}개 / 표텍스트 ${tableText.length}자 / 본문 ${bodyText.length}자`);
    debug.push(`[4] 이미지 URLs: ${imageUrls.slice(0, 3).join(', ') || '없음'}`);

    // 5. Claude로 분석
    const client = new Anthropic();
    let schedule: WeeklySchedule;

    if (imageUrls.length > 0) {
      debug.push('[5] Claude Vision 분석 시작');
      const imageResult = await tryVisionAnalysis(client, imageUrls, childId, grade, className);
      if (imageResult) {
        debug.push('[5] Vision 분석 성공');
        schedule = { ...imageResult, sourceUrl: targetUrl, imageUrls };
      } else {
        debug.push('[5] Vision 실패 → 텍스트 분석 fallback');
        schedule = await textAnalysis(client, tableText || bodyText, childId, grade, className);
        schedule.sourceUrl = targetUrl;
        schedule.imageUrls = imageUrls;
      }
    } else if (tableText || bodyText) {
      debug.push('[5] Claude 텍스트 분석 시작');
      schedule = await textAnalysis(client, tableText || bodyText, childId, grade, className);
      schedule.sourceUrl = targetUrl;
      debug.push('[5] 텍스트 분석 완료');
    } else {
      return NextResponse.json({
        error: '게시물에서 시간표를 찾을 수 없습니다.',
        debug,
      }, { status: 422 });
    }

    return NextResponse.json({ ...schedule, debug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: msg, debug }, { status: 500 });
  }
}

// ────────────────────────────────────────────
// HTML 가져오기 (EUC-KR 대응)
// ────────────────────────────────────────────
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; school-schedule-helper)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

  const buffer = await res.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (/[가-힣]/.test(utf8)) return utf8;
  try { return new TextDecoder('euc-kr').decode(buffer); } catch { return utf8; }
}

// 게시물 view URL인지 판별 (list.do / menu 링크 등 제외)
function isPostViewUrl(href: string): boolean {
  if (isJsHref(href)) return false;
  // 명확한 목록/메뉴 페이지 제외
  if (/list\.do|menuCd=|\/menu\//i.test(href)) return false;
  // view 패턴 → 게시물
  if (/view\.do|boardSeq=|nttId=|articleId=|bbsIdx=/i.test(href)) return true;
  return false; // 명확하지 않으면 제외
}

// ────────────────────────────────────────────
// 이번 주 게시물 링크 찾기
// ────────────────────────────────────────────
function findThisWeekPostUrl($: CheerioRoot, base: string): string | null {
  const now = new Date();
  const month = now.getMonth() + 1;
  const week = Math.ceil(now.getDate() / 7);
  const patterns = [
    new RegExp(`${month}월\\s*${week}주`),
    new RegExp(`${month}월\\s*제?\\s*${week}\\s*주`),
    /주간학습안내/,
    /주간학습/,
    /주간안내/,
  ];

  for (const pat of patterns) {
    const found = $('a').filter((_, el) => pat.test($(el).text())).first();
    if (!found.length) continue;
    const href = found.attr('href') ?? '';
    if (isPostViewUrl(href)) return resolveUrl(href, base);
    const onclick = found.attr('onclick') ?? '';
    const loc = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (loc && isPostViewUrl(loc[1])) return resolveUrl(loc[1], base);
  }
  return null;
}

// ────────────────────────────────────────────
// 최신 게시물 링크 찾기 (이번 주 실패 시)
// ────────────────────────────────────────────
function findLatestPostUrl($: CheerioRoot, base: string): string | null {
  // view.do / boardSeq 패턴을 가진 링크 우선 탐색 (인천교육청 등 한국 교육 CMS)
  const allLinks = $('a[href]').toArray();
  for (const el of allLinks) {
    const href = $(el).attr('href') ?? '';
    if (isPostViewUrl(href) && /view\.do|boardSeq=|nttId=|articleId=/i.test(href)) {
      return resolveUrl(href, base);
    }
  }

  // 테이블 기반 게시판 목록 탐색
  const selectors = [
    'table tbody tr td.title a',
    'table tbody tr td.subject a',
    'table tbody tr td a',
    '.board_list tbody tr a',
    '.bbs_list tbody tr a',
    'ul.board-list li a',
  ];
  for (const sel of selectors) {
    for (const el of $(sel).toArray()) {
      const href = $(el).attr('href') ?? '';
      if (isPostViewUrl(href)) return resolveUrl(href, base);
      const onclick = $(el).attr('onclick') ?? '';
      const loc = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (loc && isPostViewUrl(loc[1])) return resolveUrl(loc[1], base);
      const win = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/);
      if (win && isPostViewUrl(win[1])) return resolveUrl(win[1], base);
    }
  }
  return null;
}

// ────────────────────────────────────────────
// 이미지 URL 추출
// ────────────────────────────────────────────
const DECO_PATTERN = /logo|banner|bg_|background|icon|ico|button|btn_|arrow|bullet|pixel|spacer|blank|common|layout|visual|template|skin|design|nav|menu/i;

function extractImageUrls($: CheerioRoot, base: string): string[] {
  // 노이즈 영역 제거
  $('script, style, nav, header, footer, .gnb, .lnb, #header, #footer, #nav, .visual, .main-visual, .banner, .slider, .swiper').remove();

  const contentSelectors = [
    '.board-view-content', '.bbs-view-content', '.board_view', '.view-content',
    '.read-content', '.cont_area', '.board_cont', '.article-body',
    '.view_cont', 'td.content', '.ql-editor', '.fr-view',
    '#content', '.content', 'article', 'main',
  ];

  for (const sel of contentSelectors) {
    const el = $(sel);
    if (!el.length) continue;
    const urls = collectImgUrls(el, $, base);
    if (urls.length > 0) return urls;
  }
  return collectImgUrls($.root(), $, base);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectImgUrls(root: any, $: CheerioRoot, base: string): string[] {
  const urls: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root.find('img').each((_: any, img: any) => {
    const src = $(img).attr('src') ?? '';
    if (!src || src.startsWith('data:') || DECO_PATTERN.test(src)) return;
    const w = parseInt($(img).attr('width') ?? '0');
    const h = parseInt($(img).attr('height') ?? '0');
    if ((w > 0 && w < 100) || (h > 0 && h < 100)) return;
    urls.push(resolveUrl(src, base));
  });
  return urls;
}

// ────────────────────────────────────────────
// 텍스트/표 추출
// ────────────────────────────────────────────
function extractTableText($: CheerioRoot): string {
  const parts: string[] = [];
  $('table').each((_, table) => {
    const rows: string[] = [];
    $(table).find('tr').each((_, tr) => {
      const cells: string[] = [];
      $(tr).find('td, th').each((__, td) => { cells.push($(td).text().replace(/\s+/g, ' ').trim()); });
      if (cells.some(c => c.length > 0)) rows.push(cells.join('\t'));
    });
    if (rows.length >= 2) parts.push(rows.join('\n'));
  });
  return parts.join('\n\n');
}

function extractBodyText($: CheerioRoot): string {
  $('script, style, nav, header, footer').remove();
  return ($('body').text() ?? '').replace(/\s+/g, ' ').trim();
}

// ────────────────────────────────────────────
// Claude Vision 분석
// ────────────────────────────────────────────
async function tryVisionAnalysis(
  client: Anthropic,
  imageUrls: string[],
  childId: string,
  grade: number,
  className: string,
): Promise<WeeklySchedule | null> {
  for (const url of imageUrls.slice(0, 3)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim() as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      const base64 = Buffer.from(buffer).toString('base64');

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: buildPrompt(grade, className) },
          ],
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '';
      const schedule = parseClaudeResponse(text, childId);
      if (schedule) return schedule;
    } catch { continue; }
  }
  return null;
}

// ────────────────────────────────────────────
// Claude 텍스트 분석
// ────────────────────────────────────────────
async function textAnalysis(
  client: Anthropic,
  text: string,
  childId: string,
  grade: number,
  className: string,
): Promise<WeeklySchedule> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `${buildPrompt(grade, className)}\n\n아래는 학교 홈페이지 주간학습안내 텍스트입니다:\n\n${text.slice(0, 3000)}`,
    }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  return parseClaudeResponse(responseText, childId) ?? emptySchedule(childId, '분석 실패');
}

// ────────────────────────────────────────────
// Claude 프롬프트
// ────────────────────────────────────────────
function buildPrompt(grade: number, className: string): string {
  return `이 주간학습안내에서 ${grade}학년 ${className}반의 이번 주 시간표를 추출해주세요.

다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "week": "주차 텍스트 (예: 4/7~4/11)",
  "days": {
    "월": { "subjects": ["국어", "수학"], "items": ["준비물"], "notes": "" },
    "화": { "subjects": [...], "items": [...], "notes": "" },
    "수": { "subjects": [...], "items": [...], "notes": "" },
    "목": { "subjects": [...], "items": [...], "notes": "" },
    "금": { "subjects": [...], "items": [...], "notes": "" }
  }
}

규칙:
- subjects: 교시 순서대로 과목명 배열 (체육이면 "체육" 포함)
- items: 해당 날 챙길 준비물 (체육 수업 있으면 반드시 "체육복"과 "운동화" 포함)
- notes: 현장학습·행사 등 특이사항 (없으면 빈 문자열 "")
- 해당 학년/반이 없으면 전체 시간표 기반으로 최대한 추출`;
}

// ────────────────────────────────────────────
// Claude 응답 파싱
// ────────────────────────────────────────────
function parseClaudeResponse(text: string, childId: string): WeeklySchedule | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const days = Object.fromEntries(
      DAYS.map(day => {
        const d = parsed.days?.[day] ?? { subjects: [], items: [], notes: '' };
        const subjects: string[] = d.subjects ?? [];
        const hasPE = subjects.some((s: string) => PE_KEYWORDS.some(k => s.includes(k)));
        const items: string[] = d.items ?? [];
        if (hasPE && !items.some((i: string) => i.includes('체육복'))) {
          items.unshift('운동화', '체육복');
        }
        return [day, { hasPE, subjects, items, notes: d.notes ?? '' }];
      })
    ) as WeeklySchedule['days'];

    return { childId, week: parsed.week ?? '이번 주', fetchedAt: new Date().toISOString(), days };
  } catch {
    return null;
  }
}

function emptySchedule(childId: string, error: string): WeeklySchedule {
  return {
    childId,
    week: '오류',
    fetchedAt: new Date().toISOString(),
    days: Object.fromEntries(DAYS.map(d => [d, { hasPE: false, subjects: [], items: [], notes: '' }])) as unknown as WeeklySchedule['days'],
    error,
  };
}

function isJsHref(href: string): boolean {
  return !href || href === '#' || href.startsWith('javascript:');
}

function resolveUrl(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}

// ────────────────────────────────────────────
// AJAX/JSON API로 게시물 목록 조회 시도
// (JavaScript 렌더링 CMS 대응)
// ────────────────────────────────────────────
async function tryAjaxBoardList(boardUrl: string, debug: string[]): Promise<string | null> {
  try {
    const u = new URL(boardUrl);
    // regex로 직접 추출 (URL 파싱 edge case 방지)
    const boardIDMatch = boardUrl.match(/boardID=(\d+)/);
    const mMatch = boardUrl.match(/[?&]m=([^&&#]+)/);
    const sMatch = boardUrl.match(/[?&]s=([^&&#]+)/);
    const boardID = boardIDMatch?.[1] ?? '';
    const mParam = mMatch?.[1] ?? '';
    const sParam = sMatch?.[1] ?? '';
    debug.push(`[ajax] 파라미터: boardID=${boardID} m=${mParam} s=${sParam}`);
    if (!boardID) return null;

    // icees.kr / ice.go.kr 계열 CMS: AJAX JSON 요청
    const jsonUrl = `${u.origin}/boardCnts/list.do?boardID=${boardID}&s=${sParam}&m=${mParam}&pageIndex=1`;
    debug.push(`[ajax] 요청 URL: ${jsonUrl}`);
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': boardUrl,
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    debug.push(`[ajax] 응답: ${res.status} ${res.headers.get('content-type')} (${text.length}자)`);
    debug.push(`[ajax] 응답 앞부분: ${text.slice(0, 300)}`);

    // JSON 응답이면 boardSeq 추출
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const json = JSON.parse(text);
      const items = json?.resultList ?? json?.list ?? json?.data ?? json?.boardList ?? (Array.isArray(json) ? json : null);
      debug.push(`[ajax] items 수: ${items?.length ?? 0}`);
      if (items?.length > 0) {
        debug.push(`[ajax] 첫 item: ${JSON.stringify(items[0]).slice(0, 200)}`);
        const seq = items[0]?.boardSeq ?? items[0]?.nttId ?? items[0]?.seq ?? items[0]?.boardNo;
        if (seq) {
          const viewUrl = `${u.origin}/boardCnts/view.do?boardID=${boardID}&boardSeq=${seq}&m=${mParam}&s=${sParam}`;
          debug.push(`[ajax] 최종 view URL: ${viewUrl}`);
          return viewUrl;
        }
      }
    }
  } catch (e) {
    debug.push(`[ajax] 실패: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}
