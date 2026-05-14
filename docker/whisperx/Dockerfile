FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg git curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --upgrade pip \
  && pip3 install --no-cache-dir \
       fastapi==0.115.0 \
       uvicorn[standard]==0.30.0 \
       whisperx==3.1.5 \
       pyannote.audio==3.1.1 \
       torch==2.3.0 torchaudio==2.3.0 \
       requests

COPY server.py /app/server.py
WORKDIR /app
EXPOSE 9010
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9010"]
