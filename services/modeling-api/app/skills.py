"""Validated immutable runtime Skill publishing for the modeling preset."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import yaml

from .config import ServiceConfig
from .contracts import ModelingContractError
from .database import ModelingStore


SKILL_NAMES = ("data-analysis", "data-cleaning", "feature-engineering", "model-training", "model-evaluation")
ALLOWED_TOOLS = frozenset({
    "modeling_get_dataset_profile", "modeling_propose_plan",
    "modeling_get_run_status", "modeling_get_run_result",
})
TOOL_CATALOG = {
    "modeling_get_dataset_profile": "Read a bounded aggregate profile for one Session-owned dataset.",
    "modeling_propose_plan": "Validate and persist a proposal without approving or starting a Run.",
    "modeling_get_run_status": "Read bounded status and node events for one Session-owned Run.",
    "modeling_get_run_result": "Read structured results and completed artifacts for one succeeded Run.",
}
EXTENSION_FILES = {
    "contract": "contract.json",
    "input_schema": "input.schema.json",
    "output_schema": "output.schema.json",
    "tools": "tools.json",
}
UNSUPPORTED_TERMS = {
    "xgboost": "XGBoost is not supported by the deterministic executor.",
    "random forest": "Random forest is not supported by the deterministic executor.",
    "shap": "SHAP is not supported by the deterministic executor.",
}
FORBIDDEN = {
    "approve-and-run": "Skill content cannot grant approval or execution authority.",
    "modeling_approve_and_run": "Skill content cannot expose an approval tool.",
}
EXECUTION_TERMS = ("shell", "python", "sql", "http://", "https://", "curl ", "wget ", "arbitrary network", "host filesystem")
NEGATIONS = ("cannot", "must not", "do not", "never", "forbid", "禁止", "不得", "不能", "不可")


def digest(content: str) -> str:
    """Return the lowercase SHA-256 digest for exact UTF-8 Skill content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _read_json(path: Path) -> dict[str, Any] | None:
    """Read one optional Modeling Skill extension object."""
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Skill extension must contain a JSON object: {path}")
    return value


def parse_skill(content: str, expected_name: str, max_bytes: int) -> tuple[dict[str, Any], list[str], list[str]]:
    """Parse and validate one bounded Skill document without granting capabilities."""
    errors: list[str] = []
    warnings: list[str] = []
    if len(content.encode("utf-8")) > max_bytes:
        errors.append(f"Markdown exceeds the {max_bytes}-byte limit.")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", content, re.DOTALL)
    metadata: dict[str, Any] = {}
    if match is None:
        errors.append("YAML frontmatter is required.")
    else:
        try:
            parsed = yaml.safe_load(match.group(1))
            if not isinstance(parsed, dict):
                errors.append("YAML frontmatter must be a mapping.")
            else:
                metadata = parsed
        except yaml.YAMLError as error:
            errors.append(f"YAML frontmatter is invalid: {error.problem or 'parse error'}.")
    if metadata.get("name") != expected_name:
        errors.append(f"frontmatter name must be {expected_name}.")
    if not isinstance(metadata.get("description"), str) or not metadata["description"].strip():
        errors.append("frontmatter description must be non-empty.")
    lower = content.lower()
    for term, message in FORBIDDEN.items():
        if term in lower:
            errors.append(message)
    for line in content.splitlines():
        lowered = line.lower()
        if any(term in lowered for term in EXECUTION_TERMS) and not any(term in lowered for term in NEGATIONS):
            errors.append(f"Forbidden execution or access request: {line.strip()[:120]}")
    mentioned_tools = set(re.findall(r"\bmodeling_[a-z0-9_]+\b", content))
    unknown_tools = sorted(mentioned_tools - ALLOWED_TOOLS)
    if unknown_tools:
        errors.append(f"Unknown modeling tools: {', '.join(unknown_tools)}.")
    for term, message in UNSUPPORTED_TERMS.items():
        if term in lower:
            warnings.append(message)
    return metadata, sorted(set(errors)), sorted(set(warnings))


def versioned_content(content: str, version: str) -> str:
    """Return content with the immutable published version written to metadata.version."""
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(\n|\Z)", content, re.DOTALL)
    if match is None:
        return content
    metadata = yaml.safe_load(match.group(1))
    if not isinstance(metadata, dict):
        return content
    nested = metadata.get("metadata")
    if not isinstance(nested, dict):
        nested = {}
        metadata["metadata"] = nested
    nested["version"] = version
    frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).rstrip()
    body = content[match.end():]
    return f"---\n{frontmatter}\n---\n\n{body.lstrip()}"


class SkillService:
    """Own the five configured files and coordinate Draft and Published records."""

    def __init__(self, config: ServiceConfig, store: ModelingStore) -> None:
        self.config = config
        self.store = store

    def initialize(self) -> None:
        """Seed immutable v1 records from the configured runtime directory."""
        assert self.config.runtime_skill_dir is not None
        for name in SKILL_NAMES:
            path = self.config.runtime_skill_dir / name / "SKILL.md"
            if not path.is_file():
                raise RuntimeError(f"runtime Skill file is missing: {path}")
            content = path.read_text(encoding="utf-8")
            metadata, errors, _warnings = parse_skill(content, name, self.config.max_skill_bytes)
            if errors:
                raise RuntimeError(f"runtime Skill {name} is invalid: {'; '.join(errors)}")
            nested = metadata.get("metadata")
            version = nested.get("version") if isinstance(nested, dict) else None
            if not isinstance(version, str) or not version:
                raise RuntimeError(f"runtime Skill {name} lacks metadata.version")
            self.store.seed_skill(name, str(metadata["description"]), version, content, digest(content))

    def require_name(self, name: str) -> None:
        """Reject names outside the fixed runtime set."""
        if name not in SKILL_NAMES:
            raise ModelingContractError("SKILL_NOT_FOUND", "Skill not found.")

    def detail(self, name: str, session_id: str) -> dict[str, Any]:
        """Return existing Skill state plus optional read-only Demo extension metadata."""
        self.require_name(name)
        value = self.store.get_skill(name, session_id)
        if value is None:
            raise ModelingContractError("SKILL_NOT_FOUND", "Skill not found.")
        assert self.config.runtime_skill_dir is not None
        root = self.config.runtime_skill_dir / name
        extension = {key: _read_json(root / relative) for key, relative in EXTENSION_FILES.items()}
        policy = extension["tools"]
        required = policy.get("required", []) if isinstance(policy, dict) else []
        optional = policy.get("optional", []) if isinstance(policy, dict) else []
        declared = {
            item.get("name") for entries in (required, optional) if isinstance(entries, list)
            for item in entries if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        required_missing = sorted(
            item["name"] for item in required
            if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"] not in ALLOWED_TOOLS
        ) if isinstance(required, list) else []
        checks = [
            {"id": "instructions", "label": "SKILL.md", "status": "pass", "message": "Harness instructions loaded."},
            *({"id": key, "label": relative, "status": "pass" if extension[key] is not None else "not_configured",
               "message": "Configured." if extension[key] is not None else "Not configured."}
              for key, relative in EXTENSION_FILES.items()),
            {"id": "tool-availability", "label": "Tool availability", "status": "fail" if required_missing else "pass",
             "message": f"Missing required tools: {', '.join(required_missing)}" if required_missing else "All required tools are available."},
        ]
        return {
            **value,
            "extension": {
                **extension,
                "tool_catalog": [
                    {"name": tool, "description": description, "available": True, "declared": tool in declared}
                    for tool, description in TOOL_CATALOG.items()
                ],
                "checks": checks,
                "scope": "governance_only",
            },
        }

    def validate(self, name: str, session_id: str) -> dict[str, Any]:
        """Validate the current Session Draft without publishing it."""
        self.require_name(name)
        draft = self.store.get_skill_draft(name, session_id)
        if draft is None:
            raise ModelingContractError("SKILL_DRAFT_NOT_FOUND", "Skill Draft not found.")
        _metadata, errors, warnings = parse_skill(draft["content"], name, self.config.max_skill_bytes)
        result = {"valid": not errors, "errors": errors, "warnings": warnings, "draft_hash": draft["hash"]}
        self.store.set_skill_validation(name, session_id, result)
        return result

    def publish(self, name: str, session_id: str) -> dict[str, Any]:
        """Publish a validated Draft as a new immutable version and replace the active file atomically."""
        result = self.validate(name, session_id)
        if not result["valid"]:
            raise ModelingContractError("SKILL_VALIDATION_FAILED", "Skill Draft validation failed.", details=result)
        draft = self.store.get_skill_draft(name, session_id)
        assert draft is not None
        version = self.store.next_skill_version(name)
        content = versioned_content(draft["content"], version)
        metadata, errors, warnings = parse_skill(content, name, self.config.max_skill_bytes)
        if errors:
            raise ModelingContractError("SKILL_VALIDATION_FAILED", "Versioned Skill validation failed.", details={"errors": errors, "warnings": warnings})
        sha256 = digest(content)
        assert self.config.runtime_skill_dir is not None
        path = self.config.runtime_skill_dir / name / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".SKILL.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            self.store.publish_skill(name, session_id, version, content, sha256, str(metadata["description"]))
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return self.detail(name, session_id)
