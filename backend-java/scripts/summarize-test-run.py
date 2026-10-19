"""Summarize current-run Surefire reports only; never infer acceptance from test totals."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("run_directory")
parser.add_argument("reports_directory")
args = parser.parse_args()
run = Path(args.run_directory).resolve()
start = (run / "maven.log").stat().st_ctime
reports = []
for file in sorted(Path(args.reports_directory).glob("TEST-*.xml")):
    if file.stat().st_mtime < start:
        continue
    suite = ET.parse(file).getroot()
    reports.append({"class": suite.attrib["name"], **{key: int(suite.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}, "problems": [{"case": case.attrib.get("name"), "type": child.tag, "message": child.attrib.get("message", "")[:1000]} for case in suite.findall("testcase") for child in case if child.tag in ("failure", "error", "skipped")]})
if not reports:
    raise SystemExit("No reports attributable to this run")
result = {"run": str(run), "scope": "Reports modified after Maven log creation; inspect Maven completion for missing suites. Test success does not imply goal acceptance.", "totals": {key: sum(item[key] for item in reports) for key in ("tests", "failures", "errors", "skipped")}, "suites": reports}
(run / "test-summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result["totals"]))
for item in reports:
    if item["problems"]:
        print(item["class"], json.dumps(item["problems"], ensure_ascii=False))
