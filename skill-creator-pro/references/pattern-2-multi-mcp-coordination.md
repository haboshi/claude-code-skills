# Design Pattern 2: Multi-MCP Coordination

This pattern is designed for complex workflows that span multiple independent services, represented as MCP (Model Context Protocol) servers. The skill acts as a central orchestrator, managing the flow of data and control between these services.

## When to Use This Pattern

-   **Cross-Service Workflows:** When a task requires interacting with more than one MCP (e.g., fetching data from a database MCP, processing it, and then creating a task in a project management MCP).
-   **Data Handoffs:** When the output of one service is the input for another (e.g., taking a design file from a Figma MCP and handing it off to a code generation MCP).
-   **System Integration:** When the goal is to integrate disparate systems into a single, cohesive process.

## Key Implementation Steps

### 1. Define Phases, Not Steps

Instead of a flat list of steps, structure your workflow into **Phases**, where each phase typically corresponds to an interaction with a single MCP or service. This makes the workflow easier to understand and manage.

```markdown
### Workflow: Design-to-Development Handoff

This workflow automates the handoff of design assets from Figma to development tasks in Linear, using Google Drive for storage.

-   **Phase 1: Figma** - Export design assets.
-   **Phase 2: Google Drive** - Store assets and create shareable links.
-   **Phase 3: Linear** - Create development tasks with asset links.
```

### 2. Explicitly Define Inputs and Outputs for Each Phase

This is the most critical part of the pattern. For each phase, you must clearly state what data it requires (**Input**) and what data it produces (**Output**). This creates a clear contract for data handoffs between phases.

```markdown
#### Phase 2: Google Drive

-   **Input:** A list of asset URLs exported from Figma in Phase 1.
-   **Action:**
    1.  Create a new folder in the designated Google Drive directory.
    2.  For each asset URL, download the file and upload it to the new folder.
-   **Output:** A list of shareable Google Drive links for the uploaded assets.
```

### 3. Manage State and Data Transformation

The skill is responsible for managing the state of the entire workflow. This may involve temporarily storing data (e.g., in a JSON file) or transforming it between phases.

**Example:** The output from a database MCP might be a list of records. Before passing this to a task creation MCP, the skill might need to format each record into a human-readable description.

```markdown
#### Phase 2: Data Transformation

-   **Input:** Raw user data from the Database MCP.
-   **Action:** For each user record, format it into a Markdown string: `**User:** {name}, **Email:** {email}`.
-   **Output:** A list of formatted Markdown strings.
```

## Example Snippet for `SKILL.md`

```markdown
### Workflow: Automated Bug Triage

This workflow triages a bug from Sentry, finds the relevant code in GitHub, and creates a task in Linear.

#### Phase 1: Sentry MCP (Error Ingestion)

-   **Input:** A Sentry issue ID.
-   **Action:** Call the `sentry.get_issue_details` tool.
-   **Output:** A JSON object containing the error message, stack trace, and relevant tags.

#### Phase 2: GitHub MCP (Code Retrieval)

-   **Input:** The file path and line numbers from the Sentry stack trace.
-   **Action:** Call the `github.get_file_snippet` tool to retrieve the relevant lines of code.
-   **Output:** The code snippet as a string.

#### Phase 3: Linear MCP (Task Creation)

-   **Input:** The Sentry issue details and the GitHub code snippet.
-   **Action:** Call the `linear.create_task` tool, formatting the inputs into a comprehensive bug report in the task description.
-   **Output:** The URL of the newly created Linear task.
```

This pattern allows you to build powerful, high-level automations that connect your entire software stack, with the skill acting as the intelligent glue between services.
