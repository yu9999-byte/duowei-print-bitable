import { basekit } from "@lark-opdev/block-basekit-server-api";
import { readAutomationBlockConfig } from "../../src/automation/automation-block-config.ts";
import { registerFeishuAutomationBlock } from "../../src/automation/feishu-automation-block.ts";

registerFeishuAutomationBlock(basekit, readAutomationBlockConfig(process.env));

export default basekit;
