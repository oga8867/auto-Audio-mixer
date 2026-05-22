import React from 'react';
import { KeepZone } from '../types';
import { Clock, Plus, Trash2, ArrowRight, Music, Sparkles } from 'lucide-react';

interface KeepZoneEditorProps {
  zones: KeepZone[];
  duration: number;
  onUpdateZone: (id: string, start: number, end: number) => void;
  onAddZone: () => void;
  onDeleteZone: (id: string) => void;
  onIdentifyChorus: () => void; // Auto detect chorus
  hasChorusMatched: boolean;
}

export const KeepZoneEditor: React.FC<KeepZoneEditorProps> = ({
  zones,
  duration,
  onUpdateZone,
  onAddZone,
  onDeleteZone,
  onIdentifyChorus,
  hasChorusMatched,
}) => {

  const formatSec = (sec: number) => {
    const min = Math.floor(sec / 60);
    const remainder = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${min}:${remainder.toString().padStart(2, '0')}.${ms}`;
  };

  const handleChangeStart = (id: string, value: number, end: number) => {
    const val = Math.max(0, Math.min(end - 0.5, value));
    onUpdateZone(id, val, end);
  };

  const handleChangeEnd = (id: string, value: number, start: number) => {
    const val = Math.max(start + 0.5, Math.min(duration, value));
    onUpdateZone(id, start, val);
  };

  return (
    <div id="keep-zone-editor" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-indigo-500" />
          <h3 className="font-semibold text-slate-800">합성 구간 편곡 리스트</h3>
        </div>
        
        <div className="flex gap-2">
          <button
            type="button"
            id="btn-auto-detect-chorus"
            onClick={onIdentifyChorus}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${
              hasChorusMatched
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 border-slate-200 shadow-sm'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            AI 하이라이트 분석 추천
          </button>
          
          <button
            type="button"
            id="btn-add-custom-zone"
            onClick={onAddZone}
            disabled={zones.length >= 4}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            구간 추가
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        {zones.map((zone, index) => {
          const zoneDuration = zone.endTime - zone.startTime;
          
          return (
            <div
              key={zone.id}
              id={`keep-zone-row-${zone.id}`}
              className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all"
            >
              <div className="flex items-center gap-3 min-w-[140px]">
                <span className="flex items-center justify-center w-6 h-6 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-full">
                  {index + 1}
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">{zone.name}</h4>
                  <p className="text-xs text-slate-400 font-mono">길이: {zoneDuration.toFixed(1)}초</p>
                </div>
              </div>

              {/* Slider Controller */}
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-xs text-slate-500 font-mono">
                  <span>시작점: {formatSec(zone.startTime)}</span>
                  <span>끝점: {formatSec(zone.endTime)}</span>
                </div>
                
                {/* Horizontal dual-slider handle fallback */}
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={zone.startTime}
                    onChange={(e) => handleChangeStart(zone.id, parseFloat(e.target.value), zone.endTime)}
                    className="w-full accent-indigo-600 h-1 bg-slate-100 rounded-lg cursor-pointer"
                  />
                  <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={zone.endTime}
                    onChange={(e) => handleChangeEnd(zone.id, parseFloat(e.target.value), zone.startTime)}
                    className="w-full accent-rose-500 h-1 bg-slate-100 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Exact +/- offset tools */}
              <div className="flex items-center justify-end gap-2 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onUpdateZone(zone.id, Math.max(0, zone.startTime - 1), zone.endTime)}
                    className="p-1 text-[11px] font-medium border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
                    title="시작 1초 앞으로"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateZone(zone.id, Math.min(zone.endTime - 0.5, zone.startTime + 1), zone.endTime)}
                    className="p-1 text-[11px] font-medium border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
                    title="시작 1초 뒤로"
                  >
                    +1s
                  </button>
                </div>
                
                <span className="text-slate-200">|</span>
                
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onUpdateZone(zone.id, zone.startTime, Math.max(zone.startTime + 0.5, zone.endTime - 1))}
                    className="p-1 text-[11px] font-medium border border-slate-200 rounded text-rose-600 hover:bg-slate-50"
                    title="종료 1초 앞으로"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateZone(zone.id, zone.startTime, Math.min(duration, zone.endTime + 1))}
                    className="p-1 text-[11px] font-medium border border-slate-200 rounded text-rose-600 hover:bg-slate-50"
                    title="종료 1초 뒤로"
                  >
                    +1s
                  </button>
                </div>

                {zones.length > 1 && (
                  <>
                    <span className="text-slate-200">|</span>
                    <button
                      type="button"
                      onClick={() => onDeleteZone(zone.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded hover:bg-rose-50 transition-all"
                      title="구간 제거"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
