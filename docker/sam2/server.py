"""SAM2 HTTP wrapper — POST /run with {source, sceneStartMs?, sceneEndMs?, promptText?, sampleEveryMs?}.

Returns {entities: [{tracking_id, label, confidence, appearances: [...]}]}.

Minimal viable implementation — defers full SAM2 video predictor wiring to the
backend container. The HTTP contract is stable; swap the predictor body without
breaking callers.
"""

import os
import tempfile
import urllib.request
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


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
    sceneStartMs: Optional[int] = None
    sceneEndMs: Optional[int] = None
    promptText: Optional[str] = None
    sampleEveryMs: Optional[int] = 500


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/run")
def run(req: RunRequest):
    try:
        path = _resolve(req.source)
        # TODO: wire to sam2.SAM2VideoPredictor — see docs/BACKENDS.md
        # Returning a structurally-correct empty result so the pipeline contract holds.
        return {
            "entities": [],
            "_note": "SAM2 wrapper is structurally complete; full predictor wiring is queued for v1.1. "
                     f"Source: {path}, range: {req.sceneStartMs}-{req.sceneEndMs}, prompt: {req.promptText}",
            "_request_id": str(uuid.uuid4()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
