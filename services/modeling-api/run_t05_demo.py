"""Exercise the T04/T05 HTTP lifecycle with an independent pipeline worker."""

from __future__ import annotations

import argparse
import io
import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import ServiceConfig, create_app
from app.pipeline import generate_synthetic_csv


def wait_for(client: TestClient, path: str, session: dict[str, str], key: str, terminal: set[str]) -> dict[str, object]:
    """Poll one persisted resource until it reaches a requested terminal value."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        response = client.get(path, headers=session)
        response.raise_for_status()
        value = response.json()
        if value[key] in terminal:
            return value
        time.sleep(0.05)
    raise TimeoutError(f"{path} did not reach {terminal}")


def main() -> int:
    """Generate data, upload it, approve a plan, and record completed artifacts."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--rows", type=int, default=1200)
    parser.add_argument("--seed", type=int, default=20260920)
    args = parser.parse_args()
    if args.output_root.exists():
        raise FileExistsError(f"refusing to overwrite {args.output_root}")
    args.output_root.mkdir(parents=True)
    source = args.output_root / "synthetic-source.csv"
    generated = generate_synthetic_csv(source, rows=args.rows, seed=args.seed)
    session = {"X-Session-Id": "t05_demo_session"}
    app = create_app(ServiceConfig(root=args.output_root / "service", worker_timeout_seconds=30))
    plan_path = Path(__file__).resolve().parents[2] / "docs/modeling-demo/contracts/examples/valid-classification-plan.json"
    with TestClient(app) as client:
        uploaded = client.post(
            "/v1/datasets",
            headers=session,
            files={"file": ("synthetic.csv", io.BytesIO(source.read_bytes()), "text/csv")},
        )
        uploaded.raise_for_status()
        dataset_id = uploaded.json()["dataset_id"]
        dataset = wait_for(client, f"/v1/datasets/{dataset_id}", session, "state", {"ready", "error"})
        if dataset["state"] != "ready":
            raise RuntimeError(json.dumps(dataset, ensure_ascii=False))
        profile = client.get(f"/v1/datasets/{dataset_id}/profile", headers=session).json()
        plan_payload = json.loads(plan_path.read_text(encoding="utf-8"))
        plan_payload["dataset_id"] = dataset_id
        plan_payload["dataset_sha256"] = dataset["sha256"]
        plan_payload["assumptions"] = {"samples_independent": True}
        plan_response = client.post("/v1/plans", headers=session, json=plan_payload)
        plan_response.raise_for_status()
        plan = plan_response.json()
        approval = client.post(
            f"/v1/plans/{plan['id']}/approve-and-run",
            headers={**session, "Idempotency-Key": "t05-demo-v1"},
            json={"revision": plan["revision"], "plan_hash": plan["plan_hash"]},
        )
        approval.raise_for_status()
        run_id = approval.json()["run_id"]
        run = wait_for(client, f"/v1/runs/{run_id}", session, "status", {"succeeded", "failed"})
        if run["status"] != "succeeded":
            raise RuntimeError(json.dumps(run, ensure_ascii=False))
        result = client.get(f"/v1/runs/{run_id}/result", headers=session).json()
    summary = {
        "mode": "live_local_compute",
        "seed": args.seed,
        "source": generated,
        "dataset": {
            "id": dataset_id,
            "sha256": dataset["sha256"],
            "row_count": profile["row_count"],
            "column_count": profile["column_count"],
        },
        "plan": {"id": plan["id"], "revision": plan["revision"], "plan_hash": plan["plan_hash"]},
        "run": {"id": run_id, "status": run["status"], "revision": run["revision"], "nodes": run["nodes"]},
        "metrics": result["metrics"],
        "manifest_path": str((args.output_root / "service" / "runs" / run_id / "manifest.json").resolve()),
        "metrics_path": str((args.output_root / "service" / "runs" / run_id / "metrics.json").resolve()),
        "model_path": str((args.output_root / "service" / "runs" / run_id / "pipeline.joblib").resolve()),
        "artifact_count": len(result["artifacts"]),
    }
    summary_path = args.output_root / "t05-summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
