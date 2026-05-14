// VZT Video-Intel — Scene Graph schema
// The Claude-consumable JSON output. Every element is timestamped so Claude
// can cite by start_ms/end_ms instead of hallucinating about video content.

export type Milliseconds = number;
export type BBox = [x: number, y: number, w: number, h: number];

export interface Scene {
  id: number;
  start_ms: Milliseconds;
  end_ms: Milliseconds;
  shot_type?: "wide" | "medium" | "close" | "extreme_close" | "unknown";
  motion?: "static" | "panning" | "tracking" | "zoom" | "handheld" | "unknown";
}

export interface TranscriptSegment {
  start_ms: Milliseconds;
  end_ms: Milliseconds;
  text: string;
  speaker?: string;
  confidence?: number;
  language?: string;
}

export interface Entity {
  tracking_id: string;
  label: string;
  confidence: number;
  appearances: {
    scene_id: number;
    start_ms: Milliseconds;
    end_ms: Milliseconds;
    bboxes?: { t_ms: Milliseconds; bbox: BBox }[];
  }[];
}

export interface Action {
  scene_id: number;
  start_ms: Milliseconds;
  end_ms: Milliseconds;
  label: string;
  actors?: string[];
  confidence: number;
}

export interface OcrRegion {
  start_ms: Milliseconds;
  end_ms: Milliseconds;
  text: string;
  bbox: BBox;
  language?: string;
  confidence?: number;
}

export interface Keyframe {
  scene_id: number;
  t_ms: Milliseconds;
  jpeg_b64?: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface Chapter {
  start_ms: Milliseconds;
  end_ms: Milliseconds;
  title: string;
  summary?: string;
}

// A single thing a human would notice while watching AND listening — the
// unified output of `observe`. `kind` says which sense it came from:
//   hear  — spoken audio (transcript)
//   see   — visual content of a scene (VLM caption / action)
//   read  — on-screen text (OCR)
//   scene — a cut / shot boundary
export type PerceptionKind = "hear" | "see" | "read" | "scene";

export interface PerceptionEvent {
  t_ms: Milliseconds;
  end_ms?: Milliseconds;
  kind: PerceptionKind;
  text: string;
  scene_id?: number;
  speaker?: string;
  confidence?: number;
}

export interface SceneGraph {
  source: string;
  duration_ms?: Milliseconds;
  scenes: Scene[];
  transcript: TranscriptSegment[];
  entities: Entity[];
  actions: Action[];
  ocr: OcrRegion[];
  keyframes?: Keyframe[];
  chapters?: Chapter[];
  /** Unified time-sorted "watch + listen" track — populated by `observe`. */
  perception?: PerceptionEvent[];
  mux_base?: string | null;
  /** Non-fatal degradations — a backend failed but the pipeline carried on. */
  _warnings?: string[];
  _pipeline: string;
  _generated_at: string;
  _version: string;
}

export interface BackendHealth {
  name: string;
  url: string;
  reachable: boolean;
  status_code?: number;
  latency_ms?: number;
  error?: string;
}
