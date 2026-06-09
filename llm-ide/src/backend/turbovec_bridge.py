#!/usr/bin/env python3
import argparse
import json
import os
import sys
from typing import Any, Dict, List


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
    ensure_parent(meta_path)
    with open(meta_path, "a", encoding="utf-8") as fh:
        for item in items:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", required=True)
    parser.add_argument("--meta", required=True)
    args = parser.parse_args()

    payload = load_payload()
    action = str(payload.get("action", "")).strip().lower()
    if not action:
        fail("Missing action.")

    try:
        import numpy as np  # type: ignore
    except Exception as exc:  # pragma: no cover
        fail(f"numpy is required: {exc}")

    try:
        from turbovec import TurboQuantIndex  # type: ignore
    except Exception as exc:
        fail(f"turbovec is required (pip install turbovec): {exc}")

    if action == "health":
        print(
            json.dumps(
                {
                    "ok": True,
                    "numpyVersion": getattr(np, "__version__", "unknown"),
                    "turbovecVersion": getattr(sys.modules.get("turbovec"), "__version__", "unknown"),
                }
            )
        )
        return

    if action == "add":
        vectors = payload.get("vectors")
        ids = payload.get("ids")
        items = payload.get("items", [])

        if not isinstance(vectors, list) or not vectors:
            fail("add requires non-empty vectors list")
        if not isinstance(ids, list) or len(ids) != len(vectors):
            fail("add requires ids list with same length as vectors")
        if not isinstance(items, list) or len(items) != len(vectors):
            fail("add requires items list with same length as vectors")

        vectors_np = np.array(vectors, dtype=np.float32)
        ids_np = np.array(ids, dtype=np.int64)

        ensure_parent(args.index)
        if os.path.exists(args.index):
            index = TurboQuantIndex.load(args.index)
            existing_count = len(index)
        else:
            index = TurboQuantIndex(bit_width=2)
            existing_count = 0

        index.add(vectors_np)
        index.write(args.index)

        # Assign positional IDs (matching TurboVec's implicit 0-based ordering)
        for i, item in enumerate(items):
            item["id"] = existing_count + i
        append_metadata(args.meta, items)

        print(json.dumps({"ok": True, "added": int(len(ids))}))
        return

    if action == "query":
        vector = payload.get("vector")
        k = int(payload.get("k", 6))
        k = max(1, min(50, k))

        if not isinstance(vector, list) or not vector:
            fail("query requires non-empty vector list")

        if not os.path.exists(args.index):
            print(json.dumps({"ok": True, "matches": []}))
            return

        index = TurboQuantIndex.load(args.index)
        q_np = np.array([vector], dtype=np.float32)
        distances, neighbors = index.search(q_np, k=k)

        meta = read_metadata(args.meta)
        found: List[Dict[str, Any]] = []

        row_neighbors = neighbors[0].tolist() if hasattr(neighbors[0], "tolist") else list(neighbors[0])
        row_distances = distances[0].tolist() if hasattr(distances[0], "tolist") else list(distances[0])

        for idx, neighbor_raw in enumerate(row_neighbors):
            try:
                neighbor = int(neighbor_raw)
            except Exception:
                continue
            if neighbor < 0:
                continue

            item = meta.get(neighbor, {"id": neighbor, "text": "", "source": "unknown", "metadata": {}})
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

        print(json.dumps({"ok": True, "matches": found}))
        return

    fail(f"Unsupported action: {action}")


if __name__ == "__main__":
    main()
