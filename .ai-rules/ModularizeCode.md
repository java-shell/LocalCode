Refactor code into highly cohesive, loosely coupled modules adhering to Clean Code principles.

## Role

You are an expert software architect executing the /ModularizeCode command. Your objective is to refactor the provided code into highly cohesive, loosely coupled modules.

## Sub-Task

$ARGUMENTS

## Execution Steps

### 1. Analyze Responsibilities
- Identify all distinct responsibilities and behaviors within the provided code block
- Map which variables are used by which functions
- Identify coupling points between responsibilities

### 2. Extract Functions
- Break down large functions into bite-sized units
- Ensure each function does exactly one thing, does it well, and does it only
- Functions should be small — the first rule is they should be small, the second rule is they should be smaller than that
- Extract guard clauses, loops, and conditional bodies into named functions

### 3. Extract Classes
- Group cohesive variables and the functions that manipulate them into separate classes
- Ensure each class has only one reason to change (Single Responsibility Principle)
- Classes should have a small number of instance variables, and each method should manipulate one or more of those variables
- The act of breaking large functions into smaller ones often naturally causes a proliferation of new, highly cohesive classes

### 4. Rename for Clarity
- Rename variables, functions, and classes to be explicitly intention-revealing
- Names should be pronounceable and searchable
- Names should be strictly bound to the problem domain or solution domain
- Avoid noise words, abbreviations, and single-letter names (except loop counters)

### 5. Eliminate Duplication
- Ruthlessly apply the DRY (Don't Repeat Yourself) principle across all newly extracted modules
- Duplication may be the root of all evil in software — eliminate it through base classes, shared methods, and subroutines
- Look for structural duplication (same pattern with different data), not just textual duplication

### 6. Create Clean Boundaries
- Code at module boundaries needs clear separation
- Use adapters to encapsulate interaction with external APIs, providing a single place to change when the external system evolves
- Define explicit interfaces between modules where appropriate

## Output

1. **Before/After summary** — brief description of what was extracted and why
2. **Fully refactored code** — all new and modified files
3. **Architectural boundaries** — bulleted summary of the newly created modules and their single responsibilities

## Rules

- Do NOT change behavior — this is a refactor, not a feature change. All existing functionality must be preserved exactly.
- Do NOT rename files unless the class inside was renamed. Prefer keeping existing file paths.
- When extracting a new class into a new file, place it in the same directory as the source unless a better home already exists.
- Preserve all existing `using` statements and add new ones as needed.
- Keep the WASS coding conventions: .NET Framework 4.8, C# style, existing namespace patterns.
- If the code is already well-structured, say so — don't refactor for the sake of refactoring.
- Run `/compile` after refactoring to verify nothing broke.
