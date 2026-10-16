export interface IInput {
  [key: string]:
    | string
    | string[]
    | boolean
    | boolean[]
    | number
    | number[]
    | IInput[]
    | IInput
}
export type InputType =
  | string
  | string[]
  | boolean
  | boolean[]
  | number
  | number[]
  | IInput[]
  | IInput

export type ghEnvironmentType = {
  var: Record<string, string>
  secret: Record<string, string>
}

export type GlobalsContext = {
  config: Record<string, InputType>
  pipeline: Record<string, string | boolean>
}

/**
 * Minimal read contract shared by every supported keystore backend
 * (Azure Key Vault, AWS SSM Parameter Store).
 */
export interface SecretReader {
  /** Human readable backend name used in resolution logs. */
  readonly storeLabel: string
  getSecret(key: string): Promise<string>
}
