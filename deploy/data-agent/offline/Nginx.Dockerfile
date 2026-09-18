# Materialize one cached platform into a self-contained exportable image.
ARG NGINX_IMAGE
FROM ${NGINX_IMAGE}
LABEL org.opencontainers.image.description="Data Agent offline ingress"
ENTRYPOINT ["nginx", "-g", "daemon off;"]
