# Green Tea Documentation

Green Tea is a desktop notes app with a built-in AI agent. It's designed for knowledge workers who want AI to help with writing, research, and automating repetitive tasks — without needing a terminal or any technical setup.

All your data stays on your computer. There's no cloud, no account required, and nothing leaves your machine unless you tell it to.

- [Download Green Tea](https://github.com/markoinla/green-tea-releases/releases)
- [Website](https://greentea.app)

---

## Installation

### macOS
1. Download the `.dmg` file from the [Releases](https://github.com/markoinla/green-tea-releases/releases) page
2. Open the `.dmg` and drag Green Tea to your Applications folder
3. Launch Green Tea from Applications

### Windows
1. Download the `.exe` installer from the [Releases](https://github.com/markoinla/green-tea-releases/releases) page
2. Run the installer and follow the prompts
3. Launch Green Tea from your Start menu or desktop shortcut

Green Tea checks for updates automatically and will let you know when a new version is available.

---

## Getting Started

When you first open Green Tea, you'll see three panels:

- **Left sidebar** — your workspaces, folders, and notes
- **Center** — the editor where you write
- **Right sidebar** — the AI chat panel

Start by creating a new note in the left sidebar. You can begin writing right away, and when you need help, type a message in the chat panel on the right.

---

## Workspaces

Workspaces let you organize your work into separate projects. Each workspace has its own notes, folders, conversations, and AI context.

To create a new workspace, click the workspace name at the top of the left sidebar and select **New Workspace**.

Each workspace has a **description** that helps the AI understand what the project is about. The AI can read and update this description as it works with you.

---

## Writing Notes

The editor supports rich text formatting with a simple slash command menu. Type `/` to see all available block types:

- **Text formatting** — bold, italic, underline, highlight, strikethrough
- **Headings** — H1, H2, H3
- **Lists** — bullet lists, numbered lists, checklists
- **Code blocks** — with syntax highlighting
- **Tables** — with resizable columns
- **Images** — drag and drop or paste from clipboard
- **Links** — clickable with hover previews

You can also select text and use the floating toolbar for quick formatting.

### Search and Replace

Use `Cmd+F` (macOS) or `Ctrl+F` (Windows) to search within the current document. The search bar supports case-sensitive matching, navigation between results, and replace/replace-all.

### Folders

Organize notes into folders by right-clicking in the sidebar. Folders are collapsible and you can drag notes between them.

---

## AI Chat

The right sidebar is where you talk to Green Tea's AI agent. It can read your notes, propose edits, search the web, and automate tasks.

### Having a Conversation

Type a message in the chat input at the bottom of the right panel. The AI can:

- **Read your notes** — it has access to all notes in the current workspace
- **Edit your documents** — it proposes changes with a visual diff you can approve or reject
- **Search the web** — it can look things up and bring information into your notes
- **Work with files** — process PDFs, create Word docs, spreadsheets, and presentations

### Approving Edits

When the AI wants to change a note, it shows you a diff preview with the proposed changes highlighted. You can:

- **Accept** — apply the changes to your note
- **Reject** — discard the suggestion

You can also turn on auto-approve in the chat toolbar if you want the AI to apply changes without asking.

### Referencing Notes

Type `@` in the chat input to reference a specific note. This tells the AI exactly which note you're talking about, which is helpful when you have many notes in a workspace.

### Attaching Files and Images

You can attach files and images to your messages. Drag them into the chat input or use the attachment button in the toolbar.

### Multiple Conversations

Each workspace can have multiple conversation threads. Click the conversation name at the top of the chat panel to switch between them or create a new one.

---

## AI Models

Green Tea works out of the box with a built-in AI model — no API key needed. If you want to use a different model, you can add your own API key in **Settings > Models**.

### Supported Providers

- **Green Tea (default)** — free, no setup required
- **Anthropic** — Claude Sonnet, Opus, and Haiku models
- **Together AI** — open-source models like Kimi K2.5 and Qwen3
- **OpenRouter** — access to Gemini, Grok, MiniMax, and more

To switch models, click the model name in the chat toolbar dropdown. You can enable or disable specific models in Settings.

### Reasoning Mode

Some models support a reasoning/thinking mode that shows you the AI's thought process. Toggle this in the chat toolbar when available.

---

## Scheduled Tasks

Scheduled tasks let you automate recurring work. The AI runs on a schedule you define, writes results into your notes, and has everything ready for you when you sit down to work.

### Creating a Scheduled Task

1. Click the clock icon in the bottom of the left sidebar
2. Click **New Task**
3. Give it a name and a prompt (what you want the AI to do)
4. Set a schedule using a cron expression (e.g., every weekday at 8 AM)
5. Enable the task

### Examples

- **Morning briefing** — "Summarize my calendar and important emails for today" (weekdays at 8:00 AM)
- **Competitor monitoring** — "Search for news about [competitor] and summarize any updates" (daily at 9:00 AM)
- **Weekly report** — "Compile a summary of all notes added this week" (Fridays at 5:00 PM)

### Managing Tasks

The scheduler popover shows all your tasks with their status:
- When they last ran
- When they'll run next
- Whether they're enabled or disabled

You can also run any task manually by clicking the play button.

If the app was closed when a task was supposed to run, it will catch up and run it the next time you open Green Tea.

---

## Skills

Skills extend what Green Tea can do. They're like plugins that teach the AI new abilities.

### Built-in Skills

Green Tea comes with skills for working with common file formats:

- **PDF** — extract text, merge, split, and process PDF files
- **DOCX** — create and edit Word documents
- **XLSX** — create and work with spreadsheets
- **PPTX** — create presentations

These work automatically — just ask the AI to create a document or process a file and it will use the right skill.

### Skill Marketplace

Browse and install community skills from **Settings > Skills**. Installed skills are automatically available to the AI.

### Creating Your Own Skills

You can ask Green Tea to build custom skills for you. Describe what you want and the AI will create a skill with instructions and scripts. Skills are stored in your `Documents/Green Tea/skills/` folder.

---

## MCP Servers

MCP (Model Context Protocol) servers let you connect Green Tea to external data sources and services. This is the same protocol used by other AI tools, so any MCP server will work.

### Setting Up an MCP Server

1. Go to **Settings > MCP Servers**
2. Add a server with its command and arguments, or an HTTP URL
3. Enable the server
4. The AI will automatically have access to the server's tools

### Configuration

MCP servers are configured in a file at `Documents/Green Tea/mcp.json`. You can edit this file directly or use the settings UI.

---

## Connected Accounts

Green Tea can connect to your Google and Microsoft accounts for direct access to your email, calendar, and documents.

### Google Workspace

Connect in **Settings > Accounts > Google** to enable:

- **Gmail** — search and read your emails
- **Google Calendar** — view and search your events
- **Google Drive** — search, read, and create Google Docs, Sheets, and Slides

Each service can be connected or disconnected independently.

### Microsoft Outlook

Connect in **Settings > Accounts > Microsoft** to enable:

- **Outlook** — search and read your emails

---

## Customization

### Theme

Switch between light and dark mode in **Settings > General**.

### Appearance

Customize fonts, sizes, and colors in **Settings > Appearance**:

- Editor font family and size
- UI font size
- Code block font size
- Border radius
- Custom accent colors

You can also fine-tune the theme by editing the file at `Documents/Green Tea/theme.json`.

---

## Data and Privacy

- **All data is local.** Your notes, files, and conversations are stored on your computer in the app's data folder.
- **No account required.** You can use Green Tea without signing up for anything.
- **No telemetry.** The app doesn't send usage data anywhere.
- **AI messages** are sent to the AI provider you've selected (Green Tea's default server, Anthropic, Together AI, or OpenRouter) to generate responses. No other data leaves your machine.

### Where Your Data Lives

- **macOS:** `~/Library/Application Support/Green Tea/`
- **Windows:** `%APPDATA%/Green Tea/`
- **Skills:** `~/Documents/Green Tea/skills/`
- **MCP config:** `~/Documents/Green Tea/mcp.json`
- **Theme config:** `~/Documents/Green Tea/theme.json`

---

## Keyboard Shortcuts

| Action | macOS | Windows |
|--------|-------|---------|
| Search in document | `Cmd+F` | `Ctrl+F` |
| Bold | `Cmd+B` | `Ctrl+B` |
| Italic | `Cmd+I` | `Ctrl+I` |
| Underline | `Cmd+U` | `Ctrl+U` |
| Strikethrough | `Cmd+Shift+X` | `Ctrl+Shift+X` |
| Code | `Cmd+E` | `Ctrl+E` |
| Link | `Cmd+K` | `Ctrl+K` |
| Undo | `Cmd+Z` | `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Shift+Z` |

---

## Troubleshooting

### The AI isn't responding
- Check your internet connection — even the default model requires an internet connection
- If using your own API key, verify it's valid in **Settings > Models** using the test button

### Skills aren't working
- Some skills require Python to be installed on your computer. Green Tea will show a warning on startup if Python isn't detected
- Make sure the skill is installed and visible in **Settings > Skills**

### MCP server won't connect
- Check the server command and arguments in **Settings > MCP Servers**
- Try the test connection button to see the error
- For stdio servers, make sure the required package (e.g., `npx`) is available on your system

### Scheduled tasks didn't run
- Make sure the task is enabled
- Tasks only run while Green Tea is open. If the app was closed, the task will catch up when you reopen it

---

## Getting Help

If you run into a problem, you can report a bug directly from the app using the bug report button. This sends a report to the development team so we can look into it.
