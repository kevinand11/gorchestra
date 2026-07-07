# Agent Run Sandbox Config and Runtimes

Agent Run Profiles store explicit Agent Run Sandbox Config. The config names the sandbox source, vCPU resources, and network policy that future Agent Runs snapshot. V1 source variants are `consumer-managed`, `vercel-runtime`, and `vercel-vcr-image`.

Core resolves saved config into a Sandbox Runtime at the boundary where sandbox work runs. `consumer-managed` resolves to the Consumer-provided runtime. Vercel runtime and VCR image sources resolve to Core-owned Vercel Sandbox Runtime behavior. Vercel source configs store nested credential Secret references for token, team id, and project id; the config-to-runtime resolver loads active Secrets, resolves plaintext through the Secret Core Service, validates non-empty credential values, and passes resolved credentials into the Vercel constructor. Vercel runtime code does not load Secrets itself.

Saved sandbox resources store only `vcpus`. Memory is inferred as `vcpus * 2048` at sandbox runtime boundaries because both supported runtime families use the same memory-per-vCPU rule and storing memory separately would allow contradictory resource settings.

Agent Runs persist an Agent Run Sandbox Key, initialized to the Agent Run id in v1. Core uses that key to create, find, run commands in, and release the concrete sandbox. Portfolio Snapshots may carry the key as part of in-progress Agent Run facts, but the key is not a portable guarantee that a restored deployment still has a live sandbox.

Top-level Core `preflight()` remains a required Core Service readiness check and no longer performs sandbox readiness. Concrete sandbox readiness depends on an Agent Run Profile's saved config, source-specific credentials, resource policy, and runtime availability, so Core exposes Agent Run Profile Preflight instead. Profile preflight creates a temporary sandbox, runs the shell-free structured smoke command `true` at `/workspace`, releases the sandbox, and returns transient Validation Evidence without writing Portfolio facts.

Vercel Sandbox defaults to `/vercel/sandbox`; Gorchestra's sandbox path contract is `/workspace`. The Vercel Sandbox Runtime creates `/workspace` as a symlink to `/vercel/sandbox` on create or resume so Core-authored requirements and future tools can rely on one portable sandbox path.

The Server Consumer v1 implementation of `consumer-managed` uses local microsandbox-backed OCI execution. This is a Consumer deployment choice: Core only sees the `consumer-managed` Sandbox Runtime and the saved OCI image string.

This supersedes the sandbox assignment portions of [Agent Run Runtime Requirements and Sandbox Preparation](./2026-07-04-1950-agent-run-runtime-requirements-and-sandbox-preparation.md) while preserving its ordered runtime requirement and preparation semantics.
