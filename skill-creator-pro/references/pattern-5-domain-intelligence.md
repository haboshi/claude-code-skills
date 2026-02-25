# Design Pattern 5: Domain-Specific Intelligence

This is the most advanced pattern. It involves embedding specialized, non-obvious domain knowledge directly into a skill. The skill doesn't just call tools; it uses expert knowledge to call them in the right way, in the right order, and with the right checks.

## When to Use This Pattern

-   **Expert Processes:** When you need to replicate the decision-making process of a human expert (e.g., a compliance officer, a senior engineer, a financial analyst).
-   **Implicit Knowledge:** When there are unwritten rules, critical checks, or business logic that must be applied.
-   **High-Stakes Operations:** For tasks with significant consequences, such as financial transactions, security operations, or legal compliance, where simply calling a tool is not enough.

## Key Implementation Steps

### 1. Codify the Expert's Mental Checklist

Interview a domain expert and turn their implicit knowledge into an explicit checklist. This checklist becomes the core of your skill's workflow. The value is not in accessing the tool (the agent could probably do that anyway), but in the rigorous process you enforce *around* the tool.

```markdown
### Goal: GDPR-Compliant User Deletion

Before deleting a user, the following compliance checks, derived from our data policy, MUST be performed in order.

1.  **Check for Legal Hold:** Verify the user is not under a legal hold.
2.  **Anonymize Public Content:** Anonymize, rather than delete, any public-facing content created by the user.
3.  **Scrub Personal Data:** Erase PII from all primary and secondary databases.
4.  **Generate Deletion Certificate:** Create an auditable certificate of data deletion.
5.  **Final Deletion:** Only after all previous steps are complete, delete the primary user record.
```

### 2. Separate Domain Logic from Tool Calls

The skill should clearly distinguish between the domain logic (the "why") and the tool execution (the "how"). The domain logic might be represented as a series of validation steps or conditional checks before a tool is ever called.

```markdown
#### Step 2: Anonymize Public Content

-   **Domain Logic:** Per GDPR Article 17, we must preserve the integrity of public discussions. Therefore, we do not delete user posts but anonymize them.
-   **Action:** Call the `content_service.anonymize_user_posts` MCP tool with the user's ID.
-   **Validation:** Confirm that the tool returns a list of anonymized post IDs.
```

### 3. Use `references/` for Deep Knowledge

If the domain knowledge is extensive (e.g., a full compliance policy, a detailed security protocol), place it in a `references/` file and have the `SKILL.md` orchestrate its use. The `SKILL.md` contains the high-level workflow, while the reference files contain the deep details.

## Example Snippet for `SKILL.md`

```markdown
### Workflow: Secure Code Deployment

This workflow follows our company's security protocol for deploying code to production.

1.  **Pre-Deployment Security Scan:**
    -   **Domain Logic:** All code must be scanned for vulnerabilities before deployment.
    -   **Action:** Run the `security_scanner.py` script on the codebase.
    -   **Validation:** The script must exit with a status code of 0. If any critical vulnerabilities are found, the deployment is aborted.

2.  **Dependency Audit:**
    -   **Domain Logic:** All third-party dependencies must be checked against a list of approved, licensed packages.
    -   **Action:** Read the `references/approved_packages.md` file and compare it against the project's dependency list.
    -   **Validation:** All dependencies must be on the approved list.

3.  **Deployment:**
    -   **Condition:** Only if both the security scan and dependency audit pass.
    -   **Action:** Call the `deploy_service.deploy_to_production` MCP tool.
```

This pattern allows you to build truly expert-level agents that operate with a level of rigor and domain-specific awareness that a general-purpose model could never achieve on its own.
