#!/usr/bin/env python3
"""Test the turbovec_bridge.py query action directly."""
import json
import subprocess
import sys

def generate_fallback_embedding(text: str, dim: int = 256) -> list:
    """Generate a simple hash-based embedding matching the TypeScript fallback."""
    vec = [0.0] * dim
    for i, char in enumerate(text):
        code = ord(char)
        idx = (i * 131 + code) % dim
        vec[idx] += ((code % 31) + 1) / 31.0
    
    # Normalize
    import math
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]

def test_bridge_query():
    """Test the bridge script query action."""
    
    print("=" * 80)
    print("BRIDGE SCRIPT QUERY TEST")
    print("=" * 80)
    print()
    
    namespace_path = '/home/dan/git/LocalCode/llm-ide/src/backend/turbovec_memory/stackoverflow'
    index_path = f"{namespace_path}/memory.tvec"
    meta_path = f"{namespace_path}/memory.jsonl"
    bridge_script = '/home/dan/git/LocalCode/llm-ide/src/backend/turbovec_bridge.py'
    
    # Test queries
    test_queries = [
        "How to read a file in Python",
        "JavaScript array map filter reduce",
        "SQL JOIN types inner left right",
        "React useEffect cleanup function",
        "Docker container networking"
    ]
    
    for i, query_text in enumerate(test_queries, 1):
        print(f"Query {i}: '{query_text}'")
        print("-" * 80)
        
        # Generate embedding
        embedding = generate_fallback_embedding(query_text)
        
        # Create payload
        payload = {
            "action": "query",
            "vector": embedding,
            "k": 5
        }
        
        # Run bridge script
        try:
            result = subprocess.run(
                [sys.executable, bridge_script, "--index", index_path, "--meta", meta_path],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                print(f"❌ Bridge script failed with return code {result.returncode}")
                print(f"   stderr: {result.stderr[:500]}")
                continue
            
            # Parse response
            response = json.loads(result.stdout)
            
            if not response.get('ok'):
                print(f"❌ Response not ok: {response}")
                continue
            
            matches = response.get('matches', [])
            print(f"✅ Query successful - found {len(matches)} matches")
            
            # Show top result
            if matches:
                top_match = matches[0]
                print(f"   Top match (ID: {top_match['id']}):")
                print(f"     Score: {top_match.get('score', 'N/A')}")
                text_preview = top_match.get('text', '')[:200]
                print(f"     Text preview: {text_preview}...")
                source = top_match.get('source', 'unknown')
                print(f"     Source: {source}")
            
            # Verify all matches have required fields
            all_valid = all(
                'id' in m and 'text' in m and 'source' in m 
                for m in matches
            )
            
            if all_valid:
                print(f"   ✅ All matches have valid structure")
            else:
                print(f"   ❌ Some matches missing required fields")
            
            print()
            
        except subprocess.TimeoutExpired:
            print(f"❌ Query timed out after 30 seconds")
            print()
        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse response: {e}")
            print(f"   stdout: {result.stdout[:500]}")
            print()
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            print()
    
    # Test health check
    print("Health Check Test")
    print("-" * 80)
    
    try:
        payload = {"action": "health"}
        result = subprocess.run(
            [sys.executable, bridge_script, "--index", index_path, "--meta", meta_path],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=10
        )
        
        response = json.loads(result.stdout)
        print(f"✅ Health check passed")
        print(f"   NumPy version: {response.get('numpyVersion', 'unknown')}")
        print(f"   TurboVec version: {response.get('turbovecVersion', 'unknown')}")
        print()
        
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        print()
    
    print("=" * 80)
    print("BRIDGE SCRIPT TEST COMPLETE")
    print("=" * 80)

if __name__ == '__main__':
    test_bridge_query()
