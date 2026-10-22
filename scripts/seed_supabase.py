#!/usr/bin/env python3
"""
Seed Supabase pgvector with ClinIQ guideline passages and precomputed embeddings.

Usage:
    python scripts/seed_supabase.py --url "https://xyz.supabase.co" --key "your-service-role-key"

Or via environment variables:
    export SUPABASE_URL="https://xyz.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
    python scripts/seed_supabase.py
"""

import os
import sys
import json
import argparse
import numpy as np
import httpx

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "ml-service", "data")
PASSAGES_PATH = os.path.join(DATA_DIR, "passages.json")
EMBEDDINGS_PATH = os.path.join(DATA_DIR, "embeddings.npy")


def main():
    parser = argparse.ArgumentParser(description="Seed Supabase with clinical guideline passages & vector embeddings")
    parser.add_argument("--url", default=os.environ.get("SUPABASE_URL"), help="Supabase project URL")
    parser.add_argument("--key", default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY"), help="Supabase Service Role or Anon Key")
    parser.add_argument("--batch-size", type=int, default=50, help="Batch size for upserting")
    args = parser.parse_args()

    supabase_url = args.url
    supabase_key = args.key

    if not supabase_url or not supabase_key:
        print("\n[ERROR] Missing Supabase credentials!")
        print("Please provide --url and --key arguments or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n")
        sys.exit(1)

    supabase_url = supabase_url.rstrip("/")

    print(f"\n=======================================================")
    print(f"ClinIQ Knowledge Explorer: Seeding Supabase pgvector")
    print(f"Target URL: {supabase_url}")
    print(f"=======================================================\n")

    if not os.path.exists(PASSAGES_PATH):
        print(f"[ERROR] Passages file not found: {PASSAGES_PATH}")
        sys.exit(1)

    if not os.path.exists(EMBEDDINGS_PATH):
        print(f"[ERROR] Embeddings file not found: {EMBEDDINGS_PATH}")
        sys.exit(1)

    print("Loading passages.json...")
    with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
        all_passages = json.load(f)

    # Searchable passages match the order of embeddings.npy
    searchable_passages = [p for p in all_passages if not p.get("is_bibliography", False)]
    print(f"Loaded {len(all_passages)} total passages ({len(searchable_passages)} searchable passages).")

    print("Loading embeddings.npy...")
    embeddings = np.load(EMBEDDINGS_PATH)
    print(f"Loaded embeddings shape: {embeddings.shape} (dtype: {embeddings.dtype})")

    if len(searchable_passages) != len(embeddings):
        print(f"[ERROR] Passage count mismatch! {len(searchable_passages)} searchable passages vs {len(embeddings)} embeddings.")
        sys.exit(1)

    # Prepare records for insertion
    records = []
    for idx, p in enumerate(searchable_passages):
        emb_list = embeddings[idx].tolist()
        records.append({
            "passage_id": p["passage_id"],
            "doc_id": p.get("doc_id", p["passage_id"].split("-")[0]),
            "doc_title": p["doc_title"],
            "source_org": p["source_org"],
            "year": int(p["year"]),
            "section": p["section"],
            "page_number": int(p["page_number"]),
            "official_url": p["official_url"],
            "content_type": p.get("content_type", "narrative"),
            "is_bibliography": False,
            "text": p["text"],
            "read_article_link": p.get("read_article_link", p["official_url"]),
            "embedding": emb_list,
        })

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",  # Upsert on conflict
    }

    endpoint = f"{supabase_url}/rest/v1/guideline_passages"

    print(f"\nUploading {len(records)} records to Supabase in batches of {args.batch_size}...")

    total_uploaded = 0
    client = httpx.Client(timeout=60.0)

    for i in range(0, len(records), args.batch_size):
        batch = records[i : i + args.batch_size]
        try:
            res = client.post(endpoint, headers=headers, json=batch)
            if res.status_code not in (200, 201, 204):
                print(f"\n[ERROR] Batch {i} to {i+len(batch)} failed (status {res.status_code}): {res.text}")
                sys.exit(1)
            total_uploaded += len(batch)
            pct = (total_uploaded / len(records)) * 100
            print(f"  Uploaded {total_uploaded}/{len(records)} ({pct:.1f}%)...")
        except Exception as e:
            print(f"\n[ERROR] Network error uploading batch: {e}")
            sys.exit(1)

    print(f"\n[SUCCESS] Successfully seeded all {total_uploaded} guideline passages and embeddings to Supabase!")

    # Verify count via REST
    count_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Range": "0-0",
        "Prefer": "count=exact",
    }
    try:
        count_res = client.get(endpoint, headers=count_headers)
        crange = count_res.headers.get("content-range", "")
        print(f"Verified Supabase Table Content-Range: {crange}")
    except Exception:
        pass

    print("\nNext step: Set SUPABASE_URL and SUPABASE_ANON_KEY in your Heroku environment:")
    print(f"    heroku config:set SUPABASE_URL=\"{supabase_url}\" SUPABASE_ANON_KEY=\"{supabase_key[:10]}...\" -a <app-name>\n")


if __name__ == "__main__":
    main()
