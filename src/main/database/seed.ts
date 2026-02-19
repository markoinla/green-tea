import type Database from 'better-sqlite3'
import { createDocument } from './repositories/documents'
import { listWorkspaces } from './repositories/workspaces'

function text(t: string, marks?: { type: string }[]) {
  const node: { type: string; text: string; marks?: { type: string }[] } = { type: 'text', text: t }
  if (marks) node.marks = marks
  return node
}

function paragraph(...content: ReturnType<typeof text>[]) {
  if (content.length === 0) return { type: 'paragraph' as const }
  return { type: 'paragraph' as const, content }
}

function heading(level: number, ...content: ReturnType<typeof text>[]) {
  return { type: 'heading' as const, attrs: { level }, content }
}

function item(blockType: string, para: ReturnType<typeof paragraph>, children?: unknown[]) {
  const node: {
    type: string
    attrs: { blockType: string; collapsed: boolean; checked: boolean; blockId: null }
    content: unknown[]
  } = {
    type: 'outlinerItem',
    attrs: { blockType, collapsed: false, checked: false, blockId: null },
    content: [para]
  }
  if (children) {
    node.content.push({ type: 'outlinerList', content: children })
  }
  return node
}

function list(...items: ReturnType<typeof item>[]) {
  return { type: 'outlinerList' as const, content: items }
}

const welcomeContent = {
  type: 'doc',
  content: [
    heading(1, text('Welcome to Green Tea')),

    paragraph(
      text(
        'Green Tea is a simple notes app with an AI agent built in. But underneath, it runs on a full coding agent framework — meaning the AI can do far more than chat.'
      )
    ),

    heading(2, text('A Notes App That Can Build Itself')),

    paragraph(
      text(
        'Most note-taking apps give you a fixed set of features. Green Tea is different. The built-in agent can read and edit your documents, run shell commands, write code, and create new tools for itself. If you can describe it, the agent can probably build it.'
      )
    ),

    heading(2, text('Skills: Teach It New Tricks')),

    paragraph(
      text(
        'Skills are reusable prompts that give the agent specialized capabilities. Green Tea ships with a few, but the real power is that the agent can create new ones on the fly. Skills are just files on disk — easy to share, edit, or version control.'
      )
    ),

    heading(2, text('What Can It Do?')),

    paragraph(text('Here are some things you can ask the agent to do right now:')),

    list(
      item('paragraph', paragraph(text('Summarize, rewrite, or restructure your notes'))),
      item('paragraph', paragraph(text('Research a topic and draft a document from scratch'))),
      item(
        'paragraph',
        paragraph(text('Build a skill that imports PDFs, web pages, or RSS feeds as notes'))
      ),
      item(
        'paragraph',
        paragraph(text('Create a skill that formats meeting notes into action items'))
      ),
      item(
        'paragraph',
        paragraph(text('Generate templates, outlines, or checklists for recurring workflows'))
      ),
      item(
        'paragraph',
        paragraph(
          text('Anything else you can think of — it has a full coding agent under the hood')
        )
      )
    ),

    heading(2, text('Try It')),

    paragraph(text('Open the chat sidebar and try a prompt like:')),

    paragraph(),

    {
      type: 'codeBlock',
      attrs: { language: null },
      content: [
        text('Build me a skill that can import a PDF file and turn it into a well formatted note')
      ]
    },

    paragraph(),

    paragraph(
      text(
        "The agent will write the code, create the skill file, and you can use it immediately. That's the idea — start with a simple notes app, and let the AI extend it into whatever you need."
      )
    )
  ]
}

export function seedWelcomeDocument(db: Database.Database): void {
  const docCount = db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number }
  if (docCount.cnt > 0) return

  const workspaces = listWorkspaces(db)
  if (workspaces.length === 0) return

  createDocument(db, {
    title: 'Welcome to Green Tea',
    workspace_id: workspaces[0].id,
    content: JSON.stringify(welcomeContent)
  })
}
