# XJ LLM Service Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move prompt templates and LLM API calls out of `app/xj_apis.py` into a dedicated service module while preserving external API behavior.

**Architecture:** Add a new service module `services/xj_llm_service.py` that owns OpenAI client initialization and three generation functions. Keep request parsing and endpoint orchestration in `app/xj_apis.py`; replace in-file LLM functions with service delegation wrappers to minimize risk.

**Tech Stack:** Python, Flask, pytest, OpenAI compatible client, dotenv

---

### Task 1: Add a failing test for service-backed delegation

**Files:**
- Create: `tests/test_xj_apis_llm_delegation.py`
- Modify: `app/xj_apis.py`
- Create: `services/xj_llm_service.py`

**Step 1: Write the failing test**

Add tests that monkeypatch `services.xj_llm_service` functions and assert:
- `find_focus_points_for_third_level_titles` delegates correctly.
- `assign_paragraph_text_count` delegates correctly.
- `generate_h3_analysis_model_framework` delegates correctly.

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_xj_apis_llm_delegation.py -q`
Expected: FAIL because delegation hooks/module do not exist yet.

### Task 2: Implement service extraction with minimal behavior changes

**Files:**
- Create: `services/xj_llm_service.py`
- Modify: `app/xj_apis.py`

**Step 1: Move LLM clients and generation logic**

Create service functions:
- `generate_focus_points_with_llm(...)`
- `generate_paragraph_text_count(...)`
- `generate_h3_analysis_model_framework_with_llm(...)`

Include client init and JSON parsing/error handling equivalent to current behavior.

**Step 2: Replace direct calls in API module**

In `app/xj_apis.py`, remove direct OpenAI client init and prompt-heavy functions; keep thin wrappers that call the service.

**Step 3: Run tests to verify passing**

Run: `pytest tests/test_xj_apis_llm_delegation.py -q`
Expected: PASS.

### Task 3: Verify no syntax regressions

**Files:**
- Modify: `app/xj_apis.py`
- Create: `services/xj_llm_service.py`

**Step 1: Run targeted compile check**

Run: `python -m py_compile app/xj_apis.py services/xj_llm_service.py tests/test_xj_apis_llm_delegation.py`
Expected: no output, exit code 0.
