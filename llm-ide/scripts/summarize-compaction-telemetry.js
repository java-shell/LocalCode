#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveDebugDir() {
  const argPath = String(process.argv[2] || '').trim();
  if (argPath) {
    return path.resolve(argPath);
  }

  // Default Linux path for Electron userData under app name "llm-ide".
  return path.join(os.homedir(), '.config', 'llm-ide', 'debug');
}

function listDumpFiles(debugDir) {
  const entries = fs.readdirSync(debugDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /^chat-context-(?!latest\.json$).+\.json$/i.test(entry.name))
    .map(entry => path.join(debugDir, entry.name))
    .sort();
}

function addCount(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function summarize(files) {
  const bySource = {};
  const byMode = {};
  const byStage = {};

  let dumpCount = 0;
  let eventCount = 0;
  let droppedTokenTotal = 0;
  let droppedMessageTotal = 0;
  let droppedUserMessages = 0;
  let droppedSystemMessages = 0;
  let droppedToolResults = 0;

  for (const filePath of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    dumpCount += 1;
    const telemetry = Array.isArray(parsed.compactionTelemetry) ? parsed.compactionTelemetry : [];
    for (const item of telemetry) {
      eventCount += 1;
      addCount(bySource, String(item.source || 'unknown'));
      addCount(byMode, String(item.mode || 'unknown'));
      addCount(byStage, String(item.stage || 'unknown'));

      droppedTokenTotal += Math.max(0, safeNumber(item.droppedEstimatedTokens));
      droppedMessageTotal += Math.max(0, safeNumber(item.preMessageCount) - safeNumber(item.postMessageCount));

      const byRole = item.droppedMessagesByRole && typeof item.droppedMessagesByRole === 'object'
        ? item.droppedMessagesByRole
        : {};
      droppedUserMessages += Math.max(0, safeNumber(byRole.user));
      droppedSystemMessages += Math.max(0, safeNumber(byRole.system));

      const byType = item.droppedMessagesByType && typeof item.droppedMessagesByType === 'object'
        ? item.droppedMessagesByType
        : {};
      droppedToolResults += Math.max(0, safeNumber(byType.tool_result));
    }
  }

  const avgDroppedTokens = eventCount > 0 ? droppedTokenTotal / eventCount : 0;
  const avgDroppedMessages = eventCount > 0 ? droppedMessageTotal / eventCount : 0;

  return {
    scannedDumpFiles: dumpCount,
    compactionEvents: eventCount,
    bySource,
    byMode,
    byStage,
    averages: {
      droppedEstimatedTokensPerCompaction: Number(avgDroppedTokens.toFixed(2)),
      droppedMessagesPerCompaction: Number(avgDroppedMessages.toFixed(2))
    },
    risks: {
      droppedUserMessages,
      droppedSystemMessages,
      droppedToolResults,
      guidance: [
        droppedUserMessages > 0 ? 'Investigate latest-user retention immediately.' : 'No dropped user messages detected in analyzed dumps.',
        droppedSystemMessages > 0 ? 'Investigate system-policy preservation in compaction path.' : 'No dropped system messages detected in analyzed dumps.',
        droppedToolResults > 0 ? 'Review tool-call/result coherence under hard compaction.' : 'No dropped tool-result messages detected in analyzed dumps.'
      ]
    }
  };
}

function main() {
  const debugDir = resolveDebugDir();
  if (!fs.existsSync(debugDir)) {
    console.error(`Debug directory does not exist: ${debugDir}`);
    process.exit(1);
  }

  const files = listDumpFiles(debugDir);
  if (files.length === 0) {
    console.error(`No historical chat-context dump files found in: ${debugDir}`);
    process.exit(1);
  }

  const report = summarize(files);
  console.log(JSON.stringify({ debugDir, ...report }, null, 2));
}

main();
