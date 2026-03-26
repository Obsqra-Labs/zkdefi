# Starknet Sepolia — Ekubo pool observer + optional market-activity bots
# https://github.com/Obsqra-Labs/zkdefi (market-maker-sim)

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

EXPOSE 8099

# Read-only friendly: omit BOT_* and set FLEET_ENABLED=false in compose.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8099"]
