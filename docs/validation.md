# Validation and evidence

This example is not a production certification. Validate in your own subscription
and region; previous runs do not establish your quotas, policy compliance or
current dependency safety.

## Automated offline checks

- Backend tests exercise real local HTTP, authentication, MCP initialization,
  discovery/tool calls, invalid tool input and compressed-body rejection.
- Filter tests exercise the pinned APIops implementation, including omitted
  versus empty filter families and API child-resource selection.
- PowerShell/Bash regressions verify subscription guards, dry-run/apply,
  scope rejection, source snapshot preservation and MCP metadata comparisons.
- CI runs the tests on Ubuntu and Windows and compiles Bicep without Azure login.

## Live checks

The repository's lab has recorded successful promotion workflow runs. Treat that
as sample evidence, not a guarantee: check the run's selected mode and final
summary to distinguish a preview from completed publication and target testing.
The public example does not embed personal subscription details or internal
execution notes.

For your deployment, complete the [acceptance checklist](testing-and-security.md)
and retain sanitized evidence that:

1. The backend and both source MCP tools respond.
2. Extraction contains only the three intended APIs and their children.
3. The publisher dry-run targets the separate target APIM.
4. Apply preserves target paths and rewrites the native tool binding.
5. Both target MCP tools respond and the checked source snapshot is unchanged.

## Remaining boundaries

Preview ARM metadata can produce Bicep BCP081 warnings. Compilation is not live
ARM validation. No quota, disaster recovery, production reliability, immutable
artifact promotion, atomic rollback or full APIM backup is implied.

Review the [dependency risk register](dependency-risks.md) before Azure-connected
execution. Offline CI does not suppress or resolve those advisory findings.
