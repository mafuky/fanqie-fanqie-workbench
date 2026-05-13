import type { AccountRecord } from '../../domain/account'

export async function createAccount(label: string): Promise<AccountRecord> {
  throw new Error('Not implemented')
}

export async function getAccounts(): Promise<AccountRecord[]> {
  throw new Error('Not implemented')
}

export async function updateAccountStatus(id: string, status: string): Promise<void> {
  throw new Error('Not implemented')
}

export async function deleteAccount(id: string): Promise<void> {
  throw new Error('Not implemented')
}
