FROM python:3.14-slim
WORKDIR /app
COPY services/ai/requirements.lock.txt /app/requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --uid 1000 --create-home app
COPY configuration.ini /app/configuration.ini
COPY services/ai/*.py /app/services/ai/
USER app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "services/ai/main.py"]
