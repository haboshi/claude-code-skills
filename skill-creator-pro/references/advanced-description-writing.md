# Advanced Guide: Writing Trigger-Perfect Descriptions

The `description` field in your skill's frontmatter is the single most important factor determining whether your skill gets used. It is not just metadata; it is the primary trigger mechanism. This guide provides advanced techniques for writing descriptions that are both precise and effective.

## The Anatomy of a Perfect Description

A high-quality description must answer two questions:

1.  **WHAT does this skill do?** (Its capability)
2.  **WHEN should this skill be used?** (Its trigger conditions)

Combine these into a clear, concise formula:

> **[Capability Statement]. Use when [Trigger Conditions].**

### Good vs. Bad Descriptions

| Quality | Example |
|:---|:---|
| **Bad (Too Vague)** | `description: "Helps with project management."` (Doesn't specify triggers or capabilities.) |
| **Bad (Missing Trigger)** | `description: "Creates and manages Linear tasks."` (What should the user say to activate this?) |
| **Good (Specific & Triggered)** | `description: "Manages Linear project workflows, including sprint planning and task creation. Use when the user mentions 'sprint', 'Linear task', or asks to 'create a ticket'."` |

## The Trigger Checklist

When writing your `description`, run through this checklist:

-   [ ] **Keywords:** Does it include specific keywords the user is likely to say? (e.g., `sprint`, `ticket`, `PR`)
-   [ ] **File Types:** If the skill operates on files, does it mention the extensions? (e.g., `.docx`, `.pdf`, `.csv`)
-   [ ] **Actions:** Does it include action verbs the user might request? (e.g., `create`, `convert`, `analyze`, `summarize`)
-   [ ] **Negative Triggers (Optional but powerful):** Does it specify when *not* to use the skill? This prevents it from activating incorrectly.

### Using Negative Triggers

If your skill is specialized, prevent it from being used for general tasks by adding a negative constraint.

**Example:**

> `description: "Performs advanced statistical analysis on CSV files, including regression and clustering. Do not use for simple data exploration or visualization (use the 'data-viz' skill for that)."`

## Debugging Your Description

If your skill isn't triggering when you expect, the problem is almost always the `description`. Here’s how to debug it:

1.  **Ask the Agent Directly:** Start a new session and ask the agent: `"When would you use the '{skill-name}' skill?"`
2.  **Analyze the Answer:** The agent will quote or paraphrase its understanding of the `description`. If its answer doesn't match your intent, your description is the problem.
3.  **Iterate:** Refine the `description` to be more specific, add more trigger keywords, and try again.

## Final Polish

-   **No XML/HTML:** Never include tags like `<` or `>` in your description. This will cause parsing errors.
-   **Concise:** Keep it under 1024 characters. Be informative but not verbose.
-   **Front-load Keywords:** Place the most important keywords and triggers near the beginning of the description.

By mastering the `description`, you gain precise control over your skill's activation, transforming it from a passive tool into a proactive, context-aware assistant.
