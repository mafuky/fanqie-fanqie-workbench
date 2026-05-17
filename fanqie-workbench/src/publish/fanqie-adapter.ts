import type { ChapterPublicationStatus } from '../domain/publication.js'
import {
  type LocalBookBindingInput,
  type PublishChapterInput,
  type PublishPageLike,
  type PublishPlatformAdapter,
  type VerifyChapterInput,
  throwAdapterNotConfigured
} from './publisher-adapter.js'

export const FANQIE_SELECTORS = {
  bookTitleInput: 'input[name="bookTitle"]',
  chapterTitleInput: 'input[name="chapterTitle"]',
  chapterBodyEditor: '.ql-editor, textarea[name="content"]',
  publishButton: 'button.publish-btn',
  saveButton: 'button.save-btn',
  bookListItem: '.book-list-item',
  loginIndicator: '.writer-login, #slogin-pc-login-form',
  phoneInput: 'input[name="username"][placeholder="手机号"]',
  codeInput: 'input[placeholder="请输入验证码"]',
  requestCodeButton: '.slogin-form-input__button-text',
  passwordLoginButton: 'button:has-text("密码登录")',
}

export const FANQIE_AUTHOR_URL = 'https://fanqienovel.com/main/writer/login'

export class FanqiePublishPlatformAdapter implements PublishPlatformAdapter {
  platform = 'fanqie'

  async openBackend(page: PublishPageLike): Promise<void> {
    await page.goto(FANQIE_AUTHOR_URL, { waitUntil: 'domcontentloaded' })
  }

  async ensureLoggedIn(page: PublishPageLike): Promise<void> {
    if (page.url().includes('/main/writer/login') || page.url().includes('login')) {
      throw new Error('Fanqie adapter rejected a login page; an authenticated session is required before publishing')
    }
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
