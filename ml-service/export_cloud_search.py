"""Prepare a standalone Cloud Run repository from the shared local sources."""
from pathlib import Path
from shutil import copy2


if __name__ == "__main__":
    source = Path(__file__).resolve().parent
    destination = source.parent / "cloud-search-export"
    for relative in (
        "Dockerfile", ".dockerignore", ".gitattributes", "requirements-cloud.txt",
        "app/retrieval.py", "app/schemas.py", "app/cloud_search.py",
        "data/passages.json", "data/embeddings.npy", "data/index_metadata.json",
    ):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        copy2(source / relative, target)
    print(f"Standalone Cloud Run source prepared at: {destination}")
    print("Upload these files, preserving app/ and data/ folders, to your separate GitHub repository.")
