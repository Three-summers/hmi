# Process Flow Tests Design

Date: 2026-03-27

## Goal

Expand backend craftsmanship runtime tests with a small set of high-value, end-to-end process flow scenarios. The new tests should read like acceptance flows for real recipes rather than low-level implementation checks.

## Scope

This design only covers backend runtime process-flow tests.

Included:
- Fake-transport runtime tests in `src-tauri/src/craftsmanship/runtime/tests.rs`
- Long-chain recipe scenarios that combine multiple step types
- Mainline completion flows
- Mid-process branch flows using `ignore` and `safe-stop`
- Protection flows where incorrect feedback must not advance the runtime

Excluded:
- UI tests
- Additional communication-layer unit tests
- New real-host integration tests
- Broad test-framework refactors or generic testing DSLs

## Success Criteria

Each new process-flow test must:
- Cover at least 3 consecutive recipe steps
- Assert final `snapshot.status`
- Assert key step statuses
- Assert relevant `runtime_values` or `signal_values`
- For negative inputs, first prove the process does not advance incorrectly, then prove the correct input does advance it

## Test Groups

### 1. Complete Flow Group

These tests verify that a realistic multi-step recipe can complete through multiple action and feedback types.

#### 1.1 `mixed_transport_process_should_complete_over_gpio_then_hmip_then_wait_signal`

Flow:
- Step 1 writes a fixed GPIO value
- Step 2 dispatches a fixed HMIP payload
- Step 3 waits for a signal updated through feedback mapping

Assertions:
- Runtime finishes with `Completed`
- All 3 steps finish with `Completed`
- GPIO override observes the fixed configured value
- HMIP fake device receives the expected frame
- Target signal value is written correctly

#### 1.2 `multi_device_process_should_complete_with_cross_transport_feedback_isolation`

Flow:
- Device A and device B use different transports
- Steps are interleaved across the devices
- A feedback event for the wrong device is injected before the correct one

Assertions:
- Wrong-device feedback does not advance the active step
- Correct feedback advances the correct step only
- Runtime finishes with `Completed`
- Both device runtime values are correct at the end

#### 1.3 `process_should_complete_when_feedback_arrives_out_of_order_but_matches_correct_step`

Flow:
- The runtime receives feedback that belongs to a later step or an unrelated step
- The runtime later receives the feedback the current step actually needs

Assertions:
- Out-of-order feedback does not complete the current step
- Correct feedback completes the intended step
- The full process finishes with `Completed`

### 2. Branch Flow Group

These tests verify that long recipes behave correctly when a mid-process dispatch fails and the recipe must branch according to `onError`.

#### 2.1 `process_should_continue_after_ignored_dispatch_send_failure_and_complete_following_steps`

Flow:
- Step 1 dispatches HMIP and intentionally triggers `dispatch_send_failed`
- Step 1 uses `onError = ignore`
- Later GPIO and wait steps still run and complete

Assertions:
- Step 1 finishes with `Failed`
- Following steps finish with `Completed`
- Runtime finishes with `Completed`
- The ignored failure does not prevent later value updates and step execution

#### 2.2 `process_should_enter_safe_stop_after_mid_process_dispatch_failure_and_finish_safe_stop_chain`

Flow:
- Earlier mainline steps complete successfully
- A later HMIP dispatch intentionally fails with `dispatch_send_failed`
- The failing step uses `onError = safe-stop`
- Safe-stop executes a GPIO shutdown step and a confirmation wait step

Assertions:
- Runtime phase transitions to `SafeStop`
- Original mainline failure is preserved in `last_error`
- Safe-stop steps run with the expected statuses
- Final runtime status is `Stopped`

### 3. Protection Flow Group

These tests verify that syntactically valid but semantically wrong feedback cannot advance the process.

#### 3.1 `process_should_not_complete_when_feedback_connection_or_channel_is_wrong`

Flow:
- The process waits on HMIP-driven feedback
- A frame with the wrong `connectionId` or `channel` is injected first
- The matching frame is injected afterwards

Assertions:
- Wrong feedback does not advance the active step
- Correct feedback advances the process
- Runtime finishes with `Completed`

## Test Organization

The new scenarios stay in `src-tauri/src/craftsmanship/runtime/tests.rs`, but they should be grouped into a dedicated submodule such as `process_flow_tests` so they are visually separated from the smaller state-machine tests already present.

Existing helpers should be reused:
- `TestWorkspace`
- `setup_runtime_app`
- `read_hmip_frame`
- `write_hmip_frame`
- `wait_for_terminal_status`

Add only a small amount of shared test support:
- `write_process_flow_base(...)`
  - Writes common system and project fixtures needed by these long-chain tests
- `spawn_fake_hmip_device(...)`
  - Owns fake HMIP device setup and expected-frame assertions
- `wait_until_step(...)`
  - Waits for a target step to reach `Running`, `Completed`, or `Failed`

Constraints:
- Do not create a generic test DSL
- Do not introduce macros
- Keep per-test recipe fixtures explicit in each scenario
- Extract only setup repeated more than twice

## Transport and Runtime Constraints

- Use fake transports by default
- Reuse the current HMIP helpers based on `duplex`, frame encode/decode helpers, and communication overrides
- Reuse the current GPIO override path
- Do not add new real TCP or real serial integration cases in this batch

## Execution Order

Implement in three batches:

1. Complete Flow Group
- Build the main fixtures and prove the primary acceptance flows

2. Branch Flow Group
- Extend the same style of tests with `ignore` and `safe-stop`

3. Protection Flow Group
- Add the wrong-feedback protection regression last

## TDD Workflow

Implementation must follow strict TDD:

1. Add one new test
2. Run the targeted test and observe the failure
3. Apply the minimal change needed, which may be either:
- A production fix
- A missing test helper
- A correction to the test expectation if the runtime contract was misunderstood
4. Re-run the targeted test
5. Re-run the relevant test group
6. Move to the next scenario only after the current one is green

## Failure Rules

Treat the scenario as failed if any of the following happens:
- The runtime does not reach the expected step or terminal state before timeout
- Incorrect feedback advances the runtime
- An `ignore` branch prevents later steps from running
- A `safe-stop` branch loses the original failure reason
- Final status and key value assertions disagree with the intended flow

## Verification Plan

After implementation:
- Run each new scenario individually while developing
- Run the full runtime test suite
- Run the full backend test suite with:

```bash
cargo test --manifest-path ./src-tauri/Cargo.toml -- --test-threads=1
```

- Run:

```bash
cargo check --manifest-path ./src-tauri/Cargo.toml
```

## Out of Scope Follow-Ups

These may be added later, but are not part of this design:
- Additional communication actor recovery cases beyond the current coverage
- Real-host acceptance tests for the new long flows
- Parameterized test generation
- Further splitting of `runtime/tests.rs` into multiple files
