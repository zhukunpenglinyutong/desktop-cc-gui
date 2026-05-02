## ADDED Requirements

### Requirement: Missing Or Stale Paths MUST NOT Trigger Monitor-Unavailable Toasts

The detached external file monitor MUST classify missing-file and stale-path read failures as file availability state, not as external monitor availability failures.

#### Scenario: Windows os error 3 is treated as stale path
- **WHEN** detached external sync refresh reads the active workspace file
- **AND** the read fails with a message containing `os error 3`
- **AND** the message also contains Windows path-not-found text
- **THEN** the system MUST treat the failure as a missing or stale path
- **AND** it MUST NOT show `External file monitor is unavailable`

#### Scenario: Bare os error 3 remains diagnosable
- **WHEN** detached external sync refresh reads the active workspace file
- **AND** the read fails with `os error 3` without path-not-found text
- **THEN** the system MUST NOT classify the failure as a missing or stale path solely by the numeric code
- **AND** the failure MUST remain eligible for the existing monitor-unavailable threshold

#### Scenario: Windows path-not-found text is treated as stale path
- **WHEN** detached external sync refresh reads the active workspace file
- **AND** the read fails with Windows path-not-found text such as `The system cannot find the path specified` or `系统找不到指定的路径`
- **THEN** the system MUST treat the failure as a missing or stale path
- **AND** it MUST NOT show a monitor-unavailable toast

#### Scenario: Existing no-such-file classification remains silent
- **WHEN** detached external sync refresh fails with `os error 2`, `ENOENT`, or `No such file or directory`
- **THEN** the system MUST keep the existing silent missing-file behavior

### Requirement: Real Monitor Refresh Failures MUST Remain Visible

The detached external file monitor MUST continue to notify users when repeated non-missing read failures indicate that external sync cannot refresh the active file.

#### Scenario: Non-missing read errors still surface after threshold
- **WHEN** detached external sync repeatedly fails with a non-missing read error
- **AND** the existing error threshold and cooldown conditions are met
- **THEN** the system SHOULD show `External file monitor is unavailable`

#### Scenario: Transient file access errors remain non-noisy
- **WHEN** detached external sync fails with transient access text such as `permission denied`, `resource busy`, `sharing violation`, or `used by another process`
- **THEN** the system MUST NOT increment the monitor-unavailable toast threshold for that refresh attempt

### Requirement: Toast Classification MUST Be Covered By Automation

The detached external file monitor toast classification MUST be protected by frontend automated tests.

#### Scenario: Windows stale path regression test
- **WHEN** automated tests simulate a successful initial file read followed by repeated `Failed to open file: 系统找不到指定的路径。 (os error 3)` refresh failures
- **THEN** the tests MUST assert that `External file monitor is unavailable` is not shown

#### Scenario: Existing missing-file regression test remains valid
- **WHEN** automated tests simulate existing missing-file errors such as `os error 2`
- **THEN** the tests MUST continue to assert that monitor-unavailable toast is not shown
