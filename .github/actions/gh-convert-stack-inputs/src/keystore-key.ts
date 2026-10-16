/**
 * Converts a key to the flat keystore name shared by Azure Key Vault and
 * AWS SSM, so both keystores stay interchangeable for an environment.
 * - Prefixes with the environment name separated by `---`
 * - Converts to lowercase
 * - Replaces underscores and dots with hyphens
 */
export function convertKey(key: string, prefix: string): string {
  const convertedKey = prefix + '---' + key
  return convertedKey.toLowerCase().replace(/_/g, '-').replace(/\./g, '-')
}
