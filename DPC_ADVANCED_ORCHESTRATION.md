# DPC Advanced Orchestration

Date: 2026-07-08
Scope: local Ollama models only, excluding cloud entries

##  Hugging Face Models: Deep Capability Analysis

This section focuses on the Hugging Face models that are installed locally via Ollama and what they are actually best at in practice.

### hf.co/BugTraceAI/BugTraceAI-CORE-Ultra-27B-Q4:latest

Profile:
- 27B Qwen3.6-based SFT model tuned as a tooling-first offensive-security generator
- Explicitly optimized for executable artifacts (templates, PoCs, exploit tooling)
- Benchmark claims in card are security-artifact tasks, not general software engineering

Strengths:
- Produces concrete, technical, executable output quickly
- Strong for security-focused code review and exploit-path reasoning
- Useful for red-team style threat validation and vulnerability reproduction workflows

Limitations and risks:
- Not positioned as a balanced general-purpose SWE model
- Uncensored and low-refusal behavior means it needs strict system constraints for normal product engineering
- Should not be the default implementer for everyday app features

Best orchestration role:
- Security specialist branch only (auth, crypto, injection, vuln triage, hardening)

### hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:latest

Profile:
- Qwen3.5-derived reasoning model with very long context setup (up to 1M via YaRN in card)
- Native function-calling format support described in card
- Reasoning/thinking-oriented response style

Strengths:
- Long-context planning and repo-scale synthesis
- Useful as an orchestration router/planner when context breadth matters
- Good for design synthesis, requirements decomposition, and long chain analysis

Limitations:
- Reasoning-style output can be verbose
- Needs careful generation settings and output controls for concise automation
- Not the strongest pure coding finisher compared to coding-specialized models

Best orchestration role:
- Entry router and long-context planner

### hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL

Profile:
- Qwen3-Coder 30B A3B MoE coding model (about 3.3B active experts per token)
- Model card emphasizes agentic coding, browser-use, long context, and tool calling
- Explicitly coding-specialized and non-thinking output mode

Strengths:
- Top-tier multilingual implementation quality for production coding
- Strong tool-calling behavior for agentic coding loops
- Excellent default primary implementer for large and complex code tasks

Limitations:
- Heavier than small fast patch models
- Needs branch guardrails to avoid overuse where tiny fixes are enough

Best orchestration role:
- Primary polyglot implementation stage

### hf.co/JetBrains/Mellum2-12B-A2.5B-Thinking-GGUF-Q4_K_M:latest

Profile:
- JetBrains Mellum2 MoE coding/reasoning model quantized Q4_K_M
- 12B total, 2.5B active per token style profile
- Card highlights coding focus, 131K context support, and strong speed/quality tradeoff

Strengths:
- Very fast coding iterations for patching and targeted refactors
- Useful for quick repair loops and small-to-medium edits
- Efficient branch for retry passes after failure

Limitations:
- Smaller than the main polyglot model, so less ideal for broad architectural rewrites

Best orchestration role:
- Fast patch and retry implementer

### hf.co/yuxinlu1/Mellum2-12B-A2.5B-Claude-4.6-4.8-Opus-Thinking-GGUF:latest

Profile:
- Distilled Mellum2 variant with reasoning-style traces and coding-first framing
- Same family behavior with quick MoE runtime characteristics

Strengths:
- Strong structured reasoning plus code generation for focused fixes
- Good as a secondary implementation/check stage when primary branch fails or stalls

Limitations:
- Distillation style can bias output voice and structure
- Not a replacement for highest-quality main implementation branch

Best orchestration role:
- Secondary recovery implementer after failure paths

### hf.co/mradermacher/MN-Violet-Lotus-12B-GGUF:latest

Profile:
- Quantized distribution of a base model tagged heavily for creative writing and RP use
- Card focus is quant packaging and usage notes, not software-engineering benchmarks

Strengths:
- Creative ideation, prose generation, narrative-style brainstorming

Limitations:
- Not positioned as coding-specialized or tool-agent focused
- Limited evidence for top-tier production SWE reliability

Best orchestration role:
- Optional non-critical documentation brainstorming only
- Excluded from core coding workflow

## 2) Updated Model Strategy for Software Development

Based on the Hugging Face model-card capabilities, the strongest coding-oriented stack is:

1. Router and long-context planner: hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:latest
2. Primary implementation: hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL
3. Fast fix loop: hf.co/JetBrains/Mellum2-12B-A2.5B-Thinking-GGUF-Q4_K_M:latest
4. Secondary recovery implementer: hf.co/yuxinlu1/Mellum2-12B-A2.5B-Claude-4.6-4.8-Opus-Thinking-GGUF:latest
5. Security specialist only when needed: hf.co/BugTraceAI/BugTraceAI-CORE-Ultra-27B-Q4:latest

## 3) Revised Advanced Orchestration Template

This template is updated to reflect the Hugging Face model research above.

```json
{
  "version": 1,
  "name": "DPC HF-Tuned Advanced SWE Branching",
  "description": "Research-aligned software engineering orchestration using local HF models with explicit security and recovery branches.",
  "loopUntilComplete": true,
  "maxLoops": 4,
  "completionMarker": "TASK_COMPLETE",
  "steps": [],
  "advanced": {
    "enabled": true,
    "entryStageId": "router_context_planner",
    "maxStageExecutions": 140,
    "stages": [
      {
        "id": "router_context_planner",
        "name": "Router and Long-Context Planner",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:latest",
        "contextWindowTokens": 65536,
        "apiKey": "",
        "systemPrompt": "Classify request and emit exactly one route token: ROUTE_SECURITY, ROUTE_JAVA, ROUTE_POLYGLOT, ROUTE_QUICKFIX. Produce concise execution plan and constraints.",
        "temperature": 0.1,
        "maxTokens": 1400,
        "maxToolTurns": 28,
        "maxRetries": 1,
        "tools": [
          { "name": "list_repo_tree", "enabled": true },
          { "name": "list_dir", "enabled": true },
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_status", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 80,
        "positionY": 100,
        "collapsed": false
      },
      {
        "id": "impl_polyglot_primary",
        "name": "Primary Polyglot Implementer",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL",
        "contextWindowTokens": 65536,
        "apiKey": "",
        "systemPrompt": "Implement production-grade multilingual code with minimal diff footprint, strong correctness, and efficient design. Prefer deterministic changes and testable outcomes.",
        "temperature": 0.1,
        "maxTokens": 2600,
        "maxToolTurns": 48,
        "maxRetries": 2,
        "tools": [
          { "name": "list_repo_tree", "enabled": true },
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "create_file", "enabled": true },
          { "name": "write_file", "enabled": true },
          { "name": "replace_in_file", "enabled": true },
          { "name": "insert_in_file", "enabled": true },
          { "name": "create_directory", "enabled": true },
          { "name": "move_path", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 540,
        "positionY": 80,
        "collapsed": false
      },
      {
        "id": "impl_java_specialist",
        "name": "Java Specialist Implementer",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "qwen25-java-sme-v4-q5:latest",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Implement robust Java code with concurrency safety, clean API behavior, and regression-aware edits.",
        "temperature": 0.1,
        "maxTokens": 2300,
        "maxToolTurns": 42,
        "maxRetries": 2,
        "tools": [
          { "name": "list_repo_tree", "enabled": true },
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "create_file", "enabled": true },
          { "name": "write_file", "enabled": true },
          { "name": "replace_in_file", "enabled": true },
          { "name": "insert_in_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 540,
        "positionY": 360,
        "collapsed": false
      },
      {
        "id": "impl_fast_patch",
        "name": "Fast Patch Implementer",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "hf.co/JetBrains/Mellum2-12B-A2.5B-Thinking-GGUF-Q4_K_M:latest",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Apply smallest viable patch quickly. Focus on precision edits, stable behavior, and rapid validation.",
        "temperature": 0.1,
        "maxTokens": 1600,
        "maxToolTurns": 26,
        "maxRetries": 1,
        "tools": [
          { "name": "read_file", "enabled": true },
          { "name": "replace_in_file", "enabled": true },
          { "name": "insert_in_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 1020,
        "positionY": 520,
        "collapsed": false
      },
      {
        "id": "impl_recovery_reasoning",
        "name": "Recovery Implementer",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "hf.co/yuxinlu1/Mellum2-12B-A2.5B-Claude-4.6-4.8-Opus-Thinking-GGUF:latest",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Recover from failed implementation attempts with structured debugging and concise repair plans, then produce corrected code edits.",
        "temperature": 0.1,
        "maxTokens": 1800,
        "maxToolTurns": 30,
        "maxRetries": 2,
        "tools": [
          { "name": "list_repo_tree", "enabled": true },
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "replace_in_file", "enabled": true },
          { "name": "insert_in_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 1020,
        "positionY": 300,
        "collapsed": false
      },
      {
        "id": "security_specialist",
        "name": "Security Specialist Branch",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "hf.co/BugTraceAI/BugTraceAI-CORE-Ultra-27B-Q4:latest",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Perform security-focused review and remediation guidance for auth, crypto, injection, deserialization, SSRF, path traversal, and privilege escalation surfaces. Keep output software-engineering oriented.",
        "temperature": 0.05,
        "maxTokens": 1700,
        "maxToolTurns": 28,
        "maxRetries": 1,
        "tools": [
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 1020,
        "positionY": 80,
        "collapsed": false
      },
      {
        "id": "qa_final",
        "name": "Final QA Reviewer",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "nemotron-3-super:latest",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Run final correctness and regression review. Provide clear PASS or FAIL plus concrete remediation checklist.",
        "temperature": 0.05,
        "maxTokens": 1700,
        "maxToolTurns": 26,
        "maxRetries": 1,
        "tools": [
          { "name": "list_repo_tree", "enabled": true },
          { "name": "file_search", "enabled": true },
          { "name": "read_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": false,
        "positionX": 1470,
        "positionY": 200,
        "collapsed": false
      },
      {
        "id": "deliverable_finisher",
        "name": "Deliverable Finisher",
        "provider": "ollama",
        "endpoint": "http://localhost:11434/v1/chat/completions",
        "model": "qwen3.6:35b-a3b",
        "contextWindowTokens": 32768,
        "apiKey": "",
        "systemPrompt": "Produce final implementation summary, verification evidence, and completion statement. When done, call complete_orchestration_task with concise summary.",
        "temperature": 0.05,
        "maxTokens": 1400,
        "maxToolTurns": 18,
        "maxRetries": 1,
        "tools": [
          { "name": "read_file", "enabled": true },
          { "name": "grep_search", "enabled": true },
          { "name": "git_diff", "enabled": true },
          { "name": "run_terminal_command", "enabled": true }
        ],
        "passOutputToNext": true,
        "allowCompletionTool": true,
        "positionX": 1860,
        "positionY": 220,
        "collapsed": false
      }
    ],
    "links": [
      {
        "id": "l-route-java",
        "fromStageId": "router_context_planner",
        "toStageId": "impl_java_specialist",
        "condition": "success",
        "matchPattern": "ROUTE_JAVA|\\bjava\\b"
      },
      {
        "id": "l-route-polyglot",
        "fromStageId": "router_context_planner",
        "toStageId": "impl_polyglot_primary",
        "condition": "success",
        "matchPattern": "ROUTE_POLYGLOT|typescript|javascript|python|go|rust|c\\+\\+|c#|kotlin|swift"
      },
      {
        "id": "l-route-quickfix",
        "fromStageId": "router_context_planner",
        "toStageId": "impl_fast_patch",
        "condition": "success",
        "matchPattern": "ROUTE_QUICKFIX|small fix|minor|single file|tiny patch"
      },
      {
        "id": "l-route-security",
        "fromStageId": "router_context_planner",
        "toStageId": "security_specialist",
        "condition": "success",
        "matchPattern": "ROUTE_SECURITY|auth|oauth|jwt|crypto|xss|csrf|sql injection|ssrf|rce|cve|security"
      },
      {
        "id": "l-java-to-qa",
        "fromStageId": "impl_java_specialist",
        "toStageId": "qa_final",
        "condition": "success",
        "matchPattern": ""
      },
      {
        "id": "l-polyglot-to-qa",
        "fromStageId": "impl_polyglot_primary",
        "toStageId": "qa_final",
        "condition": "success",
        "matchPattern": ""
      },
      {
        "id": "l-fastpatch-to-qa",
        "fromStageId": "impl_fast_patch",
        "toStageId": "qa_final",
        "condition": "success",
        "matchPattern": ""
      },
      {
        "id": "l-security-to-qa",
        "fromStageId": "security_specialist",
        "toStageId": "qa_final",
        "condition": "success",
        "matchPattern": ""
      },
      {
        "id": "l-java-error-recovery",
        "fromStageId": "impl_java_specialist",
        "toStageId": "impl_recovery_reasoning",
        "condition": "error",
        "matchPattern": ""
      },
      {
        "id": "l-polyglot-error-recovery",
        "fromStageId": "impl_polyglot_primary",
        "toStageId": "impl_recovery_reasoning",
        "condition": "error",
        "matchPattern": ""
      },
      {
        "id": "l-fastpatch-error-recovery",
        "fromStageId": "impl_fast_patch",
        "toStageId": "impl_recovery_reasoning",
        "condition": "error",
        "matchPattern": ""
      },
      {
        "id": "l-recovery-to-qa",
        "fromStageId": "impl_recovery_reasoning",
        "toStageId": "qa_final",
        "condition": "success",
        "matchPattern": ""
      },
      {
        "id": "l-qa-pass-finish",
        "fromStageId": "qa_final",
        "toStageId": "deliverable_finisher",
        "condition": "success",
        "matchPattern": "PASS|approved|ready"
      },
      {
        "id": "l-qa-fail-recovery",
        "fromStageId": "qa_final",
        "toStageId": "impl_recovery_reasoning",
        "condition": "success",
        "matchPattern": "FAIL|regression|not ready|issue found"
      }
    ]
  }
}
```

## 4) Operational Guidance

1. Keep the security branch narrow. BugTraceAI is excellent at security artifact generation but should not be your default feature implementer.
2. Use Qwen3-Coder as your main code writer and keep Mellum2 branches for speed and targeted recovery.
3. Keep router temperature low and route regexes explicit to avoid branch drift.
4. Exclude MN-Violet-Lotus from core coding paths; keep it only for optional narrative/doc ideation.
