import {
  type LocalBookBindingInput,
  type PublishChapterInput,
  type PublishPageLike,
  type PublishPlatformAdapter,
  type VerifyChapterInput,
  throwAdapterNotConfigured
} from './publisher-adapter.js'
import type { ChapterPublicationStatus } from '../domain/publication.js'

export class QidianPublishPlatformAdapter implements PublishPlatformAdapter {
  platform = 'qidian'

  async openBackend(_page: PublishPageLike): Promise<void> {
    throwAdapterNotConfigured(this.platform, 'openBackend')
  }

  async ensureLoggedIn(_page: PublishPageLike): Promise<void> {
    throwAdapterNotConfigured(this.platform, 'ensureLoggedIn')
  }

  async listBooks(_page: PublishPageLike): Promise<Array<{ id: string; title: string }>> {
    throwAdapterNotConfigured(this.platform, 'listBooks')
  }

  async bindBook(_page: PublishPageLike, _localBook: LocalBookBindingInput): Promise<{ platformBookId: string }> {
    throwAdapterNotConfigured(this.platform, 'bindBook')
  }

  async publishChapter(
    _page: PublishPageLike,
    _input: PublishChapterInput
  ): Promise<{ platformChapterId?: string; status: ChapterPublicationStatus }> {
    throwAdapterNotConfigured(this.platform, 'publishChapter')
  }

  async verifyChapter(_page: PublishPageLike, _input: VerifyChapterInput): Promise<boolean> {
    throwAdapterNotConfigured(this.platform, 'verifyChapter')
  }
}
