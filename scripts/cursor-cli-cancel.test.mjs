import assert from "node:assert/strict";
import { test } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { runProcess } from "../electron/cli-runner.mjs";

for (const outcome of ["denied", "stalled"])
  test(
    `CLI cancellation remains bounded when taskkill is ${outcome}`,
    { skip: process.platform !== "win32", timeout: 6000 },
    async (t) => {
      const realSpawn = childProcess.spawn;
      const owned = [];
      let killers = 0,
        killerStopped = 0;
      childProcess.spawn = (file, args, options) => {
        if (String(file).toLowerCase() === "taskkill") {
          killers++;
          const killer = new EventEmitter();
          killer.kill = () => {
            killerStopped++;
            return true;
          };
          if (outcome === "denied") queueMicrotask(() => killer.emit("close", 1));
          return killer;
        }
        const child = realSpawn(file, args, options);
        owned.push(child);
        return child;
      };
      syncBuiltinESMExports();
      t.after(async () => {
        childProcess.spawn = realSpawn;
        syncBuiltinESMExports();
        await Promise.all(
          owned.map(
            (child) =>
              new Promise((resolve) => {
                if (child.exitCode !== null || child.signalCode !== null) return resolve();
                const timer = setTimeout(resolve, 1000);
                child.once("exit", () => {
                  clearTimeout(timer);
                  resolve();
                });
                child.kill("SIGKILL");
              }),
          ),
        );
      });
      const controller = new AbortController();
      const pending = runProcess(
        { file: process.execPath, args: [] },
        ["-e", 'console.log("OWNED_CANCEL_FIXTURE");setInterval(()=>{},1000)'],
        {
          signal: controller.signal,
          onOutput: () => controller.abort(),
        },
      );
      let deadline;
      try {
        await assert.rejects(
          Promise.race([
            pending,
            new Promise((_, reject) => {
              deadline = setTimeout(() => reject(Error("UNBOUNDED_CANCELLATION")), 3000);
            }),
          ]),
          (error) => {
            assert.match(error.message, /abgebrochen/);
            assert.match(error.message, /Nachkommen|Prozessbaum/);
            assert.equal(error.code, "CLI_STOP_UNCONFIRMED");
            assert.equal(error.termination.treeConfirmed, false);
            assert.equal(error.termination.directStopped, true);
            return true;
          },
        );
      } finally {
        clearTimeout(deadline);
      }
      assert.equal(killers, 1);
      assert.ok(
        owned[0].exitCode !== null || owned[0].signalCode !== null,
        "The direct fixture process actually exited",
      );
      if (outcome === "stalled")
        assert.equal(killerStopped, 1, "Only the owned unresponsive taskkill helper is stopped");
    },
  );
