import { installCanvasInput } from "./canvas/input.ts";
import { installCanvasRuntime } from "./canvas/runtime.ts";
import { installCanvasBridge } from "./canvas/bridge.ts";

/** Generated from checked TypeScript, with no hidden closure dependencies. */
export const ANVIL_ENGINE = `(function (global, inputFactory, runtimeFactory, bridgeFactory) {
  if (global.Anvil && global.Anvil._ok) { global.Anvil.map(global.__ANVIL_INPUT__); return; }
  var input = inputFactory(global, global.__ANVIL_INPUT__);
  global.Anvil = runtimeFactory(global, input);
  bridgeFactory(global, input, global.Anvil);
})(window, ${installCanvasInput.toString()}, ${installCanvasRuntime.toString()}, ${installCanvasBridge.toString()});`;
