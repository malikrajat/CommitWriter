/**
 * Placeholder product identity.
 *
 * The final product name is intentionally undecided pending a marketplace
 * availability check. Keep branding here (and in package.json) only; the
 * architecture test `test/architecture/product-identity.test.ts` fails if the
 * name or identifier prefix drifts.
 */
const id = 'commitwriter';

export const PRODUCT = {
  /** Flip to false once the final name is approved. */
  placeholder: true,
  id,
  displayName: 'CommitWriter',
  publisher: 'RajatMalik',
  configSection: id,
  storagePrefix: id,
  command: {
    generate: `${id}.generate`,
    generateStaged: `${id}.generateStaged`,
    regenerate: `${id}.regenerate`,
    editMessage: `${id}.editMessage`,
    cancel: `${id}.cancel`,
    undo: `${id}.undo`,
    previewPayload: `${id}.previewPayload`,
    selectRepository: `${id}.selectRepository`,
    selectProfile: `${id}.selectProfile`,
    selectModel: `${id}.selectModel`,
    manageProfiles: `${id}.manageProfiles`,
    addProfile: `${id}.addProfile`,
    editProfile: `${id}.editProfile`,
    removeProfile: `${id}.removeProfile`,
    testConnection: `${id}.testConnection`,
    validateProfiles: `${id}.validateProfiles`,
    setApiKey: `${id}.setApiKey`,
    clearApiKey: `${id}.clearApiKey`,
    useProfile: `${id}.useProfile`,
    toggleSetting: `${id}.toggleSetting`,
    setTokenBudget: `${id}.setTokenBudget`,
    setRequestTimeout: `${id}.setRequestTimeout`,
    setMode: `${id}.setMode`,
    allowSensitiveFilesOnce: `${id}.allowSensitiveFilesOnce`,
    revokeEgressConsent: `${id}.revokeEgressConsent`,
    showDiagnostics: `${id}.showDiagnostics`,
    showOutput: `${id}.showOutput`,
  },
  context: {
    generating: `${id}.generating`,
    hasLastResult: `${id}.hasLastResult`,
  },
} as const;

