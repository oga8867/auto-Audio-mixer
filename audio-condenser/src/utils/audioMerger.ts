import { KeepZone } from '../types';

/**
 * Merges multiple Web Audio buffers from active KeepZones using OfflineAudioContext.
 * Automatically schedules smooth linear crossfades and a professional master ending fade-out.
 */
export async function mergeAudioZones(
  audioBuffer: AudioBuffer,
  zones: KeepZone[],
  crossfadeSec: number
): Promise<AudioBuffer> {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const N = zones.length;

  if (N === 0) {
    throw new Error('선택된 재생 구간이 없습니다.');
  }

  // 1. Calculate durations and output timeline positions
  const zoneDurations = zones.map((z) => z.endTime - z.startTime);
  
  // Calculate exact play start times in the merged timeline (T_i)
  const T: number[] = [];
  T[0] = 0;
  for (let i = 1; i < N; i++) {
    // Current zone starts at the end of the previous zone minus the crossfade duration
    T[i] = Math.max(0, T[i - 1] + zoneDurations[i - 1] - crossfadeSec);
  }

  // Total duration is the end of the final zone
  const totalDuration = T[N - 1] + zoneDurations[N - 1];
  const totalSamples = Math.floor(totalDuration * sampleRate);

  // 2. Create Offline Audio Context for background rendering
  const offlineCtx = new OfflineAudioContext(numChannels, totalSamples, sampleRate);

  // 3. Create and connect source nodes with timed volume automation envelopes
  for (let i = 0; i < N; i++) {
    const zone = zones[i];
    const duration = zoneDurations[i];
    const playStart = T[i];

    // Create a source for the original audio buffer
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;

    // Create a dedicated gain node for crossfading
    const gainNode = offlineCtx.createGain();

    // Schedule the envelope events onto the timeline
    // Initialize node gain at 0
    gainNode.gain.setValueAtTime(0, playStart);

    // Fade In schedule
    if (i === 0) {
      // First node starts instantly
      gainNode.gain.setValueAtTime(0, 0);
      gainNode.gain.linearRampToValueAtTime(1, 0.2); // slight initial anti-pop fade-in
    } else {
      // Intermediate nodes fade in over crossfade duration
      gainNode.gain.setValueAtTime(0, playStart);
      gainNode.gain.linearRampToValueAtTime(1, playStart + crossfadeSec);
    }

    // Determine when this individual block ends
    const playEnd = playStart + duration;

    // Fade Out schedule
    if (i < N - 1) {
      // If there is a next node, fade out over the next crossfade overlap window
      const nextPlayStart = T[i + 1];
      gainNode.gain.setValueAtTime(1, nextPlayStart);
      gainNode.gain.linearRampToValueAtTime(0, nextPlayStart + crossfadeSec);
    } else {
      // The absolute final zone: apply a smooth professional 2-second master studio ending fade-out
      const fadeOutDuration = Math.min(2.0, duration * 0.3);
      const fadeOutStart = playEnd - fadeOutDuration;
      gainNode.gain.setValueAtTime(1, Math.max(0, fadeOutStart));
      gainNode.gain.linearRampToValueAtTime(0, playEnd);
    }

    // Connect node chain: source -> gain -> master offline output
    sourceNode.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    // Schedule buffer source segment playback
    sourceNode.start(playStart, zone.startTime, duration);
  }

  // 4. Render the audio to a buffer asynchronously
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}
