
import json
import sys
from importlib.metadata import version
from types import SimpleNamespace
from mcp.types import Tool
from mcp_interviewer.constraints import (
    OpenAIToolCountConstraint, OpenAIToolNameLengthConstraint,
    OpenAIToolNamePatternConstraint, ToolInputSchemaFlatnessConstraint,
)

catalog = json.load(sys.stdin)
tools = [Tool.model_validate(tool) for tool in catalog["tools"]]
violations = []
def add(violation, tool=None):
    violations.append({"constraint": violation.constraint.cli_name(), "tool": tool,
                       "severity": str(violation.severity), "message": violation.message})
for violation in OpenAIToolCountConstraint().test(SimpleNamespace(tools=tools)):
    add(violation)
for tool in tools:
    for constraint in [OpenAIToolNameLengthConstraint(), OpenAIToolNamePatternConstraint(), ToolInputSchemaFlatnessConstraint()]:
        for violation in constraint.test_tool(tool):
            add(violation, tool.name)
json.dump({"source": "mcp-interviewer", "version": version("mcp-interviewer"),
           "mode": "static-catalog", "catalogDigest": catalog["digest"],
           "checks": ["openai-tool-count", "openai-name-length", "openai-name-pattern", "tool-schema-flatness"],
           "excluded": {"openai-token-length": "Requires dynamic tool results; not a static catalog constraint"},
           "constraintViolationsCount": len(violations), "violations": violations}, sys.stdout)
