import { PassportBookSchema, type PassportBook } from '@chatdom/shared/passport';
import { readPassportReplyWith, type PassportReply } from './contracts-core';
export * from './contracts-core';
export function readPassportBook(value: unknown): PassportBook | undefined {
  const parsed = PassportBookSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function readPassportReply(value: unknown): PassportReply | undefined {
  return readPassportReplyWith(value, readPassportBook);
}
