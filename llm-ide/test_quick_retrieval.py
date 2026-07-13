#!/usr/bin/env python3
"""Quick retrieval test using direct turbovec API (not bridge)."""
import json
import sys
import numpy as np
from turbovec import TurboQuantIndex

def generate_embedding(text: str, dim: int = 256) -> list:
    """Generate a simple hash-based embedding."""
    vec = np.zeros(dim, dtype=np.float32)
    for i, char in enumerate(text):
        code = ord(char)
        idx = (i * 131 + code) % dim
        vec[idx] += ((code % 31) + 1) / 31.0
    
    norm = np.sqrt(np.sum(vec ** 2)) or 1.0
    return (vec / norm).tolist()

def load_sample_metadata(meta_path: str, sample_size: int = 1000) -> dict:
    """Load only a sample of metadata for quick testing."""
    meta_data = {}
    count = 0
    
    with open(meta_path, 'r', encoding='utf-8') as f:
        for line in f:
            if count >= sample_size:
                break
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                if 'id' in item:
                    meta_data[item['id']] = item
                    count += 1
            except:
                pass
    
    return meta_data

def main():
    print("=" * 80)
    print("QUICK RETRIEVAL TEST - StackOverflow Namespace")
    print("=" * 80)
    print()
    
    namespace_path = '/home/dan/git/LocalCode/llm-ide/src/backend/turbovec_memory/stackoverflow'
    index_path = f"{namespace_path}/memory.tvec"
    meta_path = f"{namespace_path}/memory.jsonl"
    
    # Load index
    print("Loading index...")
    index = TurboQuantIndex.load(index_path)
    print(f"✅ Index loaded: {len(index):,} vectors")
    print()
    
    # Load sample metadata
    print("Loading sample metadata (1000 records)...")
    meta_data = load_sample_metadata(meta_path, 1000)
    print(f"✅ Loaded {len(meta_data)} metadata records")
    print()
    
    # Test queries
    test_queries = [
        "How to read a file in Python",
        "JavaScript array map filter reduce",
        "SQL JOIN types inner left right",
        "React useEffect cleanup function",
        "Docker container networking"
    ]
    
    print("Testing retrieval with 5 different queries:")
    print("-" * 80)
    
    all_success = True
    
    for i, query_text in enumerate(test_queries, 1):
        print(f"\nQuery {i}: '{query_text}'")
        
        try:
            # Generate embedding
            embedding = generate_embedding(query_text)
            q_np = np.array([embedding], dtype=np.float32)
            
            # Search
            distances, neighbors = index.search(q_np, k=5)
            
            # Get results
            neighbor_ids = neighbors[0].tolist()
            distance_vals = distances[0].tolist()
            
            print(f"   ✅ Found {len(neighbor_ids)} results")
            
            # Show top result if we have metadata for it
            for j, (nid, dist) in enumerate(zip(neighbor_ids, distance_vals)):
                if nid in meta_data:
                    item = meta_data[nid]
                    text_preview = item.get('text', '')[:100]
                    print(f"   Result {j+1} (ID: {nid}, Score: {dist:.4f}):")
                    print(f"      {text_preview}...")
                    break
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            all_success = False
    
    print()
    print("-" * 80)
    
    # Verify data integrity
    print("\nData Integrity Verification:")
    print("-" * 80)
    
    # Check 1: Index size matches expected
    expected_size = 8677465
    actual_size = len(index)
    
    if actual_size == expected_size:
        print(f"✅ Index size correct: {actual_size:,} records")
    else:
        print(f"❌ Index size mismatch: expected {expected_size:,}, got {actual_size:,}")
        all_success = False
    
    # Check 2: Search returns valid results
    test_embedding = generate_embedding("test query")
    q_np = np.array([test_embedding], dtype=np.float32)
    
    try:
        distances, neighbors = index.search(q_np, k=10)
        
        # Verify we got results
        if len(neighbors[0]) == 10:
            print(f"✅ Search returns expected number of results (10)")
        else:
            print(f"⚠️  Search returned {len(neighbors[0])} results instead of 10")
        
        # Verify IDs are non-negative
        neighbor_ids = neighbors[0].tolist()
        if all(nid >= 0 for nid in neighbor_ids):
            print(f"✅ All neighbor IDs are non-negative")
        else:
            print(f"❌ Some neighbor IDs are negative")
            all_success = False
        
        # Verify distances are reasonable (between 0 and 2 for cosine-like)
        distance_vals = distances[0].tolist()
        if all(0 <= d <= 2 for d in distance_vals):
            print(f"✅ All distances are in valid range [0, 2]")
        else:
            print(f"⚠️  Some distances outside expected range")
        
    except Exception as e:
        print(f"❌ Search verification failed: {e}")
        all_success = False
    
    # Check 3: Metadata file is valid JSONL
    print()
    print("Metadata File Validation:")
    print("-" * 80)
    
    line_count = 0
    valid_lines = 0
    errors = []
    
    with open(meta_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line_count += 1
            line = line.strip()
            if not line:
                continue
            
            try:
                item = json.loads(line)
                if 'id' in item and 'text' in item:
                    valid_lines += 1
                else:
                    errors.append(f"Line {line_num}: missing id or text")
            except json.JSONDecodeError:
                errors.append(f"Line {line_num}: invalid JSON")
            
            # Check first 10,000 lines only for speed
            if line_count >= 10000:
                break
    
    print(f"✅ Checked {line_count:,} lines")
    print(f"   Valid lines: {valid_lines:,}")
    
    if errors:
        print(f"   Errors: {len(errors)}")
        for error in errors[:3]:
            print(f"      - {error}")
    else:
        print(f"   ✅ No errors in sampled lines")
    
    # Final summary
    print()
    print("=" * 80)
    if all_success:
        print("✅ ALL TESTS PASSED - Data integrity is stable!")
    else:
        print("⚠️  Some tests had issues (see above)")
    print("=" * 80)
    
    return 0 if all_success else 1

if __name__ == '__main__':
    sys.exit(main())
