#!/usr/bin/env node

/**
 * TurboVec Namespace Creator – ingest.js
 *
 * Streams a JSONL file line-by-line, extracts text/source/metadata, generates
 * deterministic fallback embeddings (or delegates to an LLM endpoint via config),
 * batches items and sends them to the Python bridge for vector-index storage.
 *
 * Usage:
 *   node ingest.js --input data.jsonl --namespace my_ns \
 *     --rootDir ./llm-ide/src/backend/turbovec_memory \
 *     --bridgeScriptPath ./llm-ide/src/backend/turbovec_bridge.py
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TARGET_EMBEDDING_DIM = 256;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BRIDGE_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_BRIDGE_STDERR_BYTES = 1 * 1024 * 1024;

// ---------------------------------------------------------------------------
// CLI argument parsing (no external deps – built-in minimist-style)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Deterministic fallback embedding – identical to turboVecMemory.ts
// ---------------------------------------------------------------------------
function fallbackEmbedding(text, dim = TARGET_EMBEDDING_DIM) {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

// ---------------------------------------------------------------------------
// Normalize embedding to target dimension (same as turboVecMemory.ts)
// ---------------------------------------------------------------------------
function normalizeEmbeddingDimension(embedding, targetDim = TARGET_EMBEDDING_DIM) {
  const vec = new Array(targetDim).fill(0);
  for (let i = 0; i < embedding.length; i += 1) {
    const value = Number(embedding[i]);
    if (!Number.isFinite(value)) continue;
    vec[i % targetDim] += value;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

// ---------------------------------------------------------------------------
// Sanitize namespace (same as turboVecMemory.ts)
// ---------------------------------------------------------------------------
function sanitizeNamespace(namespace) {
  const compact = namespace.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return compact || "default";
}

// ---------------------------------------------------------------------------
// Extract text / source / metadata from a JSONL line
// Handles both flat {text, source} and nested QA-pair formats
// ---------------------------------------------------------------------------
function extractItem(lineObj) {
  // Flat format: { text: "...", source: "...", metadata?: {...} }
  if (typeof lineObj.text === "string" && lineObj.text.trim().length > 0) {
    return {
      text: lineObj.text.trim(),
      source: lineObj.source || "unknown",
      metadata: lineObj.metadata || {},
    };
  }

  // QA-pair format from qa_pairs_sample.jsonl
  if (lineObj.question && lineObj.answer) {
    const qTitle = lineObj.question.title || "";
    const qBody = lineObj.question.body || "";
    const aBody = lineObj.answer.body || "";
    const combinedText = `${qTitle}\n${qBody}\n\nAnswer:\n${aBody}`.trim();

    if (combinedText.length > 0) {
      return {
        text: combinedText,
        source: `qa_${lineObj.question_id || "unknown"}`,
        metadata: {
          question_id: lineObj.question_id,
          answer_id: lineObj.answer_id,
          tags: lineObj.question.tags || "",
          score: lineObj.question.score,
          creation_date: lineObj.question.creation_date,
        },
      };
    }
  }

  // Fallback: try to find any string field that could be text
  for (const key of ["content", "body", "message", "description"]) {
    if (typeof lineObj[key] === "string" && lineObj[key].trim().length > 0) {
      return {
        text: lineObj[key].trim(),
        source: lineObj.source || lineObj.id ? String(lineObj.id) : "unknown",
        metadata: Object.fromEntries(
          Object.entries(lineObj).filter(([k]) => k !== key && k !== "source")
        ),
      };
    }
  }

  return null; // skip unparseable lines
}

// ---------------------------------------------------------------------------
// Call the Python bridge with a batch of items
// ---------------------------------------------------------------------------
function callBridge(pythonExecutable, bridgeScriptPath, indexPath, metaPath, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [
      bridgeScriptPath,
      "--index",
      indexPath,
      "--meta",
      metaPath,
    ]);

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutOverflowed = false;

    child.stdout.on("data", (chunk) => {
      if (stdoutBytes >= MAX_BRIDGE_STDOUT_BYTES) return;
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const available = MAX_BRIDGE_STDOUT_BYTES - stdoutBytes;
      if (bufferChunk.length <= available) {
        stdoutChunks.push(bufferChunk);
        stdoutBytes += bufferChunk.length;
      } else {
        stdoutChunks.push(bufferChunk.subarray(0, available));
        stdoutBytes = MAX_BRIDGE_STDOUT_BYTES;
        stdoutOverflowed = true;
        child.kill();
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= MAX_BRIDGE_STDERR_BYTES) return;
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const available = MAX_BRIDGE_STDERR_BYTES - stderrBytes;
      stderrChunks.push(
        bufferChunk.length <= available
          ? bufferChunk
          : bufferChunk.subarray(0, available)
      );
      stderrBytes += Math.min(bufferChunk.length, available);
    });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (stdoutOverflowed) {
        reject(new Error(`Bridge output exceeded ${MAX_BRIDGE_STDOUT_BYTES} bytes.`));
        return;
      }
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(
          new Error(stderr.trim() || `Bridge failed with code ${String(code)}`)
        );
        return;
      }
      try {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        resolve(JSON.parse(stdout || "{}"));
      } catch (err) {
        reject(new Error(`Invalid bridge output: ${err.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Get the next available ID by reading existing metadata file
// ---------------------------------------------------------------------------
function getNextId(metaPath) {
  return new Promise((resolve) => {
    fs.readFile(metaPath, "utf8", (err, data) => {
      if (err || !data.trim()) {
        resolve(0); // start from 0 if no existing metadata
        return;
      }
      let maxId = 0;
      for (const line of data.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const id = Number(parsed.id ?? 0);
          if (Number.isFinite(id) && id > maxId) maxId = id;
        } catch {
          // skip malformed lines
        }
      }
      resolve(maxId);
    });
  });
}

// ---------------------------------------------------------------------------
// Resolve Python executable (same strategy as turboVecMemory.ts)
// ---------------------------------------------------------------------------
async function resolvePythonExecutable(pythonExecutable, rootDir) {
  if (pythonExecutable) return pythonExecutable;

  const candidates = [
    process.env.TURBOVEC_PYTHON?.trim(),
    ...(process.platform === "win32"
      ? [
          path.join(rootDir, "..", ".turbovec-venv", "Scripts", "python.exe"),
          path.join(rootDir, "..", ".turbovec-venv", "Scripts", "python"),
        ]
      : [
          path.join(rootDir, "..", ".turbovec-venv", "bin", "python3"),
          path.join(rootDir, "..", ".turbovec-venv", "bin", "python"),
        ]),
    process.platform === "win32" ? "py" : undefined,
    "python3",
    "python",
    "/usr/bin/python3",
  ].filter(Boolean);

  // Deduplicate while preserving order
  const unique = [...new Set(candidates)];

  for (const candidate of unique) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(candidate, ["--version"]);
        let stderrData = "";
        child.stderr.on("data", (d) => (stderrData += d));
        child.on("close", (code) => {
          if (code === 0) resolve(true);
          else reject(new Error(stderrData));
        });
        child.on("error", reject);
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    "Could not find a usable Python executable. Set --pythonExecutable or TURBOVEC_PYTHON."
  );
}

// ---------------------------------------------------------------------------
// Optional LLM-based embedding via config JSON
// Config format: { endpoint: "...", apiKey?: "...", model?: "..." }
// Falls back to deterministic hashing if the endpoint is unreachable.
// ---------------------------------------------------------------------------
async function getEmbedding(text, llmConfig) {
  if (!llmConfig || !llmConfig.endpoint) {
    return fallbackEmbedding(text);
  }

  try {
    const http = require("http");
    const https = require("https");
    const url = new URL(llmConfig.endpoint);

    // Derive embeddings endpoint (same logic as turboVecMemory.ts)
    let endpointUrl = url.toString();
    if (endpointUrl.endsWith("/chat/completions")) {
      endpointUrl = endpointUrl.replace(/\/chat\/completions$/, "/embeddings");
    } else if (endpointUrl.endsWith("/v1")) {
      endpointUrl = `${endpointUrl}/embeddings`;
    } else if (!endpointUrl.endsWith("/embeddings")) {
      endpointUrl = `${endpointUrl.replace(/\/$/, "")}/embeddings`;
    }

    const body = JSON.stringify({
      model: llmConfig.model || "text-embedding-ada-002",
      input: text,
    });

    const parsedUrl = new URL(endpointUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const embeddingResponse = await new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(llmConfig.apiKey
              ? { Authorization: `Bearer ${llmConfig.apiKey}` }
              : {}),
          },
          timeout: 12000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Invalid LLM response: ${data.slice(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("LLM embedding request timed out"));
      });
      req.write(body);
      req.end();
    });

    const embedding = embeddingResponse?.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Empty embedding from LLM");
    }

    return normalizeEmbeddingDimension(embedding);
  } catch (err) {
    console.error(
      `[embedding] LLM failed for text (${text.slice(0, 60)}...), using fallback: ${err.message}`
    );
    return fallbackEmbedding(text);
  }
}

// ---------------------------------------------------------------------------
// Main ingestion pipeline
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  // Required arguments
  const inputFile = args.input;
  const namespace = args.namespace;
  const rootDir = args.rootDir || "./llm-ide/src/backend/turbovec_memory";
  const bridgeScriptPath =
    args.bridgeScriptPath || "./llm-ide/src/backend/turbovec_bridge.py";

  // Optional arguments
  const pythonExecutable = args.pythonExecutable;
  const batchSize = Number(args.batchSize) || DEFAULT_BATCH_SIZE;
  const configPath = args.config;

  if (!inputFile) {
    console.error("Error: --input is required (path to JSONL file)");
    process.exit(1);
  }
  if (!namespace) {
    console.error("Error: --namespace is required");
    process.exit(1);
  }

  // Load optional LLM config
  let llmConfig = null;
  if (configPath) {
    try {
      llmConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      console.log(`[config] Loaded LLM config from ${configPath}`);
    } catch (err) {
      console.error(
        `[config] Failed to load config from ${configPath}: ${err.message}. Using fallback embeddings.`
      );
    }
  }

  const sanitizedNs = sanitizeNamespace(namespace);
  const nsDir = path.resolve(rootDir, sanitizedNs);
  const indexPath = path.join(nsDir, "memory.tvec");
  const metaPath = path.join(nsDir, "memory.jsonl");

  console.log(`[ingest] Namespace: ${sanitizedNs}`);
  console.log(`[ingest] Root dir: ${path.resolve(rootDir)}`);
  console.log(`[ingest] Index: ${indexPath}`);
  console.log(`[ingest] Metadata: ${metaPath}`);
  console.log(`[ingest] Input: ${inputFile}`);
  console.log(`[ingest] Batch size: ${batchSize}`);

  // Ensure namespace directory exists
  fs.mkdirSync(nsDir, { recursive: true });

  // Resolve Python executable
  const pyExe = await resolvePythonExecutable(pythonExecutable, rootDir);
  console.log(`[ingest] Python: ${pyExe}`);

  // Get the next available ID from existing metadata
  let currentId = await getNextId(metaPath);
  console.log(`[ingest] Starting ID: ${currentId + 1} (existing count: ${currentId})`);

  // Open input stream
  const fileStream = fs.createReadStream(inputFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream });

  let batchVectors = [];
  let batchIds = [];
  let batchItems = [];
  let totalLines = 0;
  let totalIngested = 0;
  let totalSkipped = 0;
  let batchNumber = 0;

  function flushBatch() {
    if (batchVectors.length === 0) return Promise.resolve();

    batchNumber++;
    const payload = {
      action: "add",
      ids: batchIds,
      vectors: batchVectors,
      items: batchItems.map((item) => ({
        id: batchIds[batchItems.indexOf(item)],
        text: item.text,
        source: item.source,
        createdAt: new Date().toISOString(),
        metadata: item.metadata || {},
      })),
    };

    console.log(
      `[ingest] Sending batch #${batchNumber} (${batchVectors.length} items, IDs ${batchIds[0]}-${batchIds[batchIds.length - 1]})`
    );

    return callBridge(pyExe, bridgeScriptPath, indexPath, metaPath, payload)
      .then((result) => {
        totalIngested += batchVectors.length;
        console.log(
          `[ingest] Batch #${batchNumber} OK – added ${result.added || batchVectors.length} vectors`
        );
      })
      .catch((err) => {
        console.error(
          `[ingest] Batch #${batchNumber} FAILED: ${err.message}`
        );
        throw err;
      })
      .finally(() => {
        batchVectors = [];
        batchIds = [];
        batchItems = [];
      });
  }

  const linePromises = [];

  for await (const line of rl) {
    totalLines++;

    if (!line.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      totalSkipped++;
      if (totalSkipped <= 10) {
        console.warn(
          `[ingest] Skipping malformed line ${totalLines}: ${line.slice(0, 80)}...`
        );
      }
      continue;
    }

    const item = extractItem(parsed);
    if (!item || !item.text.trim()) {
      totalSkipped++;
      continue;
    }

    // Generate embedding
    const vector = await getEmbedding(item.text, llmConfig);

    batchIds.push(currentId + 1);
    currentId += 1;
    batchVectors.push(vector);
    batchItems.push(item);

    if (batchVectors.length >= batchSize) {
      await flushBatch();
    }
  }

  // Flush remaining items
  await flushBatch();

  console.log("\n========================================");
  console.log(`[ingest] COMPLETE`);
  console.log(`  Total lines read:   ${totalLines}`);
  console.log(`  Items ingested:     ${totalIngested}`);
  console.log(`  Lines skipped:      ${totalSkipped}`);
  console.log(`  Namespace dir:      ${nsDir}`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error("[ingest] FATAL:", err.message);
  process.exit(1);
});
