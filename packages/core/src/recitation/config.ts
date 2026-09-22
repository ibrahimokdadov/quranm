export interface EngineConfig {
  jumpCost: number;
  repeatCost: number;
  commitDwell: number;
  okDistance: number;
  unsureDistance: number;
  minHeardFraction: number;
  minMargin: number;
  lostWindow: number;
  lostRate: number;
  holdWindow: number;
  holdRate: number;
  searchMinChars: number;
  searchQueryChars: number;
  searchDecisiveDistance: number;
  searchDecisiveMargin: number;
  searchEveryFrames: number;
  searchEveryChars: number;
  locateFailedFrames: number;
  relocateEveryFrames: number;
  relocateQueryChars: number;
  relocateMaxDistance: number;
  relocateRateMargin: number;
  idleFrames: number;
  maxStruggles: number;
  settleFrames: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  jumpCost: 12,
  repeatCost: 10,
  commitDwell: 6,
  okDistance: 0.15,
  unsureDistance: 0.4,
  minHeardFraction: 0.34,
  minMargin: 0.35,
  lostWindow: 120,
  lostRate: 0.35,
  holdWindow: 30,
  holdRate: 0.45,
  searchMinChars: 12,
  searchQueryChars: 250,
  searchDecisiveDistance: 0.35,
  searchDecisiveMargin: 0.1,
  searchEveryFrames: 25,
  searchEveryChars: 12,
  locateFailedFrames: 375,
  relocateEveryFrames: 37,
  relocateQueryChars: 100,
  relocateMaxDistance: 0.3,
  relocateRateMargin: 0.12,
  idleFrames: 200,
  maxStruggles: 3,
  settleFrames: 25,
};

export const BUFFER_CAP = 1000;

export const SAMPLE_RATE = 16000;
export const FBANK_BINS = 80;
export const FRAME_LENGTH = 400;
export const FRAME_SHIFT = 160;
export const ZIPFORMER_T = 61;
export const ZIPFORMER_HOP = 48;
export const ZIPFORMER_VOCAB = 251;
export const CTC_HZ = 25;
