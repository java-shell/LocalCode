# Token Optimization Guide

Use this companion guide with §26 in rules.md to reduce context waste without losing quality.

## Goals

- Reduce redundant file reads and repeated explanations
- Batch related work into fewer tool calls
- Scale documentation and responses to task complexity
- Preserve correctness while targeting 40-80% token reduction

## Quick Checklist

Before starting a task, ask:

- Can I search before I read entire files?
- Can I read multiple files in parallel?
- Can I batch related edits into one patch?
- Does this task need a full explanation or a concise result?
- Have I already read this file in the current session?

## High-Value Practices

### 1. Search before deep reads

- Use targeted search to locate the relevant section first.
- Read only the ranges you need after you know where the logic lives.
- Prefer one broad read over many tiny reads when context is clearly local.

### 2. Parallelize independent context gathering

- Read unrelated files together.
- Search docs, config, and scripts in the same batch when they answer one question.
- Avoid serial exploration when the files do not depend on one another.

### 3. Batch edits deliberately

- Group related edits into one patch per file where practical.
- Avoid repeated formatting-only passes if you can fix structure in the same edit.
- Update derivative docs in the same change set as the source-of-truth doc.

### 4. Scale explanation depth

- Simple task: short outcome, minimal commentary.
- Moderate task: summary plus key reasons.
- Complex task: solution first, then implementation details, then validation.

### 5. Avoid re-reading unchanged files

- Trust successful patch results instead of reopening the same file immediately.
- Re-read only when another process may have changed the file or when validation fails.
- Keep a small working set of authoritative files for the current task.

## Documentation Scaling

Use proportional documentation from §3 and §26:

- Simple helpers: purpose and edge cases
- Internal functions: purpose, inputs, outputs, assumptions
- Public or critical APIs: full template with errors, side effects, security, performance, and rationale

## Retrieval Mode Selection

Use this checklist when deciding between keyword search, vector search, or a hybrid approach.

### Use keyword search when

- You know the likely symbol, filename, error string, or exact domain term.
- The repository is small enough that targeted grep or file search already returns precise results.
- Deterministic matches matter more than semantic recall.
- You need the fastest and cheapest first pass.

### Use vector search when

- The codebase or document set is large, concept-heavy, or inconsistent in terminology.
- Relevant content is often described indirectly rather than with exact shared strings.
- You are retrieving design notes, architectural guidance, or cross-cutting concepts instead of one concrete symbol.
- Better recall is worth modest extra latency or cost.

### Use hybrid retrieval when

- You need both semantic recall and deterministic precision.
- The first pass should find candidate areas semantically, then narrow them with keyword or symbol search.
- You need a resilient fallback path when the vector service is unavailable or returns weak matches.
- The repository mixes structured code queries with fuzzy documentation or knowledge-base queries.

### Decision Rule

Start with keyword search by default. Add vector search when exact matching repeatedly misses useful context. Prefer hybrid retrieval for mature repositories where semantic recall helps discovery but final selection still benefits from precise string or symbol filtering.

### Minimal Evaluation Checklist

- Define 5 to 10 representative queries before enabling vector retrieval broadly.
- Measure whether vector or hybrid retrieval finds materially better candidates than keyword search alone.
- Record latency, cost, and fallback behavior.
- If using Luna or another provider, document why that provider was chosen and what privacy constraints apply to indexed content.

## Anti-Patterns

Avoid these unless there is a clear reason:

- Reading the same file repeatedly to recover context already known
- Asking multiple rounds of clarification for one ambiguous requirement
- Making one edit per tiny issue when they belong to the same change
- Writing long summaries for trivial tasks
- Dumping entire files into context when a targeted range is enough

## Practical Targets

Use these as rough benchmarks, not rigid quotas:

- Simple tasks: 1-3 concise paragraphs in the final response
- Multi-file reads: gather in parallel whenever possible
- Edit passes: one focused patch per file when practical
- Re-reads: only after failed validation or external changes

## Related Files

- rules.md
- RULES-QUICKREF.md
- Reference.md
- .github/copilot-instructions.md
