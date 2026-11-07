---
name: Direct Gemini model availability
description: Account-specific model access and latency for direct Google GenAI API calls.
---

**Rule:** Verify a chosen model through the app's configured direct API key; model names and performance can differ from the integration catalog.

**Why:** A configured direct key rejected an older Flash model as unavailable to new users, while the suggested current Flash model responded slowly.

**How to apply:** When changing this app's fixed model default, smoke-test a brief city-guide question against the configured key and keep timeouts bounded.
