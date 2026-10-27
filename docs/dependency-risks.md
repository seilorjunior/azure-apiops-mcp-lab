# Dependency risk register

This educational example is **not advisory-free**. Audit evidence below was
checked on 2026-10-26. Re-run `npm audit` and `npm audit --omit=dev` before use;
registry advisories and available releases change.

## Automated tracking

The [Dependency risk audit workflow](../.github/workflows/dependency-audit.yml)
runs every Monday at 09:23 UTC and supports manual dispatch. GitHub schedules can
be delayed and run from the default branch. The workflow becomes available after
the files are merged into that branch; fork owners must enable scheduled Actions
in their own repository.

The audit restores locked dependencies without lifecycle scripts, then runs npm's
JSON audits for the full tree and production dependencies. It writes a GitHub job
summary with counts, advisory links, production/development scope and exception
expiry. It has read-only repository permissions, uses no Azure identity or
secrets, and does not upload raw reports or create issues.

Run the same gate locally after `npm ci`:

```text
npm run audit:dependencies
```

| Result | Exit code | Meaning |
| --- | --- | --- |
| Passed | 0 | No unaccepted high/critical findings or expired exceptions. Lower-severity and accepted risks remain visible. |
| Failed risk gate | 1 | At least one unaccepted high/critical advisory or an expired exception. |
| Audit error | 2 | Registry/network/process failure, invalid report or invalid exception policy. No clean-risk result is available. |

This is a separate scheduled/manual gate. Normal PR CI remains offline and does
not require this audit to pass. Dependabot still proposes updates separately;
the audit does not change packages, force fixes, merge updates or disable promotion.
Maintainers must inspect failed runs and review exposure before Azure execution.

### Time-limited exceptions

The [exception policy](../config/dependency-exceptions.json) starts empty.
The historical risks below are **not** automatically accepted by the gate.
To propose acceptance, add an entry through a reviewed PR:

```json
{
  "exceptions": [
    {
      "advisory": "GHSA-27r3-jxmh-p828",
      "package": "body-parser",
      "scope": "production",
      "owner": "YOUR_GITHUB_LOGIN",
      "reason": "Describe reviewed exposure, mitigation and the upstream remediation blocker.",
      "expires": "YYYY-MM-DD"
    }
  ]
}
```

Replace the owner, reason and expiry placeholders before submitting; the example
does not authorize acceptance. Match the exact advisory, directly affected package
and `production` or `development` scope shown by the audit. No wildcard exceptions
are supported. Production scope takes precedence when a finding appears in both
audits. Expiry is inclusive through that UTC date. Expired entries fail the gate
even when the advisory is gone; remove resolved entries rather than automatically
renewing them. Exceptions record risk acceptance, not remediation.

## Historical audit evidence

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
