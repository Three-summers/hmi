# Craftsmanship Runtime Hardening Design

Date: 2026-04-12

## Goal

Harden the backend craftsmanship runtime so configuration mistakes fail fast, safe-stop cannot hang indefinitely, and the runtime has a small set of process-flow acceptance tests that cover realistic multi-step execution and branching behavior.

## Scope

Included:
- Backend-only changes under `src-tauri/src/craftsmanship/`
- Validation hardening in loader and validation layers
- Runtime safe-stop timeout behavior
- New backend acceptance-style process-flow tests in `src-tauri/src/craftsmanship/runtime/tests.rs`

Excluded:
- Frontend changes
- IPC API redesign
- Broad runtime refactors unrelated to the identified issues
- New real-host transport tests beyond the existing ignored integration cases

## Problems To Solve

1. Safe-stop steps can currently wait forever if completion feedback never arrives.
2. `onError` and `onViolation` are free-form strings, so typos silently fall back to other runtime branches.
3. Duplicate top-level identifiers can be resolved silently instead of producing deterministic load errors.
4. Invalid serial framing values silently degrade to defaults in the comm layer.
5. Existing runtime tests are strong at feature-level behavior, but still miss the planned acceptance-style process-flow coverage.

## Design

### 1. Safe-Stop Timeout Semantics

Add `timeoutMs` as an optional field on `SafeStopStep`.

Runtime behavior:
- If a safe-stop step declares `timeoutMs`, use that value.
- If it does not declare `timeoutMs`, use `DEFAULT_SAFE_STOP_TIMEOUT_MS = 5000`.
- Safe-stop completion waiting must never use an unbounded wait.
- If a safe-stop step times out, mark that safe-stop step as `Failed`.
- If safe-stop was entered because a recipe step failed with `onError = safe-stop`, preserve the original mainline failure in `last_error` and finish the runtime as `Stopped`.
- If the operator manually stops during safe-stop, existing stop behavior remains unchanged.

Compatibility:
- Existing `safe-stop.json` files remain valid because `timeoutMs` is optional.
- Old projects that omitted timeout values now get deterministic bounded behavior instead of hanging.

### 2. Validation For Recovery Policy Strings

Validation will enforce explicit allowed values for policy fields:
- `recipe.steps[].onError`: `stop`, `ignore`, `safe-stop`
- `interlocks.rules[].onViolation`: `block`, `alarm`

Rules:
- Missing policy fields keep their current default semantics.
- Explicit but invalid values produce error diagnostics during bundle validation.
- Runtime code should no longer rely on typos falling through to a default branch.

This keeps backward compatibility for omitted fields while turning misspellings into visible configuration errors.

### 3. Duplicate Identifier Detection

Add deterministic duplicate-ID detection for:
- `system.actions[].id`
- `system.device_types[].id`
- workspace-level `project.id`

Behavior:
- `scan_workspace()` should emit diagnostics for duplicate system and project identifiers.
- `get_project_bundle()` should fail if more than one project directory resolves to the same `project.id`.
- Runtime maps may still be built from validated inputs, but the loader and validation layers must prevent silent first-win or last-win behavior from becoming user-visible semantics.

This change is intentionally narrow. It only targets identifiers that can currently change load resolution or runtime behavior when duplicated.

### 4. Serial Framing Validation

Extend connection validation for serial connections so the configuration layer rejects invalid framing values before runtime:
- `dataBits` must be one of `5`, `6`, `7`, `8`
- `stopBits` must be one of `1`, `2`
- `parity` must be one of `none`, `even`, `odd`
- `baudRate`, if present, must be greater than `0`

Rules:
- Missing optional serial fields still use existing defaults.
- Invalid explicit values produce diagnostics.
- The comm layer fallback behavior remains as a defensive last line, but valid craftsmanship bundles should no longer depend on it.

### 5. Process-Flow Acceptance Tests

Add a dedicated `process_flow_tests` submodule at the end of `src-tauri/src/craftsmanship/runtime/tests.rs`.

Constraints:
- Reuse existing fixture helpers, fake transport overrides, GPIO override support, HMIP frame helpers, and transport locking.
- Do not introduce a generic testing DSL or broad helper refactor.
- Keep each scenario explicit so the recipe fixtures read like acceptance scripts.

Each process-flow test must:
- Cover at least 3 consecutive recipe steps
- Assert final `snapshot.status`
- Assert key step statuses
- Assert relevant `runtime_values` or `signal_values`
- For negative inputs, first prove the process does not advance incorrectly, then prove that the correct input does advance it

Planned scenarios:

1. `mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal`
- GPIO dispatch step
- HMIP dispatch step
- Wait-signal step completed by feedback mapping

2. `multi_device_process_should_complete_with_cross_transport_feedback_isolation`
- Two devices on different transports
- Wrong-device feedback first
- Correct device feedback later

3. `process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step`
- Out-of-order feedback must not advance the current step
- Correct later feedback must advance the intended step

4. `process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps`
- Mid-process HMIP dispatch send failure
- Failing step uses `onError = ignore`
- Later steps still complete

5. `process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain`
- Earlier mainline steps complete
- Later dispatch failure triggers `onError = safe-stop`
- Safe-stop chain completes and runtime ends as `Stopped`

6. `process_should_not_complete_when_feedback_connection_or_channel_is_wrong`
- Wrong `connectionId` or `channel` first proves no incorrect advancement
- Correct feedback afterwards proves advancement and completion

## Test Additions Outside Acceptance Flows

Add targeted regression tests for the hardening changes.

In `src-tauri/src/craftsmanship/tests.rs`:
- Invalid `onError` value produces an error diagnostic
- Invalid `onViolation` value produces an error diagnostic
- Duplicate `system.actions[].id` produces an error diagnostic
- Duplicate `system.device_types[].id` produces an error diagnostic
- Duplicate workspace `project.id` produces an error diagnostic during scan and an error from `get_project_bundle()`
- Invalid serial `dataBits`, `stopBits`, `parity`, and non-positive `baudRate` produce error diagnostics

In `src-tauri/src/craftsmanship/runtime/tests.rs`:
- A safe-stop step without completion feedback must terminate by timeout instead of hanging forever
- A safe-stop step with explicit `timeoutMs` must honor that explicit timeout rather than the default

## Error Handling And Compatibility

- This design prefers early configuration diagnostics over runtime fallback.
- Existing bundles that omit optional policy or serial fields remain valid.
- Existing bundles that contain invalid explicit values become invalid at load time. This is intentional because those values already produce undefined or misleading runtime behavior.
- Existing safe-stop files remain schema-compatible because `timeoutMs` is optional.
- No frontend API changes are required.

## Verification

Primary verification command:

```bash
cargo test craftsmanship -- --nocapture
```

The work is complete only when:
- Existing craftsmanship tests still pass
- New validation regression tests pass
- New process-flow acceptance tests pass
- No new ignored tests are introduced for fake-transport flows

## Implementation Notes

- Keep edits minimal and local to the existing backend modules.
- Prefer validation-layer fixes over runtime workaround branches.
- Reuse existing runtime test helpers unless a small additional helper clearly reduces duplication for the new process-flow module.
- Do not create backward-compatibility branches for invalid explicit values.
