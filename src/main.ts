import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");

Promise.all([
  import("vue-print-designer"),
  import("vue-print-designer/style.css"),
]).catch((cause: unknown) => {
  window.dispatchEvent(new CustomEvent("duowei-print:designer-load-error", { detail: cause }));
});
