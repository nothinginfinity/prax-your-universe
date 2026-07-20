# PUX-006 Assessment — Validation and Tests

**Status:** In progress  
**Starting repository commit:** `54bfd10403b0530414276736cfde569c3d6043c5`  
**Working branch:** `pux-006-validation-tests`  
**Application version at start:** `0.2.0-pux.5`  
**Graph schema version:** `1`  
**IndexedDB database version:** `1`

## Purpose

PUX-006 is a validation-hardening milestone. It does not introduce a new graph schema or IndexedDB version merely to create migration activity. The current version-1 formats remain canonical unless testing identifies a real product requirement for a new format.

## Existing evidence inherited from PUX-005

PUX-005 already verified deterministic import/export, malformed-payload rejection, persistence rollback, scene replacement, reload persistence, root topology, edge endpoint integrity, and desktop/mobile behavior. PUX-006 therefore adds focused regression coverage instead of duplicating the PUX-005 suite.

## Initial implementation scope

- Table-driven invalid URL rejection for link creation.
- URL canonicalization and atomic rollback for invalid link edits.
- Connected-edge and layout-node cleanup during deletion.
- Strict graph validation after destructive mutations.
- Deterministic and idempotent legacy graph normalization.
- Full create, edit, delete, relationship, settings, save, close, and reload matrix.
- A dedicated non-deploying GitHub Actions workflow for the PUX-006 branch.
- Reproducible desktop and touch-mobile browser verification against a local Worker instance.

## Safety boundaries

- No production deployment from the PUX-006 validation branch.
- No graph schema or IndexedDB version increase without a demonstrated migration requirement.
- No roadmap completion claim until final review and production verification are complete.
- Existing stable PUX-005 behavior remains the baseline and must not regress.

## Automated validation evidence

Commit `781554a82dac8a8e1951f7495ad30f7812846fcc` passed the first dedicated non-deploying GitHub Actions workflow.

- Workflow: `Validate PUX-006`
- Run: `29783478285`
- Existing tests plus five focused PUX-006 regression cases: passed
- JavaScript syntax checks: passed
- Wrangler deployment dry-run: passed
- Production deployment: not performed

Commit `35e9b9abc01011c8c89045ffaaaf6409d5122223` passed the complete validation workflow including browser verification.

- Workflow run: `29784010623`
- Unit and integration tests: passed
- JavaScript syntax checks: passed
- Wrangler deployment dry-run: passed
- Desktop browser verification at 1440 × 900: passed
- Mobile browser verification at 390 × 844 with touch emulation: passed
- Invalid URL alert and graph non-mutation: passed
- Valid link creation and IndexedDB persistence across reload: passed
- One canonical root and one root `contains` edge per non-root node: passed
- Horizontal overflow check: passed
- Console, page, request, and HTTP failure collection: passed with no captured failures
- Browser screenshots, verifier report, verifier log, and Wrangler log were retained as workflow artifacts

## Independent production baseline evidence

Independent baseline browser capture `vb_5c94c8f7` completed successfully against the unchanged PUX-005 production application.

- Desktop child run: `vb_5c94c8f7_0` at 1440 × 900
- Mobile child run: `vb_5c94c8f7_1` at 390 × 844 with mobile and touch emulation
- Both captures completed with stored screenshot, HTML, accessibility, console, network, and manifest evidence

## Defect classification

The first browser-enabled workflow run `29783655361` failed because the verifier awaited completion of a Playwright click before dismissing the JavaScript alert triggered by that click. The click and verifier therefore waited on each other until timeout.

This was a verifier ordering defect, not a product defect. The dialog listener and click are now started together, the dialog is dismissed, and the click is then awaited. The corrected workflow passed without changing application code.

## Remaining work

- Review the branch diff and browser artifacts before merge.
- Decide whether a dedicated PUX-006 production verifier should be added to the main deployment workflow or whether the existing PUX-005 production verifier plus independent visual evidence is sufficient.
- Update the canonical roadmap and release documentation only after final acceptance.
- Merge only after review; no merge or production deployment has been performed from this branch.
