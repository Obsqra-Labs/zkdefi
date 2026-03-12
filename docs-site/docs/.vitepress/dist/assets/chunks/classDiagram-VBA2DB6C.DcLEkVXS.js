import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-WL4C6EOR.8ZT5UkLN.js";
import { _ as __name } from "./mermaid.core.BcAYFjNO.js";
import "./chunk-FMBD7UC4.CcuPK1PO.js";
import "./chunk-JSJVCQXG.CR9gaLqt.js";
import "./chunk-55IACEB6.BJnovlvr.js";
import "./chunk-KX2RTZJC.DPtx0Zyu.js";
import "./framework.Bk4d7gLa.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
