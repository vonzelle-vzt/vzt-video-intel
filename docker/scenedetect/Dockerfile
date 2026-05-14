FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      fastapi==0.115.0 \
      uvicorn[standard]==0.30.0 \
      scenedetect==0.6.4 \
      opencv-python-headless==4.10.0.84 \
      pillow==10.4.0

COPY server.py /app/server.py
WORKDIR /app
EXPOSE 9013
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9013"]
