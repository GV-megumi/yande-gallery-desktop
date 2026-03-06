---
name: find-skills
description: "Helps users discover and install agent skills when they ask questions like 'how do I do X', 'find a skill for X', 'is there a skill that can...', or express interest in extending capabilities."
---

# Find Skills

This skill enables discovery and installation from the open agent skills ecosystem. It activates when users seek functionality that might exist as an installable skill.

## Usage Triggers
Apply this skill when users:
- Ask procedural questions about accomplishing tasks
- Explicitly request skill discovery
- Question capability availability
- Want to expand agent functionality
- Search for tools, templates, or workflows
- Express desire for domain-specific assistance

## Skills CLI Information
The command-line interface (`npx skills`) functions as a package manager for agent skills, which are "modular packages that extend agent capabilities with specialized knowledge, workflows, and tools."

**Primary commands:**
- `npx skills find [query]` - Interactive or keyword-based search
- `npx skills add <package>` - Installation from repositories
- `npx skills check` - Update availability verification
- `npx skills update` - Bulk skill updates

Skills directory: https://skills.sh/

## Implementation Process

**Identify requirements:** Determine domain, specific task, and likelihood of existing solutions.

**Execute search:** Run find commands with relevant terminology.

**Present findings:** Share skill names, functionality descriptions, installation commands, and reference links.

**Facilitate installation:** Execute installation commands with appropriate flags when approved.

## Search Categories
Common domains include web development, testing, DevOps, documentation, code quality, design, and productivity workflows.

## Fallback Strategy
When searches yield no results, offer direct assistance and suggest custom skill creation via `npx skills init`.
