/**
 * Analyzes audio channel data to determine average amplitudes, peaks, 
 * and auto-locate highest energy blocks (Chorus/Climax sections).
 */

export interface AnalysisResult {
  peaks: Float32Array; // values from 0.0 to 1.0 for drawing
  rmsData: number[];   // average energy per second
  chorusStart: number; // suggested start time for chorus
  chorusEnd: number;   // suggested end time for chorus
}

export function analyzeAudioBuffer(buffer: AudioBuffer, targetPeakPoints: number = 300): AnalysisResult {
  const channelData = buffer.getChannelData(0); // Analyze the first channel
  const duration = buffer.duration;
  const length = channelData.length;
  const sampleRate = buffer.sampleRate;
  
  // 1. Calculate downsampled peaks for visual rendering
  const peaks = new Float32Array(targetPeakPoints);
  const blockSize = Math.floor(length / targetPeakPoints);
  
  for (let i = 0; i < targetPeakPoints; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const val = Math.abs(channelData[start + j] || 0);
      if (val > max) max = val;
    }
    peaks[i] = max;
  }
  
  // 2. Calculate RMS energy in 1-second brackets
  const numSeconds = Math.floor(duration);
  const samplesPerSecond = sampleRate;
  const rmsData: number[] = [];
  
  for (let s = 0; s < numSeconds; s++) {
    const start = s * samplesPerSecond;
    let sumSquares = 0;
    const count = Math.min(samplesPerSecond, length - start);
    
    if (count > 0) {
      for (let j = 0; j < count; j++) {
        const val = channelData[start + j] || 0;
        sumSquares += val * val;
      }
      rmsData.push(Math.sqrt(sumSquares / count));
    } else {
      rmsData.push(0);
    }
  }
  
  // 3. Find the peak chorus/climax section
  // Typically, chorus is 40-50 seconds long and usually starts sometime in the 25% to 75% range of the track.
  // Let's sweep a window of 40 seconds across the middle portion and find the window with highest average RMS.
  const windowSize = Math.min(45, Math.floor(duration * 0.4)); // e.g., 40-45 seconds
  let maxRmsSum = 0;
  let optimalStartIndex = Math.floor(duration * 0.3); // Safe default (around 30% mark)
  
  if (numSeconds > windowSize) {
    const searchStart = Math.floor(duration * 0.15); // Don't pick immediately in the intro
    const searchEnd = Math.floor(duration * 0.8) - windowSize; // Don't pick at the absolute end
    
    for (let i = searchStart; i <= searchEnd; i++) {
      let currentSum = 0;
      for (let w = 0; w < windowSize; w++) {
        currentSum += rmsData[i + w] || 0;
      }
      if (currentSum > maxRmsSum) {
        maxRmsSum = currentSum;
        optimalStartIndex = i;
      }
    }
  }
  
  return {
    peaks,
    rmsData,
    chorusStart: optimalStartIndex,
    chorusEnd: optimalStartIndex + windowSize
  };
}
