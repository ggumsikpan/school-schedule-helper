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
    const { boardUrl, childId, grade, className } = await req.json();
    if (!boardUrl) return NextResponse.json({ error: 'boardUrl이 필요합니다.' }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 });

    // 1. 게시판 목록 페이지 가져오기
    debug.push(`[1] 게시판 fetch: ${boardUrl}`);
    const boardHtml = await fetchHtml(boardUrl);
    debug.push(`[1] 완료 (${boardHtml.length}자)`);
    const $ = load(boardHtml);

    // 2. 이번 주 주간학습안내 게시물 링크 찾기
    const postUrl = findThisWeekPostUrl($, boardUrl) ?? findLatestPostUrl($, boardUrl);
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
  // 목록 페이지 제외
  if (/list\.do|menuCd=|m=\d|\/menu\//i.test(href)) return false;
  // view 패턴 우선
  if (/view\.do|boardSeq=|nttId=|articleId=|seq=|no=\d|idx=\d|bbsIdx=/i.test(href)) return true;
  return true; // 나머지는 일단 허용
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
