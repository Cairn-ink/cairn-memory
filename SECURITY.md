# Security policy

## Reporting a vulnerability

Do not open a public issue for suspected credential exposure, cross-user recall, scope bypass, or another vulnerability.

Use GitHub private vulnerability reporting on this repository: **Security → Advisories → Report a vulnerability**. Include the affected version, reproduction steps, expected boundary, and the smallest safe example payload. Do not include real credentials or private conversation content.

We will acknowledge a report within three business days and coordinate disclosure after a fix is available. Supported versions are listed in release notes; during alpha, only the latest tagged release receives security fixes.

## Security invariants

- Capture is an allowlist, not a transcript dump.
- Redaction happens before transport and again on the service.
- Project derivation secrets never leave the device.
- Inferred memory never widens into shared scope automatically.
- Failures never block the host agent.
