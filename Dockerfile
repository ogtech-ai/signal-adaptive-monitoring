FROM python:3.12-slim-bookworm
LABEL ai.ogtech.demo="signal-adaptive-monitoring"
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY app app
COPY data/uci_slice.json data/uci_slice.json
COPY data/ATTRIBUTION.md data/ATTRIBUTION.md
COPY LICENSE LICENSE
RUN useradd --create-home demo
USER demo
EXPOSE 8011
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8011", "--workers", "1"]
