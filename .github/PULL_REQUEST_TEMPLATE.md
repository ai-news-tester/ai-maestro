## Description

Provide a concise summary of the changes and the rationale behind them.

Closes #(issue)

---

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactoring / code cleanup
- [ ] Documentation improvement
- [ ] CI/CD enhancement

---

## Checklist

- [ ] All five suites pass locally: `node bug-repro.mjs`, `node auto-repro.mjs`, `node deshimmer-repro.mjs`, `node dom-contract.mjs`, `node link-check.mjs`
- [ ] No new dependencies and no build step added
- [ ] Any new DSP stage is present in the shared chain (`buildMasterChain`), so live playback and export stay identical
- [ ] Documentation updated to reflect changes, where relevant
- [ ] Conventional Commit message format used
