"""Qwen2.5-VL HTTP wrapper — POST /run with {mode, source, ...}.

Modes:
  chapters  → {chapters: [{start_ms, end_ms, title, summary?}]}
  actions   → {actions: [{start_ms, end_ms, label, confidence}]}

The wrapper proxies vision+text prompts to the local vLLM OpenAI-compatible
server (running on :9001) and shapes the JSON to the scene-graph schema.
"""

import json
import os
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
VLLM_URL = "http://localhost:9001/v1/chat/completions"
MODEL = os.environ.get("QWEN_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct")


class RunRequest(BaseModel):
    source: str
    mode: Optional[str] = "chapters"
    targetChapterCount: Optional[int] = 8
    style: Optional[str] = "youtube"
    sceneStartMs: Optional[int] = None
    sceneEndMs: Optional[int] = None


@app.get("/health")
def health():
    try:
        r = requests.get("http://localhost:9001/v1/models", timeout=3)
        return {"ok": r.ok, "model": MODEL}
    except Exception:
        return {"ok": False, "model": MODEL}


def _vllm_chat(prompt: str) -> str:
    r = requests.post(VLLM_URL, json={
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
        "temperature": 0.2,
    }, timeout=120)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


@app.post("/run")
def run(req: RunRequest):
    try:
        if req.mode == "chapters":
            prompt = f"Generate {req.targetChapterCount} chapters for a video in '{req.style}' style. Return a JSON object with a 'chapters' array, each item having start_ms, end_ms, title, and optional summary. Source: {req.source}"
            raw = _vllm_chat(prompt)
            try:
                parsed = json.loads(raw)
                return {"chapters": parsed.get("chapters", [])}
            except Exception:
                return {"chapters": [], "_raw": raw}
        if req.mode == "actions":
            prompt = f"Identify actions in this clip from {req.sceneStartMs or 0}ms to {req.sceneEndMs or 'end'}ms. Return JSON with 'actions' array, each item having start_ms, end_ms, label, confidence."
            raw = _vllm_chat(prompt)
            try:
                parsed = json.loads(raw)
                return {"actions": parsed.get("actions", [])}
            except Exception:
                return {"actions": [], "_raw": raw}
        raise HTTPException(status_code=400, detail=f"unknown mode: {req.mode}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
