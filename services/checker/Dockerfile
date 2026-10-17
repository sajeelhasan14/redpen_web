FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY checker ./checker
ENV PORT=8000
# Railway's private network is IPv6, so listen on :: rather than 0.0.0.0.
CMD ["sh", "-c", "uvicorn checker.app:app --host :: --port ${PORT} --workers 2"]
