"""EasyOCR HTTP wrapper — POST /run with {source, languages?, sampleEveryMs?}."""

import os
import tempfile
import urllib.request
from typing import List, Optional

import cv2
import easyocr
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
LANGS = os.environ.get("OCR_LANGS", "en").split(",")
_reader = None


def _load(langs):
    global _reader
    if _reader is None or sorted(_reader.lang_list) != sorted(langs):
        _reader = easyocr.Reader(langs, gpu=False)


def _resolve(source: str) -> str:
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
    languages: Optional[List[str]] = None
    sampleEveryMs: Optional[int] = 1000


@app.get("/health")
def health():
    return {"ok": True, "languages": LANGS}


@app.post("/run")
def run(req: RunRequest):
    try:
        _load(req.languages or LANGS)
        path = _resolve(req.source)
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        sample_step_ms = req.sampleEveryMs or 1000
        regions = []
        t_ms = 0
        while True:
            cap.set(cv2.CAP_PROP_POS_MSEC, t_ms)
            ok, frame = cap.read()
            if not ok:
                break
            results = _reader.readtext(frame)
            for bbox, text, conf in results:
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                x, y = int(min(xs)), int(min(ys))
                w, h = int(max(xs) - x), int(max(ys) - y)
                regions.append({
                    "start_ms": t_ms,
                    "end_ms": t_ms + sample_step_ms,
                    "text": text,
                    "bbox": [x, y, w, h],
                    "confidence": float(conf),
                })
            t_ms += sample_step_ms
        cap.release()
        return {"regions": regions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
