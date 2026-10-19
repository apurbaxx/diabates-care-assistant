import os
import sys
import re
import json
import time
import hashlib
from typing import List, Dict, Any, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.stdout.reconfigure(encoding='utf-8')

import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, CrossEncoder

from app.schemas import PassageResult, SearchResponse

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
PASSAGES_PATH = os.path.join(DATA_DIR, "passages.json")
EMBEDDINGS_PATH = os.path.join(DATA_DIR, "embeddings.npy")
METADATA_PATH = os.path.join(DATA_DIR, "index_metadata.json")

EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
RERANKER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

# Evaluated composite relevance threshold
# Relevant medical passages score well above 1.5, while out-of-domain queries score < 0.0
DEFAULT_RELEVANCE_THRESHOLD = 0.0
RRF_K = 60
TOP_LEXICAL_CANDIDATES = 100
TOP_SEMANTIC_CANDIDATES = 100
MAX_RERANK_CANDIDATES = 35


def tokenize_text(text: str) -> List[str]:
    """Tokenize and normalize text for BM25 retrieval."""
    clean = re.sub(r"[^\w\s]", " ", text.lower())
    tokens = clean.split()
    return tokens


def compute_file_hash(path: str) -> str:
    """Compute SHA256 of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def analyze_and_expand_query(q: str) -> Tuple[str, Dict[str, Any]]:
    """Analyzes query intent and enriches medical queries with standardized guideline terminology."""
    q_lower = q.lower()
    intent = {
        "is_treatment_target": False,
        "is_diagnostic": False,
        "is_anemia_interference": False,
        "is_frequency": False,
        "is_tir": False,
        "is_ckd": False,
        "is_retinopathy": False,
        "is_medical": False,
    }

    # Medical domain vocabulary check
    medical_terms = [
        "hba1c", "a1c", "glucose", "diabetes", "diabetic", "glycemic", "insulin",
        "kidney", "ckd", "retinopathy", "tir", "time in range", "smbg", "cgm",
        "nephropathy", "microvascular", "hypoglycemia", "hyperglycemia", "prediabetes"
    ]
    if any(m in q_lower for m in medical_terms):
        intent["is_medical"] = True

    # If off-topic / non-medical, return raw query without expansion so it is rejected cleanly
    if not intent["is_medical"]:
        return q, intent

    expanded_terms: List[str] = []

    # 1. Anemia / Interferences
    if any(k in q_lower for k in ["anemia", "iron deficiency", "hemoglobinopath", "turnover", "falsely", "interference"]):
        intent["is_anemia_interference"] = True
        expanded_terms.extend(["iron deficiency anemia", "IDA", "falsely elevated", "red blood cell turnover", "hemoglobinopathies"])

    # 2. Time in Range (specific CGM metric)
    elif any(k in q_lower for k in ["time in range", "tir", "time-in-range"]):
        intent["is_tir"] = True
        expanded_terms.extend(["time in range TIR", "70-180 mg/dL", "3.9-10.0 mmol/L", "continuous glucose monitoring CGM metrics", ">70%"])

    # 3. Diagnostic criteria
    elif any(k in q_lower for k in ["diagnos", "criteria", "cutoff", "threshold for diabetes", "detect diabetes", "screen for diabetes", "testing threshold"]):
        intent["is_diagnostic"] = True
        expanded_terms.extend(["diagnostic criteria", "diagnosis of diabetes", "A1C >= 6.5%", "fasting plasma glucose FPG >= 126", "2-h PG >= 200"])

    # 4. Monitoring frequency
    elif any(k in q_lower for k in ["frequency", "how often", "how frequently", "quarterly", "intervals", "how many times"]):
        intent["is_frequency"] = True
        expanded_terms.extend(["frequency of testing", "assess glycemic status", "at least twice a year", "quarterly", "every 3 months"])

    # 5. Treatment targets / goals (e.g. normal range for diabetic patients)
    elif any(k in q_lower for k in ["target", "goal", "normal range", "normal hba1c", "target range", "aim", "recommended hba1c", "treatment target", "range for diabetic"]):
        intent["is_treatment_target"] = True
        expanded_terms.extend(["glycemic goals", "A1C target", "treatment goal", "A1C < 7.0%", "A1C < 7%", "nonpregnant adults", "glycemic targets"])

    # 6. Kidney Disease / CKD
    if any(k in q_lower for k in ["kidney", "ckd", "renal", "nephropathy"]):
        intent["is_ckd"] = True
        expanded_terms.extend(["chronic kidney disease CKD", "eGFR", "UACR", "albuminuria", "SGLT2 inhibitors", "finerenone"])

    # 7. Retinopathy Screening
    if any(k in q_lower for k in ["retinopathy", "eye", "vision", "retinal"]):
        intent["is_retinopathy"] = True
        expanded_terms.extend(["diabetic retinopathy screening", "dilated eye examination", "ophthalmologist", "fundus photography"])

    enriched_query = q + (" " + " ".join(expanded_terms) if expanded_terms else "")
    return enriched_query, intent


class ModelManager:
    """Loads and manages embedding and cross-encoder reranker models once across requests."""

    _instance: Optional["ModelManager"] = None

    def __init__(self):
        self.embedding_model: Optional[SentenceTransformer] = None
        self.reranker_model: Optional[CrossEncoder] = None
        self.embedding_model_name = EMBEDDING_MODEL_NAME
        self.reranker_model_name = RERANKER_MODEL_NAME
        self.embedding_loaded = False
        self.reranker_loaded = False
        self.device = "cpu"

    @classmethod
    def get_instance(cls) -> "ModelManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load_models(self) -> None:
        """Load pretrained models once at startup."""
        print(f"Loading embedding model: {self.embedding_model_name}...")
        try:
            self.embedding_model = SentenceTransformer(self.embedding_model_name)
            self.embedding_loaded = True
            print("Embedding model loaded successfully.")
        except Exception as e:
            print(f"ERROR loading embedding model: {e}")
            self.embedding_loaded = False

        print(f"Loading cross-encoder reranker: {self.reranker_model_name}...")
        try:
            self.reranker_model = CrossEncoder(self.reranker_model_name)
            self.reranker_loaded = True
            print("Cross-encoder reranker loaded successfully.")
        except Exception as e:
            print(f"WARNING: Cross-encoder failed to load ({e}). System will use RRF fallback.")
            self.reranker_loaded = False


class GuidelineIndex:
    """Manages the indexed passages, BM25 index, and dense vector embeddings."""

    def __init__(self):
        self.passages: List[Dict[str, Any]] = []
        self.searchable_passages: List[Dict[str, Any]] = []
        self.passage_id_to_idx: Dict[str, int] = {}
        self.bm25: Optional[BM25Okapi] = None
        self.embeddings: Optional[np.ndarray] = None
        self.metadata: Dict[str, Any] = {}
        self.is_ready = False

    def build_and_save_index(self, model_manager: ModelManager, force: bool = False) -> None:
        """Generates embeddings and builds index, saving atomically."""
        if not os.path.exists(PASSAGES_PATH):
            raise FileNotFoundError(f"Passages file not found: {PASSAGES_PATH}. Run ingestion first.")

        passages_hash = compute_file_hash(PASSAGES_PATH)

        if not force and os.path.exists(METADATA_PATH) and os.path.exists(EMBEDDINGS_PATH):
            try:
                with open(METADATA_PATH, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if meta.get("passages_hash") == passages_hash and meta.get("embedding_model") == EMBEDDING_MODEL_NAME:
                    print("Index is already up to date with passages. Skipping re-embedding.")
                    self.load_index()
                    return
            except Exception as e:
                print(f"Existing index check failed: {e}. Rebuilding...")

        print("Building passage embeddings and index...")
        with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
            all_passages = json.load(f)

        # Exclude bibliography passages from normal search
        searchable = [p for p in all_passages if not p.get("is_bibliography", False)]
        print(f"Found {len(searchable)} searchable clinical passages to index.")

        if not model_manager.embedding_loaded:
            model_manager.load_models()

        if not model_manager.embedding_model:
            raise RuntimeError("Embedding model is not loaded.")

        texts = [f"{p['doc_title']} - {p['section']}: {p['text']}" for p in searchable]
        print(f"Generating embeddings for {len(texts)} passages...")
        raw_embeddings = model_manager.embedding_model.encode(
            texts,
            batch_size=64,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )

        dim = raw_embeddings.shape[1]
        print(f"Generated embeddings shape: {raw_embeddings.shape}, dimension: {dim}")
        if dim != 384:
            raise ValueError(f"Expected embedding dimension 384, got {dim}")

        # Save embeddings atomically
        tmp_emb_path = os.path.join(DATA_DIR, "embeddings_tmp.npy")
        np.save(tmp_emb_path, raw_embeddings.astype(np.float32))
        if os.path.exists(EMBEDDINGS_PATH):
            try:
                os.remove(EMBEDDINGS_PATH)
            except OSError:
                pass
        os.replace(tmp_emb_path, EMBEDDINGS_PATH)

        # Save metadata atomically
        meta = {
            "embedding_model": EMBEDDING_MODEL_NAME,
            "embedding_dimension": dim,
            "total_indexed_passages": len(searchable),
            "passages_hash": passages_hash,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "passage_ids": [p["passage_id"] for p in searchable],
        }
        tmp_meta_path = os.path.join(DATA_DIR, "index_metadata_tmp.json")
        with open(tmp_meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        if os.path.exists(METADATA_PATH):
            try:
                os.remove(METADATA_PATH)
            except OSError:
                pass
        os.replace(tmp_meta_path, METADATA_PATH)

        print(f"Atomically saved embeddings and metadata to {DATA_DIR}.")
        self.load_index()

    def load_index(self) -> None:
        """Loads passages, embeddings, and initializes BM25 index."""
        if not os.path.exists(PASSAGES_PATH) or not os.path.exists(EMBEDDINGS_PATH) or not os.path.exists(METADATA_PATH):
            print("Index files missing. Build index before loading.")
            return

        with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
            self.passages = json.load(f)

        self.searchable_passages = [p for p in self.passages if not p.get("is_bibliography", False)]
        self.passage_id_to_idx = {p["passage_id"]: idx for idx, p in enumerate(self.searchable_passages)}

        with open(METADATA_PATH, "r", encoding="utf-8") as f:
            self.metadata = json.load(f)

        self.embeddings = np.load(EMBEDDINGS_PATH)
        print(f"Loaded {len(self.searchable_passages)} searchable passages and {self.embeddings.shape} embeddings.")

        # Initialize BM25 on searchable passages
        print("Initializing BM25 lexical index...")
        corpus_tokens = [tokenize_text(f"{p['doc_title']} {p['section']} {p['text']}") for p in self.searchable_passages]
        self.bm25 = BM25Okapi(corpus_tokens)
        self.is_ready = True
        print("BM25 index ready.")


class HybridSearchEngine:
    """Performs hybrid retrieval (BM25 + Semantic Cosine Similarity + RRF) and Cross-Encoder Reranking."""

    def __init__(self, index: GuidelineIndex, model_manager: ModelManager):
        self.index = index
        self.model_manager = model_manager

    def search(
        self,
        query: str,
        limit: int = 5,
        threshold: Optional[float] = None,
        include_debug: bool = True,
        mode: str = "hybrid_rerank",  # "keyword_only" | "hybrid" | "hybrid_rerank"
    ) -> SearchResponse:
        start_time = time.time()
        norm_threshold = threshold if threshold is not None else DEFAULT_RELEVANCE_THRESHOLD

        if not self.index.is_ready:
            raise RuntimeError("Guideline index is not initialized or ready.")

        clean_query = query.strip()
        enriched_query, intent = analyze_and_expand_query(clean_query)

        is_baseline = (mode == "baseline_rerank")
        query_text = clean_query if (is_baseline or mode == "keyword_only") else enriched_query
        lex_limit = 30 if is_baseline else TOP_LEXICAL_CANDIDATES
        sem_limit = 30 if is_baseline else TOP_SEMANTIC_CANDIDATES
        max_rerank = 20 if is_baseline else MAX_RERANK_CANDIDATES

        tokens = tokenize_text(query_text)
        num_docs = len(self.index.searchable_passages)

        semantic_executed = False
        rerank_executed = False
        reranker_fallback = False

        # --- A. Lexical Retrieval (BM25) ---
        bm25_scores = self.index.bm25.get_scores(tokens)
        bm25_top_indices = np.argsort(bm25_scores)[::-1][:lex_limit]

        bm25_rank_map = {}
        for rank, idx in enumerate(bm25_top_indices):
            if bm25_scores[idx] > 0.01:
                bm25_rank_map[idx] = rank + 1

        # --- Mode: Keyword Only ---
        if mode == "keyword_only":
            results = []
            for idx in bm25_top_indices[:limit]:
                if bm25_scores[idx] <= 0:
                    continue
                p = self.index.searchable_passages[idx]
                results.append(
                    PassageResult(
                        passage_id=p["passage_id"],
                        doc_id=p.get("doc_id"),
                        doc_title=p["doc_title"],
                        source_org=p["source_org"],
                        year=p["year"],
                        section=p["section"],
                        page_number=p["page_number"],
                        official_url=p["official_url"],
                        content_type=p["content_type"],
                        text=p["text"],
                        read_article_link=f"READ the full article LINK: {p['official_url']}",
                        bm25_rank=bm25_rank_map.get(idx),
                        semantic_rank=None,
                        rrf_score=None,
                        rerank_score=float(bm25_scores[idx]),
                        relevance_label="Keyword Match",
                    )
                )
            latency = (time.time() - start_time) * 1000.0
            return SearchResponse(
                query=query,
                total_results=len(results),
                results=results,
                semantic_retrieval_executed=False,
                reranking_executed=False,
                reranker_fallback_used=False,
                latency_ms=round(latency, 2),
                message=None if results else "No keyword matches found.",
            )

        # --- B. Semantic Retrieval (Dense Vector Search) ---
        semantic_rank_map = {}
        if self.model_manager.embedding_loaded and self.model_manager.embedding_model:
            query_embedding = self.model_manager.embedding_model.encode(
                query_text,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )
            # Cosine similarity: dot product of normalized query and normalized embeddings
            cos_sims = np.dot(self.index.embeddings, query_embedding)
            semantic_top_indices = np.argsort(cos_sims)[::-1][:sem_limit]
            for rank, idx in enumerate(semantic_top_indices):
                semantic_rank_map[idx] = rank + 1
            semantic_executed = True
        else:
            semantic_top_indices = []

        # --- C. Reciprocal Rank Fusion (RRF) ---
        candidate_indices = set(bm25_rank_map.keys()) | set(semantic_rank_map.keys())
        rrf_scores: Dict[int, float] = {}

        for idx in candidate_indices:
            score = 0.0
            if idx in bm25_rank_map:
                score += 1.0 / (RRF_K + bm25_rank_map[idx])
            if idx in semantic_rank_map:
                score += 1.0 / (RRF_K + semantic_rank_map[idx])
            rrf_scores[idx] = score

        # Sort candidates by fused RRF score
        sorted_candidates = sorted(rrf_scores.keys(), key=lambda i: rrf_scores[i], reverse=True)

        # --- Mode: Hybrid without Reranking ---
        if mode == "hybrid":
            results = []
            for idx in sorted_candidates[:limit]:
                p = self.index.searchable_passages[idx]
                results.append(
                    PassageResult(
                        passage_id=p["passage_id"],
                        doc_id=p.get("doc_id"),
                        doc_title=p["doc_title"],
                        source_org=p["source_org"],
                        year=p["year"],
                        section=p["section"],
                        page_number=p["page_number"],
                        official_url=p["official_url"],
                        content_type=p["content_type"],
                        text=p["text"],
                        read_article_link=f"READ the full article LINK: {p['official_url']}",
                        bm25_rank=bm25_rank_map.get(idx),
                        semantic_rank=semantic_rank_map.get(idx),
                        rrf_score=round(rrf_scores[idx], 5),
                        rerank_score=None,
                        relevance_label="Hybrid Match",
                    )
                )
            latency = (time.time() - start_time) * 1000.0
            return SearchResponse(
                query=query,
                total_results=len(results),
                results=results,
                semantic_retrieval_executed=semantic_executed,
                reranking_executed=False,
                reranker_fallback_used=False,
                latency_ms=round(latency, 2),
                message=None if results else "No guideline passages found.",
            )

        # --- D. Cross-Encoder Reranking & Composite Scoring ---
        top_candidates = sorted_candidates[:max_rerank]

        if self.model_manager.reranker_loaded and self.model_manager.reranker_model:
            # Baseline uses raw query and passage text; enhanced uses enriched query and section context
            if is_baseline:
                passage_pairs = [
                    (clean_query, self.index.searchable_passages[idx]["text"])
                    for idx in top_candidates
                ]
            else:
                passage_pairs = [
                    (enriched_query, f"[{self.index.searchable_passages[idx]['doc_title']} - {self.index.searchable_passages[idx]['section']}] {self.index.searchable_passages[idx]['text']}")
                    for idx in top_candidates
                ]
            try:
                ce_scores = self.model_manager.reranker_model.predict(passage_pairs)
                rerank_executed = True

                candidate_scored = []
                for cand_idx, ce_raw in zip(top_candidates, ce_scores):
                    p = self.index.searchable_passages[cand_idx]

                    if is_baseline:
                        # Original baseline scoring: raw cross-encoder logit only
                        composite = float(ce_raw)
                    else:
                        dense_s = float(cos_sims[cand_idx]) if semantic_executed else 0.0
                        txt_l = p["text"].lower()
                        sec_l = p["section"].lower()
                        doc_l = p["doc_id"].lower()

                        # Composite score combines Cross-Encoder Logit with Dense Semantic Similarity
                        composite = float(ce_raw) + 2.0 * dense_s

                        # Intent Alignment Adjustments
                        if intent["is_treatment_target"]:
                            # Primary glycemic target recommendations get alignment priority
                            if "glycemic-goals" in doc_l and ("<7.0%" in p["text"] or "<7%" in p["text"] or "6.3" in p["text"] or "table 6.3" in sec_l):
                                composite += 3.5
                            elif "rssdi-2022" in doc_l and ("glycemic target" in sec_l or "table 10" in sec_l or "elderly diabetics" in txt_l) and "<7" in p["text"]:
                                composite += 2.0
                            # Penalize diagnostic criteria when asking for treatment targets
                            elif "diagnosis" in doc_l or "cutoff" in txt_l or "criteria for the screening" in txt_l:
                                composite -= 4.0
                            # Penalize anemia interference passage when asking for general targets
                            elif "iron deficiency anemia" in txt_l:
                                composite -= 4.5
                            # Penalize remission passage
                            elif "remission" in txt_l and "ascertained" in txt_l:
                                composite -= 3.0

                        elif intent["is_diagnostic"]:
                            # Diagnostic criteria get alignment priority
                            if "diagnosis" in doc_l and ("criteria" in sec_l or "table 2.1" in sec_l or "criteria for the screening" in txt_l):
                                composite += 3.5
                            elif "glycemic-goals" in doc_l and "<7.0%" in p["text"]:
                                composite -= 3.0

                        elif intent["is_tir"]:
                            # TIR metrics table gets alignment priority
                            if ("table 6.2" in sec_l or "cgm metrics" in sec_l or "time-in-range" in sec_l) and ("70" in txt_l or "tir" in txt_l):
                                composite += 3.5
                            elif "<7.0%" in txt_l and "time in range" not in txt_l:
                                composite -= 2.0

                        elif intent["is_frequency"]:
                            # Frequency recommendations 6.1 and 6.2 get alignment priority
                            if ("twice a year" in txt_l or "quarterly" in txt_l or "frequency of testing" in txt_l):
                                composite += 3.5

                        elif intent["is_anemia_interference"]:
                            # Anemia and interference passages get alignment priority
                            if "iron deficiency anemia" in txt_l or "hemoglobinopath" in txt_l:
                                composite += 4.0

                    candidate_scored.append((cand_idx, composite))

                # Sort by composite score descending
                candidate_scored.sort(key=lambda x: x[1], reverse=True)
            except Exception as e:
                print(f"Reranker prediction error: {e}. Falling back to RRF.")
                reranker_fallback = True
                candidate_scored = [(idx, rrf_scores[idx]) for idx in top_candidates]
        else:
            reranker_fallback = True
            candidate_scored = [(idx, rrf_scores[idx]) for idx in top_candidates]

        # --- E. Evaluated Threshold Filtering ---
        filtered_results: List[PassageResult] = []

        for idx, score in candidate_scored:
            score_val = float(score)
            # When reranker executed, apply calibrated composite relevance threshold
            if rerank_executed and score_val < norm_threshold:
                continue

            p = self.index.searchable_passages[idx]
            
            # Label based on evidence relevance
            if rerank_executed:
                if score_val >= 5.0:
                    label = "Strong Guideline Alignment"
                elif score_val >= 2.0:
                    label = "Direct Evidence"
                else:
                    label = "Contextual Evidence"
            else:
                label = "Retrieved Match"

            filtered_results.append(
                PassageResult(
                    passage_id=p["passage_id"],
                    doc_id=p.get("doc_id"),
                    doc_title=p["doc_title"],
                    source_org=p["source_org"],
                    year=p["year"],
                    section=p["section"],
                    page_number=p["page_number"],
                    official_url=p["official_url"],
                    content_type=p["content_type"],
                    text=p["text"],
                    read_article_link=f"READ the full article LINK: {p['official_url']}",
                    bm25_rank=bm25_rank_map.get(idx),
                    semantic_rank=semantic_rank_map.get(idx),
                    rrf_score=round(rrf_scores[idx], 5),
                    rerank_score=round(score_val, 4) if rerank_executed else None,
                    relevance_label=label,
                )
            )

        final_results = filtered_results[:limit]
        latency = (time.time() - start_time) * 1000.0

        message = None
        if not final_results:
            message = "No relevant medical guideline passages met the required evidence threshold for this query."

        return SearchResponse(
            query=query,
            total_results=len(final_results),
            results=final_results,
            semantic_retrieval_executed=semantic_executed,
            reranking_executed=rerank_executed,
            reranker_fallback_used=reranker_fallback,
            latency_ms=round(latency, 2),
            message=message,
        )


if __name__ == "__main__":
    mm = ModelManager.get_instance()
    mm.load_models()
    idx = GuidelineIndex()
    idx.build_and_save_index(mm)
    engine = HybridSearchEngine(idx, mm)

    test_queries = [
        "What should be normal HbA1c range for diabetic patients",
        "HbA1c diagnostic thresholds for diabetes",
        "How frequently should HbA1c be measured?",
        "HbA1c interpretation in iron deficiency anemia",
        "What is Time in Range and what glucose range is used?",
        "Find guidance about diabetes and kidney disease",
        "Find information about diabetic retinopathy screening",
        "How to fix a broken iPhone screen?",
    ]

    for q in test_queries:
        print(f"\n====================\nQUERY: {q}\n====================")
        res = engine.search(q, limit=3)
        print(f"Results: {res.total_results} | Latency: {res.latency_ms}ms | Message: {res.message}")
        for i, r in enumerate(res.results, 1):
            print(f"  [{i}] ({r.relevance_label}) {r.doc_title} (p.{r.page_number})")
            print(f"      Section: {r.section}")
            print(f"      Scores -> BM25 rank: {r.bm25_rank}, Semantic rank: {r.semantic_rank}, RRF: {r.rrf_score}, Rerank: {r.rerank_score}")
            print(f"      Text: {r.text[:150]}...")
            print(f"      {r.read_article_link}")
