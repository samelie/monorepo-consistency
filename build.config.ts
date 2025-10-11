import { makeUnbuildConfig } from "@rad/build-configs/unbuild";

export default makeUnbuildConfig({
  "entries": [
    "src/cli",
    "src/index"
  ],
  "declaration": true,
  "rollup": {
    "emitCJS": true
  }
});
