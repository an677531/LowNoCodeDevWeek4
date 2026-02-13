# Dev Notes MCP Server — Process Document

## What the Server Does

The dev-notes server is a **Model Context Protocol (MCP) server** that gives Claude Code the ability to manage markdown notes on disk. It stores all notes as `.md` files in `~/dev-notes/` and exposes five tools that Claude can call to create, read, list, delete, and tag those files.

The server runs as a local Node.js process. Claude Code launches it as a child process and communicates with it over **stdin/stdout** using JSON-RPC 2.0 messages. No HTTP, no database — just files on disk and a stdio pipe.

---

## Tools

### 1. `save_note`
- **Parameters:** `title` (string), `content` (string)
- **What it does:** Converts the title to a filename using `slugify()` (e.g., `"Project Ideas"` becomes `project-ideas.md`), ensures `~/dev-notes/` exists, and writes the content to disk. Overwrites if the file already exists.

### 2. `list_notes`
- **Parameters:** None
- **What it does:** Reads the `~/dev-notes/` directory, filters for `.md` files, and returns each note's display name, filename, and last-modified date. Uses `Promise.all()` to stat all files in parallel.

### 3. `read_note`
- **Parameters:** `title` (string)
- **What it does:** Slugifies the title to find the file, reads it with `fs.readFile()`, and returns the raw markdown content. Returns `isError: true` if the file doesn't exist.

### 4. `delete_note`
- **Parameters:** `title` (string)
- **What it does:** Slugifies the title to locate the file and removes it with `fs.unlink()`. Returns `isError: true` if the note doesn't exist. Deletion is permanent — there is no trash or undo.

### 5. `tag_note`
- **Parameters:** `title` (string), `tags` (array of strings)
- **What it does:** Reads an existing note and inserts a `Tags: tag1, tag2` line at the very top. If the first line already starts with `Tags: `, it replaces that line instead of adding a duplicate. This makes the operation idempotent — calling it multiple times just updates the same line.

---

## MCP Architecture

### What is MCP?

The **Model Context Protocol** is a standard that lets AI assistants (like Claude Code) discover and call external tools. It defines how a client (Claude Code) and a server (our Node.js process) communicate.

### How the Pieces Fit Together

```
┌─────────────┐       stdin (JSON-RPC)       ┌─────────────────┐
│             │  ──────────────────────────►  │                 │
│ Claude Code │                               │  MCP Server     │
│  (client)   │  ◄──────────────────────────  │  (index.js)     │
│             │       stdout (JSON-RPC)       │                 │
└─────────────┘                               └────────┬────────┘
                                                       │
                                                       │ fs read/write
                                                       ▼
                                              ┌─────────────────┐
                                              │  ~/dev-notes/   │
                                              │  *.md files     │
                                              └─────────────────┘
```

### Startup Sequence

1. Claude Code spawns `node index.js` as a child process
2. The server creates a `StdioServerTransport` (listens on stdin, writes to stdout)
3. The server calls `server.connect(transport)` to start the JSON-RPC loop
4. Claude Code sends an `initialize` request with its client info
5. The server responds with its name, version, and capabilities
6. Claude Code sends an `initialized` notification
7. The server is now ready to receive `tools/list` and `tools/call` requests

### Tool Call Flow

1. Claude decides it needs to use a tool (e.g., `save_note`)
2. Claude Code sends a `tools/call` JSON-RPC request over stdin:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "tools/call",
     "params": {
       "name": "save_note",
       "arguments": { "title": "My Note", "content": "# Hello" }
     }
   }
   ```
3. The MCP SDK validates the arguments against the Zod schema
4. The handler function runs (writes the file to disk)
5. The server sends a JSON-RPC response over stdout:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "content": [{ "type": "text", "text": "Saved note \"My Note\" to ..." }]
     }
   }
   ```
6. Claude reads the result and continues the conversation

### Key Libraries

| Library | Role |
|---------|------|
| `@modelcontextprotocol/sdk` | Provides `McpServer` and `StdioServerTransport` — the core MCP framework |
| `zod` | Defines and validates input schemas for each tool |
| `fs/promises` | Async file I/O (read, write, delete, mkdir, readdir, stat) |
| `path` | Cross-platform file path construction |
| `os` | Resolves the user's home directory |

---

## Issues Encountered

### 1. New tools not recognized after editing `index.js`
- **Problem:** After adding `delete_note` and `tag_note` to the code, Claude Code still only saw the original three tools.
- **Cause:** The MCP server was still running the old version of `index.js`. The server process must be restarted for code changes to take effect.
- **Fix:** Disabled and re-enabled the server in Claude Code's `/mcp` configuration to restart the process.

### 2. `spawn node ENOENT` in the test script
- **Problem:** The integration test script (`test.js`) used `spawn("node", ...)` to launch the server, but Node couldn't find itself.
- **Cause:** When `spawn()` is called without a full path, it relies on the shell `PATH`. In the sandboxed execution environment, `node` wasn't on the `PATH`.
- **Fix (attempt 1):** Changed to `spawn(process.execPath, ...)` to use the absolute path of the currently running Node binary. This still failed because the `cwd` option used `new URL(".", import.meta.url).pathname`, which produced a malformed path.
- **Fix (final):** Replaced the `cwd` approach with `fileURLToPath(import.meta.url)` + `dirname()` to compute `__dirname`, then passed the full absolute path to `index.js` via `path.join(__dirname, "index.js")`. This resolved the issue.

### 3. No issues with the tools themselves
- All five tools passed integration testing (16/16 tests) on the first run after fixing the spawn issue. The `slugify()` function correctly maps titles to filenames across all tools, `tag_note` correctly handles both prepend and replace cases, and `delete_note` properly returns errors for missing files.
