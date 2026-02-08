# Pre-built Garaga image for fast proof formatting
FROM python:3.10-slim

RUN pip install --no-cache-dir garaga

WORKDIR /work

ENTRYPOINT ["garaga"]
