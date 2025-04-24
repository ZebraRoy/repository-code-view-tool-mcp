# Review Toolkit MCP

A Model Context Protocol (MCP) service to help AI agents manage and track code review sessions.

## Features

- Start new review sessions or resume existing ones
- Track files that need review
- Track review status and feedback for each file
- Generate review reports
- Token counting to manage context limits (includes both file content and feedback)
- Persistent sessions stored in user's home directory
- Automatic token count reset when resuming sessions

## Installation

```bash
npm install -g review-toolkit-mcp
# or
pnpm add -g review-toolkit-mcp
```

## Configuration

The MCP supports the following command-line arguments:

- `--session-dir`: Custom directory path to store review sessions
  - Default: `~/.review-toolkit-sessions/`

## Setting up in Cursor

To use this MCP in Cursor, add the following configuration to your Cursor settings:

### Mac/Linux

```json
{
  "mcpServers": {
    "review-toolkit": {
      "command": "npx",
      "args": ["-y", "review-toolkit-mcp"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "review-toolkit": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "review-toolkit-mcp"]
    }
  }
}
```

### Custom Session Directory

If you want to specify a custom directory for storing sessions, you can add the `--session-dir` argument:

#### Mac/Linux

```json
{
  "mcpServers": {
    "review-toolkit": {
      "command": "npx",
      "args": [
        "-y",
        "review-toolkit-mcp",
        "--session-dir=/path/to/your/sessions/directory"
      ]
    }
  }
}
```

#### Windows

```json
{
  "mcpServers": {
    "review-toolkit": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "review-toolkit-mcp",
        "--session-dir=C:\\path\\to\\your\\sessions\\directory"
      ]
    }
  }
}
```

## Usage

This MCP provides tools for AI agents to manage code review sessions. It supports:

1. Starting/resuming review sessions
2. Tracking review progress
3. Managing feedback for each file
4. Generating reports
5. Token management for context limits

## Tools

### start-review-session

Start a new code review session or resume an existing one. When resuming, token count is automatically reset.

Parameters:

- `projectRoot` (string): The root directory of the project
- `files` (string[] | optional): Array of file paths to review
- `tokenLimit` (number | optional): Maximum token limit for the session (default: 80000)
- `forceNew` (boolean | optional): Force creation of a new session even if one exists

### get-review-status

Get the status of a review session.

Parameters:

- `key` (string): Session ID or project root path

### get-next-review-file

Get the next file that needs to be reviewed.

Parameters:

- `key` (string): Session ID or project root path

### submit-file-review

Submit a review for a file. The tool counts tokens for both the file content and the feedback.

Parameters:

- `key` (string): Session ID or project root path
- `filePath` (string): The file path that was reviewed
- `feedback` (string): The review feedback for the file
- `projectRoot` (string | optional): The project root directory (if different from key)

### complete-review-session

Mark a review session as completed.

Parameters:

- `key` (string): Session ID or project root path

### generate-review-report

Generate a report for a review session.

Parameters:

- `key` (string): Session ID or project root path

### list-files

List all files in the repository that match the given condition.

Parameters:

- `root` (string): The root directory of the repository
- `mode` (string): The mode for listing files: 'glob', 'changed', 'staged'
- `glob` (string | optional): The glob pattern to match files against (required if mode is 'glob')

## Session Persistence

Review sessions are saved in `~/.review-toolkit-sessions/` directory. Each project can have one active session at a time.

## License

MIT
