# LowNoCodeDevWeek4
Server mostly follows the basic functionality of what was show in the tutorial. It gives AI new tool allowing persistent memory across session with following tools:
save_note -  saves a markdown note with a title to a dev-notes directory
list_note - lists all saved notes
read_note - reads a specific note by title
delete_note - allows for removal of notes by title
tag_nope - allows for including tags within notes for easier readabilty and finding certain sections or placing in specific tags for easier access later. The two additional tools along with giving persistent memory for AI, provides easier modification, and simpler manipulation on user end.
I have created install instruction with claude helping to ensure consistency for each step:
# Dev Notes MCP Server — Installation Guide

## Prerequisites

- Node.js v18 or later
- Claude Code CLI installed and working

## Step 1: Clone or Copy the Project

Place the `dev-notes-server` folder somewhere on your machine. For example:

```bash
cd ~/Desktop
git clone <your-repo-url> dev-notes-server
```

## Step 2: Install Dependencies

```bash
cd dev-notes-server
npm install
```

This installs the two required packages:
- `@modelcontextprotocol/sdk` — the MCP server framework
- `zod` — input validation (bundled as a dependency of the SDK)

## Step 3: Verify the Server Starts

```bash
npm start
```

The server will start and wait for JSON-RPC input on stdin. You won't see any output — that's normal. Press `Ctrl+C` to stop it.

## Step 4: Register the Server with Claude Code

Run the following command, replacing the path with where you put the project:

```bash
claude mcp add dev-notes node /absolute/path/to/dev-notes-server/index.js
```

For example:

```bash
claude mcp add dev-notes node /Users/tony/Desktop/DIG\ 4503C/Week\ 4/dev-notes-server/index.js
```

This adds the server to your `~/.claude.json` config file. The entry will look like:

```json
{
  "mcpServers": {
    "dev-notes": {
      "command": "node",
      "args": ["/absolute/path/to/dev-notes-server/index.js"]
    }
  }
}
```

## Step 5: Verify in Claude Code

Start a new Claude Code session and run:

```
/mcp
```

You should see `dev-notes` listed with 5 tools:
- `save_note` — save a markdown note
- `list_notes` — list all saved notes
- `read_note` — read a note by title
- `delete_note` — delete a note by title
- `tag_note` — add or update tags on a note

## Step 6: Run the Tests (Optional)

```bash
node test.js
```

You should see 16/16 tests pass, confirming all five tools work correctly.

## Where Notes Are Stored

All notes are saved as markdown files in `~/dev-notes/`. The directory is created automatically the first time you save a note.

```
~/dev-notes/
  project-ideas.md
  meeting-notes.md
  debugging-tips.md
```

## Troubleshooting

**Server not showing in `/mcp`:**
Make sure the path in the `claude mcp add` command is an absolute path, not relative.

**Tools not updating after code changes:**
The server must be restarted. Go to `/mcp` in Claude Code, disable the server, then re-enable it.

**`spawn node ENOENT` in tests:**
If you use nvm, make sure the Node binary is on your PATH. Run `which node` to confirm.


Largest two limitations or issues is that undoing deletes on the notes is difficult to undo through AI. additionally, the use of tags can become messy if not used in a careful structured way.