'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Child, WeeklySchedule, DayKey, DAYS } from '@/lib/types';
import { getChildren, getScheduleForChild, saveSchedule } from '@/lib/storage';
import ChildCard from '@/components/ChildCard';

const DAY_LABEL: Record<DayKey, string> = { 월: '월', 화: '화', 수: '수', 목: '목', 금: '금' };
const DAY_NUM_MAP: Record<number, DayKey> = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };

function getRealTodayKey(): DayKey | null { return DAY_NUM_MAP[new Date().getDay()] ?? null; }
function getRealTomorrowKey(): DayKey | null {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return DAY_NUM_MAP[d.getDay()] ?? null;
}
function getDefaultDay(): DayKey { return getRealTodayKey() ?? '월'; }
function isWeekend(): boolean { const d = new Date().getDay(); return d === 0 || d === 6; }

export default function DashboardPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [schedules, setSchedules] = useState<Record<string, WeeklySchedule | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [selectedDay, setSelectedDay] = useState<DayKey>(getDefaultDay());

  useEffect(() => {
    const kids = getChildren();
    setChildren(kids);
    const initial: Record<string, WeeklySchedule | null> = {};
    kids.forEach(k => { initial[k.id] = getScheduleForChild(k.id); });
    setSchedules(initial);
  }, []);

  const refreshChild = useCallback(async (child: Child) => {
    setLoading(prev => ({ ...prev, [child.id]: true }));
    try {
      const res = await fetch('/api/fetch-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardUrl: child.boardUrl,
          childId: child.id,
          grade: child.grade,
          className: child.className,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // debug 정보를 에러 스케줄에 보존
        const errorSchedule: WeeklySchedule = {
          childId: child.id,
          week: '오류',
          fetchedAt: new Date().toISOString(),
          days: Object.fromEntries(DAYS.map(d => [d, { hasPE: false, subjects: [], items: [], notes: '' }])) as unknown as WeeklySchedule['days'],
          error: data.error ?? '서버 오류',
          ...(data.debug ? { debug: data.debug } : {}),
        };
        saveSchedule(errorSchedule);
        setSchedules(prev => ({ ...prev, [child.id]: errorSchedule }));
        return;
      }
      saveSchedule(data);
      setSchedules(prev => ({ ...prev, [child.id]: data }));
    } catch (err) {
      const errorSchedule: WeeklySchedule = {
        childId: child.id,
        week: '오류',
        fetchedAt: new Date().toISOString(),
        days: Object.fromEntries(DAYS.map(d => [d, { hasPE: false, subjects: [], items: [], notes: '' }])) as unknown as WeeklySchedule['days'],
        error: err instanceof Error ? err.message : '알 수 없는 오류',
      };
      saveSchedule(errorSchedule);
      setSchedules(prev => ({ ...prev, [child.id]: errorSchedule }));
    } finally {
      setLoading(prev => ({ ...prev, [child.id]: false }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    children.forEach(c => refreshChild(c));
  }, [children, refreshChild]);

  const todayKey = getRealTodayKey();
  const tomorrowKey = getRealTomorrowKey();
  const weekend = isWeekend();
  const peCount = children.filter(c => schedules[c.id]?.days[selectedDay]?.hasPE).length;

  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🏫</div>
        <h1 className="text-2xl font-bold text-amber-800 mb-2">학교 준비물 도우미</h1>
        <p className="text-amber-600 mb-6 text-sm leading-relaxed">
          아이들 정보를 등록하면<br />매일 체육복과 준비물을 한눈에 볼 수 있어요!
        </p>
        <Link href="/settings" className="bg-amber-500 text-white px-6 py-3 rounded-full font-bold text-base shadow-md active:scale-95 transition-transform">
          아이 등록하기
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-amber-800">학교 준비물 도우미</h1>
            {weekend ? (
              <p className="text-xs text-gray-400">주말 · 다음 주 시간표를 확인하세요</p>
            ) : peCount > 0 ? (
              <p className="text-xs text-red-500 font-medium">오늘 체육복 입을 아이 {peCount}명</p>
            ) : (
              <p className="text-xs text-gray-400">
                {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              className="text-sm px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full font-medium active:scale-95 transition-transform"
            >
              전체 새로고침
            </button>
            <Link href="/settings" className="text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full font-medium active:scale-95 transition-transform">
              설정
            </Link>
          </div>
        </div>
      </header>

      {/* 요일 탭 */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 flex gap-1 overflow-x-auto py-2">
          {DAYS.map(day => {
            const isToday = !weekend && day === todayKey;
            const isTomorrow = !weekend && day === tomorrowKey;
            const anyPE = children.some(c => schedules[c.id]?.days[day]?.hasPE);
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`flex-shrink-0 relative px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedDay === day ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {DAY_LABEL[day]}
                {isToday && <span className="ml-0.5 text-xs opacity-80">오늘</span>}
                {isTomorrow && <span className="ml-0.5 text-xs opacity-80">내일</span>}
                {anyPE && selectedDay !== day && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 카드 목록 */}
      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {children.map((child, idx) => (
          <ChildCard
            key={child.id}
            child={child}
            schedule={schedules[child.id] ?? null}
            targetDay={selectedDay}
            colorIndex={idx}
            onRefresh={() => refreshChild(child)}
            isLoading={loading[child.id] ?? false}
          />
        ))}
      </main>
    </div>
  );
}
