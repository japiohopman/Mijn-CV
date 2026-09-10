# 🏛️ Portfolio Secretary — Product & Architecture Definition

> **Phase 8 Specification Document**
> **Status:** Canonical Architecture Specification (Deterministic Non-LLM Core)
> **Scope:** Product Vision, Architectural Layers, Knowledge Registry Model, Intent Catalog, Action Tool Contracts, and LLM Boundary.

---

## 1. Executive Summary & Product Vision

### 1.1 Problem Statement
Visitors to Jaap Hopman's portfolio (recruiters, engineering leads, clients, and collaborators) often arrive with specific questions: *What does Jaap build?*, *Where can I see his D&D AI project?*, *Does he have kitchen leadership experience?*, or *How do I get in touch?*.

While the site features a clear visual hierarchy and responsive navigation, visitors must manually browse sections to find specific answers or trigger actions.

### 1.2 Product Vision: The "Site Secretary"
The **Portfolio Secretary** is a lightweight, responsive digital assistant embedded in the portfolio. Rather than acting as a generic conversational chatbot or "pretending to think" via ungrounded LLM stream generation, the Secretary operates as a **fast, deterministic query engine**.

Key principles:
1. **Deterministic First**: Answers are retrieved strictly from canonical repository data (e.g., `POSITIONING.md`, EJS view templates, route definitions).
2. **Action-Oriented**: Answers are paired with explicit tool calls (e.g., navigating to sections, opening project modals, opening the Kitchen CV, or jumping to contact).
3. **Zero External AI Dependencies**: The core system runs locally in the browser/client without external LLM API keys or network latency.
4. **Predictable & Testable**: Every intent, query match, answer template, and tool call signature is fully unit-testable and schema-validated.

---

## 2. System Architecture & Component Layers

The Secretary architecture decouples knowledge storage, intent evaluation, action execution, rendering, and future natural language processing into five isolated layers:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                             USER INPUT / INTERFACE                              │
│         (Search / Chat Input, Suggested Question Chips, Action Buttons)         │
└────────────────────────┬────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: INTENT & QUERY ENGINE                               │
│  - Matcher Pipeline (Exact Keyword, RegEx Pattern, Keyword Density Score)       │
│  - Confidence Threshold & Fallback Handler                                      │
└────────────────────────┬────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                   LAYER 2: CANONICAL KNOWLEDGE REGISTRY                         │
│  - Structured Facts (Identity, Projects, Skills, Background, Contact)            │
│  - Single Source of Truth mapped to Repo Files (POSITIONING.md, EJS partials)   │
└────────────────────────┬────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                   LAYER 3: ACTION & TOOL EXECUTION ENGINE                       │
│  - Strict Allow-List Execution Engine                                           │
│  - Action Contracts: navigateToSection, navigateToRoute, openProject, etc.       │
└────────────────────────┬────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       LAYER 4: SECRETARY UI RENDERER                            │
│  - Accessible Conversation History, Action Button Chips, Focus Management      │
└─────────────────────────────────────────────────────────────────────────────────┘
                         ▲
                         │ (Optional Future Extension - Phase 9)
┌────────────────────────┴────────────────────────────────────────────────────────┐
│                   LAYER 5: LLM ADAPTER BOUNDARY (PHASE 9)                        │
│  - Maps complex natural language to Layer 1 Intent IDs and Layer 3 Tool Calls   │
│  - STRICT RULE: LLM cannot bypass Knowledge Registry or invent unverified actions│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Canonical Knowledge Registry & Answer Source Mapping

The knowledge base is stored in a structured JSON schema (`public/data/secretary_knowledge.json` or JS module). All factual claims are grounded directly in repository files.

### 3.1 Mapping of Facts to Repository Artifacts

| Topic Domain | Knowledge Items | Canonical Repository Source File |
| :--- | :--- | :--- |
| **Professional Identity** | Core positioning, title, primary value proposition, location. | `POSITIONING.md` (§1), `views/partials/head.ejs`, `views/index.ejs` |
| **Projects & Proof** | Artificer (D&D simulation engine), Global Conquest (strategy game), SuperMail (AI email intelligence), GitHub Action card (11k+ contributions). | `views/partials/projecten.ejs`, `POSITIONING.md` (§3.4), `GOALS.md` |
| **Skills & Architecture** | Core stack (TypeScript, React, Node.js, Python), AI & interactive tools, mindset & culinary leadership background. | `views/partials/skills.ejs`, `POSITIONING.md` (§3.3) |
| **Career & Background** | Progression from chef/culinary leadership to creative development, DJing/music, chess strategy. | `views/partials/over.ejs`, `views/partials/ervaring.ejs`, `POSITIONING.md` (§3.2) |
| **Kitchen CV Bridge** | Dedicated route `/keuken-cv`, culinary achievements, hospitality leadership, link between software & kitchen execution. | `views/keuken_cv.ejs`, `POSITIONING.md` (§3.5) |
| **Contact & Outreach** | Contact form options, email submission API, share page route `/share`, social links. | `views/partials/footer.ejs`, `views/share.ejs`, `server.js` |
| **Privacy & Policy** | Zero client-side tracking, no third-party cookies, privacy-first contact submission. | `PRIVACY.md`, `README.md` |

---

## 4. Enumerated Intent Catalog

The Intent Matcher evaluates user inputs against an enumerated catalog of intents. Every supported intent has defined keyword triggers, regex patterns, answer text, and associated tool calls.

### 4.1 Supported Intent Enumeration

#### Intent 1: `identity.overview`
* **Triggers / Keywords:** `"wie is Jaap"`, `"wie ben jij"`, `"wat doet Jaap"`, `"over Jaap"`, `"profiel"`, `"introductie"`
* **Regex:** `/wie\s+is\s+jaap|wat\s+doet\s+jaap|stel\s+jezelf\s+voor|over\s+jaap/i`
* **Answer Source:** `POSITIONING.md` (§1)
* **Retrieved Answer:** *"Jaap Hopman is een Creative Developer & Technologist uit Amsterdam. Hij bouwt interactieve webapplicaties, games en AI-gedreven tools met TypeScript, React en Node.js, met de executiekracht uit de professionele keuken."*
* **Associated Tool:** `navigateToSection({ anchor: "#over" })`

#### Intent 2: `projects.list`
* **Triggers / Keywords:** `"welke projecten"`, `"projecten"`, `"wat heeft hij gebouwd"`, `"portfolio"`, `"work"`, `"demonstraties"`
* **Regex:** `/welke\s+projecten|wat\s+heeft\s+hij\s+gebouwd|bekijk\s+projecten|portfolio/i`
* **Answer Source:** `views/partials/projecten.ejs`
* **Retrieved Answer:** *"Jaap heeft diverse featured projecten gebouwd, waaronder Artificer (AI D&D engine), Global Conquest (satirische strategiegame) en SuperMail (AI e-mail intelligence)."*
* **Associated Tool:** `navigateToSection({ anchor: "#projecten" })`

#### Intent 3: `projects.artificer`
* **Triggers / Keywords:** `"artificer"`, `"dnd"`, `"dungeons and dragons"`, `"dice simulator"`, `"roll initiative"`
* **Regex:** `/artificer|d&d|dungeons|dobbelsteen/i`
* **Answer Source:** `views/partials/projecten.ejs` (§Artificer), `GOALS.md`
* **Retrieved Answer:** *"Artificer is een AI-gestuurde D&D 5e simulatieplatform dat een LLM Dungeon Master koppelt aan TypeScript spellogica, persistentie en een interactieve dobbelsteen-simulator."*
* **Associated Tool:** `openProject({ projectId: "artificer" })`

#### Intent 4: `projects.conquest`
* **Triggers / Keywords:** `"global conquest"`, `"conquest"`, `"board game"`, `"tactical game"`, `"kaart"`
* **Regex:** `/global\s+conquest|conquest|strategiegame/i`
* **Answer Source:** `views/partials/projecten.ejs` (§Global Conquest)
* **Retrieved Answer:** *"Global Conquest is een satirische, tactische turn-based strategiegame met een interactieve wereldkaart en live browser demo."*
* **Associated Tool:** `openProject({ projectId: "global-conquest" })`

#### Intent 5: `skills.overview`
* **Triggers / Keywords:** `"welke skills"`, `"technologieën"`, `"talen"`, `"stack"`, `"typescript"`, `"react"`, `"node"`
* **Regex:** `/welke\s+skills|welke\s+talen|tech\s+stack|ervaring\s+met/i`
* **Answer Source:** `views/partials/skills.ejs`
* **Retrieved Answer:** *"Jaap's kernstack bestaat uit TypeScript, React, Node.js en Express, aangevuld met AI-integraties (LLM API's, Whisper), Python, Phaser/Godot gamesystemen en UI/UX design."*
* **Associated Tool:** `navigateToSection({ anchor: "#skills" })`

#### Intent 6: `background.culinary_bridge`
* **Triggers / Keywords:** `"horeca"`, `"keuken"`, `"chef"`, `"kok"`, `"achtergrond"`, `"waarom overstap"`
* **Regex:** `/horeca|keuken|kok|chef|culinair/i`
* **Answer Source:** `views/partials/over.ejs`, `views/keuken_cv.ejs`
* **Retrieved Answer:** *"Jaap heeft jarenlange leidinggevende ervaring in professionele keukens. Deze achtergrond levert een hoge drukbestendigheid, voorbereidingsdiscipline, snelheid en eigenaarschap op bij software-ontwikkeling."*
* **Associated Tool:** `openKitchenCV()`

#### Intent 7: `contact.options`
* **Triggers / Keywords:** `"contact"`, `"hoe neem ik contact op"`, `"e-mail"`, `"bericht sturen"`, `"inhuren"`, `"samenwerken"`
* **Regex:** `/contact|e-mail|bericht|samenwerken|inhuren/i`
* **Answer Source:** `views/partials/footer.ejs`
* **Retrieved Answer:** *"Je kunt direct contact opnemen via het contactformulier onderaan de pagina, of stuur een e-mail naar info@jaaphopman.com."*
* **Associated Tool:** `navigateToSection({ anchor: "#contact" })`

#### Intent 8: `route.share`
* **Triggers / Keywords:** `"delen"`, `"qr code"`, `"share"`, `"mobiel delen"`, `"whatsapp"`
* **Regex:** `/delen|qr|share|whatsapp/i`
* **Answer Source:** `views/share.ejs`
* **Retrieved Answer:** *"De speciale deelpagina bevat een mobielvriendelijke QR-code en snelle snelkoppelingen voor WhatsApp, e-mail en het kopiëren van de portfolio-link."*
* **Associated Tool:** `openShare()`

#### Intent 9: `fallback.unknown`
* **Triggers:** Any input that does not match any recognized intent pattern above confidence threshold `0.35`.
* **Retrieved Answer:** *"Ik heb deze specifieke vraag niet direct herkend in de portfolio-kennisbank. Probeer een van de voorgestelde onderwerpen of navigeer direct via de knoppen hieronder:"*
* **Associated Tool / Action Options:** `[ "Bekijk Projecten", "Bekijk Skills", "Open Keuken-CV", "Contact Opnemen" ]`

---

## 5. Action & Tool Execution Contracts

To ensure strict security, reliability, and testability, the UI execution engine accepts only valid tool calls adhering to explicit JSON Schemas. The assistant is **strictly prohibited** from generating arbitrary JavaScript, executing external URLs outside an allow-list, or altering DOM nodes outside designated secretary targets.

### 5.1 Tool Allow-List & Signatures

#### Tool 1: `navigateToSection`
Navigates smooth-scrollingly to a specific section anchor on the current page.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "navigateToSectionContract",
  "type": "object",
  "properties": {
    "tool": { "type": "string", "enum": ["navigateToSection"] },
    "parameters": {
      "type": "object",
      "properties": {
        "anchor": {
          "type": "string",
          "enum": ["#over", "#projecten", "#skills", "#ervaring", "#contact"]
        }
      },
      "required": ["anchor"]
    }
  },
  "required": ["tool", "parameters"]
}
```

#### Tool 2: `navigateToRoute`
Navigates the browser to an allowed internal application route.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "navigateToRouteContract",
  "type": "object",
  "properties": {
    "tool": { "type": "string", "enum": ["navigateToRoute"] },
    "parameters": {
      "type": "object",
      "properties": {
        "route": {
          "type": "string",
          "enum": ["/", "/share", "/keuken-cv"]
        }
      },
      "required": ["route"]
    }
  },
  "required": ["tool", "parameters"]
}
```

#### Tool 3: `openProject`
Scrolls to and highlights a specific project card or triggers its details disclosure.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "openProjectContract",
  "type": "object",
  "properties": {
    "tool": { "type": "string", "enum": ["openProject"] },
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string",
          "enum": ["artificer", "global-conquest", "supermail"]
        }
      },
      "required": ["projectId"]
    }
  },
  "required": ["tool", "parameters"]
}
```

#### Tool 4: `openKitchenCV`
Navigates directly to `/keuken-cv` or highlights the Kitchen CV bridge banner.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "openKitchenCVContract",
  "type": "object",
  "properties": {
    "tool": { "type": "string", "enum": ["openKitchenCV"] },
    "parameters": { "type": "object", "properties": {} }
  },
  "required": ["tool"]
}
```

#### Tool 5: `openShare`
Navigates directly to the `/share` route.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "openShareContract",
  "type": "object",
  "properties": {
    "tool": { "type": "string", "enum": ["openShare"] },
    "parameters": { "type": "object", "properties": {} }
  },
  "required": ["tool"]
}
```

---

## 6. Deterministic Logic vs. LLM Adapter Boundary (Phase 9 Boundary)

While Phase 8 specifies a 100% deterministic, non-LLM core, the architecture provides a clean adapter boundary for optional future Phase 9 natural language enhancement:

```
                            ┌──────────────────────────────────────────────┐
                            │    UNSTRUCTURED NATURAL LANGUAGE USER INPUT  │
                            └──────────────────────┬───────────────────────┘
                                                   │
                                                   ▼
                               ┌────────────────────────────────────────┐
                               │   OPTIONAL PHASE 9 LLM ADAPTER LAYER   │
                               │  - Parses natural language phrasing    │
                               │  - Maps input to known Intent ID       │
                               │  - Formats Tool Call payload           │
                               └───────────────────┬────────────────────┘
                                                   │
                                                   │ Must emit strictly valid
                                                   │ Intent Result JSON
                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          DETERMINISTIC KNOWLEDGE & TOOL ENGINE                          │
│                                                                                         │
│  - Verifies Intent ID against Canonical Knowledge Registry                              │
│  - Validates Tool Call Payload against Tool JSON Schemas                                │
│  - Retrieves grounded answer text directly from repository data                        │
│  - Executes UI Action via Tool Allow-List                                              │
│                                                                                         │
│  * CRITICAL GUARANTEE: The LLM NEVER generates answer facts or unverified URLs directly. │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Strict Architectural Constraints for Future LLM Adapters
1. **Fact Authorization**: The LLM is **never** permitted to generate biographical, project, or contact claims outside the knowledge registry.
2. **Action Allow-List**: The LLM can only emit tool calls defined in §5. Any unrecognized tool call signature is rejected instantly by the Tool Execution Engine.
3. **Graceful Fallback**: If the LLM provider experiences latency, rate limits, or failure, the system falls back seamlessly to the Layer 1 deterministic matcher without interrupting UI availability.

---

## 7. Data Models & Interface Contracts (TypeScript Specifications)

For future implementation steps (Knowledge Registry and Intent Engine), the system relies on the following TypeScript interfaces:

```typescript
/**
 * Represents a grounded fact item in the Secretary Knowledge Registry.
 */
export interface KnowledgeItem {
  id: string;
  domain: 'identity' | 'projects' | 'skills' | 'background' | 'contact' | 'privacy';
  sourceFile: string;
  summary: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Definition of a supported intent in the Query Engine.
 */
export interface IntentDefinition {
  intentId: string;
  keywords: string[];
  patterns: RegExp[];
  answerText: string;
  knowledgeSource: string;
  toolCall?: ToolCallPayload;
  suggestedFollowUps?: string[];
}

/**
 * Validated Tool Call Payload.
 */
export interface ToolCallPayload {
  tool: 'navigateToSection' | 'navigateToRoute' | 'openProject' | 'openKitchenCV' | 'openShare';
  parameters?: Record<string, unknown>;
}

/**
 * Query Engine Output returned to the UI Renderer.
 */
export interface SecretaryQueryResponse {
  matchedIntentId: string;
  confidenceScore: number;
  answerText: string;
  sourceFile: string;
  toolCall?: ToolCallPayload;
  suggestedQuestions: string[];
}
```

---

## 8. Summary of Acceptance & Verification Checklist

- [x] **Architecture Documented**: Complete system architecture, principles, and component layers defined.
- [x] **Supported Intents Enumerated**: 9 distinct intents defined with triggers, patterns, answer sources, and tools.
- [x] **Answer Sources Identified**: Every intent mapped explicitly to canonical repository files (`POSITIONING.md`, EJS partials, routes).
- [x] **Navigation/Tool Contracts Defined**: Strict JSON schemas and parameter contracts established for all allow-listed actions.
- [x] **LLM Boundary Specified**: Unambiguous separation enforced between deterministic fact/action engine and optional Phase 9 LLM parser.
- [x] **Zero AI Dependencies**: System defined with 100% deterministic, local execution in Phase 8.

---

## 9. Content Governance & Maintenance Rules

To ensure the Portfolio Secretary knowledge base (`public/data/secretary_knowledge.json`) remains accurate as the site evolves, the repository enforces automated content governance checks via `test/secretary.test.js`:

1. **Intent & Anchor Alignment**: Any section anchor referenced in a tool call parameter (e.g., `#over`, `#projecten`, `#skills`, `#contact`) must exist as a valid DOM element ID in `views/` partial templates.
2. **Route Resolution**: Any route referenced in a tool call parameter (e.g., `/`, `/share`, `/keuken-cv`) must exist as a registered GET route in `server.js`.
3. **Project ID Validation**: Every `projectId` referenced by `openProject` tool calls (e.g., `artificer`, `global-conquest`, `supermail`) must correspond to an existing project card CSS selector in `views/partials/projecten.ejs`.
4. **Source File Grounding**: All files listed under `knowledgeSource` must exist on disk in the repository.
5. **CI Automated Check**: `npm test` automatically executes these governance assertions. If a developer renames an anchor, route, or project card without updating `secretary_knowledge.json`, CI will fail immediately.
