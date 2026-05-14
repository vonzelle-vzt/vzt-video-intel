"""CLIP HTTP wrapper — POST /run with {source, query, topK?, minScore?}.

Samples frames every ~1s, computes CLIP embeddings, scores against the text
query, returns top-K hits with timestamps.
"""

import os
import tempfile
import urllib.request
from typing import Optional

import cv2
import open_clip
import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

app = FastAPI()
MODEL_NAME = os.environ.get("CLIP_MODEL", "ViT-L-14")
PRETRAINED = os.environ.get("CLIP_PRETRAINED", "openai")

_model = None
_preprocess = None
_tokenizer = None
_device = "cuda" if torch.cuda.is_available() else "cpu"


def _load():
    global _model, _preprocess, _tokenizer
    if _model is None:
        _model, _, _preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED, device=_device)
        _model.eval()
        _tokenizer = open_clip.get_tokenizer(MODEL_NAME)


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
    query: str
    topK: Optional[int] = 10
    minScore: Optional[float] = 0.2
    sampleEveryMs: Optional[int] = 1000


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": _device}


@app.post("/run")
def run(req: RunRequest):
    try:
        _load()
        path = _resolve(req.source)
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        step = req.sampleEveryMs or 1000
        frames = []
        timestamps = []
        t_ms = 0
        while True:
            cap.set(cv2.CAP_PROP_POS_MSEC, t_ms)
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            timestamps.append(t_ms)
            t_ms += step
        cap.release()
        if not frames:
            return {"hits": []}
        with torch.no_grad():
            batched = torch.stack([_preprocess(f) for f in frames]).to(_device)
            image_features = _model.encode_image(batched)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text = _tokenizer([req.query]).to(_device)
            text_features = _model.encode_text(text)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            scores = (image_features @ text_features.T).squeeze(-1).cpu().tolist()
        hits = sorted(
            [
                {"t_ms": ts, "score": float(s)}
                for ts, s in zip(timestamps, scores)
                if s >= (req.minScore or 0.2)
            ],
            key=lambda h: h["score"],
            reverse=True,
        )[: (req.topK or 10)]
        return {"hits": hits}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
