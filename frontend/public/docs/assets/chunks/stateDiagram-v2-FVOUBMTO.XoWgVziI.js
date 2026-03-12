import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-NQ4KR5QH.CvcjOQ2H.js";
import { _ as __name } from "./mermaid.core.PiF7Ag_s.js";
import "./chunk-55IACEB6.5lKnm7Cy.js";
import "./chunk-KX2RTZJC.DIlAF5tv.js";
import "./framework.Bk4d7gLa.js";
var diagram = {
  parser: stateDiagram_default,
  get db() {
    return new StateDB(2);
  },
  renderer: stateRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.state) {
      cnf.state = {};
    }
    cnf.state.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
