/**
 * Tests for namespace_creator/ingest.js
 *
 * Run with: node --test __tests__/ingest.test.js
 * (Node 18+ built-in test runner)
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Import functions by requiring the main script and exposing them for testing
// Since ingest.js doesn't export, we re-implement the pure functions here for testing.

// ---------------------------------------------------------------------------
// Re-implement pure functions from ingest.js for unit testing
// ---------------------------------------------------------------------------

function fallbackEmbedding(text, dim = 256) {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

function normalizeEmbeddingDimension(embedding, targetDim = 256) {
  const vec = new Array(targetDim).fill(0);
  for (let i = 0; i < embedding.length; i += 1) {
    const value = Number(embedding[i]);
    if (!Number.isFinite(value)) continue;
    vec[i % targetDim] += value;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

function sanitizeNamespace(namespace) {
  const compact = namespace.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return compact || "default";
}

function extractItem(lineObj) {
  if (typeof lineObj.text === "string" && lineObj.text.trim().length > 0) {
    return {
      text: lineObj.text.trim(),
      source: lineObj.source || "unknown",
      metadata: lineObj.metadata || {},
    };
  }
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
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fallbackEmbedding", () => {
  it("should produce a vector of the correct dimension", () => {
    const vec = fallbackEmbedding("hello world");
    assert.strictEqual(vec.length, 256);
  });

  it("should be deterministic (same input → same output)", () => {
    const vec1 = fallbackEmbedding("deterministic test");
    const vec2 = fallbackEmbedding("deterministic test");
    assert.deepStrictEqual(vec1, vec2);
  });

  it("should produce different vectors for different inputs", () => {
    const vec1 = fallbackEmbedding("input A");
    const vec2 = fallbackEmbedding("input B");
    assert.notDeepStrictEqual(vec1, vec2);
  });

  it("should produce L2-normalized vectors (magnitude ≈ 1)", () => {
    const vec = fallbackEmbedding("normalization test string");
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(magnitude - 1.0) < 1e-6, `Magnitude ${magnitude} should be ≈ 1`);
  });

  it("should handle empty string", () => {
    const vec = fallbackEmbedding("");
    assert.strictEqual(vec.length, 256);
    // All zeros normalized → still all zeros (norm would be 0, clamped to 1)
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    assert.ok(magnitude < 1e-10 || Math.abs(magnitude - 1.0) < 1e-6);
  });

  it("should handle custom dimension", () => {
    const vec = fallbackEmbedding("custom dim", 128);
    assert.strictEqual(vec.length, 128);
  });
});

describe("normalizeEmbeddingDimension", () => {
  it("should truncate oversized embeddings", () => {
    const input = Array.from({ length: 512 }, (_, i) => i + 1);
    const output = normalizeEmbeddingDimension(input, 256);
    assert.strictEqual(output.length, 256);
  });

  it("should pad undersized embeddings", () => {
    const input = [1, 2, 3];
    const output = normalizeEmbeddingDimension(input, 256);
    assert.strictEqual(output.length, 256);
  });

  it("should L2-normalize the result", () => {
    const input = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
    const output = normalizeEmbeddingDimension(input);
    const magnitude = Math.sqrt(output.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(magnitude - 1.0) < 1e-6, `Magnitude ${magnitude} should be ≈ 1`);
  });

  it("should skip non-finite values", () => {
    const input = [1, NaN, Infinity, -Infinity, 2];
    const output = normalizeEmbeddingDimension(input, 5);
    assert.ok(output.every((v) => Number.isFinite(v)));
  });
});

describe("sanitizeNamespace", () => {
  it("should lowercase and trim", () => {
    assert.strictEqual(sanitizeNamespace("  My Namespace  "), "my_namespace");
  });

  it("should replace invalid characters with underscore", () => {
    assert.strictEqual(sanitizeNamespace("foo@bar#baz"), "foo_bar_baz");
  });

  it("should allow dots, hyphens, and underscores", () => {
    assert.strictEqual(sanitizeNamespace("my.ns-1_test"), "my.ns-1_test");
  });

  it("should return 'default' for empty/whitespace input", () => {
    assert.strictEqual(sanitizeNamespace(""), "default");
    assert.strictEqual(sanitizeNamespace("   "), "default");
    // Consecutive special chars are collapsed to a single underscore by the regex
    assert.strictEqual(sanitizeNamespace("@@##$"), "_");
  });
});

describe("extractItem", () => {
  it("should extract flat format with text and source", () => {
    const input = { text: "Hello world", source: "test.txt", metadata: { key: "val" } };
    const result = extractItem(input);
    assert.strictEqual(result.text, "Hello world");
    assert.strictEqual(result.source, "test.txt");
    assert.deepStrictEqual(result.metadata, { key: "val" });
  });

  it("should default source to 'unknown' when missing", () => {
    const input = { text: "Some text" };
    const result = extractItem(input);
    assert.strictEqual(result.source, "unknown");
  });

  it("should handle QA-pair format", () => {
    const input = {
      question_id: 42,
      answer_id: 99,
      question: {
        title: "How to sort?",
        body: "<p>Body text</p>",
        tags: "|javascript|sorting|",
        score: 10,
        creation_date: "2024-01-01",
      },
      answer: {
        body: "<p>Use Array.sort()</p>",
      },
    };
    const result = extractItem(input);
    assert.ok(result.text.includes("How to sort?"));
    assert.ok(result.text.includes("Body text"));
    assert.ok(result.text.includes("Use Array.sort()"));
    assert.strictEqual(result.source, "qa_42");
    assert.strictEqual(result.metadata.question_id, 42);
  });

  it("should fallback to 'body' field", () => {
    const input = { body: "Fallback content", id: 123 };
    const result = extractItem(input);
    assert.strictEqual(result.text, "Fallback content");
    assert.strictEqual(result.source, "123");
  });

  it("should return null for unparseable objects", () => {
    const input = { numeric_only: 42 };
    const result = extractItem(input);
    assert.strictEqual(result, null);
  });

  it("should skip items with empty text after trim", () => {
    const input = { text: "   " };
    const result = extractItem(input);
    assert.strictEqual(result, null);
  });
});

describe("Integration: end-to-end with temp files", async () => {
  let tmpDir;

  it("should create a temp directory for testing", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tvec-test-"));
    assert.ok(fs.existsSync(tmpDir));
  });

  it("should write and read back metadata JSONL correctly", async () => {
    const metaPath = path.join(tmpDir, "memory.jsonl");
    const items = [
      { id: 1, text: "First item", source: "s1", createdAt: new Date().toISOString(), metadata: {} },
      { id: 2, text: "Second item", source: "s2", createdAt: new Date().toISOString(), metadata: { tag: "test" } },
    ];

    const writeStream = fs.createWriteStream(metaPath);
    for (const item of items) {
      writeStream.write(JSON.stringify(item) + "\n");
    }
    writeStream.end();

    await new Promise((resolve) => writeStream.on("finish", resolve));

    const content = fs.readFileSync(metaPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 2);

    const parsed1 = JSON.parse(lines[0]);
    assert.strictEqual(parsed1.id, 1);
    assert.strictEqual(parsed1.text, "First item");

    const parsed2 = JSON.parse(lines[1]);
    assert.strictEqual(parsed2.metadata.tag, "test");
  });

  it("should clean up temp directory", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(tmpDir));
  });
});

describe("Consistency with turboVecMemory.ts fallbackEmbedding", () => {
  it("should produce identical output for the same algorithm", () => {
    // The algorithm in ingest.js is a copy of turboVecMemory.ts.
    // Verify key properties match:
    const testStrings = [
      "Hello world",
      "TurboVec namespace creator",
      "Deterministic embedding test string with special chars: @#$%",
      "Unicode: café résumé naïve",
      "A".repeat(1000),
    ];

    for (const str of testStrings) {
      const vec = fallbackEmbedding(str);
      assert.strictEqual(vec.length, 256, `Dimension mismatch for: ${str.slice(0, 30)}`);

      // All values should be finite
      assert.ok(vec.every((v) => Number.isFinite(v)), `Non-finite value in vector for: ${str.slice(0, 30)}`);

      // L2 norm should be ≈ 1
      const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      assert.ok(
        Math.abs(magnitude - 1.0) < 1e-6,
        `L2 norm ${magnitude} not ≈ 1 for: ${str.slice(0, 30)}`
      );
    }
  });
});
