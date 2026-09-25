# Relay — submission guide

## What to show the judges

Relay routes customer support questions between a small local FAQ model and a stronger local model. It records the decision path, safely handles an advanced-model outage, and lets a reviewer replay routing choices and improve answers through preference feedback. The customer sees a simple chat; the company sees the decision monitor, cost comparison, knowledge base, and review queue.

## Start a clean checkout

1. Install Node.js 20+ and Ollama.
2. In PowerShell, run `Copy-Item .env.example .env`, then `ollama pull qwen3:1.7b` and `ollama pull deepseek-r1:8b`.
3. Start Ollama and run `node server.mjs` in the repository. Open `http://localhost:3000/` and confirm **FREE LOCAL MODELS** appears.
4. Optionally, on a fresh data store only, run `node scripts/seed-live-demo.mjs` in another terminal. This creates six synthetic conversations using actual local model calls and checks their routes. It also adds feedback and a human review ticket. The script fails if the expected live model routes do not work.

No npm dependencies, paid API keys, or cloud services are required. Local model downloads and inference use the machine's disk, memory, and electricity. The `data/` directory and `.env` are excluded from Git.

## Three-minute demo

1. Ask a refund FAQ in **Customer view**; inspect its local route and policy citation in **Company view**.
2. Ask about a conflicting signed agreement; show the advanced local route and offer of human review.
3. Turn on **Simulate advanced outage** in Company view, ask the contract question again, and show the fallback trace.
4. Click **Replay this conversation** and change the threshold to compare route decisions.
5. Open **Insights & feedback** to show the cost scenario, rate an answer, save a preferred correction, and export the JSONL data.
6. Request human review and show the ticket in the company queue.

## Verification

Run `node --test` for the end-to-end API journey and unit tests, then `node scripts/evaluate.mjs` for the 23-case routing set. The automated journey covers local FAQ routing, scope rejection, outage fallback, replay, cost comparison, feedback export, and human tickets. `scripts/seed-live-demo.mjs` verifies live local model behavior, whereas unit tests use controlled responses. See [README.md](README.md) for architecture, cost assumptions, and limits.

## Honest boundaries

Policies are fictional examples. The cost panel is an illustrative paid-model scenario, not a measured bill; local hardware and power are excluded. Saved preference pairs support later offline training, but this release does not train or deploy a tuned model. The customer and company views share one local process without account authentication, so this is a hackathon prototype rather than a public production service.
