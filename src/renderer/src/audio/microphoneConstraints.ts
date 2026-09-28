export interface MicrophoneConstraints {
  audio: {
    deviceId: { exact: string } | undefined
    channelCount: 1
    echoCancellation: true
    noiseSuppression: true
    autoGainControl: true
  }
}

/** Testing and dictation must open the same input, including an unavailable explicit choice. */
export function microphoneConstraints(selectedDeviceId?: string): MicrophoneConstraints {
  return { audio: {
    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } }
}
