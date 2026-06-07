# Versioned Project Execution Policy

Execution Policy is defined at the Project level and changes over time as versioned facts. Each Execution captures the Execution Policy version it uses when it starts, and later policy changes affect future Executions rather than rewriting the behavior of already-started ones. This keeps execution behavior auditable while allowing Projects to tune scheduling, retry, and execution limits.
