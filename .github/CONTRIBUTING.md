# Contributing to AI-Maestro

Thank you for your interest in contributing to AI-Maestro, a zero-dependency browser Web Audio app served from `docs/`.

## Code of Conduct

All contributors must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting Started

### Prerequisites

* Node 20+
* `git`
* Python 3 (only to serve the static site locally with `http.server`)

### Local Development Setup

1. Fork the repository on GitHub and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/ai-maestro.git
   cd ai-maestro
   ```

2. Run the app locally:
   ```bash
   cd docs
   python -m http.server 8123
   # open http://127.0.0.1:8123/
   ```

3. Verify your setup by running the test suites from the repo root:
   ```bash
   node bug-repro.mjs
   node auto-repro.mjs
   node deshimmer-repro.mjs
   node dom-contract.mjs
   node link-check.mjs
   ```

## Architectural Rule

Live playback and export must stay identical. Any new DSP stage goes into `buildMasterChain` in `docs/modules/dsp.js`, so both paths use it. Do not add a stage to only one path.

No new dependencies and no build step.

## Development Workflow

Create a branch from `main`:
```bash
git checkout -b feature/your-feature-name
git checkout -b fix/your-fix-name
```

### Commit Message Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

* `feat: add adaptive notch filtering`
* `fix: correct Nyquist boundary check in STFT`
* `docs: update README controls table`
* `refactor: extract spectrum overlay helper`
* `test: add deshimmer stage check`

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a Pull Request against `main`.
3. Complete the Pull Request template checklist.
4. Ensure all five suites pass locally and in CI.

## Security Vulnerabilities

Please do not report security vulnerabilities via public GitHub issues. Follow our [Security Policy](SECURITY.md) for responsible disclosure.
