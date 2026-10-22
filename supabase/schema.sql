-- =============================================================================
-- ClinIQ Medical Guideline Knowledge Explorer: Supabase pgvector Schema
-- =============================================================================

-- 1. Enable the pgvector extension for high-dimensional vector similarity
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create the guideline passages table
CREATE TABLE IF NOT EXISTS guideline_passages (
    id BIGSERIAL PRIMARY KEY,
    passage_id TEXT UNIQUE NOT NULL,
    doc_id TEXT NOT NULL,
    doc_title TEXT NOT NULL,
    source_org TEXT NOT NULL,
    year INT NOT NULL,
    section TEXT NOT NULL,
    page_number INT NOT NULL,
    official_url TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'narrative',
    is_bibliography BOOLEAN DEFAULT FALSE,
    text TEXT NOT NULL,
    read_article_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Generated Full-Text Search tsvector for BM25-style lexical ranking
    fts TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', 
            coalesce(doc_title, '') || ' ' || 
            coalesce(section, '') || ' ' || 
            coalesce(text, '')
        )
    ) STORED,

    -- 384-dimensional dense semantic vector from sentence-transformers/all-MiniLM-L6-v2
    embedding VECTOR(384)
);

-- 3. High-performance HNSW index for sub-millisecond vector similarity search
CREATE INDEX IF NOT EXISTS guideline_passages_embedding_hnsw_idx 
ON guideline_passages USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. GIN index for full-text search
CREATE INDEX IF NOT EXISTS guideline_passages_fts_idx 
ON guideline_passages USING gin (fts);

-- 5. Standard indexes for metadata filtering
CREATE INDEX IF NOT EXISTS guideline_passages_source_org_idx ON guideline_passages (source_org);
CREATE INDEX IF NOT EXISTS guideline_passages_content_type_idx ON guideline_passages (content_type);
CREATE INDEX IF NOT EXISTS guideline_passages_year_idx ON guideline_passages (year);

-- 6. Hybrid Retrieval Stored Procedure (Vector Cosine + Lexical FTS + Reciprocal Rank Fusion)
CREATE OR REPLACE FUNCTION match_guideline_passages (
    query_text TEXT,
    query_embedding VECTOR(384),
    match_count INT DEFAULT 5,
    filter_source TEXT DEFAULT 'all',
    filter_type TEXT DEFAULT 'all'
)
RETURNS TABLE (
    passage_id TEXT,
    doc_id TEXT,
    doc_title TEXT,
    source_org TEXT,
    year INT,
    section TEXT,
    page_number INT,
    official_url TEXT,
    content_type TEXT,
    text TEXT,
    read_article_link TEXT,
    similarity FLOAT,
    bm25_rank INT,
    semantic_rank INT,
    rrf_score FLOAT,
    rerank_score FLOAT,
    relevance_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH semantic_results AS (
        SELECT 
            p.id,
            p.passage_id,
            ROW_NUMBER() OVER (ORDER BY (p.embedding <=> query_embedding)) AS s_rank,
            1.0 - (p.embedding <=> query_embedding) AS cos_sim
        FROM guideline_passages p
        WHERE p.is_bibliography = FALSE
          AND (
              filter_source = 'all' 
              OR (filter_source = 'ada' AND (p.source_org ILIKE '%ADA%' OR p.source_org ILIKE '%American%'))
              OR (filter_source = 'rssdi' AND (p.source_org ILIKE '%RSSDI%' OR p.source_org ILIKE '%Research Society%'))
          )
          AND (
              filter_type = 'all' 
              OR lower(p.content_type) = lower(filter_type)
          )
        ORDER BY p.embedding <=> query_embedding
        LIMIT 60
    ),
    keyword_results AS (
        SELECT 
            p.id,
            p.passage_id,
            ROW_NUMBER() OVER (ORDER BY ts_rank_cd(p.fts, websearch_to_tsquery('english', query_text)) DESC) AS k_rank
        FROM guideline_passages p
        WHERE p.is_bibliography = FALSE
          AND p.fts @@ websearch_to_tsquery('english', query_text)
          AND (
              filter_source = 'all' 
              OR (filter_source = 'ada' AND (p.source_org ILIKE '%ADA%' OR p.source_org ILIKE '%American%'))
              OR (filter_source = 'rssdi' AND (p.source_org ILIKE '%RSSDI%' OR p.source_org ILIKE '%Research Society%'))
          )
          AND (
              filter_type = 'all' 
              OR lower(p.content_type) = lower(filter_type)
          )
        ORDER BY ts_rank_cd(p.fts, websearch_to_tsquery('english', query_text)) DESC
        LIMIT 60
    ),
    fused AS (
        SELECT
            coalesce(s.id, k.id) AS id,
            coalesce(s.passage_id, k.passage_id) AS passage_id,
            coalesce(s.cos_sim, 0.0) AS sim,
            k.k_rank,
            s.s_rank,
            (coalesce(1.0 / (60.0 + k.k_rank), 0.0) + coalesce(1.0 / (60.0 + s.s_rank), 0.0))::float AS rrf
        FROM semantic_results s
        FULL OUTER JOIN keyword_results k ON s.id = k.id
    )
    SELECT 
        p.passage_id,
        p.doc_id,
        p.doc_title,
        p.source_org,
        p.year,
        p.section,
        p.page_number,
        p.official_url,
        p.content_type,
        p.text,
        coalesce(p.read_article_link, p.official_url) AS read_article_link,
        f.sim::float AS similarity,
        f.k_rank::int AS bm25_rank,
        f.s_rank::int AS semantic_rank,
        f.rrf::float AS rrf_score,
        (f.sim * 1.5 + f.rrf * 10.0)::float AS rerank_score,
        CASE 
            WHEN f.sim > 0.65 THEN 'High Relevance'
            WHEN f.sim > 0.45 THEN 'Relevant'
            ELSE 'Moderate Relevance'
        END AS relevance_label
    FROM fused f
    JOIN guideline_passages p ON f.id = p.id
    ORDER BY f.rrf DESC
    LIMIT match_count;
END;
$$;
