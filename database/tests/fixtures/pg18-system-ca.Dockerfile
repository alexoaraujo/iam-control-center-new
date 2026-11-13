# Isolated IAM canonical PostgreSQL 18 client; never runs a database server.
# Explicitly provision Debian system CA roots for libpq sslrootcert=system.
FROM postgres:18-bookworm
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    update-ca-certificates; \
    test -s /etc/ssl/certs/ca-certificates.crt; \
    rm -rf /var/lib/apt/lists/*
# OpenSSL uses the OS-maintained trust store, not a copied Neon leaf certificate.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER postgres
