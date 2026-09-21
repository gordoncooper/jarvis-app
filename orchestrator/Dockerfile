FROM python:3.12-slim-bookworm
WORKDIR /app
RUN useradd -r -u 10001 jarvis
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ARG JARVIS_VERSION=dev
ENV JARVIS_VERSION=$JARVIS_VERSION
USER jarvis
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
