'use client';

import { WeeklySchedule, DayKey, DAYS, DaySchedule } from './types';
import type { ScrapeResult } from './scraper';

const PE_KEYWORDS = ['체육', '체조', '스포츠', '수영'];
const PE_ITEMS = ['체육복', '운동화'];

const DAY_PATTERNS: Record<DayKey, RegExp> = {
  월: /월\s*요?\s*일?/,
  화: /화\s*요?\s*일?/,
  수: /수\s*요?\s*일?/,
  목: /목\s*요?\s*일?/,
  금: /금\s*요?\s*일?/,
};

const PERIOD_PATTERN = /^(\d+)\s*교?\s*시?$|^(\d+)$/;

function emptyDay(): DaySchedule {
  return { hasPE: false, subjects: [], items: [], notes: '' };
}

function emptyDays(): Record<DayKey, DaySchedule> {
  return Object.fromEntries(DAYS.map(d => [d, emptyDay()])) as Record<DayKey, DaySchedule>;
}

export function parseSchedule(result: ScrapeResult, childId: string): WeeklySchedule {
  const days = emptyDays();
  let week = '이번 주';

  // 전략 1: 표 구조 파싱
  if (result.tables.length > 0) {
    const tableResult = parseFromTables(result.tables);
    if (tableResult) {
      for (const day of DAYS) Object.assign(days[day], tableResult.days[day]);
      if (tableResult.week) week = tableResult.week;
    }
  }

  // 전략 2: 텍스트 파싱 (표 파싱 실패 시 보완)
  const hasData = DAYS.some(d => days[d].subjects.length > 0);
  if (!hasData && result.text) {
    const textResult = parseFromText(result.text);
    for (const day of DAYS) Object.assign(days[day], textResult.days[day]);
    if (textResult.week) week = textResult.week;
  }

  // 체육 플래그 최종 보정
  for (const day of DAYS) {
    if (days[day].subjects.some(s => PE_KEYWORDS.some(k => s.includes(k)))) {
      days[day].hasPE = true;
      if (!days[day].items.some(i => PE_ITEMS.includes(i))) {
        days[day].items.unshift(...PE_ITEMS);
      }
    }
  }

  return { childId, week, fetchedAt: new Date().toISOString(), days, imageUrls: result.imageUrls ?? [] };
}

function parseFromTables(tables: string[][][]): { days: Record<DayKey, DaySchedule>; week?: string } | null {
  for (const table of tables) {
    const headerIdx = findDayHeaderRow(table);
    if (headerIdx === -1) continue;

    const dayColMap = mapDayColumns(table[headerIdx]);
    if (Object.keys(dayColMap).length < 3) continue;

    const days = emptyDays();
    let week: string | undefined;

    for (let r = headerIdx + 1; r < table.length; r++) {
      const row = table[r];
      const label = (row[0] ?? '').trim();

      if (!week) {
        const wm = label.match(/(\d{1,2})[.월/](\d{1,2})/);
        if (wm) week = wm[0];
      }

      const isPeriodRow = PERIOD_PATTERN.test(label) || /교시/.test(label);
      const isItemRow = /준비물|필요|가져올|챙길/.test(label);
      const isNoteRow = /특이|알림|비고|행사|현장/.test(label);

      for (const [day, colIdx] of Object.entries(dayColMap) as [DayKey, number][]) {
        const cell = (row[colIdx] ?? '').trim();
        if (!cell || cell === '-') continue;

        if (isItemRow) {
          const items = splitItems(cell);
          for (const item of items) {
            if (!days[day].items.includes(item)) days[day].items.push(item);
          }
        } else if (isNoteRow) {
          days[day].notes = days[day].notes ? days[day].notes + ' / ' + cell : cell;
        } else if (isPeriodRow || !isItemRow) {
          const parts = cell.split(/[,/·]/).map(s => s.trim()).filter(Boolean);
          days[day].subjects.push(...parts);
        }
      }
    }

    if (DAYS.some(d => days[d].subjects.length > 0)) return { days, week };
  }
  return null;
}

function parseFromText(text: string): { days: Record<DayKey, DaySchedule>; week?: string } {
  const days = emptyDays();
  let week: string | undefined;

  const wm = text.match(/(\d{1,2})[.월/](\d{1,2})[일~\s-]+(\d{1,2})[.월/](\d{1,2})/);
  if (wm) week = wm[0].trim();

  const sectionPattern = /[◆◇▶•*\[【]?\s*(월|화|수|목|금)\s*요?\s*일?\s*[:\]】)]/g;
  const matches = [...text.matchAll(sectionPattern)];

  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i++) {
      const day = matches[i][1] as DayKey;
      const start = matches[i].index! + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
      const section = text.slice(start, end);

      const subjectMatches = section.matchAll(/(?:\d+\s*교시\s*[:\-]?\s*)?([가-힣]{2,}(?:\s*[,/]\s*[가-힣]{2,})*)/g);
      for (const m of subjectMatches) {
        const subjects = m[1].split(/[,/]/).map(s => s.trim()).filter(s => s.length >= 2);
        days[day].subjects.push(...subjects);
      }

      const itemMatch = section.match(/준비물\s*[:\-]?\s*([^\n]+)/);
      if (itemMatch) {
        const items = splitItems(itemMatch[1]);
        for (const item of items) if (!days[day].items.includes(item)) days[day].items.push(item);
      }

      const noteMatch = section.match(/(?:특이사항|알림)\s*[:\-]?\s*([^\n]+)/);
      if (noteMatch) days[day].notes = noteMatch[1].trim();
    }
  }

  return { days, week };
}

function findDayHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 5); i++) {
    const dayCount = table[i].filter(cell => DAYS.some(d => DAY_PATTERNS[d].test(cell))).length;
    if (dayCount >= 3) return i;
  }
  return -1;
}

function mapDayColumns(headerRow: string[]): Partial<Record<DayKey, number>> {
  const map: Partial<Record<DayKey, number>> = {};
  headerRow.forEach((cell, idx) => {
    for (const day of DAYS) {
      if (DAY_PATTERNS[day].test(cell) && !(day in map)) map[day] = idx;
    }
  });
  return map;
}

function splitItems(text: string): string[] {
  return text.split(/[,，/·\n]/).map(s => s.replace(/^\s*[-•*]\s*/, '').trim()).filter(s => s.length > 0 && s !== '-');
}
