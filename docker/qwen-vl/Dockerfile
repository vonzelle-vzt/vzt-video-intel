FROM vllm/vllm-openai:latest

# vLLM image already includes uvicorn etc. We thin-wrap with a /run endpoint
# that orchestrates chapter generation + action recognition.
RUN pip install --no-cache-dir fastapi==0.115.0 uvicorn[standard]==0.30.0 requests

COPY server.py /app/server.py
WORKDIR /app
EXPOSE 9011

ENV QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct

CMD ["bash", "-c", "python -m vllm.entrypoints.openai.api_server --model $QWEN_MODEL --port 9001 & uvicorn server:app --host 0.0.0.0 --port 9011"]
