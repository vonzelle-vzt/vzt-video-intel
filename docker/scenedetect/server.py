"""PySceneDetect HTTP wrapper.

POST /run with {source, threshold?, minSceneLengthMs?} returns {scenes, duration_ms}.
POST /run with {mode: "keyframes", source, perScene?, intervalMs?, quality?} returns {keyframes}.
"""

import base64
import io
import os
import tempfile
import urllib.request
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import cv2
from scenedetect import detect, ContentDetector, open_video

app = FastAPI()


def _resolve_source(source: str) -> str:
    if source.startswith(("http://", "https://")):
        suffix = os.path.splitext(source.split("?")[0])[1] or ".mp4"
        fd, path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        urllib.request.urlretrieve(source, path)
        return path
    if not os.path.isabs(source) and os.path.exists(f"/data/{source.lstrip('/')}"):
        return f"/data/{source.lstrip('/')}"
    return source


class RunRequest(BaseModel):
    source: str
    mode: Optional[str] = None
    threshold: Optional[float] = 27.0
    minSceneLengthMs: Optional[int] = 1000
    maxScenes: Optional[int] = 200
    perScene: Optional[bool] = True
    intervalMs: Optional[int] = 2000
    quality: Optional[int] = 85


@app.get("/health")
def health():
    return {"ok": True}


def _detect_scenes(path: str, threshold: float, min_scene_len_ms: int, max_scenes: int):
    scenes_raw = detect(path, ContentDetector(threshold=threshold, min_scene_len=int(min_scene_len_ms / 1000 * 30)))
    scenes = []
    for i, (start, end) in enumerate(scenes_raw[:max_scenes]):
        scenes.append({"id": i, "start_ms": int(start.get_seconds() * 1000), "end_ms": int(end.get_seconds() * 1000)})
    video = open_video(path)
    duration_ms = int(video.duration.get_seconds() * 1000) if hasattr(video, "duration") else None
    return scenes, duration_ms


def _extract_keyframes(path: str, scenes, per_scene: bool, interval_ms: int, quality: int):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    keyframes = []
    targets = []
    if per_scene and scenes:
        for s in scenes:
            t_ms = (s["start_ms"] + s["end_ms"]) // 2
            targets.append((s["id"], t_ms))
    else:
        total_ms = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps * 1000)
        for i, t_ms in enumerate(range(0, total_ms, interval_ms)):
            targets.append((i, t_ms))
    for scene_id, t_ms in targets:
        cap.set(cv2.CAP_PROP_POS_MSEC, t_ms)
        ok, frame = cap.read()
        if not ok:
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        keyframes.append({
            "scene_id": scene_id,
            "t_ms": t_ms,
            "jpeg_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
            "width": img.width,
            "height": img.height,
        })
    cap.release()
    return keyframes


@app.post("/run")
def run(req: RunRequest):
    try:
        path = _resolve_source(req.source)
        scenes, duration_ms = _detect_scenes(path, req.threshold or 27.0, req.minSceneLengthMs or 1000, req.maxScenes or 200)
        if req.mode == "keyframes":
            keyframes = _extract_keyframes(path, scenes, req.perScene or True, req.intervalMs or 2000, req.quality or 85)
            return {"keyframes": keyframes}
        return {"scenes": scenes, "duration_ms": duration_ms}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
