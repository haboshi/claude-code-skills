---
name: skill-creator-pro
description: "Create, test, and distribute professional-grade skills with 5 design patterns, security scanning, sanitization, and 3-stage QA. Use when creating a new SKILL.md, updating an existing skill, packaging skills for marketplace distribution, or improving skill trigger accuracy and quality. Covers the full lifecycle from design pattern selection through implementation, security review, testing, and distribution."
---

# Skill Creator Pro

Professional-grade guide for creating, testing, and distributing skills. Extends the official skill-creator with 5 design patterns, description optimization, 3-stage QA, and security scanning.

## About Skills

Skills are modular, self-contained packages that extend Claude's capabilities by providing specialized knowledge, workflows, and tools. They transform Claude from a general-purpose agent into a specialized agent equipped with procedural knowledge.

### What Skills Provide

1. Specialized workflows - Multi-step procedures for specific domains
2. Tool integrations - Instructions for working with specific file formats or APIs
3. Domain expertise - Company-specific knowledge, schemas, business logic
4. Bundled resources - Scripts, references, and assets for complex and repetitive tasks

### Core Principles

**Concise is Key.** The context window is a public good. Only add context Claude doesn't already have. Challenge each piece of information: "Does this paragraph justify its token cost?" Prefer concise examples over verbose explanations.

**Set Appropriate Degrees of Freedom.** Match specificity to task fragility:

- **High freedom (text instructions)**: Multiple valid approaches exist; context determines best path
- **Medium freedom (pseudocode with parameters)**: Preferred patterns exist with acceptable variation
- **Low freedom (exact scripts)**: Operations are fragile, consistency critical, sequence matters

**Composability.** Assume the skill will be used alongside others. It must be a good citizen in a larger ecosystem.

**Portability.** A well-designed skill works across environments without modification.

### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/      - Executable code (Python/Bash/etc.)
    ├── references/   - Documentation loaded into context as needed
    └── assets/       - Files used in output (templates, icons, fonts)
```

#### SKILL.md (required)

- **Frontmatter** (YAML): `name` and `description` fields. These determine when Claude uses the skill. The `description` is the primary trigger mechanism.
- **Body** (Markdown): Instructions loaded only AFTER the skill triggers.

#### Scripts (`scripts/`)

- **When to include**: When the same code is repeatedly rewritten or deterministic reliability is needed
- **Benefits**: Token efficient, deterministic, may be executed without loading into context
- **Note**: Scripts may still need to be read by Claude for patching or environment-specific adjustments

#### References (`references/`)

- **When to include**: For documentation Claude should reference while working
- **Benefits**: Keeps SKILL.md lean, loaded only when needed
- **Best practice**: If files are large (>10k words), include grep search patterns in SKILL.md
- **Avoid duplication**: Information should live in either SKILL.md or references, not both

#### Assets (`assets/`)

- **When to include**: When the skill needs files used in the final output (templates, images, fonts)
- **Benefits**: Separates output resources from documentation

#### What NOT to Include

Do NOT create extraneous files: README.md, CHANGELOG.md, INSTALLATION_GUIDE.md, etc. The skill should only contain information needed for an AI agent to do the job.

#### Privacy and Path References

- **Forbidden**: Absolute paths (`/home/username/`, `/Users/username/`), personal usernames, company names
- **Allowed**: Relative paths within the skill bundle (`scripts/example.py`, `references/guide.md`)

#### Versioning

Skills should NOT contain version history in SKILL.md. Versions are tracked in `marketplace.json`.

### Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words, keep under 500 lines)
3. **Bundled resources** - As needed (unlimited; scripts can execute without loading into context)

**Key principle:** When a skill supports multiple variations, keep only core workflow and selection guidance in SKILL.md. Move variant-specific details into reference files.

**Pattern 1: High-level guide with references** - Link to detailed guides from SKILL.md. Claude loads them only when needed.

**Pattern 2: Domain-specific organization** - Organize references by domain. When a user asks about sales metrics, Claude only reads `sales.md`.

**Pattern 3: Conditional details** - Show basic content, link to advanced content. Claude reads advanced files only when needed.

**Important:** Avoid deeply nested references. Keep references one level deep from SKILL.md.

## Edit Skills at Source Location

**NEVER edit skills in `~/.claude/plugins/cache/`** - that is a read-only cache directory. All changes there are lost when cache refreshes. **ALWAYS verify** the file path does NOT contain `/cache/` or `/plugins/cache/`.

## Skill Creation Process

Follow these 11 steps in order, skipping only when clearly not applicable.

### Step 1: Understand the Skill with Concrete Examples

Skip only when the skill's usage patterns are already clearly understood.

Clearly understand concrete examples of how the skill will be used. This understanding can come from direct user examples or generated examples validated with user feedback.

Relevant questions include:
- "What functionality should this skill support?"
- "Can you give examples of how this skill would be used?"
- "What would a user say that should trigger this skill?"

Avoid asking too many questions in a single message. Conclude when there is a clear sense of the functionality the skill should support.

### Step 2: Plan and Design

To turn concrete examples into an effective skill, analyze each example by:

1. Considering how to execute from scratch
2. Determining the appropriate level of freedom for Claude
3. Identifying what scripts, references, and assets would be helpful

#### Choose a Design Pattern

Select the pattern that best fits the use case. This is the most important design decision.

| Pattern | Use Case | Reference |
|:---|:---|:---|
| **Sequential Workflow** | Strict ordered steps, dependency chains | `references/pattern-1-sequential-workflow.md` |
| **Multi-MCP Coordination** | Workflows spanning multiple services | `references/pattern-2-multi-mcp-coordination.md` |
| **Iterative Refinement** | High-quality output via generate-validate-refine loops | `references/pattern-3-iterative-refinement.md` |
| **Context-Aware Tool Selection** | Best tool depends on context of request | `references/pattern-4-context-aware-tools.md` |
| **Domain-Specific Intelligence** | Embedding non-obvious expert knowledge | `references/pattern-5-domain-intelligence.md` |

Read the reference guide for the chosen pattern before proceeding.

For additional workflow patterns (sequential and conditional), see `references/workflows.md`.

#### Master the Description

The `description` in frontmatter is the primary trigger mechanism. If the skill doesn't trigger correctly, the description is the problem.

- **Formula:** `[Capability Statement]. Use when [Trigger Conditions].`
- Include keywords users are likely to say, relevant file types, and action verbs
- Include all "when to use" information here, NOT in the body
- For advanced techniques (negative triggers, debugging), see `references/advanced-description-writing.md`
- For Anthropic's official best practices, retrieve `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md`

### Step 3: Initialize the Skill

Skip if the skill already exists and only needs iteration or packaging.

Run the `init_skill.py` script to generate a new template skill directory:

```bash
scripts/init_skill.py <skill-name> --path <output-directory>
```

The script creates the skill directory with a SKILL.md template, TODO placeholders, and example resource directories (`scripts/`, `references/`, `assets/`).

After initialization, customize or remove the generated example files as needed.

### Step 4: Edit the Skill

The skill is being created for another instance of Claude. Include information that would be beneficial and non-obvious. Consider what procedural knowledge, domain-specific details, or reusable assets would help.

#### Start with Reusable Skill Contents

Begin with the reusable resources identified in Step 2. This step may require user input (e.g., brand assets, API documentation).

Added scripts must be tested by actually running them. Delete any example files not needed.

**When updating an existing skill**: Scan all existing reference files to check if they need corresponding updates.

#### Reference File Naming

Filenames must be self-explanatory without reading contents.

- **Pattern**: `<content-type>_<specificity>.md`
- Bad: `commands.md`, `reference.md`
- Good: `script_parameters.md`, `api_endpoints.md`, `database_schema.md`

#### Update SKILL.md

**Writing Style:** Use imperative/infinitive form (verb-first instructions), not second person.

To complete SKILL.md:

1. What is the purpose of the skill?
2. When should the skill be used?
3. How should Claude use the skill? Reference all reusable contents so Claude knows they exist.

For output format design, see `references/output-patterns.md`.

### Step 5: Review Sanitization (Optional)

**Ask the user before executing:** "This skill appears to be extracted from a business project. Would you like me to perform a sanitization review?"

Skip if: the skill was created from scratch for public use, the user declines, or it is for internal use only.

Read `references/sanitization_checklist.md` for the complete process (automated scans, manual review, and verification).

### Step 6: Review Security

Run the security scanner to detect hardcoded secrets and personal information:

```bash
python scripts/security_scan.py <path/to/skill-folder>
python scripts/security_scan.py <path/to/skill-folder> --verbose
```

**Exit codes:** 0 = Clean, 1 = High severity, 2 = Critical (MUST fix), 3 = gitleaks not installed, 4 = Scan error.

**First-time setup:** Install gitleaks (`brew install gitleaks` on macOS).

### Step 7: Test and Validate

Rigorous testing is not optional. Use the three-stage testing process:

1. **Trigger Testing:** Does the skill activate correctly?
2. **Functional Testing:** Does it produce consistent, correct output?
3. **Performance Comparison:** Is it measurably better than not using the skill?

For detailed testing procedures, criteria, and metrics, see `references/testing-and-qa-guide.md`.

Optionally run the structure validator for early feedback (the packaging script in Step 8 runs this automatically):

```bash
python scripts/quick_validate.py <path/to/skill-folder>
```

### Step 8: Package

Package the skill into a distributable file. The script validates automatically before packaging:

```bash
python scripts/package_skill.py <path/to/skill-folder>
python scripts/package_skill.py <path/to/skill-folder> ./dist
```

The script validates frontmatter, naming conventions, description quality, and path reference integrity. If validation fails, fix errors and run again.

### Step 9: Distribute

To share the skill, host its directory in a public Git repository.

Recommended repository structure:

```
my-skill-repo/
├── .github/          # (Optional) GitHub Actions
├── my-skill/         # The skill directory
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── .gitignore
├── LICENSE
└── README.md         # Human-readable documentation (NOT inside the skill directory)
```

`SKILL.md` is for the AI agent. `README.md` is for human developers, placed in the repository root (not inside the skill directory).

For the complete distribution guide, see `references/distribution-guide.md`.

### Step 10: Update Marketplace

Add an entry to `.claude-plugin/marketplace.json`:

```json
{
  "name": "skill-name",
  "description": "Copy from SKILL.md frontmatter description",
  "source": "./",
  "strict": false,
  "version": "1.0.0",
  "category": "developer-tools",
  "keywords": ["relevant", "keywords"],
  "skills": ["./skill-name"]
}
```

For updates, bump the version following semver: patch (bug fixes), minor (new features), major (breaking changes).

### Step 11: Iterate

After testing the skill on real tasks:

1. Notice struggles or inefficiencies
2. Identify how SKILL.md or bundled resources should be updated
3. Implement changes and test again

**Refinement filter:** Only add what solves observed problems. If best practices already cover it, don't duplicate.

## Reference Map

| Reference | When to Read |
|:---|:---|
| `references/pattern-1-sequential-workflow.md` | Designing ordered, multi-step workflows |
| `references/pattern-2-multi-mcp-coordination.md` | Orchestrating across multiple MCPs/services |
| `references/pattern-3-iterative-refinement.md` | Building generate-validate-refine loops |
| `references/pattern-4-context-aware-tools.md` | Selecting tools based on context |
| `references/pattern-5-domain-intelligence.md` | Embedding expert knowledge |
| `references/advanced-description-writing.md` | Optimizing trigger accuracy |
| `references/workflows.md` | Sequential and conditional workflow patterns |
| `references/output-patterns.md` | Template and example output patterns |
| `references/testing-and-qa-guide.md` | 3-stage testing process |
| `references/distribution-guide.md` | Packaging and sharing skills |
| `references/sanitization_checklist.md` | Removing business-specific content |
