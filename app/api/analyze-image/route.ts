import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { DAYS, WeeklySchedule } from '@/lib/types';

const PE_KEYWORDS = ['체육', '체조', '스포츠', '수영'];

export async function POST(req: NextRequest) {
  try {
    const { imageData, mimeType, childId, grade, className } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageData,
            },
          },
          {
            type: 'text',
            text: `이 주간학습안내 이미지에서 ${grade}학년 ${className}반의 시간표를 추출해주세요.

다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "week": "주차 텍스트 (예: 4/7~4/11)",
  "days": {
    "월": { "subjects": ["국어", "수학", "체육"], "items": ["준비물명"], "notes": "" },
    "화": { "subjects": [...], "items": [...], "notes": "" },
    "수": { "subjects": [...], "items": [...], "notes": "" },
    "목": { "subjects": [...], "items": [...], "notes": "" },
    "금": { "subjects": [...], "items": [...], "notes": "" }
  }
}

규칙:
- subjects: 교시 순서대로 과목명 배열
- items: 해당 날 챙길 준비물 (체육 수업이 있으면 반드시 "체육복"과 "운동화" 포함)
- notes: 현장학습·행사 등 특이사항 (없으면 빈 문자열 "")
- 해당 학년/반이 이미지에 없으면 전체 시간표를 기반으로 최대한 추출`
          }
        ]
      }]
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('응답에서 JSON을 찾을 수 없습니다.');

    const parsed = JSON.parse(jsonMatch[0]);

    const days = Object.fromEntries(
      DAYS.map(day => {
        const d = parsed.days?.[day] ?? { subjects: [], items: [], notes: '' };
        const subjects: string[] = d.subjects ?? [];
        const hasPE = subjects.some(s => PE_KEYWORDS.some(k => s.includes(k)));
        const items: string[] = d.items ?? [];
        if (hasPE && !items.some(i => i.includes('체육복'))) {
          items.unshift('운동화', '체육복');
        }
        return [day, { hasPE, subjects, items, notes: d.notes ?? '' }];
      })
    ) as WeeklySchedule['days'];

    const schedule: WeeklySchedule = {
      childId,
      week: parsed.week ?? '이번 주',
      fetchedAt: new Date().toISOString(),
      days,
    };

    return NextResponse.json(schedule);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
