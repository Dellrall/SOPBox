---
name: Python package installs on Replit
description: Installation constraints and the writable package target used by this workspace.
---

For this workspace, the generic Python package helper tried to create a uv project and install the root workspace into an immutable Nix Python path; ordinary `pip --user` also failed under PEP 668.

**Why:** The configured Python runtime is managed by Nix and is not writable.

**How to apply:** Install runtime requirements with `pip --target` into `.pythonlibs/lib/python3.12/site-packages`, then include that directory in `PYTHONPATH` for the app and migration commands.
