export interface Child {
  id: string;
  name: string;
  school: string;
  grade: number;
  className: string;
  boardUrl: string;
  color: string; // UI color theme per child
}

export interface DaySchedule {
  hasPE: boolean;
  subjects: string[];   // ['국어', '수학', '체육', ...] 교시 순서대로
  items: string[];      // 준비물
  notes: string;        // 특이사항
}

export type DayKey = '월' | '화' | '수' | '목' | '금';

export interface WeeklySchedule {
  childId: string;
  week: string;
  fetchedAt: string;
  days: Record<DayKey, DaySchedule>;
  imageUrls?: string[];   // 주간학습안내 이미지 URL
  error?: string;
}

export const DAYS: DayKey[] = ['월', '화', '수', '목', '금'];

export const CHILD_COLORS = [
  { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-400', text: 'text-orange-700', light: 'bg-orange-100' },
  { bg: 'bg-sky-50', border: 'border-sky-200', badge: 'bg-sky-400', text: 'text-sky-700', light: 'bg-sky-100' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-400', text: 'text-emerald-700', light: 'bg-emerald-100' },
];
