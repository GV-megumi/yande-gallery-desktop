import type {
  RendererGalleriesChangedPayload,
  RendererGalleryIgnoredFoldersChangedPayload,
  RendererGalleryImagesChangedPayload,
  RendererGalleryImagesImportedPayload,
  RendererGalleryInvalidImagesChangedPayload,
  RendererThumbnailGeneratedPayload,
} from '../../shared/types';
import { useRendererAppEvent } from './useRendererAppEvent';

interface UseGalleryDomainEventsOptions {
  active?: boolean;
  replayDirtyOnActive?: boolean;
  onImagesImported?: (payload: RendererGalleryImagesImportedPayload) => void;
  onImagesChanged?: (payload: RendererGalleryImagesChangedPayload) => void;
  onGalleriesChanged?: (payload: RendererGalleriesChangedPayload) => void;
  onInvalidImagesChanged?: (payload: RendererGalleryInvalidImagesChangedPayload) => void;
  onIgnoredFoldersChanged?: (payload: RendererGalleryIgnoredFoldersChangedPayload) => void;
  onThumbnailGenerated?: (payload: RendererThumbnailGeneratedPayload) => void;
}

export function useGalleryDomainEvents(options: UseGalleryDomainEventsOptions): void {
  useRendererAppEvent([
    'gallery:images-imported',
    'gallery:images-changed',
    'gallery:galleries-changed',
    'gallery:invalid-images-changed',
    'gallery:ignored-folders-changed',
    'thumbnail:generated',
  ] as const, (event) => {
    if (event.type === 'gallery:images-imported') {
      options.onImagesImported?.(event.payload);
    }
    if (event.type === 'gallery:images-changed') {
      options.onImagesChanged?.(event.payload);
    }
    if (event.type === 'gallery:galleries-changed') {
      options.onGalleriesChanged?.(event.payload);
    }
    if (event.type === 'gallery:invalid-images-changed') {
      options.onInvalidImagesChanged?.(event.payload);
    }
    if (event.type === 'gallery:ignored-folders-changed') {
      options.onIgnoredFoldersChanged?.(event.payload);
    }
    if (event.type === 'thumbnail:generated') {
      options.onThumbnailGenerated?.(event.payload);
    }
  }, {
    active: options.active,
    replayDirtyOnActive: options.replayDirtyOnActive,
  });
}
