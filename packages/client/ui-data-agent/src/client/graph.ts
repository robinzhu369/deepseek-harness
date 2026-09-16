/** Browser graph checks complement the authoritative workflow compiler. */
import type { Workflow, Registry } from './types.ts'
/** Check editable references before adding an edge; required inputs are checked by the server at save.
 * @param workflow - Draft graph, including incomplete nodes.
 * @param registry - Authoritative operator port declarations.
 * @returns Whether existing references form a compatible acyclic graph.
 */
export function validGraph(workflow: Workflow, registry: Registry): boolean {
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]))
  if (nodes.size !== workflow.nodes.length) return false
  const visiting = new Set<string>(),
    done = new Set<string>()
  const visit = (id: string): boolean => {
    if (done.has(id)) return true
    if (visiting.has(id)) return false
    visiting.add(id)
    const node = nodes.get(id)
    if (!node) return false
    const operator = registry.operators[node.operator]
    if (!operator) return false
    for (const [port, input] of Object.entries(node.inputs)) {
      if (!operator.inputs[port]) return false
      if ('node_id' in input) {
        const upstream = nodes.get(input.node_id)
        if (
          !upstream ||
          registry.operators[upstream.operator]?.outputs[input.output_port] !== operator.inputs[port] ||
          !visit(input.node_id)
        )
          return false
      } else if (input.project_id !== workflow.project_id || input.kind !== operator.inputs[port])
        return false
    }
    visiting.delete(id)
    done.add(id)
    return true
  }
  return workflow.nodes.every(node => visit(node.id))
}
