FROM python@sha256:019e31cc1f52e4139d338bca44f27b71339a9da261738fd80fab9cf4595152fc
WORKDIR /app
COPY services/data-worker/requirements.runtime.txt /app/requirements.runtime.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /app/requirements.runtime.txt
COPY services/data-worker/*.py /app/services/data-worker/
COPY domain-contracts /app/domain-contracts
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65532:65532
ENTRYPOINT ["python", "/app/services/data-worker/container_entry.py"]
