FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl libglib2.0-0 libsm6 libxext6 libxrender1 \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      fastapi==0.115.0 \
      uvicorn[standard]==0.30.0 \
      easyocr==1.7.1 \
      opencv-python-headless==4.10.0.84

COPY server.py /app/server.py
WORKDIR /app
EXPOSE 9014
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9014"]
