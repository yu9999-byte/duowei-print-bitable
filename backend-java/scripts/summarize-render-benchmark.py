"""Report local serial rendering samples without inventing release thresholds."""
import json
import statistics
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
summary = {"scope": "Local serial render calls, including browser launch/page load/export/close. Excludes HTTP signing, queues, database and Feishu. Five samples per format do not establish stability or production percentiles.", "formats": {}}
for kind in ("pdf", "png"):
    values = {}
    for implementation in ("original", "java"):
        records = json.loads((root / (implementation + "-timings.json")).read_text(encoding="utf-8"))
        samples = [item["elapsedMs"] for item in records if item["type"] == kind]
        assert len(samples) == 5 and all(item > 0 for item in samples)
        selected = [item for item in records if item["type"] == kind]
        values[implementation] = {"samplesMs": samples, "firstMs": samples[0], "medianMs": statistics.median(samples), "minMs": min(samples), "maxMs": max(samples)}
        if all("driverLaunchMs" in item for item in selected):
            values[implementation]["driverLaunchMedianMs"] = statistics.median(item["driverLaunchMs"] for item in selected)
            values[implementation]["afterLaunchMedianMs"] = statistics.median(item["elapsedMs"] - item["driverLaunchMs"] for item in selected)
    values["javaToOriginalMedianRatio"] = values["java"]["medianMs"] / values["original"]["medianMs"]
    summary["formats"][kind] = values
(root / "benchmark-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary, indent=2))
