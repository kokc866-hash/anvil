import { app } from "electron";

// Isolate QA data, then boot the actual application, IPC bindings and preload.
app.setPath("userData", process.env.ANVIL_QA_USER_DATA);
await import("../electron/main.mjs");
