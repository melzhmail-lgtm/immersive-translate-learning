# Architecture

## Browser extension

Source: `extension/`

Manifest V3 extension with:
- `background.js`: provider routing, network requests, translation/learning API tasks, context-menu actions
- `content.js`: DOM discovery, dynamic-site observers, translation rendering, hover/selection interactions, vocabulary capture
- `content.css`: injected translation and learning UI styles
- `popup.*`: quick controls for the active page
- `options.*`: provider pool, API configuration, display and learning settings

## Data

User configuration and vocabulary are stored with browser extension storage. Release packages must never contain real credentials.

## Routing

A provider pool is ordered by drag priority. Translation tasks can use NMT or LLM services depending on capability. Rich learning tasks require an LLM-capable provider.

## Distribution

There are two different deliverables:
1. Browser extension release ZIP for Chrome/Edge users.
2. Agent Skill repository for skills.sh users/agents who want to install, maintain, customize, or package the extension.
