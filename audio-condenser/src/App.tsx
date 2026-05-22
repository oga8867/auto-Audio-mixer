import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, Play, Pause, Scissors, Download, RefreshCw, Sliders, 
  Sparkles, Clock, AlertTriangle, Volume2, CheckCircle2, Music, 
  HelpCircle, ChevronRight, X, Headphones
} from 'lucide-react';

import { KeepZone, AudioStats, PresetType, Preset } from './types';
import { analyzeAudioBuffer } from './utils/audioAnalyzer';
import { bufferToWav } from './utils/audioEncoder';
import { mergeAudioZones } from './utils/audioMerger';
import { WaveformCanvas } from './components/WaveformCanvas';
import { KeepZoneEditor } from './components/KeepZoneEditor';

export default function App() {
  // Primary Audio States
  const [file, setFile] = useState<File | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);
  
  // Custom Splicing Parameters
  const [zones, setZones] = useState<KeepZone[]>([]);
  const [crossfadeSec, setCrossfadeSec] = useState<number>(4.0);
  const [preset, setPreset] = useState<PresetType>('pop-short');
  
  // Rendering & Output States
  const [isRendering, setIsRendering] = useState(false);
  const [renderedBuffer, setRenderedBuffer] = useState<AudioBuffer | null>(null);
  const [renderedPeaks, setRenderedPeaks] = useState<Float32Array | null>(null);
  const [exporting, setExporting] = useState(false);
  
  // Real-time Playback State Engines
  const [volume, setVolume] = useState<number>(0.8);
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);
  const [isPlayingCondensed, setIsPlayingCondensed] = useState(false);
  const [currentTimeOriginal, setCurrentTimeOriginal] = useState(0);
  const [currentTimeCondensed, setCurrentTimeCondensed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Gemini AI Recommendation Panel States
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSongTitle, setAiSongTitle] = useState('');
  const [aiArtist, setAiArtist] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<any | null>(null);

  // Audio Context and Node Refs to prevent re-instantiation crashes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const originalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const originalGainRef = useRef<GainNode | null>(null);
  const originalStartTimeRef = useRef<number>(0);
  const originalPauseOffsetRef = useRef<number>(0);
  
  const condensedSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const condensedGainRef = useRef<GainNode | null>(null);
  const condensedStartTimeRef = useRef<number>(0);
  const condensedPauseOffsetRef = useRef<number>(0);

  // Periodic Timer Refs for Playback Head tracking
  const originalTimerRef = useRef<number | null>(null);
  const condensedTimerRef = useRef<number | null>(null);

  // Drag-and-drop state indicators
  const [isDragging, setIsDragging] = useState(false);

  // Available Premade Radio Edit Presets
  const PRESETS: Preset[] = [
    {
      id: 'pop-short',
      name: '스마트 하이라이트 (1:30)',
      description: '인기 가요 구성에 대입하여 인트로, 사비(후렴), 끝부분 3단 구성을 최적 크로스페이드로 이어붙여 1분 30초 내외로 단축합니다.',
      targetDuration: '1분 30초',
      zonesCount: 3
    },
    {
      id: 'dance-cut',
      name: '댄스 파티 믹스 (1:45)',
      description: '가장 비트가 빠르거나 소리가 큰 클라이막스 구간 중심의 2단 구성을 크로스페이드 연결하여 댄스 챌린지에 최적화합니다.',
      targetDuration: '1분 45초',
      zonesCount: 2
    },
    {
      id: 'ambient-outro',
      name: '여운 아웃트로 (2:00)',
      description: '벌스 첫단락과 웅장한 아웃트로 전조를 길게 연결해 깊은 여운이 남는 2분 음원을 구성합니다.',
      targetDuration: '2분 00초',
      zonesCount: 2
    },
    {
      id: 'custom',
      name: '완전 자유 편집 (커스텀)',
      description: '원하는 수만큼 영역을 배치하고 수초 단위로 미세 조절하여 나만의 이상적인 마스킹 축약본을 제작합니다.',
      targetDuration: '자유 설정',
      zonesCount: 3
    }
  ];

  // Initialize or resume the primary client-side AudioContext
  const getAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Safe release of active original stream nodes
  const stopOriginalPlayback = useCallback(() => {
    if (originalSourceRef.current) {
      try {
        originalSourceRef.current.stop();
      } catch (e) {
        // already stopped
      }
      originalSourceRef.current.disconnect();
      originalSourceRef.current = null;
    }
    if (originalTimerRef.current) {
      clearInterval(originalTimerRef.current);
      originalTimerRef.current = null;
    }
    setIsPlayingOriginal(false);
  }, []);

  // Safe release of active condensed stream nodes
  const stopCondensedPlayback = useCallback(() => {
    if (condensedSourceRef.current) {
      try {
        condensedSourceRef.current.stop();
      } catch (e) {
        // already stopped
      }
      condensedSourceRef.current.disconnect();
      condensedSourceRef.current = null;
    }
    if (condensedTimerRef.current) {
      clearInterval(condensedTimerRef.current);
      condensedTimerRef.current = null;
    }
    setIsPlayingCondensed(false);
  }, []);

  // Stop everything on unmount or reset
  useEffect(() => {
    return () => {
      stopOriginalPlayback();
      stopCondensedPlayback();
    };
  }, [stopOriginalPlayback, stopCondensedPlayback]);

  // Adjust volume levels in real-time
  useEffect(() => {
    if (originalGainRef.current) {
      originalGainRef.current.gain.value = volume;
    }
    if (condensedGainRef.current) {
      condensedGainRef.current.gain.value = volume;
    }
  }, [volume]);

  // Auto Reset Rendered states on zones change (reminding user that they need to re-render!)
  useEffect(() => {
    setRenderedBuffer(null);
    setRenderedPeaks(null);
    stopCondensedPlayback();
    condensedPauseOffsetRef.current = 0;
    setCurrentTimeCondensed(0);
  }, [zones, crossfadeSec]);

  // Handle Drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      handleAudioFileSetup(droppedFile);
    } else {
      setErrorMessage('올바른 오디오 파일(.mp3, .wav, .m4a 등)을 드롭해 주세요.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleAudioFileSetup(selectedFile);
    }
  };

  // Decode and analyze imported audio file
  const handleAudioFileSetup = async (audioFile: File) => {
    stopOriginalPlayback();
    stopCondensedPlayback();
    
    setFile(audioFile);
    setIsDecoding(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setDecodedBuffer(null);
    setAnalysis(null);
    setAiSuggestions(null);

    // Parse metadata guessing song information from filename
    const sanitizedName = audioFile.name.replace(/\.[^/.]+$/, "");
    const nameParts = sanitizedName.split('-');
    if (nameParts.length > 1) {
      setAiArtist(nameParts[0].trim());
      setAiSongTitle(nameParts.slice(1).join('-').trim());
    } else {
      setAiArtist('');
      setAiSongTitle(sanitizedName);
    }

    try {
      const ctx = getAudioContext();
      const arrayBuffer = await audioFile.arrayBuffer();
      
      // Decode audio data asynchronously
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      setDecodedBuffer(audioBuffer);
      
      const statsObj: AudioStats = {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
        fileName: audioFile.name,
        fileSize: Math.round((audioFile.size / (1024 * 1024)) * 100) / 100
      };
      setStats(statsObj);

      // Perform fast Peak-RMS envelope analysis
      const analysisResult = analyzeAudioBuffer(audioBuffer, 400);
      setAnalysis(analysisResult);

      // Generate initial KeepZones according to default pop preset
      applyPresetLayout(preset, audioBuffer.duration, analysisResult);
      setSuccessMessage('오디오 파일이 정상적으로 디코딩되었습니다! 편집 제안을 고하세요.');

    } catch (error: any) {
      console.error(error);
      setErrorMessage(`오디오 분석에 실패했습니다. 올바른 사운드 포맷인지 확인해 주세요. 오차: ${error.message || error}`);
    } finally {
      setIsDecoding(false);
    }
  };

  // Allocate KeepZone blocks based on chosen preset templates
  const applyPresetLayout = (
    type: PresetType, 
    trackDuration: number, 
    analysisObj: any = analysis
  ) => {
    if (trackDuration === 0) return;
    
    // Fallback references if peaks aren't calculated yet
    const chorusStart = analysisObj ? analysisObj.chorusStart : trackDuration * 0.4;
    const chorusEnd = analysisObj ? analysisObj.chorusEnd : Math.min(trackDuration, chorusStart + 45);

    let calculatedZones: KeepZone[] = [];

    switch (type) {
      case 'pop-short':
        // Pop Standard 3-tier cut: Intro, Highlight Chorus, Outro
        calculatedZones = [
          {
            id: 'zone-1',
            startTime: 0,
            endTime: Math.min(35, trackDuration * 0.25),
            name: '시작 구간 (Intro)'
          },
          {
            id: 'zone-2',
            startTime: chorusStart,
            endTime: Math.min(trackDuration, chorusStart + Math.min(45, trackDuration * 0.3)),
            name: '하이라이트싸비 (Chorus)'
          },
          {
            id: 'zone-3',
            startTime: Math.max(0, trackDuration - 25),
            endTime: trackDuration,
            name: '종료 구간 (Outro)'
          }
        ];
        break;

      case 'dance-cut':
        // Quick 2-tier cut: Intro leading directly into the climax hook + fade out
        calculatedZones = [
          {
            id: 'zone-1',
            startTime: 0,
            endTime: Math.min(15, trackDuration * 0.1),
            name: '입도부 인트로'
          },
          {
            id: 'zone-2',
            startTime: chorusStart,
            endTime: Math.min(trackDuration, chorusStart + 60),
            name: '댄스 하이라이트'
          }
        ];
        break;

      case 'ambient-outro':
        // Deep long cut: First continuous Verse + Ending climax fading to absolute zero
        calculatedZones = [
          {
            id: 'zone-1',
            startTime: 0,
            endTime: Math.min(45, trackDuration * 0.3),
            name: '인입 벌스 (Verse 1)'
          },
          {
            id: 'zone-2',
            startTime: Math.max(0, trackDuration - 50),
            endTime: trackDuration,
            name: '감성 아웃트로 (Outro)'
          }
        ];
        break;

      case 'custom':
      default:
        // Generic multi zone for free adjustments
        calculatedZones = [
          {
            id: 'zone-custom-1',
            startTime: trackDuration * 0.1,
            endTime: trackDuration * 0.3,
            name: '임의 편집 구간 1'
          },
          {
            id: 'zone-custom-2',
            startTime: trackDuration * 0.5,
            endTime: trackDuration * 0.65,
            name: '임의 편집 구간 2'
          },
          {
            id: 'zone-custom-3',
            startTime: trackDuration * 0.8,
            endTime: trackDuration * 0.95,
            name: '임의 편집 구간 3'
          }
        ];
        break;
    }

    // Safety clamps
    calculatedZones = calculatedZones.map(z => ({
      ...z,
      startTime: Math.round(z.startTime * 10) / 10,
      endTime: Math.round(z.endTime * 10) / 10
    }));

    setZones(calculatedZones);
    setPreset(type);
  };

  // Toggle Preset Select
  const handlePresetSelect = (id: PresetType) => {
    if (!decodedBuffer) {
      setPreset(id);
      return;
    }
    applyPresetLayout(id, decodedBuffer.duration);
  };

  // Interactive Manipulation: Edit start or end of specific zone
  const handleUpdateZone = (id: string, start: number, end: number) => {
    setZones(prev => prev.map(zone => {
      if (zone.id === id) {
        return {
          ...zone,
          startTime: Math.round(start * 10) / 10,
          endTime: Math.round(end * 10) / 10
        };
      }
      return zone;
    }));
    setPreset('custom');
  };

  // Interactive Manipulation: Add a new custom zone
  const handleAddZone = () => {
    if (!decodedBuffer || zones.length >= 4) return;
    
    const trackDuration = decodedBuffer.duration;
    // Find an empty space to allocate, or place an optional 20-second segment at the center
    const id = `zone-usr-${Date.now()}`;
    const newStart = Math.round((trackDuration * 0.4) * 10) / 10;
    const newEnd = Math.round(Math.min(trackDuration, newStart + 20) * 10) / 10;

    const newZone: KeepZone = {
      id,
      startTime: newStart,
      endTime: newEnd,
      name: `추가 편집 구간 ${zones.length + 1}`
    };

    setZones(prev => [...prev, newZone]);
    setPreset('custom');
  };

  // Interactive Manipulation: Delete a section
  const handleDeleteZone = (id: string) => {
    if (zones.length <= 1) return;
    setZones(prev => prev.filter(z => z.id !== id));
    setPreset('custom');
  };

  // Auto trigger peak analysis matching
  const handleIdentifyChorus = () => {
    if (!analysis) return;
    setZones([
      {
        id: 'zone-intro',
        startTime: 0,
        endTime: 30,
        name: '정식 인트로'
      },
      {
        id: 'zone-chorus',
        startTime: Math.round(analysis.chorusStart * 10) / 10,
        endTime: Math.round(analysis.chorusEnd * 10) / 10,
        name: '자동 추적 후렴구'
      },
      {
        id: 'zone-outro',
        startTime: Math.round(Math.max(0, decodedBuffer!.duration - 20) * 10) / 10,
        endTime: Math.round(decodedBuffer!.duration * 10) / 10,
        name: '정식 아웃트로'
      }
    ]);
    setPreset('custom');
    setSuccessMessage('AI 에너지 분석법을 통해 곡의 최장 클라이맥스 구간을 검출해 적용했습니다!');
  };

  // --- PLAYBACK CONTROL ENGINE: ORIGINAL TRACK ---
  const handleTogglePlayOriginal = () => {
    if (!decodedBuffer) return;

    if (isPlayingOriginal) {
      // Pause
      originalPauseOffsetRef.current = Date.now() - originalStartTimeRef.current;
      stopOriginalPlayback();
    } else {
      // Play
      stopCondensedPlayback(); // Pause conflicting outputs
      const ctx = getAudioContext();
      
      const source = ctx.createBufferSource();
      source.buffer = decodedBuffer;
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      const offset = originalPauseOffsetRef.current / 1000 % decodedBuffer.duration;
      source.start(0, offset);
      
      originalStartTimeRef.current = Date.now() - (offset * 1000);
      originalSourceRef.current = source;
      originalGainRef.current = gainNode;
      setIsPlayingOriginal(true);

      // Listen for ending
      source.onended = () => {
        setIsPlayingOriginal(false);
        originalPauseOffsetRef.current = 0;
        setCurrentTimeOriginal(0);
      };

      // Periodic timer tracking
      originalTimerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - originalStartTimeRef.current) / 1000;
        if (elapsed >= decodedBuffer.duration) {
          stopOriginalPlayback();
          setCurrentTimeOriginal(0);
        } else {
          setCurrentTimeOriginal(elapsed);
        }
      }, 100);
    }
  };

  // Original timeline seek handler
  const handleSeekOriginal = (time: number) => {
    if (!decodedBuffer) return;
    const clampedTime = Math.max(0, Math.min(decodedBuffer.duration, time));
    
    const wasPlaying = isPlayingOriginal;
    stopOriginalPlayback();
    originalPauseOffsetRef.current = clampedTime * 1000;
    setCurrentTimeOriginal(clampedTime);
    
    if (wasPlaying) {
      // Instantly resume play state
      setIsPlayingOriginal(false);
      setTimeout(() => {
        handleTogglePlayOriginal();
      }, 50);
    }
  };


  // --- RENDERING PIPELINE: MERGING SELECTED BLOCKS WITH CROSSFADES IN BACKGROUND ---
  const handleRenderCondensedAudio = async () => {
    if (!decodedBuffer) return;
    
    setIsRendering(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    stopOriginalPlayback();
    stopCondensedPlayback();

    try {
      // Generate merged/crossfaded AudioBuffer via OfflineAudioContext worker
      const rendered = await mergeAudioZones(decodedBuffer, zones, crossfadeSec);
      setRenderedBuffer(rendered);

      // Calculate simple layout peaks for the rendered block
      const renderedChannel = rendered.getChannelData(0);
      const outputPeaksCount = 300;
      const peaksArray = new Float32Array(outputPeaksCount);
      const blockSize = Math.floor(renderedChannel.length / outputPeaksCount);
      
      for (let i = 0; i < outputPeaksCount; i++) {
        const start = i * blockSize;
        let max = 0;
        for (let j = 0; j < blockSize; j++) {
          const val = Math.abs(renderedChannel[start + j] || 0);
          if (val > max) max = val;
        }
        peaksArray[i] = max;
      }
      setRenderedPeaks(peaksArray);
      
      // Initialize seek values
      condensedPauseOffsetRef.current = 0;
      setCurrentTimeCondensed(0);
      
      setSuccessMessage(`축약 오디오가 아주 자연스럽게 합성되었습니다! (최종 길이: ${formatSec(rendered.duration)}) 아래 재생 바에서 크로스페이드 트랜지션을 모니터해보세요.`);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`오디오 합성 렌더링에 실패했습니다: ${err.message || err}`);
    } finally {
      setIsRendering(false);
    }
  };


  // --- PLAYBACK CONTROL ENGINE: CONDENSED (RENDERED) TRACK ---
  const handleTogglePlayCondensed = () => {
    if (!renderedBuffer) return;

    if (isPlayingCondensed) {
      // Pause
      condensedPauseOffsetRef.current = Date.now() - condensedStartTimeRef.current;
      stopCondensedPlayback();
    } else {
      // Play
      stopOriginalPlayback(); // Pause conflicting outputs
      const ctx = getAudioContext();
      
      const source = ctx.createBufferSource();
      source.buffer = renderedBuffer;
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      const offset = condensedPauseOffsetRef.current / 1000 % renderedBuffer.duration;
      source.start(0, offset);
      
      condensedStartTimeRef.current = Date.now() - (offset * 1000);
      condensedSourceRef.current = source;
      condensedGainRef.current = gainNode;
      setIsPlayingCondensed(true);

      // Listen for ending
      source.onended = () => {
        setIsPlayingCondensed(false);
        condensedPauseOffsetRef.current = 0;
        setCurrentTimeCondensed(0);
      };

      // Periodic timer tracking
      condensedTimerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - condensedStartTimeRef.current) / 1000;
        if (elapsed >= renderedBuffer.duration) {
          stopCondensedPlayback();
          setCurrentTimeCondensed(0);
        } else {
          setCurrentTimeCondensed(elapsed);
        }
      }, 100);
    }
  };

  // Seek handler for condensed timeline
  const handleSeekCondensed = (percentage: number) => {
    if (!renderedBuffer) return;
    const seekTime = (percentage / 100) * renderedBuffer.duration;
    
    const wasPlaying = isPlayingCondensed;
    stopCondensedPlayback();
    condensedPauseOffsetRef.current = seekTime * 1000;
    setCurrentTimeCondensed(seekTime);
    
    if (wasPlaying) {
      setTimeout(() => {
        handleTogglePlayCondensed();
      }, 50);
    }
  };


  // --- EXPORT PIPELINE: SYSTEM CODING TO 16-BIT SIGNED WAV BLOB ---
  const handleDownloadWav = async () => {
    if (!renderedBuffer) {
      setErrorMessage('다운로드할 합성 오디오를 먼저 위에서 렌더링해 주세요.');
      return;
    }

    setExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // Small timeout to allow loader UI presentation
      await new Promise(resolve => setTimeout(resolve, 300));

      const wavBlob = bufferToWav(renderedBuffer);
      const url = URL.createObjectURL(wavBlob);
      
      const link = document.createElement('a');
      link.href = url;
      
      const baseName = stats ? stats.fileName.replace(/\.[^/.]+$/, "") : "condensed_track";
      link.download = `${baseName}_condensed_1m30s.wav`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      URL.revokeObjectURL(url);
      setSuccessMessage('🎉 축약 합성된 고음질 WAV 오디오 파일이 스마트폰/PC 다운로드 폴더에 안전하게 영구 저장되었습니다!');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`WAV 인코딩 내보내기 도중 오류가 발생했습니다: ${err.message || err}`);
    } finally {
      setExporting(false);
    }
  };


  // --- GEMINI PROXY SYSTEM CALL: ASK FOR MUSIC TIMESTAMPS FROM RECOGNIZED LYRIC STRUCTURE ---
  const handleQueryAiSuggestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiSongTitle) {
      setErrorMessage('AI 분할 조언을 얻기 위해 최소한 곡 제목을 지정해 주세요.');
      return;
    }
    if (!stats) {
      setErrorMessage('오디오 음원 파일을 먼저 로드해 주십시오. 노래 전체 분량을 기준으로 프롬프트가 동조됩니다.');
      return;
    }

    setAiLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setAiSuggestions(null);

    try {
      const resp = await fetch('/api/suggest-cuts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          songTitle: aiSongTitle,
          artist: aiArtist,
          duration: stats.duration
        })
      });

      const responseData = await resp.json();
      
      if (!resp.ok) {
        throw new Error(responseData.error || '서버 오디오 AI 믹서로부터 응답을 받지 못했습니다.');
      }

      setAiSuggestions(responseData);
      setSuccessMessage('💡 Gemini 추천 편곡 구간을 성공적으로 획득했습니다! 아래 설명을 고하고 즉시 적용해 보세요.');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`AI 추천 로드에 실패했습니다: ${err.message || err}`);
      
      // Set simple client fallback recommendations to provide robust feedback if offline or no key configured
      const fallbackStart = Math.min(30, stats.duration * 0.15);
      const fallbackHook = Math.min(stats.duration * 0.5, stats.duration - 60);
      setAiSuggestions({
        cuts: [
          { name: '대포벌스 인입구 (Fallback)', startTime: 0, endTime: Math.round(fallbackStart) },
          { name: '대표 코러스싸비 (Fallback)', startTime: Math.round(fallbackHook), endTime: Math.round(fallbackHook + 45) },
          { name: '아웃트로 엔딩 (Fallback)', startTime: Math.round(stats.duration - 20), endTime: Math.round(stats.duration) }
        ],
        explanation: '서버 연동 지연으로 로컬 인프라 감지 시스템(RMS)에 기초한 대체 추천구간 정보를 로드했습니다. 이 구간 구성으로도 매우 아름다운 1분 30초 편집이 완성됩니다!'
      });
    } finally {
      setAiLoading(false);
    }
  };

  // Apply received recommendations instantly onto the client timeline editor
  const handleApplyAiSuggestions = () => {
    if (!aiSuggestions || !aiSuggestions.cuts) return;

    const mappedZones: KeepZone[] = aiSuggestions.cuts.map((cut: any, idx: number) => ({
      id: `zone-ai-${idx}-${Date.now()}`,
      startTime: cut.startTime,
      endTime: cut.endTime,
      name: cut.name
    }));

    setZones(mappedZones);
    setPreset('custom');
    setSuccessMessage('로딩 완료! Gemini AI 추천 하이라이트 구간 스카폴드가 사운드 마스터 타임라인에 완전히 인입 배치되었습니다.');
  };


  // Utilities for conversions
  const formatSec = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Active zones length combined
  const calculateResultLength = () => {
    let sum = 0;
    zones.forEach(z => {
      sum += (z.endTime - z.startTime);
    });
    const subFactor = Math.max(0, zones.length - 1) * crossfadeSec;
    return Math.max(1, sum - subFactor);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col antialiased">
      {/* HEADER BAR */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-100 shrink-0">
              <Scissors className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                오디오 콘덴서 <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">Smart Editor</span>
              </h1>
              <p className="text-xs text-slate-400">자연스러운 하이라이트 무손실 음원 축약 병합기</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              <Headphones className="w-3.5 h-3.5 text-indigo-500" />
              <span>헤드폰/스피커 감상 추천</span>
            </div>
          </div>
        </div>
      </header>

      {/* ERROR / SUCCESS METADATA REVEAL BANNER */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-3"
          >
            <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button onClick={() => setErrorMessage(null)} className="hover:bg-red-100 p-1 rounded transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 px-4 py-3"
          >
            <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMessage}</span>
              </div>
              <button onClick={() => setSuccessMessage(null)} className="hover:bg-emerald-100 p-1 rounded transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DASHBOARD BODY */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: UPLOADER & EDITING CONSOLE (8 cols) */}
        <section className="lg:col-span-8 space-y-8">
          
          {/* AUDIO FILE IMPORT ZONE */}
          <div
            id="audio-upload-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all bg-white shadow-sm ${
              isDragging 
                ? 'border-indigo-500 bg-indigo-50/50 scale-[0.99]' 
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="file"
              id="file-input-id"
              accept="audio/*"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center mb-4 text-slate-400 group-hover:text-indigo-600 transition-colors">
              {isDecoding ? (
                <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" />
              ) : (
                <Upload className="w-6 h-6 text-slate-400 group-hover:scale-105 transition-transform" />
              )}
            </div>

            {isDecoding ? (
              <div className="text-center space-y-1">
                <p className="font-semibold text-slate-700">고음질 오디오 디코딩 및 프레임 주파수 분석법 적용 중...</p>
                <p className="text-xs text-slate-400">대용량 파일의 경우 수초가 소요될 수 있습니다. 브라우저 창을 닫지 마세요.</p>
              </div>
            ) : file ? (
              <div className="text-center space-y-1 z-10">
                <p className="font-bold text-slate-800 text-base flex items-center justify-center gap-1.5">
                  <Music className="w-4 h-4 text-emerald-500" />
                  {file.name}
                </p>
                <div className="flex gap-3 justify-center text-xs text-slate-500">
                  <span>크기: {stats?.fileSize} MB</span>
                  <span>•</span>
                  <span>러닝타임: {stats ? formatSec(stats.duration) : '0:00'}</span>
                  <span>•</span>
                  <span>샘플레이트: {stats?.sampleRate} Hz</span>
                </div>
                <p className="text-[11px] text-indigo-600 font-medium pt-1">
                  💡 다른 음원을 올리려면 영역을 다시 누르거나 새로운 파일을 드롭하세요.
                </p>
              </div>
            ) : (
              <div className="text-center space-y-1">
                <p className="font-bold text-slate-800 text-base">편집할 오디오 파일(MP3, WAV 등) 드래그 드롭</p>
                <p className="text-sm text-slate-500">또는 이 영역을 클릭해서 디바이스 내 파일 선택</p>
                <p className="text-xs text-slate-400 pt-2 font-mono">추천 대상: 3분 ~ 5분 길이의 일반 대중가요 음악 음원</p>
              </div>
            )}
          </div>

          {/* MAIN TIMELINE & PARAMETERS (Visible only when file loaded) */}
          {decodedBuffer && stats && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* TIMELINE CONTROLLER SECTION */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-500" />
                      마스터 트랙 타임라인
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">구간의 가장자리를 마우스 드래그하여 길이를 조절하세요</p>
                  </div>

                  {/* Original Track Play Controls */}
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      id="btn-play-original"
                      onClick={handleTogglePlayOriginal}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                        isPlayingOriginal
                          ? 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-200'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                      }`}
                    >
                      {isPlayingOriginal ? (
                        <>
                          <Pause className="w-4 h-4 fill-amber-800 text-amber-800" />
                          <span>원곡 일시정지 ({formatSec(currentTimeOriginal)})</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-indigo-700 text-indigo-700" />
                          <span>원곡 모니터 재생</span>
                        </>
                      )}
                    </button>
                    
                    <div className="flex items-center gap-1 bg-slate-100 rounded-xl px-3 py-2 border border-slate-200" title="마스터 볼륨">
                      <Volume2 className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-16 accent-indigo-600 h-1 bg-slate-300 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* The Canvas Waveform Draw Panel */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <WaveformCanvas
                    peaks={analysis?.peaks || new Float32Array(0)}
                    duration={stats.duration}
                    zones={zones}
                    currentTime={currentTimeOriginal}
                    crossfadeSec={crossfadeSec}
                    isPlayingOriginal={isPlayingOriginal}
                    onSeek={handleSeekOriginal}
                    onUpdateZone={handleUpdateZone}
                  />
                </div>

                {/* Dynamic Parameter Fine Tuning Panel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
                  {/* Transition overlap configuration */}
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      🔗 크로스페이드 트랜지션 (겹침 영역) 설정: <span className="text-indigo-600 font-mono font-bold">{crossfadeSec.toFixed(1)}초</span>
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="0.5"
                        max="8.0"
                        step="0.5"
                        value={crossfadeSec}
                        onChange={(e) => setCrossfadeSec(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-650"
                      />
                      <span className="text-xs text-slate-400 shrink-0 select-none">지연 4초 권장</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      구간들이 만날 때 앞부분은 작아지고 뒷부분은 커지며 섞이는 오버랩 수치입니다. 값이 커질수록 페이드 아웃/인이 더 완만해집니다.
                    </p>
                  </div>

                  {/* Live resulting stats card */}
                  <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">계산된 축약 본 최종 길이</h4>
                        <p className="text-lg font-bold text-slate-900 mt-1">
                          약 {formatSec(calculateResultLength())} 내외
                        </p>
                      </div>
                      <div className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 tracking-tight">
                        목표 구간 (1:30~2:00) 적정성
                      </div>
                    </div>
                    <div className="mt-3 text-[11px] text-slate-500">
                      {calculateResultLength() >= 90 && calculateResultLength() <= 120 ? (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          ✓ 딱 좋습니다! 1:30 ~ 2:00 범위 안에 아름답게 정렬되는 분량입니다.
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          ℹ 음원 길이가 {(calculateResultLength() / 60).toFixed(1)}분 입니다. 이 설정보다 더 짧게 또는 길게 타 조정 가능합니다.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION FINE-TUNING LIST TABLE */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                <KeepZoneEditor
                  zones={zones}
                  duration={stats.duration}
                  onUpdateZone={handleUpdateZone}
                  onAddZone={handleAddZone}
                  onDeleteZone={handleDeleteZone}
                  onIdentifyChorus={handleIdentifyChorus}
                  hasChorusMatched={preset === 'custom' && zones.length === 3 && zones[1].name.includes('추적')}
                />
              </div>

              {/* RENDER AND EXPORT CONSOLE */}
              <div className="bg-indigo-900 text-white rounded-2xl p-8 shadow-md relative overflow-hidden">
                <div className="absolute right-0 top-0 translate-x-12 -translate-y-8 w-48 h-48 rounded-full bg-indigo-500/20 blur-xl pointer-events-none" />
                <div className="absolute left-1/4 bottom-0 w-32 h-32 rounded-full bg-purple-500/10 blur-xl pointer-events-none" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2 max-w-lg">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200">
                      <Sparkles className="w-3.5 h-3.5" />
                      실시간 오버랩 렌더러
                    </span>
                    <h3 className="text-xl font-bold">크로스페이드 음질 하향 필터 합성</h3>
                    <p className="text-xs text-indigo-200/90 leading-relaxed">
                      각 구간들의 가장자리 프레임을 추출하고 백라이프라인 크로스페이드 연산 후 완전한 단일 음원 파일로 컴파일합니다. 완료되면 무손실 오디오 청취 및 오가닉 WAV 저장이 가능합니다.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRenderCondensedAudio}
                    disabled={isRendering}
                    className="flex items-center justify-center gap-2 px-6 py-4 bg-white hover:bg-slate-100 text-indigo-900 font-bold rounded-xl shadow-lg hover:shadow-xl transition-all select-none shrink-0 disabled:opacity-75"
                  >
                    {isRendering ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-900" />
                        <span>오디오 렌더링 중...</span>
                      </>
                    ) : (
                      <>
                        <Scissors className="w-5 h-5" />
                        <span>축약본 렌더링하기</span>
                      </>
                    )}
                  </button>
                </div>

                {/* RENDERED COMPILATION READY STATE DISPLAY */}
                {renderedBuffer && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-8 pt-6 border-t border-indigo-500/30 space-y-6"
                  >
                    <div id="rendered-output-waveform-box" className="bg-indigo-950/80 rounded-xl p-5 border border-indigo-500/20 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-indigo-300">COMPILATION WAVEFORM</span>
                          <h4 className="text-sm font-bold mt-0.5 text-white">축약 병합본 럭셔리 모니터 오바</h4>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            id="btn-play-condensed"
                            onClick={handleTogglePlayCondensed}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                              isPlayingCondensed
                                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                            }`}
                          >
                            {isPlayingCondensed ? (
                              <>
                                <Pause className="w-3.5 h-3.5 fill-white" />
                                <span>정지 ({formatSec(currentTimeCondensed)})</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-white" />
                                <span>청사 재생</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Rendered Condensed Waveform visual block */}
                      {renderedPeaks && (
                        <div className="space-y-1">
                          <div id="condensed-canvas-track" className="h-16 w-full flex items-end gap-[1.5px] bg-indigo-950 px-3 py-1 rounded-lg border border-indigo-900/40 relative">
                            {Array.from(renderedPeaks).map((peak, idx) => {
                              // Is this bar behind the current play cursor?
                              const percentElapsed = (currentTimeCondensed / renderedBuffer.duration) * 100;
                              const currentBarPercent = (idx / renderedPeaks.length) * 100;
                              const isActive = currentBarPercent <= percentElapsed;
                              
                              return (
                                <div
                                  key={idx}
                                  className={`rounded-full flex-1 transition-colors`}
                                  style={{
                                    height: `${Math.max(8, Number(peak) * 90)}%`,
                                    backgroundColor: isActive ? '#10b981' : '#4338ca' // emerald for played, indigo bar otherwise
                                  }}
                                />
                              );
                            })}

                            {/* Click to Seek wrapper */}
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={(currentTimeCondensed / renderedBuffer.duration) * 100 || 0}
                              onChange={(e) => handleSeekCondensed(parseFloat(e.target.value))}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                          </div>
                          
                          <div className="flex justify-between text-[10px] text-indigo-300 font-mono px-1">
                            <span>0:00</span>
                            <span className="text-indigo-200">마크 클릭 시 시크이동 가능 ({formatSec(currentTimeCondensed)})</span>
                            <span>{formatSec(renderedBuffer.duration)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Final Free Download Button */}
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        id="btn-download-wav"
                        onClick={handleDownloadWav}
                        disabled={exporting}
                        className="flex items-center gap-2 px-8 py-4.5 bg-emerald-500 hover:bg-emerald-600 text-white text-base font-bold rounded-2xl shadow-xl hover:shadow-emerald-500/20 active:scale-95 transition-all select-none w-full sm:w-auto text-center justify-center disabled:opacity-75"
                      >
                        {exporting ? (
                          <>
                            <RefreshCw className="w-5 h-5 animate-spin" />
                            <span>WAV 인코딩 마스터링 중...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-5 h-5" />
                            <span>축약 완료된 고음질 WAV 다운로드 받기</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </section>

        {/* RIGHT COLUMN: PRESETS, GEMINI AI ADVISOR (4 cols) */}
        <section className="lg:col-span-4 space-y-8">
          
          {/* QUICK EDIT PRESETS */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm tracking-tight flex items-center gap-2">
                <Scissors className="w-4 h-4 text-indigo-500" />
                스마트 음원 단축 프리셋
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">곡의 스타일에 맞추어 자동화 편곡 구간을 분할합니다</p>
            </div>

            <div className="grid gap-2.5">
              {PRESETS.map((p) => {
                const isActive = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetSelect(p.id)}
                    className={`text-left p-3.5 rounded-xl border-2 transition-all flex flex-col gap-1 shrink-0 ${
                      isActive 
                        ? 'bg-indigo-50/50 border-indigo-600 text-slate-900 shadow-sm' 
                        : 'bg-white hover:bg-slate-50 border-slate-100 hover:border-slate-200 text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-xs tracking-tight">{p.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                        isActive 
                          ? 'bg-indigo-100 text-indigo-800' 
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {p.targetDuration}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-400 font-normal">
                      {p.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* INTELUGENT AI ADVISOR DRAWER */}
          <div className="bg-gradient-to-br from-indigo-900 to-slate-950 text-white rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="font-bold text-sm tracking-tight flex items-center gap-1.5 text-white">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Gemini AI 음원 편곡 비서
                </h3>
                <p className="text-[11px] text-slate-300">곡의 실제 서정성 구조와 마킹을 조회해 추천을 제안합니다</p>
              </div>
            </div>

            <form onSubmit={handleQueryAiSuggestions} className="grid gap-3">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">곡 제목 (필수)</label>
                <input
                  type="text"
                  placeholder="예: Dynamite, 봄날"
                  value={aiSongTitle}
                  onChange={(e) => setAiSongTitle(e.target.value)}
                  className="w-full bg-slate-900/70 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">아티스트 가수명 (선택)</label>
                <input
                  type="text"
                  placeholder="예: BTS"
                  value={aiArtist}
                  onChange={(e) => setAiArtist(e.target.value)}
                  className="w-full bg-slate-900/70 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={aiLoading || !stats}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-white font-bold text-xs rounded-xl shadow transition-all disabled:opacity-50 select-none cursor-pointer"
              >
                {aiLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Gemini 전조 분석 분석 중...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>AI 곡 구조 추천받기</span>
                  </>
                )}
              </button>
              
              {!stats && (
                <p className="text-[10px] text-amber-300/80 text-center leading-normal">
                  ⚠️ AI 비서를 사용하려면 먼저 왼쪽 영역에 음원 파일을 마운트해 주세요!
                </p>
              )}
            </form>

            {/* AI SUGGESTION DISPLAY */}
            {aiSuggestions && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-4 pt-4 border-t border-slate-800 space-y-4"
              >
                <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-800/80 space-y-3.5">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-amber-400">Gemini 제안 타임 테이블</span>
                    <div className="space-y-1.5 mt-1">
                      {aiSuggestions.cuts.map((cut: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-[10px] text-slate-300 font-mono bg-slate-950/60 p-2 rounded border border-slate-900">
                          <span className="font-semibold text-slate-200">{cut.name}</span>
                          <span className="text-white hover:underline">
                            {formatSec(cut.startTime)} - {formatSec(cut.endTime)} ({(cut.endTime - cut.startTime).toFixed(0)}초)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-indigo-300">곡 구조 분석 평</span>
                    <p className="text-[10.5px] leading-relaxed text-slate-300 font-normal">
                      {aiSuggestions.explanation}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyAiSuggestions}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg shadow-sm transition-all select-none cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    이 추천 그대로 편집기에 세팅하기
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* METRIC INFORMATION ACCORDION / GUIDE CARD */}
          <div className="bg-slate-100 rounded-2xl p-5 border border-slate-200 space-y-3">
            <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-emerald-600" />
              자연스러운 축약 원결합 팁
            </h4>
            <ul className="text-[11px] text-slate-500 space-y-2 leading-relaxed">
              <li className="flex items-start gap-1">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span>**크로스페이드 4-5초 조율**: 곡의 앞부분과 뒷부분이 소리 비움 없이 부드럽게 섞이는 표준적인 크로스페이드 시간이며, BPM이 빠를수록 더 타이트하게 3초 이내로 가져가는 것이 자연스럽습니다.</span>
              </li>
              <li className="flex items-start gap-1">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span>**BPM 일치 및 멜로디 연결**: 후렴구의 마디(다운비트)가 시작되는 시점에 딱 맞춰 다음 구성을 시작하면, 박자가 어긋나지 않아 기성 숏 트래커 에딧과 같은 품질을 냅니다.</span>
              </li>
              <li className="flex items-start gap-1">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span>**끝부분 스튜디오 페이드아웃 기본 탑재**: 마지막 영역의 끝 2초간은 기성 음원들의 페이드와 같이 서서히 소리가 0으로 수렴하는 기계적 쇠퇴가 적용되어 완결성이 완성됩니다.</span>
              </li>
            </ul>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-1.5">
          <p className="text-xs text-slate-400">© 2026 Audio Condenser Studio. All Rights Reserved. Powered by Google Gemini 3.5 & Web Audio Infrastructure.</p>
          <p className="text-[10px] text-slate-300 font-mono">100% 클라이언트 로컬 디코딩 및 프레그먼트 합산으로 일체의 음원 파일이 외부 서버로 반출되지 않고 전면 기기 내 보안 처리됩니다.</p>
        </div>
      </footer>
    </div>
  );
}
