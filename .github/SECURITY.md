# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

---

## Reporting a Vulnerability

If you discover a vulnerability, please report it responsibly instead of opening a public GitHub issue.

Report via GitHub Security Advisories on this repository: https://github.com/ai-news-tester/ai-maestro/security/advisories/new

Include:
- Type of issue
- Step-by-step instructions or a proof-of-concept to reproduce it
- Affected versions and environment (browser and OS)
- Proposed mitigation or fix, if available

---

## Threat Model

AI-Maestro is a client-side app. There is no server, no uploads, and no account system: audio a user opens stays in their browser and is decoded by the browser's own Web Audio decoder.

Relevant risks and mitigations:

### 1. Untrusted audio
* **Threat**: A crafted audio file triggers a decoder bug or excessive memory use in the browser.
* **Mitigation**: Decoding is delegated to the browser. The app itself does not parse binary audio formats with custom code.

### 2. Numerical instability
* **Threat**: NaN, Inf, or extreme amplitudes in decoded samples damage hearing or speakers downstream.
* **Mitigation**: DSP stages guard against non-finite values, and exported output is clamped to the limiter ceiling and the [-1.0, 1.0] range before 16-bit PCM encoding.

### 3. Code execution from data
* **Threat**: Settings, presets, or audio metadata execute arbitrary code.
* **Mitigation**: The app uses no `eval` and no dynamic code generation. Configuration is plain JSON (`docs/knob-registry.json`), and persisted settings are read as data only.

### 4. Supply chain
* **Threat**: A compromised dependency runs in the page.
* **Mitigation**: There are no runtime dependencies and no build step. The app is plain JavaScript ES modules served as static files.
