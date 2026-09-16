ARG WORKER_IMAGE
FROM ${WORKER_IMAGE}
COPY isolation_probe.py /probe.py
ENTRYPOINT ["python", "/probe.py"]
