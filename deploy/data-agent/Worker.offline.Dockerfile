# Build only after verifying the supplied dependency image against the delivery manifest.
ARG DEPENDENCIES_IMAGE
FROM ${DEPENDENCIES_IMAGE}
COPY services/data-worker/*.py /app/services/data-worker/
COPY domain-contracts /app/domain-contracts
ENTRYPOINT ["python", "/app/services/data-worker/container_entry.py"]
