# Configure Codex Auto Compaction Threshold

## Summary

Allow users to configure the Codex auto-compaction high-watermark from Settings.

## Problem

Codex auto compaction currently uses a fixed threshold. Users who work with long-running Codex threads need a simple way to delay automatic compaction without editing runtime code or launch flags.

## Goals

- Add app settings for Codex auto-compaction enabled state and threshold.
- Expose the enabled toggle and bounded threshold choices in the Codex background-info tooltip, starting at the existing `92%` behavior, then `100%` through `200%` in `10%` increments.
- Apply the configured threshold to Codex runtime sessions.
- Keep existing cooldown, in-flight, and processing guards unchanged.

## Non-Goals

- Do not add a separate compaction settings page.
- Do not change manual compaction behavior.
- Do not add per-workspace thresholds.
