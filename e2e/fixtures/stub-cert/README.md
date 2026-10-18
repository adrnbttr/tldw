# Test-only certificate

Self-signed EC key pair used by `e2e/pipeline.mjs` for its local HTTPS stub of `openrouter.ai`
and `api.openai.com` (SAN also covers `localhost` / `127.0.0.1`). Chromium is launched with
`--ignore-certificate-errors`, so the certificate is never trusted by anything else: the key is
public on purpose and secures nothing. Regenerate with:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key.pem \
  -out cert.pem -days 36500 -subj "/CN=tldw e2e stub (test only)" \
  -addext "subjectAltName=DNS:openrouter.ai,DNS:api.openai.com,DNS:localhost,IP:127.0.0.1"
```
