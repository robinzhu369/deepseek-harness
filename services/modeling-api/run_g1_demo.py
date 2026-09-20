"""Generate the bounded synthetic dataset and execute the T03 pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.pipeline import generate_synthetic_csv, run_pipeline


def main() -> int:
    """Run G1 into a new output root and print the machine-readable summary."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--rows", type=int, default=1200)
    parser.add_argument("--seed", type=int, default=20260920)
    args = parser.parse_args()
    if args.output_root.exists():
        parser.error(f"output root already exists: {args.output_root}")
    args.output_root.mkdir(parents=True)
    csv_path = args.output_root / "synthetic_binary.csv"
    generated = generate_synthetic_csv(csv_path, rows=args.rows, seed=args.seed)
    plan_path = REPO_ROOT / "docs/modeling-demo/contracts/examples/valid-classification-plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    plan["dataset_id"] = "ds_synthetic_g1"
    plan["dataset_sha256"] = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    plan["split"]["seed"] = args.seed
    plan["assumptions"] = {"samples_independent": True}
    result = run_pipeline(csv_path, plan, args.output_root / "run")
    summary = {
        "dataset": str(csv_path.resolve()),
        **generated,
        "split_counts": result.split_counts,
        "metrics": result.metrics,
        "pipeline": str((result.output_dir / "pipeline.joblib").resolve()),
        "metrics_path": str((result.output_dir / "metrics.json").resolve()),
        "manifest_path": str((result.output_dir / "manifest.json").resolve()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
