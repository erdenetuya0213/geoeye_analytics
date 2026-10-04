const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, value) => ipcRenderer.invoke(channel, value)

contextBridge.exposeInMainWorld('geoeyeDesktop', Object.freeze({
  isDesktop: true,
  activationStatus: () => invoke('geoeye:activation:status'),
  activateOffline: (input) => invoke('geoeye:activation:login', input),
  logoutActivation: () => invoke('geoeye:activation:logout'),
  readAppStorage: () => invoke('geoeye:app-storage:read'),
  writeAppStorage: (input) => invoke('geoeye:app-storage:write', input),
  removeAppStorage: (key) => invoke('geoeye:app-storage:remove', key),
  loadCredential: () => invoke('geoeye:credential:load'),
  saveCredential: (credential) => invoke('geoeye:credential:save', credential),
  clearCredential: () => invoke('geoeye:credential:clear'),
  requestDataPool: (input) => invoke('geoeye:datapool:request', input),
  databaseConfiguration: () => invoke('geoeye:datapool:configuration'),
  workspaceStatus: () => invoke('geoeye:workspace:status'),
  chooseWorkspaceRoot: () => invoke('geoeye:workspace:choose-root'),
  readProjectRecord: (address) => invoke('geoeye:project:read', address),
  writeProjectRecord: (input) => invoke('geoeye:project:write', input),
  archiveImportFiles: (input) => invoke('geoeye:files:archive', input),
  exportWorkspaceFile: (input) => invoke('geoeye:files:export', input),
  enqueueSync: (input) => invoke('geoeye:outbox:enqueue', input),
  syncStatus: (input) => invoke('geoeye:outbox:status', input),
  runSync: (input) => invoke('geoeye:outbox:run', input),
  retrySync: (input) => invoke('geoeye:outbox:retry', input),
  cancelSync: (input) => invoke('geoeye:outbox:cancel', input),
  readProjectDocuments: (address) => invoke('geoeye:project-documents:read', address),
  writeProjectDocument: (input) => invoke('geoeye:project-documents:write', input),
  removeProjectDocument: (input) => invoke('geoeye:project-documents:remove', input),
  saveAnalysisResultPackage: (input) => invoke('geoeye:analysis-results:save', input),
  readAnalysisResultPackages: (address) => invoke('geoeye:analysis-results:read', address),
}))
