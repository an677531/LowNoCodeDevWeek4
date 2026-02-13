// Quick integration test — spawns the MCP server and sends JSON-RPC
// requests over stdin/stdout to verify all five tools work.

import { spawn } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = spawn(process.execPath, [join(__dirname, "index.js")], {
  stdio: ["pipe", "pipe", "pipe"],
});

// Collect stderr for debugging
server.stderr.on("data", (d) => process.stderr.write(d));

// Read newline-delimited JSON responses from stdout
const rl = createInterface({ input: server.stdout });
const pending = new Map(); // id → { resolve }
let msgId = 0;

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  } catch {}
});

function send(method, params = {}) {
  const id = ++msgId;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  server.stdin.write(msg + "\n");
  return new Promise((resolve) => pending.set(id, { resolve }));
}

function notify(method, params = {}) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  server.stdin.write(msg + "\n");
}

// ---- Test runner ----

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function run() {
  // 1. Initialize handshake
  console.log("\n--- MCP Handshake ---");
  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-runner", version: "1.0.0" },
  });
  assert("Server initialized", init.result?.serverInfo?.name === "dev-notes");
  notify("notifications/initialized");

  // 2. List available tools
  console.log("\n--- Tool Discovery ---");
  const toolList = await send("tools/list");
  const toolNames = toolList.result.tools.map((t) => t.name).sort();
  assert(
    "All 5 tools registered",
    toolNames.length === 5 &&
      toolNames.join(",") === "delete_note,list_notes,read_note,save_note,tag_note",
    `got: ${toolNames.join(", ")}`
  );

  // 3. save_note
  console.log("\n--- Tool: save_note ---");
  const saveRes = await send("tools/call", {
    name: "save_note",
    arguments: { title: "Test Note", content: "# Hello\n\nThis is a test." },
  });
  const saveText = saveRes.result.content[0].text;
  assert("save_note succeeds", saveText.includes("Saved note"));
  assert("save_note correct filename", saveText.includes("test-note.md"));

  // 4. list_notes
  console.log("\n--- Tool: list_notes ---");
  const listRes = await send("tools/call", {
    name: "list_notes",
    arguments: {},
  });
  const listText = listRes.result.content[0].text;
  assert("list_notes finds the note", listText.includes("test-note.md"));

  // 5. read_note
  console.log("\n--- Tool: read_note ---");
  const readRes = await send("tools/call", {
    name: "read_note",
    arguments: { title: "Test Note" },
  });
  const readText = readRes.result.content[0].text;
  assert("read_note returns content", readText.includes("# Hello"));
  assert("read_note full body", readText.includes("This is a test."));

  // 6. tag_note — first tag
  console.log("\n--- Tool: tag_note (initial) ---");
  const tagRes = await send("tools/call", {
    name: "tag_note",
    arguments: { title: "Test Note", tags: ["mcp", "testing"] },
  });
  assert("tag_note succeeds", tagRes.result.content[0].text.includes("Tagged"));

  const readAfterTag = await send("tools/call", {
    name: "read_note",
    arguments: { title: "Test Note" },
  });
  const taggedContent = readAfterTag.result.content[0].text;
  assert("Tags prepended", taggedContent.startsWith("Tags: mcp, testing"));
  assert("Original content preserved", taggedContent.includes("# Hello"));

  // 7. tag_note — replace (idempotency)
  console.log("\n--- Tool: tag_note (replace) ---");
  await send("tools/call", {
    name: "tag_note",
    arguments: { title: "Test Note", tags: ["updated"] },
  });
  const readAfterRetag = await send("tools/call", {
    name: "read_note",
    arguments: { title: "Test Note" },
  });
  const retaggedContent = readAfterRetag.result.content[0].text;
  assert("Tags replaced (not duplicated)", retaggedContent.startsWith("Tags: updated"));
  assert(
    "Old tags removed",
    !retaggedContent.includes("Tags: mcp")
  );

  // 8. delete_note
  console.log("\n--- Tool: delete_note ---");
  const delRes = await send("tools/call", {
    name: "delete_note",
    arguments: { title: "Test Note" },
  });
  assert("delete_note succeeds", delRes.result.content[0].text.includes("Deleted"));

  // 9. Verify deletion
  console.log("\n--- Verify deletion ---");
  const readDeleted = await send("tools/call", {
    name: "read_note",
    arguments: { title: "Test Note" },
  });
  assert("read_note returns error after delete", readDeleted.result.isError === true);
  assert(
    "Error message is helpful",
    readDeleted.result.content[0].text.includes("not found")
  );

  // 10. delete_note on missing file
  const delMissing = await send("tools/call", {
    name: "delete_note",
    arguments: { title: "Does Not Exist" },
  });
  assert("delete_note handles missing file", delMissing.result.isError === true);

  // Summary
  console.log(`\n=============================`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`=============================\n`);

  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  server.kill();
  process.exit(1);
});
