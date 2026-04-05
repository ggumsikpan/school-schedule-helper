'use client';

import { Child, WeeklySchedule } from './types';

const CHILDREN_KEY = 'ssh_children';
const SCHEDULES_KEY = 'ssh_schedules';

export function getChildren(): Child[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CHILDREN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveChildren(children: Child[]): void {
  localStorage.setItem(CHILDREN_KEY, JSON.stringify(children));
}

export function getSchedules(): WeeklySchedule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    const schedules: WeeklySchedule[] = raw ? JSON.parse(raw) : [];
    // subjects 필드 없는 구버전 데이터 보정
    return schedules.map(s => ({
      ...s,
      days: Object.fromEntries(
        Object.entries(s.days).map(([day, d]) => [
          day,
          { subjects: [], items: [], notes: '', hasPE: false, ...d },
        ])
      ) as WeeklySchedule['days'],
    }));
  } catch {
    return [];
  }
}

export function saveSchedule(schedule: WeeklySchedule): void {
  const schedules = getSchedules().filter(s => s.childId !== schedule.childId);
  schedules.push(schedule);
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(schedules));
}

export function getScheduleForChild(childId: string): WeeklySchedule | null {
  return getSchedules().find(s => s.childId === childId) ?? null;
}
