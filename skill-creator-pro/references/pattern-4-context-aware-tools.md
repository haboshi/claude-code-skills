# Design Pattern 4: Context-Aware Tool Selection

This pattern is used when a single goal can be achieved in multiple ways, and the best method depends on the specific context of the request. The skill doesn't just execute a tool; it first makes an intelligent decision about *which* tool to use.

## When to Use This Pattern

-   **Multiple Tools for One Goal:** When you have several tools or methods that accomplish a similar outcome (e.g., different ways to save a file, multiple APIs for fetching data).
-   **Conditional Logic:** When the choice of tool depends on factors like file size, data type, user permissions, or other contextual clues.
-   **Efficiency and Optimization:** When you want to select the most appropriate, cost-effective, or efficient tool for the job.

## Key Implementation Steps

### 1. Create a Decision Tree

The core of this pattern is a **decision tree** that is clearly defined in your `SKILL.md`. This tree guides the agent through a series of checks to arrive at the correct tool.

```markdown
### Goal: Smart File Storage

To store a file, use the following decision tree to select the appropriate tool:

1.  **Check File Type and Size:**
    -   Is the file source code? -> **Use GitHub MCP**.
    -   Is the file a large binary (> 50MB)? -> **Use S3 Uploader MCP**.
    -   Is the file a collaborative document (e.g., .docx, .md)? -> **Use Google Drive MCP**.
    -   Otherwise -> **Use local filesystem**.
```

### 2. Explain the "Why"

A crucial part of this pattern is transparency. The skill should not only select and use the right tool but also **inform the user which tool was chosen and why**. This builds trust and makes the agent's behavior understandable.

```markdown
#### 2. Execution and Transparency

-   **Action:** Based on the decision tree, execute the chosen tool or MCP command.
-   **Inform:** After execution, send a message to the user explaining the choice. For example: "I've saved the file to S3 because it is a large binary file, which is most efficiently handled by cloud storage."
```

### 3. Provide a Fallback

What happens if none of the conditions are met? A good decision tree always has a default or fallback option to handle unexpected cases gracefully.

## Example Snippet for `SKILL.md`

```markdown
### Goal: Fetching User Profile

To fetch a user's profile, use the following decision tree:

1.  **Check Input Identifier:**
    -   If the input is an email address -> **Use the `identity_service.get_user_by_email` MCP tool**.
    -   If the input is a username -> **Use the `profile_service.get_user_by_username` MCP tool**.
    -   If the input is a user ID (integer) -> **Use the `user_database.lookup_by_id` MCP tool**.
    -   **Fallback:** If the identifier format is unknown, ask the user to clarify whether it's an email, username, or ID.

2.  **Execution and Transparency:**
    -   **Action:** Call the selected MCP tool with the provided identifier.
    -   **Inform:** If the user's initial request was ambiguous (e.g., "Find user John Doe"), state the assumption made: "I am searching for a user with the username 'John Doe'."
```

This pattern elevates a skill from a simple tool-caller to an intelligent decision-maker, making it more robust, efficient, and adaptable to varying circumstances.
