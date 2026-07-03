# AI Coding Generation Rules: Prioritize Refactored Quality

## 1. Core Philosophy: Build It Clean

When I ask you to generate code, your primary goal is not just to produce a *working* solution, but to produce a **clean, professional, and future-proof** one. Apply the principles of refactoring *during* the initial creation process. Don't just make it work; make it *last*.

Assume all code you write will be read, maintained, and extended by a senior development team.

---

## 2. Guiding Principles for Code Generation

Apply these rules consistently to all code, from simple scripts to complex modules.

###  streamlining (Efficiency & Conciseness)

* **DRY (Don't Repeat Yourself):** Aggressively identify and eliminate repetition. If a block of logic is used more than once, abstract it into a reusable function, method, or class.
* **YAGNI (You Ain't Gonna Need It):** Do not add functionality or "what-if" features I didn't ask for. Focus on solving the immediate problem cleanly. Unnecessary code is a liability.
* **Single Responsibility Principle (SRP):** This is non-negotiable. Every function, class, and module must have **one** clear, well-defined responsibility. If a function description includes the word "and," it's probably doing too much.

### Legibility (Clarity & Maintainability)

* **Descriptive Naming:** Use clear, unambiguous, and self-documenting names for variables, functions, and classes. Avoid single-letter variables (except for simple loop counters) or cryptic abbreviations.
    * **Bad:** `val`, `data`, `arr`, `procData()`
    * **Good:** `customer_name`, `active_users_list`, `calculate_sales_tax()`
* **Comment the *Why*, Not the *What*:** Your code should be readable enough to explain *what* it's doing. Use comments **only** to explain *why* a particular (and non-obvious) approach was taken, or to document complex business logic.
* **Consistent Formatting:** Adhere strictly to the idiomatic style guide for the target language (e.g., PEP 8 for Python, Prettier for JS). Use consistent indentation, whitespace, and line breaks.

### Expansion (Modularity & Scalability)

* **Loose Coupling:** Components should interact through stable, well-defined interfaces (e.g., function parameters, clear APIs). Avoid having modules or classes reach "inside" each other to access internal state.
* **High Cohesion:** Keep related code together. A module or class should contain all the elements necessary for its single responsibility.
* **Parameterize, Don't Hardcode:** Identify magic numbers, configuration strings, or fixed values. Extract them into constants, configuration files, or function arguments to make the code flexible and easier to test.
* **Return Early:** Use guard clauses (early returns or exceptions for invalid states) at the beginning of functions to reduce nested `if` statements and improve clarity.

---

## 3. Final Check

Before presenting the code, ask yourself:
1.  Is it **DRY**?
2.  Is it **legible** at a glance?
3.  Does each part have a **single responsibility**?
4.  If I needed to add a related feature tomorrow, would this design make it **easy or hard**?

Only provide the code when the answer to all four is positive.