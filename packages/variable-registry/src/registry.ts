import {
  variableDefinitionSchema,
  type VariableDefinition,
} from '@geoeye/types'

export class VariableRegistry {
  readonly #variables: Map<string, VariableDefinition>

  constructor(definitions: readonly VariableDefinition[]) {
    this.#variables = new Map()

    for (const candidate of definitions) {
      const definition = variableDefinitionSchema.parse(candidate)
      if (this.#variables.has(definition.key)) {
        throw new Error(`Duplicate variable key: ${definition.key}`)
      }
      this.#variables.set(definition.key, definition)
    }
  }

  list(): VariableDefinition[] {
    return [...this.#variables.values()]
  }

  get(key: string): VariableDefinition | undefined {
    return this.#variables.get(key)
  }

  require(key: string): VariableDefinition {
    const definition = this.get(key)
    if (!definition) {
      throw new Error(`Unknown GeoEye variable: ${key}`)
    }
    return definition
  }

  compatibleWith(analysis: string): VariableDefinition[] {
    return this.list().filter((definition) =>
      definition.compatibleAnalyses.some(
        (candidate) => candidate === analysis || candidate.startsWith(`${analysis}.`),
      ),
    )
  }
}

