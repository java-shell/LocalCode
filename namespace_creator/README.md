# TurboVec Namespace Creator

A streaming ingestion tool that creates [TurboVec](../llm-ide/src/backend/turboVecMemory.ts) compatible namespaces from large JSONL files without loading the entire file into memory.

## Overview

This tool reads a JSONL file line-by-line, extracts text content and metadata, generates vector embeddings (deterministic fallback or LLM-based), batches them, and sends them to the Python bridge (`turbovec_bridge.py`) for storage in a TurboVec namespace directory.

### Namespace Structure

Each created namespace is a directory under `<rootDir>/<namespace>/` containing:

| File | Purpose |
|------|---------|
| `memory.tvec` | Binary vector index (TurboQuantIndex / FAISS) |
| `memory.jsonl` | One-line JSON per item with id, text, source, metadata, timestamps |

## Installation

No additional dependencies are required beyond what the main project already uses. The script uses only Node.js built-in modules (`child_process`, `fs`, `path`, `readline`).

## Usage

```bash
node namespace_creator/ingest.js \
  --input <path-to-jsonl> \
  --namespace <namespace-name> \
  --rootDir <turbovec-memory-root> \
  --bridgeScriptPath <path-to-turbovec_bridge.py>
```

### Command-Line Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--input` | ✅ | – | Path to the input JSONL file |
| `--namespace` | ✅ | – | Namespace name (will be sanitized: lowercase, alphanumeric + `_.-`) |
| `--rootDir` | ❌ | `./llm-ide/src/backend/turbovec_memory` | Root directory for TurboVec namespaces |
| `--bridgeScriptPath` | ❌ | `./llm-ide/src/backend/turbovec_bridge.py` | Path to the Python bridge script |
| `--pythonExecutable` | ❌ | Auto-detected | Python executable (e.g., `python3`, `/usr/bin/python3`) |
| `--batchSize` | ❌ | `200` | Number of items per batch sent to the bridge |
| `--config` | ❌ | – | Path to a JSON config file for LLM-based embeddings |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TURBOVEC_PYTHON` | Explicit Python executable path (highest priority) |

## Input Format

The tool supports multiple JSONL formats:

### 1. Flat format (TurboVec native)

```jsonl
{"text": "Hello world", "source": "example.txt", "metadata": {"key": "value"}}
{"text": "Another document", "source": "example2.txt"}
```

### 2. QA-pair format (e.g., `qa_pairs_sample.jsonl`)

```jsonl
{"question_id": 4, "answer_id": 7, "question": {"title": "...", "body": "...", "tags": "|c#|"}, "answer": {"body": "..."}}
```

The tool automatically detects and combines question + answer into a single text entry.

### 3. Generic fallback

If neither format matches, the tool tries common field names (`content`, `body`, `message`, `description`) to extract text.

## Embedding Strategies

### Deterministic Fallback (default)

Uses the same hashing algorithm as `turboVecMemory.ts`:

```js
function fallbackEmbedding(text, dim = 256) {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }
  // L2 normalize...
}
```

This produces reproducible, deterministic vectors without any external service.

### LLM-based Embeddings (optional)

Pass a `--config` file to use an OpenAI-compatible embeddings endpoint:

```json
{
  "endpoint": "http://localhost:8080/v1",
  "apiKey": "your-api-key",
  "model": "text-embedding-ada-002"
}
```

If the LLM endpoint is unreachable, the tool falls back to deterministic embeddings and logs a warning.

## Examples

### Basic ingestion with fallback embeddings

```bash
node namespace_creator/ingest.js \
  --input qa_pairs_sample.jsonl \
  --namespace stackoverflow_qa \
  --rootDir ./llm-ide/src/backend/turbovec_memory \
  --bridgeScriptPath ./llm-ide/src/backend/turbovec_bridge.py
```

### Using LLM embeddings

```bash
node namespace_creator/ingest.js \
  --input my_data.jsonl \
  --namespace my_docs \
  --config ./embedding_config.json \
  --batchSize 50
```

### Specifying Python executable explicitly

```bash
node namespace_creator/ingest.js \
  --input data.jsonl \
  --namespace test_ns \
  --pythonExecutable /usr/bin/python3 \
  --rootDir ./custom/turbovec_root
```

## Output

After successful ingestion, the namespace directory will contain:

```
<rootDir>/<namespace>/
├── memory.tvec      # Binary vector index
└── memory.jsonl     # Metadata (one JSON object per line)
```

The console shows progress:

```
[ingest] Namespace: stackoverflow_qa
[ingest] Root dir: /path/to/turbovec_memory
[ingest] Starting ID: 1 (existing count: 0)
[ingest] Sending batch #1 (200 items, IDs 1-200)
[ingest] Batch #1 OK – added 200 vectors
...
========================================
[ingest] COMPLETE
  Total lines read:   8019
  Items ingested:     7850
  Lines skipped:      169
  Namespace dir:      /path/to/turbovec_memory/stackoverflow_qa
========================================
```

## Error Handling

- **Malformed JSONL lines**: Skipped with a warning (first 10 logged)
- **Bridge failures**: Logged and cause the script to exit with code 1
- **LLM endpoint failures**: Falls back to deterministic embeddings per-item
- **Dimension mismatch**: The bridge handles this; if it fails, check that your LLM config produces compatible dimensions

## Notes

- The tool appends to existing namespaces. If you want a fresh namespace, delete the directory first or use a new name.
- IDs are assigned sequentially starting from the next available ID in the existing metadata file.
- The `createdAt` timestamp is set at ingestion time for each item.
