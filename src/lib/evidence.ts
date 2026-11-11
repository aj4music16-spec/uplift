import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { LocalEvidence } from '@/data/types';
import { LIMITS } from '@/domain/types';

import { log } from './log';

export type PickResult =
  | { status: 'picked'; evidence: LocalEvidence }
  | { status: 'canceled' }
  | { status: 'denied' }
  | { status: 'too_large' }
  | { status: 'error' };

async function byteSize(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return (await response.blob()).size;
  }
  return new File(uri).size ?? 0;
}

/**
 * Lets the person choose one image from their library and prepares it as proof.
 *
 *  - Uses the system photo picker, which needs no library-wide permission on
 *    current iOS and Android: Uplift only ever sees the one image chosen.
 *  - Re-encodes to JPEG, which converts HEIC and drops EXIF metadata,
 *    including any location.
 *  - Keeps enough resolution to read the date and total (2,000 px wide at
 *    most) and stays under the 10 MB upload limit.
 */
export async function pickEvidenceImage(): Promise<PickResult> {
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false });
  } catch {
    try {
      const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted) return { status: 'denied' };
    } catch {
      // fall through
    }
    return { status: 'error' };
  }
  if (result.canceled) return { status: 'canceled' };
  const asset = result.assets[0];
  if (!asset) return { status: 'canceled' };

  try {
    for (const attempt of [
      { width: 2000, compress: 0.85 },
      { width: 1600, compress: 0.7 },
      { width: 1200, compress: 0.6 },
    ]) {
      const actions = asset.width && asset.width > attempt.width ? [{ resize: { width: attempt.width } }] : [];
      const output = await manipulateAsync(asset.uri, actions, { compress: attempt.compress, format: SaveFormat.JPEG });
      const size = await byteSize(output.uri);
      if (size > 0 && size <= LIMITS.maxEvidenceBytes) {
        return { status: 'picked', evidence: { uri: output.uri, mime: 'image/jpeg', byteSize: size, width: output.width, height: output.height } };
      }
    }
    return { status: 'too_large' };
  } catch {
    log.warn('evidence.normalize_failed', { platform: Platform.OS });
    return { status: 'error' };
  }
}

/** Reads a prepared image for upload. */
export async function readEvidenceBytes(evidence: LocalEvidence): Promise<ArrayBuffer | Blob> {
  if (Platform.OS === 'web') {
    const response = await fetch(evidence.uri);
    return response.blob();
  }
  return new File(evidence.uri).arrayBuffer();
}
