# Vitest source unit tests for core

Core uses Vitest configured with source tests enabled so unit tests may live inside the source file that owns the functionality under `if (import.meta.vitest)`. Integration and end-to-end tests live in neighboring `.test.ts` files at the boundary they verify. We chose this over separate unit test files because colocated unit tests keep small validation and helper behavior close to the code, while boundary tests remain discoverable as standalone test files.
