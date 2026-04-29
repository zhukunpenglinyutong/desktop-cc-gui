import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHeavyTestNoise } from "./check-heavy-test-noise.mjs";

test("allows environment-owned warnings without violations", () => {
  const report = analyzeHeavyTestNoise(`
npm warn Unknown user config "electron_mirror". This will stop working in the next major version of npm.
[vitest-batch] completed 346 test files.
`);

  assert.equal(report.environmentWarnings.length, 1);
  assert.equal(report.actWarnings.length, 0);
  assert.equal(report.stdoutPayloads.length, 0);
  assert.equal(report.stderrPayloads.length, 0);
});

test("reports environment-owned warnings from npm env metadata when outer npm log is not captured", () => {
  const report = analyzeHeavyTestNoise("[vitest-batch] completed 346 test files.\n", {
    env: {
      npm_config_electron_mirror: "https://npmmirror.com/mirrors/electron/",
    },
  });

  assert.equal(report.environmentWarnings.length, 1);
  assert.match(report.environmentWarnings[0] ?? "", /Unknown user config "electron_mirror"/);
  assert.equal(report.actWarnings.length, 0);
  assert.equal(report.stdoutPayloads.length, 0);
  assert.equal(report.stderrPayloads.length, 0);
});

test("dedupes identical environment-owned warnings coming from env hints and captured log lines", () => {
  const report = analyzeHeavyTestNoise(
    `
npm warn Unknown user config "electron_mirror". This will stop working in the next major version of npm.
[vitest-batch] completed 346 test files.
`,
    {
      env: {
        npm_config_electron_mirror: "https://npmmirror.com/mirrors/electron/",
      },
    },
  );

  assert.equal(report.environmentWarnings.length, 1);
});

test("detects repo-owned act warnings", () => {
  const report = analyzeHeavyTestNoise(`
stderr | src/features/spec/components/SpecHub.test.tsx > SpecHub > example
An update to xl inside a test was not wrapped in act(...).
When testing, code that causes React state updates should be wrapped into act(...):
`);

  assert.equal(report.actWarnings.length, 1);
  assert.equal(report.actWarnings[0]?.context, "src/features/spec/components/SpecHub.test.tsx > SpecHub > example");
});

test("detects repo-owned stdout and stderr payload leaks", () => {
  const report = analyzeHeavyTestNoise(`
stdout | src/features/threads/hooks/useThreadMessaging.test.tsx > useThreadMessaging > example
[model/resolve/send] { threadId: "t-1" }
stderr | src/features/git/hooks/useGitStatus.test.tsx > useGitStatus > example
Failed to load git status Error: boom
`);

  assert.equal(report.stdoutPayloads.length, 1);
  assert.equal(report.stderrPayloads.length, 1);
  assert.equal(report.stdoutPayloads[0]?.context, "src/features/threads/hooks/useThreadMessaging.test.tsx > useThreadMessaging > example");
  assert.equal(report.stderrPayloads[0]?.context, "src/features/git/hooks/useGitStatus.test.tsx > useGitStatus > example");
});

test("ignores ANSI-colored runner lines and normalizes payload contexts", () => {
  const report = analyzeHeavyTestNoise(`
\u001b[32m RUN \u001b[39m v3.2.4 /repo
\u001b[90mstdout | \u001b[39msrc/features/spec/components/SpecHub.test.tsx > SpecHub > example
\u001b[31m[model/resolve/send]\u001b[39m {"threadId":"t-1"}
\u001b[90mstderr | \u001b[39msrc/features/git/hooks/useGitStatus.test.tsx > useGitStatus > example
\u001b[31mFailed to load git status Error: boom\u001b[39m
\u001b[2m PASS \u001b[22m src/features/spec/components/SpecHub.test.tsx
`);

  assert.equal(report.actWarnings.length, 0);
  assert.equal(report.stdoutPayloads.length, 1);
  assert.equal(report.stderrPayloads.length, 1);
  assert.equal(
    report.stdoutPayloads[0]?.context,
    "src/features/spec/components/SpecHub.test.tsx > SpecHub > example",
  );
  assert.equal(
    report.stdoutPayloads[0]?.line,
    "[model/resolve/send] {\"threadId\":\"t-1\"}",
  );
  assert.equal(
    report.stderrPayloads[0]?.line,
    "Failed to load git status Error: boom",
  );
});
