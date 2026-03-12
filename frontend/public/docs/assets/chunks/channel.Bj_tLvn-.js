import { U as Utils, D as Color } from "./mermaid.core.PiF7Ag_s.js";
const channel = (color, channel2) => {
  return Utils.lang.round(Color.parse(color)[channel2]);
};
export {
  channel as c
};
