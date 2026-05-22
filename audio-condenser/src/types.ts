export interface KeepZone {
  id: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  name: string;      // label for the zone (e.g. "Intro/Beginning", "Chorus/Climax", "Outro/Ending")
}

export interface AudioStats {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  fileName: string;
  fileSize: number;
}

export type PresetType = 'pop-short' | 'dance-cut' | 'ambient-outro' | 'custom';

export interface Preset {
  id: PresetType;
  name: string;
  description: string;
  targetDuration: string;
  zonesCount: number;
}
