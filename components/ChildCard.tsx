'use client';

import { useState } from 'react';
import { Child, WeeklySchedule, DayKey, DAYS, CHILD_COLORS } from '@/lib/types';

interface Props {
  child: Child;
  schedule: WeeklySchedule | null;
  targetDay: DayKey;
  colorIndex: number;
  onRefresh: () => void;
  isLoading: boolean;
}

const PE_KEYWORDS = ['체육', '체조', '수영', '스포츠'];
function isPE(subject: string) { return PE_KEYWORDS.some(k => subject.includes(k)); }

export default function ChildCard({ child, schedule, targetDay, colorIndex, onRefresh, isLoading }: Props) {
  const [showImageModal, setShowImageModal] = useState(false);
  const color = CHILD_COLORS[colorIndex % CHILD_COLORS.length];
  const dayData = schedule?.days[targetDay];
  const hasPE = dayData?.hasPE ?? false;

  return (
    <div className={`rounded-2xl border-2 ${hasPE ? 'border-red-300 bg-red-50' : `${color.border} ${color.bg}`} shadow-sm overflow-hidden`}>

      {/* 헤더 */}
      <div className={`px-4 py-3 flex items-center justify-between ${hasPE ? 'bg-red-100' : color.light}`}>
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-full ${hasPE ? 'bg-red-400' : color.badge} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
            {child.name[0]}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className={`font-bold text-base ${hasPE ? 'text-red-700' : color.text}`}>{child.name}</p>
              {hasPE && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">👕 체육복!</span>}
            </div>
            <p className="text-xs text-gray-500">{child.school} {child.grade}학년 {child.className}반</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`text-xs px-3 py-1.5 rounded-full font-medium disabled:opacity-50 active:scale-95 transition-transform ${hasPE ? 'bg-red-200 text-red-700' : `${color.bg} ${color.text}`}`}
        >
          {isLoading ? '확인 중...' : '새로고침'}
        </button>
      </div>

      {/* 시간표 없음 */}
      {!schedule && !isLoading && (
        <div className="px-4 py-5 text-center text-gray-400 text-sm">
          <p>시간표 정보가 없어요</p>
          <p className="text-xs mt-1">새로고침을 눌러 학교 홈페이지에서 가져와요</p>
        </div>
      )}

      {/* 로딩 */}
      {isLoading && (
        <div className="px-4 py-5 text-center text-gray-400 text-sm animate-pulse">
          학교 홈페이지에서 시간표 분석 중...
        </div>
      )}

      {/* 시간표 */}
      {schedule && !isLoading && dayData && (
        <div className="px-4 py-3 space-y-3">

          {/* 교시별 시간표 */}
          {(dayData.subjects?.length ?? 0) > 0 ? (
            <div>
              <p className="text-xs font-bold text-gray-400 mb-1.5">{targetDay}요일 시간표</p>
              <div className="grid grid-cols-1 gap-1">
                {dayData.subjects.map((subject, i) => {
                  const pe = isPE(subject);
                  return (
                    <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${pe ? 'bg-red-100 border border-red-200' : 'bg-white border border-gray-100'}`}>
                      <span className={`text-xs font-mono w-8 shrink-0 ${pe ? 'text-red-400' : 'text-gray-300'}`}>{i + 1}교시</span>
                      <span className={`font-medium text-sm ${pe ? 'text-red-600' : 'text-gray-700'}`}>{subject}</span>
                      {pe && <span className="ml-auto text-base">👟</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${hasPE ? 'bg-red-100 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
              <span className="text-2xl">{hasPE ? '👕' : '👗'}</span>
              <div>
                <p className={`font-bold text-sm ${hasPE ? 'text-red-600' : 'text-gray-500'}`}>{hasPE ? '체육복 착용' : '평상복 착용'}</p>
                {!hasPE && <p className="text-xs text-gray-400">체육 수업 없음</p>}
              </div>
            </div>
          )}

          {/* 이번 주 체육 요일 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400">이번 주 체육:</span>
            {DAYS.map(day => schedule.days[day]?.hasPE ? (
              <span key={day} className={`text-xs px-2 py-0.5 rounded-full font-medium ${day === targetDay ? 'bg-red-500 text-white' : 'bg-red-100 text-red-500'}`}>{day}</span>
            ) : null)}
            {!DAYS.some(d => schedule.days[d]?.hasPE) && <span className="text-xs text-gray-300">없음</span>}
          </div>

          {/* 준비물 */}
          {(dayData.items?.length ?? 0) > 0 && (
            <div className={`rounded-xl px-3 py-2.5 ${hasPE ? 'bg-orange-50 border border-orange-200' : `${color.light} border ${color.border}`}`}>
              <p className={`text-xs font-bold mb-1.5 ${hasPE ? 'text-orange-600' : color.text}`}>챙길 준비물</p>
              <div className="flex flex-wrap gap-1.5">
                {dayData.items.map((item, i) => (
                  <span key={i} className={`text-xs px-2 py-1 rounded-full ${hasPE ? 'bg-orange-100 text-orange-700' : 'bg-white text-gray-600 border border-gray-200'}`}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 특이사항 */}
          {dayData.notes && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2">
              <p className="text-xs font-bold text-yellow-600 mb-0.5">알림</p>
              <p className="text-sm text-yellow-800">{dayData.notes}</p>
            </div>
          )}

          {/* 하단 버튼 영역 */}
          <div className="flex gap-2">
            {(schedule.imageUrls?.length ?? 0) > 0 && (
              <button
                onClick={() => setShowImageModal(true)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${hasPE ? 'border-red-200 text-red-500 bg-red-50' : `${color.border} ${color.text} ${color.light}`}`}
              >
                시간표 원본 보기
              </button>
            )}
            {schedule.sourceUrl && (
              <a
                href={schedule.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex-1 py-2 rounded-xl text-sm font-medium border text-center ${hasPE ? 'border-red-200 text-red-500 bg-red-50' : `${color.border} ${color.text} ${color.light}`}`}
              >
                게시물 바로가기 →
              </a>
            )}
          </div>

          <p className="text-xs text-gray-300 text-right">
            {schedule.week} · {new Date(schedule.fetchedAt).toLocaleDateString('ko-KR')} 업데이트
          </p>
        </div>
      )}

      {/* 에러 */}
      {schedule?.error && (
        <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm">
          <p className="font-medium text-red-600 mb-0.5">불러오기 실패</p>
          <p className="text-xs text-red-400 mb-1">{schedule.error}</p>
          {schedule.debug?.map((line, i) => (
            <p key={i} className="text-xs text-gray-400 font-mono">{line}</p>
          ))}
        </div>
      )}

      {/* 이미지 모달 */}
      {showImageModal && schedule?.imageUrls && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col" onClick={() => setShowImageModal(false)}>
          <div className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0">
            <p className="text-white font-medium text-sm">{child.name} 주간학습안내</p>
            <div className="flex items-center gap-3">
              {schedule.sourceUrl && (
                <a href={schedule.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-amber-300 underline" onClick={e => e.stopPropagation()}>
                  원본 사이트
                </a>
              )}
              <button className="text-white text-2xl leading-none" onClick={() => setShowImageModal(false)}>×</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4" onClick={e => e.stopPropagation()}>
            {schedule.imageUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={`주간학습안내 ${i + 1}`}
                className="w-full h-auto max-h-[80vh] object-contain rounded-xl shadow-lg bg-gray-900"
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
