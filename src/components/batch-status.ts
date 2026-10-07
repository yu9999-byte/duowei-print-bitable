import { defineComponent, h, type PropType } from "vue";
import type { BatchRecordSummary } from "../core/batch-print-session.ts";

export const BatchStatus = defineComponent({
  name: "BatchStatus",
  props: {
    summaries: { type: Array as PropType<BatchRecordSummary[]>, required: true },
    layout: { type: String as PropType<"default" | "continuous" | "labels">, default: "default" },
  },
  setup(props) {
    return () => {
      const visible = props.summaries.slice(0, 5).map((item) => item.label).join("、");
      const remainder = props.summaries.length - 5;
      return h("div", { class: "batch-bar", "aria-label": "打印批次" }, [
        h("strong", `已选 ${props.summaries.length} 条`),
        h("span", props.layout === "labels" ? "标签排版"
          : props.layout === "continuous" ? "连续排版" : "默认排版"),
        h("span", { class: "batch-summaries" },
          remainder > 0 ? `${visible} 等 ${remainder} 条` : visible),
      ]);
    };
  },
});
