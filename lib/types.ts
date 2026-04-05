export interface Child {
  id: string;
  name: string;
  school: string;
  grade: number;
  className: string;
  boardUrl: string;
  color: string;
}

export interface DaySchedule {
  hasPE: boolean;
  subjects: string[];
  items: string[];
  notes: string;
}

export type DayKey = '월' | '화' | '수' | '목' | '금';

export interface WeeklySchedule {
  childId: string;
  week: string;
  fetchedAt: string;
  days: Record<DayKey, DaySchedule>;
  sourceUrl?: string;
  imageUrls?: string[];
  error?: string;
  debug?: string[];     // 개발용 진단 로그
}

export const DAYS: DayKey[] = ['월', '화', '수', '목', '금'];

export const CHILD_COLORS = [
  { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-400', text: 'text-orange-700', light: 'bg-orange-100' },
  { bg: 'bg-sky-50', border: 'border-sky-200', badge: 'bg-sky-400', text: 'text-sky-700', light: 'bg-sky-100' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-400', text: 'text-emerald-700', light: 'bg-emerald-100' },
];
