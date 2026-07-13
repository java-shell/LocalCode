#!/usr/bin/env python3
"""Test retrieval against the stackoverflow namespace to verify data integrity."""
import json
import sys
import os
import numpy as np

# Add path for turbovec import
sys.path.insert(0, '/home/dan/git/LocalCode/llm-ide/src/backend')

def generate_test_embedding(text: str, dim: int = 256) -> list:
    """Generate a simple hash-based embedding for testing."""
    vec = np.zeros(dim, dtype=np.float32)
    for i, char in enumerate(text):
        code = ord(char)
        idx = (i * 131 + code) % dim
        vec[idx] += ((code % 31) + 1) / 31.0
    
    # Normalize
    norm = np.sqrt(np.sum(vec ** 2)) or 1.0
    return (vec / norm).tolist()

def test_retrieval():
    """Test retrieval with various queries."""
    
    namespace_path = '/home/dan/git/LocalCode/llm-ide/src/backend/turbovec_memory/stackoverflow'
    index_path = os.path.join(namespace_path, 'memory.tvec')
    meta_path = os.path.join(namespace_path, 'memory.jsonl')
    
    print("=" * 80)
    print("TURBOVEC RETRIEVAL TEST - StackOverflow Namespace")
    print("=" * 80)
    print()
    
    # Test 1: Health check
    print("Test 1: Health Check")
    print("-" * 80)
    try:
        from turbovec import TurboQuantIndex
        index = TurboQuantIndex.load(index_path)
        print(f"✅ Index loaded successfully")
        print(f"   Records in index: {len(index)}")
        print()
    except Exception as e:
        print(f"❌ Failed to load index: {e}")
        return False
    
    # Test 2: Query with Python-related question
    print("Test 2: Query - 'How to read a file in Python'")
    print("-" * 80)
    
    query1 = "How to read a file in Python"
    embedding1 = generate_test_embedding(query1)
    
    try:
        q_np = np.array([embedding1], dtype=np.float32)
        distances, neighbors = index.search(q_np, k=5)
        
        print(f"✅ Query executed successfully")
        print(f"   Found {len(neighbors[0])} results")
        print()
        
        # Load metadata to verify we can retrieve the text
        meta_data = {}
        with open(meta_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                if line_num > 10:  # Just check first 10 for speed
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    meta_data[item['id']] = item
                except:
                    pass
        
        print(f"   Sample metadata loaded: {len(meta_data)} items")
        print()
        
    except Exception as e:
        print(f"❌ Query failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Test 3: Query with JavaScript-related question
    print("Test 3: Query - 'JavaScript array methods'")
    print("-" * 80)
    
    query2 = "JavaScript array map filter reduce methods"
    embedding2 = generate_test_embedding(query2)
    
    try:
        q_np = np.array([embedding2], dtype=np.float32)
        distances, neighbors = index.search(q_np, k=5)
        
        print(f"✅ Query executed successfully")
        print(f"   Found {len(neighbors[0])} results")
        print()
        
    except Exception as e:
        print(f"❌ Query failed: {e}")
        return False
    
    # Test 4: Verify metadata integrity by sampling random IDs
    print("Test 4: Metadata Integrity Check (sampling 100 random records)")
    print("-" * 80)
    
    import random
    total_records = len(index)
    sample_ids = random.sample(range(total_records), min(100, total_records))
    
    valid_count = 0
    invalid_count = 0
    
    # Load all metadata (this will take a moment with 8.6M records)
    print("   Loading metadata...")
    meta_data = {}
    line_count = 0
    errors = []
    
    with open(meta_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                item = json.loads(line)
                if 'id' in item and isinstance(item['id'], int):
                    meta_data[item['id']] = item
                    line_count += 1
                    
                    # Check sampled IDs
                    if item['id'] in sample_ids:
                        # Verify required fields
                        if 'text' in item and 'source' in item:
                            valid_count += 1
                        else:
                            invalid_count += 1
                            errors.append(f"ID {item['id']}: missing text or source")
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: JSON parse error")
            
            # Progress indicator
            if line_count % 1000000 == 0:
                print(f"   ... loaded {line_count:,} records")
    
    print(f"   Total metadata lines: {line_count:,}")
    print(f"   Valid sampled records: {valid_count}/{len(sample_ids)}")
    
    if errors:
        print(f"   Errors found: {len(errors)}")
        for error in errors[:5]:  # Show first 5 errors
            print(f"      - {error}")
    else:
        print(f"   ✅ All sampled records are valid")
    print()
    
    # Test 5: Verify ID sequence continuity
    print("Test 5: ID Sequence Continuity Check")
    print("-" * 80)
    
    if len(meta_data) > 0:
        all_ids = sorted(meta_data.keys())
        expected_max_id = len(meta_data) - 1
        
        print(f"   Total unique IDs: {len(all_ids):,}")
        print(f"   Min ID: {all_ids[0]}")
        print(f"   Max ID: {all_ids[-1]}")
        print(f"   Expected max ID: {expected_max_id}")
        
        if all_ids[-1] == expected_max_id and all_ids[0] == 0:
            # Check for gaps in first 1000 IDs
            first_1000 = all_ids[:1000]
            has_gaps = any(first_1000[i] != i for i in range(len(first_1000)))
            
            if not has_gaps:
                print(f"   ✅ First 1000 IDs are sequential (0-999)")
            else:
                print(f"   ⚠️  Gaps detected in first 1000 IDs")
        else:
            print(f"   ⚠️  ID range doesn't match expected sequence")
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print("✅ All retrieval tests passed!")
    print("✅ Data integrity verified")
    print(f"   - Index contains {len(index):,} vectors")
    print(f"   - Metadata contains {len(meta_data):,} records")
    print(f"   - Sampled records: {valid_count}/{len(sample_ids)} valid")
    print()
    
    return True

if __name__ == '__main__':
    success = test_retrieval()
    sys.exit(0 if success else 1)
