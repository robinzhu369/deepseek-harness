from __future__ import annotations

import io
import asyncio
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import ServiceConfig, create_app
from app.database import ModelingStore
from app.datasets import DatasetService


SESSION = {"X-Session-Id": "session_upload"}


def wait_for_dataset(client: TestClient, dataset_id: str, terminal: set[str] = {"ready", "error"}) -> dict[str, object]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/v1/datasets/{dataset_id}", headers=SESSION)
        assert response.status_code == 200
        payload = response.json()
        if payload["state"] in terminal:
            return payload
        time.sleep(0.01)
    raise AssertionError(f"dataset {dataset_id} did not reach {terminal}")


def csv_bytes(rows: int = 40) -> bytes:
    lines = ["record_id,age,region,label"]
    for index in range(rows):
        age = "" if index % 11 == 0 else str(20 + index)
        lines.append(f"rec_{index:03d},{age},{'north' if index % 2 else 'south'},{index % 2}")
    return ("\n".join(lines) + "\n").encode()


def test_streaming_upload_profiles_and_bounds_preview(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path, upload_chunk_bytes=17, preview_limit=20))
    with TestClient(app) as client:
        response = client.post(
            "/v1/datasets",
            headers=SESSION,
            files={"file": ("../../untrusted.exe", io.BytesIO(csv_bytes()), "application/x-msdownload")},
        )
        assert response.status_code == 202
        uploaded = response.json()
        assert uploaded["dataset_id"].startswith("ds_")
        assert uploaded["profile_run_id"].startswith("profile_")
        dataset = wait_for_dataset(client, uploaded["dataset_id"])
        assert dataset["state"] == "ready"
        assert dataset["original_name"] == "untrusted.exe"
        profile = client.get(f"/v1/datasets/{uploaded['dataset_id']}/profile", headers=SESSION).json()
        assert profile["dataset_id"] == uploaded["dataset_id"]
        assert profile["dataset_sha256"] == uploaded["sha256"]
        assert profile["row_count"] == 40
        assert profile["column_count"] == 4
        assert profile["computation_scope"] == {"kind": "full_dataset", "rows_scanned": 40, "preview_rows": 20}
        assert len(profile["preview"]) == 20
        assert profile["columns"][1]["missing_ratio"] > 0
        preview = client.get(f"/v1/datasets/{uploaded['dataset_id']}/preview?limit=3", headers=SESSION)
        assert preview.status_code == 200
        assert len(preview.json()["rows"]) == 3
        assert client.get(f"/v1/datasets/{uploaded['dataset_id']}/preview?limit=21", headers=SESSION).status_code == 422
        listing = client.get("/v1/datasets", headers=SESSION).json()
        assert [item["id"] for item in listing["items"]] == [uploaded["dataset_id"]]


def test_upload_is_content_stable_and_never_overwrites_raw_data(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path, upload_chunk_bytes=11))
    content = csv_bytes()
    with TestClient(app) as client:
        first = client.post("/v1/datasets", headers=SESSION, files={"file": ("first.csv", io.BytesIO(content), "text/csv")})
        second = client.post("/v1/datasets", headers=SESSION, files={"file": ("second.csv", io.BytesIO(content), "text/plain")})
        assert first.status_code == second.status_code == 202
        assert first.json()["dataset_id"] == second.json()["dataset_id"]
        dataset = wait_for_dataset(client, first.json()["dataset_id"])
        raw = tmp_path / dataset["storage_key"]
        assert raw.read_bytes() == content
        assert dataset["original_name"] == "first.csv"


def test_rejects_invalid_csv_inputs_with_specific_codes(tmp_path: Path) -> None:
    cases = {
        "empty.csv": (b"", "EMPTY_FILE"),
        "no-header.csv": (b"1,2\n3,4\n", "MISSING_HEADER"),
        "duplicate.csv": (b"a,a\n1,2\n", "DUPLICATE_COLUMN"),
        "encoding.csv": (b"a,b\n\xff,2\n", "INVALID_ENCODING"),
        "malformed.csv": (b"a,b\n1,2,3\n", "INVALID_CSV"),
    }
    app = create_app(ServiceConfig(root=tmp_path, upload_chunk_bytes=7))
    with TestClient(app) as client:
        for name, (content, code) in cases.items():
            response = client.post("/v1/datasets", headers=SESSION, files={"file": (name, io.BytesIO(content), "text/csv")})
            assert response.status_code == 422, response.text
            assert response.json()["error"]["code"] == code


def test_dataset_access_is_scoped_to_session(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path))
    with TestClient(app) as client:
        response = client.post("/v1/datasets", headers=SESSION, files={"file": ("data.csv", io.BytesIO(csv_bytes()), "text/csv")})
        dataset_id = response.json()["dataset_id"]
        assert client.get(f"/v1/datasets/{dataset_id}", headers={"X-Session-Id": "other"}).status_code == 404


def test_upload_reader_is_always_called_with_a_bounded_size(tmp_path: Path) -> None:
    class TrackingUpload:
        filename = "tracked.csv"

        def __init__(self, content: bytes) -> None:
            self.stream = io.BytesIO(content)
            self.requested_sizes: list[int] = []

        async def read(self, size: int = -1) -> bytes:
            self.requested_sizes.append(size)
            return self.stream.read(size)

    config = ServiceConfig(root=tmp_path, upload_chunk_bytes=13)
    store = ModelingStore(config.database_path)
    store.initialize()
    service = DatasetService(config, store)
    upload = TrackingUpload(csv_bytes())
    try:
        dataset = asyncio.run(service.ingest("bounded_session", upload))
    finally:
        service.shutdown()
    assert dataset["id"].startswith("ds_")
    assert upload.requested_sizes
    assert set(upload.requested_sizes) == {13}
