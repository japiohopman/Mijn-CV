# 🎯 Artificer: Master Project Goals & Architecture Blueprint

> **IMPORTANT:** This is the central "Endpoint" document for the Artificer project. It defines the ultimate vision, architectural truth, and the final destination for all development efforts. All systems, features, and agents must align with the goals stated herein.

## 1. Project Vision
Artificer is evolving from an immersive digital grimoire into a **complete AI-powered Dungeons & Dragons simulation platform**. The goal is to provide a seamless, high-fidelity experience where an LLM-driven Dungeon Master orchestrates complex game systems, maintains a persistent world state, and narrates adventures with perfect mechanical consistency.

## 2. Core Design Principles
*   **Immersive Skeuomorphism**: Maintain the "feel" of a physical artifact (books, cards, dice) while leveraging digital power.
*   **Schema-Driven Reality**: Every entity (NPC, Item, Spell, Map) is governed by strict JSON schemas. The AI interprets these schemas rather than hallucinating stats.
*   **AI Orchestration & The Narrator Model**: The AI DM is a narrator and facilitator. It interacts with the game via tool calls; the core mechanics (combat, inventory, progression) are implemented in code.
*   **Mechanical Integrity**: The game must remain fully playable without an LLM. The game state is the absolute source of truth.
*   **Data Integrity**: Use validation scripts and schemas to ensure the "Atlas" remains the single source of truth for all game rules.

## 3. Architectural Goals
*   **Service-Oriented Core**: Decouple UI from game logic. Services (AI, Atlas, Storage) should handle the "heavy lifting."
*   **Reactive State Management**: Global state is sliced into specialized stores (`useWorldStore`, `useGameStore`, etc.) to handle complex campaign states, temporal progression, and tactical combat.
*   **Proxy-Based Persistence**: Continue using the server-side proxy to bridge the frontend with GitHub (for data) and AI models, ensuring security and CORS compliance.

## 4. AI Dungeon Master Requirements
The AI DM must operate with full contextual awareness of:
*   **Party Metadata**: Composition, stats, inventory, and health.
*   **Narrative State**: Quest progress, campaign history, and session summaries.
*   **World State**: Current location, NPC relationships, and faction standings.
*   **Environmental Context**: Time of day, weather, and tactical conditions.

## 5. Campaign Management Requirements
*   **Autonomous Generation**: Tool-driven generation of adventures, story arcs, and dungeons.
*   **Persistent Journaling**: Automatic generation of player journals after every session/in-game day.
*   **Dynamic Lore**: Lore that evolves based on player actions (e.g., a city's description changes if it is besieged).

## 6. Character Management Requirements
*   **Full Lifecycle Support**: From procedural generation (Character Creator) to level-up progression (LevelUpOverlay).
*   **Inventory V2 Unification**: Character items are managed via a registry/slot-based system supporting containers, equipment slots, and weight calculation.
*   **Condition Tracking**: Mechanical implementation of D&D 5.5e conditions and their effects on stats.

## 7. World Simulation Requirements
*   **Time Progression**: A temporal engine tracks minutes, days, and months (Calendar of Harptos), affecting environmental cycles.
*   **Faction & Reputation**: Numeric and qualitative tracking of how the world perceives the party.
*   **Economic Simulation**: Regional pricing for equipment and materials based on local supply and events.

## 8. Combat System Requirements
The **Tactical Battle Interface** provides spatial resolution for encounters:
*   **Grid-Based Movement**: 12x8 grid with token management, range validation (Chebyshev distance), and collision.
*   **Automation**: Turn management, initiative tracking, and monster spawning.
*   **Spatial Analysis**: (Upcoming) Line-of-sight calculations and AOE targeting (cones, spheres, lines).

## 9. Dice System Requirements
*   **Advanced Parser**: Handle complex roll strings (e.g., `2d6 + 4 [fire] + 1d4 [poison]`).
*   **Visual Fidelity**: 3D dice physics engine integrated with a theme-consistent parchment overlay.
*   **Roll Validation**: Ensure rolls are tied to specific character actions or skill checks for auditability.

## 10. Asset Generation Requirements
*   **Consistent Aesthetics**: Use curated prompts (like those in `npcService.ts`) to ensure generated images for NPCs, items, and monsters maintain a "Baldur's Gate 3" style.
*   **Chroma-Key Standards**: Maintain strict green-screen rules for character portraits to allow UI flexibility.

## 11. Data Architecture Guidelines
*   **Standardized Paths**: Always use `public/assets/atlas/[category]/json/` for data and `public/assets/atlas/[category]/images/` for assets.
*   **Typo Maintenance**: For Faerûn-specific data, respect the required intentional typos (`totil`, `fearun`, `swort_coast_south`) to maintain compatibility with legacy systems.
*   **Schema First**: No asset should be added without passing its respective JSON schema validation.

## 12. Tooling Architecture
The AI DM is prohibited from altering game state directly through text. It must access "Tools" via the API to:
*   `generateAsset(type, context)`
*   `updateCampaignState(key, value)`
*   `resolveCombatAction(actorId, actionId, targetId)`
*   `updateJournal(entry)`
*   *Note: Tools are the only bridge between AI narration and the mechanical core.*

## 13. Persistence & Memory Systems
*   **GitHub as Database**: Continue using GitHub for long-term storage of atlas data and character saves.
*   **Session Memory**: Implement a short-term vector-based or context-window memory for the LLM to recall recent dialogue and immediate surroundings.

## 14. UI/UX Goals
*   **Zero-UI Immersion**: Move toward a HUD-less experience during narration, where info is gleaned from the skeuomorphic elements (e.g., checking a physical-looking map).
*   **Contextual UI**: Menus and overlays (like `FocusView`) should only appear when relevant to the current interaction.

## 15. Future Roadmap
1.  **Phase 1: Inventory Unification**: Complete (Migration to Inventory V2).
2.  **Phase 2: World State & Tactical Foundations**: Complete (World State, Tiled Map, Discovery, Journal, and Grid-Based Movement v1).
3.  **Phase 3: AI DM Integration**: (Active) Connecting the LLM to the system's tool-calls.
4.  **Phase 4: Global Simulation**: Roll out faction systems and economic simulation.

## 16. Technical Debt & Refactoring Recommendations
*   **Inventory Cleanup**: Remove all "v1" logic from `useStore.ts` and `ArcaneCodex.tsx`.
*   **Profile Consolidation**: Create a unified `EntityProfile` component that handles Monsters, NPCs, and Transports through a shared interface.
*   **Service Hardening**: Improve error handling in `storageService.ts` for GitHub API rate limits.

## 17. Missing Systems Analysis (this is in progress)
*   **Map System**: Integration of region-aware tactical maps is complete; fog-of-war/discovery logic implemented.
*   **Soundscape Engine**: `soundService.ts` is robust but needs better integration with AI narration (e.g., AI requesting background music shifts).

## 18. Success Criteria
*   The AI DM can run a 300-minute session without human mechanical intervention.
*   A new character can be created, leveled to 20, and equipped without schema violations.
*   The system can automatically generate a "Post-Session Summary" that accurately reflects all game state changes.

---
*This document is the ultimate reference for the Artificer Project Orchestrator.*
