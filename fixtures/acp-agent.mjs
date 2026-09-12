// Local ACP protocol fixture. No model, account, file tool, or network access.
import { createInterface } from "node:readline";
const mode = process.argv[2] || "normal";
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let promptId;
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    if (mode === "hang") return;
    if (mode === "malformed") {
      process.stdout.write("not json\n");
      return;
    }
    send({
      id: msg.id,
      result: {
        protocolVersion: mode === "version" ? 99 : 1,
        agentInfo: { name: "anvil-local-acp-fixture", version: "1" },
        agentCapabilities: { promptCapabilities: { image: false }, loadSession: false },
        authMethods: [],
      },
    });
  } else if (msg.method === "session/new")
    send({ id: msg.id, result: { sessionId: "fixture-session" } });
  else if (msg.method === "session/prompt") {
    promptId = msg.id;
    send({
      method: "session/update",
      params: {
        sessionId: "wrong-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "must not appear" },
        },
      },
    });
    send({
      method: "session/update",
      params: {
        sessionId: "fixture-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Fixture response" },
        },
      },
    });
    if (mode === "slow") return;
    send({
      id: 999,
      method: "session/request_permission",
      params: {
        sessionId: "fixture-session",
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });
  } else if (msg.method === "session/cancel")
    send({ id: promptId, result: { stopReason: "cancelled" } });
  else if (msg.id === 999) {
    if (msg.result?.outcome?.outcome !== "cancelled") throw Error("Permission was wrongly granted");
    send({
      id: 998,
      method: "fs/write_text_file",
      params: { sessionId: "fixture-session", path: "do-not-write.txt", content: "bad" },
    });
  } else if (msg.id === 998) {
    if (!msg.error) throw Error("Filesystem capability was wrongly granted");
    send({ id: promptId, result: { stopReason: "end_turn" } });
  }
});
