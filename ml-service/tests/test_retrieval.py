import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.retrieval import ModelManager, GuidelineIndex, HybridSearchEngine


@pytest.fixture(scope="module")
def search_engine():
    mm = ModelManager.get_instance()
    mm.load_models()
    idx = GuidelineIndex()
    idx.load_index()
    return HybridSearchEngine(idx, mm)


def test_index_is_loaded(search_engine):
    assert search_engine.index.is_ready is True
    assert len(search_engine.index.searchable_passages) > 2000
    assert search_engine.index.embeddings.shape[0] == len(search_engine.index.searchable_passages)
    assert search_engine.index.embeddings.shape[1] == 384


def test_search_hba1c(search_engine):
    response = search_engine.search("How frequently should HbA1c be measured?", limit=5)
    assert response.total_results > 0
    assert response.semantic_retrieval_executed is True
    assert response.reranking_executed is True
    top_result = response.results[0]
    assert top_result.passage_id != ""
    assert top_result.official_url.startswith("http")
    assert "READ the full article LINK:" in top_result.read_article_link
    assert top_result.rerank_score is not None
    assert top_result.page_number > 0


def test_search_time_in_range(search_engine):
    response = search_engine.search("What is Time in Range?", limit=3)
    assert response.total_results > 0
    top = response.results[0]
    assert "time in range" in top.text.lower() or "tir" in top.text.lower() or "cgm" in top.text.lower()


def test_search_negative_query_filtered(search_engine):
    response = search_engine.search("How to fix a broken iPhone screen?", limit=5)
    # Reranker threshold must filter out non-medical queries
    assert response.total_results == 0
    assert response.message is not None
    assert "No relevant medical guideline passages" in response.message


def test_search_hba1c_target_ranking(search_engine):
    """Verify that clinical treatment targets rank above anemia and remission confounders."""
    response = search_engine.search("What should be normal HbA1c range for diabetic patients", limit=5)
    assert response.total_results >= 3
    top_p = response.results[0]
    
    # Gold recommendation (ADA Rec 6.3a: <7% goal) must rank #1
    assert "6.3" in top_p.text or "<7%" in top_p.text or "<7.0%" in top_p.text
    assert "iron deficiency anemia" not in top_p.text.lower()
    assert "remission" not in top_p.text.lower()

    # Verify none of the top 3 are iron deficiency anemia
    top_3_ids = [r.passage_id for r in response.results[:3]]
    assert "rssdi-2022-t2d-management-p59-524" not in top_3_ids
    assert "rssdi-2022-t2d-management-p9-074" not in top_3_ids


def test_search_diagnostic_vs_treatment_target(search_engine):
    """Verify diagnostic criteria query retrieves >=6.5% and not treatment target <7.0%."""
    response = search_engine.search("What is the HbA1c diagnostic criteria and threshold for diabetes?", limit=5)
    assert response.total_results >= 1
    top_p = response.results[0]
    
    # Must retrieve diagnostic criteria (Table 2.1 or 6.5%)
    assert "2.1" in top_p.section or "6.5%" in top_p.text or "diagnosis" in top_p.doc_title.lower()
    assert "<7.0%" not in top_p.text
