"""Check deployment pins against the public package indexes (no installation)."""
import concurrent.futures
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


def check(spec):
    name, version = spec.split("==")
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=30) as response:
        data = json.load(response)
    public_version = version.split("+")[0]
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{public_version}/json", timeout=30) as response:
        release = json.load(response)
    return {"package": name, "pinned": version,
            "pin_available": bool(data.get("releases", {}).get(public_version)), "latest": data["info"]["version"],
            "requires_python": release["info"].get("requires_python")}


if __name__ == "__main__":
    specs = [line for line in Path("ml-service/requirements-cloud.txt").read_text().splitlines() if "==" in line]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(check, specs))
    print(json.dumps(results, indent=2))
    with urllib.request.urlopen("https://download.pytorch.org/whl/cpu/torch/", timeout=30) as response:
        page = urllib.parse.unquote(response.read().decode())
    versions = set(re.findall(r"torch-([^\s<>\"]+?)-cp312-cp312-(?:manylinux[^\s<>\"]*?x86_64|linux_x86_64)\.whl", page))
    print("Available Linux CPython 3.12 CPU wheel versions:", sorted(versions))
