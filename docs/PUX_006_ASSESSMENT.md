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

## Safety boundaries

- No production deployment from the PUX-006 validation branch.
- No graph schema or IndexedDB version increase without a demonstrated migration requirement.
- No roadmap completion claim until automated validation and desktop/mobile live verification pass.
- Existing stable PUX-005 behavior remains the baseline and must not regress.

## Remaining work

- Run the dedicated branch validation workflow and classify any failures.
- Add or refine tests only where evidence shows a coverage gap.
- Add dedicated browser verification for desktop and mobile.
- Update the canonical roadmap and release documentation only after final acceptance.
