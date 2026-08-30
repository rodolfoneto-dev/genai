# PRD — GenAI Platform Evolution
## Enterprise-Grade AI Consumption & Delivery Architecture

**Status:** Draft for Architecture Review
**Audience:** Senior/Staff Software Architect, Platform Engineering, Backend Engineering, DevOps/SRE
**Repository:** https://github.com/rodolfoneto-dev/genai

---

# 1. Executive Summary

The `genai` repository currently implements a dedicated GenAI microservice responsible for AI-powered features such as conversational tutoring, corrections and exercises.

The service already provides important foundations:

- provider abstraction;
- Gemini and Claude integrations;
- session management;
- authentication and authorization;
- rate limiting;
- usage tracking;
- token accounting;
- estimated AI cost;
- quota management;
- MongoDB persistence;
- REST APIs;
- Dockerized deployment.

The objective of this initiative is NOT to rewrite the current service.

The objective is to evolve the existing GenAI service into a production-grade AI platform capable of supporting enterprise-scale consumption, observability, governance and user-facing AI experiences.

The architecture must preserve the existing business capabilities while creating a clear path toward:

- streaming AI responses;
- robust AI delivery to clients;
- provider resilience and routing;
- enterprise observability;
- AI usage governance;
- asynchronous usage/event processing;
- cost and FinOps visibility;
- scalability;
- reliability;
- security;
- future provider expansion.

The Architect must first analyze the existing repository and validate these assumptions before defining the implementation architecture.

---

# 2. Problem Statement

The current GenAI service is functional and already contains several enterprise-oriented foundations.

However, the current architecture is primarily optimized for synchronous REST request/response interactions.

This creates limitations when the product evolves toward a more sophisticated AI experience.

Current concerns include:

1. AI responses are primarily delivered as complete HTTP responses rather than progressively streamed responses.

2. AI generation, conversation management, usage tracking and delivery concerns are tightly coupled within request execution.

3. Observability is not yet designed specifically around GenAI workloads.

4. Usage persistence is directly connected to the synchronous request lifecycle.

5. Provider resilience and routing exist at an abstraction level but require architectural evaluation for production-scale workloads.

6. The architecture needs a clearer separation between:
   - AI generation;
   - conversation state;
   - response delivery;
   - governance;
   - observability;
   - usage analytics.

7. The platform needs to support future AI providers without creating provider-specific coupling throughout the application.

8. The platform needs to provide sufficient operational information to understand:
   - token consumption;
   - latency;
   - provider failures;
   - model usage;
   - cost;
   - feature consumption;
   - user consumption;
   - AI quality signals.

---

# 3. Product Vision

Transform the current GenAI microservice into a reusable enterprise AI platform.

The platform should allow product teams to consume AI capabilities without needing to understand the implementation details of individual LLM providers.

Conceptually:

                    Product Applications
                           |
                           v
                    GenAI Platform
                           |
             +-------------+-------------+
             |             |             |
          Governance    Delivery      AI Runtime
             |             |             |
             v             v             v
          Quotas         SSE          Providers
          RBAC           APIs         Gemini
          Cost           Events       Claude
          Policies       Streaming    Future LLMs
                                        |
                                        v
                                  Observability

The platform should become an internal abstraction layer between product applications and AI providers.

---

# 4. Goals

## 4.1 Primary Goals

### G1 — Improve AI response delivery

Provide an architecture capable of progressively delivering AI-generated responses to users.

The preferred architectural direction to evaluate is streaming, such as Server-Sent Events (SSE), but the Architect must validate whether SSE is appropriate for all current and future use cases.

The experience should support:

- incremental response delivery;
- completion events;
- error events;
- cancellation;
- connection interruption;
- retry/recovery strategies;
- final usage metadata.

---

### G2 — Establish enterprise GenAI observability

The platform must provide visibility into AI operations.

At minimum, the architecture should allow analysis of:

- request count;
- success/failure rate;
- provider;
- model;
- feature;
- latency;
- time-to-first-token;
- total generation time;
- input tokens;
- output tokens;
- total tokens;
- estimated cost;
- quota consumption;
- provider errors;
- retries;
- fallback events.

OpenTelemetry should be evaluated as the standard instrumentation layer.

The Architect should determine the appropriate observability stack and integration strategy.

---

### G3 — Separate synchronous user experience from usage processing

The user should not depend on secondary analytics or accounting operations completing synchronously.

Conceptually:

User Request
     |
     v
AI Generation
     |
     +---------> User Response
     |
     +---------> Usage Event
                       |
                       v
                Async Processing
                       |
                       v
              Usage / Analytics

The Architect should evaluate whether an event-driven architecture is justified and which technology is appropriate.

Possible technologies may include:

- message queues;
- event streams;
- managed cloud messaging;
- background workers.

No specific technology is mandated by this PRD.

---

### G4 — Strengthen AI provider abstraction

The platform must support multiple LLM providers through a stable internal abstraction.

Current providers include:

- Google Gemini
- Anthropic Claude

Future providers should be possible without significant changes to business logic.

The architecture should support:

- provider selection;
- model selection;
- fallback;
- timeout;
- retry;
- circuit breaking;
- provider-specific error normalization;
- provider health;
- model capability differences.

---

### G5 — Establish AI governance

The platform must provide centralized governance mechanisms for AI consumption.

The architecture should support:

- authentication;
- authorization;
- RBAC;
- rate limiting;
- quotas;
- feature-level limits;
- token limits;
- cost controls;
- usage tracking;
- auditability.

Future policy capabilities should be possible without redesigning the entire service.

---

### G6 — Prepare for scale

The platform should be horizontally scalable.

The architecture must consider:

- stateless application instances;
- concurrent AI requests;
- streaming connections;
- provider rate limits;
- MongoDB scalability;
- connection management;
- queue/event throughput;
- backpressure;
- autoscaling;
- graceful degradation.

The target scale must be defined during architecture analysis rather than assumed.

---

# 5. Non-Goals

This initiative does NOT initially aim to:

- build a proprietary LLM;
- train/fine-tune foundation models;
- replace MongoDB without architectural justification;
- rewrite the service in Python;
- replace Node.js/Express solely for technology preference;
- introduce Kubernetes solely to make the architecture appear enterprise;
- introduce Kafka without a demonstrated need;
- introduce GraphQL without a demonstrated product requirement;
- implement every possible AI provider;
- build a complete AI agent platform;
- implement RAG unless required by a concrete product capability.

Technology decisions must be driven by requirements and operational constraints.

---

# 6. Current Architecture

The current service should be treated as the starting point.

Conceptually:

Frontend
   |
   v
API
   |
   v
GenAI Service
   |
   +---- LlmService
   |       |
   |       +---- Gemini Adapter
   |       |
   |       +---- Claude Adapter
   |
   +---- Session Management
   |
   +---- Usage Tracking
   |
   +---- Quota
   |
   +---- RBAC
   |
   v
MongoDB

The Architect MUST inspect the repository before proposing the target architecture.

Repository:

https://github.com/rodolfoneto-dev/genai

The architecture review should validate:

- current service boundaries;
- routes;
- services;
- models;
- provider adapters;
- error handling;
- authentication;
- authorization;
- quota implementation;
- rate limiting;
- persistence;
- usage logging;
- configuration;
- Docker;
- tests;
- deployment assumptions.

---

# 7. Target Architectural Capabilities

The target architecture should be evaluated around the following capabilities.

## 7.1 AI Generation

Responsible for:

- prompt execution;
- provider selection;
- model selection;
- generation;
- provider fallback;
- retries;
- timeouts;
- cancellation.

---

## 7.2 Conversation Management

Responsible for:

- sessions;
- messages;
- conversation state;
- CEFR level;
- topic;
- context management;
- persistence.

---

## 7.3 AI Delivery

Responsible for:

- synchronous responses where appropriate;
- streaming responses;
- SSE;
- connection lifecycle;
- partial responses;
- completion events;
- error events;
- cancellation.

The Architect should determine whether SSE, WebSockets or another mechanism is most appropriate.

---

## 7.4 Governance

Responsible for:

- authentication;
- RBAC;
- rate limiting;
- quotas;
- token budgets;
- cost budgets;
- feature policies;
- auditing.

---

## 7.5 Usage & FinOps

Responsible for:

- token accounting;
- cost estimation;
- provider/model usage;
- feature consumption;
- user consumption;
- organizational consumption;
- cost attribution.

The architecture should distinguish transactional application data from analytical/usage data where appropriate.

---

## 7.6 Observability

Responsible for:

- logs;
- metrics;
- traces;
- GenAI-specific telemetry;
- provider latency;
- time-to-first-token;
- token usage;
- errors;
- retries;
- fallback;
- cost signals.

OpenTelemetry should be evaluated.

---

## 7.7 Asynchronous Processing

Potential asynchronous workloads include:

- usage events;
- cost aggregation;
- analytics;
- audit events;
- notifications;
- long-running AI tasks.

The Architect should determine which operations require asynchronous processing.

---

# 8. User Experience Requirements

The AI experience should feel responsive even when model generation takes several seconds.

For conversational features, the preferred experience is:

User sends message
        |
        v
Request accepted
        |
        v
First AI tokens arrive
        |
        v
UI renders progressively
        |
        v
AI response completes
        |
        v
Final metadata available

The user should not need to wait for:

- analytics;
- cost calculation;
- usage persistence;
- secondary logging;
- non-critical background processing.

before seeing the AI response.

---

# 9. Reliability Requirements

The architecture should define strategies for:

### Provider failure

Gemini unavailable
      |
      v
Provider health evaluation
      |
      v
Fallback provider

### Timeout

AI request exceeds configured timeout
      |
      v
Cancel generation
      |
      v
Return controlled error

### Client disconnect

User closes browser
      |
      v
Detect disconnected stream
      |
      v
Cancel upstream generation where possible

### Rate limiting

Excessive usage
      |
      v
Reject/throttle request
      |
      v
Return actionable response

### Provider throttling

Provider returns rate-limit response
      |
      v
Backoff / retry / fallback

The Architect should define the appropriate policies and failure boundaries.

---

# 10. Security Requirements

The architecture must consider:

- authentication;
- authorization;
- secrets management;
- provider API key protection;
- prompt injection;
- sensitive data handling;
- logging of AI requests;
- PII exposure;
- tenant isolation if multi-tenancy is introduced;
- audit trails;
- abuse prevention.

Prompts and generated responses should not automatically be treated as safe-to-log data.

The architecture should explicitly define what is and is not persisted.

---

# 11. Scalability Requirements

The platform should support horizontal scaling.

The Architect should investigate:

- statelessness;
- streaming connection scalability;
- provider concurrency;
- request queues;
- MongoDB connection pools;
- rate-limit consistency across instances;
- quota consistency across instances;
- distributed locks where necessary;
- caching;
- backpressure;
- autoscaling.

The Architect should propose measurable scalability targets rather than generic claims of "high scale".

---

# 12. Multi-Tenancy Consideration

The platform is expected to potentially serve multiple products/organizations in the future.

Multi-tenancy should therefore be considered in the architecture even if it is not implemented immediately.

The Architect should evaluate:

- tenant identification;
- tenant isolation;
- tenant-level quotas;
- tenant-level cost attribution;
- tenant-level RBAC;
- tenant-level usage;
- tenant-specific provider policies.

However, multi-tenancy should not be implemented solely because it is theoretically possible.

---

# 13. Data Architecture

Current persistence uses MongoDB.

The Architect must evaluate whether MongoDB remains appropriate.

Do NOT assume migration to another database.

The review should classify data into:

### Transactional

Examples:

- sessions;
- messages;
- user AI state.

### Operational

Examples:

- usage events;
- request metadata;
- audit information.

### Analytical

Examples:

- cost trends;
- token consumption;
- provider utilization;
- feature analytics.

The Architect should determine whether these categories should remain in the same datastore.

---

# 14. API Evolution

Current REST APIs should remain backward compatible where practical.

The architecture should evaluate:

- versioning;
- streaming endpoints;
- response schemas;
- error contracts;
- idempotency;
- correlation IDs;
- request IDs;
- cancellation;
- pagination;
- rate-limit headers.

The API should expose stable business-level contracts rather than leaking provider-specific structures.

---

# 15. Observability Model

Each AI request should ideally be traceable across:

Frontend
   |
API Gateway
   |
GenAI Service
   |
AI Provider
   |
Usage Processing

A correlation/trace identifier should allow operators to answer:

"Why did this AI request take 8 seconds?"

and:

"Why did this request cost more than expected?"

and:

"Which provider caused the failure?"

---

# 16. Cost & FinOps Requirements

The architecture should allow cost attribution by:

- tenant;
- user;
- feature;
- provider;
- model;
- time period.

Example:

Tenant A
  |
  +-- Tutor
  |     +-- Gemini
  |     +-- Claude
  |
  +-- Correction
  |
  +-- Exercise Generation

The system should distinguish:

- estimated cost;
- provider-reported cost where available;
- token usage;
- business attribution.

Cost data must be auditable.

---

# 17. Architecture Principles

The Architect should follow these principles:

### P1 — Do not rewrite working systems without evidence.

### P2 — Prefer simple architectures until scale requires complexity.

### P3 — Separate business logic from provider-specific implementation.

### P4 — Make AI providers replaceable.

### P5 — Treat observability as a first-class capability.

### P6 — Do not make analytics block user experience.

### P7 — Design streaming as a delivery concern.

### P8 — Keep application state separate from telemetry concerns.

### P9 — Prefer managed infrastructure when operationally justified.

### P10 — Every additional infrastructure component must have an explicit reason.

---

# 18. Architecture Questions for the Senior Architect

The Architect MUST explicitly answer:

1. Is the current Node.js/Express architecture appropriate for the expected workload?

2. Should the service remain REST-based?

3. Is SSE the correct streaming mechanism?

4. Where should streaming terminate?

5. Should the AI provider call itself be streamed?

6. Should usage tracking become event-driven?

7. Is MongoDB sufficient for transactional and usage workloads?

8. Should analytical workloads be separated?

9. Is an explicit AI Gateway required?

10. Should provider routing live inside the GenAI service or in a separate platform component?

11. What resilience patterns are required?

12. What should be synchronous vs asynchronous?

13. What observability stack should be adopted?

14. Should OpenTelemetry be introduced now or later?

15. How should quotas work in a horizontally scaled environment?

16. How should rate limiting work across multiple instances?

17. What happens when a client disconnects during generation?

18. How should provider failures and retries be handled?

19. How should prompts and generated responses be protected from inappropriate logging?

20. What architectural changes are actually necessary for enterprise readiness?

---

# 19. Expected Architecture Deliverables

The Architect should produce:

### D1 — Current State Architecture

Diagram of the existing system.

### D2 — Target State Architecture

Proposed architecture after evolution.

### D3 — Architecture Decision Records

At minimum:

- streaming mechanism;
- observability;
- async processing;
- provider abstraction;
- persistence;
- scalability strategy.

### D4 — Capability Map

Map capabilities to architectural components.

### D5 — Epic Breakdown

Convert architectural capabilities into implementation epics.

### D6 — Dependency Map

Identify dependencies between epics.

### D7 — Migration Strategy

The system must evolve incrementally.

Avoid a big-bang rewrite.

### D8 — Risks

Identify:

- technical risks;
- operational risks;
- cost risks;
- security risks;
- vendor risks;
- scalability risks.

---

# 20. Suggested Epic Areas

These are starting hypotheses, NOT mandatory implementation epics.

The Architect should validate and reorganize them.

## Epic A — AI Delivery & Streaming

Goal:

Provide a responsive streaming AI experience.

Potential capabilities:

- SSE;
- token streaming;
- completion events;
- cancellation;
- error handling;
- client reconnection.

---

## Epic B — GenAI Observability

Goal:

Make AI workloads observable.

Potential capabilities:

- OpenTelemetry;
- traces;
- metrics;
- structured logs;
- provider telemetry;
- latency metrics;
- TTFT;
- token metrics.

---

## Epic C — Asynchronous Usage Processing

Goal:

Decouple usage/accounting from the critical user request path.

Potential capabilities:

- usage events;
- queue/event bus;
- worker;
- retry;
- dead-letter handling;
- idempotency.

---

## Epic D — AI Provider Resilience

Goal:

Increase reliability across LLM providers.

Potential capabilities:

- timeout;
- retry;
- exponential backoff;
- circuit breaker;
- fallback;
- provider health;
- model routing.

---

## Epic E — AI Governance & FinOps

Goal:

Control and understand AI consumption.

Potential capabilities:

- tenant quotas;
- user quotas;
- feature quotas;
- token budgets;
- cost budgets;
- cost attribution;
- usage dashboards.

---

## Epic F — AI Platform API Evolution

Goal:

Create stable contracts for consuming AI capabilities.

Potential capabilities:

- API versioning;
- streaming contracts;
- standardized errors;
- correlation IDs;
- idempotency;
- cancellation;
- provider-independent schemas.

---

## Epic G — Production Scalability

Goal:

Prepare the service for horizontally scaled production environments.

Potential capabilities:

- statelessness;
- distributed rate limiting;
- distributed quota enforcement;
- connection management;
- autoscaling;
- backpressure;
- graceful shutdown.

---

# 21. Definition of Architectural Success

The architecture will be considered successful when:

1. AI responses can be delivered progressively to users.

2. User experience does not depend on secondary usage/analytics operations.

3. Operators can trace an AI request end-to-end.

4. Token consumption and cost can be attributed to meaningful business dimensions.

5. Provider failures can be detected and handled gracefully.

6. New LLM providers can be introduced without modifying core business logic.

7. The service can scale horizontally.

8. Governance policies can be applied centrally.

9. AI-related operational failures can be diagnosed without inspecting application code manually.

10. The architecture remains understandable and does not introduce infrastructure complexity without measurable value.

---

# 22. Important Instruction to the Architect

DO NOT immediately implement the technologies mentioned in this document.

First:

1. Inspect the repository.
2. Understand the current architecture.
3. Identify what is already production-grade.
4. Identify actual architectural gaps.
5. Validate assumptions.
6. Challenge the proposed capabilities.
7. Propose alternatives where appropriate.
8. Define the target architecture.
9. Create ADRs.
10. Only then derive implementation epics.

The purpose of this PRD is to establish the desired architectural outcomes, not to prescribe implementation details.

The Architect should be free to reject:

- SSE;
- OpenTelemetry;
- event-driven usage processing;
- Kafka;
- Redis;
- Kubernetes;
- API Gateway;
- separate analytics storage;

if the repository analysis and expected scale demonstrate that they are unnecessary.

The final architecture should optimize for:

**User experience + reliability + observability + cost control + maintainability + evolutionary scalability.**
