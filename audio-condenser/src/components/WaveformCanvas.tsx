import React, { useRef, useEffect, useState } from 'react';
import { KeepZone } from '../types';

interface WaveformCanvasProps {
  peaks: Float32Array;
  duration: number;
  zones: KeepZone[];
  currentTime: number;
  crossfadeSec: number;
  isPlayingOriginal: boolean;
  onSeek?: (time: number) => void;
  onUpdateZone?: (id: string, start: number, end: number) => void;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  duration,
  zones,
  currentTime,
  crossfadeSec,
  isPlayingOriginal,
  onSeek,
  onUpdateZone,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  const [dimensions, setDimensions] = useState({ width: 800, height: 160 });
  const [draggingZoneId, setDraggingZoneId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'start' | 'end' | 'move' | null>(null);
  const [initialDragX, setInitialDragX] = useState(0);
  const [initialTimeVal, setInitialTimeVal] = useState({ start: 0, end: 0 });

  // Handle resizing of the container reactively
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        // set height proportionally
        setDimensions({ width, height: 160 });
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Redraw instructions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    
    // Support high DPI screens
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Clear background (soft slate-50 feel or light gray)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Draw horizontal split line
    const splitY = height * 0.65;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY);
    ctx.lineTo(width, splitY);
    ctx.stroke();

    if (peaks.length === 0 || duration === 0) {
      // Draw empty text message
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('오디오 분석 중...', width / 2, height / 2);
      return;
    }

    // --- LANE 1: ORIGINAL MOVEMENT AND KEEP ZONES (0 to splitY) ---
    // Draw raw waveform
    const ampHeight = splitY * 0.7;
    const centerY = splitY / 2 + 10;
    const peakSpacing = width / peaks.length;
    
    ctx.fillStyle = '#cbd5e1'; // Inactive waveform color
    for (let i = 0; i < peaks.length; i++) {
      const peakVal = peaks[i];
      const barHeight = peakVal * ampHeight;
      const x = i * peakSpacing;
      
      // Draw symmetrical bars
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, peakSpacing - 0.5), barHeight);
    }

    // DRAW ACTIVE ZONES
    const secondsToPix = (sec: number) => (sec / duration) * width;
    const pixToSeconds = (pix: number) => (pix / width) * duration;

    // Soft color palettes for 3 sections (Slate blue, Indigo, Teal/Emerald)
    const zoneColors = [
      { fill: 'rgba(99, 102, 241, 0.15)', stroke: '#6366f1', text: '#4f46e5', name: '시작 구간 (Intro)' },
      { fill: 'rgba(236, 72, 153, 0.13)', stroke: '#ec4899', text: '#db2777', name: '하이라이트 (Chorus)' },
      { fill: 'rgba(20, 184, 166, 0.15)', stroke: '#14b8a6', text: '#0d9488', name: '종료 구간 (Outro)' },
    ];

    zones.forEach((zone, index) => {
      const startX = secondsToPix(zone.startTime);
      const endX = secondsToPix(zone.endTime);
      const zoneW = endX - startX;
      const palette = zoneColors[index % zoneColors.length];

      // Draw tinted glass zone background
      ctx.fillStyle = palette.fill;
      ctx.fillRect(startX, 0, zoneW, splitY);

      // Draw highlighted vertical lines for edges
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Start vertical edge
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, splitY);
      // End vertical edge
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, splitY);
      ctx.stroke();

      // Draw visual dragging handles on edges
      ctx.fillStyle = palette.stroke;
      ctx.beginPath();
      ctx.arc(startX, splitY / 2, 5, 0, Math.PI * 2);
      ctx.arc(endX, splitY / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Top label tag
      ctx.fillStyle = palette.stroke;
      ctx.fillRect(startX, 0, Math.min(130, zoneW), 18);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${zone.name}`, startX + 6, 12);

      // Duration label at bottom of zone
      ctx.fillStyle = palette.text;
      ctx.font = '10px Roboto, monospace';
      ctx.textAlign = 'center';
      const secText = `${zone.startTime.toFixed(1)}s - ${zone.endTime.toFixed(1)}s (${(zone.endTime - zone.startTime).toFixed(1)}s)`;
      ctx.fillText(secText, startX + zoneW / 2, splitY - 8);
    } );

    // Draw Original Current Time play line
    if (isPlayingOriginal && currentTime > 0 && currentTime < duration) {
      const playLineX = secondsToPix(currentTime);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playLineX, 0);
      ctx.lineTo(playLineX, splitY);
      ctx.stroke();

      // Handle pointer circle
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(playLineX, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    }


    // --- LANE 2: SPLICE TIMELINE (LANE SHOWING HOW CHUNKS JOIN TOGETHER) (splitY to height) ---
    // Left outline of shortened tracks
    const lane2Y = splitY + (height - splitY) / 2;
    const lane2Height = (height - splitY) * 0.7;
    const lane2Top = splitY + (height - splitY) * 0.15;

    // Calculate sum of active block lengths
    let totalCondensedDuration = 0;
    zones.forEach((z) => {
      totalCondensedDuration += (z.endTime - z.startTime);
    });
    // Subtract crossfade savings (each overlapping crossfade removes crossfadeSec worth of play length)
    const activeTransitions = Math.max(0, zones.length - 1);
    const estimatedPlaybackLength = Math.max(1, totalCondensedDuration - (activeTransitions * crossfadeSec));

    // Fill output background track
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, splitY, width, height - splitY);

    // Draw "Result Playback" indicator line
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`축약 예상본 구성 (총 길이: ${formatDuration(estimatedPlaybackLength)})`, 12, splitY + 16);

    // Now let's draw the individual boxes side-by-side with crossfade gradient joins!
    let accumulatedX = 0;
    const outputSizingRatio = width / totalCondensedDuration; // stretch relative to summing components

    zones.forEach((zone, index) => {
      const blockWidth = (zone.endTime - zone.startTime) * outputSizingRatio;
      const startX = accumulatedX;
      const endX = accumulatedX + blockWidth;
      const palette = zoneColors[index % zoneColors.length];

      // Block background
      ctx.fillStyle = palette.fill;
      ctx.fillRect(startX, lane2Top, blockWidth, lane2Height);
      
      // Outline
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, lane2Top, blockWidth, lane2Height);

      // Label inside
      ctx.fillStyle = palette.text;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.name.split(' ')[0], startX + blockWidth / 2, lane2Top + lane2Height / 2 + 3);

      // Draw crossfade blending ribbon between blocks
      if (index > 0 && crossfadeSec > 0) {
        const xFadePixels = (crossfadeSec) * outputSizingRatio;
        const xFadeStartX = startX - xFadePixels / 2;
        
        // Ribbon visualization showing mix
        ctx.fillStyle = 'rgba(79, 70, 229, 0.25)'; // Purple blend
        ctx.fillRect(Math.max(0, xFadeStartX), lane2Top, xFadePixels, lane2Height);
        
        // Cross lines
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xFadeStartX, lane2Top);
        ctx.lineTo(xFadeStartX + xFadePixels, lane2Top + lane2Height);
        ctx.moveTo(xFadeStartX + xFadePixels, lane2Top);
        ctx.lineTo(xFadeStartX, lane2Top + lane2Height);
        ctx.stroke();
      }

      accumulatedX += blockWidth;
    });

  }, [dimensions, peaks, duration, zones, currentTime, crossfadeSec, isPlayingOriginal]);

  // Convert time to human friendly string
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Canvas Mouse interaction handlers (Dragging zone edges!)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const splitY = dimensions.height * 0.65;
    
    // Clicking top pane allows modifications
    if (y < splitY) {
      const clickTime = (x / dimensions.width) * duration;
      
      // Check if clicking near any zone boundary (within 10 pixels / ~1.5% accuracy)
      const thresholdTime = (12 / dimensions.width) * duration;
      
      for (const zone of zones) {
        if (Math.abs(clickTime - zone.startTime) < thresholdTime) {
          setDraggingZoneId(zone.id);
          setDragType('start');
          setInitialDragX(x);
          setInitialTimeVal({ start: zone.startTime, end: zone.endTime });
          return;
        }
        if (Math.abs(clickTime - zone.endTime) < thresholdTime) {
          setDraggingZoneId(zone.id);
          setDragType('end');
          setInitialDragX(x);
          setInitialTimeVal({ start: zone.startTime, end: zone.endTime });
          return;
        }
        if (clickTime > zone.startTime && clickTime < zone.endTime) {
          setDraggingZoneId(zone.id);
          setDragType('move');
          setInitialDragX(x);
          setInitialTimeVal({ start: zone.startTime, end: zone.endTime });
          return;
        }
      }

      // If clicked empty region, perform standard seek
      if (onSeek) {
        onSeek(clickTime);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0 || !draggingZoneId || !dragType || !onUpdateZone) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const deltaPix = x - initialDragX;
    const deltaTime = (deltaPix / dimensions.width) * duration;

    let newStart = initialTimeVal.start;
    let newEnd = initialTimeVal.end;

    if (dragType === 'start') {
      newStart = Math.max(0, Math.min(initialTimeVal.end - 1, initialTimeVal.start + deltaTime));
    } else if (dragType === 'end') {
      newEnd = Math.max(initialTimeVal.start + 1, Math.min(duration, initialTimeVal.end + deltaTime));
    } else if (dragType === 'move') {
      const length = initialTimeVal.end - initialTimeVal.start;
      newStart = Math.max(0, Math.min(duration - length, initialTimeVal.start + deltaTime));
      newEnd = newStart + length;
    }

    onUpdateZone(draggingZoneId, newStart, newEnd);
  };

  const handleMouseUp = () => {
    setDraggingZoneId(null);
    setDragType(null);
  };

  return (
    <div id="waveform-controller-container" ref={containerRef} className="w-full select-none cursor-ew-resize">
      <canvas
        id="waveform-canvas-element"
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      />
      <div id="waveform-guide-text" className="flex justify-between text-xs text-slate-400 mt-1 cursor-default">
        <span>0:00 (시작)</span>
        <span className="text-center font-medium text-slate-500">
          💡 마우스 드래그로 각 음원 추출 구간의 길이를 자유롭게 변경 및 이동할 수 있습니다
        </span>
        <span>{formatDuration(duration)} (끝)</span>
      </div>
    </div>
  );
};
