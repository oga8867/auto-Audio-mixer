import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables (.env files)
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON requests
  app.use(express.json());

  // Initialize Gemini API Client
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } else {
    console.warn('⚡ Warning: GEMINI_API_KEY env variable is not set. AI advisor features will fallback to client-side heuristics.');
  }

  // --- API ROUTE: SUGGEST CUTS FOR AUDIO CONDENSER ---
  app.post('/api/suggest-cuts', async (req, res) => {
    const { songTitle, artist, duration, targetMin = 90, targetMax = 120 } = req.body;

    if (!songTitle) {
      return res.status(400).json({ error: '곡 제목(songTitle)은 필수 항목입니다.' });
    }

    if (!duration || isNaN(duration) || duration <= 0) {
      return res.status(400).json({ error: '유효하지 않은 곡 길이(duration)입니다.' });
    }

    if (!ai) {
      return res.status(503).json({
        error: 'Gemini API 클라이언트가 모듈에서 초기화되지 않았습니다. API 키 설정을 확인해 주세요.',
        fallback: true
      });
    }

    try {
      const prompt = `
        다음 곡에 대해 1분 30초 ~ 2분 (${targetMin}초 - ${targetMax}초) 정도의 자연스러운 "숏 에딧 / 라디오 에딧 (Radio Edit)" 축약 버전을 만들기 위한 오디오 편집 구간 정보를 제안해 주십시오.

        [곡 세부정보]
        - 제목: ${songTitle}
        - 아티스트: ${artist || '미상'}
        - 원곡 전체 길이: ${duration.toFixed(1)}초 (약 ${Math.floor(duration / 60)}분 ${Math.floor(duration % 60)}초)

        [편곡 요구 조건]
        1. 원곡 길이(${duration.toFixed(1)}초) 내에서 유효한 범위의 2개 또는 3개의 핵심 구간(Keep Zones)을 정의하세요.
        2. 각 구간의 startTime과 endTime은 항상 0 이상, ${duration.toFixed(1)} 이하의 초 단위 숫자여야 하며, startTime < endTime 이어야 합니다.
        3. 각 구간은 아래 표준 양식을 따르거나 유사한 자연스러운 전환 흐름을 가져야 합니다:
           - 구간 1 (시작): 곡의 전반부 및 인트로 (예: 0초부터 25~35초 내외 시작 부분 유지)
           - 구간 2 (하이라이트): 곡의 하이라이트 코러스/싸비 부분 (예: 원곡에서 폭발적이거나 대표적인 멜로디 파트 유지, 약 40~50초 파트)
           - 구간 3 (종료): 곡의 후반부 아웃트로 및 피날레 (예: 곡의 끝부분 20~30초 유지)
        4. 제안된 모든 구간들의 개별 연주 시간 총합이 크로스페이드 전조(약 6-8초 차감)를 고한 후 최종 재생 길이가 반드시 ${targetMin}초 ~ ${targetMax}초 범위에 수렴하도록 설계하세요.
        5. 친절하고 구체적인 한국어 설명(explanation)을 포함해 주세요. 예를 들어 해당 초 단위 범위를 선정한 이유와 음악적 흐름을 설명해 주세요.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cuts: {
                type: Type.ARRAY,
                description: '축약 음원에 포함할 2~3개의 개별 핵심 구간 타임 테이블',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { 
                      type: Type.STRING, 
                      description: '구간 레이블명 (예: "시작부 (Intro/Verse)", "하이라이트 (Chorus/Hook)", "종료부 (Outro)")' 
                    },
                    startTime: { 
                      type: Type.NUMBER, 
                      description: '오디오 구간이 시작하는 타임스탬프 (초 단위)' 
                    },
                    endTime: { 
                      type: Type.NUMBER, 
                      description: '오디오 구간이 끝나는 타임스탬프 (초 단위)' 
                    }
                  },
                  required: ['name', 'startTime', 'endTime']
                }
              },
              explanation: { 
                type: Type.STRING, 
                description: '이 추천 선정을 뒷받침하는 배경 설명과 전환 팁 (한국어로 작성)' 
              }
            },
            required: ['cuts', 'explanation']
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini API가 빈 응답을 반환했습니다.');
      }

      const suggestionData = JSON.parse(responseText.trim());
      
      // Post-process safety checks on timestamps to ensure they are fully within boundaries
      if (suggestionData.cuts && Array.isArray(suggestionData.cuts)) {
        suggestionData.cuts = suggestionData.cuts.map((cut: any) => {
          let s = Math.max(0, Math.min(duration - 1, Number(cut.startTime) || 0));
          let e = Math.max(s + 1, Math.min(duration, Number(cut.endTime) || duration));
          // Round to one decimal point for cleaner UI sliders
          s = Math.round(s * 10) / 10;
          e = Math.round(e * 10) / 10;
          return {
            name: cut.name || '추천 구간',
            startTime: s,
            endTime: e
          };
        });
      }

      return res.json(suggestionData);
    } catch (error: any) {
      console.error('Error generating AI cuts suggestion:', error);
      return res.status(500).json({
        error: 'AI 분할 제안 생성 중 서버 내부에러가 발생했습니다.',
        details: error.message || String(error)
      });
    }
  });

  // --- VITE MIDDLEWARE CONFIGURATION ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('⚡ Vite development middleware loaded.');
  } else {
    // Serve static files in production mode from standard 'dist' build directory
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('⚡ Production static files distribution configured.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Fully compliant server listening on virtual interface port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('🚨 Failed to boot custom Express + Vite hybrid wrapper:', err);
});
