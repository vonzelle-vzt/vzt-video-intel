"""WhisperX HTTP wrapper — POST /run with {source, language?, diarize?}."""

import os
import tempfile
import urllib.request
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3")
HF_TOKEN = os.environ.get("HF_TOKEN", "")

_whisper = None
_diarize_pipeline = None


def _load():
    global _whisper, _diarize_pipeline
    if _whisper is None:
        import whisperx
        device = "cuda" if _has_cuda() else "cpu"
        compute = "float16" if device == "cuda" else "int8"
        _whisper = whisperx.load_model(MODEL_NAME, device, compute_type=compute)
        if HF_TOKEN:
            from whisperx.diarize import DiarizationPipeline
            _diarize_pipeline = DiarizationPipeline(use_auth_token=HF_TOKEN, device=device)


def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def _resolve_source(source: str) -> str:
    if source.startswith(("http://", "https://")):
        suffix = os.path.splitext(source.split("?")[0])[1] or ".mp4"
        fd, path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        urllib.request.urlretrieve(source, path)
        return path
    if os.path.isabs(source) and not os.path.exists(source) and os.path.exists(f"/data/{source.lstrip('/')}"):
        return f"/data/{source.lstrip('/')}"
    return source


class RunRequest(BaseModel):
    source: str
    language: Optional[str] = None
    diarize: bool = True
    minSpeakers: Optional[int] = None
    maxSpeakers: Optional[int] = None


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "cuda": _has_cuda()}


@app.post("/run")
def run(req: RunRequest):
    _load()
    try:
        import whisperx
        path = _resolve_source(req.source)
        audio = whisperx.load_audio(path)
        result = _whisper.transcribe(audio, language=req.language, batch_size=8)
        # Align
        align_model, metadata = whisperx.load_align_model(language_code=result["language"], device="cuda" if _has_cuda() else "cpu")
        aligned = whisperx.align(result["segments"], align_model, metadata, audio, "cuda" if _has_cuda() else "cpu")
        segments = aligned["segments"]
        # Diarize
        if req.diarize and _diarize_pipeline is not None:
            diarize_segments = _diarize_pipeline(audio, min_speakers=req.minSpeakers, max_speakers=req.maxSpeakers)
            segments = whisperx.assign_word_speakers(diarize_segments, aligned)["segments"]
        return {
            "segments": [
                {
                    "start_ms": int(s["start"] * 1000),
                    "end_ms": int(s["end"] * 1000),
                    "text": s["text"].strip(),
                    "speaker": s.get("speaker"),
                    "confidence": s.get("confidence"),
                }
                for s in segments
            ],
            "language": result["language"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
