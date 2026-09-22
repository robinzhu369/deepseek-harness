# Five-Minute Demo Script

English | [中文](demo-script.zh.md)

Opening: "This is a conversational data modeling demo. The model handles planning, Python performs the actual computation, and key execution steps require user confirmation."

Minute 1: Create a new session, upload synthetic CSV files with fixed seeds, display data overview and preview, and identify target columns.

Minute 2: Enter the command "Analyze this dataset, create plans for cleaning, feature engineering, and binary classification modeling; let me confirm first." Display tool execution results and plan cards; modify an excluded field or encoding limit.

Minute 3: Click Confirm to display actual execution nodes on the right side. Explain that preprocessing is fitted only on the training set. Switch "context" during this time to view bound data/plan versions.

Minute 4: Review actual metrics and warnings, download prepared data and reports. High or low metric values are not criteria for demo success.

Minute 5: Modify model parameters to create a new run, demonstrating that previous results are preserved; or open the Skill Center to show draft/published versions. When displaying failure/cancellation screenshots, explicitly state these are verified scenarios and do not fake current runs.

Pre-Demo Verification: Model connectivity, installed dependencies, synthetic files, disk space, service status, browser zoom at 100%, no sensitive logs/keys in display. The demo page does not default to showing fabricated history.

Fallback Mode: If the LLM is unavailable, explicitly switch to "Manual Configuration," demonstrate the computation pipeline, but inform that Agent planning was not executed live during this session; prohibit unmarked replays.
