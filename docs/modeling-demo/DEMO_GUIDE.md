# Harness Modeling Workbench 8–10 Minute Demo Guide

English | [中文](DEMO_GUIDE.zh.md)

## 1. Start Environment (~1 minute)

**Action:** Run `scripts/modeling-demo-up.sh` and `scripts/modeling-demo-health.sh` from the repository root. Open the full address output by the startup scripts for **Harness Web**, retaining the `?token=...` query parameter. **Expected Result:** API returns 200; web access is 401 before authentication but PID remains alive; opening with the token displays "智模工作台" (Modeling Workbench). **Troubleshooting:** If failed, check `.env`, DeepSeek credentials, and `${MODELING_DEMO_ROOT}/logs/`.

## 2. Upload Demo Dataset (~30 seconds)

**Action:** Create a new Session and upload supported synthetic CSV to the data center. **Expected Result:** Status transitions `uploaded → profiling → ready` with limited preview displayed. **Troubleshooting:** If failed, check CSV UTF-8 encoding, headers, duplicate columns, upload limits, and ensure consistency of the Session ID.

## 3. Input Precise Prompt (~1 minute)

**Action:** Paste: `Please analyze dataset <dataset_id> and generate a binary classification modeling scheme for label. Sequentially load data-analysis, data-cleaning, feature-engineering, model-training; propose only without auto-execution; explicitly exclude fields handling, missing value processing, category encoding, 60/20/20 split, and logistic regression; wait until I confirm and complete execution before loading model-evaluation to interpret metrics, confusion matrix, and thresholds based on real results.` **Expected Result:** In the planning phase, load the first four Skills and call `modeling_get_dataset_profile` and `modeling_propose_plan`; upon successful run, load model-evaluation and call `modeling_get_run_result`. **Troubleshooting:** If failed, check Provider, credentials, Dataset Session ownership, and Profile status.

## 4. View Profile & Proposed Plan (~1 minute)

**Action:** Switch to the Modeling Workbench. **Expected Result:** Display real sample/column counts, missing summary, computation scope, plan revision/hash, `proposed` state with pending confirmation; no Run exists yet. **Troubleshooting:** If failed, click refresh and check the Modeling API.

## 5. Modify One Parameter (~30 seconds)

**Action:** Click "Modify Plan", change logistic regression `C` from 1 to 0.5, and save as a new revision. **Expected Result:** Revision/hash changes; page lists Train → Evaluate → Result as invalid (current implementation notes full recalculation will occur). **Troubleshooting:** If failed, check for revision conflicts and retry after refresh.

## 6. Confirm Manually & Observe Timeline (~1 minute)

**Action:** Click "Confirm and Execute". **Expected Result:** Only then is a Run created; status progresses through `queued/running/succeeded` with node events from real workers. **Troubleshooting:** If failed, check single concurrency limits, timeouts, worker logs, and ensure the Plan remains in `proposed` state if applicable.

## 7. View Results (~1 minute)

**Action:** Inspect ROC-AUC, AP, F1, threshold, confusion matrix, and sample counts; let the Agent sequentially call run status/result to explain. **Expected Result:** The Agent distinguishes ranking ability from classification performance at a 0.5 threshold without embellishing `F1=0`. **Troubleshooting:** If failed, confirm the Run has succeeded.

## 8. Download Artifact (~30 seconds)

**Action:** Download `metrics.json` or model artifacts via Artifact ID. **Expected Result:** Only download completed artifacts; downloaded file SHA-256 matches manifest. **Troubleshooting:** If failed, verify artifact belongs to the current Session and that client paths are valid download parameters.

## 9. Modify Model Parameters & Rerun (~1 minute)

**Action:** Select "Adjust Plan and Re-run", change `C` to 1.5, save, and manually confirm again. **Expected Result:** Creates a new revision with an independent Run; old Run is preserved; `rerun_of` points to the previous Run. **Troubleshooting:** If failed, check idempotency keys, revisions, and current Run status.

## 10. Run History & Skill Center (~1 minute)

**Action:** Open run records and the skill center. **Expected Result:** History page shows both succeeded Runs; skill center displays only five modeling skills with their release versions; "Skill Self-Check" differs in meaning from model evaluation skills. **Troubleshooting:** If failed, confirm you are still within the same Session and click refresh.
