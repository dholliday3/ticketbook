---
id: TKTB-050
title: Platform agent runtime and model gateway
status: backlog
tags:
  - agent-experience
  - architecture
  - important
  - deferred-desktop
  - agent-editor
relatedTo:
  - TKTB-049
  - TKTB-047
created: '2026-04-05T08:00:00.000Z'
updated: '2026-04-12T03:56:41.512Z'
---

## The Problem

There are two distinct classes of agents in the ticketbook ecosystem:

1. **Coding agents** — Claude Code, Codex, Cursor, etc. These are external, user-chosen, flagship tools for writing code. Users bring their own. We integrate with them (MCP, skills) but don't run them.

2. **Platform agents** — the ambient/proactive agents from TKTB-049 (code reviewer, daily briefing, project manager, harness evaluator, prompt curator). These are OUR agents. We run them. We control the runtime.

The coding agents are expensive (Opus/Sonnet, long context, tool use) because they need to be — they're writing production code. But most platform agents don't need that. A daily briefing summarizer doesn't need Opus. A stale-skill detector doesn't need 200K context. Running all platform agents through a flagship coding agent API is wasteful and expensive.

**We need our own lightweight agent runtime with a model gateway that routes to the right model for the job.**

## Architecture

### Two-Tier Agent System

```
┌─────────────────────────────────┐
│  Coding Agents (user's choice)  │  ← Claude Code, Codex, Cursor
│  Integrate via MCP/skills       │  ← Expensive, full capability
│  User pays, user configures     │  ← We don't control runtime
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Platform Agents (we run)       │  ← Briefing, reviewer, PM, eval
│  Our runtime, our model choice  │  ← Cheap, fit-for-purpose
│  Smart model routing            │  ← Local, OpenRouter, AI Gateway
└─────────────────────────────────┘
```

### Model Gateway

A thin abstraction layer that routes agent prompts to the appropriate model:

**Model tiers:**
- **Local models** (Ollama, llama.cpp): Free, private, good for simple classification, summarization, pattern detection. Perfect for: harness eval, stale ticket detection, prompt similarity matching.
- **Cheap cloud models** (Haiku, GPT-4o-mini, Gemini Flash via OpenRouter/Vercel AI Gateway): Pennies per call, good for structured extraction, briefings, reviews of small diffs. Perfect for: daily briefings, ticket status summaries, simple code review.
- **Capable cloud models** (Sonnet, GPT-4o): More expensive but still cheaper than Opus. For: detailed code review, plan generation, complex analysis.
- **Flagship models** (Opus, o3): Only when needed. For: architecture decisions, complex refactoring plans. Probably rare for platform agents.

**Routing logic:**
Each agent definition specifies a model tier or specific model, with fallback:
```yaml
# .agents/daily-briefing.yaml
model:
  preferred: local/llama3.2  # try local first
  fallback: openrouter/anthropic/claude-3-haiku  # fall back to cheap cloud
  max_cost_per_run: 0.01  # cost guardrail
```

### Model Provider Integrations

Support multiple backends through a unified interface:

- **OpenRouter** (`https://openrouter.ai/api/v1`) — single API key, 200+ models, usage-based pricing
- **Vercel AI Gateway** — similar multi-provider routing
- **Ollama** (`http://localhost:11434`) — local models, zero cost, zero latency
- **Direct API** — Anthropic, OpenAI, Google directly with user's API keys
- **Claude Code** — for agents that genuinely need tool use and coding capability, delegate to a claude code subprocess

### Platform Agent Runtime

Our own lightweight runtime (not claude code):

```typescript
interface AgentRuntime {
  // Run an agent with a prompt and get structured output
  run(config: AgentConfig): Promise<AgentResult>;
}

interface AgentConfig {
  prompt: string;
  model: ModelSpec;          // which model tier/provider
  context?: string[];        // files/tickets to include
  outputFormat?: "text" | "json" | "markdown";
  maxTokens?: number;
  tools?: AgentTool[];       // lightweight tool use (read file, query SQLite)
}
```

This is intentionally simpler than a coding agent. Platform agents don't need:
- File editing
- Shell access (usually)
- Complex multi-turn tool use
- Git operations

They need:
- Read access to tickets, plans, config
- Write access to notifications, agent notes
- Structured output (JSON for data, markdown for reports)
- Basic tool use (query SQLite, read files)

### Cost Management

- Per-agent cost tracking (stored in SQLite)
- Global budget limits: "don't spend more than $X/day on platform agents"
- Cost dashboard in the UI: which agents cost how much, trends over time
- Smart defaults: local models for simple tasks, cheap cloud for medium, expensive only when explicitly configured

## Implementation Phases

### Phase 1: Core Runtime
- Model gateway abstraction with Ollama + OpenRouter support
- Simple agent runner: prompt in, text/JSON out
- Configuration via `.agents/` YAML files
- Cost tracking in SQLite

### Phase 2: Agent Integration
- Wire up to TKTB-049 ambient agents (daily briefing, reviewer, etc.)
- Trigger system (cron + events)
- Output routing to notification feed

### Phase 3: Smart Routing
- Auto-detect which model tier fits the task based on prompt complexity
- Fallback chains (local → cheap cloud → capable cloud)
- Caching for repeated/similar queries
- Batch processing for efficiency

### Phase 4: Local Model Optimization
- Bundle Ollama setup instructions or auto-detect
- Recommend specific local models for each agent type
- Fine-tuning pipeline: use expensive model outputs to fine-tune cheaper models for your specific project patterns

## The Key Insight

The platform's agents should be nearly free to run. If a daily briefing costs $0.50/day via Opus, nobody will enable it. If it costs $0.001/day via a local model or Haiku, everyone will. The model gateway is what makes ambient agents economically viable.

This is the same insight behind how monitoring/observability tools work — the observability system itself can't be more expensive than the thing it's observing. Our platform agents need to be cheap enough that they're always-on without the user thinking about cost.

## Open Questions

- Should we build the model gateway as a separate package (`@ticketbook/ai`) or keep it in the server?
- How do we handle API key management? Store in SQLite (encrypted)? Read from env vars? Use system keychain?
- Should platform agents be able to call coding agents for specific tasks? (e.g., reviewer agent detects an issue and spawns a claude code session to fix it)
- How do we test agents? Need a way to dry-run an agent with mock data.
- What's the minimum viable local model that's useful? Llama 3.2 3B? Phi-3? Qwen?
