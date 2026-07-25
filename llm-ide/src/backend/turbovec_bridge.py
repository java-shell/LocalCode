#!/usr/bin/env python3
"""
TurboVec bridge script supporting both single-shot and persistent worker modes.

Single-shot (legacy): --index PATH --meta PATH, reads one JSON payload from stdin, writes result to stdout.
Persistent: --worker flag, reads/writes newline-delimited JSON requests/responses until 'quit' action.
"""
import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional


def fail(message: str, code: int = 1) -> None:
    sys.stderr.write(message + "\n")
    sys.exit(code)


def load_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            fail("Payload must be a JSON object.")
        return value
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON payload: {exc}")


def ensure_parent(path_value: str) -> None:
    parent = os.path.dirname(path_value)
    if parent:
        os.makedirs(parent, exist_ok=True)


def read_metadata(meta_path: str) -> Dict[int, Dict[str, Any]]:
    if not os.path.exists(meta_path):
        return {}
    results: Dict[int, Dict[str, Any]] = {}
    with open(meta_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            raw_id = item.get("id")
            if isinstance(raw_id, int):
                results[raw_id] = item
    return results


def append_metadata(meta_path: str, items: List[Dict[str, Any]]) -> None:
    def sanitize_json_value(value: Any) -> Any:
        if isinstance(value, str):
            return value.encode("utf-8", errors="replace").decode("utf-8")
        if isinstance(value, list):
            return [sanitize_json_value(item) for item in value]
        if isinstance(value, dict):
            return {str(key): sanitize_json_value(item) for key, item in value.items()}
        return value

    ensure_parent(meta_path)
    with open(meta_path, "a", encoding="utf-8") as fh:
        for item in items:
            safe_item = sanitize_json_value(item)
            fh.write(json.dumps(safe_item, ensure_ascii=True) + "\n")


def handle_health() -> Dict[str, Any]:
    """Handle health check action."""
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"numpy is required: {exc}"}

    try:
        from turbovec import TurboQuantIndex  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"turbovec is required (pip install turbovec): {exc}"}

    return {
        "ok": True,
        "numpyVersion": getattr(np, "__version__", "unknown"),
        "turbovecVersion": getattr(sys.modules.get("turbovec"), "__version__", "unknown"),
    }


def handle_add(
    index_path: str, meta_path: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Handle add action."""
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"numpy is required: {exc}"}

    try:
        from turbovec import TurboQuantIndex  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"turbovec is required (pip install turbovec): {exc}"}

    vectors = payload.get("vectors")
    ids = payload.get("ids")
    items = payload.get("items", [])

    if not isinstance(vectors, list) or not vectors:
        return {"ok": False, "error": "add requires non-empty vectors list"}
    if not isinstance(ids, list) or len(ids) != len(vectors):
        return {"ok": False, "error": "add requires ids list with same length as vectors"}
    if not isinstance(items, list) or len(items) != len(vectors):
        return {"ok": False, "error": "add requires items list with same length as vectors"}

    vectors_np = np.array(vectors, dtype=np.float32)

    ensure_parent(index_path)
    if os.path.exists(index_path):
        index = TurboQuantIndex.load(index_path)
        existing_count = len(index)
    else:
        index = TurboQuantIndex(bit_width=2)
        existing_count = 0

    # P1 #3: Validate dimension consistency
    if existing_count > 0 and vectors_np.shape[1] != index.dim:
        return {
            "ok": False,
            "error": f"dim mismatch: expected {index.dim}, got {vectors_np.shape[1]}",
        }

    index.add(vectors_np)
    index.write(index_path)

    # Assign positional IDs (matching TurboVec's implicit 0-based ordering)
    for i, item in enumerate(items):
        item["id"] = existing_count + i
    append_metadata(meta_path, items)

    return {"ok": True, "added": int(len(ids))}


def handle_query(
    index_path: str, meta_path: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Handle query action."""
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"numpy is required: {exc}"}

    try:
        from turbovec import TurboQuantIndex  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"turbovec is required (pip install turbovec): {exc}"}

    vector = payload.get("vector")
    k = int(payload.get("k", 6))
    k = max(1, min(50, k))

    if not isinstance(vector, list) or not vector:
        return {"ok": False, "error": "query requires non-empty vector list"}

    if not os.path.exists(index_path):
        return {"ok": True, "matches": []}

    index = TurboQuantIndex.load(index_path)
    
    # P1 #3: Validate query dimension matches index dimension
    q_np = np.array([vector], dtype=np.float32)
    if q_np.shape[1] != index.dim:
        return {
            "ok": False,
            "error": f"dim mismatch: expected {index.dim}, got {q_np.shape[1]}",
        }

    distances, neighbors = index.search(q_np, k=k)

    meta = read_metadata(meta_path)
    found: List[Dict[str, Any]] = []

    row_neighbors = (
        neighbors[0].tolist() if hasattr(neighbors[0], "tolist") else list(neighbors[0])
    )
    row_distances = (
        distances[0].tolist() if hasattr(distances[0], "tolist") else list(distances[0])
    )

    for idx, neighbor_raw in enumerate(row_neighbors):
        try:
            neighbor = int(neighbor_raw)
        except Exception:
            continue
        if neighbor < 0:
            continue

        item = meta.get(
            neighbor, {"id": neighbor, "text": "", "source": "unknown", "metadata": {}}
        )
        score = float(row_distances[idx]) if idx < len(row_distances) else 0.0
        found.append(
            {
                "id": neighbor,
                "text": item.get("text", ""),
                "source": item.get("source", "unknown"),
                "metadata": item.get("metadata", {}),
                "score": score,
            }
        )

    return {"ok": True, "matches": found}


def handle_action(
    action: str, index_path: str, meta_path: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Route action to appropriate handler."""
    if action == "health":
        return handle_health()
    elif action == "add":
        return handle_add(index_path, meta_path, payload)
    elif action == "query":
        return handle_query(index_path, meta_path, payload)
    else:
        return {"ok": False, "error": f"Unsupported action: {action}"}


def run_worker_mode() -> None:
    """
    P1 #6: Persistent worker mode.
    
    Reads newline-delimited JSON requests from stdin and writes JSON responses to stdout.
    Each request must include 'index' and 'meta' paths plus an 'action'.
    Send {'action': 'quit'} to terminate the worker.
    """
    try:
        import numpy as np  # type: ignore
        from turbovec import TurboQuantIndex  # type: ignore
    except Exception as exc:
        sys.stderr.write(f"Worker initialization failed: {exc}\n")
        sys.exit(1)

    # Signal ready
    print(json.dumps({"_ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"ok": False, "error": f"Invalid JSON: {exc}"}), flush=True)
            continue

        action = str(payload.get("action", "")).strip().lower()

        if action == "quit":
            print(json.dumps({"ok": True, "_quit": True}), flush=True)
            return

        index_path = str(payload.get("index", ""))
        meta_path = str(payload.get("meta", ""))

        if not index_path or not meta_path:
            print(
                json.dumps({"ok": False, "error": "index and meta paths are required"}),
                flush=True,
            )
            continue

        result = handle_action(action, index_path, meta_path, payload)
        # Echo back request ID for routing in TypeScript side
        requestId = payload.get("_requestId")
        if requestId is not None:
            result["_requestId"] = requestId
        print(json.dumps(result), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", default="")
    parser.add_argument("--meta", default="")
    parser.add_argument(
        "--worker", action="store_true", help="Run in persistent worker mode"
    )
    args = parser.parse_args()

    # P1 #6: Persistent worker mode
    if args.worker:
        run_worker_mode()
        return

    # Legacy single-shot mode (backward compatible)
    if not args.index or not args.meta:
        fail("--index and --meta are required in single-shot mode")

    payload = load_payload()
    action = str(payload.get("action", "")).strip().lower()
    if not action:
        fail("Missing action.")

    result = handle_action(action, args.index, args.meta, payload)

    if not result.get("ok") and "error" in result:
        fail(result["error"])

    print(json.dumps(result))


if __name__ == "__main__":
    main()
