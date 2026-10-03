FROM python:3.14-slim
WORKDIR /app
COPY backend/ai/requirements.lock.txt /app/requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --uid 1000 --create-home app
COPY deployment/configuration.ini /app/deployment/configuration.ini
COPY backend/ai/src /app/backend/ai/src
COPY prompts /app/prompts
USER app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/backend/ai/src
CMD ["python", "-m", "vivegam_ai.main"]
