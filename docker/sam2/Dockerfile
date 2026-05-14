FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg git curl libglib2.0-0 libsm6 libxext6 libxrender1 \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --upgrade pip \
  && pip3 install --no-cache-dir \
       fastapi==0.115.0 \
       uvicorn[standard]==0.30.0 \
       torch==2.3.0 torchvision==0.18.0 \
       opencv-python-headless==4.10.0.84 \
       pillow==10.4.0 \
       requests \
       'git+https://github.com/facebookresearch/sam2.git'

COPY server.py /app/server.py
WORKDIR /app
EXPOSE 9012
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9012"]
