/** Settings saves also retry privacy cleanup that failed on an earlier save. */
export async function cleanSettingsHistory(agentControl: { privacyChanged(): Promise<void> }, personalChats: { privacyChanged(): Promise<void> }): Promise<void> {
  await agentControl.privacyChanged()
  await personalChats.privacyChanged()
}
