# Goals

## G1: Portable runtime

Use the installed Node runtime without external lock or disk-inspection helpers.

## G2: Short ownership

Allow independent preparation and avoid holding document publication ownership during long command execution.

## G3: Simple coordination

One publication lock owner, one active file transaction and actionable recovery; SQLite remains disposable cache.
