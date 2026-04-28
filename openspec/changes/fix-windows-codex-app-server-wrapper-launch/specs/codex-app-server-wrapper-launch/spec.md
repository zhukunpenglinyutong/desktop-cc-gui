## ADDED Requirements

### Requirement: Codex App Server Launch MUST Preserve Existing Healthy Paths

The system MUST keep the current primary Codex app-server launch behavior for macOS, Linux, Windows direct executables, and Windows wrapper launches that complete successfully.

#### Scenario: macOS and Linux use primary launch only
- **WHEN** the system launches Codex app-server on macOS or Linux
- **THEN** it MUST use the existing primary launch path
- **AND** it MUST NOT trigger Windows wrapper compatibility retry

#### Scenario: Windows direct executable uses primary launch only
- **WHEN** the resolved Codex binary is not a `.cmd` or `.bat` wrapper on Windows
- **THEN** the system MUST use the existing primary launch path
- **AND** it MUST NOT trigger wrapper compatibility retry

#### Scenario: healthy Windows wrapper does not retry
- **WHEN** the resolved Codex binary is a `.cmd` or `.bat` wrapper on Windows
- **AND** the primary app-server launch completes initialize handshake successfully
- **THEN** the system MUST keep that primary session
- **AND** it MUST NOT perform compatibility retry

### Requirement: Windows Wrapper Failure MUST Use Bounded Compatibility Retry

When Windows `.cmd/.bat` wrapper launch fails before Codex app-server initialization completes, the system MUST attempt a bounded compatibility retry that avoids known fragile wrapper argument combinations.

#### Scenario: wrapper primary fails before initialize
- **WHEN** the resolved Codex binary is a `.cmd` or `.bat` wrapper on Windows
- **AND** the primary app-server launch exits, closes stdout, or fails initialize before the session becomes connected
- **THEN** the system MUST attempt at most one compatibility retry for that launch request
- **AND** retry diagnostics MUST retain the primary failure summary

#### Scenario: compatibility retry avoids fragile internal quoted config
- **WHEN** compatibility retry is attempted for a Windows wrapper launch
- **THEN** the retry MUST avoid sending the internal `developer_instructions` quoted TOML config argument through `cmd.exe /c <wrapper>`
- **AND** user-provided Codex args MUST still be preserved unless they are invalid

#### Scenario: retry success creates usable session
- **WHEN** primary Windows wrapper launch fails before initialize
- **AND** compatibility retry completes initialize handshake successfully
- **THEN** the system MUST create a usable Codex workspace session
- **AND** runtime diagnostics SHOULD indicate that fallback was retried

#### Scenario: retry failure keeps both errors diagnosable
- **WHEN** primary Windows wrapper launch fails
- **AND** compatibility retry also fails
- **THEN** the user-facing error detail MUST include both the primary failure and fallback failure summaries
- **AND** it MUST NOT collapse the result into a generic unknown startup failure

### Requirement: Internal Spec Priority Hint MUST NOT Block Codex Session Creation

The system MUST treat the internally injected external spec priority hint as a launch enhancement, not as a hard dependency that can prevent Codex app-server session creation on Windows wrapper environments.

#### Scenario: internal hint causes wrapper parse failure
- **WHEN** a Windows `.cmd/.bat` wrapper primary launch fails because the internal `developer_instructions` config argument is parsed incorrectly
- **THEN** compatibility retry MUST be allowed to create the session without that fragile internal CLI argument
- **AND** the fallback MUST NOT remove or mutate user-authored `codexArgs`

#### Scenario: user instruction override remains respected
- **WHEN** user-provided `codexArgs` already include `developer_instructions` or `instructions`
- **THEN** the system MUST continue to respect the existing override detection
- **AND** compatibility retry MUST NOT inject a competing internal instructions config

### Requirement: Codex Doctor MUST Align With App Server Launch Compatibility

Codex doctor and app-server probe MUST model the key app-server launch risks closely enough to detect Windows wrapper compatibility failures before or during session creation.

#### Scenario: doctor reports wrapper launch context
- **WHEN** Codex doctor runs for a Windows wrapper-resolved binary
- **THEN** the result MUST include the resolved binary path and wrapper kind
- **AND** it MUST expose whether app-server probe fallback was retried

#### Scenario: probe covers internal launch suffix risk
- **WHEN** app-server probe evaluates Codex app-server availability
- **THEN** it MUST cover the same internal app-server launch suffix risk that real session creation uses
- **OR** it MUST expose that compatibility fallback was required to make the probe pass

#### Scenario: installation errors remain visible
- **WHEN** Codex CLI is missing, Node is unavailable, PATH resolution fails, or `codex app-server --help` fails independently of wrapper compatibility
- **THEN** doctor MUST expose the underlying failure detail
- **AND** compatibility retry MUST NOT report the environment as healthy solely because a fallback path was attempted

### Requirement: Wrapper Compatibility MUST Be Testable

The system MUST include targeted backend tests that lock the wrapper fallback contract and protect non-wrapper paths from accidental behavior changes.

#### Scenario: wrapper fallback gating is covered
- **WHEN** backend tests exercise Windows wrapper launch planning or equivalent platform-gated helpers
- **THEN** they MUST verify that `.cmd/.bat` wrapper failures are eligible for bounded compatibility retry
- **AND** direct executable launches are not eligible

#### Scenario: internal hint fallback is covered
- **WHEN** backend tests exercise compatibility retry planning
- **THEN** they MUST verify that the retry avoids the fragile internal quoted config argument
- **AND** preserves user-provided Codex args
