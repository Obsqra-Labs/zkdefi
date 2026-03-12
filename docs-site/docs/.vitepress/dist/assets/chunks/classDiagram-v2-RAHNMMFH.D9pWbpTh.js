import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-WL4C6EOR.DWjNMds9.js";
import { _ as __name } from "./mermaid.core.PiF7Ag_s.js";
import "./chunk-FMBD7UC4.sUUxPfDb.js";
import "./chunk-JSJVCQXG.uCXNdBxO.js";
import "./chunk-55IACEB6.5lKnm7Cy.js";
import "./chunk-KX2RTZJC.DIlAF5tv.js";
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
