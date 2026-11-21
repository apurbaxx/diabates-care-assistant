import os
import sys
from urllib.parse import urlparse

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ingestion import DOC_REGISTRY


@pytest.mark.parametrize(
    "document",
    [doc for doc in DOC_REGISTRY.values() if doc["doc_id"].startswith("rssdi-")],
    ids=lambda doc: doc["doc_id"],
)
def test_rssdi_sources_use_rssdi_urls(document):
    url = urlparse(document["official_url"])
    assert url.scheme == "https"
    assert url.hostname in {"rssdi.in", "www.rssdi.in"}, (
        f"{document['doc_id']} must link to RSSDI, got {document['official_url']}"
    )
