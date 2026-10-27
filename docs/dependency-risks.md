# Dependency risk register

This educational example is **not advisory-free**. Audit evidence below was
checked on 2026-10-26. Re-run `npm audit` and `npm audit --omit=dev` before use;
registry advisories and available releases change.

| Dependency path | Advisory | Status at review |
| --- | --- | --- |
| Express 5 -> body-parser 2.3.0 | GHSA-27r3-jxmh-p828 | High; affected `<2.4.0`, but 2.4.0 was not available in the checked registry. |
| MCP SDK -> ajv -> fast-uri 3.x | GHSA-w74x-v6f9-j3xg; GHSA-xhq7-xmqj-769h; GHSA-wjr9-j795-jxcr; GHSA-333x-w4r6-6crp | Affected 3.x path; the suggested fixed 3.1.9 patch was not available in the checked registry. A 4.x release is not a compatible patch. |
| APIops -> simple-git / argv-parser | GHSA-x6jw-m9v5-85vh; GHSA-g4wm-2vf7-vfgr; GHSA-858h-whjf-mvg5; GHSA-v5rq-49vh-5v5c | Critical/high development-toolchain findings. Patched major versions exist, but APIops 1.0.5 does not declare compatible ranges for those major upgrades. |
| APIops -> Azure Identity -> MSAL Node 6.x | GHSA-xcx6-jx8p-x3h5 | High; the fixed MSAL 7.x line is outside the installed identity dependency's range. |

The audit reported five production findings (three high, two moderate) and ten
across the full tree (two critical, six high, two moderate). Transitive and parent
package findings can describe the same underlying advisory; counts are not a
count of independently exploitable vulnerabilities in this application.

Top-level versions were already the latest published stable versions checked:
APIops 1.0.5, MCP SDK 1.32.1, Express 5.3.0 and Zod 4.6.7. npm's proposed SDK
1.5.0 and Express 4.x changes are downgrades, not validated remediation.
No unsupported major overrides, forced fixes or suppressed advisories were used.

## Operating policy

- Offline tests can pass while advisories remain. CI does not claim otherwise.
- Keep Azure promotion disabled by default. Before opting in, the lab owner must
  review these risks, scope the identity to disposable lab resources and apply
  environment approval/branch protections.
- Never run the Azure-connected workflow on untrusted pull-request code.
- Do not place real customer content or production traffic in this lab.
- Compressed requests are rejected by the backend, but that does not clear
  body-parser's advisory or secure every transitive dependency path.
- Review Dependabot updates and upstream releases with the existing regression
  suites; do not enable automatic merging of toolchain changes.

Advisories: [GitHub Advisory Database](https://github.com/advisories).
See [SECURITY.md](../SECURITY.md) for private reporting.
