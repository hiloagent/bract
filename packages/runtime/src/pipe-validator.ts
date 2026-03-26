/**
 * @file pipe-validator.ts
 * Compile-time validation for bract.yml agent pipe definitions.
 *
 * Detects two classes of errors in a fleet's pipe configuration:
 *   1. Unknown pipe sources — a pipe references an agent name not defined in the fleet.
 *   2. Circular pipes — a chain of pipes forms a cycle (A→B→C→A).
 *      Detected via DFS three-colour algorithm (unvisited/in-progress/done).
 *
 * Used by the bract CLI at `bract validate` and at fleet load time.
 *
 * @module @losoft/bract-runtime/pipe-validator
 */
type NodeState = 'unvisited' | 'in-progress' | 'done';

interface AgentPipeDef {
  name: string;
  pipes?: Array<{ from: string }>;
}

/**
 * Detect cycles in the agent pipe graph using DFS three-colour marking.
 *
 * Colours: unvisited -> in-progress (on DFS stack) -> done.
 * A back-edge (visiting an in-progress node) means a cycle exists.
 *
 * Returns the full cycle path on the first cycle found, or null if acyclic.
 *
 * Examples:
 *   A -> B -> C          null  (no cycle)
 *   A -> B -> A          ["A", "B", "A"]
 *   A -> B -> C -> A     ["A", "B", "C", "A"]
 */
export function detectCycles(agents: AgentPipeDef[]): string[] | null {
  const adj = new Map<string, string[]>();
  const names = new Set(agents.map((a) => a.name));

  for (const agent of agents) {
    if (!adj.has(agent.name)) adj.set(agent.name, []);
    for (const pipe of agent.pipes ?? []) {
      const edges = adj.get(pipe.from);
      if (edges !== undefined) {
        edges.push(agent.name);
      } else {
        adj.set(pipe.from, [agent.name]);
      }
    }
  }

  const state = new Map<string, NodeState>();
  for (const name of names) state.set(name, 'unvisited');

  const path: string[] = [];

  function dfs(node: string): string[] | null {
    state.set(node, 'in-progress');
    path.push(node);

    for (const neighbour of adj.get(node) ?? []) {
      const s = state.get(neighbour);
      if (s === 'in-progress') {
        const cycleStart = path.indexOf(neighbour);
        return [...path.slice(cycleStart), neighbour];
      }
      if (s === 'unvisited') {
        const cycle = dfs(neighbour);
        if (cycle) return cycle;
      }
    }

    path.pop();
    state.set(node, 'done');
    return null;
  }

  for (const name of names) {
    if (state.get(name) === 'unvisited') {
      const cycle = dfs(name);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * Validate pipe references and detect cycles. Throws with a descriptive
 * message on the first error found.
 */
export function validatePipes(agents: AgentPipeDef[]): void {
  const names = new Set(agents.map((a) => a.name));

  for (const agent of agents) {
    for (const pipe of agent.pipes ?? []) {
      if (!names.has(pipe.from)) {
        throw new Error(
          `Agent "${agent.name}" has a pipe from unknown agent "${pipe.from}"`,
        );
      }
    }
  }

  const cycle = detectCycles(agents);
  if (cycle) {
    throw new Error(`Circular pipe detected: ${cycle.join(' -> ')}`);
  }
}
