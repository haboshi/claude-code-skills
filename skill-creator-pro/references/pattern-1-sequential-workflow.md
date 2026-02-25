# Design Pattern 1: Sequential Workflow

This pattern is ideal for tasks that must follow a strict, ordered sequence of steps, where the output of one step becomes the input for the next. It is one of the most common and fundamental patterns for creating reliable skills.

## When to Use This Pattern

-   **Ordered Processes:** When a task has a clear, non-negotiable order of operations (e.g., customer onboarding, data processing pipelines, build-and-deploy sequences).
-   **Dependency Chains:** When each step depends on the successful completion of the previous one.
-   **High Reliability Needs:** When consistency and error handling are critical, and free-form execution is too risky.

## Key Implementation Steps

### 1. Define the Workflow Explicitly

Your `SKILL.md` must clearly enumerate the steps. This provides a clear mental model for the agent and serves as a checklist.

```markdown
### Workflow: PDF Form Filling

This process involves five distinct steps:

1.  **Analyze Form:** Extract field names and types from the PDF.
2.  **Create Field Mapping:** Map input data to the extracted PDF fields.
3.  **Validate Mapping:** Ensure all required fields are mapped and data types match.
4.  **Fill Form:** Execute the script to populate the PDF.
5.  **Verify Output:** Confirm the final PDF is correctly filled.
```

### 2. Detail Each Step

For each step, you must provide three critical pieces of information:

-   **Action:** The specific command to execute or instruction to follow. Be precise. Instead of "fill the form," specify "Run the `fill_form.py` script with the mapping file as an argument."
-   **Validation:** How to confirm the step was successful. This is crucial. What specific output, file, or status indicates success? Examples: "Confirm that a `customer_id` is returned and is a non-empty string," or "Verify that the output file `filled_form.pdf` is created and is larger than the original."
-   **Failure (Rollback/Error Handling):** What to do if the step fails. This prevents the workflow from continuing in a broken state. Examples: "If validation fails, delete the created customer record and notify the user with the specific error," or "If the script returns a non-zero exit code, stop the process immediately and report the error from stderr."

### 3. Use Scripts for Complex Logic

For any step involving complex, deterministic logic (like data validation or file manipulation), use a script in the `scripts/` directory. Natural language is ill-suited for precision here.

**Bad (in SKILL.md):**
> "Make sure the email address looks valid."

**Good (in SKILL.md):**
> "Run `scripts/validate_data.py --input data.json`. The script will exit with a non-zero status code if any email is invalid."

## Example Snippet for `SKILL.md`

```markdown
### Step 2: Create Field Mapping

-   **Action:** Read the `fields.json` created in Step 1 and map the user's provided data to each field name. Save the result as `mapping.json`.
-   **Validation:** The `mapping.json` file must be valid JSON. All keys from `fields.json` must be present in `mapping.json`.
-   **Failure:** If the `mapping.json` is not created or is invalid, stop the workflow and ask the user to clarify their data.
```

By implementing this pattern, you transform a fragile, ambiguous task into a robust, repeatable, and auditable automated process.
