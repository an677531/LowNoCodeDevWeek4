dev notes mcp server — process doc

what the server does

this is a mcp server. lets claude code mess with markdown notes on disk. all notes go in ~/dev-notes/ as .md files. five tools: make, read, list, delete, tag.

no database. no http. just files. nodejs process. claude code spawns it and talks json-rpc over stdin/stdout.

tools

save_note
input: title string, content string
action: slugify title to filename, make sure ~/dev-notes exists, write content, overwrite if file there

list_notes
input: none
action: read ~/dev-notes, filter .md, return display name, filename, last-modified. promise.all to stat all

read_note
input: title string
action: slugify title, read file, return markdown, missing → isError: true

delete_note
input: title string
action: slugify, delete file. missing → isError: true. permanent, no trash

tag_note
input: title string, tags array
action: read note, insert or replace first line with Tags: tag1, tag2, idempotent

mcp arch

mcp = how ai assistants call external tools. client = claude code. server = nodejs mcp server.

startup flow

claude spawns node index.js
server makes stdioservertransport
server.connect(transport) → json-rpc loop
claude sends initialize
server responds with name, version, tools
claude sends initialized
server ready for tools/call

tool flow

claude wants tool → sends tools/call json-rpc
mcp sdk validates args
handler runs → file ops
server sends response
claude keeps talking

libs

@modelcontextprotocol/sdk → server + transport
zod → validate inputs
fs/promises → async file ops
path → build paths
os → home dir

issues

new tools not seen after editing index.js

server still old → restart fixes

spawn node enoent

node not on path → use process.execPath + __dirname path

tools ok

save_note, tag_note, delete_note work

tests pass 16/16