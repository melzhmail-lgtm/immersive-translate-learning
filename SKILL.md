---
name: immersive-translate-learning
description: Build, configure, debug, package, and iterate the Chrome/Edge MV3 browser extension “沉浸式翻译&学习”. Use this skill when working on immersive multilingual webpage translation, NMT/LLM provider routing and BYOK APIs, automatic translation, selection/right-click translation, vocabulary learning, pronunciation, real-context word encounters, packaging, releases, or extension troubleshooting.
---

# 沉浸式翻译&学习

This skill maintains the browser extension source in `extension/`.

## Product goal

Create a fast, visually polished immersive translation and contextual English-learning extension for Chrome and Edge. Translation should feel native to the page rather than interrupt reading.

Core product principles:

1. Translation layout quality is a first-class feature.
2. Prefer fast/cheap NMT for straightforward bulk translation when configured.
3. Use LLM providers for structured language-learning tasks that need context, such as IPA, meanings, phrase alignment, roots, collocations, examples, and word cards.
4. Support multiple providers with user-controlled drag ordering and automatic fallback.
5. Keep API keys local to the browser by default. Never commit or embed credentials.
6. Preserve the user's original context when saving vocabulary: source sentence, page URL/title, surrounding context, and timestamps when available.
7. Dynamic sites such as X must be treated as live DOMs: handle lazy loading, “Show more”, rerenders, and failed/partial translations.
8. Keep the reading experience smooth: prioritize visible content, avoid layout jumps, and do not over-decorate translations.

## Before modifying code

Read:

- `extension/README.md`
- `references/architecture.md`
- the relevant source files in `extension/`

Do not rewrite working subsystems unnecessarily. Preserve browser storage keys and existing user data unless the user explicitly requests a migration.

## Provider architecture

The extension supports two provider classes.

### NMT providers

Use for cheap, fast bulk translation when available:

- DeepL
- Alibaba Cloud Machine Translation
- Volcano Engine Machine Translation
- Tencent Cloud compatibility adapter

NMT providers do not satisfy rich learning tasks by themselves.

### LLM providers

Use for translation and language-learning tasks:

- DeepSeek
- Qwen
- GLM
- Doubao / Volcano Ark
- OpenAI
- Gemini
- Claude
- SiliconFlow
- OpenRouter
- OpenAI-Compatible custom endpoints

When multiple services are enabled, respect the user's drag order. On retryable failure, rate limit, timeout, or provider outage, fall through to the next eligible service.

For learning/structured tasks, skip providers that cannot supply the required structured output.

## Translation behavior

- English-dominant websites can auto-start translation.
- The user may display original text, English, Chinese, or a combination.
- Do not duplicate the source language as an unnecessary translation layer.
- Use compact `//` translation markers where appropriate.
- Keep translations close to their source and preserve natural paragraph boundaries.
- On dynamic expansion such as X “Show more”, invalidate stale source snapshots and reprocess the expanded content.
- Treat missing/failed blocks as retryable, not completed.

## Learning behavior

For a selected or hovered word/phrase, prefer current-context meaning over dictionary-first meaning.

A saved encounter should preserve:
- word or phrase
- IPA/pronunciation where applicable
- part of speech
- current-context meaning
- source sentence
- page title/URL
- surrounding context
- speaker/video timestamp when available
- encounter count and learning state

Do not flood the learner with automatically generated cards. Preserve all encounters, but keep “actively learning” a deliberate or intelligently suggested subset.

## Release checklist

Before producing a release:

1. Increment `manifest.json` semver.
2. Keep the visible product name exactly `沉浸式翻译&学习` unless the user asks to rename it.
3. Run syntax checks for all JavaScript files, preferably `node --check`.
4. Parse and validate `manifest.json`.
5. Check that popup/options DOM IDs referenced by JS exist.
6. Confirm no API keys, tokens, credentials, cookies, or personal data are included.
7. Package the contents of `extension/` under one stable folder.
8. Report what changed and any parts that could not be fully browser-tested.

## Publishing

This repository is designed to work with the open Agent Skills ecosystem.

The Skill itself helps agents maintain and package the extension. It does **not** silently install the Chrome extension into a user's browser.

For end users, publish the browser ZIP as a GitHub Release asset and document Chrome/Edge developer-mode loading until a store release is available.
