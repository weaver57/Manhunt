import { create } from 'zustand';
import { initialTrackingUiState, type TrackingUiState } from '@/types/location';

/**
 * Live tracking status consumed by the lobby/game screens. Updated by the
 * location engine from both the foreground watch and the background task.
 * The background context has its own instance — writes there are harmless
 * (the UI reads the one in the app's context).
 */
export const useTrackingStore = create<TrackingUiState>(initialTrackingUiState);

export function patchTrackingState(patch: Partial<TrackingUiState>): void {
  useTrackingStore.setState(patch);
}
